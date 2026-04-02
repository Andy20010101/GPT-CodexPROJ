import type { ConcurrencyPolicy, JobRecord } from '../contracts';
import { ConcurrencyPolicySchema } from '../contracts';
import { FileRunRepository } from '../storage/file-run-repository';
import { getJobFile } from '../utils/run-paths';
import { buildConcurrencyKeys } from '../utils/concurrency-key';
import { EvidenceLedgerService } from './evidence-ledger-service';

export type ConcurrencyDecision =
  | {
      allowed: true;
      action: 'allow';
      reason: string;
      keys: string[];
    }
  | {
      allowed: false;
      action: 'defer';
      reason: string;
      keys: string[];
      availableAt: string;
    };

export class ConcurrencyControlService {
  public constructor(
    private readonly artifactDir: string,
    private readonly runRepository: FileRunRepository,
    private readonly evidenceLedgerService: EvidenceLedgerService,
    private readonly policy: ConcurrencyPolicy,
  ) {}

  public getPolicy(): ConcurrencyPolicy {
    return ConcurrencyPolicySchema.parse(this.policy);
  }

  public evaluate(input: {
    job: JobRecord;
    activeJobs: readonly JobRecord[];
    now?: Date | undefined;
  }): ConcurrencyDecision {
    const now = input.now ?? new Date();
    const policy = this.getPolicy();
    const activeRunningJobs = input.activeJobs.filter((job) => job.status === 'running');
    const candidateKeys = buildConcurrencyKeys(input.job);

    if (candidateKeys.length > 0) {
      const activeKeys = new Set(activeRunningJobs.flatMap((job) => buildConcurrencyKeys(job)));
      const conflictingKey = candidateKeys.find((key) => activeKeys.has(key));
      if (conflictingKey) {
        return {
          allowed: false,
          action: 'defer',
          reason: `Exclusive concurrency key ${conflictingKey} is already active.`,
          keys: candidateKeys,
          availableAt: new Date(now.getTime() + policy.deferDelayMs).toISOString(),
        };
      }
    }

    return {
      allowed: true,
      action: 'allow',
      reason: 'Concurrency policy allows this job to start.',
      keys: candidateKeys,
    };
  }

  public async recordDecision(input: {
    job: JobRecord;
    decision: ConcurrencyDecision;
    producer: string;
  }): Promise<void> {
    const run = await this.runRepository.getRun(input.job.runId);
    await this.evidenceLedgerService.appendEvidence({
      runId: input.job.runId,
      ...(input.job.taskId ? { taskId: input.job.taskId } : {}),
      stage: run.stage,
      kind: 'concurrency_decision',
      timestamp: new Date().toISOString(),
      producer: input.producer,
      artifactPaths: [getJobFile(this.artifactDir, input.job.runId, input.job.jobId)],
      summary: input.decision.reason,
      metadata: {
        jobId: input.job.jobId,
        action: input.decision.action,
        keys: input.decision.keys,
        ...(input.decision.allowed ? {} : { availableAt: input.decision.availableAt }),
      },
    });
  }
}
