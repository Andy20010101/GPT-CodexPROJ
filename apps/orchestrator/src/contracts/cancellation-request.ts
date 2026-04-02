import { z } from 'zod';

export const CancellationRequestStateSchema = z.enum([
  'requested',
  'acknowledged',
  'completed',
  'rejected',
]);

export type CancellationRequestState = z.infer<typeof CancellationRequestStateSchema>;

export const CancellationRequestSchema = z.object({
  cancellationId: z.string().uuid(),
  jobId: z.string().uuid(),
  runId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  requestedAt: z.string().datetime(),
  requestedBy: z.string().min(1),
  reason: z.string().min(1).optional(),
  state: CancellationRequestStateSchema,
  metadata: z.record(z.unknown()).default({}),
});

export type CancellationRequest = z.infer<typeof CancellationRequestSchema>;
