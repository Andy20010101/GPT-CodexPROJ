import { z } from 'zod';

export const ReleaseAcceptanceSchema = z.object({
  acceptanceId: z.string().uuid(),
  runId: z.string().uuid(),
  releaseReviewId: z.string().uuid(),
  gateId: z.string().uuid(),
  acceptedAt: z.string().datetime(),
  acceptedBy: z.string().min(1),
  summary: z.string().min(1),
});

export type ReleaseAcceptance = z.infer<typeof ReleaseAcceptanceSchema>;
