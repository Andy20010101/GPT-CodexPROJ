import { z } from 'zod';

export const SelfImprovementEnvModeSchema = z.enum(['doctor', 'ensure']);
export type SelfImprovementEnvMode = z.infer<typeof SelfImprovementEnvModeSchema>;

export const SelfImprovementEnvRunKindSchema = z.enum(['self-improvement', 'validation']);
export type SelfImprovementEnvRunKind = z.infer<typeof SelfImprovementEnvRunKindSchema>;

export const SelfImprovementEnvOverallStatusSchema = z.enum(['ready', 'needs_operator']);
export type SelfImprovementEnvOverallStatus = z.infer<typeof SelfImprovementEnvOverallStatusSchema>;

export const SelfImprovementEnvPhaseSchema = SelfImprovementEnvModeSchema;
export type SelfImprovementEnvPhase = z.infer<typeof SelfImprovementEnvPhaseSchema>;

export const SelfImprovementEnvStatusSchema = SelfImprovementEnvOverallStatusSchema;
export type SelfImprovementEnvStatus = z.infer<typeof SelfImprovementEnvStatusSchema>;

export const SelfImprovementEnvServiceStatusSchema = z.enum(['ready', 'reused', 'started', 'failed']);
export type SelfImprovementEnvServiceStatus = z.infer<typeof SelfImprovementEnvServiceStatusSchema>;

export const SelfImprovementEnvActionStatusSchema = z.enum(['reused', 'started', 'failed', 'skipped']);
export type SelfImprovementEnvActionStatus = z.infer<typeof SelfImprovementEnvActionStatusSchema>;

export const SelfImprovementEnvArtifactAuthoritySchema = z.object({
  artifactDir: z.string().min(1),
  source: z.enum(['cli', 'orchestrator_env', 'orchestrator_default']),
  orchestratorPid: z.number().int().positive().nullable(),
  orchestratorPort: z.number().int().positive(),
});

export type SelfImprovementEnvArtifactAuthority = z.infer<
  typeof SelfImprovementEnvArtifactAuthoritySchema
>;

export const SelfImprovementEnvWatcherCleanupSchema = z.object({
  authoritativeArtifactDir: z.string().min(1),
  stopped: z.array(
    z.object({
      pid: z.number().int().positive(),
      runId: z.string().nullable(),
      reason: z.literal('mismatched_artifact_root'),
    }),
  ),
  kept: z.number().int().nonnegative(),
});

export type SelfImprovementEnvWatcherCleanup = z.infer<
  typeof SelfImprovementEnvWatcherCleanupSchema
>;

export const SelfImprovementEnvActionSchema = z.object({
  kind: z.enum([
    'reuse_orchestrator',
    'start_orchestrator',
    'reuse_bridge',
    'start_bridge',
    'probe_browser',
    'cleanup_watchers',
    'write_env_state',
  ]),
  status: SelfImprovementEnvActionStatusSchema,
  summary: z.string().min(1),
});

export type SelfImprovementEnvAction = z.infer<typeof SelfImprovementEnvActionSchema>;

export const SelfImprovementEnvBlockingIssueSchema = z.object({
  component: z.enum(['browser', 'bridge', 'orchestrator', 'artifact-root']),
  message: z.string().min(1),
});

export type SelfImprovementEnvBlockingIssue = z.infer<typeof SelfImprovementEnvBlockingIssueSchema>;

export const SelfImprovementEnvRecoveryActionSchema = z.object({
  kind: z.string().min(1),
  summary: z.string().min(1),
});

export type SelfImprovementEnvRecoveryAction = z.infer<typeof SelfImprovementEnvRecoveryActionSchema>;

export const SelfImprovementEnvTimestampsSchema = z.object({
  generatedAt: z.string().datetime(),
});

export type SelfImprovementEnvTimestamps = z.infer<typeof SelfImprovementEnvTimestampsSchema>;

export const SelfImprovementEnvAuditPathsSchema = z.object({
  envState: z.string().min(1),
  orchestratorLog: z.string().min(1).optional(),
  bridgeLog: z.string().min(1).optional(),
});

export type SelfImprovementEnvAuditPaths = z.infer<typeof SelfImprovementEnvAuditPathsSchema>;

export const SelfImprovementEnvServiceSchema = z.object({
  baseUrl: z.string().url(),
  status: SelfImprovementEnvServiceStatusSchema,
  issues: z.array(z.string()),
  pid: z.number().int().positive().nullable(),
});

export type SelfImprovementEnvService = z.infer<typeof SelfImprovementEnvServiceSchema>;

export const SelfImprovementEnvBrowserSchema = z.object({
  endpoint: z.string().url().nullable(),
  startupUrl: z.string().url(),
  versionUrl: z.string().url().nullable(),
  listUrl: z.string().url().nullable(),
  cdpReachable: z.boolean(),
  loggedIn: z.boolean(),
  composerReady: z.boolean(),
  pageUrl: z.string().url().nullable(),
  pageTitle: z.string().nullable(),
  issues: z.array(z.string()),
});

export type SelfImprovementEnvBrowser = z.infer<typeof SelfImprovementEnvBrowserSchema>;

export const SelfImprovementEnvArtifactRootSchema = z.object({
  path: z.string().min(1),
  exists: z.boolean(),
  writable: z.boolean(),
  issues: z.array(z.string()),
});

export type SelfImprovementEnvArtifactRoot = z.infer<typeof SelfImprovementEnvArtifactRootSchema>;

export const SelfImprovementEnvStateSchema = z.object({
  version: z.literal(1),
  runKind: SelfImprovementEnvRunKindSchema,
  phase: SelfImprovementEnvPhaseSchema,
  status: SelfImprovementEnvStatusSchema,
  blockingIssues: z.array(SelfImprovementEnvBlockingIssueSchema).default([]),
  recoveryActions: z.array(SelfImprovementEnvRecoveryActionSchema).default([]),
  timestamps: SelfImprovementEnvTimestampsSchema,
  auditPaths: SelfImprovementEnvAuditPathsSchema,
  mode: SelfImprovementEnvModeSchema,
  generatedAt: z.string().datetime(),
  envStatePath: z.string().min(1),
  authoritativeArtifactDir: z.string().min(1),
  overallStatus: SelfImprovementEnvOverallStatusSchema,
  artifactAuthority: SelfImprovementEnvArtifactAuthoritySchema,
  orchestrator: SelfImprovementEnvServiceSchema,
  bridge: SelfImprovementEnvServiceSchema,
  browser: SelfImprovementEnvBrowserSchema,
  artifactRoot: SelfImprovementEnvArtifactRootSchema,
  watcherCleanup: SelfImprovementEnvWatcherCleanupSchema,
  actions: z.array(SelfImprovementEnvActionSchema),
});

export type SelfImprovementEnvState = z.infer<typeof SelfImprovementEnvStateSchema>;
