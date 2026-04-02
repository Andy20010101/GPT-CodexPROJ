import { z } from 'zod';

export const WorkerStatusSchema = z.enum([
  'idle',
  'polling',
  'running',
  'paused',
  'draining',
  'stopped',
]);

export type WorkerStatus = z.infer<typeof WorkerStatusSchema>;

export const WorkerRecordSchema = z.object({
  workerId: z.string().min(1),
  daemonId: z.string().uuid(),
  status: WorkerStatusSchema,
  currentJobId: z.string().uuid().optional(),
  startedAt: z.string().datetime(),
  lastHeartbeatAt: z.string().datetime(),
  metadata: z.record(z.unknown()).default({}),
});

export type WorkerRecord = z.infer<typeof WorkerRecordSchema>;
