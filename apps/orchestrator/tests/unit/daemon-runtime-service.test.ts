import { describe, expect, it, vi } from 'vitest';

import type { DaemonState, RuntimeMetrics } from '../../src/contracts';
import { DaemonRuntimeService } from '../../src/services/daemon-runtime-service';
import { OrchestratorError } from '../../src/utils/error';

function createRunningState(): DaemonState {
  return {
    daemonId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    state: 'running',
    startedAt: '2026-04-03T00:00:00.000Z',
    updatedAt: '2026-04-03T00:00:00.000Z',
    metadata: {},
  };
}

function createMetrics(): RuntimeMetrics {
  return {
    daemonId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    daemonState: 'running',
    workerCounts: {
      idle: 1,
      polling: 0,
      running: 0,
      paused: 0,
      draining: 0,
      stopped: 0,
    },
    queueDepth: {
      queued: 0,
      runnable: 0,
      blocked: 0,
      retriable: 0,
      running: 0,
    },
    activeRunCount: 0,
    staleJobCount: 0,
    recentFailureCount: 0,
    recentRecoveryCount: 0,
    concurrencyPolicy: {
      maxConcurrentJobs: 2,
      maxConcurrentJobsPerRun: 1,
      deferDelayMs: 250,
      exclusiveKeys: {
        task: true,
        workspace: true,
      },
    },
    lastUpdatedAt: '2026-04-03T00:00:01.000Z',
  };
}

describe('DaemonRuntimeService', () => {
  it('serializes concurrent ticks onto the same in-flight cycle', async () => {
    let releaseRunCycle: (() => void) | undefined;
    const runCycleGate = new Promise<void>((resolve) => {
      releaseRunCycle = resolve;
    });

    const runCycle = vi.fn(async () => {
      await runCycleGate;
    });
    const refreshMetrics = vi.fn(async () => createMetrics());
    const service = new DaemonRuntimeService(
      {
        getDaemonState: vi.fn(async () => createRunningState()),
        saveDaemonState: vi.fn(async () => ({
          globalPath: '/tmp/daemon-state.json',
          runPath: undefined,
        })),
        saveRuntimeMetrics: vi.fn(async () => '/tmp/runtime-metrics.json'),
      } as never,
      {
        listRuns: vi.fn(async () => []),
      } as never,
      {
        enqueueRunnableTasks: vi.fn(),
      } as never,
      {
        listJobsForRun: vi.fn(async () => []),
      } as never,
      {
        initializeWorkers: vi.fn(async () => []),
        setIdleWorkersStatus: vi.fn(),
        runCycle,
        waitForIdle: vi.fn(),
        listWorkers: vi.fn(async () => []),
      } as never,
      {
        enterDrainingState: vi.fn(),
        writeDrainSummary: vi.fn(),
      } as never,
      {
        refreshMetrics,
        getStatus: vi.fn(async () => ({
          daemonState: createRunningState(),
          metrics: createMetrics(),
        })),
      } as never,
      {
        reclaim: vi.fn(async () => ({
          timestamp: '2026-04-03T00:00:01.000Z',
          staleJobs: 0,
          retriedJobs: 0,
          failedJobs: 0,
          scannedRuns: 0,
        })),
      } as never,
      {
        runGc: vi.fn(),
      } as never,
      {
        appendEvidence: vi.fn(),
      } as never,
      {
        pollIntervalMs: 100,
        gcIntervalMs: 1_000,
        autoQueueRunnableTasks: true,
      },
    );

    const firstTick = service.tick();
    const secondTick = service.tick();

    for (let attempt = 0; attempt < 20 && runCycle.mock.calls.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(runCycle).toHaveBeenCalledTimes(1);

    releaseRunCycle?.();
    const [firstMetrics, secondMetrics] = await Promise.all([firstTick, secondTick]);

    expect(firstMetrics).toEqual(secondMetrics);
    expect(refreshMetrics).toHaveBeenCalledTimes(1);
  });

  it('skips intake runs without task graphs instead of crashing the daemon tick', async () => {
    const enqueueRunnableTasks = vi
      .fn()
      .mockRejectedValueOnce(
        new OrchestratorError('TASK_GRAPH_NOT_FOUND', 'Task graph missing', {
          runId: 'run-intake',
        }),
      )
      .mockResolvedValueOnce(undefined);
    const runCycle = vi.fn(async () => undefined);
    const refreshMetrics = vi.fn(async () => createMetrics());

    const service = new DaemonRuntimeService(
      {
        getDaemonState: vi.fn(async () => createRunningState()),
        saveDaemonState: vi.fn(async () => ({
          globalPath: '/tmp/daemon-state.json',
          runPath: undefined,
        })),
        saveRuntimeMetrics: vi.fn(async () => '/tmp/runtime-metrics.json'),
      } as never,
      {
        listRuns: vi.fn(async () => [
          {
            runId: 'run-intake',
            stage: 'intake',
          },
          {
            runId: 'run-ready',
            stage: 'foundation_ready',
          },
        ]),
      } as never,
      {
        enqueueRunnableTasks,
      } as never,
      {
        listJobsForRun: vi.fn(async () => []),
      } as never,
      {
        initializeWorkers: vi.fn(async () => []),
        setIdleWorkersStatus: vi.fn(),
        runCycle,
        waitForIdle: vi.fn(),
        listWorkers: vi.fn(async () => []),
      } as never,
      {
        enterDrainingState: vi.fn(),
        writeDrainSummary: vi.fn(),
      } as never,
      {
        refreshMetrics,
        getStatus: vi.fn(async () => ({
          daemonState: createRunningState(),
          metrics: createMetrics(),
        })),
      } as never,
      {
        reclaim: vi.fn(async () => ({
          timestamp: '2026-04-03T00:00:01.000Z',
          staleJobs: 0,
          retriedJobs: 0,
          failedJobs: 0,
          scannedRuns: 0,
        })),
      } as never,
      {
        runGc: vi.fn(),
      } as never,
      {
        appendEvidence: vi.fn(),
      } as never,
      {
        pollIntervalMs: 100,
        gcIntervalMs: 1_000,
        autoQueueRunnableTasks: true,
      },
    );

    const metrics = await service.tick();

    expect(metrics).toEqual(createMetrics());
    expect(enqueueRunnableTasks).toHaveBeenCalledTimes(2);
    expect(enqueueRunnableTasks).toHaveBeenNthCalledWith(1, 'run-intake');
    expect(enqueueRunnableTasks).toHaveBeenNthCalledWith(2, 'run-ready');
    expect(runCycle).toHaveBeenCalledTimes(1);
    expect(refreshMetrics).toHaveBeenCalledTimes(1);
  });
});
