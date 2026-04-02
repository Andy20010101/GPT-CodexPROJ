import { z } from 'zod';

export const ReviewStatusSchema = z.enum([
  'approved',
  'changes_requested',
  'rejected',
  'incomplete',
]);

export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

export const ReviewBridgeArtifactsSchema = z.object({
  conversationId: z.string().uuid().optional(),
  markdownPath: z.string().min(1).optional(),
  markdownManifestPath: z.string().min(1).optional(),
  structuredReviewPath: z.string().min(1).optional(),
  structuredReviewManifestPath: z.string().min(1).optional(),
});

export type ReviewBridgeArtifacts = z.infer<typeof ReviewBridgeArtifactsSchema>;

export const ReviewResultSchema = z.object({
  reviewId: z.string().uuid(),
  runId: z.string().uuid(),
  taskId: z.string().uuid(),
  executionId: z.string().uuid(),
  status: ReviewStatusSchema,
  summary: z.string().min(1),
  findings: z.array(z.string().min(1)).default([]),
  missingTests: z.array(z.string().min(1)).default([]),
  architectureConcerns: z.array(z.string().min(1)).default([]),
  recommendedActions: z.array(z.string().min(1)).default([]),
  bridgeArtifacts: ReviewBridgeArtifactsSchema.default({}),
  rawStructuredReview: z.record(z.unknown()).nullable().default(null),
  metadata: z.record(z.unknown()).default({}),
  timestamp: z.string().datetime(),
});

export type ReviewResult = z.infer<typeof ReviewResultSchema>;
