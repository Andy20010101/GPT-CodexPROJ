import fs from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  buildTask,
  bootstrapRuntimeBundle,
  createArtifactDir,
  createBridgeClient,
  FakeWorktreeService,
} from '../helpers/runtime-fixtures';

describe('WorkspaceCleanupService', () => {
  it('retains failed workspaces and cleans approved ones', async () => {
    const artifactDir = await createArtifactDir('workspace-cleanup-');
    const task = buildTask('00000000-0000-4000-8000-000000000104');
    const { bundle, runId } = await bootstrapRuntimeBundle({
      artifactDir,
      tasks: [task],
      bridgeClient: createBridgeClient(),
    });

    const runtime = await bundle.orchestratorService.prepareWorkspaceRuntime({
      runId,
      taskId: task.taskId,
      baseRepoPath: artifactDir,
    });
    await bundle.workspaceCleanupService.registerWorkspace({ workspace: runtime });
    const retained = await bundle.workspaceCleanupService.finalizeAfterExecution({
      workspace: runtime,
      outcome: 'failed',
    });
    expect(retained.action).toBe('retain');

    const runtime2 = await bundle.orchestratorService.prepareWorkspaceRuntime({
      runId,
      taskId: task.taskId,
      baseRepoPath: artifactDir,
    });
    await bundle.workspaceCleanupService.registerWorkspace({ workspace: runtime2 });
    const cleaned = await bundle.workspaceCleanupService.finalizeAfterReview({
      workspace: runtime2,
      reviewStatus: 'approved',
    });
    expect(cleaned.action).toBe('cleanup');
    await expect(fs.stat(runtime2.workspacePath)).rejects.toThrow();
  });

  it('marks cleanup as failed when workspace removal throws', async () => {
    const artifactDir = await createArtifactDir('workspace-cleanup-fail-');
    const task = buildTask('00000000-0000-4000-8000-000000000105');
    class FailingWorktreeService extends FakeWorktreeService {
      public override cleanupWorkspace(): Promise<void> {
        return Promise.reject(new Error('cleanup exploded'));
      }
    }
    const { bundle, runId } = await bootstrapRuntimeBundle({
      artifactDir,
      tasks: [task],
      bridgeClient: createBridgeClient(),
      worktreeService: new FailingWorktreeService(),
    } as never);

    const runtime = await bundle.orchestratorService.prepareWorkspaceRuntime({
      runId,
      taskId: task.taskId,
      baseRepoPath: artifactDir,
    });
    await bundle.workspaceCleanupService.registerWorkspace({ workspace: runtime });
    const record = await bundle.workspaceCleanupService.cleanupWorkspace({
      lifecycle: (await bundle.workspaceLifecycleRepository.getLifecycle(
        runId,
        runtime.workspaceId,
      ))!,
      workspace: runtime,
      reason: 'force failure',
    });
    expect(record.status).toBe('failed');
  });
});
