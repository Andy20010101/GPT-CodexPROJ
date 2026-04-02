import { randomUUID } from 'node:crypto';

import {
  GateResultSchema,
  type GateResult,
  type ReviewResult,
  type TaskEnvelope,
} from '../contracts';
import type { RunRecord } from '../domain/run';
import { FileEvidenceRepository } from '../storage/file-evidence-repository';
import { EvidenceLedgerService } from './evidence-ledger-service';
import { TaskLoopService } from './task-loop-service';

export class ReviewGateService {
  public constructor(
    private readonly evidenceRepository: FileEvidenceRepository,
    private readonly evidenceLedgerService: EvidenceLedgerService,
    private readonly taskLoopService: TaskLoopService,
  ) {}

  public async recordTaskReviewGate(input: {
    run: RunRecord;
    task: TaskEnvelope;
    reviewResult: ReviewResult;
    evaluator: string;
  }): Promise<{ gateResult: GateResult; task: TaskEnvelope }> {
    const gateResult = GateResultSchema.parse({
      gateId: randomUUID(),
      runId: input.run.runId,
      taskId: input.task.taskId,
      gateType: 'review_gate',
      stage: input.run.stage,
      passed: input.reviewResult.status === 'approved',
      timestamp: input.reviewResult.timestamp,
      evaluator: input.evaluator,
      reasons: buildReasons(input.reviewResult),
      evidenceIds: [],
      metadata: {
        source: 'review-gate-service',
        reviewId: input.reviewResult.reviewId,
        reviewStatus: input.reviewResult.status,
      },
    });
    const gateArtifactPath = await this.evidenceRepository.appendGateResult(gateResult);
    await this.evidenceLedgerService.appendEvidence({
      runId: input.run.runId,
      taskId: input.task.taskId,
      stage: input.run.stage,
      kind: 'gate_result',
      timestamp: gateResult.timestamp,
      producer: input.evaluator,
      artifactPaths: [gateArtifactPath],
      summary: `review_gate ${gateResult.passed ? 'passed' : 'failed'} from ${input.reviewResult.status}`,
      metadata: {
        gateId: gateResult.gateId,
        reviewId: input.reviewResult.reviewId,
        reviewStatus: input.reviewResult.status,
      },
    });

    const task = await this.applyReviewOutcome(input.task, input.reviewResult);
    return {
      gateResult,
      task,
    };
  }

  private async applyReviewOutcome(
    task: TaskEnvelope,
    reviewResult: ReviewResult,
  ): Promise<TaskEnvelope> {
    switch (reviewResult.status) {
      case 'approved':
        return task;
      case 'changes_requested':
        return this.taskLoopService.reopenImplementationAfterReview(task.runId, task.taskId, [
          `Review ${reviewResult.reviewId} requested changes.`,
          ...reviewResult.recommendedActions,
        ]);
      case 'rejected':
        return this.taskLoopService.rejectTask(task.runId, task.taskId);
      case 'incomplete':
      default:
        return task;
    }
  }
}

function buildReasons(reviewResult: ReviewResult): string[] {
  if (reviewResult.status === 'approved') {
    return [];
  }

  return [
    reviewResult.summary,
    ...reviewResult.findings,
    ...reviewResult.missingTests,
    ...reviewResult.architectureConcerns,
  ].filter((item) => item.length > 0);
}
