import { z } from 'zod';

export const DaemonControlActionSchema = z.enum(['start', 'pause', 'resume', 'drain', 'shutdown']);

export type DaemonControlAction = z.infer<typeof DaemonControlActionSchema>;

export const DaemonControlSchema = z.object({
  controlId: z.string().uuid(),
  action: DaemonControlActionSchema,
  requestedAt: z.string().datetime(),
  requestedBy: z.string().min(1),
  reason: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).default({}),
});

export type DaemonControl = z.infer<typeof DaemonControlSchema>;
