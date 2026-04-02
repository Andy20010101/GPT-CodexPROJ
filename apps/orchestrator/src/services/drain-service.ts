import { FileDaemonRepository } from '../storage/file-daemon-repository';
import { FileRunRepository } from '../storage/file-run-repository';
import { writeJsonFile } from '../utils/file-store';
import { getRuntimeDrainSummaryFile } from '../utils/run-paths';
import type { DaemonState, JobRecord, WorkerRecord } from '../contracts';
import { EvidenceLedgerService } from './evidence-ledger-service';

export class DrainService {
  public constructor(
    private readonly artifactDir: string,
    private readonly daemonRepository: FileDaemonRepository,
    private readonly runRepository: FileRunRepository,
    private readonly evidenceLedgerService: EvidenceLedgerService,
  ) {}

  public async enterDrainingState(input: {
    daemonState: DaemonState;
    requestedBy: string;
    reason?: string | undefined;
    shutdownRequested?: boolean | undefined;
  }): Promise<DaemonState> {
    const updatedAt = new Date().toISOString();
    const nextState: DaemonState = {
      ...input.daemonState,
      state: 'draining',
      drainingAt: input.daemonState.drainingAt ?? updatedAt,
      updatedAt,
      metadata: {
        ...input.daemonState.metadata,
        drainRequestedBy: input.requestedBy,
        ...(input.reason ? { drainReason: input.reason } : {}),
        ...(input.shutdownRequested ? { shutdownRequested: true } : {}),
      },
    };
    await this.daemonRepository.saveDaemonState(nextState);
    return nextState;
  }

  public async writeDrainSummary(input: {
    daemonState: DaemonState;
    workers: readonly WorkerRecord[];
    jobs: readonly JobRecord[];
  }): Promise<string> {
    const outputPath = getRuntimeDrainSummaryFile(this.artifactDir);
    const summary = {
      daemonId: input.daemonState.daemonId,
      state: input.daemonState.state,
      timestamp: new Date().toISOString(),
      runningWorkers: input.workers.filter((worker) => worker.status === 'running').length,
      runningJobs: input.jobs.filter((job) => job.status === 'running').length,
      queuedJobs: input.jobs.filter((job) => job.status === 'queued' || job.status === 'retriable')
        .length,
    };
    await writeJsonFile(outputPath, summary);

    const runs = await this.runRepository.listRuns();
    for (const run of runs) {
      await this.evidenceLedgerService.appendEvidence({
        runId: run.runId,
        stage: run.stage,
        kind: 'drain_summary',
        timestamp: summary.timestamp,
        producer: 'drain-service',
        artifactPaths: [outputPath],
        summary: `Daemon drain summary captured for daemon ${input.daemonState.daemonId}`,
        metadata: summary,
      });
    }

    return outputPath;
  }
}
