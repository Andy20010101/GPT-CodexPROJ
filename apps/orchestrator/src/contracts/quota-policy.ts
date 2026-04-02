import { z } from 'zod';

import { JobKindSchema } from './job-record';

const jobKindQuotaShape = Object.fromEntries(
  JobKindSchema.options.map((kind) => [kind, z.number().int().min(0)]),
) as Record<(typeof JobKindSchema.options)[number], z.ZodNumber>;

export const JobKindQuotaSchema = z.object(jobKindQuotaShape).partial().default({});
export type JobKindQuota = z.infer<typeof JobKindQuotaSchema>;

export const ReservedSlotSchema = z.object({
  kind: JobKindSchema,
  slots: z.number().int().min(0),
});
export type ReservedSlot = z.infer<typeof ReservedSlotSchema>;

export const QuotaPolicySchema = z.object({
  maxConcurrentJobsGlobal: z.number().int().min(1),
  maxConcurrentJobsPerRun: z.number().int().min(1),
  maxConcurrentJobsPerKind: JobKindQuotaSchema,
  reservedSlots: z.array(ReservedSlotSchema).default([]),
});

export type QuotaPolicy = z.infer<typeof QuotaPolicySchema>;
