import { z } from 'zod';

import { TestResultStatusSchema } from './test-result';

export const TestEvidenceGradeSchema = z.enum([
  'placeholder',
  'compile-check',
  'unit',
  'integration',
]);

export type TestEvidenceGrade = z.infer<typeof TestEvidenceGradeSchema>;

export const TestEvidenceStrengthSchema = z.enum(['weak', 'strong']);

export type TestEvidenceStrength = z.infer<typeof TestEvidenceStrengthSchema>;

export const TestEvidenceSuiteAssessmentSchema = z.object({
  suite: z.string().min(1),
  status: TestResultStatusSchema,
  grade: TestEvidenceGradeSchema,
  strength: TestEvidenceStrengthSchema,
  countsTowardOverall: z.boolean(),
  rationale: z.string().min(1),
});

export type TestEvidenceSuiteAssessment = z.infer<typeof TestEvidenceSuiteAssessmentSchema>;

export const TestEvidenceAssessmentSchema = z.object({
  grade: TestEvidenceGradeSchema,
  strength: TestEvidenceStrengthSchema,
  summary: z.string().min(1),
  suiteAssessments: z.array(TestEvidenceSuiteAssessmentSchema).default([]),
});

export type TestEvidenceAssessment = z.infer<typeof TestEvidenceAssessmentSchema>;
