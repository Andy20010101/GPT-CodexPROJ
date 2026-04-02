import { z } from 'zod';

export const DaemonLifecycleStateSchema = z.enum([
  'starting',
  'running',
  'paused',
  'draining',
  'stopped',
  'degraded',
]);

export type DaemonLifecycleState = z.infer<typeof DaemonLifecycleStateSchema>;

export const DaemonStateSchema = z.object({
  daemonId: z.string().uuid(),
  state: DaemonLifecycleStateSchema,
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  pausedAt: z.string().datetime().optional(),
  drainingAt: z.string().datetime().optional(),
  stoppedAt: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).default({}),
});

export type DaemonState = z.infer<typeof DaemonStateSchema>;
