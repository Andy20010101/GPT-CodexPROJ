import type { ElementHandle, Page } from 'puppeteer-core';

import type { SessionSummary } from '@review-then-codex/shared-contracts/chatgpt';

import { ChatGPTSelectors } from '../dom/selectors';
import { AppError } from '../types/error';

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

function urlsShareOriginAndPath(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) {
    return false;
  }

  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    return leftUrl.origin === rightUrl.origin && leftUrl.pathname === rightUrl.pathname;
  } catch {
    return false;
  }
}

function tokenizeModelLabel(model: string): string[] {
  return model
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

function modelMatchesTarget(currentModel: string | undefined, targetModel: string): boolean {
  if (!currentModel) {
    return false;
  }

  const currentTokens = new Set(tokenizeModelLabel(currentModel));
  const targetTokens = tokenizeModelLabel(targetModel);
  if (targetTokens.length === 0) {
    return false;
  }

  return targetTokens.every((token) => currentTokens.has(token));
}

async function sleep(durationMs: number): Promise<void> {
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

export class ChatSessionController {
  public async selectProject(input: {
    page: Page;
    session: SessionSummary;
    projectName: string;
    model?: string | undefined;
  }): Promise<SessionSummary> {
    const resolvedProjectName = normalizeProjectName(input.projectName);
    if (resolvedProjectName === CURRENT_SESSION_PROJECT) {
      const selectedModel = await this.ensureRequestedModel(input.page, input.session, input.model);
      return {
        ...input.session,
        pageUrl: input.page.url(),
        projectName: resolvedProjectName,
        model: selectedModel,
      };
    }

    if (this.isRequestedProjectAlreadySelected(input.session, resolvedProjectName, input.page.url())) {
      const selectedModel = await this.ensureRequestedModel(input.page, input.session, input.model);
      return {
        ...input.session,
        pageUrl: input.page.url(),
        projectName: resolvedProjectName,
        model: selectedModel,
      };
    }

    const didSelectProject = await input.page.evaluate(
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

    await input.page
      .waitForNetworkIdle({ idleTime: 300, timeout: DEFAULT_TIMEOUT_MS })
      .catch(() => undefined);

    const selectedModel = await this.ensureRequestedModel(input.page, input.session, input.model);

    return {
      ...input.session,
      pageUrl: input.page.url(),
      projectName: resolvedProjectName,
      model: selectedModel,
    };
  }

  private isRequestedProjectAlreadySelected(
    session: SessionSummary,
    resolvedProjectName: string,
    currentPageUrl: string | undefined,
  ): boolean {
    if (!session.projectName) {
      return false;
    }

    if (normalizeProjectName(session.projectName) !== resolvedProjectName) {
      return false;
    }

    return urlsShareOriginAndPath(currentPageUrl, session.pageUrl);
  }

  public async ensureRequestedModel(
    page: Page,
    session: SessionSummary,
    requestedModel: string | undefined,
  ): Promise<string | undefined> {
    if (!requestedModel) {
      return session.model;
    }

    const currentModel =
      (await this.detectCurrentModel(page).catch(() => null)) ?? session.model ?? undefined;
    if (modelMatchesTarget(currentModel, requestedModel)) {
      return requestedModel;
    }

    await this.switchModel(page, requestedModel);
    return requestedModel;
  }

  public async detectCurrentModel(page: Page): Promise<string | null> {
    return page.evaluate((selectors) => {
      for (const selector of selectors) {
        const trigger = document.querySelector<HTMLElement>(selector);
        if (!trigger) {
          continue;
        }

        const candidates = [
          trigger.textContent,
          trigger.innerText,
          trigger.getAttribute('aria-label'),
          trigger.getAttribute('title'),
        ];
        const label = candidates.find(
          (candidate) => typeof candidate === 'string' && candidate.trim().length > 0,
        );
        if (label) {
          return label.trim();
        }
      }

      return null;
    }, [...ChatGPTSelectors.model.trigger]);
  }

  public async switchModel(page: Page, model: string): Promise<void> {
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
}
