import { randomUUID } from 'node:crypto';

import type { DaemonState, RuntimeMetrics, WorkerRecord } from '../contracts';
import { DaemonStateSchema } from '../contracts';
import { FileDaemonRepository } from '../storage/file-daemon-repository';
import { FileRunRepository } from '../storage/file-run-repository';
import { EvidenceLedgerService } from './evidence-ledger-service';
import { WorkflowRuntimeService } from './workflow-runtime-service';
import { DrainService } from './drain-service';
import { WorkerPoolService } from './worker-pool-service';
import { DaemonStatusService } from './daemon-status-service';
import { RunQueueService } from './run-queue-service';
import { StaleJobReclaimService, type StaleJobReclaimSummary } from './stale-job-reclaim-service';

export class DaemonRuntimeService {
  private pollTimer?: NodeJS.Timeout | undefined;

  public constructor(
    private readonly daemonRepository: FileDaemonRepository,
    private readonly runRepository: FileRunRepository,
    private readonly workflowRuntimeService: WorkflowRuntimeService,
    private readonly runQueueService: RunQueueService,
    private readonly workerPoolService: WorkerPoolService,
    private readonly drainService: DrainService,
    private readonly daemonStatusService: DaemonStatusService,
    private readonly staleJobReclaimService: StaleJobReclaimService,
    private readonly evidenceLedgerService: EvidenceLedgerService,
    private readonly config: {
      pollIntervalMs: number;
      autoQueueRunnableTasks: boolean;
    },
  ) {}

  public async start(options?: {
    autoPolling?: boolean | undefined;
    requestedBy?: string | undefined;
  }): Promise<{
    daemonState: DaemonState;
    metrics: RuntimeMetrics;
  }> {
    const state = await this.persistState({
      daemonId: randomUUID(),
      state: 'starting',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {
        startedBy: options?.requestedBy ?? 'system',
      },
    });
    await this.workerPoolService.initializeWorkers(state.daemonId);
    const running = await this.persistState({
      ...state,
      state: 'running',
      updatedAt: new Date().toISOString(),
    });
    if (options?.autoPolling !== false) {
      this.startPollingLoop();
    }
    const metrics = await this.tick();
    return {
      daemonState: running,
      metrics,
    };
  }

  public async pause(requestedBy: string = 'api'): Promise<DaemonState> {
    const state = await this.requireState();
    const paused = await this.persistState({
      ...state,
      state: 'paused',
      pausedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {
        ...state.metadata,
        pausedBy: requestedBy,
      },
    });
    await this.workerPoolService.setIdleWorkersStatus(paused.daemonId, 'paused');
    return paused;
  }

  public async resume(requestedBy: string = 'api'): Promise<DaemonState> {
    const state = await this.requireState();
    const resumed = await this.persistState({
      ...state,
      state: 'running',
      updatedAt: new Date().toISOString(),
      metadata: {
        ...state.metadata,
        resumedBy: requestedBy,
      },
    });
    await this.workerPoolService.setIdleWorkersStatus(resumed.daemonId, 'idle');
    return resumed;
  }

  public async drain(
    requestedBy: string = 'api',
    reason?: string | undefined,
  ): Promise<DaemonState> {
    const state = await this.requireState();
    const draining = await this.drainService.enterDrainingState({
      daemonState: state,
      requestedBy,
      reason,
    });
    await this.workerPoolService.setIdleWorkersStatus(draining.daemonId, 'draining');
    return this.persistState(draining);
  }

  public async shutdown(
    requestedBy: string = 'api',
    reason?: string | undefined,
  ): Promise<DaemonState> {
    const state = await this.requireState();
    const draining = await this.drainService.enterDrainingState({
      daemonState: state,
      requestedBy,
      reason,
      shutdownRequested: true,
    });
    await this.workerPoolService.setIdleWorkersStatus(draining.daemonId, 'draining');
    await this.tick();
    return this.requireState();
  }

  public async tick(): Promise<RuntimeMetrics> {
    const state = await this.requireState();
    const reclaim = await this.staleJobReclaimService.reclaim();
    if (this.config.autoQueueRunnableTasks && state.state === 'running') {
      const runs = await this.runRepository.listRuns();
      for (const run of runs.filter((entry) => entry.stage !== 'accepted')) {
        await this.workflowRuntimeService.enqueueRunnableTasks(run.runId);
      }
    }

    if (state.state === 'running') {
      await this.workerPoolService.runCycle({
        daemonId: state.daemonId,
        acceptNewWork: true,
      });
    } else if (state.state === 'paused' || state.state === 'draining') {
      await this.workerPoolService.runCycle({
        daemonId: state.daemonId,
        acceptNewWork: false,
      });
    }

    const metrics = await this.daemonStatusService.refreshMetrics(await this.requireState());
    await this.appendRuntimeMetricsEvidence(metrics);
    await this.maybeFinalizeDraining(metrics, reclaim);
    return metrics;
  }

  public async waitForIdle(timeoutMs: number = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    // Keep ticking until the daemon reaches a stable state with no running or runnable work.
    let completed = false;
    while (!completed) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error('Timed out while waiting for daemon runtime to become idle.');
      }
      await this.workerPoolService.waitForIdle(remaining);
      const metrics = await this.tick();
      if (
        metrics.queueDepth.running === 0 &&
        metrics.queueDepth.runnable === 0 &&
        metrics.queueDepth.queued === 0 &&
        metrics.queueDepth.retriable === 0
      ) {
        completed = true;
      }
    }
  }

  public async getStatus(): Promise<{
    daemonState: DaemonState | null;
    metrics: RuntimeMetrics | null;
  }> {
    return this.daemonStatusService.getStatus();
  }

  public async listWorkers(): Promise<WorkerRecord[]> {
    const state = await this.requireState();
    return this.workerPoolService.listWorkers(state.daemonId);
  }

  private startPollingLoop(): void {
    if (this.pollTimer) {
      return;
    }
    this.pollTimer = setInterval(() => {
      void this.tick();
    }, this.config.pollIntervalMs);
  }

  private stopPollingLoop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private async maybeFinalizeDraining(
    metrics: RuntimeMetrics,
    reclaim: StaleJobReclaimSummary,
  ): Promise<void> {
    const state = await this.requireState();
    if (state.state !== 'draining') {
      return;
    }
    if (metrics.queueDepth.running > 0) {
      return;
    }

    const workers = await this.workerPoolService.listWorkers(state.daemonId);
    const jobs = await this.listAllJobs();
    await this.drainService.writeDrainSummary({
      daemonState: state,
      workers,
      jobs,
    });
    if (state.metadata.shutdownRequested === true) {
      const stopped = await this.persistState({
        ...state,
        state: reclaim.failedJobs > 0 ? 'degraded' : 'stopped',
        stoppedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      await this.workerPoolService.setIdleWorkersStatus(stopped.daemonId, 'stopped');
      this.stopPollingLoop();
    }
  }

  private async listAllJobs() {
    const runs = await this.runRepository.listRuns();
    const jobs = [];
    for (const run of runs) {
      jobs.push(...(await this.runQueueService.listJobsForRun(run.runId)));
    }
    return jobs;
  }

  private async requireState(): Promise<DaemonState> {
    const state = await this.daemonRepository.getDaemonState();
    if (!state) {
      return this.persistState({
        daemonId: randomUUID(),
        state: 'stopped',
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        stoppedAt: new Date().toISOString(),
        metadata: {},
      });
    }
    return state;
  }

  private async persistState(state: DaemonState): Promise<DaemonState> {
    const parsed = DaemonStateSchema.parse(state);
    const runs = await this.runRepository.listRuns();
    await this.daemonRepository.saveDaemonState(parsed);
    for (const run of runs.filter((entry) => entry.stage !== 'accepted')) {
      const paths = await this.daemonRepository.saveDaemonState(parsed, run.runId);
      await this.evidenceLedgerService.appendEvidence({
        runId: run.runId,
        stage: run.stage,
        kind: 'daemon_state',
        timestamp: parsed.updatedAt,
        producer: 'daemon-runtime-service',
        artifactPaths: [paths.globalPath, ...(paths.runPath ? [paths.runPath] : [])],
        summary: `Daemon ${parsed.daemonId} is ${parsed.state}`,
        metadata: {
          daemonId: parsed.daemonId,
          state: parsed.state,
        },
      });
    }
    return parsed;
  }

  private async appendRuntimeMetricsEvidence(metrics: RuntimeMetrics): Promise<void> {
    const path = await this.daemonRepository.saveRuntimeMetrics(metrics);
    const runs = await this.runRepository.listRuns();
    for (const run of runs.filter((entry) => entry.stage !== 'accepted')) {
      await this.evidenceLedgerService.appendEvidence({
        runId: run.runId,
        stage: run.stage,
        kind: 'runtime_metrics',
        timestamp: metrics.lastUpdatedAt,
        producer: 'daemon-runtime-service',
        artifactPaths: [path],
        summary: `Runtime metrics refreshed for daemon ${metrics.daemonId}`,
        metadata: {
          daemonId: metrics.daemonId,
          daemonState: metrics.daemonState,
        },
      });
    }
  }
}
