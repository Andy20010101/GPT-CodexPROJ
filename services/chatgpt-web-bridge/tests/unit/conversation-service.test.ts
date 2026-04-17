import { describe, expect, it, vi } from 'vitest';

import { ConversationService } from '../../src/services/conversation-service';
import { SessionLease } from '../../src/browser/session-lease';

describe('ConversationService', () => {
  it('uses the browser authority service when openSession runs without a preflight guard', async () => {
    const adapter = {
      openSession: vi.fn(async ({ sessionId, browserEndpoint, startupUrl }) => ({
        sessionId,
        browserUrl: browserEndpoint,
        pageUrl: startupUrl ?? 'https://chatgpt.com/',
      })),
    };
    const browserAuthorityService = {
      resolve: vi.fn(async () => ({
        browserEndpoint: 'http://172.18.144.1:9224',
        startupUrl: 'https://chatgpt.com/',
        source: 'env_state_browser_authority',
      })),
    };

    const service = new ConversationService(
      adapter as never,
      new SessionLease(),
      {} as never,
      { info: vi.fn() } as never,
      undefined,
      undefined,
      undefined,
      browserAuthorityService as never,
    );

    const opened = await service.openSession({
      browserUrl: 'https://chatgpt.com/',
    });

    expect(browserAuthorityService.resolve).toHaveBeenCalledWith({
      browserUrl: 'https://chatgpt.com/',
    });
    expect(adapter.openSession).toHaveBeenCalledWith({
      sessionId: opened.sessionId,
      browserEndpoint: 'http://172.18.144.1:9224',
      startupUrl: 'https://chatgpt.com/',
    });
    expect(opened.browserUrl).toBe('http://172.18.144.1:9224');
  });

  it('returns lightweight conversation status without materializing a full snapshot', async () => {
    const adapter = {
      openSession: vi.fn(async ({ sessionId: openedSessionId, browserEndpoint, startupUrl }) => ({
        sessionId: openedSessionId,
        browserUrl: browserEndpoint,
        pageUrl: startupUrl ?? 'https://chatgpt.com/',
        connectedAt: '2026-04-08T09:00:00.000Z',
      })),
      selectProject: vi.fn(async (input) => ({
        ...input.session,
        projectName: input.projectName,
        model: input.model,
      })),
      startConversation: vi.fn(async (input) => ({
        conversationId: input.conversationId,
        sessionId: input.session.sessionId,
        projectName: input.projectName,
        model: input.model,
        status: 'running',
        source: 'adapter',
        pageUrl: 'https://chatgpt.com/c/example',
        messages: [],
        startedAt: '2026-04-08T09:00:00.000Z',
        updatedAt: '2026-04-08T09:00:00.000Z',
      })),
      getConversationStatus: vi.fn(async (input) => ({
        conversationId: input.conversationId,
        sessionId: input.session.sessionId,
        projectName: input.session.projectName ?? 'Default',
        model: input.session.model,
        status: 'completed',
        source: 'adapter_status',
        pageUrl: 'https://chatgpt.com/c/example',
        assistantMessageCount: 2,
        lastMessageRole: 'assistant',
        lastAssistantMessage: 'Done',
        updatedAt: '2026-04-08T09:01:00.000Z',
      })),
      getConversationSnapshot: vi.fn(async () => {
        throw new Error('snapshot should not be read for status');
      }),
    };

    const service = new ConversationService(
      adapter as never,
      new SessionLease(),
      {} as never,
      { info: vi.fn() } as never,
    );

    const session = await service.openSession({
      browserEndpoint: 'http://172.18.144.1:9224',
      startupUrl: 'https://chatgpt.com/',
    });
    const selected = await service.selectProject({
      sessionId: session.sessionId,
      projectName: 'Default',
      model: 'pro',
    });
    const started = await service.startConversation({
      sessionId: selected.sessionId,
      prompt: 'hello',
      projectName: 'Default',
      model: 'pro',
      inputFiles: [],
    });

    const status = await service.getConversationStatus(started.conversationId);

    expect(adapter.getConversationStatus).toHaveBeenCalledWith({
      session: expect.objectContaining({
        sessionId: selected.sessionId,
        browserUrl: selected.browserUrl,
        projectName: 'Default',
        model: 'pro',
        startupUrl: 'https://chatgpt.com/',
      }),
      conversationId: started.conversationId,
    });
    expect(status).toMatchObject({
      conversationId: started.conversationId,
      sessionId: selected.sessionId,
      status: 'completed',
      assistantMessageCount: 2,
      lastMessageRole: 'assistant',
      lastAssistantMessage: 'Done',
    });
    expect(adapter.getConversationSnapshot).not.toHaveBeenCalled();
  });

  it('waits by polling lightweight status and materializes the snapshot only after stable completion', async () => {
    const adapter = {
      openSession: vi.fn(async ({ sessionId, browserEndpoint, startupUrl }) => ({
        sessionId,
        browserUrl: browserEndpoint,
        pageUrl: startupUrl ?? 'https://chatgpt.com/',
        connectedAt: '2026-04-08T09:00:00.000Z',
      })),
      selectProject: vi.fn(async (input) => ({
        ...input.session,
        projectName: input.projectName,
        model: input.model,
      })),
      startConversation: vi.fn(async (input) => ({
        conversationId: input.conversationId,
        sessionId: input.session.sessionId,
        projectName: input.projectName,
        model: input.model,
        status: 'running',
        source: 'adapter',
        pageUrl: 'https://chatgpt.com/c/example',
        messages: [],
        startedAt: '2026-04-08T09:00:00.000Z',
        updatedAt: '2026-04-08T09:00:00.000Z',
      })),
      waitForConversation: vi.fn(async () => {
        throw new Error('service should not delegate long wait to adapter.waitForConversation');
      }),
      getConversationStatus: vi
        .fn()
        .mockResolvedValueOnce({
          conversationId: 'ignored',
          sessionId: 'ignored',
          projectName: 'Default',
          model: 'pro',
          status: 'completed',
          source: 'adapter_status',
          pageUrl: 'https://chatgpt.com/c/example',
          assistantMessageCount: 1,
          lastMessageRole: 'assistant',
          lastAssistantMessage: 'Done',
          updatedAt: '2026-04-08T09:00:30.000Z',
        })
        .mockResolvedValueOnce({
          conversationId: 'ignored',
          sessionId: 'ignored',
          projectName: 'Default',
          model: 'pro',
          status: 'completed',
          source: 'adapter_status',
          pageUrl: 'https://chatgpt.com/c/example',
          assistantMessageCount: 1,
          lastMessageRole: 'assistant',
          lastAssistantMessage: 'Done',
          updatedAt: '2026-04-08T09:00:31.000Z',
        }),
      getConversationSnapshot: vi.fn(async (input) => ({
        conversationId: input.conversationId,
        sessionId: input.session.sessionId,
        projectName: input.session.projectName ?? 'Default',
        model: input.session.model,
        status: 'completed',
        source: 'adapter',
        pageUrl: 'https://chatgpt.com/c/example',
        messages: [
          {
            id: 'assistant-1',
            role: 'assistant',
            text: 'Done',
            createdAt: '2026-04-08T09:00:31.000Z',
            inputFiles: [],
          },
        ],
        lastAssistantMessage: 'Done',
        startedAt: '2026-04-08T09:00:00.000Z',
        updatedAt: '2026-04-08T09:00:31.000Z',
      })),
    };

    const service = new ConversationService(
      adapter as never,
      new SessionLease(),
      {} as never,
      { info: vi.fn() } as never,
    );

    const session = await service.openSession({
      browserEndpoint: 'http://172.18.144.1:9224',
      startupUrl: 'https://chatgpt.com/',
    });
    const selected = await service.selectProject({
      sessionId: session.sessionId,
      projectName: 'Default',
      model: 'pro',
    });
    const started = await service.startConversation({
      sessionId: selected.sessionId,
      prompt: 'hello',
      projectName: 'Default',
      model: 'pro',
      inputFiles: [],
    });

    const snapshot = await service.waitForConversation(started.conversationId, {
      pollIntervalMs: 1,
      stablePolls: 2,
      maxWaitMs: 1_000,
    });

    expect(adapter.getConversationStatus).toHaveBeenCalledTimes(2);
    expect(adapter.getConversationSnapshot).toHaveBeenCalledTimes(1);
    expect(adapter.waitForConversation).not.toHaveBeenCalled();
    expect(snapshot.status).toBe('completed');
    expect(snapshot.lastAssistantMessage).toBe('Done');
  });

  it('reconstructs conversation recovery context after a bridge restart', async () => {
    const conversationId = 'c0f8c5fd-88f1-41e6-8992-c1c07378daea';
    const sessionId = 'd0f8c5fd-88f1-41e6-8992-c1c07378daea';
    const adapter = {
      openSession: vi.fn(async ({ sessionId: openedSessionId, browserEndpoint, startupUrl }) => ({
        sessionId: openedSessionId,
        browserUrl: browserEndpoint,
        pageUrl: startupUrl ?? 'https://chatgpt.com/',
        connectedAt: '2026-04-08T09:00:00.000Z',
      })),
    };
    const sessionResumeGuard = {
      recoverConversation: vi.fn(async ({ session, conversation }) => ({
        conversationId: conversation.snapshot.conversationId,
        sessionId: session.sessionId,
        projectName: session.projectName ?? 'Default',
        model: session.model,
        status: 'completed',
        source: 'adapter',
        pageUrl: 'https://chatgpt.com/c/recovered',
        messages: [],
        startedAt: '2026-04-08T09:00:00.000Z',
        updatedAt: '2026-04-08T09:01:00.000Z',
      })),
    };

    const service = new ConversationService(
      adapter as never,
      new SessionLease(),
      {} as never,
      { info: vi.fn() } as never,
      undefined,
      sessionResumeGuard as never,
    );

    const recovered = await service.recoverConversation(conversationId, {
      sessionId,
      browserUrl: 'http://172.18.144.1:9224',
      pageUrl: 'https://chatgpt.com/c/recovered',
      projectName: 'Default',
      model: 'pro',
      inputFiles: ['/tmp/review-bundle.md'],
    });

    expect(adapter.openSession).toHaveBeenCalledWith({
      sessionId,
      browserEndpoint: 'http://172.18.144.1:9224',
      startupUrl: 'https://chatgpt.com/c/recovered',
    });
    expect(sessionResumeGuard.recoverConversation).toHaveBeenCalledWith({
      session: expect.objectContaining({
        sessionId,
        browserUrl: 'http://172.18.144.1:9224',
        projectName: 'Default',
        model: 'pro',
      }),
      conversation: expect.objectContaining({
        snapshot: expect.objectContaining({
          conversationId,
          sessionId,
          projectName: 'Default',
        }),
        inputFiles: ['/tmp/review-bundle.md'],
      }),
    });
    expect(recovered.snapshot).toMatchObject({
      conversationId,
      sessionId,
      projectName: 'Default',
      status: 'completed',
    });
  });

  it('reconstructs the conversation url when recovery context lost the original page url', async () => {
    const conversationId = 'f0f8c5fd-88f1-41e6-8992-c1c07378daea';
    const sessionId = 'e0f8c5fd-88f1-41e6-8992-c1c07378daea';
    const adapter = {
      openSession: vi.fn(async ({ sessionId: openedSessionId, browserEndpoint, startupUrl }) => ({
        sessionId: openedSessionId,
        browserUrl: browserEndpoint,
        pageUrl: startupUrl ?? 'https://chatgpt.com/',
        connectedAt: '2026-04-08T09:00:00.000Z',
      })),
      getConversationSnapshot: vi.fn(async (input) => ({
        conversationId,
        sessionId: input.session.sessionId,
        projectName: 'Default',
        model: 'pro',
        status: 'completed',
        source: 'adapter',
        pageUrl: 'https://chatgpt.com/c/recovered',
        messages: [],
        startedAt: '2026-04-08T09:00:00.000Z',
        updatedAt: '2026-04-08T09:01:00.000Z',
      })),
    };
    const sessionResumeGuard = {
      recoverConversation: vi.fn(async ({ session, conversation }) => ({
        conversationId: conversation.snapshot.conversationId,
        sessionId: session.sessionId,
        projectName: session.projectName ?? 'Default',
        model: session.model,
        status: 'completed',
        source: 'adapter',
        pageUrl: 'https://chatgpt.com/c/recovered',
        messages: [],
        startedAt: '2026-04-08T09:00:00.000Z',
        updatedAt: '2026-04-08T09:01:00.000Z',
      })),
    };

    const service = new ConversationService(
      adapter as never,
      new SessionLease(),
      {} as never,
      { info: vi.fn() } as never,
      undefined,
      sessionResumeGuard as never,
    );

    await service.recoverConversation(conversationId, {
      sessionId,
      browserUrl: 'http://172.18.144.1:9224',
      pageUrl: 'not-a-url',
      projectName: 'Default',
      model: 'pro',
      inputFiles: [],
    });

    expect(adapter.openSession).toHaveBeenCalledWith({
      sessionId,
      browserEndpoint: 'http://172.18.144.1:9224',
      startupUrl: `https://chatgpt.com/c/${conversationId}`,
    });
  });

  it('does not materialize a snapshot before the assistant has visibly started responding', async () => {
    const adapter = {
      openSession: vi.fn(async ({ sessionId }) => ({
        sessionId,
        browserUrl: 'http://172.18.144.1:9224',
        pageUrl: 'https://chatgpt.com/',
        connectedAt: '2026-04-08T09:00:00.000Z',
      })),
      selectProject: vi.fn(async (input) => ({
        ...input.session,
        projectName: input.projectName,
        model: input.model,
      })),
      startConversation: vi.fn(async (input) => ({
        conversationId: input.conversationId,
        sessionId: input.session.sessionId,
        projectName: input.projectName,
        model: input.model,
        status: 'running',
        source: 'adapter',
        pageUrl: 'https://chatgpt.com/',
        messages: [],
        startedAt: '2026-04-08T09:00:00.000Z',
        updatedAt: '2026-04-08T09:00:00.000Z',
      })),
      waitForConversation: vi.fn(async () => {
        throw new Error('service should not delegate long wait to adapter.waitForConversation');
      }),
      getConversationStatus: vi
        .fn()
        .mockResolvedValueOnce({
          conversationId: 'ignored',
          sessionId: 'ignored',
          projectName: 'Default',
          model: 'pro',
          status: 'completed',
          source: 'adapter_status',
          pageUrl: 'https://chatgpt.com/',
          assistantMessageCount: 0,
          lastMessageRole: 'user',
          lastAssistantMessage: undefined,
          updatedAt: '2026-04-08T09:00:01.000Z',
        })
        .mockResolvedValueOnce({
          conversationId: 'ignored',
          sessionId: 'ignored',
          projectName: 'Default',
          model: 'pro',
          status: 'running',
          source: 'adapter_status',
          pageUrl: 'https://chatgpt.com/c/example',
          assistantMessageCount: 0,
          lastMessageRole: 'user',
          lastAssistantMessage: undefined,
          updatedAt: '2026-04-08T09:00:02.000Z',
        })
        .mockResolvedValueOnce({
          conversationId: 'ignored',
          sessionId: 'ignored',
          projectName: 'Default',
          model: 'pro',
          status: 'completed',
          source: 'adapter_status',
          pageUrl: 'https://chatgpt.com/c/example',
          assistantMessageCount: 1,
          lastMessageRole: 'assistant',
          lastAssistantMessage: 'Done',
          updatedAt: '2026-04-08T09:00:03.000Z',
        })
        .mockResolvedValueOnce({
          conversationId: 'ignored',
          sessionId: 'ignored',
          projectName: 'Default',
          model: 'pro',
          status: 'completed',
          source: 'adapter_status',
          pageUrl: 'https://chatgpt.com/c/example',
          assistantMessageCount: 1,
          lastMessageRole: 'assistant',
          lastAssistantMessage: 'Done',
          updatedAt: '2026-04-08T09:00:04.000Z',
        }),
      getConversationSnapshot: vi.fn(async (input) => ({
        conversationId: input.conversationId,
        sessionId: input.session.sessionId,
        projectName: input.session.projectName ?? 'Default',
        model: input.session.model,
        status: 'completed',
        source: 'adapter',
        pageUrl: 'https://chatgpt.com/c/example',
        messages: [
          {
            id: 'assistant-1',
            role: 'assistant',
            text: 'Done',
            createdAt: '2026-04-08T09:00:04.000Z',
            inputFiles: [],
          },
        ],
        lastAssistantMessage: 'Done',
        startedAt: '2026-04-08T09:00:00.000Z',
        updatedAt: '2026-04-08T09:00:04.000Z',
      })),
    };

    const service = new ConversationService(
      adapter as never,
      new SessionLease(),
      {} as never,
      { info: vi.fn() } as never,
    );

    const session = await service.openSession({
      browserEndpoint: 'http://172.18.144.1:9224',
      startupUrl: 'https://chatgpt.com/',
    });
    const selected = await service.selectProject({
      sessionId: session.sessionId,
      projectName: 'Default',
      model: 'pro',
    });
    const started = await service.startConversation({
      sessionId: selected.sessionId,
      prompt: 'hello',
      projectName: 'Default',
      model: 'pro',
      inputFiles: [],
    });

    const snapshot = await service.waitForConversation(started.conversationId, {
      pollIntervalMs: 1,
      stablePolls: 2,
      maxWaitMs: 1_000,
    });

    expect(adapter.getConversationStatus).toHaveBeenCalledTimes(4);
    expect(adapter.getConversationSnapshot).toHaveBeenCalledTimes(1);
    expect(snapshot.lastAssistantMessage).toBe('Done');
  });

  it('fails fast when a running conversation stalls while a retry action is visible', async () => {
    const adapter = {
      openSession: vi.fn(async ({ sessionId, browserEndpoint, startupUrl }) => ({
        sessionId,
        browserUrl: browserEndpoint,
        pageUrl: startupUrl ?? 'https://chatgpt.com/',
        connectedAt: '2026-04-08T09:00:00.000Z',
      })),
      selectProject: vi.fn(async (input) => ({
        ...input.session,
        projectName: input.projectName,
        model: input.model,
      })),
      startConversation: vi.fn(async (input) => ({
        conversationId: input.conversationId,
        sessionId: input.session.sessionId,
        projectName: input.projectName,
        model: input.model,
        status: 'running',
        source: 'adapter',
        pageUrl: 'https://chatgpt.com/c/example',
        messages: [],
        startedAt: '2026-04-08T09:00:00.000Z',
        updatedAt: '2026-04-08T09:00:00.000Z',
      })),
      getConversationStatus: vi.fn(async (input) => ({
        conversationId: input.conversationId,
        sessionId: input.session.sessionId,
        projectName: input.session.projectName ?? 'Default',
        model: input.session.model,
        status: 'running',
        source: 'adapter_status',
        pageUrl: 'https://chatgpt.com/c/example',
        assistantMessageCount: 1,
        lastMessageRole: 'assistant',
        lastAssistantMessage: 'stalled output',
        retryVisible: true,
        updatedAt: '2026-04-08T09:01:00.000Z',
      })),
      getConversationSnapshot: vi.fn(async () => {
        throw new Error('snapshot should not be read for stalled conversation');
      }),
    };

    const service = new ConversationService(
      adapter as never,
      new SessionLease(),
      {} as never,
      { info: vi.fn() } as never,
    );

    const session = await service.openSession({
      browserEndpoint: 'http://172.18.144.1:9224',
      startupUrl: 'https://chatgpt.com/',
    });
    const selected = await service.selectProject({
      sessionId: session.sessionId,
      projectName: 'Default',
      model: 'pro',
    });
    const started = await service.startConversation({
      sessionId: selected.sessionId,
      prompt: 'hello',
      projectName: 'Default',
      model: 'pro',
      inputFiles: [],
    });

    await expect(
      service.waitForConversation(started.conversationId, {
        pollIntervalMs: 1,
        maxWaitMs: 5_000,
      }),
    ).rejects.toMatchObject({
      code: 'CONVERSATION_UNAVAILABLE',
    });
    expect(adapter.getConversationStatus).toHaveBeenCalledTimes(3);
    expect(adapter.getConversationSnapshot).not.toHaveBeenCalled();
  });
});
