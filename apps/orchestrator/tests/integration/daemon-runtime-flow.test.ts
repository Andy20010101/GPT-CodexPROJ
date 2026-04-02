import { describe, expect, it } from 'vitest';

import { buildServer } from '../../src/api/server';
import {
  buildTask,
  bootstrapRuntimeBundle,
  createArtifactDir,
  createBridgeClient,
} from '../helpers/runtime-fixtures';

describe('daemon runtime flow', () => {
  it('starts the daemon, executes a queued task, writes heartbeats, and returns workers to idle', async () => {
    const artifactDir = await createArtifactDir('daemon-runtime-flow-');
    const task = buildTask('00000000-0000-4000-8000-000000000010');
    const { bundle, runId } = await bootstrapRuntimeBundle({
      artifactDir,
      tasks: [task],
      bridgeClient: createBridgeClient(),
    });

    await bundle.workflowRuntimeService.queueTask({
      taskId: task.taskId,
    });
    await bundle.daemonRuntimeService.start({
      autoPolling: false,
      requestedBy: 'tester',
    });
    const app = buildServer({
      runtimeBundle: bundle,
    });

    await bundle.daemonRuntimeService.tick();
    await bundle.daemonRuntimeService.waitForIdle(15000);

    const run = await bundle.orchestratorService.getRun(runId);
    const workers = await bundle.daemonRuntimeService.listWorkers();
    const heartbeats = await bundle.heartbeatRepository.listHeartbeats();
    const status = await bundle.daemonRuntimeService.getStatus();
    const daemonStatusResponse = await app.inject({
      method: 'GET',
      url: '/api/daemon/status',
    });
    const workersResponse = await app.inject({
      method: 'GET',
      url: '/api/workers',
    });

    expect(run.stage).toBe('accepted');
    expect(workers.some((worker) => worker.status === 'idle')).toBe(true);
    expect(heartbeats.length).toBeGreaterThan(0);
    expect(status.daemonState?.state).toBe('running');
    expect(status.metrics?.queueDepth.running).toBe(0);
    expect(daemonStatusResponse.statusCode).toBe(200);
    expect(workersResponse.statusCode).toBe(200);

    await app.close();
  }, 20000);
});
