import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createRunRecord } from '../../src/domain/run';
import { FileDebugSnapshotRepository } from '../../src/storage/file-debug-snapshot-repository';
import { FileEvidenceRepository } from '../../src/storage/file-evidence-repository';
import { FileRunRepository } from '../../src/storage/file-run-repository';
import { DebugSnapshotService } from '../../src/services/debug-snapshot-service';
import { EvidenceLedgerService } from '../../src/services/evidence-ledger-service';

describe('DebugSnapshotService', () => {
  it('captures a structured debug snapshot with retention metadata', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'debug-snapshot-'));
    const runRepository = new FileRunRepository(artifactDir);
    const snapshotRepository = new FileDebugSnapshotRepository(artifactDir);
    const evidenceRepository = new FileEvidenceRepository(artifactDir);
    const run = createRunRecord({
      title: 'Snapshot run',
      createdBy: 'tester',
      stage: 'task_execution',
    });
    await runRepository.saveRun(run);

    const taskId = randomUUID();
    const executionId = randomUUID();
    const service = new DebugSnapshotService(
      runRepository,
      snapshotRepository,
      new EvidenceLedgerService(evidenceRepository),
      {
        ttlMs: 3_600_000,
        retainOnFailure: true,
        retainOnRejectedReview: true,
        retainOnDebug: true,
        maxRetainedPerRun: 2,
        cleanupMode: 'delayed',
      },
    );

    const snapshot = await service.capture({
      runId: run.runId,
      taskId,
      reason: 'Execution failed during validation.',
      executionResult: {
        executionId,
        runId: run.runId,
        taskId,
        executorType: 'codex',
        status: 'failed',
        startedAt: '2026-04-02T21:10:00.000Z',
        finishedAt: '2026-04-02T21:11:00.000Z',
        summary: 'Validation execution failed.',
        patchSummary: {
          changedFiles: ['apps/orchestrator/src/services/e2e-validation-service.ts'],
          addedLines: 4,
          removedLines: 1,
          notes: ['Snapshot should keep a diff summary.'],
        },
        testResults: [
          {
            suite: 'vitest',
            status: 'failed',
            passed: 1,
            failed: 1,
            skipped: 0,
          },
        ],
        artifacts: [],
        stdout: 'test output',
        stderr: 'failure',
        exitCode: 1,
        metadata: {},
      },
      failure: {
        failureId: randomUUID(),
        runId: run.runId,
        taskId,
        source: 'runner',
        taxonomy: 'runner',
        code: 'RUNNER_FAILURE',
        message: 'Runner crashed.',
        retriable: false,
        timestamp: '2026-04-02T21:11:00.000Z',
        metadata: {},
      },
      logPaths: ['/tmp/stdout.log', '/tmp/stderr.log'],
    });

    expect(snapshot.diffSummary.changedFiles).toContain(
      'apps/orchestrator/src/services/e2e-validation-service.ts',
    );
    expect(snapshot.testSummary.failed).toBe(1);
    expect(snapshot.retentionExpiresAt).toBeTruthy();
    await expect(snapshotRepository.getSnapshot(snapshot.snapshotId)).resolves.toMatchObject({
      snapshotId: snapshot.snapshotId,
    });
    await expect(evidenceRepository.listEvidenceForRun(run.runId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'debug_snapshot',
        }),
      ]),
    );
  });
});
