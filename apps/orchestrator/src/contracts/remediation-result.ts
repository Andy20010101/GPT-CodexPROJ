import { z } from 'zod';

import { FailureToTaskSchema } from './failure-to-task';
import { RemediationActionSchema } from './remediation-action';
import { RemediationPlaybookCategorySchema } from './remediation-playbook';
import { SelfRepairPolicyDecisionSchema } from './self-repair-policy';

export const RemediationResultStatusSchema = z.enum([
  'proposed',
  'executed',
  'review_required',
  'manual_only',
  'failed',
]);

export type RemediationResultStatus = z.infer<typeof RemediationResultStatusSchema>;

export const RemediationResultSchema = z.object({
  remediationId: z.string().uuid(),
  runId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  jobId: z.string().uuid().optional(),
  failureId: z.string().uuid().optional(),
  incidentId: z.string().uuid().optional(),
  playbookId: z.string().min(1),
  category: RemediationPlaybookCategorySchema,
  status: RemediationResultStatusSchema,
  policyDecision: SelfRepairPolicyDecisionSchema,
  summary: z.string().min(1),
  proposal: FailureToTaskSchema.optional(),
  actions: z.array(RemediationActionSchema).default([]),
  artifactPaths: z.array(z.string().min(1)).default([]),
  metadata: z.record(z.unknown()).default({}),
  timestamp: z.string().datetime(),
});

export type RemediationResult = z.infer<typeof RemediationResultSchema>;
