import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createRunRecord } from '../../src/domain/run';
import { FileEvidenceRepository } from '../../src/storage/file-evidence-repository';
import { EvidenceLedgerService } from '../../src/services/evidence-ledger-service';
import { ReleaseGateService } from '../../src/services/release-gate-service';
import { createArtifactDir } from '../helpers/runtime-fixtures';

describe('ReleaseGateService', () => {
  it.each([
    ['approved', true],
    ['changes_requested', false],
    ['rejected', false],
    ['incomplete', false],
  ] as const)('maps %s to release gate pass=%s', async (status, expected) => {
    const artifactDir = await createArtifactDir('release-gate-service-');
    const run = createRunRecord({
      title: 'Release gate run',
      createdBy: 'tester',
      stage: 'release_review',
    });
    const service = new ReleaseGateService(
      new FileEvidenceRepository(artifactDir),
      new EvidenceLedgerService(new FileEvidenceRepository(artifactDir)),
    );

    const gate = await service.recordReleaseGate({
      run,
      evaluator: 'tester',
      reviewResult: {
        releaseReviewId: randomUUID(),
        runId: run.runId,
        status,
        summary: `status=${status}`,
        findings: [],
        outstandingLimitations: [],
        recommendedActions: [],
        bridgeArtifacts: {},
        rawStructuredReview: null,
        metadata: {},
        timestamp: '2026-04-02T15:13:00.000Z',
      },
    });

    expect(gate.passed).toBe(expected);
    expect(gate.gateType).toBe('release_gate');
  });
});
