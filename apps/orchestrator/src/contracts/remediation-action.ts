import { z } from 'zod';

export const RemediationActionKindSchema = z.enum([
  'capture_debug_snapshot',
  'generate_rollback_plan',
  'propose_remediation_task',
  'trigger_workspace_gc',
  'request_bridge_resume',
  'rerun_job',
  'manual_attention',
]);

export type RemediationActionKind = z.infer<typeof RemediationActionKindSchema>;

export const RemediationActionStatusSchema = z.enum(['pending', 'executed', 'skipped', 'failed']);
export type RemediationActionStatus = z.infer<typeof RemediationActionStatusSchema>;

export const RemediationActionSchema = z.object({
  actionId: z.string().uuid(),
  remediationId: z.string().uuid().optional(),
  kind: RemediationActionKindSchema,
  status: RemediationActionStatusSchema,
  summary: z.string().min(1),
  artifactPaths: z.array(z.string().min(1)).default([]),
  metadata: z.record(z.unknown()).default({}),
});

export type RemediationAction = z.infer<typeof RemediationActionSchema>;
