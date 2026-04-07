import { describe, expect, it, vi } from 'vitest';

import type {
  ConversationSnapshot,
  SessionSummary,
} from '@review-then-codex/shared-contracts/chatgpt';

import { PuppeteerChatGPTAdapter } from '../../src/adapters/chatgpt-adapter';

describe('PuppeteerChatGPTAdapter', () => {
  it('reapplies project selection after rebinding to a fresh page', async () => {
    const browserManager = {
      prepareFreshConversationPage: vi.fn(async () => undefined),
      getPage: vi.fn(() => ({}) as never),
    };
    const preflightGuard = {
      ensureReady: vi.fn(async () => undefined),
    };
    const adapter = new PuppeteerChatGPTAdapter(browserManager as never, preflightGuard as never);

    const session: SessionSummary = {
      sessionId: 'session-1',
      browserUrl: 'http://127.0.0.1:9667',
      pageUrl: 'https://chatgpt.com/c/existing',
      connectedAt: new Date().toISOString(),
      projectName: 'Alpha Project',
      model: 'pro',
    };
    const reboundSession: SessionSummary = {
      ...session,
      pageUrl: 'https://chatgpt.com/',
    };
    const snapshot: ConversationSnapshot = {
      conversationId: 'conversation-1',
      sessionId: session.sessionId,
      projectName: reboundSession.projectName ?? 'unknown-project',
      model: reboundSession.model,
      status: 'completed',
      source: 'adapter',
      pageUrl: reboundSession.pageUrl,
      messages: [],
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const selectProject = vi.spyOn(adapter, 'selectProject').mockResolvedValue(reboundSession);
    const attachFiles = vi
      .spyOn(adapter as never, 'attachFiles')
      .mockResolvedValue(undefined);
    const sendText = vi.spyOn(adapter as never, 'sendText').mockResolvedValue(undefined);
    const readSnapshot = vi.spyOn(adapter as never, 'readSnapshot').mockResolvedValue(snapshot);

    const result = await adapter.startConversation({
      session,
      conversationId: 'conversation-fallback',
      projectName: 'Alpha Project',
      model: 'pro',
      prompt: 'review this change',
      inputFiles: [],
    });

    expect(browserManager.prepareFreshConversationPage).toHaveBeenCalledWith(session.sessionId);
    expect(selectProject).toHaveBeenCalledWith({
      session,
      projectName: 'Alpha Project',
      model: 'pro',
    });
    expect(browserManager.getPage).toHaveBeenCalledWith(session.sessionId);
    expect(attachFiles).toHaveBeenCalledWith(expect.anything(), []);
    expect(sendText).toHaveBeenCalledWith(expect.anything(), 'review this change');
    expect(readSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      reboundSession,
      'conversation-fallback',
      'Alpha Project',
      'pro',
      [],
    );
    expect(result).toBe(snapshot);
  });
});
