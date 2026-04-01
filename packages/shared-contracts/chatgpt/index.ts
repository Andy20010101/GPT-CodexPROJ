import { z } from 'zod';

export const BridgeErrorCodeSchema = z.enum([
  'SESSION_NOT_FOUND',
  'SESSION_LEASE_CONFLICT',
  'PROJECT_NOT_FOUND',
  'CONVERSATION_NOT_FOUND',
  'DOM_DRIFT_DETECTED',
  'CHATGPT_NOT_READY',
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

export const OpenSessionRequestSchema = z.object({
  browserUrl: z.string().url(),
  startupUrl: z.string().url().optional(),
});

export const OpenSessionResponseSchema = successEnvelope(SessionSummarySchema);
export type OpenSessionRequest = z.infer<typeof OpenSessionRequestSchema>;

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
  maxWaitMs: z.number().int().positive().max(900000).optional(),
  pollIntervalMs: z.number().int().positive().max(30000).optional(),
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
