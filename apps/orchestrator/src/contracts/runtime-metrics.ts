import { z } from 'zod';

import { ConcurrencyPolicySchema } from './concurrency-policy';
import { DaemonLifecycleStateSchema } from './daemon-state';

export const RuntimeMetricsSchema = z.object({
  daemonId: z.string().uuid(),
  daemonState: DaemonLifecycleStateSchema,
  workerCounts: z.object({
    idle: z.number().int().nonnegative(),
    polling: z.number().int().nonnegative(),
    running: z.number().int().nonnegative(),
    paused: z.number().int().nonnegative(),
    draining: z.number().int().nonnegative(),
    stopped: z.number().int().nonnegative(),
  }),
  queueDepth: z.object({
    queued: z.number().int().nonnegative(),
    runnable: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
    retriable: z.number().int().nonnegative(),
    running: z.number().int().nonnegative(),
  }),
  activeRunCount: z.number().int().nonnegative(),
  staleJobCount: z.number().int().nonnegative(),
  recentFailureCount: z.number().int().nonnegative(),
  recentRecoveryCount: z.number().int().nonnegative(),
  concurrencyPolicy: ConcurrencyPolicySchema,
  lastUpdatedAt: z.string().datetime(),
});

export type RuntimeMetrics = z.infer<typeof RuntimeMetricsSchema>;
