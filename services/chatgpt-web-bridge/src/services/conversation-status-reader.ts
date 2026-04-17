import type { Page } from 'puppeteer-core';

import { ChatGPTSelectors } from '../dom/selectors';
import { AppError } from '../types/error';

export type ConversationStatusReading = {
  status: 'running' | 'completed' | 'failed';
  assistantMessageCount: number;
  lastMessageRole: 'assistant' | 'user' | 'none';
  lastAssistantMessage?: string | undefined;
  retryVisible?: boolean | undefined;
  stabilitySignature: string;
};

export class ConversationStatusReader {
  public async read(page: Page): Promise<ConversationStatusReading> {
    const messageSelector = ChatGPTSelectors.response.messages[0];
    const assistantSelector = ChatGPTSelectors.response.assistantMessages[0];
    const markdownSelectors = [...ChatGPTSelectors.response.markdownBlocks];
    const stopButtonSelectors = [...ChatGPTSelectors.composer.stopButton];
    const retryButtonSelectors = [...ChatGPTSelectors.composer.retryButton];
    if (!messageSelector || !assistantSelector) {
      throw new AppError('DOM_DRIFT_DETECTED', 'Response selectors are not configured', 503);
    }

    const status: Omit<ConversationStatusReading, 'stabilitySignature'> = await page.evaluate(
      (
        {
          messageSelector,
          assistantSelector,
          markdownSelectors,
          stopButtonSelectors,
          retryButtonSelectors,
        }: {
          messageSelector: string;
          assistantSelector: string;
          markdownSelectors: string[];
          stopButtonSelectors: string[];
          retryButtonSelectors: string[];
        },
      ) => {
        const markdownSelector = markdownSelectors.join(', ');
        const messages = Array.from(document.querySelectorAll<HTMLElement>(messageSelector));
        const assistantMessages = Array.from(document.querySelectorAll<HTMLElement>(assistantSelector)).map(
          (element) => {
            const textElement = element.querySelector(markdownSelector);
            return (textElement?.textContent ?? element.textContent ?? '').trim();
          },
        );
        const lastMessageRole = (() => {
          const lastMessage = messages.at(-1);
          if (!lastMessage) {
            return 'none';
          }
          return lastMessage.getAttribute('data-message-author-role') === 'assistant'
            ? 'assistant'
            : 'user';
        })();
        const retryVisible = retryButtonSelectors.some((selector: string) => {
          const element = document.querySelector<HTMLElement>(selector);
          if (!element) {
            return false;
          }

          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            rect.width > 0 &&
            rect.height > 0
          );
        });

        const running = stopButtonSelectors.some((selector: string) => {
          const element = document.querySelector<HTMLElement>(selector);
          if (!element) {
            return false;
          }

          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            rect.width > 0 &&
            rect.height > 0
          );
        });
        const terminalRetry =
          retryVisible &&
          assistantMessages.length > 0 &&
          lastMessageRole === 'assistant';
        const status: ConversationStatusReading['status'] =
          running && !terminalRetry ? 'running' : 'completed';
        const normalizedLastMessageRole: ConversationStatusReading['lastMessageRole'] =
          lastMessageRole;

        return {
          status,
          assistantMessageCount: assistantMessages.length,
          lastMessageRole: normalizedLastMessageRole,
          lastAssistantMessage: assistantMessages.at(-1) || undefined,
          retryVisible,
        };
      },
      {
        messageSelector,
        assistantSelector,
        markdownSelectors,
        stopButtonSelectors,
        retryButtonSelectors,
      },
    );

    return {
      ...status,
      stabilitySignature: JSON.stringify({
        status: status.status,
        assistantMessageCount: status.assistantMessageCount,
        lastAssistantMessage: status.lastAssistantMessage ?? '',
        lastMessageRole: status.lastMessageRole,
        retryVisible: status.retryVisible,
      }),
    };
  }
}
