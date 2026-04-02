import { z } from 'zod';

export const ReleaseReviewStatusSchema = z.enum([
  'approved',
  'changes_requested',
  'rejected',
  'incomplete',
]);

export type ReleaseReviewStatus = z.infer<typeof ReleaseReviewStatusSchema>;

export const ReleaseBridgeArtifactsSchema = z.object({
  conversationId: z.string().uuid().optional(),
  markdownPath: z.string().optional(),
  markdownManifestPath: z.string().optional(),
  structuredReviewPath: z.string().optional(),
  structuredReviewManifestPath: z.string().optional(),
});

export const ReleaseReviewResultSchema = z.object({
  releaseReviewId: z.string().uuid(),
  runId: z.string().uuid(),
  status: ReleaseReviewStatusSchema,
  summary: z.string().min(1),
  findings: z.array(z.string().min(1)).default([]),
  outstandingLimitations: z.array(z.string().min(1)).default([]),
  recommendedActions: z.array(z.string().min(1)).default([]),
  bridgeArtifacts: ReleaseBridgeArtifactsSchema,
  rawStructuredReview: z.record(z.unknown()).nullable(),
  metadata: z.record(z.unknown()).default({}),
  timestamp: z.string().datetime(),
});

export type ReleaseReviewResult = z.infer<typeof ReleaseReviewResultSchema>;
