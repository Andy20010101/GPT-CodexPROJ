import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { EvidenceLedgerService } from '../../src/services/evidence-ledger-service';
import { FileEvidenceRepository } from '../../src/storage/file-evidence-repository';

describe('EvidenceLedgerService', () => {
  it('writes evidence manifests and summarizes them by kind and task', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-evidence-'));
    const service = new EvidenceLedgerService(new FileEvidenceRepository(artifactDir));
    const runId = '11111111-1111-4111-8111-111111111111';
    const taskId = '22222222-2222-4222-8222-222222222222';

    await service.appendEvidence({
      runId,
      taskId,
      stage: 'task_execution',
      kind: 'test_report',
      timestamp: '2026-04-01T12:00:00.000Z',
      producer: 'tester',
      artifactPaths: ['artifacts/tests.txt'],
      summary: 'Unit tests failed as expected',
      metadata: {},
    });
    await service.appendEvidence({
      runId,
      taskId,
      stage: 'task_execution',
      kind: 'review_note',
      timestamp: '2026-04-01T12:01:00.000Z',
      producer: 'reviewer',
      artifactPaths: ['artifacts/review.md'],
      summary: 'Review issued',
      metadata: {},
    });

    const evidence = await service.listEvidenceForTask(runId, taskId);
    const summary = await service.summarizeRunEvidence(runId);

    expect(evidence).toHaveLength(2);
    expect(summary.total).toBe(2);
    expect(summary.byKind.test_report).toBe(1);
    expect(summary.byKind.review_note).toBe(1);
    expect(summary.taskCounts[taskId]).toBe(2);
  });
});
