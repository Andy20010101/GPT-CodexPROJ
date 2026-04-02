import { z } from 'zod';

export const PatchSummarySchema = z.object({
  changedFiles: z.array(z.string().min(1)).default([]),
  addedLines: z.number().int().nonnegative(),
  removedLines: z.number().int().nonnegative(),
  patchPath: z.string().min(1).optional(),
  notes: z.array(z.string().min(1)).default([]),
});

export type PatchSummary = z.infer<typeof PatchSummarySchema>;
