import { randomUUID } from 'node:crypto';

import { GateResultSchema, type GateResult, type ReleaseReviewResult } from '../contracts';
import type { RunRecord } from '../domain/run';
import { FileEvidenceRepository } from '../storage/file-evidence-repository';
import { EvidenceLedgerService } from './evidence-ledger-service';

export class ReleaseGateService {
  public constructor(
    private readonly evidenceRepository: FileEvidenceRepository,
    private readonly evidenceLedgerService: EvidenceLedgerService,
  ) {}

  public async recordReleaseGate(input: {
    run: RunRecord;
    reviewResult: ReleaseReviewResult;
    evaluator: string;
  }): Promise<GateResult> {
    const gateResult = GateResultSchema.parse({
      gateId: randomUUID(),
      runId: input.run.runId,
      gateType: 'release_gate',
      stage: input.run.stage,
      passed: input.reviewResult.status === 'approved',
      timestamp: input.reviewResult.timestamp,
      evaluator: input.evaluator,
      reasons: buildReleaseReasons(input.reviewResult),
      evidenceIds: [],
      metadata: {
        source: 'release-gate-service',
        releaseReviewId: input.reviewResult.releaseReviewId,
        releaseStatus: input.reviewResult.status,
      },
    });
    const gateArtifactPath = await this.evidenceRepository.appendGateResult(gateResult);
    await this.evidenceLedgerService.appendEvidence({
      runId: input.run.runId,
      stage: input.run.stage,
      kind: 'gate_result',
      timestamp: gateResult.timestamp,
      producer: input.evaluator,
      artifactPaths: [gateArtifactPath],
      summary: `release_gate ${gateResult.passed ? 'passed' : 'failed'} from ${input.reviewResult.status}`,
      metadata: {
        gateId: gateResult.gateId,
        releaseReviewId: input.reviewResult.releaseReviewId,
        releaseStatus: input.reviewResult.status,
      },
    });
    return gateResult;
  }
}

function buildReleaseReasons(reviewResult: ReleaseReviewResult): string[] {
  if (reviewResult.status === 'approved') {
    return [];
  }

  return [
    reviewResult.summary,
    ...reviewResult.findings,
    ...reviewResult.outstandingLimitations,
    ...reviewResult.recommendedActions,
  ].filter((item) => item.length > 0);
}
