import { z } from 'zod';

export const BridgeErrorCodeSchema = z.enum([
  'SESSION_NOT_FOUND',
  'SESSION_LEASE_CONFLICT',
  'PROJECT_NOT_FOUND',
  'PROJECT_UNAVAILABLE',
  'CONVERSATION_NOT_FOUND',
  'CONVERSATION_UNAVAILABLE',
  'DOM_DRIFT_DETECTED',
  'CHATGPT_NOT_READY',
  'TCP_UNREACHABLE',
  'DEVTOOLS_VERSION_UNREACHABLE',
  'DEVTOOLS_LIST_UNREACHABLE',
  'NO_ATTACHABLE_TARGETS',
  'REMOTE_DEBUGGING_DISABLED_OR_BLOCKED',
  'BROWSER_ENDPOINT_MISCONFIGURED',
  'HOST_NETWORK_UNREACHABLE',
  'SESSION_RESUME_FAILED',
  'BRIDGE_RECOVERY_FAILED',
  'STRUCTURED_OUTPUT_NOT_FOUND',
  'VALIDATION_ERROR',
  'INTERNAL_ERROR',
]);

export type BridgeErrorCode = z.infer<typeof BridgeErrorCodeSchema>;

export const BridgeErrorSchema = z.object({
  code: BridgeErrorCodeSchema,
  message: z.string(),
  details: z.unknown().optional(),
});

export const ApiFailureSchema = z.object({
  ok: z.literal(false),
  error: BridgeErrorSchema,
});

export const successEnvelope = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    ok: z.literal(true),
    data,
  });

export type ApiFailure = z.infer<typeof ApiFailureSchema>;
export type ApiSuccess<T> = {
  readonly ok: true;
  readonly data: T;
};

export const SessionIdSchema = z.string().uuid();
export const ConversationIdSchema = z.string().uuid();

export const SessionSummarySchema = z.object({
  sessionId: SessionIdSchema,
  browserUrl: z.string().url(),
  pageUrl: z.string().url().optional(),
  projectName: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  connectedAt: z.string().datetime(),
});

export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export const ConversationMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  text: z.string(),
  createdAt: z.string().datetime(),
  inputFiles: z.array(z.string()).default([]),
});

export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;

export const ConversationSnapshotSchema = z.object({
  conversationId: ConversationIdSchema,
  sessionId: SessionIdSchema,
  projectName: z.string().min(1),
  model: z.string().min(1).optional(),
  status: z.enum(['running', 'completed', 'failed']),
  source: z.enum(['adapter', 'memory']),
  pageUrl: z.string().url().optional(),
  messages: z.array(ConversationMessageSchema),
  lastAssistantMessage: z.string().optional(),
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ConversationSnapshot = z.infer<typeof ConversationSnapshotSchema>;

export const HealthDataSchema = z.object({
  service: z.literal('chatgpt-web-bridge'),
  status: z.literal('ok'),
});

export const HealthResponseSchema = successEnvelope(HealthDataSchema);

export const BridgeHealthStatusSchema = z.enum([
  'ready',
  'degraded',
  'needs_reauth',
  'dom_drift_detected',
  'project_unavailable',
  'conversation_unavailable',
]);

export type BridgeHealthStatus = z.infer<typeof BridgeHealthStatusSchema>;

export const BridgeHealthSummarySchema = z.object({
  status: BridgeHealthStatusSchema,
  checkedAt: z.string().datetime(),
  activeSessions: z.number().int().min(0),
  activeConversations: z.number().int().min(0),
  issues: z.array(z.string().min(1)).default([]),
  latestIncidentId: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).default({}),
});

export type BridgeHealthSummary = z.infer<typeof BridgeHealthSummarySchema>;

export const BridgeHealthResponseSchema = successEnvelope(BridgeHealthSummarySchema);

export const OpenSessionRequestSchema = z.object({
  browserUrl: z.string().url(),
  startupUrl: z.string().url().optional(),
});

export const OpenSessionResponseSchema = successEnvelope(SessionSummarySchema);
export type OpenSessionRequest = z.infer<typeof OpenSessionRequestSchema>;

export const SessionPathParamsSchema = z.object({
  sessionId: SessionIdSchema,
});

export type SessionPathParams = z.infer<typeof SessionPathParamsSchema>;

export const SelectProjectRequestSchema = z.object({
  sessionId: SessionIdSchema,
  projectName: z.string().min(1),
  model: z.string().min(1).optional(),
});

export const SelectProjectResponseSchema = successEnvelope(SessionSummarySchema);
export type SelectProjectRequest = z.infer<typeof SelectProjectRequestSchema>;

export const StartConversationRequestSchema = z.object({
  sessionId: SessionIdSchema,
  projectName: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  prompt: z.string().min(1),
  inputFiles: z.array(z.string()).default([]),
});

export const StartConversationResponseSchema = successEnvelope(ConversationSnapshotSchema);
export type StartConversationRequest = z.infer<typeof StartConversationRequestSchema>;

export const ConversationPathParamsSchema = z.object({
  id: ConversationIdSchema,
});

export type ConversationPathParams = z.infer<typeof ConversationPathParamsSchema>;

export const MessageConversationRequestSchema = z.object({
  message: z.string().min(1),
  inputFiles: z.array(z.string()).default([]),
});

export const MessageConversationResponseSchema = successEnvelope(ConversationSnapshotSchema);
export type MessageConversationRequest = z.infer<typeof MessageConversationRequestSchema>;

export const WaitConversationRequestSchema = z.object({
  maxWaitMs: z.number().int().positive().max(3600000).optional(),
  pollIntervalMs: z.number().int().positive().max(30000).optional(),
  stablePolls: z.number().int().positive().max(20).optional(),
});

export const WaitConversationResponseSchema = successEnvelope(ConversationSnapshotSchema);
export type WaitConversationRequest = z.infer<typeof WaitConversationRequestSchema>;

export const GetSnapshotResponseSchema = successEnvelope(ConversationSnapshotSchema);

export const MarkdownExportRequestSchema = z.object({
  fileName: z
    .string()
    .regex(/^[A-Za-z0-9._-]+\.md$/)
    .optional(),
});

export const MarkdownExportSchema = z.object({
  artifactPath: z.string(),
  manifestPath: z.string(),
  markdown: z.string(),
});

export const MarkdownExportResponseSchema = successEnvelope(MarkdownExportSchema);
export type MarkdownExportRequest = z.infer<typeof MarkdownExportRequestSchema>;

export const StructuredReviewExtractRequestSchema = z.object({
  fileName: z
    .string()
    .regex(/^[A-Za-z0-9._-]+\.json$/)
    .optional(),
});

export const StructuredReviewPayloadSchema = z.record(z.unknown());

export const StructuredReviewExtractSchema = z.object({
  artifactPath: z.string(),
  manifestPath: z.string(),
  payload: StructuredReviewPayloadSchema,
});

export const StructuredReviewExtractResponseSchema = successEnvelope(StructuredReviewExtractSchema);

export type StructuredReviewExtractRequest = z.infer<typeof StructuredReviewExtractRequestSchema>;

export const ResumeSessionRequestSchema = z.object({});
export type ResumeSessionRequest = z.infer<typeof ResumeSessionRequestSchema>;

export const ResumeSessionResponseSchema = successEnvelope(
  z.object({
    session: SessionSummarySchema,
    health: BridgeHealthSummarySchema,
  }),
);

export const RecoverConversationRequestSchema = z.object({});
export type RecoverConversationRequest = z.infer<typeof RecoverConversationRequestSchema>;

export const RecoverConversationResponseSchema = successEnvelope(
  z.object({
    snapshot: ConversationSnapshotSchema,
    health: BridgeHealthSummarySchema,
  }),
);

export const DriftRecoveryAttemptSchema = z.object({
  label: z.string().min(1),
  outcome: z.enum(['succeeded', 'failed', 'skipped']),
  details: z.unknown().optional(),
});

export type DriftRecoveryAttempt = z.infer<typeof DriftRecoveryAttemptSchema>;

export const BridgeDriftIncidentSchema = z.object({
  incidentId: z.string().uuid(),
  sessionId: SessionIdSchema.optional(),
  conversationId: ConversationIdSchema.optional(),
  category: z.enum(['selector_fallback', 'page_health', 'session_resume', 'conversation_recovery']),
  status: z.enum(['detected', 'recovered', 'failed']),
  summary: z.string().min(1),
  attempts: z.array(DriftRecoveryAttemptSchema).default([]),
  pageUrl: z.string().url().optional(),
  occurredAt: z.string().datetime(),
  resolvedAt: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).default({}),
});

export type BridgeDriftIncident = z.infer<typeof BridgeDriftIncidentSchema>;

export const DriftIncidentsResponseSchema = successEnvelope(
  z.object({
    incidents: z.array(BridgeDriftIncidentSchema),
  }),
);
