import type { FastifyInstance } from 'fastify';

import {
  BridgeHealthResponseSchema,
  ConversationPathParamsSchema,
  DriftIncidentsResponseSchema,
  GetSnapshotResponseSchema,
  MarkdownExportRequestSchema,
  MarkdownExportResponseSchema,
  MessageConversationRequestSchema,
  MessageConversationResponseSchema,
  OpenSessionRequestSchema,
  OpenSessionResponseSchema,
  RecoverConversationRequestSchema,
  RecoverConversationResponseSchema,
  ResumeSessionRequestSchema,
  ResumeSessionResponseSchema,
  SelectProjectRequestSchema,
  SelectProjectResponseSchema,
  SessionPathParamsSchema,
  StartConversationRequestSchema,
  StartConversationResponseSchema,
  StructuredReviewExtractRequestSchema,
  StructuredReviewExtractResponseSchema,
  WaitConversationRequestSchema,
  WaitConversationResponseSchema,
} from '@review-then-codex/shared-contracts/chatgpt';

import type { ConversationService } from '../../services/conversation-service';

export function registerBridgeRoutes(
  app: FastifyInstance,
  conversationService: ConversationService,
): void {
  app.get('/api/health/bridge', async () => {
    const data = await conversationService.getBridgeHealth();
    return BridgeHealthResponseSchema.parse({ ok: true, data });
  });

  app.post('/api/sessions/open', async (request) => {
    const body = OpenSessionRequestSchema.parse(request.body);
    const data = await conversationService.openSession(body);
    return OpenSessionResponseSchema.parse({ ok: true, data });
  });

  app.post('/api/sessions/:sessionId/resume', async (request) => {
    const params = SessionPathParamsSchema.parse(request.params);
    const body = ResumeSessionRequestSchema.parse(request.body ?? {});
    const data = await conversationService.resumeSession(params.sessionId, body);
    return ResumeSessionResponseSchema.parse({ ok: true, data });
  });

  app.post('/api/projects/select', async (request) => {
    const body = SelectProjectRequestSchema.parse(request.body);
    const data = await conversationService.selectProject(body);
    return SelectProjectResponseSchema.parse({ ok: true, data });
  });

  app.post('/api/conversations/start', async (request) => {
    const body = StartConversationRequestSchema.parse(request.body);
    const data = await conversationService.startConversation(body);
    return StartConversationResponseSchema.parse({ ok: true, data });
  });

  app.post('/api/conversations/:id/message', async (request) => {
    const params = ConversationPathParamsSchema.parse(request.params);
    const body = MessageConversationRequestSchema.parse(request.body);
    const data = await conversationService.sendMessage(params.id, body);
    return MessageConversationResponseSchema.parse({ ok: true, data });
  });

  app.post('/api/conversations/:id/wait', async (request) => {
    const params = ConversationPathParamsSchema.parse(request.params);
    const body = WaitConversationRequestSchema.parse(request.body ?? {});
    const data = await conversationService.waitForConversation(params.id, body);
    return WaitConversationResponseSchema.parse({ ok: true, data });
  });

  app.get('/api/conversations/:id/snapshot', async (request) => {
    const params = ConversationPathParamsSchema.parse(request.params);
    const data = await conversationService.getSnapshot(params.id);
    return GetSnapshotResponseSchema.parse({ ok: true, data });
  });

  app.post('/api/conversations/:id/export/markdown', async (request) => {
    const params = ConversationPathParamsSchema.parse(request.params);
    const body = MarkdownExportRequestSchema.parse(request.body ?? {});
    const data = await conversationService.exportMarkdown(params.id, body);
    return MarkdownExportResponseSchema.parse({ ok: true, data });
  });

  app.post('/api/conversations/:id/extract/structured-review', async (request) => {
    const params = ConversationPathParamsSchema.parse(request.params);
    const body = StructuredReviewExtractRequestSchema.parse(request.body ?? {});
    const data = await conversationService.extractStructuredReview(params.id, body);
    return StructuredReviewExtractResponseSchema.parse({ ok: true, data });
  });

  app.post('/api/conversations/:id/recover', async (request) => {
    const params = ConversationPathParamsSchema.parse(request.params);
    const body = RecoverConversationRequestSchema.parse(request.body ?? {});
    const data = await conversationService.recoverConversation(params.id, body);
    return RecoverConversationResponseSchema.parse({ ok: true, data });
  });

  app.get('/api/drift/incidents', async () => {
    const incidents = await conversationService.listDriftIncidents();
    return DriftIncidentsResponseSchema.parse({
      ok: true,
      data: {
        incidents,
      },
    });
  });
}
