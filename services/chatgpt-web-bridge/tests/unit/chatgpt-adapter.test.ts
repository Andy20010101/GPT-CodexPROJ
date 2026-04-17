import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type {
  ConversationSnapshot,
  SessionSummary,
} from '@gpt-codexproj/shared-contracts/chatgpt';

import { PuppeteerChatGPTAdapter } from '../../src/adapters/chatgpt-adapter';

type UploadedAttachment = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  source: 'library';
  libraryFileId: string;
  isBigPaste: boolean;
};

type AdapterTestHarness = {
  attachFiles: (page: unknown, inputFiles: readonly string[]) => Promise<UploadedAttachment[]>;
  sendText: (page: unknown, prompt: string, attachments: readonly UploadedAttachment[]) => Promise<void>;
  buildSeedSnapshot: (input: {
    pageUrl: string;
    session: SessionSummary;
    conversationId: string;
    projectName: string;
    model?: string;
    prompt: string;
    inputFiles: string[];
  }) => ConversationSnapshot;
};

function asAdapterTestHarness(adapter: PuppeteerChatGPTAdapter): AdapterTestHarness {
  return adapter as unknown as AdapterTestHarness;
}

describe('PuppeteerChatGPTAdapter', () => {
  it('delegates project/model selection to the chat session controller', async () => {
    const page = {
      url: vi.fn(() => 'https://chatgpt.com/c/existing'),
    };
    const browserManager = {
      getPage: vi.fn(() => page),
    };
    const preflightGuard = {
      ensureReady: vi.fn(async () => undefined),
    };
    const chatSessionController = {
      selectProject: vi.fn(async () => ({
        sessionId: 'session-1',
        browserUrl: 'http://127.0.0.1:9667',
        pageUrl: 'https://chatgpt.com/c/existing',
        connectedAt: new Date().toISOString(),
        projectName: 'current-session',
        model: 'pro',
      })),
    };

    const adapter = new PuppeteerChatGPTAdapter(
      browserManager as never,
      preflightGuard as never,
      chatSessionController as never,
    );
    const session: SessionSummary = {
      sessionId: 'session-1',
      browserUrl: 'http://127.0.0.1:9667',
      pageUrl: 'https://chatgpt.com/c/existing',
      connectedAt: new Date().toISOString(),
    };

    const result = await adapter.selectProject({
      session,
      projectName: 'Default',
      model: 'pro',
    });

    expect(preflightGuard.ensureReady).toHaveBeenCalledWith(page, 'session_attach');
    expect(chatSessionController.selectProject).toHaveBeenCalledWith({
      page,
      session,
      projectName: 'Default',
      model: 'pro',
    });
    expect(result.model).toBe('pro');
    expect(result.projectName).toBe('current-session');
  });

  it('reapplies project selection after rebinding to a fresh page and returns a lightweight running snapshot', async () => {
    const page = {
      url: vi.fn(() => 'https://chatgpt.com/c/fresh'),
    };
    const browserManager = {
      prepareFreshConversationPage: vi.fn(async () => undefined),
      getPage: vi.fn(() => page as never),
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
      status: 'running',
      source: 'adapter',
      pageUrl: 'https://chatgpt.com/c/fresh',
      messages: [
        {
          id: 'user-1',
          role: 'user',
          text: 'review this change',
          createdAt: new Date().toISOString(),
          inputFiles: [],
        },
      ],
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const selectProject = vi.spyOn(adapter, 'selectProject').mockResolvedValue(reboundSession);
    const attachFiles = vi
      .spyOn(adapter as never, 'attachFiles')
      .mockResolvedValue([]);
    const sendText = vi.spyOn(adapter as never, 'sendText').mockResolvedValue(undefined);
    const buildSeedSnapshot = vi
      .spyOn(adapter as never, 'buildSeedSnapshot')
      .mockReturnValue(snapshot);

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
    expect(sendText).toHaveBeenCalledWith(expect.anything(), 'review this change', []);
    expect(buildSeedSnapshot).toHaveBeenCalledWith({
      pageUrl: 'https://chatgpt.com/c/fresh',
      session: reboundSession,
      conversationId: 'conversation-fallback',
      projectName: 'Alpha Project',
      model: 'pro',
      prompt: 'review this change',
      inputFiles: [],
    });
    expect(result).toBe(snapshot);
  });

  it('waits for a stable completion signature instead of only the last assistant text', async () => {
    const browserManager = {
      getPage: vi.fn(() => ({}) as never),
    };
    const statusReader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({
          status: 'completed',
          assistantMessageCount: 1,
          lastMessageRole: 'assistant',
          lastAssistantMessage: 'Done',
          stabilitySignature: 'sig-1',
        })
        .mockResolvedValueOnce({
          status: 'completed',
          assistantMessageCount: 2,
          lastMessageRole: 'assistant',
          lastAssistantMessage: 'Done',
          stabilitySignature: 'sig-2',
        })
        .mockResolvedValueOnce({
          status: 'completed',
          assistantMessageCount: 2,
          lastMessageRole: 'assistant',
          lastAssistantMessage: 'Done',
          stabilitySignature: 'sig-2',
        }),
    };
    const adapter = new PuppeteerChatGPTAdapter(
      browserManager as never,
      undefined as never,
      undefined as never,
      statusReader as never,
    );

    const session: SessionSummary = {
      sessionId: 'session-1',
      browserUrl: 'http://127.0.0.1:9224',
      pageUrl: 'https://chatgpt.com/c/existing',
      connectedAt: new Date().toISOString(),
    };

    const finalSnapshot: ConversationSnapshot = {
      conversationId: 'conversation-1',
      sessionId: session.sessionId,
      projectName: 'current-session',
      model: 'pro',
      status: 'completed',
      source: 'adapter',
      pageUrl: session.pageUrl,
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          text: 'Done',
          createdAt: new Date().toISOString(),
          inputFiles: [],
        },
        {
          id: 'assistant-2',
          role: 'assistant',
          text: 'Done',
          createdAt: new Date().toISOString(),
          inputFiles: [],
        },
      ],
      lastAssistantMessage: 'Done',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const readSnapshot = vi
      .spyOn(adapter as never, 'readSnapshot')
      .mockResolvedValue(finalSnapshot);

    const result = await adapter.waitForConversation({
      session,
      conversationId: 'conversation-1',
      maxWaitMs: 2_000,
      pollIntervalMs: 1,
      stablePolls: 2,
    });

    expect(statusReader.read).toHaveBeenCalledTimes(3);
    expect(readSnapshot).toHaveBeenCalledTimes(1);
    expect(result.messages).toHaveLength(2);
  });

  it('does not finish early when the page is still user-only before the assistant starts replying', async () => {
    const browserManager = {
      getPage: vi.fn(() => ({}) as never),
    };
    const statusReader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({
          status: 'completed',
          assistantMessageCount: 0,
          lastMessageRole: 'user',
          lastAssistantMessage: undefined,
          stabilitySignature: 'user-only',
        })
        .mockResolvedValueOnce({
          status: 'running',
          assistantMessageCount: 0,
          lastMessageRole: 'user',
          lastAssistantMessage: undefined,
          stabilitySignature: 'running',
        })
        .mockResolvedValueOnce({
          status: 'completed',
          assistantMessageCount: 1,
          lastMessageRole: 'assistant',
          lastAssistantMessage: 'Done',
          stabilitySignature: 'assistant-done',
        })
        .mockResolvedValueOnce({
          status: 'completed',
          assistantMessageCount: 1,
          lastMessageRole: 'assistant',
          lastAssistantMessage: 'Done',
          stabilitySignature: 'assistant-done',
        }),
    };
    const adapter = new PuppeteerChatGPTAdapter(
      browserManager as never,
      undefined as never,
      undefined as never,
      statusReader as never,
    );

    const session: SessionSummary = {
      sessionId: 'session-1',
      browserUrl: 'http://127.0.0.1:9224',
      pageUrl: 'https://chatgpt.com/',
      connectedAt: new Date().toISOString(),
    };

    const finalSnapshot: ConversationSnapshot = {
      conversationId: 'conversation-1',
      sessionId: session.sessionId,
      projectName: 'current-session',
      model: 'pro',
      status: 'completed',
      source: 'adapter',
      pageUrl: 'https://chatgpt.com/c/real',
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          text: 'Done',
          createdAt: new Date().toISOString(),
          inputFiles: [],
        },
      ],
      lastAssistantMessage: 'Done',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const readSnapshot = vi
      .spyOn(adapter as never, 'readSnapshot')
      .mockResolvedValue(finalSnapshot);

    const result = await adapter.waitForConversation({
      session,
      conversationId: 'conversation-1',
      maxWaitMs: 2_000,
      pollIntervalMs: 1,
      stablePolls: 2,
    });

    expect(statusReader.read).toHaveBeenCalledTimes(4);
    expect(readSnapshot).toHaveBeenCalledTimes(1);
    expect(result.pageUrl).toBe('https://chatgpt.com/c/real');
  });

  it('rebinds the session page once when wait encounters a detached frame', async () => {
    const stalePage = {
      url: vi.fn(() => 'https://chatgpt.com/c/stale'),
    };
    const reboundPage = {
      url: vi.fn(() => 'https://chatgpt.com/c/rebound'),
    };
    const browserManager = {
      getPage: vi
        .fn()
        .mockReturnValueOnce(stalePage as never)
        .mockReturnValueOnce(reboundPage as never)
        .mockReturnValue(reboundPage as never),
      rebindSessionPage: vi.fn(async () => reboundPage as never),
    };
    const statusReader = {
      read: vi
        .fn()
        .mockImplementationOnce(async () => {
          throw new Error("Attempted to use detached Frame 'stale'");
        })
        .mockResolvedValueOnce({
          status: 'completed',
          assistantMessageCount: 1,
          lastMessageRole: 'assistant',
          lastAssistantMessage: 'Done',
          stabilitySignature: 'sig-1',
        })
        .mockResolvedValueOnce({
          status: 'completed',
          assistantMessageCount: 1,
          lastMessageRole: 'assistant',
          lastAssistantMessage: 'Done',
          stabilitySignature: 'sig-1',
        }),
    };
    const adapter = new PuppeteerChatGPTAdapter(
      browserManager as never,
      undefined as never,
      undefined as never,
      statusReader as never,
    );

    const session: SessionSummary = {
      sessionId: 'session-1',
      browserUrl: 'http://127.0.0.1:9224',
      pageUrl: 'https://chatgpt.com/c/stale',
      connectedAt: new Date().toISOString(),
    };

    const finalSnapshot: ConversationSnapshot = {
      conversationId: 'conversation-1',
      sessionId: session.sessionId,
      projectName: 'current-session',
      model: 'pro',
      status: 'completed',
      source: 'adapter',
      pageUrl: 'https://chatgpt.com/c/rebound',
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          text: 'Done',
          createdAt: new Date().toISOString(),
          inputFiles: [],
        },
      ],
      lastAssistantMessage: 'Done',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const readSnapshot = vi
      .spyOn(adapter as never, 'readSnapshot')
      .mockResolvedValue(finalSnapshot);

    const result = await adapter.waitForConversation({
      session,
      conversationId: 'conversation-1',
      maxWaitMs: 2_000,
      pollIntervalMs: 1,
      stablePolls: 2,
    });

    expect(browserManager.rebindSessionPage).toHaveBeenCalledWith(session.sessionId);
    expect(statusReader.read).toHaveBeenCalledTimes(3);
    expect(readSnapshot).toHaveBeenCalledWith(
      reboundPage,
      session,
      'conversation-1',
      'unknown-project',
      undefined,
      [],
    );
    expect(result.pageUrl).toBe('https://chatgpt.com/c/rebound');
  });

  it('rebinds the session page once when snapshot recovery encounters a detached frame', async () => {
    const stalePage = {
      url: vi.fn(() => 'https://chatgpt.com/c/stale'),
    };
    const reboundPage = {
      url: vi.fn(() => 'https://chatgpt.com/c/rebound'),
    };
    const browserManager = {
      getPage: vi.fn(() => stalePage as never),
      rebindSessionPage: vi.fn(async () => reboundPage as never),
    };
    const adapter = new PuppeteerChatGPTAdapter(browserManager as never);
    const session: SessionSummary = {
      sessionId: 'session-1',
      browserUrl: 'http://127.0.0.1:9224',
      pageUrl: 'https://chatgpt.com/c/stale',
      connectedAt: new Date().toISOString(),
      projectName: 'Default',
      model: 'pro',
    };
    const readSnapshot = vi
      .spyOn(adapter as never, 'readSnapshot')
      .mockRejectedValueOnce(new Error("Attempted to use detached Frame 'stale'"))
      .mockResolvedValueOnce({
        conversationId: 'conversation-1',
        sessionId: session.sessionId,
        projectName: 'Default',
        model: 'pro',
        status: 'completed',
        source: 'adapter',
        pageUrl: 'https://chatgpt.com/c/rebound',
        messages: [],
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } satisfies ConversationSnapshot);

    const result = await adapter.getConversationSnapshot({
      session,
      conversationId: 'conversation-1',
    });

    expect(browserManager.rebindSessionPage).toHaveBeenCalledWith(session.sessionId);
    expect(readSnapshot).toHaveBeenNthCalledWith(
      2,
      reboundPage,
      session,
      'conversation-1',
      'Default',
      'pro',
      [],
    );
    expect(result.pageUrl).toBe('https://chatgpt.com/c/rebound');
  });

  it('returns a lightweight running snapshot when sending a follow-up message', async () => {
    const page = {
      url: vi.fn(() => 'https://chatgpt.com/c/existing'),
    };
    const browserManager = {
      getPage: vi.fn(() => page as never),
    };
    const preflightGuard = {
      ensureReady: vi.fn(async () => undefined),
    };
    const adapter = new PuppeteerChatGPTAdapter(browserManager as never, preflightGuard as never);

    const session: SessionSummary = {
      sessionId: 'session-1',
      browserUrl: 'http://127.0.0.1:9224',
      pageUrl: 'https://chatgpt.com/c/existing',
      connectedAt: new Date().toISOString(),
      projectName: 'Default',
      model: 'pro',
    };
    const attachFiles = vi.spyOn(adapter as never, 'attachFiles').mockResolvedValue([]);
    const sendText = vi.spyOn(adapter as never, 'sendText').mockResolvedValue(undefined);
    const buildSeedSnapshot = vi.spyOn(adapter as never, 'buildSeedSnapshot').mockReturnValue({
      conversationId: 'conversation-1',
      sessionId: session.sessionId,
      projectName: 'Default',
      model: 'pro',
      status: 'running',
      source: 'adapter',
      pageUrl: 'https://chatgpt.com/c/existing',
      messages: [
        {
          id: 'user-1',
          role: 'user',
          text: 'please retry with JSON',
          createdAt: new Date().toISOString(),
          inputFiles: [],
        },
      ],
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } satisfies ConversationSnapshot);
    const readSnapshot = vi.spyOn(adapter as never, 'readSnapshot');

    const result = await adapter.sendMessage({
      session,
      conversationId: 'conversation-1',
      message: 'please retry with JSON',
      inputFiles: [],
    });

    expect(preflightGuard.ensureReady).toHaveBeenCalledWith(page, 'send');
    expect(attachFiles).toHaveBeenCalledWith(page, []);
    expect(sendText).toHaveBeenCalledWith(page, 'please retry with JSON', []);
    expect(buildSeedSnapshot).toHaveBeenCalledWith({
      pageUrl: 'https://chatgpt.com/c/existing',
      session,
      conversationId: 'conversation-1',
      projectName: 'Default',
      model: 'pro',
      prompt: 'please retry with JSON',
      inputFiles: [],
    });
    expect(readSnapshot).not.toHaveBeenCalled();
    expect(result.status).toBe('running');
    expect(result.messages).toHaveLength(1);
  });

  it('uploads files through the manual my_files flow and returns library-backed attachments', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'chatgpt-adapter-'));
    const fileContents = '# summary\n';
    const filePath = join(tempDir, 'repo-summary.md');
    await writeFile(filePath, fileContents, 'utf8');

    try {
      const page = {
        evaluate: vi.fn(async (_fn: unknown, ...args: unknown[]) => {
          if (args.length === 0) {
            return 'access-token';
          }

          if (
            typeof args[0] === 'object' &&
            args[0] !== null &&
            'file_name' in args[0] &&
            'timezone_offset_min' in args[0]
          ) {
            return {
              ok: true,
              status: 200,
              text: JSON.stringify({
                file_id: 'file-1',
                upload_url: 'https://upload.example/file-1',
              }),
              json: {
                file_id: 'file-1',
                upload_url: 'https://upload.example/file-1',
              },
            };
          }

          if (typeof args[0] === 'string' && args[0] === 'https://upload.example/file-1') {
            return {
              ok: true,
              status: 201,
              text: '',
            };
          }

          if (
            typeof args[0] === 'object' &&
            args[0] !== null &&
            'file_id' in args[0] &&
            args[0].file_id === 'file-1'
          ) {
            return {
              ok: true,
              status: 200,
              text: `${JSON.stringify({
                file_id: 'file-1',
                event: 'file.indexing.completed',
                extra: {
                  metadata_object_id: 'libfile-1',
                  library_file_name: 'repo-summary(3).md',
                },
              })}\n`,
            };
          }

          throw new Error(`Unexpected evaluate call: ${JSON.stringify(args)}`);
        }),
      };
      const adapter = new PuppeteerChatGPTAdapter({} as never);
      const adapterHarness = asAdapterTestHarness(adapter);

      const attachments = await adapterHarness.attachFiles(page, [filePath]);

      expect(attachments).toEqual([
        {
          id: 'file-1',
          name: 'repo-summary(3).md',
          size: Buffer.byteLength(fileContents),
          mimeType: 'text/markdown',
          source: 'library',
          libraryFileId: 'libfile-1',
          isBigPaste: false,
        },
      ]);
      expect(page.evaluate).toHaveBeenNthCalledWith(
        2,
        expect.any(Function),
        {
          file_name: 'repo-summary.md',
          file_size: Buffer.byteLength(fileContents),
          use_case: 'my_files',
          timezone_offset_min: new Date().getTimezoneOffset(),
          reset_rate_limits: false,
          store_in_library: true,
        },
        'access-token',
      );
      expect(page.evaluate).toHaveBeenNthCalledWith(
        4,
        expect.any(Function),
        {
          file_id: 'file-1',
          use_case: 'my_files',
          index_for_retrieval: true,
          file_name: 'repo-summary.md',
          metadata: {
            store_in_library: true,
          },
        },
        'access-token',
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('injects uploaded attachments into the intercepted conversation request when sending text', async () => {
    let requestPausedHandler:
      | ((
          event: {
            requestId: string;
            request: { method: string; postData?: string | undefined };
          },
        ) => void)
      | null = null;
    const cdpSession = {
      on: vi.fn((event: string, handler: typeof requestPausedHandler) => {
        if (event === 'Fetch.requestPaused') {
          requestPausedHandler = handler;
        }
      }),
      send: vi.fn(async () => ({})),
      detach: vi.fn(async () => undefined),
    };
    const sendHandle = {
      click: vi.fn(async () => {
        requestPausedHandler?.({
          requestId: 'request-1',
          request: {
            method: 'POST',
            postData: JSON.stringify({
              messages: [
                {
                  metadata: {
                    attachments: [{ id: 'existing-file' }],
                  },
                },
              ],
            }),
          },
        });
      }),
      boundingBox: vi.fn(async () => null),
    };
    const page = {
      $: vi.fn(async (selector: string) => {
        if (selector === '#prompt-textarea') {
          return {} as never;
        }
        if (selector === '[data-testid="send-button"]') {
          return sendHandle as never;
        }
        return null;
      }),
      evaluate: vi.fn(async (_fn: unknown, ...args: unknown[]) => {
        if (args[0] === '#prompt-textarea' && args[1] === 'review this change') {
          return true;
        }

        if (args[0] === '#prompt-textarea') {
          return '';
        }

        return undefined;
      }),
      createCDPSession: vi.fn(async () => cdpSession),
      keyboard: {
        press: vi.fn(async () => undefined),
      },
      mouse: {
        click: vi.fn(async () => undefined),
      },
      url: vi.fn(() => 'https://chatgpt.com/c/existing'),
    };
    const preflightGuard = {
      ensureReady: vi.fn(async () => undefined),
    };
    const adapter = new PuppeteerChatGPTAdapter({} as never, preflightGuard as never);
    const adapterHarness = asAdapterTestHarness(adapter);

    await adapterHarness.sendText(page, 'review this change', [
      {
        id: 'file-1',
        name: 'repo-summary.md',
        size: 123,
        mimeType: 'text/markdown',
        source: 'library',
        libraryFileId: 'libfile-1',
        isBigPaste: false,
      },
    ]);

    expect(cdpSession.send).toHaveBeenCalledWith('Fetch.enable', {
      patterns: [
        {
          urlPattern: '*backend-api/f/conversation*',
          requestStage: 'Request',
        },
      ],
    });

    const sendCalls = cdpSession.send.mock.calls as unknown as Array<[string, unknown?]>;
    const continueCall = sendCalls.find((call) => call[0] === 'Fetch.continueRequest');
    expect(continueCall).toBeDefined();
    const continuePayload = continueCall?.[1] as { postData: string } | undefined;
    if (!continuePayload) {
      throw new Error('Expected Fetch.continueRequest to carry a payload.');
    }
    const interceptedPayload = JSON.parse(
      Buffer.from(continuePayload.postData, 'base64').toString('utf8'),
    ) as {
      messages: Array<{
        metadata: {
          attachments: Array<Record<string, unknown>>;
        };
      }>;
    };

    expect(interceptedPayload.messages[0]?.metadata.attachments).toEqual([
      { id: 'existing-file' },
      {
        id: 'file-1',
        name: 'repo-summary.md',
        size: 123,
        mime_type: 'text/markdown',
        source: 'library',
        library_file_id: 'libfile-1',
        is_big_paste: false,
      },
    ]);
    expect(cdpSession.send).toHaveBeenCalledWith('Fetch.disable');
    expect(cdpSession.detach).toHaveBeenCalled();
  });

  it('fails fast when the intercepted conversation request never continues', async () => {
    vi.useFakeTimers();
    try {
      let requestPausedHandler:
        | ((
            event: {
              requestId: string;
              request: { method: string; postData?: string | undefined };
            },
          ) => void)
        | null = null;
      let submissionStarted = false;
      const cdpSession = {
        on: vi.fn((event: string, handler: typeof requestPausedHandler) => {
          if (event === 'Fetch.requestPaused') {
            requestPausedHandler = handler;
          }
        }),
        send: vi.fn(async (method: string) => {
          if (method === 'Fetch.continueRequest') {
            return await new Promise(() => undefined);
          }
          return {};
        }),
        detach: vi.fn(async () => undefined),
      };
      const sendHandle = {
        click: vi.fn(async () => {
          submissionStarted = true;
          requestPausedHandler?.({
            requestId: 'request-1',
            request: {
              method: 'POST',
              postData: JSON.stringify({
                messages: [
                  {
                    metadata: {},
                  },
                ],
              }),
            },
          });
        }),
        boundingBox: vi.fn(async () => null),
      };
      const page = {
        $: vi.fn(async (selector: string) => {
          if (selector === '#prompt-textarea') {
            return {} as never;
          }
          if (selector === '[data-testid="send-button"]') {
            return sendHandle as never;
          }
          return null;
        }),
        evaluate: vi.fn(async (_fn: unknown, ...args: unknown[]) => {
          if (args[0] === '#prompt-textarea' && args[1] === 'review this change') {
            return true;
          }

          if (args[0] === '#prompt-textarea') {
            return submissionStarted ? '' : 'review this change';
          }

          return undefined;
        }),
        createCDPSession: vi.fn(async () => cdpSession),
        keyboard: {
          press: vi.fn(async () => undefined),
        },
        mouse: {
          click: vi.fn(async () => undefined),
        },
        url: vi.fn(() =>
          submissionStarted ? 'https://chatgpt.com/c/pending' : 'https://chatgpt.com/',
        ),
      };
      const preflightGuard = {
        ensureReady: vi.fn(async () => undefined),
      };
      const adapter = new PuppeteerChatGPTAdapter({} as never, preflightGuard as never);
      const adapterHarness = asAdapterTestHarness(adapter);

      const pending = adapterHarness.sendText(page, 'review this change', [
        {
          id: 'file-1',
          name: 'repo-summary.md',
          size: 123,
          mimeType: 'text/markdown',
          source: 'library',
          libraryFileId: 'libfile-1',
          isBigPaste: false,
        },
      ]);
      const rejection = expect(pending).rejects.toMatchObject({
        code: 'CHATGPT_ATTACHMENT_INJECTION_FAILED',
      });

      await vi.advanceTimersByTimeAsync(10_500);

      await rejection;
      expect(cdpSession.send).toHaveBeenCalledWith('Fetch.disable');
      expect(cdpSession.detach).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not keep clicking after the first send-button click starts submission', async () => {
    const sendHandle = {
      click: vi.fn(async () => undefined),
      boundingBox: vi.fn(async () => ({
        x: 10,
        y: 20,
        width: 30,
        height: 40,
      })),
    };
    const page = {
      $: vi.fn(async (selector: string) => {
        if (selector === '#prompt-textarea') {
          return {} as never;
        }
        if (selector === '[data-testid="send-button"]') {
          return sendHandle as never;
        }
        return null;
      }),
      evaluate: vi.fn(async (_fn: unknown, ...args: unknown[]) => {
        if (args[0] === '#prompt-textarea' && args[1] === 'Reply with OK only.') {
          return true;
        }

        if (args[0] === '#prompt-textarea') {
          return '';
        }

        return undefined;
      }),
      keyboard: {
        press: vi.fn(async () => undefined),
      },
      mouse: {
        click: vi.fn(async () => undefined),
      },
      url: vi.fn(() => 'https://chatgpt.com/'),
    };
    const preflightGuard = {
      ensureReady: vi.fn(async () => undefined),
    };
    const adapter = new PuppeteerChatGPTAdapter({} as never, preflightGuard as never);
    const adapterHarness = asAdapterTestHarness(adapter);

    await adapterHarness.sendText(page, 'Reply with OK only.', []);

    expect(sendHandle.click).toHaveBeenCalledTimes(1);
    expect(page.mouse.click).not.toHaveBeenCalled();
    expect(page.keyboard.press).not.toHaveBeenCalled();
    expect(page.evaluate).toHaveBeenCalledTimes(2);
  });

  it('uses the real ChatGPT conversation id from the page url when seeding a snapshot', () => {
    const adapter = new PuppeteerChatGPTAdapter({} as never);
    const adapterHarness = asAdapterTestHarness(adapter);
    const session: SessionSummary = {
      sessionId: 'session-1',
      browserUrl: 'http://127.0.0.1:9224',
      pageUrl: 'https://chatgpt.com/',
      connectedAt: new Date().toISOString(),
    };

    const snapshot = adapterHarness.buildSeedSnapshot({
      pageUrl: 'https://chatgpt.com/c/67bf99bb-2ef2-4d3f-a1d2-12461e3d516a',
      session,
      conversationId: 'internal-fallback-id',
      projectName: 'Default',
      model: 'gpt-5.4',
      prompt: 'review this execution',
      inputFiles: [],
    }) as ConversationSnapshot;

    expect(snapshot.conversationId).toBe('67bf99bb-2ef2-4d3f-a1d2-12461e3d516a');
    expect(snapshot.pageUrl).toBe('https://chatgpt.com/c/67bf99bb-2ef2-4d3f-a1d2-12461e3d516a');
  });

  it('falls back to the internal conversation id when the page url does not expose a ChatGPT conversation id', () => {
    const adapter = new PuppeteerChatGPTAdapter({} as never);
    const adapterHarness = asAdapterTestHarness(adapter);
    const session: SessionSummary = {
      sessionId: 'session-1',
      browserUrl: 'http://127.0.0.1:9224',
      pageUrl: 'https://chatgpt.com/',
      connectedAt: new Date().toISOString(),
    };

    const snapshot = adapterHarness.buildSeedSnapshot({
      pageUrl: 'https://chatgpt.com/',
      session,
      conversationId: 'internal-fallback-id',
      projectName: 'Default',
      model: 'gpt-5.4',
      prompt: 'review this execution',
      inputFiles: [],
    }) as ConversationSnapshot;

    expect(snapshot.conversationId).toBe('internal-fallback-id');
  });
});
