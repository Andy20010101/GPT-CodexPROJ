import { z } from 'zod';

export const PlanningProofReportSchema = z.object({
  proofId: z.string().uuid(),
  runId: z.string().uuid(),
  mode: z.enum(['mock_assisted', 'real']),
  rawPrompt: z.string().min(1),
  requirementConversationId: z.string().uuid(),
  architectureConversationId: z.string().uuid(),
  taskGraphConversationId: z.string().uuid(),
  firstTaskId: z.string().uuid(),
  firstTaskReviewId: z.string().uuid(),
  firstTaskAccepted: z.boolean(),
  downstreamUnlockedTaskIds: z.array(z.string().uuid()).default([]),
  planningSufficiencyStatus: z.enum([
    'passed',
    'planning_incomplete',
    'planning_invalid',
    'planning_requires_manual_review',
  ]),
  createdAt: z.string().datetime(),
  metadata: z.record(z.unknown()).default({}),
});

export type PlanningProofReport = z.infer<typeof PlanningProofReportSchema>;
