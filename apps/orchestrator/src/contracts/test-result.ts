import { z } from 'zod';

export const TestResultStatusSchema = z.enum(['passed', 'failed', 'skipped', 'unknown']);

export type TestResultStatus = z.infer<typeof TestResultStatusSchema>;

export const TestResultSchema = z.object({
  suite: z.string().min(1),
  status: TestResultStatusSchema,
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  rawArtifactPath: z.string().min(1).optional(),
});

export type TestResult = z.infer<typeof TestResultSchema>;
