import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { FileWorkspaceLifecycleRepository } from '../../src/storage/file-workspace-lifecycle-repository';
import { FileWorkspaceRepository } from '../../src/storage/file-workspace-repository';
import { RetainedWorkspaceService } from '../../src/services/retained-workspace-service';

describe('RetainedWorkspaceService', () => {
  it('returns the newest retained workspace for a task', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'retained-workspace-'));
    const workspaceRepository = new FileWorkspaceRepository(artifactDir);
    const lifecycleRepository = new FileWorkspaceLifecycleRepository(artifactDir);
    const service = new RetainedWorkspaceService(lifecycleRepository, workspaceRepository);
    const runId = '11111111-1111-1111-1111-111111111111';
    const taskId = '22222222-2222-2222-2222-222222222222';

    await workspaceRepository.saveWorkspace({
      workspaceId: '33333333-3333-3333-3333-333333333333',
      runId,
      taskId,
      executorType: 'codex',
      baseRepoPath: '/tmp/repo',
      workspacePath: '/tmp/repo/workspaces/old',
      mode: 'directory',
      baseCommit: 'abc123',
      status: 'prepared',
      preparedAt: '2026-04-02T20:30:00.000Z',
      updatedAt: '2026-04-02T20:30:00.000Z',
      metadata: {},
    });
    await lifecycleRepository.saveLifecycle({
      workspaceId: '33333333-3333-3333-3333-333333333333',
      runId,
      taskId,
      workspacePath: '/tmp/repo/workspaces/old',
      status: 'retained',
      createdAt: '2026-04-02T20:30:00.000Z',
      lastUsedAt: '2026-04-02T20:30:00.000Z',
      retentionReason: 'failed_execution',
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

    await workspaceRepository.saveWorkspace({
      workspaceId: '44444444-4444-4444-4444-444444444444',
      runId,
      taskId,
      executorType: 'codex',
      baseRepoPath: '/tmp/repo',
      workspacePath: '/tmp/repo/workspaces/new',
      mode: 'directory',
      baseCommit: 'def456',
      status: 'prepared',
      preparedAt: '2026-04-02T20:31:00.000Z',
      updatedAt: '2026-04-02T20:31:00.000Z',
      metadata: {},
    });
    await lifecycleRepository.saveLifecycle({
      workspaceId: '44444444-4444-4444-4444-444444444444',
      runId,
      taskId,
      workspacePath: '/tmp/repo/workspaces/new',
      status: 'retained',
      createdAt: '2026-04-02T20:31:00.000Z',
      lastUsedAt: '2026-04-02T20:31:00.000Z',
      retentionReason: 'review_rejected',
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

    await expect(service.findReusableWorkspace(runId, taskId)).resolves.toMatchObject({
      workspaceId: '44444444-4444-4444-4444-444444444444',
      workspacePath: '/tmp/repo/workspaces/new',
    });
  });
});
