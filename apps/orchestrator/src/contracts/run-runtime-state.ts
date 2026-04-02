import { z } from 'zod';

export const RunRuntimeStatusSchema = z.enum([
  'idle',
  'queued',
  'running',
  'blocked',
  'release_pending',
  'accepted',
]);

export type RunRuntimeStatus = z.infer<typeof RunRuntimeStatusSchema>;

export const RunRuntimeStateSchema = z.object({
  runId: z.string().uuid(),
  status: RunRuntimeStatusSchema,
  queuedJobs: z.number().int().min(0),
  runningJobs: z.number().int().min(0),
  retriableJobs: z.number().int().min(0),
  failedJobs: z.number().int().min(0),
  blockedJobs: z.number().int().min(0),
  runnableTaskIds: z.array(z.string().uuid()).default([]),
  blockedTaskIds: z.array(z.string().uuid()).default([]),
  acceptedTaskIds: z.array(z.string().uuid()).default([]),
  nextQueueAt: z.string().datetime().optional(),
  lastRecoveryAt: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).default({}),
});

export type RunRuntimeState = z.infer<typeof RunRuntimeStateSchema>;
