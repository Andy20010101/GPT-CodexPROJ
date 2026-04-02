import { z } from 'zod';

import { EvidenceKindSchema } from './evidence-manifest';

export const RemediationPlaybookCategorySchema = z.enum([
  'bridge_drift_recovery',
  'runner_timeout_recovery',
  'workspace_cleanup_repair',
  'evidence_gap_repair',
  'prompt_template_repair',
  'selector_update_review',
  'retry_policy_tuning',
  'manual_attention',
]);

export type RemediationPlaybookCategory = z.infer<typeof RemediationPlaybookCategorySchema>;

export const RemediationRiskLevelSchema = z.enum(['low', 'medium', 'high']);
export type RemediationRiskLevel = z.infer<typeof RemediationRiskLevelSchema>;

export const RemediationPlaybookSchema = z.object({
  playbookId: z.string().min(1),
  category: RemediationPlaybookCategorySchema,
  title: z.string().min(1),
  description: z.string().min(1),
  riskLevel: RemediationRiskLevelSchema,
  defaultAllowedFiles: z.array(z.string().min(1)).default([]),
  requiredEvidenceKinds: z.array(EvidenceKindSchema).default([]),
  autoExecutable: z.boolean().default(false),
});

export type RemediationPlaybook = z.infer<typeof RemediationPlaybookSchema>;
