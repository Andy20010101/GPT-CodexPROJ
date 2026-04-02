import { z } from 'zod';

export const ExecutorTypeSchema = z.enum(['codex', 'command', 'noop']);

export type ExecutorType = z.infer<typeof ExecutorTypeSchema>;

export const ExecutorCapabilitySchema = z.object({
  type: ExecutorTypeSchema,
  description: z.string().min(1),
  supportsPatchOutput: z.boolean().default(false),
  supportsTestResults: z.boolean().default(false),
  supportsStructuredPrompt: z.boolean().default(false),
  supportsWorkspaceCommands: z.boolean().default(false),
});

export type ExecutorCapability = z.infer<typeof ExecutorCapabilitySchema>;
