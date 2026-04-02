import { z } from 'zod';

export const RunnerCancellationOutcomeSchema = z.enum([
  'not_found',
  'terminate_requested',
  'graceful_terminated',
  'forced_kill',
  'already_exited',
]);
export type RunnerCancellationOutcome = z.infer<typeof RunnerCancellationOutcomeSchema>;

export const RunnerCancellationSchema = z.object({
  jobId: z.string().uuid(),
  processHandleId: z.string().uuid().optional(),
  outcome: RunnerCancellationOutcomeSchema,
  requestedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  gracefulSignal: z.string().min(1),
  forcedSignal: z.string().min(1),
  graceMs: z.number().int().min(0),
  forceKillAfterMs: z.number().int().min(0),
  metadata: z.record(z.unknown()).default({}),
});

export type RunnerCancellation = z.infer<typeof RunnerCancellationSchema>;
