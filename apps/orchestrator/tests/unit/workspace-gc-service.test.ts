import { describe, expect, it } from 'vitest';

import {
  buildTask,
  bootstrapRuntimeBundle,
  createArtifactDir,
  createBridgeClient,
  FakeWorktreeService,
} from '../helpers/runtime-fixtures';

describe('WorkspaceGcService', () => {
  it('cleans expired cleanup-pending workspaces', async () => {
    const artifactDir = await createArtifactDir('workspace-gc-');
    const task = buildTask('00000000-0000-4000-8000-000000000106');
    const { bundle, runId } = await bootstrapRuntimeBundle({
      artifactDir,
      tasks: [task],
      bridgeClient: createBridgeClient(),
      worktreeService: new FakeWorktreeService(),
      workspaceCleanupPolicy: {
        ttlMs: 0,
        retainOnFailure: true,
        retainOnRejectedReview: true,
        retainOnDebug: true,
        maxRetainedPerRun: 3,
        cleanupMode: 'delayed',
      },
    } as never);

    const runtime = await bundle.orchestratorService.prepareWorkspaceRuntime({
      runId,
      taskId: task.taskId,
      baseRepoPath: artifactDir,
    });
    await bundle.workspaceCleanupService.registerWorkspace({ workspace: runtime });
    await bundle.workspaceCleanupService.finalizeAfterExecution({
      workspace: runtime,
      outcome: 'succeeded',
    });

    const summary = await bundle.workspaceGcService.runGc();
    const lifecycle = await bundle.workspaceLifecycleRepository.getLifecycle(
      runId,
      runtime.workspaceId,
    );
    expect(summary.cleaned).toBeGreaterThanOrEqual(1);
    expect(lifecycle?.status).toBe('cleaned');
  });
});
