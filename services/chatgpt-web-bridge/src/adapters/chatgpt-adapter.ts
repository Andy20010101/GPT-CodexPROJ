import { randomUUID } from 'node:crypto';

import type { ElementHandle, Page } from 'puppeteer-core';

import type {
  ConversationSnapshot,
  SessionSummary,
} from '@review-then-codex/shared-contracts/chatgpt';

import { BrowserManager } from '../browser/browser-manager';
import { ChatGPTSelectors } from '../dom/selectors';
import { PreflightGuard } from '../guards/preflight-guard';
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
const CURRENT_SESSION_PROJECT = 'current-session';

function getCurrentSessionProjectAliases(): Set<string> {
  const configuredAliases = process.env.BRIDGE_CURRENT_SESSION_PROJECT_ALIASES;
  const rawAliases =
    configuredAliases && configuredAliases.trim().length > 0
      ? configuredAliases.split(',')
      : [CURRENT_SESSION_PROJECT, 'default'];

  return new Set(
    rawAliases
      .map((alias) => alias.trim().toLowerCase())
      .filter((alias) => alias.length > 0),
  );
}

function normalizeProjectName(projectName: string): string {
  return getCurrentSessionProjectAliases().has(projectName.trim().toLowerCase())
    ? CURRENT_SESSION_PROJECT
    : projectName;
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
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

export class PuppeteerChatGPTAdapter implements ChatGPTAdapter {
  public constructor(
    private readonly browserManager: BrowserManager,
    private readonly preflightGuard = new PreflightGuard(),
  ) {}

  public async openSession(input: AdapterSessionOpenInput): Promise<SessionSummary> {
    const { pageUrl, browserUrl } = await this.browserManager.openSession(input);
    const page = this.browserManager.getPage(input.sessionId);
    await this.preflightGuard.ensureReady(page);

    return {
      sessionId: input.sessionId,
      browserUrl,
      pageUrl,
      connectedAt: new Date().toISOString(),
    };
  }

  public async selectProject(input: AdapterSelectProjectInput): Promise<SessionSummary> {
    const page = this.browserManager.getPage(input.session.sessionId);
    await this.preflightGuard.ensureReady(page);

    const resolvedProjectName = normalizeProjectName(input.projectName);
    if (resolvedProjectName === CURRENT_SESSION_PROJECT) {
      if (input.model) {
        await this.switchModel(page, input.model);
      }

      return {
        ...input.session,
        pageUrl: page.url(),
        projectName: resolvedProjectName,
        model: input.model ?? input.session.model,
      };
    }

    const didSelectProject = await page.evaluate(
      (projectName, selectors) => {
        const expected = projectName.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
        for (const selector of selectors) {
          const candidates = Array.from(document.querySelectorAll<HTMLAnchorElement>(selector));
          const match = candidates.find((candidate) => {
            const text = (candidate.textContent ?? '')
              .toLowerCase()
              .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
            return text.includes(expected);
          });
          if (match) {
            match.click();
            return true;
          }
        }
        return false;
      },
      resolvedProjectName,
      [...ChatGPTSelectors.navigation.sidebarProjectLinks],
    );

    if (!didSelectProject) {
      throw new AppError('PROJECT_NOT_FOUND', 'ChatGPT project was not found in the sidebar', 404, {
        projectName: resolvedProjectName,
      });
    }

    await page.waitForNetworkIdle({ idleTime: 300, timeout: DEFAULT_TIMEOUT_MS }).catch(() => {
      return undefined;
    });

    if (input.model) {
      await this.switchModel(page, input.model);
    }

    return {
      ...input.session,
      pageUrl: page.url(),
      projectName: resolvedProjectName,
      model: input.model ?? input.session.model,
    };
  }

  public async startConversation(
    input: AdapterStartConversationInput,
  ): Promise<ConversationSnapshot> {
    let session = input.session;
    if (session.projectName !== input.projectName || session.model !== input.model) {
      session = await this.selectProject({
        session,
        projectName: input.projectName,
        ...(input.model ? { model: input.model } : {}),
      });
    }

    const page = this.browserManager.getPage(session.sessionId);
    await this.attachFiles(page, input.inputFiles);
    await this.sendText(page, input.prompt);

    return this.readSnapshot(
      page,
      session,
      input.conversationId,
      input.projectName,
      input.model ?? session.model,
      input.inputFiles,
    );
  }

  public async sendMessage(input: AdapterMessageInput): Promise<ConversationSnapshot> {
    const page = this.browserManager.getPage(input.session.sessionId);
    await this.preflightGuard.ensureReady(page);
    await this.attachFiles(page, input.inputFiles);
    await this.sendText(page, input.message);

    return this.readSnapshot(
      page,
      input.session,
      input.conversationId,
      input.session.projectName ?? 'unknown-project',
      input.session.model,
      input.inputFiles,
    );
  }

  public async waitForConversation(input: AdapterWaitInput): Promise<ConversationSnapshot> {
    const page = this.browserManager.getPage(input.session.sessionId);
    const deadline = Date.now() + (input.maxWaitMs ?? 120_000);
    const interval = input.pollIntervalMs ?? 1_000;
    const stablePolls = input.stablePolls ?? 2;

    let lastAssistantMessage = '';
    let stableReads = 0;

    while (Date.now() <= deadline) {
      const snapshot = await this.readSnapshot(
        page,
        input.session,
        input.conversationId,
        input.session.projectName ?? 'unknown-project',
        input.session.model,
        [],
      );

      if (snapshot.status === 'completed') {
        if (snapshot.lastAssistantMessage === lastAssistantMessage) {
          stableReads += 1;
        } else {
          lastAssistantMessage = snapshot.lastAssistantMessage ?? '';
          stableReads = 1;
        }

        if (stableReads >= stablePolls) {
          return snapshot;
        }
      }

      await sleep(interval);
    }

    throw new AppError('CHATGPT_NOT_READY', 'Conversation did not complete before timeout', 504, {
      conversationId: input.conversationId,
    });
  }

  public async getConversationSnapshot(input: AdapterSnapshotInput): Promise<ConversationSnapshot> {
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

  private async switchModel(page: Page, model: string): Promise<void> {
    const trigger = await firstHandle(page, ChatGPTSelectors.model.trigger);
    if (!trigger) {
      throw new AppError('DOM_DRIFT_DETECTED', 'Model switcher trigger not found', 503, {
        model,
      });
    }

    await trigger.click();
    const optionsSelector = await waitForAnySelector(page, ChatGPTSelectors.model.options);
    const didSelectModel = await page.evaluate(
      (selector, modelName) => {
        const expected = modelName.toLowerCase();
        const options = Array.from(document.querySelectorAll<HTMLElement>(selector));
        const match = options.find((option) =>
          (option.textContent ?? '').toLowerCase().includes(expected),
        );
        if (!match) {
          return false;
        }
        match.click();
        return true;
      },
      optionsSelector,
      model,
    );

    if (!didSelectModel) {
      throw new AppError(
        'CHATGPT_NOT_READY',
        'Requested model is not available in the picker',
        404,
        {
          model,
        },
      );
    }
  }

  private async attachFiles(page: Page, files: readonly string[]): Promise<void> {
    if (files.length === 0) {
      return;
    }

    const fileInput = (await firstHandle(
      page,
      ChatGPTSelectors.composer.fileInput,
    )) as ElementHandle<HTMLInputElement> | null;
    if (!fileInput) {
      throw new AppError('DOM_DRIFT_DETECTED', 'ChatGPT file input was not found', 503, {
        files,
      });
    }

    await fileInput.uploadFile(...files);
  }

  private async sendText(page: Page, message: string): Promise<void> {
    await this.preflightGuard.ensureReady(page);
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
          const prototype = Object.getPrototypeOf(input);
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

    const sendHandle = await firstHandle(page, ChatGPTSelectors.composer.sendButton);
    if (sendHandle) {
      const box = await sendHandle.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      }
      await sleep(400);
      const clearedAfterClick = await page.evaluate((selector) => {
        const input = document.querySelector<HTMLTextAreaElement>(selector);
        if (!input) {
          return true;
        }
        const value = input.value ?? input.textContent ?? '';
        return value.trim().length === 0;
      }, composerSelector);
      if (clearedAfterClick) {
        return;
      }
    }

    await page.keyboard.press('Enter');
    await sleep(400);

    const clearedAfterEnter = await page.evaluate((selector) => {
      const input = document.querySelector<HTMLTextAreaElement>(selector);
      if (!input) {
        return true;
      }
      const value = input.value ?? input.textContent ?? '';
      return value.trim().length === 0;
    }, composerSelector);

    if (!clearedAfterEnter) {
      throw new AppError('CHATGPT_NOT_READY', 'Composer input did not submit the message', 503, {
        composerSelector,
      });
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

    const running = await exists(page, ChatGPTSelectors.composer.stopButton);
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
      status: running ? 'running' : 'completed',
      source: 'adapter',
      pageUrl: page.url(),
      messages: normalizedMessages,
      lastAssistantMessage: assistantMessages.at(-1) || undefined,
      startedAt: now,
      updatedAt: now,
    };
  }

  private resolveConversationId(url: string, fallbackId: string): string {
    const match = /\/c\/([0-9a-f-]{36})/.exec(url);
    return match?.[1] ?? fallbackId;
  }
}
