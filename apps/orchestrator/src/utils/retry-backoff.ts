import type { RetryPolicy } from '../contracts';

export function calculateRetryDelayMs(policy: RetryPolicy, attempt: number): number {
  if (policy.backoffStrategy === 'fixed') {
    return policy.baseDelayMs;
  }

  const multiplier = Math.max(0, attempt - 1);
  return policy.baseDelayMs * Math.max(1, 2 ** multiplier);
}
