import type { CleanupPolicy, FailureTaxonomy } from '../contracts';

export function computeSnapshotRetention(input: {
  createdAt: string;
  policy: CleanupPolicy;
  failureCategory?: FailureTaxonomy | undefined;
}): string {
  const base = new Date(input.createdAt).getTime();
  const multiplier =
    input.failureCategory === 'drift' || input.failureCategory === 'runner' ? 2 : 1;
  return new Date(base + input.policy.ttlMs * multiplier).toISOString();
}
