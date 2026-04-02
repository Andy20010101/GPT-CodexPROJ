import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { ReviewResult, TaskEnvelope } from '../../src/contracts';
import { createRunRecord } from '../../src/domain/run';
import { EvidenceLedgerService } from '../../src/services/evidence-ledger-service';
import { ReviewGateService } from '../../src/services/review-gate-service';
import { TaskLoopService } from '../../src/services/task-loop-service';
import { FileEvidenceRepository } from '../../src/storage/file-evidence-repository';
import { FileRunRepository } from '../../src/storage/file-run-repository';
import { FileTaskRepository } from '../../src/storage/file-task-repository';

function buildTask(runId: string): TaskEnvelope {
  return {
    taskId: randomUUID(),
    runId,
    title: 'Reviewable task',
    objective: 'Handle review outcomes',
    executorType: 'codex',
    scope: {
      inScope: ['apps/orchestrator/src/services'],
      outOfScope: [],
    },
    allowedFiles: ['apps/orchestrator/src/services/**'],
    disallowedFiles: [],
    dependencies: [],
    acceptanceCriteria: [
      {
        id: 'ac-1',
        description: 'Review gate must be structured',
        verificationMethod: 'review',
        requiredEvidenceKinds: ['review_result'],
      },
    ],
    testPlan: [],
    implementationNotes: [],
    evidenceIds: [],
    metadata: {},
    status: 'review_pending',
    createdAt: '2026-04-02T10:00:00.000Z',
    updatedAt: '2026-04-02T10:00:00.000Z',
  };
}

function buildReviewResult(
  runId: string,
  taskId: string,
  status: ReviewResult['status'],
): ReviewResult {
  return {
    reviewId: randomUUID(),
    runId,
    taskId,
    executionId: randomUUID(),
    status,
    summary: `Review ${status}`,
    findings: status === 'changes_requested' ? ['Fix the implementation.'] : [],
    missingTests: [],
    architectureConcerns: [],
    recommendedActions: status === 'changes_requested' ? ['Address review comments.'] : [],
    bridgeArtifacts: {},
    rawStructuredReview: {
      status,
    },
    metadata: {},
    timestamp: '2026-04-02T10:02:00.000Z',
  };
}

describe('ReviewGateService', () => {
  it('maps approved reviews to a passing review gate', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'review-gate-approved-'));
    const runRepository = new FileRunRepository(artifactDir);
    const taskRepository = new FileTaskRepository(artifactDir);
    const evidenceRepository = new FileEvidenceRepository(artifactDir);
    const run = createRunRecord({
      title: 'Review gate run',
      createdBy: 'tester',
      stage: 'task_execution',
    });
    await runRepository.createRun(run);
    const task = buildTask(run.runId);
    await taskRepository.saveTask(task);
    const service = new ReviewGateService(
      evidenceRepository,
      new EvidenceLedgerService(evidenceRepository),
      new TaskLoopService(runRepository, taskRepository, evidenceRepository),
    );

    const outcome = await service.recordTaskReviewGate({
      run,
      task,
      reviewResult: buildReviewResult(run.runId, task.taskId, 'approved'),
      evaluator: 'reviewer',
    });

    expect(outcome.gateResult.passed).toBe(true);
    expect(outcome.task.status).toBe('review_pending');
  });

  it('maps changes_requested to a failed gate and returns the task to implementation', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'review-gate-changes-'));
    const runRepository = new FileRunRepository(artifactDir);
    const taskRepository = new FileTaskRepository(artifactDir);
    const evidenceRepository = new FileEvidenceRepository(artifactDir);
    const run = createRunRecord({
      title: 'Review gate run',
      createdBy: 'tester',
      stage: 'task_execution',
    });
    await runRepository.createRun(run);
    const task = buildTask(run.runId);
    await taskRepository.saveTask(task);
    const service = new ReviewGateService(
      evidenceRepository,
      new EvidenceLedgerService(evidenceRepository),
      new TaskLoopService(runRepository, taskRepository, evidenceRepository),
    );

    const outcome = await service.recordTaskReviewGate({
      run,
      task,
      reviewResult: buildReviewResult(run.runId, task.taskId, 'changes_requested'),
      evaluator: 'reviewer',
    });

    expect(outcome.gateResult.passed).toBe(false);
    expect(outcome.task.status).toBe('implementation_in_progress');
  });

  it('maps rejected reviews to a rejected task and maps incomplete to a retryable failure', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'review-gate-rejected-'));
    const runRepository = new FileRunRepository(artifactDir);
    const taskRepository = new FileTaskRepository(artifactDir);
    const evidenceRepository = new FileEvidenceRepository(artifactDir);
    const run = createRunRecord({
      title: 'Review gate run',
      createdBy: 'tester',
      stage: 'task_execution',
    });
    await runRepository.createRun(run);
    const rejectedTask = buildTask(run.runId);
    const incompleteTask = buildTask(run.runId);
    await taskRepository.saveTask(rejectedTask);
    await taskRepository.saveTask(incompleteTask);
    const service = new ReviewGateService(
      evidenceRepository,
      new EvidenceLedgerService(evidenceRepository),
      new TaskLoopService(runRepository, taskRepository, evidenceRepository),
    );

    const rejected = await service.recordTaskReviewGate({
      run,
      task: rejectedTask,
      reviewResult: buildReviewResult(run.runId, rejectedTask.taskId, 'rejected'),
      evaluator: 'reviewer',
    });
    const incomplete = await service.recordTaskReviewGate({
      run,
      task: incompleteTask,
      reviewResult: buildReviewResult(run.runId, incompleteTask.taskId, 'incomplete'),
      evaluator: 'reviewer',
    });

    expect(rejected.gateResult.passed).toBe(false);
    expect(rejected.task.status).toBe('rejected');
    expect(incomplete.gateResult.passed).toBe(false);
    expect(incomplete.task.status).toBe('review_pending');
  });
});
