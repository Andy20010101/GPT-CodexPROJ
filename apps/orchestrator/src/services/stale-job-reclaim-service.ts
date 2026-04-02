import type { JobRecord, WorkerRecord } from '../contracts';
import { FileJobRepository } from '../storage/file-job-repository';
import { FileRunRepository } from '../storage/file-run-repository';
import { FileWorkerRepository } from '../storage/file-worker-repository';
import { EvidenceLedgerService } from './evidence-ledger-service';
import { HeartbeatService } from './heartbeat-service';
import { RetryService } from './retry-service';
import { RunQueueService } from './run-queue-service';
import { WorkerLeaseService } from './worker-lease-service';
import { getJobFile } from '../utils/run-paths';

export type StaleJobReclaimSummary = {
  timestamp: string;
  staleJobs: number;
  retriedJobs: number;
  failedJobs: number;
};

export class StaleJobReclaimService {
  public constructor(
    private readonly artifactDir: string,
    private readonly runRepository: FileRunRepository,
    private readonly jobRepository: FileJobRepository,
    private readonly workerRepository: FileWorkerRepository,
    private readonly runQueueService: RunQueueService,
    private readonly retryService: RetryService,
    private readonly heartbeatService: HeartbeatService,
    private readonly workerLeaseService: WorkerLeaseService,
    private readonly evidenceLedgerService: EvidenceLedgerService,
  ) {}

  public async reclaim(now: Date = new Date()): Promise<StaleJobReclaimSummary> {
    const runs = await this.runRepository.listRuns();
    const summary: StaleJobReclaimSummary = {
      timestamp: now.toISOString(),
      staleJobs: 0,
      retriedJobs: 0,
      failedJobs: 0,
    };

    for (const run of runs) {
      const jobs = await this.jobRepository.listJobsForRun(run.runId);
      for (const job of jobs.filter((entry) => entry.status === 'running')) {
        if (!(await this.isJobStale(job, now))) {
          continue;
        }

        summary.staleJobs += 1;
        const latestLease = await this.workerLeaseService.getLease(job.jobId);
        if (latestLease?.workerId) {
          const worker = await this.workerRepository.getWorker(latestLease.workerId);
          if (worker) {
            await this.workerRepository.saveWorker(markWorkerStopped(worker), run.runId);
          }
        }
        await this.workerLeaseService.releaseLease({
          job,
          metadata: {
            reclaimedAt: now.toISOString(),
          },
        });

        if (this.retryService.canRetry(job)) {
          await this.retryService.retryJob({
            jobId: job.jobId,
            immediate: true,
            error: {
              code: 'STALE_JOB_RECLAIMED',
              message: `Job ${job.jobId} was reclaimed after lease or heartbeat expiry.`,
            },
            metadata: {
              reclaimed: true,
            },
          });
          summary.retriedJobs += 1;
        } else {
          await this.runQueueService.markFailed({
            jobId: job.jobId,
            error: {
              code: 'STALE_JOB_RECLAIMED',
              message: `Job ${job.jobId} was reclaimed and cannot be retried.`,
            },
            metadata: {
              reclaimed: true,
            },
          });
          summary.failedJobs += 1;
        }

        await this.evidenceLedgerService.appendEvidence({
          runId: job.runId,
          ...(job.taskId ? { taskId: job.taskId } : {}),
          stage: run.stage,
          kind: 'stale_job_reclaim',
          timestamp: now.toISOString(),
          producer: 'stale-job-reclaim-service',
          artifactPaths: [getJobFile(this.artifactDir, job.runId, job.jobId)],
          summary: `Reclaimed stale job ${job.jobId}`,
          metadata: {
            jobId: job.jobId,
          },
        });
      }
    }

    return summary;
  }

  private async isJobStale(job: JobRecord, now: Date): Promise<boolean> {
    const hasExpiredLease = await this.workerLeaseService.detectExpiredLease(job.jobId, now);
    if (hasExpiredLease) {
      return true;
    }
    const latestHeartbeat = await this.heartbeatService.getLatestHeartbeatForJob(job.jobId);
    if (latestHeartbeat) {
      return this.heartbeatService.isStale(latestHeartbeat.timestamp, now);
    }
    return Boolean(job.startedAt && this.heartbeatService.isStale(job.startedAt, now));
  }
}

function markWorkerStopped(worker: WorkerRecord): WorkerRecord {
  return {
    ...worker,
    status: 'stopped',
    currentJobId: undefined,
    lastHeartbeatAt: new Date().toISOString(),
    metadata: {
      ...worker.metadata,
      reclaimed: true,
    },
  };
}
