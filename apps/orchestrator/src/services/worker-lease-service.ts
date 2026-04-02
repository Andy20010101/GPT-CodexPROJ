import { randomUUID } from 'node:crypto';

import type { JobRecord, WorkerLease } from '../contracts';
import { WorkerLeaseSchema } from '../contracts';
import { FileRunRepository } from '../storage/file-run-repository';
import { FileWorkerRepository } from '../storage/file-worker-repository';
import { isLeaseExpired, calculateLeaseExpiry } from '../utils/lease-expiry';
import { OrchestratorError } from '../utils/error';
import { EvidenceLedgerService } from './evidence-ledger-service';

export class WorkerLeaseService {
  public constructor(
    private readonly runRepository: FileRunRepository,
    private readonly workerRepository: FileWorkerRepository,
    private readonly evidenceLedgerService: EvidenceLedgerService,
    private readonly defaults: {
      leaseTtlMs: number;
      heartbeatIntervalMs: number;
    },
  ) {}

  public async acquireJobLease(input: {
    workerId: string;
    job: JobRecord;
    leaseTtlMs?: number | undefined;
    heartbeatIntervalMs?: number | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<WorkerLease> {
    const existing = await this.workerRepository.getLeaseByJob(input.job.jobId);
    if (
      existing &&
      !isLeaseExpired(existing.expiresAt) &&
      readString(existing.metadata.releasedAt) === undefined
    ) {
      throw new OrchestratorError(
        'JOB_LEASE_CONFLICT',
        `Job ${input.job.jobId} already has an active lease.`,
        {
          jobId: input.job.jobId,
          workerId: existing.workerId,
          leaseId: existing.leaseId,
        },
      );
    }

    const acquiredAt = new Date().toISOString();
    const lease = WorkerLeaseSchema.parse({
      leaseId: randomUUID(),
      workerId: input.workerId,
      jobId: input.job.jobId,
      acquiredAt,
      expiresAt: calculateLeaseExpiry(acquiredAt, input.leaseTtlMs ?? this.defaults.leaseTtlMs),
      heartbeatIntervalMs: input.heartbeatIntervalMs ?? this.defaults.heartbeatIntervalMs,
      metadata: {
        ...(input.metadata ?? {}),
      },
    });
    const artifactPath = await this.workerRepository.saveLease(lease);
    await this.appendLeaseEvidence(
      input.job,
      artifactPath,
      `Acquired worker lease ${lease.leaseId}`,
      {
        leaseId: lease.leaseId,
        workerId: lease.workerId,
        action: 'acquire',
      },
    );
    return lease;
  }

  public async renewLease(input: {
    job: JobRecord;
    leaseTtlMs?: number | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<WorkerLease> {
    const existing = await this.workerRepository.getLeaseByJob(input.job.jobId);
    if (!existing) {
      throw new OrchestratorError(
        'JOB_LEASE_CONFLICT',
        `Job ${input.job.jobId} does not have an active lease to renew.`,
        { jobId: input.job.jobId },
      );
    }

    const renewedAt = new Date().toISOString();
    const renewed = WorkerLeaseSchema.parse({
      ...existing,
      expiresAt: calculateLeaseExpiry(renewedAt, input.leaseTtlMs ?? this.defaults.leaseTtlMs),
      metadata: {
        ...existing.metadata,
        ...(input.metadata ?? {}),
        renewedAt,
      },
    });
    const artifactPath = await this.workerRepository.saveLease(renewed);
    await this.appendLeaseEvidence(
      input.job,
      artifactPath,
      `Renewed worker lease ${renewed.leaseId}`,
      {
        leaseId: renewed.leaseId,
        workerId: renewed.workerId,
        action: 'renew',
      },
    );
    return renewed;
  }

  public async releaseLease(input: {
    job: JobRecord;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<WorkerLease | null> {
    const existing = await this.workerRepository.getLeaseByJob(input.job.jobId);
    if (!existing) {
      return null;
    }

    const releasedAt = new Date().toISOString();
    const released = WorkerLeaseSchema.parse({
      ...existing,
      expiresAt: releasedAt,
      metadata: {
        ...existing.metadata,
        ...(input.metadata ?? {}),
        releasedAt,
      },
    });
    const artifactPath = await this.workerRepository.saveLease(released);
    await this.appendLeaseEvidence(
      input.job,
      artifactPath,
      `Released worker lease ${released.leaseId}`,
      {
        leaseId: released.leaseId,
        workerId: released.workerId,
        action: 'release',
      },
    );
    return released;
  }

  public async detectExpiredLease(jobId: string, now: Date = new Date()): Promise<boolean> {
    const existing = await this.workerRepository.getLeaseByJob(jobId);
    if (!existing || readString(existing.metadata.releasedAt)) {
      return false;
    }
    return isLeaseExpired(existing.expiresAt, now);
  }

  public async getLease(jobId: string): Promise<WorkerLease | null> {
    return this.workerRepository.getLeaseByJob(jobId);
  }

  public async listActiveLeases(now: Date = new Date()): Promise<WorkerLease[]> {
    const leases = await this.workerRepository.listLeases();
    return leases.filter(
      (lease) =>
        readString(lease.metadata.releasedAt) === undefined &&
        !isLeaseExpired(lease.expiresAt, now),
    );
  }

  private async appendLeaseEvidence(
    job: JobRecord,
    artifactPath: string,
    summary: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const run = await this.runRepository.getRun(job.runId);
    await this.evidenceLedgerService.appendEvidence({
      runId: job.runId,
      ...(job.taskId ? { taskId: job.taskId } : {}),
      stage: run.stage,
      kind: 'worker_lease',
      timestamp: new Date().toISOString(),
      producer: 'worker-lease-service',
      artifactPaths: [artifactPath],
      summary,
      metadata: {
        jobId: job.jobId,
        ...metadata,
      },
    });
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
