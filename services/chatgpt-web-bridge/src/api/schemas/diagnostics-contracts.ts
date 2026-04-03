import { z } from 'zod';

import { successEnvelope } from '@review-then-codex/shared-contracts/chatgpt';

export const BrowserEndpointCandidateSourceSchema = z.enum([
  'request_input',
  'env_browser_url',
  'env_browser_url_candidates',
  'env_connect_url',
  'env_chatgpt_browser_url',
  'localhost',
  'default_route_gateway',
  'resolv_conf_nameserver',
  'windows_browser_process',
  'windows_portproxy_rule',
]);

export type BrowserEndpointCandidateSource = z.infer<
  typeof BrowserEndpointCandidateSourceSchema
>;

export const BrowserEndpointCandidateStateSchema = z.enum([
  'candidate_discovered',
  'candidate_reachable',
  'candidate_selected',
  'candidate_rejected',
]);

export type BrowserEndpointCandidateState = z.infer<
  typeof BrowserEndpointCandidateStateSchema
>;

export const BrowserAttachFailureCategorySchema = z.enum([
  'TCP_UNREACHABLE',
  'DEVTOOLS_VERSION_UNREACHABLE',
  'DEVTOOLS_LIST_UNREACHABLE',
  'NO_ATTACHABLE_TARGETS',
  'REMOTE_DEBUGGING_DISABLED_OR_BLOCKED',
  'BROWSER_ENDPOINT_MISCONFIGURED',
  'HOST_NETWORK_UNREACHABLE',
]);

export type BrowserAttachFailureCategory = z.infer<
  typeof BrowserAttachFailureCategorySchema
>;

export const BrowserAttachRecommendationSchema = z.enum([
  'start Edge with --remote-debugging-port',
  'check RemoteDebuggingAllowed policy',
  'use host IP instead of localhost',
  'enable mirrored networking or adjust firewall',
  'ensure correct user profile / target tab exists',
]);

export type BrowserAttachRecommendation = z.infer<
  typeof BrowserAttachRecommendationSchema
>;

export const DevtoolsEndpointSchema = z.object({
  endpoint: z.string().url(),
  host: z.string().min(1),
  port: z.number().int().positive(),
  versionUrl: z.string().url(),
  listUrl: z.string().url(),
});

export type DevtoolsEndpoint = z.infer<typeof DevtoolsEndpointSchema>;

export const BrowserEndpointCandidateSchema = z.object({
  candidateId: z.string().uuid(),
  endpoint: z.string().url(),
  host: z.string().min(1),
  port: z.number().int().positive(),
  versionUrl: z.string().url(),
  listUrl: z.string().url(),
  source: BrowserEndpointCandidateSourceSchema,
  reason: z.string().min(1),
  state: BrowserEndpointCandidateStateSchema,
  discoveredAt: z.string().datetime(),
  lastFailureCategory: BrowserAttachFailureCategorySchema.optional(),
  metadata: z.record(z.unknown()).default({}),
});

export type BrowserEndpointCandidate = z.infer<typeof BrowserEndpointCandidateSchema>;

export const BrowserEndpointDiscoverySchema = z.object({
  discoveryId: z.string().uuid(),
  requestedBrowserUrl: z.string().url().optional(),
  candidates: z.array(BrowserEndpointCandidateSchema),
  artifactPath: z.string().optional(),
  discoveredAt: z.string().datetime(),
  metadata: z.record(z.unknown()).default({}),
});

export type BrowserEndpointDiscovery = z.infer<typeof BrowserEndpointDiscoverySchema>;

export const BrowserEndpointDiscoveryQuerySchema = z.object({
  browserUrl: z.string().url().optional(),
});

export type BrowserEndpointDiscoveryQuery = z.infer<
  typeof BrowserEndpointDiscoveryQuerySchema
>;

export const DevtoolsTargetSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    title: z.string().optional(),
    url: z.string().optional(),
    webSocketDebuggerUrl: z.string().optional(),
  })
  .passthrough();

export type DevtoolsTarget = z.infer<typeof DevtoolsTargetSchema>;

export const BrowserEndpointProbeSchema = z.object({
  probeId: z.string().uuid(),
  endpoint: z.string().url(),
  candidate: BrowserEndpointCandidateSchema,
  tcpReachable: z.boolean(),
  versionReachable: z.boolean(),
  listReachable: z.boolean(),
  attachReady: z.boolean(),
  browserInfo: z.record(z.unknown()).optional(),
  targetCount: z.number().int().min(0),
  selectedTarget: DevtoolsTargetSchema.optional(),
  failureCategory: BrowserAttachFailureCategorySchema.optional(),
  recommendations: z.array(BrowserAttachRecommendationSchema).default([]),
  probedAt: z.string().datetime(),
  artifactPath: z.string().optional(),
  metadata: z.record(z.unknown()).default({}),
});

export type BrowserEndpointProbe = z.infer<typeof BrowserEndpointProbeSchema>;

export const BrowserAttachDiagnosticSchema = z.object({
  diagnosticId: z.string().uuid(),
  requestedBrowserUrl: z.string().url().optional(),
  effectiveStartupUrl: z.string().url().optional(),
  attachReady: z.boolean(),
  candidates: z.array(BrowserEndpointCandidateSchema),
  probes: z.array(BrowserEndpointProbeSchema),
  selectedCandidate: BrowserEndpointCandidateSchema.optional(),
  selectedTarget: DevtoolsTargetSchema.optional(),
  failureCategory: BrowserAttachFailureCategorySchema.optional(),
  recommendations: z.array(BrowserAttachRecommendationSchema).default([]),
  discoveryArtifactPath: z.string().optional(),
  latestArtifactPath: z.string().optional(),
  createdAt: z.string().datetime(),
  metadata: z.record(z.unknown()).default({}),
});

export type BrowserAttachDiagnostic = z.infer<typeof BrowserAttachDiagnosticSchema>;

export const BrowserAttachPreflightSchema = z.object({
  preflightId: z.string().uuid(),
  diagnosticId: z.string().uuid(),
  requestedBrowserUrl: z.string().url().optional(),
  effectiveBrowserUrl: z.string().url().optional(),
  effectiveStartupUrl: z.string().url().optional(),
  allowOpenSession: z.boolean(),
  failureCategory: BrowserAttachFailureCategorySchema.optional(),
  recommendations: z.array(BrowserAttachRecommendationSchema).default([]),
  artifactPath: z.string().optional(),
  createdAt: z.string().datetime(),
  metadata: z.record(z.unknown()).default({}),
});

export type BrowserAttachPreflight = z.infer<typeof BrowserAttachPreflightSchema>;

export const BrowserAttachRunRequestSchema = z.object({
  browserUrl: z.string().url().optional(),
  startupUrl: z.string().url().optional(),
});

export type BrowserAttachRunRequest = z.infer<typeof BrowserAttachRunRequestSchema>;

export const BrowserAttachRunQuerySchema = BrowserAttachRunRequestSchema;
export type BrowserAttachRunQuery = z.infer<typeof BrowserAttachRunQuerySchema>;

export const BrowserEndpointsResponseSchema = successEnvelope(
  BrowserEndpointDiscoverySchema,
);

export const BrowserAttachDiagnosticResponseSchema = successEnvelope(
  BrowserAttachDiagnosticSchema,
);

export const BrowserAttachLatestResponseSchema = successEnvelope(
  z.object({
    diagnostic: BrowserAttachDiagnosticSchema.nullable(),
  }),
);
