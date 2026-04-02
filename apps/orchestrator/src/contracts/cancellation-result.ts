import { z } from 'zod';

export const CancellationOutcomeSchema = z.enum([
  'cancelled',
  'cancellation_requested',
  'already_finished',
  'not_found',
  'rejected',
]);

export type CancellationOutcome = z.infer<typeof CancellationOutcomeSchema>;

export const CancellationResultSchema = z.object({
  cancellationId: z.string().uuid(),
  jobId: z.string().uuid(),
  runId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  outcome: CancellationOutcomeSchema,
  message: z.string().min(1),
  timestamp: z.string().datetime(),
  metadata: z.record(z.unknown()).default({}),
});

export type CancellationResult = z.infer<typeof CancellationResultSchema>;
