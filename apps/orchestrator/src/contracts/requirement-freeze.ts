import { z } from 'zod';

export const RequirementConstraintSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  severity: z.enum(['hard', 'soft']),
  rationale: z.string().min(1).optional(),
});

export type RequirementConstraint = z.infer<typeof RequirementConstraintSchema>;

export const AcceptanceCriterionSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  verificationMethod: z.enum(['automated_test', 'review', 'manual', 'artifact']),
  measurableOutcome: z.string().min(1).optional(),
  requiredEvidenceKinds: z.array(z.string().min(1)).default([]),
});

export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>;

export const RequirementRiskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  severity: z.enum(['low', 'medium', 'high']),
  mitigation: z.string().min(1).optional(),
});

export const RequirementFreezeSchema = z.object({
  runId: z.string().uuid(),
  title: z.string().min(1),
  summary: z.string().min(1),
  objectives: z.array(z.string().min(1)).min(1),
  nonGoals: z.array(z.string().min(1)).default([]),
  constraints: z.array(RequirementConstraintSchema).default([]),
  risks: z.array(RequirementRiskSchema).default([]),
  acceptanceCriteria: z.array(AcceptanceCriterionSchema).min(1),
  frozenAt: z.string().datetime(),
  frozenBy: z.string().min(1),
});

export type RequirementFreeze = z.infer<typeof RequirementFreezeSchema>;
