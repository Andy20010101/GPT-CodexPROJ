/* eslint-disable @typescript-eslint/require-await */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { ArchitectureFreeze, RequirementFreeze, TaskEnvelope } from '../../src/contracts';
import { createOrchestratorService } from '../../src';
import type { BridgeClient } from '../../src/services/bridge-client';
import { OrchestratorError } from '../../src/utils/error';

function buildRequirementFreeze(runId: string): RequirementFreeze {
  return {
    runId,
    title: 'Execution requirement freeze',
    summary: 'Freeze execution-plane requirements.',
    objectives: ['Record execution requests, results, and artifacts.'],
    nonGoals: ['Pretend that real Codex cloud execution already exists.'],
    constraints: [],
    risks: [],
    acceptanceCriteria: [
      {
        id: 'ac-1',
        description: 'Execution results are persisted as evidence.',
        verificationMethod: 'automated_test',
        requiredEvidenceKinds: ['execution_result', 'test_report'],
      },
    ],
    frozenAt: '2026-04-02T12:00:00.000Z',
    frozenBy: 'architect',
  };
}

function buildArchitectureFreeze(runId: string): ArchitectureFreeze {
  return {
    runId,
    summary: 'Freeze execution-plane boundaries.',
    moduleDefinitions: [
      {
        moduleId: 'orchestrator',
        name: 'orchestrator',
        responsibility: 'control plane',
        ownedPaths: ['apps/orchestrator/src'],
        publicInterfaces: ['createOrchestratorService'],
        allowedDependencies: ['shared-contracts'],
      },
      {
        moduleId: 'execution-adapters',
        name: 'execution-adapters',
        responsibility: 'executor implementations',
        ownedPaths: ['apps/orchestrator/src/services'],
        publicInterfaces: ['ExecutionService', 'ExecutorRegistry'],
        allowedDependencies: ['orchestrator'],
      },
    ],
    dependencyRules: [
      {
        fromModuleId: 'orchestrator',
        toModuleId: 'execution-adapters',
        rule: 'allow',
        rationale: 'Control plane dispatches task envelopes to execution adapters.',
      },
    ],
    invariants: ['The orchestrator does not import puppeteer.'],
    frozenAt: '2026-04-02T12:05:00.000Z',
    frozenBy: 'architect',
  };
}

function buildTask(runId: string): TaskEnvelope {
  return {
    taskId: randomUUID(),
    runId,
    title: 'Run execution flow',
    objective: 'Dispatch a task to the command executor and persist evidence.',
    executorType: 'command',
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
        description: 'Execution produces command and test artifacts.',
        verificationMethod: 'automated_test',
        requiredEvidenceKinds: ['execution_result', 'test_report'],
      },
    ],
    testPlan: [],
    implementationNotes: ['Keep execution adapters replaceable.'],
    evidenceIds: [],
    metadata: {},
    status: 'drafted',
    createdAt: '2026-04-02T12:06:00.000Z',
    updatedAt: '2026-04-02T12:06:00.000Z',
  };
}

async function bootstrapExecutionReadyTask(artifactDir: string): Promise<{
  orchestrator: ReturnType<typeof createOrchestratorService>;
  runId: string;
  taskId: string;
}> {
  const orchestrator = createOrchestratorService(artifactDir);
  const run = await orchestrator.createRun({
    title: 'Execution integration run',
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
    registeredAt: '2026-04-02T12:07:00.000Z',
  });
  await orchestrator.attachTestPlan(run.runId, task.taskId, [
    {
      id: 'tp-1',
      description: 'A red test must exist before implementation starts.',
      verificationCommand: 'npm test',
      expectedRedSignal: 'failing tests',
      expectedGreenSignal: 'passing tests',
    },
  ]);
  await orchestrator.markTestsRed(run.runId, task.taskId);

  return {
    orchestrator,
    runId: run.runId,
    taskId: task.taskId,
  };
}

function createApprovedBridgeClient(): BridgeClient {
  const conversationId = randomUUID();
  const sessionId = randomUUID();

  return {
    async getBridgeHealth() {
      return {
        status: 'ready',
        checkedAt: '2026-04-02T12:07:30.000Z',
        activeSessions: 1,
        activeConversations: 1,
        issues: [],
        metadata: {},
      };
    },
    async listDriftIncidents() {
      return [];
    },
    async openSession() {
      return {
        sessionId,
        browserUrl: 'https://chatgpt.com/',
        connectedAt: '2026-04-02T12:07:30.000Z',
      };
    },
    async resumeSession(resumeSessionId) {
      return {
        session: {
          sessionId: resumeSessionId,
          browserUrl: 'https://chatgpt.com/',
          connectedAt: '2026-04-02T12:07:30.000Z',
        },
        health: {
          status: 'ready',
          checkedAt: '2026-04-02T12:07:30.000Z',
          activeSessions: 1,
          activeConversations: 1,
          issues: [],
          metadata: {},
        },
      };
    },
    async selectProject(input) {
      return {
        sessionId: input.sessionId,
        browserUrl: 'https://chatgpt.com/',
        projectName: input.projectName,
        model: input.model,
        connectedAt: '2026-04-02T12:07:30.000Z',
      };
    },
    async startConversation(input) {
      return {
        conversationId,
        sessionId: input.sessionId,
        projectName: input.projectName ?? 'Execution Review Project',
        model: input.model,
        status: 'running',
        source: 'memory',
        messages: [],
        startedAt: '2026-04-02T12:08:00.000Z',
        updatedAt: '2026-04-02T12:08:00.000Z',
      };
    },
    async sendMessage() {
      throw new Error('sendMessage should not be called when structured review is present');
    },
    async recoverConversation(recoverConversationId) {
      return {
        snapshot: {
          conversationId: recoverConversationId,
          sessionId,
          projectName: 'Execution Review Project',
          model: 'gpt-5.4',
          status: 'completed',
          source: 'memory',
          messages: [],
          startedAt: '2026-04-02T12:08:00.000Z',
          updatedAt: '2026-04-02T12:08:30.000Z',
        },
        health: {
          status: 'ready',
          checkedAt: '2026-04-02T12:08:30.000Z',
          activeSessions: 1,
          activeConversations: 1,
          issues: [],
          metadata: {},
        },
      };
    },
    async getSnapshot() {
      return {
        conversationId,
        sessionId,
        projectName: 'Execution Review Project',
        model: 'gpt-5.4',
        status: 'completed',
        source: 'memory',
        messages: [],
        startedAt: '2026-04-02T12:08:00.000Z',
        updatedAt: '2026-04-02T12:08:30.000Z',
      };
    },
    async waitForCompletion() {
      return {
        conversationId,
        sessionId,
        projectName: 'Execution Review Project',
        model: 'gpt-5.4',
        status: 'completed',
        source: 'memory',
        messages: [],
        startedAt: '2026-04-02T12:08:00.000Z',
        updatedAt: '2026-04-02T12:08:30.000Z',
      };
    },
    async exportMarkdown() {
      return {
        artifactPath: '/bridge/review.md',
        manifestPath: '/bridge/review-manifest.json',
        markdown: '# review\napproved\n',
      };
    },
    async extractStructuredReview() {
      return {
        artifactPath: '/bridge/structured-review.json',
        manifestPath: '/bridge/structured-review-manifest.json',
        payload: {
          status: 'approved',
          summary: 'Review approved the execution artifacts.',
          findings: [],
          missingTests: [],
          architectureConcerns: [],
          recommendedActions: [],
        },
      };
    },
  };
}

describe('execution flow integration', () => {
  it('drives run -> execution -> review -> acceptance on the happy path', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'execution-flow-happy-'));
    const orchestrator = createOrchestratorService({
      artifactDir,
      bridgeClient: createApprovedBridgeClient(),
    });
    const run = await orchestrator.createRun({
      title: 'Execution integration run',
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
      registeredAt: '2026-04-02T12:07:00.000Z',
    });
    await orchestrator.attachTestPlan(run.runId, task.taskId, [
      {
        id: 'tp-1',
        description: 'A red test must exist before implementation starts.',
        verificationCommand: 'npm test',
        expectedRedSignal: 'failing tests',
        expectedGreenSignal: 'passing tests',
      },
    ]);
    await orchestrator.markTestsRed(run.runId, task.taskId);
    const runId = run.runId;
    const taskId = task.taskId;

    await orchestrator.evaluateGate({
      runId,
      taskId,
      gateType: 'red_test_gate',
      evaluator: 'tester',
    });

    const request = await orchestrator.createExecutionRequest({
      runId,
      taskId,
      workspacePath: '/home/administrator/code/review-then-codex-system',
      executorType: 'command',
      command: {
        command: 'bash',
        args: ['-lc', 'printf "vitest ok"'],
        purpose: 'test',
        shell: false,
        env: {},
      },
    });
    expect(request.executorType).toBe('command');

    const execution = await orchestrator.executeTask({
      runId,
      taskId,
      producer: 'tester',
      workspacePath: '/home/administrator/code/review-then-codex-system',
      executorType: 'command',
      command: {
        command: 'bash',
        args: ['-lc', 'printf "vitest ok"'],
        purpose: 'test',
        shell: false,
        env: {},
      },
      submitForReviewOnSuccess: true,
    });

    expect(execution.result.status).toBe('succeeded');
    expect(execution.task.status).toBe('review_pending');
    const persistedResult = JSON.parse(
      await fs.readFile(path.join(execution.executionDir, 'result.json'), 'utf8'),
    ) as { summary: string };
    expect(persistedResult.summary).toContain('completed successfully');

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

    const status = await orchestrator.getRunStatusSummary(runId);
    expect(status.stage).toBe('accepted');

    const executionSummary = await orchestrator.summarizeExecutionForTask(runId, taskId);
    expect(executionSummary.totalExecutions).toBe(1);
    expect(executionSummary.byStatus.succeeded).toBe(1);

    const artifacts = await orchestrator.collectExecutionArtifacts(runId, taskId);
    expect(artifacts.some((artifact) => artifact.kind === 'test-log')).toBe(true);

    const evidenceSummary = await orchestrator.summarizeRunEvidence(runId);
    expect(evidenceSummary.byKind.execution_result).toBe(1);
    expect(evidenceSummary.byKind.test_report).toBeGreaterThanOrEqual(1);
  });

  it('writes failed execution evidence and keeps the task in implementation', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'execution-flow-fail-'));
    const { orchestrator, runId, taskId } = await bootstrapExecutionReadyTask(artifactDir);

    await orchestrator.evaluateGate({
      runId,
      taskId,
      gateType: 'red_test_gate',
      evaluator: 'tester',
    });

    const execution = await orchestrator.executeTask({
      runId,
      taskId,
      producer: 'tester',
      workspacePath: '/home/administrator/code/review-then-codex-system',
      executorType: 'command',
      command: {
        command: 'bash',
        args: ['-lc', 'printf "broken"; printf "boom" >&2; exit 5'],
        purpose: 'test',
        shell: false,
        env: {},
      },
    });

    expect(execution.result.status).toBe('failed');
    expect(execution.task.status).toBe('implementation_in_progress');
    expect(await fs.readFile(path.join(execution.executionDir, 'stderr.log'), 'utf8')).toBe('boom');

    const executionSummary = await orchestrator.summarizeExecutionForTask(runId, taskId);
    expect(executionSummary.byStatus.failed).toBe(1);

    const evidence = await orchestrator.listEvidenceForTask(runId, taskId);
    expect(evidence.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining(['execution_result', 'test_report', 'command_log']),
    );
  });

  it('blocks execution request creation before the red test gate passes', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'execution-flow-red-gate-'));
    const { orchestrator, runId, taskId } = await bootstrapExecutionReadyTask(artifactDir);

    await expect(
      orchestrator.createExecutionRequest({
        runId,
        taskId,
        workspacePath: '/home/administrator/code/review-then-codex-system',
        executorType: 'command',
        command: {
          command: 'bash',
          args: ['-lc', 'printf "no gate"'],
          purpose: 'test',
          shell: false,
          env: {},
        },
      }),
    ).rejects.toThrowError(OrchestratorError);
  });

  it('does not allow successful execution to bypass the review gate', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'execution-flow-review-gate-'));
    const { orchestrator, runId, taskId } = await bootstrapExecutionReadyTask(artifactDir);

    await orchestrator.evaluateGate({
      runId,
      taskId,
      gateType: 'red_test_gate',
      evaluator: 'tester',
    });

    const execution = await orchestrator.executeTask({
      runId,
      taskId,
      producer: 'tester',
      workspacePath: '/home/administrator/code/review-then-codex-system',
      executorType: 'command',
      command: {
        command: 'bash',
        args: ['-lc', 'printf "vitest ok"'],
        purpose: 'test',
        shell: false,
        env: {},
      },
      submitForReviewOnSuccess: true,
    });

    expect(execution.task.status).toBe('review_pending');
    await expect(orchestrator.acceptTask(runId, taskId)).rejects.toThrowError(OrchestratorError);
  });
});
