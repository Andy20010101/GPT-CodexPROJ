import type { DaemonState, JobRecord, RuntimeMetrics, WorkerRecord } from '../contracts';
import { FileDaemonRepository } from '../storage/file-daemon-repository';
import { FileHeartbeatRepository } from '../storage/file-heartbeat-repository';
import { FileJobRepository } from '../storage/file-job-repository';
import { FileRunRepository } from '../storage/file-run-repository';
import { FileWorkerRepository } from '../storage/file-worker-repository';
import { buildRuntimeMetrics } from '../utils/metrics-aggregator';

export class DaemonStatusService {
  public constructor(
    private readonly daemonRepository: FileDaemonRepository,
    private readonly runRepository: FileRunRepository,
    private readonly jobRepository: FileJobRepository,
    private readonly workerRepository: FileWorkerRepository,
    private readonly heartbeatRepository: FileHeartbeatRepository,
    private readonly concurrencyPolicy: {
      maxConcurrentJobs: number;
      maxConcurrentJobsPerRun: number;
      deferDelayMs: number;
      exclusiveKeys: {
        task: boolean;
        workspace: boolean;
      };
    },
  ) {}

  public async getStatus(): Promise<{
    daemonState: DaemonState | null;
    metrics: RuntimeMetrics | null;
  }> {
    const daemonState = await this.daemonRepository.getDaemonState();
    if (!daemonState) {
      return {
        daemonState: null,
        metrics: null,
      };
    }

    const metrics = await this.refreshMetrics(daemonState);
    return {
      daemonState,
      metrics,
    };
  }

  public async listWorkers(daemonId?: string | undefined): Promise<WorkerRecord[]> {
    const workers = await this.workerRepository.listWorkers();
    return daemonId ? workers.filter((worker) => worker.daemonId === daemonId) : workers;
  }

  public async refreshMetrics(daemonState: DaemonState): Promise<RuntimeMetrics> {
    const jobs = await this.listAllJobs();
    const workers = await this.listWorkers(daemonState.daemonId);
    const heartbeats = await this.heartbeatRepository.listHeartbeats();
    const leases = await this.workerRepository.listLeases();
    const metrics = buildRuntimeMetrics({
      daemonState,
      workers,
      jobs,
      heartbeats,
      leases,
      concurrencyPolicy: this.concurrencyPolicy,
    });
    await this.daemonRepository.saveRuntimeMetrics(metrics);
    return metrics;
  }

  private async listAllJobs(): Promise<JobRecord[]> {
    const runs = await this.runRepository.listRuns();
    const jobs: JobRecord[] = [];
    for (const run of runs) {
      jobs.push(...(await this.jobRepository.listJobsForRun(run.runId)));
    }
    return jobs;
  }
}
