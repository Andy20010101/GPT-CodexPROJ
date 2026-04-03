import { z } from 'zod';

import { ArchitectureFreezeSchema } from './architecture-freeze';
import { PlanningPhaseSchema } from './planning-phase';
import { RequirementFreezeSchema } from './requirement-freeze';
import { TaskGraphSchema } from './task-graph';

export const PlanningTaskDefinitionSchema = z.object({
  taskId: z.string().min(1).optional(),
  title: z.string().min(1),
  objective: z.string().min(1),
  executorType: z.enum(['codex', 'command', 'noop']).optional(),
  scope: z
    .object({
      inScope: z.array(z.string().min(1)).min(1),
      outOfScope: z.array(z.string().min(1)).default([]),
    })
    .optional(),
  allowedFiles: z.array(z.string().min(1)).default([]),
  disallowedFiles: z.array(z.string().min(1)).default([]),
  dependencies: z.array(z.string().min(1)).default([]),
  acceptanceCriteria: z
    .array(
      z.object({
        id: z.string().min(1).optional(),
        description: z.string().min(1),
        verificationMethod: z.enum(['automated_test', 'review', 'manual', 'artifact']).optional(),
        measurableOutcome: z.string().min(1).optional(),
        requiredEvidenceKinds: z.array(z.string().min(1)).default([]),
      }),
    )
    .min(1),
  testPlan: z
    .array(
      z.object({
        id: z.string().min(1).optional(),
        description: z.string().min(1),
        verificationCommand: z.string().min(1).optional(),
        expectedRedSignal: z.string().min(1),
        expectedGreenSignal: z.string().min(1),
      }),
    )
    .default([]),
  implementationNotes: z.array(z.string().min(1)).default([]),
  metadata: z.record(z.unknown()).default({}),
});

export type PlanningTaskDefinition = z.infer<typeof PlanningTaskDefinitionSchema>;

export const PlanningTaskGraphOutputSchema = z.object({
  tasks: z.array(PlanningTaskDefinitionSchema).min(1),
  edges: z
    .array(
      z.object({
        fromTaskId: z.string().min(1),
        toTaskId: z.string().min(1),
        kind: z.enum(['blocks', 'informs']),
      }),
    )
    .default([]),
});

export type PlanningTaskGraphOutput = z.infer<typeof PlanningTaskGraphOutputSchema>;

export const PlanningMaterializedResultSchema = z.object({
  planningId: z.string().uuid(),
  runId: z.string().uuid(),
  phase: PlanningPhaseSchema,
  conversationId: z.string().uuid(),
  conversationUrl: z.string().url().optional(),
  materializedAt: z.string().datetime(),
  producer: z.string().min(1),
  markdownPath: z.string().min(1),
  markdownManifestPath: z.string().min(1),
  structuredResultPath: z.string().min(1),
  structuredResultManifestPath: z.string().min(1),
  payload: z.record(z.unknown()),
  normalizedResult: z
    .union([RequirementFreezeSchema, ArchitectureFreezeSchema, TaskGraphSchema])
    .optional(),
  metadata: z.record(z.unknown()).default({}),
});

export type PlanningMaterializedResult = z.infer<typeof PlanningMaterializedResultSchema>;
