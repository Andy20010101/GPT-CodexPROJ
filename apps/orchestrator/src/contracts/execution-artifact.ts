import { z } from 'zod';

export const ExecutionArtifactKindSchema = z.enum([
  'patch',
  'test-log',
  'command-log',
  'review-input',
  'review-output',
  'build-log',
]);

export type ExecutionArtifactKind = z.infer<typeof ExecutionArtifactKindSchema>;

export const ExecutionArtifactSchema = z.object({
  artifactId: z.string().uuid(),
  kind: ExecutionArtifactKindSchema,
  label: z.string().min(1),
  path: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).default({}),
});

export type ExecutionArtifact = z.infer<typeof ExecutionArtifactSchema>;
