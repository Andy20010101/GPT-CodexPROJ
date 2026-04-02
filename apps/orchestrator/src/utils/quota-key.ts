import type { JobKind, QuotaPolicy } from '../contracts';

export function readJobKindQuota(policy: QuotaPolicy, kind: JobKind): number | null {
  const value = policy.maxConcurrentJobsPerKind[kind];
  return typeof value === 'number' ? value : null;
}
