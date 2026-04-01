import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createOrchestratorService } from '../../src';
import type {
  ArchitectureFreeze,
  RequirementFreeze,
  TaskEnvelope,
  TaskGraph,
} from '../../src/contracts';
import { OrchestratorError } from '../../src/utils/error';

function buildRequirementFreeze(runId: string): RequirementFreeze {
  return {
    runId,
    title: 'Requirement freeze',
    summary: 'Lock requirements for the control plane',
    objectives: ['Deliver a control-plane skeleton'],
    nonGoals: ['Run real coding agents'],
    constraints: [
      {
        id: 'constraint-1',
        title: 'No database',
        description: 'Persist state on local files only.',
        severity: 'hard',
      },
    ],
    risks: [
      {
        id: 'risk-1',
        title: 'Drift',
        description: 'The bridge output format may drift over time.',
        severity: 'medium',
      },
    ],
    acceptanceCriteria: [
      {
        id: 'ac-1',
        description: 'The orchestrator enforces state transitions.',
        verificationMethod: 'automated_test',
        requiredEvidenceKinds: ['test_report'],
      },
    ],
    frozenAt: '2026-04-02T10:00:00.000Z',
    frozenBy: 'architect',
  };
}

function buildArchitectureFreeze(runId: string): ArchitectureFreeze {
  return {
    runId,
    summary: 'Freeze the control-plane service boundaries.',
    moduleDefinitions: [
      {
        moduleId: 'orchestrator',
        name: 'orchestrator',
        responsibility: 'Coordinate run, task, gate, and evidence state.',
        ownedPaths: ['apps/orchestrator/src'],
        publicInterfaces: ['createOrchestratorService'],
        allowedDependencies: ['shared-contracts'],
      },
      {
        moduleId: 'bridge-client',
        name: 'bridge-client',
        responsibility: 'Call chatgpt-web-bridge via HTTP only.',
        ownedPaths: ['apps/orchestrator/src/services/bridge-client.ts'],
        publicInterfaces: ['BridgeClient', 'HttpBridgeClient'],
        allowedDependencies: ['shared-contracts'],
      },
    ],
    dependencyRules: [
      {
        fromModuleId: 'orchestrator',
        toModuleId: 'bridge-client',
        rule: 'allow',
        rationale: 'The control plane can call the review plane client.',
      },
      {
        fromModuleId: 'bridge-client',
        toModuleId: 'shared-contracts',
        rule: 'allow',
        rationale: 'Reuse bridge schemas instead of redefining them.',
      },
    ],
    invariants: ['The orchestrator must not import puppeteer.', 'Execution is modeled, not faked.'],
    frozenAt: '2026-04-02T10:05:00.000Z',
    frozenBy: 'architect',
  };
}

function buildTask(runId: string): TaskEnvelope {
  return {
    taskId: randomUUID(),
    runId,
    title: 'Implement gate-aware task loop',
    objective: 'Enforce the TDD loop with gates and evidence.',
    scope: {
      inScope: ['apps/orchestrator/src/services', 'apps/orchestrator/src/domain'],
      outOfScope: ['services/chatgpt-web-bridge'],
    },
    allowedFiles: ['apps/orchestrator/src/services/**', 'apps/orchestrator/src/domain/**'],
    disallowedFiles: ['services/chatgpt-web-bridge/**'],
    dependencies: [],
    acceptanceCriteria: [
      {
        id: 'ac-1',
        description: 'The task must require tests_red before implementation.',
        verificationMethod: 'automated_test',
        requiredEvidenceKinds: ['test_report'],
      },
    ],
    testPlan: [],
    implementationNotes: [],
    evidenceIds: [],
    status: 'drafted',
    createdAt: '2026-04-02T10:06:00.000Z',
    updatedAt: '2026-04-02T10:06:00.000Z',
  };
}

async function bootstrapRun(artifactDir: string): Promise<{
  orchestrator: ReturnType<typeof createOrchestratorService>;
  runId: string;
  task: TaskEnvelope;
}> {
  const orchestrator = createOrchestratorService(artifactDir);
  const run = await orchestrator.createRun({
    title: 'Integration run',
    createdBy: 'integration-test',
  });

  await orchestrator.saveRequirementFreeze(run.runId, buildRequirementFreeze(run.runId));
  await orchestrator.evaluateGate({
    runId: run.runId,
    gateType: 'requirement_gate',
    evaluator: 'integration-test',
  });
  await orchestrator.saveArchitectureFreeze(run.runId, buildArchitectureFreeze(run.runId));
  await orchestrator.evaluateGate({
    runId: run.runId,
    gateType: 'architecture_gate',
    evaluator: 'integration-test',
  });

  const task = buildTask(run.runId);
  const graph: TaskGraph = {
    runId: run.runId,
    tasks: [task],
    edges: [],
    registeredAt: '2026-04-02T10:07:00.000Z',
  };
  await orchestrator.registerTaskGraph(run.runId, graph);

  return {
    orchestrator,
    runId: run.runId,
    task,
  };
}

describe('OrchestratorService integration', () => {
  it('runs the happy path from run creation to accepted release review', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-integration-happy-'));
    const { orchestrator, runId, task } = await bootstrapRun(artifactDir);

    await orchestrator.attachTestPlan(runId, task.taskId, [
      {
        id: 'test-1',
        description: 'Write the red test first',
        verificationCommand: 'npm test --workspace @review-then-codex/orchestrator',
        expectedRedSignal: 'A failing test documents the missing behavior',
        expectedGreenSignal: 'The task loop transitions succeed',
      },
    ]);
    await orchestrator.markTestsRed(runId, task.taskId);
    await orchestrator.evaluateGate({
      runId,
      taskId: task.taskId,
      gateType: 'red_test_gate',
      evaluator: 'integration-test',
    });
    await orchestrator.markImplementationStarted(runId, task.taskId);
    await orchestrator.markTestsGreen(runId, task.taskId);

    await orchestrator.appendEvidence({
      runId,
      taskId: task.taskId,
      stage: 'task_execution',
      kind: 'test_report',
      timestamp: '2026-04-02T10:10:00.000Z',
      producer: 'integration-test',
      artifactPaths: [path.join(artifactDir, 'runs', runId, 'test-report.txt')],
      summary: 'Task tests turned green',
      metadata: {
        suite: 'orchestrator-service',
      },
    });

    await orchestrator.submitForReview(runId, task.taskId, ['Ready for review.']);
    await orchestrator.appendEvidence({
      runId,
      taskId: task.taskId,
      stage: 'task_execution',
      kind: 'review_note',
      timestamp: '2026-04-02T10:12:00.000Z',
      producer: 'review-plane',
      artifactPaths: [path.join(artifactDir, 'runs', runId, 'review.md')],
      summary: 'Review approved the task loop change',
      metadata: {
        decision: 'approve',
      },
    });

    const reviewGate = await orchestrator.evaluateGate({
      runId,
      taskId: task.taskId,
      gateType: 'review_gate',
      evaluator: 'integration-test',
    });
    expect(reviewGate.passed).toBe(true);

    await orchestrator.acceptTask(runId, task.taskId);

    const acceptanceGate = await orchestrator.evaluateGate({
      runId,
      taskId: task.taskId,
      gateType: 'acceptance_gate',
      evaluator: 'integration-test',
    });
    expect(acceptanceGate.passed).toBe(true);

    const runAcceptanceGate = await orchestrator.evaluateGate({
      runId,
      gateType: 'acceptance_gate',
      evaluator: 'integration-test',
    });
    expect(runAcceptanceGate.passed).toBe(true);

    const summary = await orchestrator.getRunStatusSummary(runId);
    const evidenceSummary = await orchestrator.summarizeRunEvidence(runId);
    const runDirectory = path.join(artifactDir, 'runs', runId);

    expect(summary.stage).toBe('accepted');
    expect(summary.taskCounts.accepted).toBe(1);
    expect(summary.gateTotals.passed).toBeGreaterThanOrEqual(5);
    expect(evidenceSummary.total).toBeGreaterThanOrEqual(7);
    await expect(fs.stat(path.join(runDirectory, 'run.json'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runDirectory, 'task-graph.json'))).resolves.toBeTruthy();
    await expect(
      fs.stat(path.join(runDirectory, 'tasks', `${task.taskId}.json`)),
    ).resolves.toBeTruthy();
  });

  it('blocks task execution when the architecture gate has not passed', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-integration-arch-'));
    const orchestrator = createOrchestratorService(artifactDir);
    const run = await orchestrator.createRun({
      title: 'Architecture gate block',
      createdBy: 'integration-test',
    });

    await orchestrator.saveRequirementFreeze(run.runId, buildRequirementFreeze(run.runId));
    await orchestrator.saveArchitectureFreeze(run.runId, buildArchitectureFreeze(run.runId));

    const task = buildTask(run.runId);
    await orchestrator.registerTaskGraph(run.runId, {
      runId: run.runId,
      tasks: [task],
      edges: [],
      registeredAt: '2026-04-02T10:07:00.000Z',
    });
    await orchestrator.attachTestPlan(run.runId, task.taskId, [
      {
        id: 'test-1',
        description: 'Write the red test first',
        expectedRedSignal: 'red',
        expectedGreenSignal: 'green',
      },
    ]);

    await expect(orchestrator.markTestsRed(run.runId, task.taskId)).rejects.toThrowError(
      OrchestratorError,
    );
  });

  it('blocks implementation when the red_test_gate has not passed', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-integration-red-'));
    const { orchestrator, runId, task } = await bootstrapRun(artifactDir);

    await orchestrator.attachTestPlan(runId, task.taskId, [
      {
        id: 'test-1',
        description: 'Write the red test first',
        expectedRedSignal: 'red',
        expectedGreenSignal: 'green',
      },
    ]);
    await orchestrator.markTestsRed(runId, task.taskId);

    await expect(orchestrator.markImplementationStarted(runId, task.taskId)).rejects.toThrowError(
      OrchestratorError,
    );
  });

  it('blocks acceptance when the review gate fails', async () => {
    const artifactDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'orchestrator-integration-review-'),
    );
    const { orchestrator, runId, task } = await bootstrapRun(artifactDir);

    await orchestrator.attachTestPlan(runId, task.taskId, [
      {
        id: 'test-1',
        description: 'Write the red test first',
        expectedRedSignal: 'red',
        expectedGreenSignal: 'green',
      },
    ]);
    await orchestrator.markTestsRed(runId, task.taskId);
    await orchestrator.evaluateGate({
      runId,
      taskId: task.taskId,
      gateType: 'red_test_gate',
      evaluator: 'integration-test',
    });
    await orchestrator.markImplementationStarted(runId, task.taskId);
    await orchestrator.markTestsGreen(runId, task.taskId);
    await orchestrator.submitForReview(runId, task.taskId);

    const reviewGate = await orchestrator.evaluateGate({
      runId,
      taskId: task.taskId,
      gateType: 'review_gate',
      evaluator: 'integration-test',
    });
    expect(reviewGate.passed).toBe(false);

    await expect(orchestrator.acceptTask(runId, task.taskId)).rejects.toThrowError(
      OrchestratorError,
    );
  });
});
