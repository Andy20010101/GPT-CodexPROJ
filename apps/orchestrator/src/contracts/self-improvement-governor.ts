import { z } from 'zod';

export const SelfImprovementTodoSectionSchema = z.enum(['Ordered Execution Queue']);
export type SelfImprovementTodoSection = z.infer<typeof SelfImprovementTodoSectionSchema>;

export const SelfImprovementTodoGoalSchema = z.object({
  todoId: z.string().min(1),
  title: z.string().min(1),
  section: SelfImprovementTodoSectionSchema,
  autoRunnable: z.boolean(),
});

export type SelfImprovementTodoGoal = z.infer<typeof SelfImprovementTodoGoalSchema>;

export const SelfImprovementRunTerminalOutcomeSchema = z.enum([
  'non_terminal',
  'accepted',
  'manual_attention_required',
]);

export type SelfImprovementRunTerminalOutcome = z.infer<
  typeof SelfImprovementRunTerminalOutcomeSchema
>;

export const SelfImprovementRunTerminalStateSchema = z.object({
  version: z.literal(1),
  runId: z.string().uuid(),
  classifiedAt: z.string().datetime(),
  terminal: z.boolean(),
  outcome: SelfImprovementRunTerminalOutcomeSchema,
  reason: z.string().min(1),
  runStage: z.string().min(1),
  runtimeStatus: z.string().min(1),
  taskGraphRegistered: z.boolean(),
  totalTasks: z.number().int().nonnegative(),
  acceptedTasks: z.number().int().nonnegative(),
  runnableTasks: z.number().int().nonnegative(),
  blockedTasks: z.number().int().nonnegative(),
  queuedJobs: z.number().int().nonnegative(),
  runningJobs: z.number().int().nonnegative(),
  retriableJobs: z.number().int().nonnegative(),
  failedJobs: z.number().int().nonnegative(),
  blockedJobs: z.number().int().nonnegative(),
  hasRunAcceptance: z.boolean(),
});

export type SelfImprovementRunTerminalState = z.infer<
  typeof SelfImprovementRunTerminalStateSchema
>;

export const SelfImprovementRunGoalSchema = z.object({
  version: z.literal(1),
  runId: z.string().uuid(),
  selectedAt: z.string().datetime(),
  profileId: z.string().min(1),
  goal: SelfImprovementTodoGoalSchema,
  allowedFiles: z.array(z.string().min(1)).min(1),
  disallowedFiles: z.array(z.string().min(1)).default([]),
});

export type SelfImprovementRunGoal = z.infer<typeof SelfImprovementRunGoalSchema>;

export const SelfImprovementCampaignIterationSchema = z.object({
  iteration: z.number().int().positive(),
  runId: z.string().uuid(),
  goal: SelfImprovementTodoGoalSchema,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  terminalState: SelfImprovementRunTerminalStateSchema.optional(),
});

export type SelfImprovementCampaignIteration = z.infer<
  typeof SelfImprovementCampaignIterationSchema
>;

export const SelfImprovementCampaignStopReasonSchema = z.enum([
  'iteration_cap_reached',
  'terminal_outcome_requires_operator',
  'no_ordered_goal_remaining',
  'next_goal_not_auto_runnable',
]);

export type SelfImprovementCampaignStopReason = z.infer<
  typeof SelfImprovementCampaignStopReasonSchema
>;

export const SelfImprovementCampaignStateSchema = z.object({
  version: z.literal(1),
  campaignId: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  iterationCap: z.number().int().positive(),
  activeRunId: z.string().uuid().optional(),
  activeGoal: SelfImprovementTodoGoalSchema.optional(),
  iterationsStarted: z.number().int().nonnegative(),
  iterationsCompleted: z.number().int().nonnegative(),
  history: z.array(SelfImprovementCampaignIterationSchema),
  lastTerminalState: SelfImprovementRunTerminalStateSchema.optional(),
  stopReason: SelfImprovementCampaignStopReasonSchema.optional(),
});

export type SelfImprovementCampaignState = z.infer<typeof SelfImprovementCampaignStateSchema>;
