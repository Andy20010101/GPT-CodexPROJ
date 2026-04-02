import { z } from 'zod';

export const StabilityIncidentSourceSchema = z.enum([
  'bridge',
  'runner',
  'workspace',
  'review',
  'runtime',
  'validation',
]);

export type StabilityIncidentSource = z.infer<typeof StabilityIncidentSourceSchema>;

export const StabilityIncidentSeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export type StabilityIncidentSeverity = z.infer<typeof StabilityIncidentSeveritySchema>;

export const StabilityIncidentStatusSchema = z.enum(['open', 'recovered', 'resolved', 'failed']);

export type StabilityIncidentStatus = z.infer<typeof StabilityIncidentStatusSchema>;

export const StabilityIncidentSchema = z.object({
  incidentId: z.string().uuid(),
  runId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  jobId: z.string().uuid().optional(),
  executionId: z.string().uuid().optional(),
  source: StabilityIncidentSourceSchema,
  category: z.string().min(1),
  severity: StabilityIncidentSeveritySchema,
  status: StabilityIncidentStatusSchema,
  summary: z.string().min(1),
  relatedEvidenceIds: z.array(z.string().uuid()).default([]),
  occurredAt: z.string().datetime(),
  resolvedAt: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).default({}),
});

export type StabilityIncident = z.infer<typeof StabilityIncidentSchema>;

export const StabilityCategoryCountSchema = z.object({
  category: z.string().min(1),
  count: z.number().int().min(0),
});

export const StabilityReportSchema = z.object({
  generatedAt: z.string().datetime(),
  recurringIncidentCategories: z.array(StabilityCategoryCountSchema).default([]),
  meanAttemptsPerTask: z.number().nonnegative(),
  rollbackCount: z.number().int().min(0),
  retainedWorkspaceCount: z.number().int().min(0),
  unresolvedDriftIncidents: z.number().int().min(0),
  manualAttentionBacklog: z.number().int().min(0),
  recommendedRemediationPaths: z.array(z.string().min(1)).default([]),
  metadata: z.record(z.unknown()).default({}),
});

export type StabilityReport = z.infer<typeof StabilityReportSchema>;
