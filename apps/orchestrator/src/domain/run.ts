import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { RunStageSchema, type RunStage } from '../contracts/task-loop-state';

export const RunRecordSchema = z.object({
  runId: z.string().uuid(),
  title: z.string().min(1),
  summary: z.string().min(1).optional(),
  createdBy: z.string().min(1),
  stage: RunStageSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  requirementFreezePath: z.string().min(1).optional(),
  architectureFreezePath: z.string().min(1).optional(),
  taskGraphPath: z.string().min(1).optional(),
});

export type RunRecord = z.infer<typeof RunRecordSchema>;

export function createRunRecord(input: {
  title: string;
  createdBy: string;
  summary?: string | undefined;
  stage?: RunStage | undefined;
}): RunRecord {
  const timestamp = new Date().toISOString();

  return RunRecordSchema.parse({
    runId: randomUUID(),
    title: input.title,
    createdBy: input.createdBy,
    ...(input.summary ? { summary: input.summary } : {}),
    stage: input.stage ?? 'intake',
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}
