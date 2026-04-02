import type { JobRecord, SchedulingPolicy, SchedulingState } from '../contracts';
import { SchedulingPolicySchema, SchedulingStateSchema } from '../contracts';
import { FileRunRepository } from '../storage/file-run-repository';
import { FileSchedulingRepository } from '../storage/file-scheduling-repository';
import { EvidenceLedgerService } from './evidence-ledger-service';
import { PriorityQueueService } from './priority-queue-service';
import { QuotaControlService } from './quota-control-service';

export class SchedulingPolicyService {
  public constructor(
    private readonly schedulingRepository: FileSchedulingRepository,
    private readonly runRepository: FileRunRepository,
    private readonly evidenceLedgerService: EvidenceLedgerService,
    private readonly priorityQueueService: PriorityQueueService,
    private readonly quotaControlService: QuotaControlService,
    private readonly policy: SchedulingPolicy,
  ) {}

  public getPolicy(): SchedulingPolicy {
    return SchedulingPolicySchema.parse(this.policy);
  }

  public orderRunnableJobs(input: {
    jobs: readonly JobRecord[];
    activeJobs: readonly JobRecord[];
    now?: Date | undefined;
  }): JobRecord[] {
    return this.priorityQueueService.orderJobs({
      ...input,
      policy: this.getPolicy(),
    });
  }

  public async recordState(input: {
    runnableJobs: readonly JobRecord[];
    blockedJobs: readonly JobRecord[];
    selectedJobs: readonly JobRecord[];
    activeJobs: readonly JobRecord[];
  }): Promise<SchedulingState> {
    const state = SchedulingStateSchema.parse({
      updatedAt: new Date().toISOString(),
      policy: this.getPolicy(),
      runnableJobIds: input.runnableJobs.map((job) => job.jobId),
      blockedJobIds: input.blockedJobs.map((job) => job.jobId),
      selectedJobIds: input.selectedJobs.map((job) => job.jobId),
      activeRunIds: [...new Set(input.activeJobs.map((job) => job.runId))],
      notes: [],
    });
    await this.schedulingRepository.saveState(state);
    const runs = await this.runRepository.listRuns();
    for (const run of runs.filter((entry) => entry.stage !== 'accepted')) {
      await this.evidenceLedgerService.appendEvidence({
        runId: run.runId,
        stage: run.stage,
        kind: 'scheduling_decision',
        timestamp: state.updatedAt,
        producer: 'scheduling-policy-service',
        artifactPaths: [await this.schedulingRepository.saveState(state)],
        summary: `Scheduling state refreshed with ${state.selectedJobIds.length} selected job(s).`,
        metadata: {
          runnableJobIds: state.runnableJobIds,
          blockedJobIds: state.blockedJobIds,
          selectedJobIds: state.selectedJobIds,
        },
      });
    }
    return state;
  }

  public async getState(): Promise<SchedulingState | null> {
    return this.schedulingRepository.getState();
  }

  public async evaluateQuota(input: {
    job: JobRecord;
    activeJobs: readonly JobRecord[];
    producer: string;
    now?: Date | undefined;
  }) {
    const decision = this.quotaControlService.evaluate(input);
    await this.quotaControlService.recordDecision({
      job: input.job,
      decision,
      producer: input.producer,
    });
    return decision;
  }
}
