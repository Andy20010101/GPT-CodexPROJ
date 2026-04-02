/* eslint-disable @typescript-eslint/require-await */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createOrchestratorService } from '../../src';
import type { ArchitectureFreeze, RequirementFreeze, TaskEnvelope } from '../../src/contracts';
import { BridgeClientError, type BridgeClient } from '../../src/services/bridge-client';
import type { CodexRunner } from '../../src/services/codex-executor';
import { WorktreeService } from '../../src/services/worktree-service';
import { OrchestratorError } from '../../src/utils/error';

function buildRequirementFreeze(runId: string): RequirementFreeze {
  return {
    runId,
    title: 'Codex review loop requirement freeze',
    summary: 'Freeze the single-task execution and review loop.',
    objectives: ['Execute a task in an isolated workspace and review it via the bridge.'],
    nonGoals: ['Implement multi-task scheduling.'],
    constraints: [
      {
        id: 'constraint-1',
        title: 'Workspace isolation',
        description: 'Execution must run in a prepared workspace runtime.',
        severity: 'hard',
      },
    ],
    risks: [
      {
        id: 'risk-1',
        title: 'Structured review drift',
        description: 'Bridge output may miss the required structured JSON block.',
        severity: 'medium',
      },
    ],
    acceptanceCriteria: [
      {
        id: 'ac-1',
        description: 'Execution and review both write structured evidence.',
        verificationMethod: 'automated_test',
        requiredEvidenceKinds: ['execution_result', 'review_result'],
      },
    ],
    frozenAt: '2026-04-02T13:00:00.000Z',
    frozenBy: 'architect',
  };
}

function buildArchitectureFreeze(runId: string): ArchitectureFreeze {
  return {
    runId,
    summary: 'Freeze execution, review, and workspace boundaries.',
    moduleDefinitions: [
      {
        moduleId: 'orchestrator',
        name: 'orchestrator',
        responsibility: 'Coordinate run, execution, review, and gate state.',
        ownedPaths: ['apps/orchestrator/src'],
        publicInterfaces: ['createOrchestratorService'],
        allowedDependencies: ['shared-contracts'],
      },
      {
        moduleId: 'execution-runtime',
        name: 'execution-runtime',
        responsibility: 'Run executor workloads in isolated workspaces.',
        ownedPaths: ['apps/orchestrator/src/services'],
        publicInterfaces: ['ExecutionService', 'WorkspaceRuntimeService'],
        allowedDependencies: ['orchestrator'],
      },
    ],
    dependencyRules: [
      {
        fromModuleId: 'orchestrator',
        toModuleId: 'execution-runtime',
        rule: 'allow',
        rationale: 'Control plane dispatches execution into an isolated runtime shell.',
      },
    ],
    invariants: [
      'Execution does not write directly into the main checkout.',
      'Review evidence must come back through the bridge client boundary.',
    ],
    frozenAt: '2026-04-02T13:05:00.000Z',
    frozenBy: 'architect',
  };
}

function buildTask(runId: string): TaskEnvelope {
  return {
    taskId: randomUUID(),
    runId,
    title: 'Implement codex review loop',
    objective: 'Execute a single task and route structured review back into the review gate.',
    executorType: 'codex',
    scope: {
      inScope: ['apps/orchestrator/src/services', 'apps/orchestrator/src/storage'],
      outOfScope: ['services/chatgpt-web-bridge'],
    },
    allowedFiles: ['apps/orchestrator/src/services/**', 'apps/orchestrator/src/storage/**'],
    disallowedFiles: ['services/chatgpt-web-bridge/**'],
    dependencies: [],
    acceptanceCriteria: [
      {
        id: 'ac-1',
        description: 'The task writes execution and review evidence for gate evaluation.',
        verificationMethod: 'automated_test',
        requiredEvidenceKinds: ['execution_result', 'review_result'],
      },
    ],
    testPlan: [],
    implementationNotes: ['Keep the runner and review adapters replaceable.'],
    evidenceIds: [],
    metadata: {},
    status: 'drafted',
    createdAt: '2026-04-02T13:06:00.000Z',
    updatedAt: '2026-04-02T13:06:00.000Z',
  };
}

class FakeWorktreeService extends WorktreeService {
  public override async prepareWorkspace(input: { baseRepoPath: string; workspacePath: string }) {
    await fs.mkdir(input.workspacePath, { recursive: true });
    await fs.writeFile(
      path.join(input.workspacePath, 'README.md'),
      '# isolated workspace\n',
      'utf8',
    );
    return {
      workspacePath: input.workspacePath,
      baseRepoPath: input.baseRepoPath,
      baseCommit: 'abc123',
      mode: 'git_worktree' as const,
    };
  }

  public override async cleanupWorkspace(input: { workspacePath: string }): Promise<void> {
    await fs.rm(input.workspacePath, { force: true, recursive: true });
  }

  public override async describeWorkspace(input: { workspacePath: string }) {
    return {
      workspacePath: input.workspacePath,
      baseRepoPath: '/tmp/fake-base-repo',
      baseCommit: 'abc123',
      mode: 'git_worktree' as const,
    };
  }
}

function createBridgeClient(options?: {
  structuredReview?: Record<string, unknown>;
  extractError?: Error;
}): BridgeClient {
  const conversationId = randomUUID();
  const sessionId = randomUUID();

  return {
    async openSession() {
      return {
        sessionId,
        browserUrl: 'https://chatgpt.com/',
        connectedAt: '2026-04-02T13:07:00.000Z',
      };
    },
    async selectProject(input) {
      return {
        sessionId: input.sessionId,
        browserUrl: 'https://chatgpt.com/',
        projectName: input.projectName,
        model: input.model,
        connectedAt: '2026-04-02T13:07:00.000Z',
      };
    },
    async startConversation(input) {
      return {
        conversationId,
        sessionId: input.sessionId,
        projectName: input.projectName ?? 'Review Project',
        model: input.model,
        status: 'running',
        source: 'memory',
        messages: [],
        startedAt: '2026-04-02T13:07:00.000Z',
        updatedAt: '2026-04-02T13:07:00.000Z',
      };
    },
    async sendMessage() {
      return {
        conversationId,
        sessionId,
        projectName: 'Review Project',
        status: 'running',
        source: 'memory',
        messages: [],
        startedAt: '2026-04-02T13:07:10.000Z',
        updatedAt: '2026-04-02T13:07:10.000Z',
      };
    },
    async waitForCompletion() {
      return {
        conversationId,
        sessionId,
        projectName: 'Review Project',
        model: 'gpt-5.4',
        status: 'completed',
        source: 'memory',
        messages: [],
        startedAt: '2026-04-02T13:07:00.000Z',
        updatedAt: '2026-04-02T13:07:30.000Z',
      };
    },
    async exportMarkdown() {
      return {
        artifactPath: '/bridge/review.md',
        manifestPath: '/bridge/review-manifest.json',
        markdown: '# review\nstructured output follows\n',
      };
    },
    async extractStructuredReview() {
      if (options?.extractError) {
        throw options.extractError;
      }

      return {
        artifactPath: '/bridge/structured-review.json',
        manifestPath: '/bridge/structured-review-manifest.json',
        payload: options?.structuredReview ?? {
          status: 'approved',
          summary: 'Structured review approved the task.',
          findings: [],
          missingTests: [],
          architectureConcerns: [],
          recommendedActions: [],
        },
      };
    },
  };
}

function createSuccessfulCodexRunner(): CodexRunner {
  return {
    async run(payload) {
      return {
        status: 'succeeded',
        summary: `Codex CLI completed execution for ${payload.taskId}.`,
        stdout: 'implemented task',
        stderr: '',
        exitCode: 0,
        patch: [
          'diff --git a/apps/orchestrator/src/services/review-service.ts b/apps/orchestrator/src/services/review-service.ts',
          '+++ b/apps/orchestrator/src/services/review-service.ts',
          '@@',
          '+// review loop integration',
        ].join('\n'),
        testResults: [
          {
            suite: 'vitest',
            status: 'passed',
            passed: 4,
            failed: 0,
            skipped: 0,
          },
        ],
        metadata: {
          runner: 'mock-codex-cli',
        },
      };
    },
  };
}

function createMissingCliCodexRunner(): CodexRunner {
  return {
    async run() {
      throw new OrchestratorError('CODEX_CLI_NOT_FOUND', 'Codex CLI binary was not found: codex');
    },
  };
}

async function bootstrapCodexReviewLoop(input: {
  artifactDir: string;
  bridgeClient: BridgeClient;
  codexRunner: CodexRunner;
}): Promise<{
  orchestrator: ReturnType<typeof createOrchestratorService>;
  runId: string;
  taskId: string;
  workspaceId: string;
}> {
  const orchestrator = createOrchestratorService({
    artifactDir: input.artifactDir,
    bridgeClient: input.bridgeClient,
    codexRunner: input.codexRunner,
    worktreeService: new FakeWorktreeService(),
  });
  const run = await orchestrator.createRun({
    title: 'Codex review loop run',
    createdBy: 'tester',
  });

  await orchestrator.saveRequirementFreeze(run.runId, buildRequirementFreeze(run.runId));
  await orchestrator.evaluateGate({
    runId: run.runId,
    gateType: 'requirement_gate',
    evaluator: 'tester',
  });
  await orchestrator.saveArchitectureFreeze(run.runId, buildArchitectureFreeze(run.runId));
  await orchestrator.evaluateGate({
    runId: run.runId,
    gateType: 'architecture_gate',
    evaluator: 'tester',
  });

  const task = buildTask(run.runId);
  await orchestrator.registerTaskGraph(run.runId, {
    runId: run.runId,
    tasks: [task],
    edges: [],
    registeredAt: '2026-04-02T13:07:00.000Z',
  });
  await orchestrator.attachTestPlan(run.runId, task.taskId, [
    {
      id: 'tp-1',
      description: 'Document the failing test before implementation.',
      verificationCommand: 'npm test',
      expectedRedSignal: 'red test',
      expectedGreenSignal: 'green test',
    },
  ]);
  await orchestrator.markTestsRed(run.runId, task.taskId);
  await orchestrator.evaluateGate({
    runId: run.runId,
    taskId: task.taskId,
    gateType: 'red_test_gate',
    evaluator: 'tester',
  });

  const baseRepoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-review-base-'));
  const workspace = await orchestrator.prepareWorkspaceRuntime({
    runId: run.runId,
    taskId: task.taskId,
    baseRepoPath,
    executorType: 'codex',
  });

  return {
    orchestrator,
    runId: run.runId,
    taskId: task.taskId,
    workspaceId: workspace.workspaceId,
  };
}

describe('codex review loop integration', () => {
  it('runs execution, structured review, and acceptance for a single codex task', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-review-loop-happy-'));
    const { orchestrator, runId, taskId, workspaceId } = await bootstrapCodexReviewLoop({
      artifactDir,
      bridgeClient: createBridgeClient(),
      codexRunner: createSuccessfulCodexRunner(),
    });

    const execution = await orchestrator.executeTask({
      runId,
      taskId,
      producer: 'tester',
      workspaceId,
      executorType: 'codex',
      submitForReviewOnSuccess: true,
    });
    expect(execution.result.status).toBe('succeeded');
    expect(execution.task.status).toBe('review_pending');

    const review = await orchestrator.reviewTaskExecution({
      runId,
      taskId,
      executionId: execution.result.executionId,
      producer: 'reviewer',
    });
    expect(review.result.status).toBe('approved');
    expect(review.gateResult.passed).toBe(true);

    const acceptedTask = await orchestrator.acceptTask(runId, taskId);
    expect(acceptedTask.status).toBe('accepted');

    const taskAcceptanceGate = await orchestrator.evaluateGate({
      runId,
      taskId,
      gateType: 'acceptance_gate',
      evaluator: 'qa',
    });
    expect(taskAcceptanceGate.passed).toBe(true);

    const runAcceptanceGate = await orchestrator.evaluateGate({
      runId,
      gateType: 'acceptance_gate',
      evaluator: 'qa',
    });
    expect(runAcceptanceGate.passed).toBe(true);

    const workspace = await orchestrator.describeWorkspaceRuntime(runId, workspaceId);
    expect(workspace.status).toBe('prepared');

    const evidence = await orchestrator.listEvidenceForTask(runId, taskId);
    expect(evidence.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining([
        'workspace_runtime',
        'execution_request',
        'execution_result',
        'review_request',
        'review_result',
        'bridge_markdown',
        'bridge_structured_review',
        'gate_result',
      ]),
    );
    await expect(fs.readFile(path.join(review.reviewDir, 'review.md'), 'utf8')).resolves.toContain(
      'structured output follows',
    );
    await expect(
      fs.readFile(path.join(review.reviewDir, 'structured-review.json'), 'utf8'),
    ).resolves.toContain('"status": "approved"');
  });

  it('keeps the task out of accepted when review requests changes', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-review-loop-changes-'));
    const { orchestrator, runId, taskId, workspaceId } = await bootstrapCodexReviewLoop({
      artifactDir,
      bridgeClient: createBridgeClient({
        structuredReview: {
          status: 'changes_requested',
          summary: 'The patch needs more work.',
          findings: ['Edge case handling is missing.'],
          missingTests: ['Add a regression test for review retry.'],
          architectureConcerns: [],
          recommendedActions: ['Return to implementation and extend the test plan.'],
        },
      }),
      codexRunner: createSuccessfulCodexRunner(),
    });

    const execution = await orchestrator.executeTask({
      runId,
      taskId,
      producer: 'tester',
      workspaceId,
      executorType: 'codex',
      submitForReviewOnSuccess: true,
    });
    const review = await orchestrator.reviewTaskExecution({
      runId,
      taskId,
      executionId: execution.result.executionId,
      producer: 'reviewer',
    });

    expect(review.result.status).toBe('changes_requested');
    expect(review.gateResult.passed).toBe(false);
    expect(review.task.status).toBe('implementation_in_progress');
    await expect(orchestrator.acceptTask(runId, taskId)).rejects.toThrowError(OrchestratorError);
  });

  it('records incomplete review evidence when structured output is missing', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-review-loop-missing-'));
    const { orchestrator, runId, taskId, workspaceId } = await bootstrapCodexReviewLoop({
      artifactDir,
      bridgeClient: createBridgeClient({
        extractError: new BridgeClientError(
          'STRUCTURED_OUTPUT_NOT_FOUND',
          'Structured review block is missing.',
          404,
        ),
      }),
      codexRunner: createSuccessfulCodexRunner(),
    });

    const execution = await orchestrator.executeTask({
      runId,
      taskId,
      producer: 'tester',
      workspaceId,
      executorType: 'codex',
      submitForReviewOnSuccess: true,
    });
    const review = await orchestrator.reviewTaskExecution({
      runId,
      taskId,
      executionId: execution.result.executionId,
      producer: 'reviewer',
    });

    expect(review.result.status).toBe('incomplete');
    expect(review.result.metadata.errorCode).toBe('REVIEW_STRUCTURED_OUTPUT_MISSING');
    expect(review.gateResult.passed).toBe(false);
    expect(review.task.status).toBe('review_pending');

    const evidence = await orchestrator.listEvidenceForTask(runId, taskId);
    expect(evidence.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining(['review_request', 'review_result', 'bridge_markdown', 'gate_result']),
    );
    expect(evidence.some((entry) => entry.kind === 'bridge_structured_review')).toBe(false);
  });

  it('writes failed execution evidence when the codex cli is unavailable', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-review-loop-cli-missing-'));
    const { orchestrator, runId, taskId, workspaceId } = await bootstrapCodexReviewLoop({
      artifactDir,
      bridgeClient: createBridgeClient(),
      codexRunner: createMissingCliCodexRunner(),
    });

    const execution = await orchestrator.executeTask({
      runId,
      taskId,
      producer: 'tester',
      workspaceId,
      executorType: 'codex',
    });

    expect(execution.result.status).toBe('failed');
    expect(execution.result.metadata.errorCode).toBe('CODEX_CLI_NOT_FOUND');
    expect(execution.task.status).toBe('implementation_in_progress');
    await expect(
      fs.readFile(path.join(execution.executionDir, 'stderr.log'), 'utf8'),
    ).resolves.toContain('Codex CLI binary was not found');

    const executionSummary = await orchestrator.summarizeExecutionForTask(runId, taskId);
    expect(executionSummary.byStatus.failed).toBe(1);

    const evidence = await orchestrator.listEvidenceForTask(runId, taskId);
    expect(evidence.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining(['workspace_runtime', 'execution_request', 'execution_result']),
    );
  });
});
