import { describe, expect, it, vi } from 'vitest';

import type { ArchitectureFreeze, TaskEnvelope } from '../../src/contracts';
import { OrchestratorService } from '../../src/application/orchestrator-service';
import { GateEvaluator } from '../../src/services/gate-evaluator';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';

function buildArchitectureFreeze(runId: string): ArchitectureFreeze {
  return {
    runId,
    summary: 'Freeze service boundaries.',
    moduleDefinitions: [
      {
        moduleId: 'orchestrator',
        name: 'orchestrator',
        responsibility: 'Coordinate run state.',
        ownedPaths: ['apps/orchestrator/src'],
        publicInterfaces: ['createOrchestratorService'],
        allowedDependencies: ['shared-contracts'],
      },
    ],
    dependencyRules: [
      {
        fromModuleId: 'orchestrator',
        toModuleId: 'shared-contracts',
        rule: 'allow',
        rationale: 'Reuse shared contracts.',
      },
    ],
    invariants: ['No direct bridge implementation dependencies.'],
    frozenAt: '2026-04-09T00:00:00.000Z',
    frozenBy: 'unit-test',
  };
}

function buildReviewTask(): TaskEnvelope {
  return {
    taskId: TASK_ID,
    runId: RUN_ID,
    title: 'Review task',
    objective: 'Verify review-gate evidence loading.',
    executorType: 'codex',
    scope: {
      inScope: ['apps/orchestrator/src/**'],
      outOfScope: ['services/**'],
    },
    allowedFiles: ['apps/orchestrator/src/**'],
    disallowedFiles: ['services/**'],
    dependencies: [],
    acceptanceCriteria: [],
    testPlan: [],
    implementationNotes: [],
    evidenceIds: [],
    metadata: {},
    status: 'review_pending',
    createdAt: '2026-04-09T00:00:00.000Z',
    updatedAt: '2026-04-09T00:00:00.000Z',
  };
}

function createService() {
  const runRepository = {
    getRun: vi.fn(async () => ({
      runId: RUN_ID,
      title: 'Unit test run',
      summary: 'Exercise evaluateGate loading.',
      stage: 'task_execution',
      createdBy: 'unit-test',
      createdAt: '2026-04-09T00:00:00.000Z',
      updatedAt: '2026-04-09T00:00:00.000Z',
      requirementFreezePath: undefined,
      architectureFreezePath: undefined,
      taskGraphPath: undefined,
      metadata: {},
    })),
    getRequirementFreeze: vi.fn(async () => null),
    getArchitectureFreeze: vi.fn(async () => buildArchitectureFreeze(RUN_ID)),
    saveRun: vi.fn(),
  };
  const taskRepository = {
    getTask: vi.fn(async () => buildReviewTask()),
    listTasks: vi.fn(async () => [buildReviewTask()]),
  };
  const evidenceRepository = {
    listEvidenceForRun: vi.fn(async () => [
      {
        evidenceId: '33333333-3333-4333-8333-333333333333',
        kind: 'review_result',
        metadata: { reviewStatus: 'approved' },
      },
    ]),
    listEvidenceForTask: vi.fn(async () => [
      {
        evidenceId: '44444444-4444-4444-8444-444444444444',
        kind: 'review_result',
        metadata: { reviewStatus: 'approved' },
      },
    ]),
    appendGateResult: vi.fn(async () => '/tmp/gate-result.json'),
  };
  const evidenceLedgerService = {
    appendEvidence: vi.fn(async (input) => ({
      evidenceId: '55555555-5555-4555-8555-555555555555',
      ...input,
    })),
  };
  const taskLoopService = {
    rollbackAfterAcceptanceFailure: vi.fn(),
  };
  const service = new OrchestratorService(
    runRepository as never,
    taskRepository as never,
    evidenceRepository as never,
    {} as never,
    {} as never,
    {} as never,
    taskLoopService as never,
    evidenceLedgerService as never,
    new GateEvaluator(),
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  return {
    service,
    runRepository,
    taskRepository,
    evidenceRepository,
    evidenceLedgerService,
  };
}

describe('OrchestratorService.evaluateGate', () => {
  it('skips evidence scans for architecture gate evaluation', async () => {
    const { service, runRepository, taskRepository, evidenceRepository, evidenceLedgerService } =
      createService();

    const result = await service.evaluateGate({
      runId: RUN_ID,
      gateType: 'architecture_gate',
      evaluator: 'unit-test',
    });

    expect(runRepository.getArchitectureFreeze).toHaveBeenCalledWith(RUN_ID);
    expect(runRepository.getRequirementFreeze).not.toHaveBeenCalled();
    expect(taskRepository.getTask).not.toHaveBeenCalled();
    expect(taskRepository.listTasks).not.toHaveBeenCalled();
    expect(evidenceRepository.listEvidenceForRun).not.toHaveBeenCalled();
    expect(evidenceRepository.listEvidenceForTask).not.toHaveBeenCalled();
    expect(evidenceRepository.appendGateResult).toHaveBeenCalledTimes(1);
    expect(evidenceLedgerService.appendEvidence).toHaveBeenCalledTimes(1);
    expect(result.passed).toBe(true);
    expect(result.evidenceIds).toEqual([]);
  });

  it('still loads task-scoped evidence for review gate evaluation', async () => {
    const { service, runRepository, taskRepository, evidenceRepository } = createService();

    const result = await service.evaluateGate({
      runId: RUN_ID,
      taskId: TASK_ID,
      gateType: 'review_gate',
      evaluator: 'unit-test',
    });

    expect(runRepository.getRequirementFreeze).not.toHaveBeenCalled();
    expect(runRepository.getArchitectureFreeze).not.toHaveBeenCalled();
    expect(taskRepository.getTask).toHaveBeenCalledWith(RUN_ID, TASK_ID);
    expect(evidenceRepository.listEvidenceForTask).toHaveBeenCalledWith(RUN_ID, TASK_ID);
    expect(evidenceRepository.listEvidenceForRun).not.toHaveBeenCalled();
    expect(result.passed).toBe(true);
    expect(result.evidenceIds).toEqual(['44444444-4444-4444-8444-444444444444']);
  });
});
