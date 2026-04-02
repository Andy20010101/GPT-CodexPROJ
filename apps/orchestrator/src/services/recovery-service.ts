import { FileJobRepository } from '../storage/file-job-repository';
import { FileQueueRepository } from '../storage/file-queue-repository';
import { FileRunRepository } from '../storage/file-run-repository';
import { RetryService } from './retry-service';
import { RunQueueService } from './run-queue-service';
import { EvidenceLedgerService } from './evidence-ledger-service';
import { RunnerResumeService } from './runner-resume-service';

export type RecoverySummary = {
  timestamp: string;
  runsScanned: number;
  jobsScanned: number;
  requeuedJobs: number;
  failedJobs: number;
  restoredQueuedJobs: number;
  byRun: Record<
    string,
    {
      requeuedJobs: number;
      failedJobs: number;
      restoredQueuedJobs: number;
    }
  >;
};

export class RecoveryService {
  public constructor(
    private readonly runRepository: FileRunRepository,
    private readonly jobRepository: FileJobRepository,
    private readonly queueRepository: FileQueueRepository,
    private readonly runQueueService: RunQueueService,
    private readonly retryService: RetryService,
    private readonly evidenceLedgerService: EvidenceLedgerService,
    private readonly runnerResumeService?: RunnerResumeService | undefined,
  ) {}

  public async recover(): Promise<RecoverySummary> {
    const runs = await this.runRepository.listRuns();
    const timestamp = new Date().toISOString();
    const summary: RecoverySummary = {
      timestamp,
      runsScanned: runs.length,
      jobsScanned: 0,
      requeuedJobs: 0,
      failedJobs: 0,
      restoredQueuedJobs: 0,
      byRun: {},
    };

    for (const run of runs) {
      const jobs = await this.jobRepository.listJobsForRun(run.runId);
      summary.jobsScanned += jobs.length;
      summary.byRun[run.runId] = {
        requeuedJobs: 0,
        failedJobs: 0,
        restoredQueuedJobs: 0,
      };
      const runSummary = summary.byRun[run.runId]!;

      for (const job of jobs) {
        if (job.status === 'running' && !job.finishedAt) {
          await this.runnerResumeService?.assess({
            job,
            ...(job.taskId ? { taskId: job.taskId } : {}),
            executionId: readString(job.metadata.executionId),
            workspaceId: readString(job.metadata.workspaceId),
            metadata: {
              recoveredBy: 'recovery-service',
            },
          });
          try {
            await this.retryService.retryJob({
              jobId: job.jobId,
              error: {
                code: 'JOB_INTERRUPTED',
                message: `Recovered interrupted ${job.kind} job ${job.jobId}`,
              },
              immediate: true,
              metadata: {
                recovered: true,
              },
            });
            summary.requeuedJobs += 1;
            runSummary.requeuedJobs += 1;
          } catch {
            await this.runQueueService.markFailed({
              jobId: job.jobId,
              error: {
                code: 'JOB_INTERRUPTED',
                message: `Interrupted ${job.kind} job ${job.jobId} exceeded retry policy`,
              },
              metadata: {
                recovered: true,
              },
            });
            summary.failedJobs += 1;
            runSummary.failedJobs += 1;
          }
          continue;
        }

        if (job.status === 'queued' || job.status === 'retriable') {
          await this.runQueueService.restoreQueuedJob(job);
          summary.restoredQueuedJobs += 1;
          runSummary.restoredQueuedJobs += 1;
        }
      }

      const artifactPath = await this.queueRepository.saveRecoverySummary(run.runId, {
        timestamp,
        runId: run.runId,
        summary: runSummary,
      });
      await this.evidenceLedgerService.appendEvidence({
        runId: run.runId,
        stage: run.stage,
        kind: 'recovery_summary',
        timestamp,
        producer: 'recovery-service',
        artifactPaths: [artifactPath],
        summary: `Recovered runtime state for run ${run.runId}`,
        metadata: runSummary,
      });
    }

    return summary;
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
