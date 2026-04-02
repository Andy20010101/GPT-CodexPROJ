import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type {
  ArchitectureFreeze,
  GateResult,
  RequirementFreeze,
  TaskEnvelope,
  TaskGraph,
} from '../../src/contracts';
import { createOrchestratorService } from '../../src';
import { FileEvidenceRepository } from '../../src/storage/file-evidence-repository';
import { FileRunRepository } from '../../src/storage/file-run-repository';
import { FileTaskRepository } from '../../src/storage/file-task-repository';
import { ArchitectureFreezeService } from '../../src/services/architecture-freeze-service';
import { EvidenceLedgerService } from '../../src/services/evidence-ledger-service';
import { GateEvaluator } from '../../src/services/gate-evaluator';
import { RequirementFreezeService } from '../../src/services/requirement-freeze-service';
import { TaskGraphService } from '../../src/services/task-graph-service';
import { TaskLoopService } from '../../src/services/task-loop-service';
import { OrchestratorError } from '../../src/utils/error';

function buildRequirementFreeze(runId: string): RequirementFreeze {
  return {
    runId,
    title: 'Requirement freeze',
    summary: 'Lock the requirements',
    objectives: ['Build task loop'],
    nonGoals: [],
    constraints: [],
    risks: [],
    acceptanceCriteria: [
      {
        id: 'ac-1',
        description: 'Task loop persists transitions',
        verificationMethod: 'automated_test',
        requiredEvidenceKinds: ['test_report'],
      },
    ],
    frozenAt: '2026-04-01T12:00:00.000Z',
    frozenBy: 'architect',
  };
}

function buildArchitectureFreeze(runId: string): ArchitectureFreeze {
  return {
    runId,
    summary: 'Freeze modules',
    moduleDefinitions: [
      {
        moduleId: 'orchestrator',
        name: 'orchestrator',
        responsibility: 'Control plane',
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
        rationale: 'Use chatgpt bridge contracts',
      },
    ],
    invariants: ['No browser code'],
    frozenAt: '2026-04-01T12:05:00.000Z',
    frozenBy: 'architect',
  };
}

function buildTask(runId: string): TaskEnvelope {
  return {
    taskId: randomUUID(),
    runId,
    title: 'Persist task loop',
    objective: 'Track task status on disk',
    scope: {
      inScope: ['apps/orchestrator/src/services'],
      outOfScope: ['services/chatgpt-web-bridge'],
    },
    allowedFiles: ['apps/orchestrator/src/services/**'],
    disallowedFiles: ['services/chatgpt-web-bridge/**'],
    dependencies: [],
    acceptanceCriteria: [
      {
        id: 'ac-1',
        description: 'Status is persisted',
        verificationMethod: 'automated_test',
        requiredEvidenceKinds: ['test_report'],
      },
    ],
    testPlan: [],
    implementationNotes: [],
    evidenceIds: [],
    metadata: {},
    status: 'drafted',
    createdAt: '2026-04-01T12:06:00.000Z',
    updatedAt: '2026-04-01T12:06:00.000Z',
  };
}

async function appendGate(
  evidenceRepository: FileEvidenceRepository,
  gate: GateResult,
): Promise<void> {
  await evidenceRepository.appendGateResult(gate);
}

describe('TaskLoopService', () => {
  it('requires architecture gate before tests can go red and requires red gate before implementation', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-task-loop-'));
    const runRepository = new FileRunRepository(artifactDir);
    const taskRepository = new FileTaskRepository(artifactDir);
    const evidenceRepository = new FileEvidenceRepository(artifactDir);
    const evidenceLedgerService = new EvidenceLedgerService(evidenceRepository);
    const requirementFreezeService = new RequirementFreezeService(
      runRepository,
      evidenceLedgerService,
    );
    const architectureFreezeService = new ArchitectureFreezeService(
      runRepository,
      evidenceLedgerService,
    );
    const taskGraphService = new TaskGraphService(
      runRepository,
      taskRepository,
      evidenceLedgerService,
    );
    const taskLoopService = new TaskLoopService(runRepository, taskRepository, evidenceRepository);
    const gateEvaluator = new GateEvaluator();
    const orchestrator = createOrchestratorService(artifactDir);

    const run = await orchestrator.createRun({
      title: 'Task loop run',
      createdBy: 'tester',
    });
    await requirementFreezeService.freeze(run.runId, buildRequirementFreeze(run.runId));
    const frozenRun = await architectureFreezeService.freeze(
      run.runId,
      buildArchitectureFreeze(run.runId),
    );
    const task = buildTask(run.runId);
    const graph: TaskGraph = {
      runId: run.runId,
      tasks: [task],
      edges: [],
      registeredAt: '2026-04-01T12:07:00.000Z',
    };
    await taskGraphService.registerTaskGraph(run.runId, graph);
    await taskLoopService.attachTestPlan(run.runId, task.taskId, [
      {
        id: 'plan-1',
        description: 'Red test first',
        expectedRedSignal: 'test fails',
        expectedGreenSignal: 'test passes',
      },
    ]);

    await expect(taskLoopService.markTestsRed(run.runId, task.taskId)).rejects.toThrowError(
      OrchestratorError,
    );

    const architectureGate = gateEvaluator.evaluate({
      run: frozenRun,
      gateType: 'architecture_gate',
      evaluator: 'tester',
      evidence: [],
      architectureFreeze: buildArchitectureFreeze(run.runId),
      requirementFreeze: buildRequirementFreeze(run.runId),
    });
    await appendGate(evidenceRepository, architectureGate);

    await taskLoopService.markTestsRed(run.runId, task.taskId);
    await expect(
      taskLoopService.markImplementationStarted(run.runId, task.taskId),
    ).rejects.toThrowError(OrchestratorError);

    const redTask = await taskRepository.getTask(run.runId, task.taskId);
    const redGate = gateEvaluator.evaluate({
      run: await runRepository.getRun(run.runId),
      gateType: 'red_test_gate',
      evaluator: 'tester',
      task: redTask,
      evidence: [],
    });
    await appendGate(evidenceRepository, redGate);

    const implementationTask = await taskLoopService.markImplementationStarted(
      run.runId,
      task.taskId,
    );
    expect(implementationTask.status).toBe('implementation_in_progress');
  });

  it('blocks acceptance when review gate is missing', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-task-loop-review-'));
    const orchestrator = createOrchestratorService(artifactDir);
    const run = await orchestrator.createRun({
      title: 'Review gate run',
      createdBy: 'tester',
    });
    await orchestrator.saveRequirementFreeze(run.runId, buildRequirementFreeze(run.runId));
    await orchestrator.saveArchitectureFreeze(run.runId, buildArchitectureFreeze(run.runId));

    const task = buildTask(run.runId);
    await orchestrator.registerTaskGraph(run.runId, {
      runId: run.runId,
      tasks: [task],
      edges: [],
      registeredAt: '2026-04-01T12:07:00.000Z',
    });

    const evidenceRepository = new FileEvidenceRepository(artifactDir);
    const gateEvaluator = new GateEvaluator();
    const currentRun = await new FileRunRepository(artifactDir).getRun(run.runId);

    await orchestrator.attachTestPlan(run.runId, task.taskId, [
      {
        id: 'plan-1',
        description: 'Red test first',
        expectedRedSignal: 'red',
        expectedGreenSignal: 'green',
      },
    ]);

    const architectureGate = gateEvaluator.evaluate({
      run: currentRun,
      gateType: 'architecture_gate',
      evaluator: 'tester',
      evidence: [],
      architectureFreeze: buildArchitectureFreeze(run.runId),
      requirementFreeze: buildRequirementFreeze(run.runId),
    });
    await evidenceRepository.appendGateResult(architectureGate);
    await orchestrator.markTestsRed(run.runId, task.taskId);

    const redGate = gateEvaluator.evaluate({
      run: await new FileRunRepository(artifactDir).getRun(run.runId),
      gateType: 'red_test_gate',
      evaluator: 'tester',
      evidence: [],
      task: await new FileTaskRepository(artifactDir).getTask(run.runId, task.taskId),
    });
    await evidenceRepository.appendGateResult(redGate);

    await orchestrator.markImplementationStarted(run.runId, task.taskId);
    await orchestrator.markTestsGreen(run.runId, task.taskId);
    await orchestrator.submitForReview(run.runId, task.taskId);

    await expect(orchestrator.acceptTask(run.runId, task.taskId)).rejects.toThrowError(
      OrchestratorError,
    );
  });
});
