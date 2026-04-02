import { z } from 'zod';

export const HeartbeatKindSchema = z.enum(['worker', 'job']);

export type HeartbeatKind = z.infer<typeof HeartbeatKindSchema>;

export const HeartbeatRecordSchema = z.object({
  heartbeatId: z.string().uuid(),
  daemonId: z.string().uuid(),
  workerId: z.string().min(1),
  jobId: z.string().uuid().optional(),
  runId: z.string().uuid().optional(),
  timestamp: z.string().datetime(),
  kind: HeartbeatKindSchema,
  metadata: z.record(z.unknown()).default({}),
});

export type HeartbeatRecord = z.infer<typeof HeartbeatRecordSchema>;
