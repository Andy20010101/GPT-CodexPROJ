import { z } from 'zod';

export const RetryBackoffStrategySchema = z.enum(['fixed', 'exponential']);
export type RetryBackoffStrategy = z.infer<typeof RetryBackoffStrategySchema>;

export const RetryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1),
  backoffStrategy: RetryBackoffStrategySchema.default('fixed'),
  baseDelayMs: z.number().int().min(0).default(0),
});

export type RetryPolicy = z.infer<typeof RetryPolicySchema>;
