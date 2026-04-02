import { z } from 'zod';

export const CleanupModeSchema = z.enum(['immediate', 'delayed', 'manual']);
export type CleanupMode = z.infer<typeof CleanupModeSchema>;

export const CleanupPolicySchema = z.object({
  ttlMs: z.number().int().min(0),
  retainOnFailure: z.boolean().default(true),
  retainOnRejectedReview: z.boolean().default(true),
  retainOnDebug: z.boolean().default(true),
  maxRetainedPerRun: z.number().int().min(0).default(5),
  cleanupMode: CleanupModeSchema.default('delayed'),
});

export type CleanupPolicy = z.infer<typeof CleanupPolicySchema>;
