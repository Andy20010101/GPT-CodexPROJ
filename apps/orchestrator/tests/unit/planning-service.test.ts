import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createRunRecord } from '../../src/domain/run';
import { FileEvidenceRepository } from '../../src/storage/file-evidence-repository';
import { FilePlanningRepository } from '../../src/storage/file-planning-repository';
import { EvidenceLedgerService } from '../../src/services/evidence-ledger-service';
import { PlanningModelRoutingService } from '../../src/services/planning-model-routing-service';
import { PlanningService } from '../../src/services/planning-service';
import {
  getPlanningApplyRemediationInputFile,
  getPlanningApplyRemediationOutputFile,
  getPlanningApplyRetryResultFile,
} from '../../src/utils/run-paths';
import {
  buildArchitectureFreeze,
  buildRequirementFreeze,
  createArtifactDir,
  createBridgeClient,
  missingStructuredOutputError,
} from '../helpers/runtime-fixtures';

describe('PlanningService', () => {
  it.each([
    ['requirement_freeze', 'intake'],
    ['architecture_freeze', 'requirement_frozen'],
    ['task_graph_generation', 'architecture_frozen'],
  ] as const)(
    'persists conversation metadata immediately for %s requests',
    async (phase, stage) => {
      const artifactDir = await createArtifactDir(`planning-request-${phase}-`);
      const service = createService(artifactDir);
      const run = createRunRecord({
        title: 'Planning run',
        createdBy: 'tester',
        summary: 'Fresh planning prompt',
        stage,
      });
      const dispatch = await service.requestPhase({
        run,
        phase,
        prompt: 'Fresh planning prompt',
        sourcePrompt: 'Fresh planning prompt',
        requestedBy: 'tester',
        producer: 'tester',
        requirementFreeze:
          phase !== 'requirement_freeze' ? buildRequirementFreeze(run.runId) : undefined,
        architectureFreeze:
          phase === 'task_graph_generation' ? buildArchitectureFreeze(run.runId) : undefined,
      });

      expect(dispatch.requestRuntimeState.conversationId).toBeTruthy();
      await expect(fs.stat(dispatch.requestRuntimeStatePath)).resolves.toBeTruthy();
      await expect(
        fs.stat(
          artifactDir +
            `/runs/${run.runId}/${phase === 'requirement_freeze' ? 'requirement' : phase === 'architecture_freeze' ? 'architecture' : 'task-graph'}/conversation-link.json`,
        ),
      ).resolves.toBeTruthy();
    },
  );

  it('passes the planning bridge request timeout to setup calls', async () => {
    const artifactDir = await createArtifactDir('planning-timeout-budget-');
    const bridgeCalls: Array<{
      operation: 'openSession' | 'selectProject' | 'startConversation';
      timeoutMs: number | undefined;
    }> = [];
    const baseBridgeClient = createBridgeClient();
    const service = createService(artifactDir, {
      ...baseBridgeClient,
      async openSession(input, options) {
        bridgeCalls.push({ operation: 'openSession', timeoutMs: options?.timeoutMs });
        return baseBridgeClient.openSession(input);
      },
      async selectProject(input, options) {
        bridgeCalls.push({ operation: 'selectProject', timeoutMs: options?.timeoutMs });
        return baseBridgeClient.selectProject(input);
      },
      async startConversation(input, options) {
        bridgeCalls.push({ operation: 'startConversation', timeoutMs: options?.timeoutMs });
        return baseBridgeClient.startConversation(input);
      },
    });
    const run = createRunRecord({
      title: 'Planning run',
      createdBy: 'tester',
      summary: 'Fresh planning prompt',
      stage: 'architecture_frozen',
    });

    await service.requestPhase({
      run,
      phase: 'task_graph_generation',
      prompt: 'Fresh planning prompt',
      sourcePrompt: 'Fresh planning prompt',
      requestedBy: 'tester',
      producer: 'tester',
      requirementFreeze: buildRequirementFreeze(run.runId),
      architectureFreeze: buildArchitectureFreeze(run.runId),
    });

    expect(bridgeCalls).toEqual([
      { operation: 'openSession', timeoutMs: 180_000 },
      { operation: 'selectProject', timeoutMs: 180_000 },
      { operation: 'startConversation', timeoutMs: 180_000 },
    ]);
  });

  it('recovers finalization from the same conversation when wait fails once', async () => {
    const artifactDir = await createArtifactDir('planning-finalize-recover-');
    let waitCalls = 0;
    const bridgeClient = createBridgeClient({
      requirementExtractError: missingStructuredOutputError(),
    });
    const service = createService(artifactDir, {
      ...bridgeClient,
      async waitForCompletion(conversationId, input) {
        waitCalls += 1;
        if (waitCalls === 1) {
          throw new Error('temporary wait failure');
        }
        return bridgeClient.waitForCompletion(conversationId, input);
      },
      async extractStructuredReview(conversationId, input) {
        if (waitCalls === 2) {
          return {
            artifactPath: '/bridge/requirement.json',
            manifestPath: '/bridge/requirement-manifest.json',
            payload: {
              title: 'Recovered requirement freeze',
              summary: 'Recovered from same conversation.',
              objectives: ['Recover planning materialization.'],
              nonGoals: ['Do not open a new conversation.'],
              constraints: [],
              risks: [],
              acceptanceCriteria: [
                {
                  description: 'Conversation recovery reuses the same conversation.',
                  verificationMethod: 'review',
                  requiredEvidenceKinds: [],
                },
              ],
            },
          };
        }
        return bridgeClient.extractStructuredReview(conversationId, input);
      },
    });
    const run = createRunRecord({
      title: 'Planning run',
      createdBy: 'tester',
      summary: 'Fresh planning prompt',
      stage: 'intake',
    });
    const requested = await service.requestPhase({
      run,
      phase: 'requirement_freeze',
      prompt: 'Fresh planning prompt',
      sourcePrompt: 'Fresh planning prompt',
      requestedBy: 'tester',
      producer: 'tester',
    });

    const finalized = await service.finalizePhase({
      run,
      phase: 'requirement_freeze',
      producer: 'tester',
    });

    expect(finalized.status).toBe('completed');
    if (finalized.status === 'completed') {
      expect(finalized.requestRuntimeState.conversationId).toBe(
        requested.requestRuntimeState.conversationId,
      );
      expect(finalized.finalizeRuntimeState.metadata.recoveryOutcome).toBe(
        'PLANNING_RECOVERED_FROM_CONVERSATION',
      );
    }
  });

  it('auto-repairs repairable architecture apply payloads and records remediation evidence', async () => {
    const artifactDir = await createArtifactDir('planning-apply-remediate-');
    const service = createService(artifactDir);
    const planningRepository = new FilePlanningRepository(artifactDir);
    const evidenceLedger = new EvidenceLedgerService(new FileEvidenceRepository(artifactDir));
    const run = createRunRecord({
      title: 'Planning run',
      createdBy: 'tester',
      summary: 'Freeze architecture',
      stage: 'requirement_frozen',
    });
    const seeded = await seedArchitecturePlanningArtifacts(planningRepository, run.runId, {
      payload: {
        summary: 'Bound the bootstrap slice.',
        moduleDefinitions: [
          {
            moduleId: 'env-contract',
            name: 'Env Contract',
            responsibility: 'Defines env-state.',
            ownedPaths: ['apps/orchestrator/src/contracts/self-improvement-env.ts'],
            publicInterfaces: ['SelfImprovementEnvStateSchema'],
            allowedDependencies: [],
          },
          {
            moduleId: 'planning-review-boundary',
            name: 'Planning Boundary',
            responsibility: 'Existing planning/review surfaces stay out of scope.',
            ownedPaths: [],
            publicInterfaces: ['Existing planning entry surfaces'],
            allowedDependencies: [],
          },
          {
            moduleId: 'bridge-attach-boundary',
            name: 'Bridge Boundary',
            responsibility: 'Existing bridge surfaces stay out of scope.',
            ownedPaths: [],
            publicInterfaces: ['Existing bridge attach detect surfaces'],
            allowedDependencies: [],
          },
        ],
        dependencyRules: [
          {
            fromModuleId: 'env-contract',
            toModuleId: 'planning-review-boundary',
            rule: 'allowed',
            rationale: 'Contract is descriptive only.',
          },
          {
            fromModuleId: 'planning-review-boundary',
            toModuleId: 'bridge-attach-boundary',
            rule: 'forbidden',
            rationale: 'Keep planning and bridge boundaries decoupled.',
          },
        ],
        invariants: ['Do not change gate semantics.'],
      },
    });

    const applied = await service.applyPhase({
      run,
      phase: 'architecture_freeze',
      appliedBy: 'tester',
    });

    expect(applied.finalizeRuntimeState.remediationAttempted).toBe(true);
    expect(applied.normalizedResult.moduleDefinitions.find((entry) => entry.moduleId === 'planning-review-boundary')?.ownedPaths).toEqual([
      'apps/orchestrator/src/services/planning-service.ts',
      'apps/orchestrator/src/services/review-service.ts',
      'apps/orchestrator/src/services/release-review-service.ts',
      'apps/orchestrator/src/services/planning-payload-builder.ts',
      'apps/orchestrator/src/services/review-payload-builder.ts',
    ]);
    expect(applied.normalizedResult.moduleDefinitions.find((entry) => entry.moduleId === 'bridge-attach-boundary')?.ownedPaths).toEqual([
      'services/chatgpt-web-bridge/src/browser/browser-manager.ts',
      'services/chatgpt-web-bridge/src/browser/page-factory.ts',
      'services/chatgpt-web-bridge/src/adapters/chatgpt-adapter.ts',
    ]);
    expect(applied.normalizedResult.dependencyRules.map((entry) => entry.rule)).toEqual([
      'allow',
      'deny',
    ]);

    const remediated = await planningRepository.getMaterializedResult(run.runId, 'architecture_freeze');
    expect(remediated?.metadata).toHaveProperty('planningApplyRemediation');

    const remediationInputPath = getPlanningApplyRemediationInputFile(
      artifactDir,
      run.runId,
      'architecture_freeze',
    );
    const remediationOutputPath = getPlanningApplyRemediationOutputFile(
      artifactDir,
      run.runId,
      'architecture_freeze',
    );
    const retryResultPath = getPlanningApplyRetryResultFile(
      artifactDir,
      run.runId,
      'architecture_freeze',
    );

    const remediationInput = JSON.parse(await fs.readFile(remediationInputPath, 'utf8')) as {
      classification: string;
      plannedRepairs: unknown[];
    };
    expect(remediationInput.classification).toBe('repairable');
    expect(remediationInput.plannedRepairs).toHaveLength(4);
    await expect(fs.stat(remediationOutputPath)).resolves.toBeTruthy();
    const retryResult = JSON.parse(await fs.readFile(retryResultPath, 'utf8')) as {
      status: string;
    };
    expect(retryResult.status).toBe('retry_succeeded');

    const evidence = await evidenceLedger.listEvidenceForRun(run.runId);
    expect(evidence.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining(['remediation_proposal', 'remediation_result']),
    );
    expect(seeded.finalizeRuntimeStatePath).toContain('/architecture/finalize-runtime-state.json');
  });

  it('treats unsupported architecture apply schema errors as fatal', async () => {
    const artifactDir = await createArtifactDir('planning-apply-fatal-');
    const service = createService(artifactDir);
    const planningRepository = new FilePlanningRepository(artifactDir);
    const run = createRunRecord({
      title: 'Planning run',
      createdBy: 'tester',
      summary: 'Freeze architecture',
      stage: 'requirement_frozen',
    });
    await seedArchitecturePlanningArtifacts(planningRepository, run.runId, {
      payload: {
        summary: 'Bound the bootstrap slice.',
        moduleDefinitions: [
          {
            moduleId: 'unknown-boundary',
            name: 'Unknown Boundary',
            responsibility: 'Unsupported empty owned paths.',
            ownedPaths: [],
            publicInterfaces: ['Unknown external boundary'],
            allowedDependencies: [],
          },
        ],
        dependencyRules: [
          {
            fromModuleId: 'unknown-boundary',
            toModuleId: 'unknown-boundary',
            rule: 'allow',
            rationale: 'Self reference.',
          },
        ],
        invariants: ['Do not change gate semantics.'],
      },
    });

    await expect(
      service.applyPhase({
        run,
        phase: 'architecture_freeze',
        appliedBy: 'tester',
      }),
    ).rejects.toThrow();

    const remediationInputPath = getPlanningApplyRemediationInputFile(
      artifactDir,
      run.runId,
      'architecture_freeze',
    );
    const remediationInput = JSON.parse(await fs.readFile(remediationInputPath, 'utf8')) as {
      classification: string;
      reasonCode: string;
    };
    expect(remediationInput.classification).toBe('fatal');
    expect(remediationInput.reasonCode).toBe('ARCHITECTURE_SCHEMA_FATAL');

    const finalizeState = await planningRepository.getFinalizeRuntimeState(
      run.runId,
      'architecture_freeze',
    );
    expect(finalizeState?.lastErrorCode).toBe('PLANNING_APPLY_SCHEMA_FATAL');
  });

  it('auto-repairs repairable task-graph apply payloads and records remediation evidence', async () => {
    const artifactDir = await createArtifactDir('planning-task-graph-remediate-');
    const service = createService(artifactDir);
    const planningRepository = new FilePlanningRepository(artifactDir);
    const evidenceLedger = new EvidenceLedgerService(new FileEvidenceRepository(artifactDir));
    const run = createRunRecord({
      title: 'Planning run',
      createdBy: 'tester',
      summary: 'Generate task graph',
      stage: 'architecture_frozen',
    });

    await seedTaskGraphPlanningArtifacts(planningRepository, run.runId, {
      payload: {
        tasks: [
          {
            taskId: 'T1',
            title: 'Bootstrap doctor baseline',
            objective: 'Define bootstrap doctor state.',
            executorType: 'codex',
            scope: {
              inScope: ['scripts/self-improvement-env.ts'],
              outOfScope: ['gate semantics'],
            },
            allowedFiles: ['scripts/self-improvement-env.ts'],
            disallowedFiles: [],
            dependencies: [],
            acceptanceCriteria: [
              {
                id: 'T1-AC1',
                description: 'Doctor baseline is typed.',
                verificationMethod: 'static_analysis',
                requiredEvidenceKinds: ['source diff'],
              },
              {
                id: 'T1-AC2',
                description: 'Doctor baseline is reviewed.',
                verificationMethod: 'code_review',
                requiredEvidenceKinds: ['review notes'],
              },
              {
                id: 'T1-AC3',
                description: 'Bootstrap docs are reviewed.',
                verificationMethod: 'documentation_review',
                requiredEvidenceKinds: ['docs diff'],
              },
            ],
            testPlan: [],
            implementationNotes: [],
            metadata: {},
          },
          {
            taskId: 'T2',
            title: 'Bootstrap ensure and wiring',
            objective: 'Wire ensure into the runner.',
            executorType: 'codex',
            scope: {
              inScope: ['scripts/run-real-self-improvement.ts'],
              outOfScope: ['gate semantics'],
            },
            allowedFiles: ['scripts/run-real-self-improvement.ts'],
            disallowedFiles: [],
            dependencies: ['T1'],
            acceptanceCriteria: [
              {
                id: 'T2-AC1',
                description: 'Runner uses bootstrap.',
                verificationMethod: 'documentation_review',
                requiredEvidenceKinds: ['source diff'],
              },
            ],
            testPlan: [],
            implementationNotes: [],
            metadata: {},
          },
        ],
        edges: [
          {
            fromTaskId: 'T1',
            toTaskId: 'T2',
            kind: 'blocks',
          },
        ],
      },
    });

    const applied = await service.applyPhase({
      run,
      phase: 'task_graph_generation',
      appliedBy: 'tester',
    });

    expect(applied.finalizeRuntimeState.remediationAttempted).toBe(true);
    expect(
      applied.normalizedResult.tasks.map((task) => ({
        taskId: task.taskId,
        dependencies: task.dependencies,
        verificationMethods: task.acceptanceCriteria.map((entry) => entry.verificationMethod),
      })),
    ).toEqual([
      {
        taskId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        ),
        dependencies: [],
        verificationMethods: ['automated_test', 'review', 'review'],
      },
      {
        taskId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        ),
        dependencies: [
          expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
          ),
        ],
        verificationMethods: ['review'],
      },
    ]);
    expect(applied.normalizedResult.edges).toEqual([
      {
        fromTaskId: applied.normalizedResult.tasks[0]!.taskId,
        toTaskId: applied.normalizedResult.tasks[1]!.taskId,
        kind: 'blocks',
      },
    ]);

    const remediated = await planningRepository.getMaterializedResult(run.runId, 'task_graph_generation');
    expect(remediated?.metadata).toHaveProperty('planningApplyRemediation');

    const remediationInputPath = getPlanningApplyRemediationInputFile(
      artifactDir,
      run.runId,
      'task_graph_generation',
    );
    const remediationOutputPath = getPlanningApplyRemediationOutputFile(
      artifactDir,
      run.runId,
      'task_graph_generation',
    );
    const retryResultPath = getPlanningApplyRetryResultFile(
      artifactDir,
      run.runId,
      'task_graph_generation',
    );

    const remediationInput = JSON.parse(await fs.readFile(remediationInputPath, 'utf8')) as {
      classification: string;
      plannedRepairs: unknown[];
      reasonCode: string;
    };
    expect(remediationInput.classification).toBe('repairable');
    expect(remediationInput.reasonCode).toBe('TASK_GRAPH_SCHEMA_REPAIRABLE');
    expect(remediationInput.plannedRepairs).toHaveLength(9);
    await expect(fs.stat(remediationOutputPath)).resolves.toBeTruthy();
    const retryResult = JSON.parse(await fs.readFile(retryResultPath, 'utf8')) as {
      status: string;
    };
    expect(retryResult.status).toBe('retry_succeeded');

    const evidence = await evidenceLedger.listEvidenceForRun(run.runId);
    expect(evidence.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining(['remediation_proposal', 'remediation_result']),
    );
  });

  it('treats unsupported task-graph apply verification methods as fatal', async () => {
    const artifactDir = await createArtifactDir('planning-task-graph-fatal-');
    const service = createService(artifactDir);
    const planningRepository = new FilePlanningRepository(artifactDir);
    const taskId = randomUUID();
    const run = createRunRecord({
      title: 'Planning run',
      createdBy: 'tester',
      summary: 'Generate task graph',
      stage: 'architecture_frozen',
    });

    await seedTaskGraphPlanningArtifacts(planningRepository, run.runId, {
      payload: {
        tasks: [
          {
            taskId,
            title: 'Bootstrap doctor baseline',
            objective: 'Define bootstrap doctor state.',
            executorType: 'codex',
            scope: {
              inScope: ['scripts/self-improvement-env.ts'],
              outOfScope: ['gate semantics'],
            },
            allowedFiles: ['scripts/self-improvement-env.ts'],
            disallowedFiles: [],
            dependencies: [],
            acceptanceCriteria: [
              {
                id: 'T1-AC1',
                description: 'Doctor baseline is typed.',
                verificationMethod: 'pair_review',
                requiredEvidenceKinds: ['source diff'],
              },
            ],
            testPlan: [],
            implementationNotes: [],
            metadata: {},
          },
        ],
        edges: [],
      },
    });

    await expect(
      service.applyPhase({
        run,
        phase: 'task_graph_generation',
        appliedBy: 'tester',
      }),
    ).rejects.toThrow();

    const remediationInputPath = getPlanningApplyRemediationInputFile(
      artifactDir,
      run.runId,
      'task_graph_generation',
    );
    const remediationInput = JSON.parse(await fs.readFile(remediationInputPath, 'utf8')) as {
      classification: string;
      reasonCode: string;
    };
    expect(remediationInput.classification).toBe('fatal');
    expect(remediationInput.reasonCode).toBe('TASK_GRAPH_SCHEMA_FATAL');

    const finalizeState = await planningRepository.getFinalizeRuntimeState(
      run.runId,
      'task_graph_generation',
    );
    expect(finalizeState?.lastErrorCode).toBe('PLANNING_APPLY_SCHEMA_FATAL');
  });
});

async function seedArchitecturePlanningArtifacts(
  planningRepository: FilePlanningRepository,
  runId: string,
  input: {
    payload: Record<string, unknown>;
  },
): Promise<{ finalizeRuntimeStatePath: string }> {
  const planningId = randomUUID();
  const conversationId = randomUUID();
  const request = {
    planningId,
    runId,
    phase: 'architecture_freeze' as const,
    prompt: 'Freeze architecture',
    requestedBy: 'tester',
    metadata: {},
    createdAt: '2026-04-07T10:00:00.000Z',
  };
  await planningRepository.saveRequest(request);
  await planningRepository.saveRequestRuntimeState({
    planningId,
    runId,
    phase: 'architecture_freeze',
    status: 'planning_waiting',
    attempt: 1,
    sessionId: randomUUID(),
    conversationId,
    conversationUrl: 'https://chatgpt.com/c/test-architecture',
    browserUrl: 'https://chatgpt.com/',
    projectName: 'Planning Proof',
    model: 'pro',
    remediationAttempted: false,
    recoveryAttempted: false,
    createdAt: '2026-04-07T10:00:00.000Z',
    updatedAt: '2026-04-07T10:00:10.000Z',
    metadata: {},
  });
  const finalizeRuntimeStatePath = await planningRepository.saveFinalizeRuntimeState({
    planningId,
    runId,
    phase: 'architecture_freeze',
    status: 'planning_materialized',
    attempt: 1,
    sessionId: randomUUID(),
    conversationId,
    conversationUrl: 'https://chatgpt.com/c/test-architecture',
    browserUrl: 'https://chatgpt.com/',
    projectName: 'Planning Proof',
    model: 'pro',
    remediationAttempted: false,
    recoveryAttempted: false,
    createdAt: '2026-04-07T10:00:00.000Z',
    updatedAt: '2026-04-07T10:00:20.000Z',
    metadata: {},
  });
  await planningRepository.saveMaterializedResult({
    planningId,
    runId,
    phase: 'architecture_freeze',
    conversationId,
    conversationUrl: 'https://chatgpt.com/c/test-architecture',
    materializedAt: '2026-04-07T10:00:30.000Z',
    producer: 'tester',
    markdownPath: '/bridge/architecture.md',
    markdownManifestPath: '/bridge/architecture-manifest.json',
    structuredResultPath: '/bridge/architecture.json',
    structuredResultManifestPath: '/bridge/architecture-manifest.json',
    payload: input.payload,
    metadata: {},
  });
  return { finalizeRuntimeStatePath };
}

async function seedTaskGraphPlanningArtifacts(
  planningRepository: FilePlanningRepository,
  runId: string,
  input: {
    payload: Record<string, unknown>;
  },
): Promise<void> {
  const planningId = randomUUID();
  const conversationId = randomUUID();
  await planningRepository.saveRequest({
    planningId,
    runId,
    phase: 'task_graph_generation',
    prompt: 'Generate task graph',
    requestedBy: 'tester',
    metadata: {},
    createdAt: '2026-04-07T11:00:00.000Z',
  });
  await planningRepository.saveRequestRuntimeState({
    planningId,
    runId,
    phase: 'task_graph_generation',
    status: 'planning_waiting',
    attempt: 1,
    sessionId: randomUUID(),
    conversationId,
    conversationUrl: 'https://chatgpt.com/c/test-task-graph',
    browserUrl: 'https://chatgpt.com/',
    projectName: 'Planning Proof',
    model: 'pro',
    remediationAttempted: false,
    recoveryAttempted: false,
    createdAt: '2026-04-07T11:00:00.000Z',
    updatedAt: '2026-04-07T11:00:10.000Z',
    metadata: {},
  });
  await planningRepository.saveFinalizeRuntimeState({
    planningId,
    runId,
    phase: 'task_graph_generation',
    status: 'planning_materialized',
    attempt: 1,
    sessionId: randomUUID(),
    conversationId,
    conversationUrl: 'https://chatgpt.com/c/test-task-graph',
    browserUrl: 'https://chatgpt.com/',
    projectName: 'Planning Proof',
    model: 'pro',
    remediationAttempted: false,
    recoveryAttempted: false,
    createdAt: '2026-04-07T11:00:00.000Z',
    updatedAt: '2026-04-07T11:00:20.000Z',
    metadata: {},
  });
  await planningRepository.saveMaterializedResult({
    planningId,
    runId,
    phase: 'task_graph_generation',
    conversationId,
    conversationUrl: 'https://chatgpt.com/c/test-task-graph',
    materializedAt: '2026-04-07T11:00:30.000Z',
    producer: 'tester',
    markdownPath: '/bridge/task-graph.md',
    markdownManifestPath: '/bridge/task-graph-manifest.json',
    structuredResultPath: '/bridge/task-graph.json',
    structuredResultManifestPath: '/bridge/task-graph-manifest.json',
    payload: input.payload,
    metadata: {},
  });
}

function createService(
  artifactDir: string,
  bridgeClient = createBridgeClient(),
): PlanningService {
  return new PlanningService(
    bridgeClient,
    new FilePlanningRepository(artifactDir),
    new EvidenceLedgerService(new FileEvidenceRepository(artifactDir)),
    new PlanningModelRoutingService({
      defaultModel: 'pro',
      maxWaitMs: 3_000_000,
      pollIntervalMs: 5000,
      stablePolls: 3,
    }),
    undefined,
    {
      browserUrl: 'https://chatgpt.com/',
      projectName: 'Planning Proof',
      requestTimeoutMs: 180_000,
    },
  );
}
