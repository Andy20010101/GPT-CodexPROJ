import { randomUUID } from 'node:crypto';

import type { DaemonState, RuntimeMetrics, WorkerRecord } from '../contracts';
import { DaemonStateSchema } from '../contracts';
import { FileDaemonRepository } from '../storage/file-daemon-repository';
import { FileRunRepository } from '../storage/file-run-repository';
import { OrchestratorError } from '../utils/error';
import { EvidenceLedgerService } from './evidence-ledger-service';
import { WorkflowRuntimeService } from './workflow-runtime-service';
import { DrainService } from './drain-service';
import { WorkerPoolService } from './worker-pool-service';
import { DaemonStatusService } from './daemon-status-service';
import { RunQueueService } from './run-queue-service';
import { StaleJobReclaimService, type StaleJobReclaimSummary } from './stale-job-reclaim-service';
import { WorkspaceGcService } from './workspace-gc-service';

export class DaemonRuntimeService {
  private pollTimer?: NodeJS.Timeout | undefined;
  private gcTimer?: NodeJS.Timeout | undefined;
  private tickPromise?: Promise<RuntimeMetrics> | undefined;

  public constructor(
    private readonly daemonRepository: FileDaemonRepository,
    private readonly runRepository: FileRunRepository,
    private readonly workflowRuntimeService: WorkflowRuntimeService,
    private readonly runQueueService: RunQueueService,
    private readonly workerPoolService: WorkerPoolService,
    private readonly drainService: DrainService,
    private readonly daemonStatusService: DaemonStatusService,
    private readonly staleJobReclaimService: StaleJobReclaimService,
    private readonly workspaceGcService: WorkspaceGcService,
    private readonly evidenceLedgerService: EvidenceLedgerService,
    private readonly config: {
      pollIntervalMs: number;
      gcIntervalMs: number;
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
    await this.appendLifecycleEvidence(running, 'runtime_daemon_startup');
    if (options?.autoPolling !== false) {
      this.startPollingLoop();
      this.startGcLoop();
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
    if (this.tickPromise) {
      return this.tickPromise;
    }

    const tickPromise = this.runTick().finally(() => {
      if (this.tickPromise === tickPromise) {
        this.tickPromise = undefined;
      }
    });
    this.tickPromise = tickPromise;
    return tickPromise;
  }

  private async runTick(): Promise<RuntimeMetrics> {
    const state = await this.requireState();
    const reclaim = await this.staleJobReclaimService.reclaim();
    if (this.config.autoQueueRunnableTasks && state.state === 'running') {
      const runs = await this.runRepository.listRuns();
      for (const run of runs.filter((entry) => entry.stage !== 'accepted')) {
        try {
          await this.workflowRuntimeService.enqueueRunnableTasks(run.runId);
        } catch (error) {
          if (error instanceof OrchestratorError && error.code === 'TASK_GRAPH_NOT_FOUND') {
            continue;
          }
          throw error;
        }
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

  private startGcLoop(): void {
    if (this.gcTimer) {
      return;
    }
    this.gcTimer = setInterval(() => {
      void this.workspaceGcService.runGc();
    }, this.config.gcIntervalMs);
  }

  private stopPollingLoop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    if (this.gcTimer) {
      clearInterval(this.gcTimer);
      this.gcTimer = undefined;
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
      await this.appendLifecycleEvidence(stopped, 'runtime_daemon_shutdown');
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

  private async appendLifecycleEvidence(
    state: DaemonState,
    kind: 'runtime_daemon_startup' | 'runtime_daemon_shutdown',
  ): Promise<void> {
    const runs = await this.runRepository.listRuns();
    const artifact = await this.daemonRepository.saveDaemonState(state);
    for (const run of runs.filter((entry) => entry.stage !== 'accepted')) {
      await this.evidenceLedgerService.appendEvidence({
        runId: run.runId,
        stage: run.stage,
        kind,
        timestamp: state.updatedAt,
        producer: 'daemon-runtime-service',
        artifactPaths: [artifact.globalPath, ...(artifact.runPath ? [artifact.runPath] : [])],
        summary:
          kind === 'runtime_daemon_startup'
            ? `Daemon ${state.daemonId} started`
            : `Daemon ${state.daemonId} shutdown`,
        metadata: {
          daemonId: state.daemonId,
          state: state.state,
        },
      });
    }
  }
}
