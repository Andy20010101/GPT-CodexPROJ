import { z } from 'zod';

import { StabilityIncidentSchema } from './stability-incident';

export const ValidationModeSchema = z.enum(['mock_assisted', 'real']);
export type ValidationMode = z.infer<typeof ValidationModeSchema>;

export const ValidationVerdictSchema = z.enum(['passed', 'passed_with_manual_attention', 'failed']);

export type ValidationVerdict = z.infer<typeof ValidationVerdictSchema>;

export const ValidationExecutionSummarySchema = z.object({
  taskId: z.string().uuid(),
  executionId: z.string().uuid(),
  status: z.enum(['succeeded', 'failed', 'partial']),
  summary: z.string().min(1),
});

export const ValidationReviewSummarySchema = z.object({
  taskId: z.string().uuid(),
  reviewId: z.string().uuid(),
  status: z.enum(['approved', 'changes_requested', 'rejected', 'incomplete']),
  summary: z.string().min(1),
});

export const ValidationReleaseSummarySchema = z.object({
  releaseReviewId: z.string().uuid(),
  status: z.enum(['approved', 'changes_requested', 'rejected', 'incomplete']),
  summary: z.string().min(1),
});

export const ValidationReportSchema = z.object({
  validationId: z.string().uuid(),
  runId: z.string().uuid(),
  mode: ValidationModeSchema,
  tasksExecuted: z.array(z.string().uuid()).default([]),
  executionResults: z.array(ValidationExecutionSummarySchema).default([]),
  reviewResults: z.array(ValidationReviewSummarySchema).default([]),
  releaseResult: ValidationReleaseSummarySchema.nullable().default(null),
  incidents: z.array(StabilityIncidentSchema).default([]),
  retainedWorkspaces: z.array(z.string().uuid()).default([]),
  rollbackEvents: z.array(z.string().uuid()).default([]),
  unresolvedIssues: z.array(z.string().min(1)).default([]),
  verdict: ValidationVerdictSchema,
  createdAt: z.string().datetime(),
  metadata: z.record(z.unknown()).default({}),
});

export type ValidationReport = z.infer<typeof ValidationReportSchema>;
