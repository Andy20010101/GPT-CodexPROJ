import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { randomUUID } from 'node:crypto';

import type { ElementHandle, Page } from 'puppeteer-core';

import type {
  ConversationStatus,
  ConversationSnapshot,
  SessionSummary,
} from '@review-then-codex/shared-contracts/chatgpt';

import { BrowserManager } from '../browser/browser-manager';
import { ChatGPTSelectors } from '../dom/selectors';
import { PreflightGuard } from '../guards/preflight-guard';
import { ChatSessionController } from '../services/chat-session-controller';
import { ConversationStatusReader } from '../services/conversation-status-reader';
import { AppError } from '../types/error';
import type {
  AdapterMessageInput,
  AdapterSelectProjectInput,
  AdapterSessionOpenInput,
  AdapterSnapshotInput,
  AdapterStartConversationInput,
  AdapterWaitInput,
  ChatGPTAdapter,
} from '../types/runtime';

const DEFAULT_TIMEOUT_MS = 15_000;
const RETRY_VISIBLE_STALL_POLLS = 3;
const ATTACHMENT_REQUEST_INTERCEPT_TIMEOUT_MS = 5_000;
const MIME_TYPES_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
  '.py': 'text/x-python',
  '.html': 'text/html',
  '.css': 'text/css',
  '.csv': 'text/csv',
  '.xml': 'application/xml',
  '.yaml': 'application/x-yaml',
  '.yml': 'application/x-yaml',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
};

type UploadedConversationAttachment = {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly mimeType: string;
  readonly source: 'library';
  readonly libraryFileId: string;
  readonly isBigPaste: boolean;
};

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

async function waitForPromise<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    return await new Promise<T>((resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(message));
      }, timeoutMs);
      promise.then(resolve, reject);
    });
  } finally {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }
  }
}

function inferMimeType(filePath: string): string {
  return MIME_TYPES_BY_EXTENSION[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

function inferConversationAttachmentMimeType(filePath: string): string {
  const extension = extname(filePath).toLowerCase();
  if (extension === '.patch' || extension === '.diff') {
    return '';
  }

  return inferMimeType(filePath);
}

function isDetachedPageError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return [
    'Attempted to use detached Frame',
    'Execution context was destroyed',
    'Navigating frame was detached',
    'Cannot find context with specified id',
  ].some((pattern) => error.message.includes(pattern));
}

function hasReplyStarted(status: {
  status: 'running' | 'completed' | 'failed';
  assistantMessageCount: number;
  lastMessageRole: 'assistant' | 'user' | 'none';
}): boolean {
  return (
    status.status === 'running' ||
    status.assistantMessageCount > 0 ||
    status.lastMessageRole === 'assistant'
  );
}

async function firstHandle(
  page: Page,
  selectors: readonly string[],
): Promise<ElementHandle | null> {
  for (const selector of selectors) {
    const handle = await page.$(selector);
    if (handle) {
      return handle;
    }
  }
  return null;
}

async function exists(page: Page, selectors: readonly string[]): Promise<boolean> {
  return (await firstHandle(page, selectors)) !== null;
}

async function waitForAnySelector(page: Page, selectors: readonly string[]): Promise<string> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < DEFAULT_TIMEOUT_MS) {
    for (const selector of selectors) {
      if ((await page.$(selector)) !== null) {
        return selector;
      }
    }
    await sleep(150);
  }

  throw new AppError('DOM_DRIFT_DETECTED', 'Expected selector was not found on the page', 503, {
    selectors,
  });
}

async function readComposerValue(page: Page, selector: string): Promise<string | null> {
  return page.evaluate((inputSelector) => {
    const input = document.querySelector<
      HTMLTextAreaElement | HTMLInputElement | HTMLElement
    >(inputSelector);
    if (!input) {
      return null;
    }

    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      return input.value ?? '';
    }

    return input.textContent ?? '';
  }, selector);
}

async function isComposerCleared(page: Page, selector: string): Promise<boolean> {
  const value = await readComposerValue(page, selector);
  return value === null || value.trim().length === 0;
}

async function focusComposer(page: Page, selector: string): Promise<void> {
  await page.evaluate((inputSelector) => {
    const input = document.querySelector<HTMLElement>(inputSelector);
    input?.focus();
  }, selector);
}

async function waitForSubmissionStart(page: Page, selector: string): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 3_000) {
    if (await isComposerCleared(page, selector)) {
      return true;
    }

    if (page.url().includes('/c/')) {
      return true;
    }

    if (await exists(page, ChatGPTSelectors.composer.stopButton)) {
      return true;
    }

    await sleep(150);
  }

  return false;
}

async function waitForConversationPageUrl(
  page: Page,
  fallbackUrl: string | undefined,
  timeoutMs = 3_000,
): Promise<string | undefined> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const currentUrl = page.url();
    if (currentUrl.includes('/c/')) {
      return currentUrl;
    }
    await sleep(150);
  }

  return page.url() || fallbackUrl;
}

async function clickSendButton(
  page: Page,
  composerSelector: string,
  sendHandle: ElementHandle,
): Promise<boolean> {
  const attempts: Array<() => Promise<void>> = [
    async () => {
      await sendHandle.click();
    },
    async () => {
      await page.evaluate((selectors) => {
        for (const selector of selectors) {
          const button = document.querySelector<HTMLElement>(selector);
          if (!button) {
            continue;
          }
          button.click();
          return;
        }
      }, [...ChatGPTSelectors.composer.sendButton]);
    },
    async () => {
      const box = await sendHandle.boundingBox();
      if (!box) {
        throw new Error('Send button bounding box is unavailable.');
      }
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    },
  ];

  for (const attempt of attempts) {
    await attempt().catch(() => undefined);
    if (await waitForSubmissionStart(page, composerSelector)) {
      return true;
    }
  }

  return false;
}

async function getAccessToken(page: Page): Promise<string> {
  const accessToken = await page.evaluate(async () => {
    const response = await fetch('/api/auth/session');
    const session = (await response.json()) as { accessToken?: string };
    return typeof session.accessToken === 'string' ? session.accessToken : null;
  });

  if (!accessToken) {
    throw new AppError(
      'CHATGPT_ATTACHMENT_UPLOAD_FAILED',
      'ChatGPT session access token is unavailable for attachment upload.',
      503,
    );
  }

  return accessToken;
}

async function createRemoteFile(
  page: Page,
  accessToken: string,
  payload: {
    file_name: string;
    file_size: number;
    use_case: 'my_files';
    timezone_offset_min: number;
    reset_rate_limits: boolean;
    store_in_library: boolean;
  },
): Promise<{ file_id: string; upload_url: string }> {
  const response = await page.evaluate(
    async (body, token) => {
      const uploadResponse = await fetch('/backend-api/files', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const text = await uploadResponse.text();
      let json: { file_id?: string; upload_url?: string } | null = null;
      try {
        json = JSON.parse(text) as { file_id?: string; upload_url?: string };
      } catch {
        json = null;
      }

      return {
        ok: uploadResponse.ok,
        status: uploadResponse.status,
        text,
        json,
      };
    },
    payload,
    accessToken,
  );

  if (!response.ok || !response.json?.file_id || !response.json.upload_url) {
    throw new AppError(
      'CHATGPT_ATTACHMENT_UPLOAD_FAILED',
      'ChatGPT did not accept the attachment upload request.',
      503,
      {
        status: response.status,
        response: response.text,
        fileName: payload.file_name,
      },
    );
  }

  return {
    file_id: response.json.file_id,
    upload_url: response.json.upload_url,
  };
}

async function uploadBlobToUrl(
  page: Page,
  uploadUrl: string,
  fileContent: Buffer,
): Promise<void> {
  const response = await page.evaluate(
    async (url, base64Content) => {
      const binary = atob(base64Content);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }

      const uploadResponse = await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          'x-ms-blob-type': 'BlockBlob',
          'x-ms-version': '2020-04-08',
        },
        body: bytes,
      });

      return {
        ok: uploadResponse.ok,
        status: uploadResponse.status,
        text: await uploadResponse.text().catch(() => ''),
      };
    },
    uploadUrl,
    fileContent.toString('base64'),
  );

  if (!response.ok && response.status !== 201) {
    throw new AppError(
      'CHATGPT_ATTACHMENT_UPLOAD_FAILED',
      'Blob upload for the ChatGPT attachment failed.',
      503,
      {
        status: response.status,
        response: response.text,
        uploadUrl,
      },
    );
  }
}

async function processRemoteFileUpload(
  page: Page,
  accessToken: string,
  payload: {
    file_id: string;
    use_case: 'my_files';
    index_for_retrieval: boolean;
    file_name: string;
    metadata: {
      store_in_library: boolean;
    };
  },
): Promise<{
  libraryFileId: string;
  libraryFileName: string;
}> {
  const response = await page.evaluate(
    async (body, token) => {
      const uploadStreamResponse = await fetch('/backend-api/files/process_upload_stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      return {
        ok: uploadStreamResponse.ok,
        status: uploadStreamResponse.status,
        text: await uploadStreamResponse.text().catch(() => ''),
      };
    },
    payload,
    accessToken,
  );

  if (!response.ok) {
    throw new AppError(
      'CHATGPT_ATTACHMENT_UPLOAD_FAILED',
      'ChatGPT did not finish processing the uploaded attachment.',
      503,
      {
        status: response.status,
        response: response.text,
        fileId: payload.file_id,
      },
    );
  }

  const events = response.text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as {
          extra?: {
            metadata_object_id?: string;
            library_file_name?: string;
          } | null;
        };
      } catch {
        return null;
      }
    })
    .filter((event): event is { extra?: { metadata_object_id?: string; library_file_name?: string } | null } => event !== null);
  const libraryEvent = events.find(
    (event) => typeof event.extra?.metadata_object_id === 'string',
  );

  if (!libraryEvent?.extra?.metadata_object_id) {
    throw new AppError(
      'CHATGPT_ATTACHMENT_UPLOAD_FAILED',
      'ChatGPT processed the attachment but did not register a library-backed file.',
      503,
      {
        fileId: payload.file_id,
        response: response.text,
      },
    );
  }

  return {
    libraryFileId: libraryEvent.extra.metadata_object_id,
    libraryFileName:
      typeof libraryEvent.extra.library_file_name === 'string' &&
      libraryEvent.extra.library_file_name.length > 0
        ? libraryEvent.extra.library_file_name
        : payload.file_name,
  };
}

export class PuppeteerChatGPTAdapter implements ChatGPTAdapter {
  public constructor(
    private readonly browserManager: BrowserManager,
    private readonly preflightGuard = new PreflightGuard(),
    private readonly chatSessionController = new ChatSessionController(),
    private readonly conversationStatusReader = new ConversationStatusReader(),
  ) {}

  public async openSession(input: AdapterSessionOpenInput): Promise<SessionSummary> {
    const { pageUrl, browserUrl } = await this.browserManager.openSession(input);
    const page = this.browserManager.getPage(input.sessionId);
    await this.preflightGuard.ensureReady(page, 'session_attach');

    return {
      sessionId: input.sessionId,
      browserUrl,
      pageUrl,
      connectedAt: new Date().toISOString(),
    };
  }

  public async selectProject(input: AdapterSelectProjectInput): Promise<SessionSummary> {
    return this.withLiveSessionPage(input.session.sessionId, async (page) => {
      await this.preflightGuard.ensureReady(page, 'session_attach');

      return this.chatSessionController.selectProject({
        page,
        session: input.session,
        projectName: input.projectName,
        ...(input.model ? { model: input.model } : {}),
      });
    });
  }

  public async startConversation(
    input: AdapterStartConversationInput,
  ): Promise<ConversationSnapshot> {
    await this.browserManager.prepareFreshConversationPage(input.session.sessionId);
    const session = await this.selectProject({
      session: input.session,
      projectName: input.projectName,
      ...(input.model ? { model: input.model } : {}),
    });

    const page = this.browserManager.getPage(session.sessionId);
    const attachments = await this.attachFiles(page, input.inputFiles);
    await this.sendText(page, input.prompt, attachments);
    const conversationPageUrl = await waitForConversationPageUrl(page, session.pageUrl);

    return this.buildSeedSnapshot({
      pageUrl: conversationPageUrl,
      session,
      conversationId: input.conversationId,
      projectName: input.projectName,
      model: input.model ?? session.model,
      prompt: input.prompt,
      inputFiles: input.inputFiles,
    });
  }

  public async sendMessage(input: AdapterMessageInput): Promise<ConversationSnapshot> {
    const page = await this.withLiveSessionPage(input.session.sessionId, async (currentPage) => {
      await this.preflightGuard.ensureReady(currentPage, 'send');
      const attachments = await this.attachFiles(currentPage, input.inputFiles);
      await this.sendText(currentPage, input.message, attachments);
      return currentPage;
    });
    const conversationPageUrl = await waitForConversationPageUrl(page, input.session.pageUrl);

    return this.buildSeedSnapshot({
      pageUrl: conversationPageUrl,
      session: input.session,
      conversationId: input.conversationId,
      projectName: input.session.projectName ?? 'unknown-project',
      model: input.session.model,
      prompt: input.message,
      inputFiles: input.inputFiles,
    });
  }

  public async waitForConversation(input: AdapterWaitInput): Promise<ConversationSnapshot> {
    const deadline = Date.now() + (input.maxWaitMs ?? 120_000);
    const interval = input.pollIntervalMs ?? 1_000;
    const stablePolls = input.stablePolls ?? 2;

    let lastCompletionSignature = '';
    let stableReads = 0;
    let replyStarted = false;
    let lastRunningSignature = '';
    let stalledRunningReads = 0;

    while (Date.now() <= deadline) {
      const statusReading = await this.withLiveSessionPage(
        input.session.sessionId,
        async (page) => this.conversationStatusReader.read(page),
      );
      if (statusReading.status === 'failed') {
        throw new AppError(
          'CONVERSATION_UNAVAILABLE',
            'Conversation generation failed and requires retry.',
          503,
          {
            conversationId: input.conversationId,
            lastAssistantMessage: statusReading.lastAssistantMessage,
            pageUrl: this.browserManager.getPage(input.session.sessionId).url(),
          },
        );
      }
      replyStarted ||= hasReplyStarted(statusReading);

      if (
        replyStarted &&
        statusReading.status === 'running' &&
        statusReading.retryVisible
      ) {
        if (statusReading.stabilitySignature === lastRunningSignature) {
          stalledRunningReads += 1;
        } else {
          lastRunningSignature = statusReading.stabilitySignature;
          stalledRunningReads = 1;
        }

        if (stalledRunningReads >= RETRY_VISIBLE_STALL_POLLS) {
          throw new AppError(
            'CONVERSATION_UNAVAILABLE',
            'Conversation appears stalled while ChatGPT is offering a retry action.',
            503,
            {
              conversationId: input.conversationId,
              lastAssistantMessage: statusReading.lastAssistantMessage,
              pageUrl: this.browserManager.getPage(input.session.sessionId).url(),
              retryVisible: true,
            },
          );
        }
      } else {
        lastRunningSignature = '';
        stalledRunningReads = 0;
      }

      if (replyStarted && statusReading.status === 'completed') {
        if (statusReading.stabilitySignature === lastCompletionSignature) {
          stableReads += 1;
        } else {
          lastCompletionSignature = statusReading.stabilitySignature;
          stableReads = 1;
        }

        if (stableReads >= stablePolls) {
          const page = this.browserManager.getPage(input.session.sessionId);
          return this.readSnapshot(
            page,
            input.session,
            input.conversationId,
            input.session.projectName ?? 'unknown-project',
            input.session.model,
            [],
          );
        }
      } else {
        lastCompletionSignature = '';
        stableReads = 0;
      }

      await sleep(interval);
    }

    throw new AppError('CHATGPT_NOT_READY', 'Conversation did not complete before timeout', 504, {
      conversationId: input.conversationId,
    });
  }

  public async getConversationStatus(input: AdapterSnapshotInput): Promise<ConversationStatus> {
    const statusReading = await this.withLiveSessionPage(input.session.sessionId, async (current) =>
      this.conversationStatusReader.read(current),
    );
    const page = this.browserManager.getPage(input.session.sessionId);

    return {
      conversationId: input.conversationId,
      sessionId: input.session.sessionId,
      projectName: input.session.projectName ?? 'unknown-project',
      model: input.session.model,
      status: statusReading.status,
      source: 'adapter_status',
      pageUrl: page.url() || input.session.pageUrl,
      assistantMessageCount: statusReading.assistantMessageCount,
      lastMessageRole: statusReading.lastMessageRole,
      lastAssistantMessage: statusReading.lastAssistantMessage,
      retryVisible: statusReading.retryVisible,
      updatedAt: new Date().toISOString(),
    };
  }

  public async getConversationSnapshot(input: AdapterSnapshotInput): Promise<ConversationSnapshot> {
    return this.withLiveSessionPage(input.session.sessionId, async (page) =>
      this.readSnapshot(
        page,
        input.session,
        input.conversationId,
        input.session.projectName ?? 'unknown-project',
        input.session.model,
        [],
      ),
    );
  }

  private async withLiveSessionPage<T>(
    sessionId: string,
    operation: (page: Page) => Promise<T>,
  ): Promise<T> {
    const page = this.browserManager.getPage(sessionId);
    try {
      return await operation(page);
    } catch (error) {
      if (!isDetachedPageError(error)) {
        throw error;
      }

      const reboundPage = await this.browserManager.rebindSessionPage(sessionId);
      return operation(reboundPage);
    }
  }

  private async attachFiles(
    page: Page,
    files: readonly string[],
  ): Promise<readonly UploadedConversationAttachment[]> {
    if (files.length === 0) {
      return [];
    }

    const accessToken = await getAccessToken(page);
    const timezoneOffsetMinutes = new Date().getTimezoneOffset();
    const attachments: UploadedConversationAttachment[] = [];

    for (const filePath of files) {
      const fileContent = await readFile(filePath);
      const fileName = basename(filePath);
      const fileSize = fileContent.byteLength;
      const mimeType = inferConversationAttachmentMimeType(filePath);
      const remoteFile = await createRemoteFile(page, accessToken, {
        file_name: fileName,
        file_size: fileSize,
        use_case: 'my_files',
        timezone_offset_min: timezoneOffsetMinutes,
        reset_rate_limits: false,
        store_in_library: true,
      });
      await uploadBlobToUrl(page, remoteFile.upload_url, fileContent);
      const processedFile = await processRemoteFileUpload(page, accessToken, {
        file_id: remoteFile.file_id,
        use_case: 'my_files',
        index_for_retrieval: true,
        file_name: fileName,
        metadata: {
          store_in_library: true,
        },
      });
      attachments.push({
        id: remoteFile.file_id,
        name: processedFile.libraryFileName,
        size: fileSize,
        mimeType,
        source: 'library',
        libraryFileId: processedFile.libraryFileId,
        isBigPaste: false,
      });
    }

    return attachments;
  }

  private buildSeedSnapshot(input: {
    pageUrl: string | undefined;
    session: SessionSummary;
    conversationId: string;
    projectName: string;
    model?: string | undefined;
    prompt: string;
    inputFiles: readonly string[];
  }): ConversationSnapshot {
    const timestamp = new Date().toISOString();
    return {
      conversationId: this.resolveConversationId(
        input.pageUrl ?? input.session.pageUrl ?? '',
        input.conversationId,
      ),
      sessionId: input.session.sessionId,
      projectName: input.projectName,
      model: input.model,
      status: 'running',
      source: 'adapter',
      pageUrl: input.pageUrl ?? input.session.pageUrl,
      messages: [
        {
          id: randomUUID(),
          role: 'user',
          text: input.prompt,
          createdAt: timestamp,
          inputFiles: [...input.inputFiles],
        },
      ],
      startedAt: timestamp,
      updatedAt: timestamp,
    };
  }

  private async sendText(
    page: Page,
    message: string,
    attachments: readonly UploadedConversationAttachment[] = [],
  ): Promise<void> {
    await this.preflightGuard.ensureReady(page, 'send');
    const composerSelector = await waitForAnySelector(page, ChatGPTSelectors.composer.input);
    const wroteMessage = await page.evaluate(
      (selector, nextMessage) => {
        const input = document.querySelector<
          HTMLTextAreaElement | HTMLInputElement | HTMLElement
        >(selector);
        if (!input) {
          return false;
        }

        input.focus();

        if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
          const prototype =
            input instanceof HTMLTextAreaElement
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype;
          const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
          if (descriptor?.set) {
            descriptor.set.call(input, nextMessage);
          } else {
            input.value = nextMessage;
          }
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }

        input.textContent = nextMessage;
        input.dispatchEvent(new InputEvent('input', { bubbles: true, data: nextMessage }));
        return true;
      },
      composerSelector,
      message,
    );

    if (!wroteMessage) {
      throw new AppError('DOM_DRIFT_DETECTED', 'Composer input is missing', 503, {
        composerSelector,
      });
    }

    await this.withConversationAttachmentInterceptor(page, attachments, async () => {
      const sendHandle = await firstHandle(page, ChatGPTSelectors.composer.sendButton);
      if (sendHandle && (await clickSendButton(page, composerSelector, sendHandle))) {
        return;
      }

      await focusComposer(page, composerSelector);
      await page.keyboard.press('Enter');
      if (!(await waitForSubmissionStart(page, composerSelector))) {
        throw new AppError(
          'CHATGPT_NOT_READY',
          'Composer input did not submit the message',
          503,
          {
            composerSelector,
          },
        );
      }
    });
  }

  private async withConversationAttachmentInterceptor<T>(
    page: Page,
    attachments: readonly UploadedConversationAttachment[],
    operation: () => Promise<T>,
  ): Promise<T> {
    if (attachments.length === 0) {
      return operation();
    }

    const cdpSession = await page.createCDPSession();
    const continueInterceptedRequest = async (input: {
      requestId: string;
      postData?: string;
    }): Promise<void> => {
      await waitForPromise(
        cdpSession.send('Fetch.continueRequest', input),
        ATTACHMENT_REQUEST_INTERCEPT_TIMEOUT_MS,
        'Timed out continuing the intercepted ChatGPT conversation request.',
      );
    };
    let requestWasIntercepted = false;
    let interceptorError: Error | null = null;
    let pendingContinuation = Promise.resolve();

    cdpSession.on(
      'Fetch.requestPaused',
      (event: {
        requestId: string;
        request: { method: string; postData?: string | undefined };
      }) => {
        pendingContinuation = pendingContinuation.then(async () => {
          const { requestId, request } = event;
          if (request.method !== 'POST' || request.postData === undefined || requestWasIntercepted) {
            await continueInterceptedRequest({ requestId }).catch((error) => {
              interceptorError =
                error instanceof Error
                  ? error
                  : new Error('Failed to continue a non-conversation ChatGPT request.');
            });
            return;
          }

          try {
            const payload = JSON.parse(request.postData) as {
              messages?: Array<{ metadata?: Record<string, unknown> }>;
            };
            const firstMessage = payload.messages?.[0];
            if (!firstMessage) {
              throw new Error('Conversation payload did not include a first message.');
            }

            const existingMetadata =
              firstMessage.metadata && typeof firstMessage.metadata === 'object'
                ? firstMessage.metadata
                : {};
            const existingAttachments = Array.isArray(existingMetadata.attachments)
              ? existingMetadata.attachments.filter(
                  (attachment): attachment is Record<string, unknown> =>
                    attachment !== null && typeof attachment === 'object',
                )
              : [];
            firstMessage.metadata = {
              ...existingMetadata,
              attachments: [
                ...existingAttachments,
                ...attachments.map((attachment) => ({
                  id: attachment.id,
                  name: attachment.name,
                  size: attachment.size,
                  mime_type: attachment.mimeType,
                  source: attachment.source,
                  library_file_id: attachment.libraryFileId,
                  is_big_paste: attachment.isBigPaste,
                })),
              ],
            };

            await continueInterceptedRequest({
              requestId,
              postData: Buffer.from(JSON.stringify(payload)).toString('base64'),
            });
            requestWasIntercepted = true;
          } catch (error) {
            interceptorError =
              error instanceof Error ? error : new Error('Attachment injection failed.');
            await continueInterceptedRequest({ requestId }).catch(() => undefined);
          }
        });
      },
    );

    await cdpSession.send('Fetch.enable', {
      patterns: [
        {
          urlPattern: '*backend-api/f/conversation*',
          requestStage: 'Request',
        },
      ],
    });

    try {
      const result = await operation();
      const deadline = Date.now() + ATTACHMENT_REQUEST_INTERCEPT_TIMEOUT_MS;
      while (
        Date.now() < deadline &&
        !requestWasIntercepted &&
        interceptorError === null
      ) {
        await sleep(50);
      }

      try {
        await waitForPromise(
          pendingContinuation.catch(() => undefined),
          ATTACHMENT_REQUEST_INTERCEPT_TIMEOUT_MS,
          'Timed out waiting for the intercepted ChatGPT conversation request to continue.',
        );
      } catch (error) {
        interceptorError =
          error instanceof Error ? error : new Error('Attachment injection failed.');
      }

      if (interceptorError) {
        throw new AppError(
          'CHATGPT_ATTACHMENT_INJECTION_FAILED',
          'Failed to attach uploaded files to the ChatGPT conversation request.',
          503,
          {
            message: interceptorError.message,
            attachmentCount: attachments.length,
          },
        );
      }

      if (!requestWasIntercepted) {
        throw new AppError(
          'CHATGPT_ATTACHMENT_INJECTION_FAILED',
          'Timed out waiting to inject uploaded files into the ChatGPT conversation request.',
          503,
          {
            attachmentCount: attachments.length,
          },
        );
      }

      return result;
    } finally {
      await cdpSession.send('Fetch.disable').catch(() => undefined);
      await cdpSession.detach().catch(() => undefined);
    }
  }

  private async readSnapshot(
    page: Page,
    session: SessionSummary,
    conversationId: string,
    projectName: string,
    model: string | undefined,
    inputFiles: readonly string[],
  ): Promise<ConversationSnapshot> {
    const messageSelector = ChatGPTSelectors.response.messages[0];
    const assistantSelector = ChatGPTSelectors.response.assistantMessages[0];
    const markdownSelectors = [...ChatGPTSelectors.response.markdownBlocks];
    if (!messageSelector || !assistantSelector) {
      throw new AppError('DOM_DRIFT_DETECTED', 'Response selectors are not configured', 503);
    }

    const messages = await page.$$eval(
      messageSelector,
      (elements, selectors) => {
        const markdownSelector = selectors.join(', ');
        return elements.map((element, index) => {
          const textElement = element.querySelector(markdownSelector);
          const role =
            element.getAttribute('data-message-author-role') === 'assistant' ? 'assistant' : 'user';

          return {
            id: (element as HTMLElement).id || `message-${index + 1}`,
            role,
            text: (textElement?.textContent ?? element.textContent ?? '').trim(),
          };
        });
      },
      markdownSelectors,
    );

    const assistantMessages = await page.$$eval(
      assistantSelector,
      (elements, selectors) => {
        const markdownSelector = selectors.join(', ');
        return elements.map((element) => {
          const textElement = element.querySelector(markdownSelector);
          return (textElement?.textContent ?? element.textContent ?? '').trim();
        });
      },
      markdownSelectors,
    );

    const statusReading = await this.conversationStatusReader.read(page);
    const now = new Date().toISOString();

    const normalizedMessages: ConversationSnapshot['messages'] = messages.map((message, index) => ({
      id: message.id || randomUUID(),
      role: message.role === 'assistant' ? 'assistant' : 'user',
      text: message.text,
      createdAt: now,
      inputFiles: message.role === 'user' && index === messages.length - 1 ? [...inputFiles] : [],
    }));

    return {
      conversationId: this.resolveConversationId(page.url(), conversationId),
      sessionId: session.sessionId,
      projectName,
      model,
      status: statusReading.status,
      source: 'adapter',
      pageUrl: page.url(),
      messages: normalizedMessages,
      lastAssistantMessage:
        assistantMessages.at(-1) || statusReading.lastAssistantMessage || undefined,
      startedAt: now,
      updatedAt: now,
    };
  }

  private resolveConversationId(url: string, fallbackId: string): string {
    const match = /\/c\/([0-9a-f-]{36})/.exec(url);
    return match?.[1] ?? fallbackId;
  }
}
