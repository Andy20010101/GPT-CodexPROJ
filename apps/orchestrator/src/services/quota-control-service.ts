import type { JobRecord, QuotaPolicy } from '../contracts';
import { QuotaPolicySchema } from '../contracts';
import { FileRunRepository } from '../storage/file-run-repository';
import { getJobFile } from '../utils/run-paths';
import { readJobKindQuota } from '../utils/quota-key';
import { EvidenceLedgerService } from './evidence-ledger-service';

export type QuotaDecision =
  | {
      allowed: true;
      reason: string;
      availableAt?: undefined;
    }
  | {
      allowed: false;
      reason: string;
      availableAt: string;
    };

export class QuotaControlService {
  public constructor(
    private readonly artifactDir: string,
    private readonly runRepository: FileRunRepository,
    private readonly evidenceLedgerService: EvidenceLedgerService,
    private readonly policy: QuotaPolicy,
    private readonly deferDelayMs: number,
  ) {}

  public getPolicy(): QuotaPolicy {
    return QuotaPolicySchema.parse(this.policy);
  }

  public evaluate(input: {
    job: JobRecord;
    activeJobs: readonly JobRecord[];
    now?: Date | undefined;
  }): QuotaDecision {
    const policy = this.getPolicy();
    const now = input.now ?? new Date();
    const activeRunningJobs = input.activeJobs.filter((entry) => entry.status === 'running');

    if (activeRunningJobs.length >= policy.maxConcurrentJobsGlobal) {
      return deny('Global quota is saturated.', now, this.deferDelayMs);
    }
    if (
      activeRunningJobs.filter((entry) => entry.runId === input.job.runId).length >=
      policy.maxConcurrentJobsPerRun
    ) {
      return deny(`Run quota is saturated for ${input.job.runId}.`, now, this.deferDelayMs);
    }

    const kindLimit = readJobKindQuota(policy, input.job.kind);
    if (
      kindLimit !== null &&
      activeRunningJobs.filter((entry) => entry.kind === input.job.kind).length >= kindLimit
    ) {
      return deny(`Quota is saturated for job kind ${input.job.kind}.`, now, this.deferDelayMs);
    }

    return {
      allowed: true,
      reason: 'Quota policy allows this job to start.',
    };
  }

  public async recordDecision(input: {
    job: JobRecord;
    decision: QuotaDecision;
    producer: string;
  }): Promise<void> {
    const run = await this.runRepository.getRun(input.job.runId);
    await this.evidenceLedgerService.appendEvidence({
      runId: input.job.runId,
      ...(input.job.taskId ? { taskId: input.job.taskId } : {}),
      stage: run.stage,
      kind: 'quota_decision',
      timestamp: new Date().toISOString(),
      producer: input.producer,
      artifactPaths: [getJobFile(this.artifactDir, input.job.runId, input.job.jobId)],
      summary: input.decision.reason,
      metadata: {
        jobId: input.job.jobId,
        allowed: input.decision.allowed,
        ...(input.decision.allowed ? {} : { availableAt: input.decision.availableAt }),
      },
    });
  }
}

function deny(reason: string, now: Date, delayMs: number): QuotaDecision {
  return {
    allowed: false,
    reason,
    availableAt: new Date(now.getTime() + delayMs).toISOString(),
  };
}
