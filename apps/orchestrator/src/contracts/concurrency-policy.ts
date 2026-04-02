import { z } from 'zod';

export const ExclusiveConcurrencyKeysSchema = z.object({
  task: z.boolean().default(true),
  workspace: z.boolean().default(true),
});

export type ExclusiveConcurrencyKeys = z.infer<typeof ExclusiveConcurrencyKeysSchema>;

export const ConcurrencyPolicySchema = z.object({
  maxConcurrentJobs: z.number().int().positive(),
  maxConcurrentJobsPerRun: z.number().int().positive(),
  deferDelayMs: z.number().int().nonnegative().default(250),
  exclusiveKeys: ExclusiveConcurrencyKeysSchema.default({
    task: true,
    workspace: true,
  }),
});

export type ConcurrencyPolicy = z.infer<typeof ConcurrencyPolicySchema>;
