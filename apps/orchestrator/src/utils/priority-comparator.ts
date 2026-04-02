import type { JobRecord, PriorityLevel } from '../contracts';

const priorityWeight: Record<PriorityLevel, number> = {
  urgent: 4,
  high: 3,
  normal: 2,
  low: 1,
};

export function comparePriorityLevels(left: PriorityLevel, right: PriorityLevel): number {
  return priorityWeight[right] - priorityWeight[left];
}

export function compareJobsByPriority(left: JobRecord, right: JobRecord): number {
  const priorityDiff = comparePriorityLevels(left.priority, right.priority);
  if (priorityDiff !== 0) {
    return priorityDiff;
  }
  const leftStarted = left.availableAt ?? left.createdAt;
  const rightStarted = right.availableAt ?? right.createdAt;
  if (leftStarted === rightStarted) {
    return left.createdAt.localeCompare(right.createdAt);
  }
  return leftStarted.localeCompare(rightStarted);
}
