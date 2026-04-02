import { z } from 'zod';

import { RemediationPlaybookCategorySchema } from './remediation-playbook';

export const SelfRepairPolicyDecisionSchema = z.enum([
  'auto_allowed',
  'review_required',
  'manual_only',
]);

export type SelfRepairPolicyDecision = z.infer<typeof SelfRepairPolicyDecisionSchema>;

export const SelfRepairPolicySchema = z.object({
  autoAllowedCategories: z.array(RemediationPlaybookCategorySchema).default([]),
  reviewRequiredCategories: z.array(RemediationPlaybookCategorySchema).default([]),
  manualOnlyCategories: z.array(RemediationPlaybookCategorySchema).default([]),
  prohibitedPathPatterns: z.array(z.string().min(1)).default([]),
});

export type SelfRepairPolicy = z.infer<typeof SelfRepairPolicySchema>;

export const SelfRepairPolicyDecisionRecordSchema = z.object({
  decisionId: z.string().uuid(),
  runId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  category: RemediationPlaybookCategorySchema,
  decision: SelfRepairPolicyDecisionSchema,
  reason: z.string().min(1),
  targetPaths: z.array(z.string().min(1)).default([]),
  decidedAt: z.string().datetime(),
  metadata: z.record(z.unknown()).default({}),
});

export type SelfRepairPolicyDecisionRecord = z.infer<typeof SelfRepairPolicyDecisionRecordSchema>;
