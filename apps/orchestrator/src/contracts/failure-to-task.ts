import { z } from 'zod';

import { EvidenceKindSchema } from './evidence-manifest';
import {
  RemediationPlaybookCategorySchema,
  RemediationRiskLevelSchema,
} from './remediation-playbook';

export const FailureToTaskSchema = z.object({
  proposalId: z.string().uuid(),
  runId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  sourceFailureId: z.string().uuid().optional(),
  sourceIncidentId: z.string().uuid().optional(),
  suggestedTaskTitle: z.string().min(1),
  objective: z.string().min(1),
  riskLevel: RemediationRiskLevelSchema,
  allowedFiles: z.array(z.string().min(1)).default([]),
  requiredEvidenceKinds: z.array(EvidenceKindSchema).default([]),
  recommendedPlaybook: RemediationPlaybookCategorySchema,
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime(),
});

export type FailureToTask = z.infer<typeof FailureToTaskSchema>;
