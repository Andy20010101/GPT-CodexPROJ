import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createRunRecord } from '../../src/domain/run';
import { FileEvidenceRepository } from '../../src/storage/file-evidence-repository';
import { FileRollbackRepository } from '../../src/storage/file-rollback-repository';
import { FileRunRepository } from '../../src/storage/file-run-repository';
import { EvidenceLedgerService } from '../../src/services/evidence-ledger-service';
import { RollbackService } from '../../src/services/rollback-service';

describe('RollbackService', () => {
  it('creates a rollback plan and persists rollback evidence', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rollback-service-'));
    const runRepository = new FileRunRepository(artifactDir);
    const rollbackRepository = new FileRollbackRepository(artifactDir);
    const evidenceRepository = new FileEvidenceRepository(artifactDir);
    const run = createRunRecord({
      title: 'Rollback run',
      createdBy: 'tester',
      stage: 'task_execution',
    });
    await runRepository.saveRun(run);

    const taskId = randomUUID();
    const executionId = randomUUID();
    const workspaceId = randomUUID();
    const service = new RollbackService(
      runRepository,
      rollbackRepository,
      new EvidenceLedgerService(evidenceRepository),
    );

    const record = await service.plan({
      runId: run.runId,
      taskId,
      executionResult: {
        executionId,
        runId: run.runId,
        taskId,
        executorType: 'codex',
        status: 'failed',
        startedAt: '2026-04-02T21:00:00.000Z',
        finishedAt: '2026-04-02T21:01:00.000Z',
        summary: 'Execution failed.',
        patchSummary: {
          changedFiles: ['apps/orchestrator/src/services/example.ts'],
          addedLines: 10,
          removedLines: 2,
          notes: ['Rollback should capture the changed files.'],
        },
        testResults: [],
        artifacts: [],
        stdout: '',
        stderr: 'failure',
        exitCode: 1,
        metadata: {},
      },
      workspace: {
        workspaceId,
        runId: run.runId,
        taskId,
        executionId,
        executorType: 'codex',
        baseRepoPath: '/tmp/repo',
        workspacePath: '/tmp/repo/workspaces/rollback',
        mode: 'directory',
        baseCommit: 'abc123',
        status: 'prepared',
        preparedAt: '2026-04-02T21:00:00.000Z',
        updatedAt: '2026-04-02T21:01:00.000Z',
        metadata: {},
      },
      reason: 'Execution failed and requires rollback planning.',
    });

    expect(record.strategy).toBe('workspace_cleanup');
    expect(record.planSteps.length).toBeGreaterThan(0);
    await expect(rollbackRepository.getRecord(record.rollbackId)).resolves.toMatchObject({
      rollbackId: record.rollbackId,
    });
    await expect(evidenceRepository.listEvidenceForRun(run.runId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'rollback_record',
        }),
      ]),
    );
  });
});
