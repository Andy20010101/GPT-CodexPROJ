import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createRunRecord } from '../../src/domain/run';
import { FileEvidenceRepository } from '../../src/storage/file-evidence-repository';
import { FileProcessRepository } from '../../src/storage/file-process-repository';
import { FileRunRepository } from '../../src/storage/file-run-repository';
import { FileStabilityRepository } from '../../src/storage/file-stability-repository';
import { FileWorkspaceLifecycleRepository } from '../../src/storage/file-workspace-lifecycle-repository';
import { FileWorkspaceRepository } from '../../src/storage/file-workspace-repository';
import { EvidenceLedgerService } from '../../src/services/evidence-ledger-service';
import { RetainedWorkspaceService } from '../../src/services/retained-workspace-service';
import { RunnerResumeService } from '../../src/services/runner-resume-service';

describe('RunnerResumeService', () => {
  it('returns can_resume when a retained workspace is available', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'runner-resume-'));
    const runRepository = new FileRunRepository(artifactDir);
    const processRepository = new FileProcessRepository(artifactDir);
    const stabilityRepository = new FileStabilityRepository(artifactDir);
    const workspaceLifecycleRepository = new FileWorkspaceLifecycleRepository(artifactDir);
    const workspaceRepository = new FileWorkspaceRepository(artifactDir);
    const run = createRunRecord({
      title: 'Resume run',
      createdBy: 'tester',
      stage: 'task_execution',
    });
    await runRepository.saveRun(run);

    const taskId = randomUUID();
    const jobId = randomUUID();
    const workspaceId = randomUUID();
    await workspaceRepository.saveWorkspace({
      workspaceId,
      runId: run.runId,
      taskId,
      executorType: 'codex',
      baseRepoPath: '/tmp/repo',
      workspacePath: '/tmp/repo/workspaces/resume',
      mode: 'directory',
      baseCommit: 'abc123',
      status: 'prepared',
      preparedAt: '2026-04-02T20:40:00.000Z',
      updatedAt: '2026-04-02T20:40:00.000Z',
      metadata: {},
    });
    await workspaceLifecycleRepository.saveLifecycle({
      workspaceId,
      runId: run.runId,
      taskId,
      workspacePath: '/tmp/repo/workspaces/resume',
      status: 'retained',
      createdAt: '2026-04-02T20:40:00.000Z',
      lastUsedAt: '2026-04-02T20:41:00.000Z',
      retentionReason: 'debug',
      cleanupPolicySnapshot: {
        ttlMs: 3_600_000,
        retainOnFailure: true,
        retainOnRejectedReview: true,
        retainOnDebug: true,
        maxRetainedPerRun: 2,
        cleanupMode: 'delayed',
      },
      metadata: {},
    });

    const service = new RunnerResumeService(
      runRepository,
      processRepository,
      stabilityRepository,
      new EvidenceLedgerService(new FileEvidenceRepository(artifactDir)),
      new RetainedWorkspaceService(workspaceLifecycleRepository, workspaceRepository),
    );

    const state = await service.assess({
      job: {
        jobId,
        runId: run.runId,
        taskId,
        kind: 'task_execution',
        status: 'running',
        attempt: 1,
        maxAttempts: 3,
        priority: 'normal',
        createdAt: '2026-04-02T20:42:00.000Z',
        metadata: {},
        relatedEvidenceIds: [],
      },
      taskId,
    });

    expect(state.decision).toBe('can_resume');
    expect(state.metadata).toMatchObject({
      reusableWorkspaceId: workspaceId,
    });
  });

  it('returns requires_manual_attention when a process exists without resume support', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'runner-resume-manual-'));
    const runRepository = new FileRunRepository(artifactDir);
    const processRepository = new FileProcessRepository(artifactDir);
    const stabilityRepository = new FileStabilityRepository(artifactDir);
    const workspaceLifecycleRepository = new FileWorkspaceLifecycleRepository(artifactDir);
    const workspaceRepository = new FileWorkspaceRepository(artifactDir);
    const run = createRunRecord({
      title: 'Resume run',
      createdBy: 'tester',
      stage: 'task_execution',
    });
    await runRepository.saveRun(run);

    const taskId = randomUUID();
    const jobId = randomUUID();
    const processHandleId = randomUUID();
    await processRepository.saveProcessHandle({
      processHandleId,
      runId: run.runId,
      taskId,
      jobId,
      workspacePath: '/tmp/repo/workspaces/process',
      command: 'codex',
      args: ['exec'],
      pid: 1234,
      status: 'running',
      startedAt: '2026-04-02T20:50:00.000Z',
      metadata: {},
    });

    const service = new RunnerResumeService(
      runRepository,
      processRepository,
      stabilityRepository,
      new EvidenceLedgerService(new FileEvidenceRepository(artifactDir)),
      new RetainedWorkspaceService(workspaceLifecycleRepository, workspaceRepository),
    );

    const state = await service.assess({
      job: {
        jobId,
        runId: run.runId,
        taskId,
        kind: 'task_execution',
        status: 'running',
        attempt: 1,
        maxAttempts: 3,
        priority: 'normal',
        createdAt: '2026-04-02T20:51:00.000Z',
        metadata: {},
        relatedEvidenceIds: [],
      },
      taskId,
    });

    expect(state.decision).toBe('requires_manual_attention');
    expect(state.processHandleId).toBe(processHandleId);
  });
});
