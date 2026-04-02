import { z } from 'zod';

export const ProcessHandleStatusSchema = z.enum([
  'running',
  'exited',
  'terminated',
  'killed',
  'failed_to_start',
]);
export type ProcessHandleStatus = z.infer<typeof ProcessHandleStatusSchema>;

export const ProcessHandleSchema = z.object({
  processHandleId: z.string().uuid(),
  runId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  jobId: z.string().uuid(),
  workspacePath: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  pid: z.number().int().positive().optional(),
  status: ProcessHandleStatusSchema,
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  exitCode: z.number().int().nullable().optional(),
  signal: z.string().nullable().optional(),
  durationMs: z.number().int().min(0).optional(),
  metadata: z.record(z.unknown()).default({}),
});

export type ProcessHandle = z.infer<typeof ProcessHandleSchema>;
