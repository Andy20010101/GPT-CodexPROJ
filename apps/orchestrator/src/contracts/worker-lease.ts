import { z } from 'zod';

export const WorkerLeaseSchema = z.object({
  leaseId: z.string().uuid(),
  workerId: z.string().min(1),
  jobId: z.string().uuid(),
  acquiredAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  heartbeatIntervalMs: z.number().int().nonnegative(),
  metadata: z.record(z.unknown()).default({}),
});

export type WorkerLease = z.infer<typeof WorkerLeaseSchema>;
