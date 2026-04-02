import type { JobRecord, WorkerLease, WorkerRecord } from '../contracts';
import { WorkerRecordSchema } from '../contracts';
import { FileRunRepository } from '../storage/file-run-repository';
import { FileWorkerRepository } from '../storage/file-worker-repository';
import { OrchestratorError } from '../utils/error';
import { ConcurrencyControlService } from './concurrency-control-service';
import { HeartbeatService } from './heartbeat-service';
import { RunQueueService } from './run-queue-service';
import { SchedulingPolicyService } from './scheduling-policy-service';
import { WorkerLeaseService } from './worker-lease-service';
import { WorkerService } from './worker-service';
import { EvidenceLedgerService } from './evidence-ledger-service';

type WorkerHandle = {
  heartbeatTimer?: NodeJS.Timeout | undefined;
  jobPromise?: Promise<JobRecord> | undefined;
};

export class WorkerPoolService {
  private readonly handles = new Map<string, WorkerHandle>();

  public constructor(
    private readonly runRepository: FileRunRepository,
    private readonly runQueueService: RunQueueService,
    private readonly workerRepository: FileWorkerRepository,
    private readonly workerLeaseService: WorkerLeaseService,
    private readonly heartbeatService: HeartbeatService,
    private readonly concurrencyControlService: ConcurrencyControlService,
    private readonly schedulingPolicyService: SchedulingPolicyService,
    private readonly workerService: WorkerService,
    private readonly evidenceLedgerService: EvidenceLedgerService,
    private readonly config: {
      workerCount: number;
      leaseTtlMs: number;
      heartbeatIntervalMs: number;
    },
  ) {}

  public async initializeWorkers(
    daemonId: string,
    mode: WorkerRecord['status'] = 'idle',
  ): Promise<WorkerRecord[]> {
    const existing = await this.workerRepository.listWorkers();
    const forDaemon = existing.filter((worker) => worker.daemonId === daemonId);
    const workers: WorkerRecord[] = [];

    for (let index = 0; index < this.config.workerCount; index += 1) {
      const workerId = `${daemonId}-worker-${index + 1}`;
      const current = forDaemon.find((worker) => worker.workerId === workerId);
      const now = new Date().toISOString();
      const worker = WorkerRecordSchema.parse({
        workerId,
        daemonId,
        status: current?.status ?? mode,
        currentJobId: current?.currentJobId,
        startedAt: current?.startedAt ?? now,
        lastHeartbeatAt: current?.lastHeartbeatAt ?? now,
        metadata: current?.metadata ?? {},
      });
      await this.persistWorker(worker);
      workers.push(worker);
    }

    return workers;
  }

  public async setIdleWorkersStatus(
    daemonId: string,
    status: 'idle' | 'paused' | 'draining' | 'stopped',
  ): Promise<void> {
    const workers = await this.listWorkers(daemonId);
    for (const worker of workers) {
      if (this.hasRunningHandle(worker.workerId)) {
        continue;
      }
      await this.persistWorker({
        ...worker,
        status,
        currentJobId: undefined,
      });
    }
  }

  public async listWorkers(daemonId?: string | undefined): Promise<WorkerRecord[]> {
    const workers = await this.workerRepository.listWorkers();
    return daemonId ? workers.filter((worker) => worker.daemonId === daemonId) : workers;
  }

  public hasRunningWork(): boolean {
    return [...this.handles.values()].some((handle) => Boolean(handle.jobPromise));
  }

  public async runCycle(input: { daemonId: string; acceptNewWork: boolean }): Promise<void> {
    await this.initializeWorkers(input.daemonId);
    if (!input.acceptNewWork) {
      return;
    }

    const workers = await this.listWorkers(input.daemonId);
    const runnableJobs = await this.runQueueService.listRunnableJobs();
    const activeJobs = await this.listActiveJobs();
    const claimedJobIds = new Set<string>();
    const blockedJobs: JobRecord[] = [];
    const selectedJobs: JobRecord[] = [];
    const orderedJobs = this.schedulingPolicyService.orderRunnableJobs({
      jobs: runnableJobs,
      activeJobs,
    });

    for (const worker of workers) {
      if (this.hasRunningHandle(worker.workerId)) {
        continue;
      }

      const idleWorker = await this.persistWorker({
        ...worker,
        status: 'polling',
        currentJobId: undefined,
      });
      const candidate = await this.findCandidate(
        orderedJobs,
        activeJobs,
        claimedJobIds,
        blockedJobs,
      );
      if (!candidate) {
        await this.persistWorker({
          ...idleWorker,
          status: 'idle',
        });
        continue;
      }

      claimedJobIds.add(candidate.jobId);
      selectedJobs.push(candidate);
      const startedJob = await this.runQueueService.startJob(candidate.jobId);
      const lease = await this.workerLeaseService.acquireJobLease({
        workerId: worker.workerId,
        job: startedJob,
        leaseTtlMs: this.config.leaseTtlMs,
        heartbeatIntervalMs: this.config.heartbeatIntervalMs,
      });
      const runningWorker = await this.persistWorker(
        {
          ...idleWorker,
          status: 'running',
          currentJobId: startedJob.jobId,
        },
        startedJob.runId,
      );
      await this.heartbeatService.recordHeartbeat({
        daemonId: input.daemonId,
        worker: runningWorker,
        job: startedJob,
        kind: 'job',
        metadata: {
          leaseId: lease.leaseId,
        },
      });
      this.startWorkerHandle(input.daemonId, runningWorker, startedJob, lease);
      activeJobs.push(startedJob);
    }

    await this.schedulingPolicyService.recordState({
      runnableJobs: orderedJobs,
      blockedJobs,
      selectedJobs,
      activeJobs,
    });
  }

  public async waitForIdle(timeoutMs: number = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.hasRunningWork()) {
      if (Date.now() > deadline) {
        throw new OrchestratorError(
          'DAEMON_WAIT_TIMEOUT',
          'Timed out while waiting for worker pool to become idle.',
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  private async findCandidate(
    runnableJobs: readonly JobRecord[],
    activeJobs: JobRecord[],
    claimedJobIds: Set<string>,
    blockedJobs: JobRecord[],
  ): Promise<JobRecord | null> {
    for (const job of runnableJobs) {
      if (claimedJobIds.has(job.jobId)) {
        continue;
      }
      const quotaDecision = await this.schedulingPolicyService.evaluateQuota({
        job,
        activeJobs,
        producer: 'worker-pool-service',
      });
      if (!quotaDecision.allowed) {
        await this.runQueueService.rescheduleJob({
          jobId: job.jobId,
          availableAt: quotaDecision.availableAt,
          metadata: {
            quotaDeferredAt: new Date().toISOString(),
            quotaReason: quotaDecision.reason,
          },
        });
        blockedJobs.push(job);
        claimedJobIds.add(job.jobId);
        continue;
      }
      const decision = this.concurrencyControlService.evaluate({
        job,
        activeJobs,
      });
      await this.concurrencyControlService.recordDecision({
        job,
        decision,
        producer: 'worker-pool-service',
      });
      if (decision.allowed) {
        return job;
      }
      await this.runQueueService.rescheduleJob({
        jobId: job.jobId,
        availableAt: decision.availableAt,
        metadata: {
          concurrencyDeferredAt: new Date().toISOString(),
          concurrencyReason: decision.reason,
        },
      });
      blockedJobs.push(job);
      claimedJobIds.add(job.jobId);
    }

    return null;
  }

  private startWorkerHandle(
    daemonId: string,
    worker: WorkerRecord,
    job: JobRecord,
    lease: WorkerLease,
  ): void {
    const handle: WorkerHandle = {};
    handle.heartbeatTimer = setInterval(() => {
      void this.workerLeaseService
        .renewLease({
          job,
          leaseTtlMs: this.config.leaseTtlMs,
          metadata: {
            heartbeatLeaseId: lease.leaseId,
          },
        })
        .then(() =>
          this.heartbeatService.recordHeartbeat({
            daemonId,
            worker,
            job,
            kind: 'job',
            metadata: {
              leaseId: lease.leaseId,
            },
          }),
        )
        .catch(() => undefined);
    }, this.config.heartbeatIntervalMs);

    handle.jobPromise = this.workerService
      .processJob(job)
      .then(async (completedJob) => {
        if (handle.heartbeatTimer) {
          clearInterval(handle.heartbeatTimer);
        }
        await this.workerLeaseService.releaseLease({
          job: completedJob,
          metadata: {
            finishedAt: new Date().toISOString(),
          },
        });
        await this.persistWorker(
          {
            ...worker,
            status: 'idle',
            currentJobId: undefined,
            lastHeartbeatAt: new Date().toISOString(),
          },
          completedJob.runId,
        );
        return completedJob;
      })
      .finally(() => {
        if (handle.heartbeatTimer) {
          clearInterval(handle.heartbeatTimer);
        }
        this.handles.delete(worker.workerId);
      });

    this.handles.set(worker.workerId, handle);
  }

  private hasRunningHandle(workerId: string): boolean {
    return Boolean(this.handles.get(workerId)?.jobPromise);
  }

  private async listActiveJobs(): Promise<JobRecord[]> {
    const runs = await this.runRepository.listRuns();
    const jobs: JobRecord[] = [];
    for (const run of runs) {
      jobs.push(
        ...(await this.runQueueService.listJobsForRun(run.runId)).filter(
          (job) => job.status === 'running',
        ),
      );
    }
    return jobs;
  }

  private async persistWorker(
    worker: WorkerRecord,
    runId?: string | undefined,
  ): Promise<WorkerRecord> {
    const paths = await this.workerRepository.saveWorker(worker, runId);
    if (runId) {
      const run = await this.runRepository.getRun(runId);
      await this.evidenceLedgerService.appendEvidence({
        runId,
        stage: run.stage,
        kind: 'worker_record',
        timestamp: new Date().toISOString(),
        producer: 'worker-pool-service',
        artifactPaths: [paths.globalPath, ...(paths.runPath ? [paths.runPath] : [])],
        summary: `Worker ${worker.workerId} is ${worker.status}`,
        metadata: {
          workerId: worker.workerId,
          status: worker.status,
          ...(worker.currentJobId ? { currentJobId: worker.currentJobId } : {}),
        },
      });
    }
    return worker;
  }
}
