import { z } from 'zod';

export const PatchSimilaritySchema = z.enum(['identical', 'effectively_identical']);

export type PatchSimilarity = z.infer<typeof PatchSimilaritySchema>;

export const PatchFingerprintSchema = z.object({
  rawHash: z.string().regex(/^[0-9a-f]{64}$/u),
  semanticHash: z.string().regex(/^[0-9a-f]{64}$/u),
  changedFiles: z.array(z.string().min(1)).default([]),
  addedLines: z.number().int().nonnegative(),
  removedLines: z.number().int().nonnegative(),
});

export type PatchFingerprint = z.infer<typeof PatchFingerprintSchema>;

export const PatchConvergenceMatchSchema = z.object({
  reviewId: z.string().uuid(),
  executionId: z.string().uuid(),
  reviewStatus: z.enum(['changes_requested', 'rejected']),
  comparison: PatchSimilaritySchema,
  requestCreatedAt: z.string().datetime(),
  reviewTimestamp: z.string().datetime(),
  fingerprint: PatchFingerprintSchema,
});

export type PatchConvergenceMatch = z.infer<typeof PatchConvergenceMatchSchema>;

export const PatchConvergenceRecordSchema = z.object({
  runId: z.string().uuid(),
  taskId: z.string().uuid(),
  executionId: z.string().uuid(),
  status: z.literal('manual_attention_required'),
  reason: z.literal('repeated_patch_convergence_failed'),
  threshold: z.number().int().min(2),
  consecutiveRepeatCount: z.number().int().min(2),
  detectedAt: z.string().datetime(),
  summary: z.string().min(1),
  currentFingerprint: PatchFingerprintSchema,
  matchedHistory: z.array(PatchConvergenceMatchSchema).min(1),
});

export type PatchConvergenceRecord = z.infer<typeof PatchConvergenceRecordSchema>;
