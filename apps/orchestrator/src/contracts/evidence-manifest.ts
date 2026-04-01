import { z } from 'zod';

import { RunStageSchema } from './task-loop-state';

export const EvidenceKindSchema = z.enum([
  'requirement_freeze',
  'architecture_freeze',
  'task_graph',
  'task_note',
  'test_report',
  'review_note',
  'bridge_markdown',
  'bridge_structured_review',
  'gate_result',
]);

export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;

export const EvidenceManifestSchema = z.object({
  evidenceId: z.string().uuid(),
  runId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  stage: RunStageSchema,
  kind: EvidenceKindSchema,
  timestamp: z.string().datetime(),
  producer: z.string().min(1),
  artifactPaths: z.array(z.string().min(1)).min(1),
  summary: z.string().min(1),
  metadata: z.record(z.unknown()).default({}),
});

export type EvidenceManifest = z.infer<typeof EvidenceManifestSchema>;
