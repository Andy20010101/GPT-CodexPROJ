import { z } from 'zod';

export const ReviewEvidenceSchema = z.object({
  reviewId: z.string().uuid(),
  runId: z.string().uuid(),
  taskId: z.string().uuid(),
  executionId: z.string().uuid(),
  requestPath: z.string().min(1),
  runtimeStatePath: z.string().min(1).optional(),
  resultPath: z.string().min(1),
  markdownPath: z.string().min(1).optional(),
  structuredReviewPath: z.string().min(1).optional(),
  bridgeArtifactPaths: z.array(z.string().min(1)).default([]),
  evidenceIds: z.array(z.string().uuid()).default([]),
});

export type ReviewEvidence = z.infer<typeof ReviewEvidenceSchema>;
