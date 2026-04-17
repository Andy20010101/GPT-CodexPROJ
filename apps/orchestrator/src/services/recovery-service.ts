import { FileJobRepository } from '../storage/file-job-repository';
import { FileProcessRepository } from '../storage/file-process-repository';
import { FileQueueRepository } from '../storage/file-queue-repository';
import { FileRunRepository } from '../storage/file-run-repository';
import { FileWorkerRepository } from '../storage/file-worker-repository';
import {
  ProcessHandleSchema,
  type JobRecord,
  type ProcessHandle,
  type RunStage,
  type WorkerRecord,
} from '../contracts';
import { RetryService } from './retry-service';
import { RunQueueService } from './run-queue-service';
import { EvidenceLedgerService } from './evidence-ledger-service';
import { RunnerResumeService } from './runner-resume-service';
import { WorkerLeaseService } from './worker-lease-service';

export type ProcessLivenessProbe = (pid: number) => boolean | Promise<boolean>;

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
    private readonly processRepository: FileProcessRepository,
    private readonly queueRepository: FileQueueRepository,
    private readonly workerRepository: FileWorkerRepository,
    private readonly runQueueService: RunQueueService,
    private readonly retryService: RetryService,
    private readonly workerLeaseService: WorkerLeaseService,
    private readonly evidenceLedgerService: EvidenceLedgerService,
    private readonly runnerResumeService?: RunnerResumeService | undefined,
    private readonly processLivenessProbe: ProcessLivenessProbe = defaultProcessLivenessProbe,
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
      const terminalJobs = jobs.filter(isTerminalJob);
      const terminalJobIds = new Set(terminalJobs.map((job) => job.jobId));

      for (const job of terminalJobs) {
        await this.reconcileRunningProcessHandle(run.stage, job, timestamp);
        await this.releaseTerminalLease(run.runId, job);
      }

      await this.clearStaleWorkerAssignments(run.runId, terminalJobIds);

      for (const job of jobs) {
        if (job.status === 'running' && !job.finishedAt) {
          await this.reconcileInterruptedRunningJob(run.runId, run.stage, job, timestamp);
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

  private async reconcileInterruptedRunningJob(
    runId: string,
    stage: RunStage,
    job: JobRecord,
    timestamp: string,
  ): Promise<void> {
    await this.reconcileRunningProcessHandle(stage, job, timestamp);

    await this.releaseInterruptedLease(runId, job, timestamp);
  }

  private async reconcileRunningProcessHandle(
    stage: RunStage,
    job: JobRecord,
    timestamp: string,
  ): Promise<void> {
    const processHandle = await this.processRepository.findLatestByJob(job.jobId);
    if (processHandle?.status !== 'running') {
      return;
    }

    const pidAlive =
      typeof processHandle.pid === 'number'
        ? await this.processLivenessProbe(processHandle.pid)
        : false;
    if (pidAlive) {
      return;
    }

    await this.persistRecoveredProcessHandle(
      stage,
      ProcessHandleSchema.parse({
        ...processHandle,
        status: 'terminated',
        endedAt: timestamp,
        exitCode: null,
        signal: null,
        ...(processHandle.startedAt
          ? { durationMs: Date.parse(timestamp) - Date.parse(processHandle.startedAt) }
          : {}),
        metadata: {
          ...processHandle.metadata,
          recoveredBy: 'recovery-service',
          recoveryReason: 'process_missing',
          observedPidMissingAt: timestamp,
          orphaned: true,
        },
      }),
    );
  }

  private async releaseTerminalLease(runId: string, job: JobRecord): Promise<void> {
    const lease = await this.workerLeaseService.getLease(job.jobId);
    if (!lease || readString(lease.metadata.releasedAt)) {
      return;
    }

    await this.workerLeaseService.releaseLease({
      job,
      metadata: {
        finishedAt: job.finishedAt ?? new Date().toISOString(),
        recoveredBy: 'recovery-service',
        releaseReason: 'terminal_job',
      },
    });

    const worker = await this.workerRepository.getWorker(lease.workerId);
    if (!worker || worker.currentJobId !== job.jobId) {
      return;
    }

    await this.workerRepository.saveWorker(clearWorkerTerminalJob(worker), runId);
  }

  private async releaseInterruptedLease(
    runId: string,
    job: JobRecord,
    timestamp: string,
  ): Promise<void> {
    const lease = await this.workerLeaseService.getLease(job.jobId);
    if (lease && !readString(lease.metadata.releasedAt)) {
      await this.workerLeaseService.releaseLease({
        job,
        metadata: {
          recoveredBy: 'recovery-service',
          releaseReason: 'recovered_interrupted_job',
          recoveredAt: timestamp,
        },
      });
    }

    if (!lease?.workerId) {
      return;
    }

    const worker = await this.workerRepository.getWorker(lease.workerId);
    if (!worker || worker.currentJobId !== job.jobId) {
      return;
    }

    await this.workerRepository.saveWorker(
      {
        ...worker,
        status: 'stopped',
        currentJobId: undefined,
        lastHeartbeatAt: timestamp,
        metadata: {
          ...worker.metadata,
          recovered: true,
          recoveryReason: 'interrupted_job',
        },
      },
      runId,
    );
  }

  private async persistRecoveredProcessHandle(stage: RunStage, handle: ProcessHandle): Promise<void> {
    const artifactPath = await this.processRepository.saveProcessHandle(handle);
    await this.evidenceLedgerService.appendEvidence({
      runId: handle.runId,
      ...(handle.taskId ? { taskId: handle.taskId } : {}),
      stage,
      kind: 'process_handle',
      timestamp: handle.endedAt ?? handle.startedAt,
      producer: 'recovery-service',
      artifactPaths: [artifactPath],
      summary: `Recovered orphaned process handle ${handle.processHandleId}`,
      metadata: {
        processHandleId: handle.processHandleId,
        jobId: handle.jobId,
        status: handle.status,
        ...(handle.pid ? { pid: handle.pid } : {}),
      },
    });
  }

  private async clearStaleWorkerAssignments(
    runId: string,
    terminalJobIds: ReadonlySet<string>,
  ): Promise<void> {
    if (terminalJobIds.size === 0) {
      return;
    }

    const workers = await this.workerRepository.listWorkers();
    for (const worker of workers) {
      if (!worker.currentJobId || !terminalJobIds.has(worker.currentJobId)) {
        continue;
      }
      await this.workerRepository.saveWorker(clearWorkerTerminalJob(worker), runId);
    }
  }
}

function isTerminalJob(job: JobRecord): boolean {
  return (
    job.status === 'succeeded' ||
    job.status === 'failed' ||
    job.status === 'blocked' ||
    job.status === 'cancelled' ||
    job.status === 'manual_attention_required'
  );
}

function clearWorkerTerminalJob(worker: WorkerRecord): WorkerRecord {
  return {
    ...worker,
    status: worker.status === 'draining' || worker.status === 'stopped' ? worker.status : 'stopped',
    currentJobId: undefined,
    lastHeartbeatAt: new Date().toISOString(),
    metadata: {
      ...worker.metadata,
      recovered: true,
    },
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function defaultProcessLivenessProbe(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isMissingProcessError(error);
  }
}

function isMissingProcessError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ESRCH'
  );
}
