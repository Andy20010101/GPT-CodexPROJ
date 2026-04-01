import type { FastifyInstance } from 'fastify';

import {
  ConversationPathParamsSchema,
  GetSnapshotResponseSchema,
  MarkdownExportRequestSchema,
  MarkdownExportResponseSchema,
  MessageConversationRequestSchema,
  MessageConversationResponseSchema,
  OpenSessionRequestSchema,
  OpenSessionResponseSchema,
  SelectProjectRequestSchema,
  SelectProjectResponseSchema,
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
  app.post('/api/sessions/open', async (request) => {
    const body = OpenSessionRequestSchema.parse(request.body);
    const data = await conversationService.openSession(body);
    return OpenSessionResponseSchema.parse({ ok: true, data });
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
}
