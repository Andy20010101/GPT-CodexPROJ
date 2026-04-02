import type { JobRecord, SchedulingPolicy } from '../contracts';
import { compareJobsByPriority } from '../utils/priority-comparator';

export class PriorityQueueService {
  public orderJobs(input: {
    jobs: readonly JobRecord[];
    activeJobs: readonly JobRecord[];
    policy: SchedulingPolicy;
    now?: Date | undefined;
  }): JobRecord[] {
    const now = input.now ?? new Date();
    const activePerRun = input.activeJobs.reduce<Record<string, number>>((accumulator, job) => {
      if (job.status === 'running') {
        accumulator[job.runId] = (accumulator[job.runId] ?? 0) + 1;
      }
      return accumulator;
    }, {});

    return [...input.jobs].sort((left, right) => {
      const boostedLeft = boostReleasePriority(left, input.policy, now);
      const boostedRight = boostReleasePriority(right, input.policy, now);
      const priorityDiff = compareJobsByPriority(
        { ...left, priority: boostedLeft },
        { ...right, priority: boostedRight },
      );
      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      const runLoadDiff = (activePerRun[left.runId] ?? 0) - (activePerRun[right.runId] ?? 0);
      if (runLoadDiff !== 0) {
        return runLoadDiff;
      }

      return left.createdAt.localeCompare(right.createdAt);
    });
  }
}

function boostReleasePriority(
  job: JobRecord,
  policy: SchedulingPolicy,
  now: Date,
): JobRecord['priority'] {
  if (job.kind !== 'release_review') {
    return job.priority;
  }
  const availableAt = new Date(job.availableAt ?? job.createdAt);
  if (now.getTime() - availableAt.getTime() < policy.releaseReviewBoostMs) {
    return job.priority;
  }
  if (job.priority === 'low' || job.priority === 'normal') {
    return 'high';
  }
  return job.priority;
}
