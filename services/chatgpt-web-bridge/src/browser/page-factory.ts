import { TargetType, type Browser, type Page, type Target } from 'puppeteer-core';

import { ChatGPTSelectors } from '../dom/selectors';
import { AppError } from '../types/error';

const DEFAULT_STARTUP_URL = 'https://chatgpt.com/';
const DEFAULT_ATTACH_WAIT_MS = 15_000;
const ATTACH_POLL_MS = 150;
const TARGET_MATERIALIZATION_TIMEOUT_MS = 5_000;

export type PageBindingMode = 'attach' | 'launch';

export type BoundChatGPTPage = {
  page: Page;
  ownsPage: boolean;
};

function isChatGPTPage(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'chatgpt.com' || parsed.hostname.endsWith('.chatgpt.com');
  } catch {
    return false;
  }
}

function matchesStartupUrl(pageUrl: string, startupUrl: string): boolean {
  try {
    const current = new URL(pageUrl);
    const target = new URL(startupUrl);
    if (current.origin !== target.origin) {
      return false;
    }

    return current.pathname === target.pathname;
  } catch {
    return false;
  }
}

export class PageFactory {
  private readonly attachResumeSessions = new WeakMap<
    Page,
    Awaited<ReturnType<Target['createCDPSession']>>
  >();

  public async bindChatGPTPage(
    browser: Browser,
    input?: {
      startupUrl?: string;
      mode?: PageBindingMode;
    },
  ): Promise<BoundChatGPTPage> {
    const startupUrl = input?.startupUrl;
    const mode = input?.mode ?? 'launch';
    const existingPage = await this.findExistingChatGPTPage(browser, startupUrl, mode);
    if (existingPage) {
      await existingPage.bringToFront();
      return {
        page: existingPage,
        ownsPage: false,
      };
    }

    if (mode === 'attach') {
      throw new AppError(
        'CHATGPT_NOT_READY',
        'No attachable ChatGPT page could be materialized from the existing browser session.',
        503,
        {
          startupUrl: startupUrl ?? DEFAULT_STARTUP_URL,
        },
      );
    }

    const page = await browser.newPage();
    await this.gotoStartupUrl(page, startupUrl);
    await page.bringToFront();

    return {
      page,
      ownsPage: true,
    };
  }

  public async createFreshChatGPTPage(browser: Browser, startupUrl?: string): Promise<Page> {
    const page = await browser.newPage();
    await this.gotoStartupUrl(page, startupUrl);
    await page.bringToFront();
    return page;
  }

  public async resetChatGPTPage(page: Page, startupUrl?: string): Promise<Page> {
    await this.gotoStartupUrl(page, startupUrl);
    await page.bringToFront();
    return page;
  }

  private async waitForAttachReady(page: Page): Promise<void> {
    const deadline = Date.now() + DEFAULT_ATTACH_WAIT_MS;
    while (Date.now() <= deadline) {
      for (const selector of ChatGPTSelectors.composer.input) {
        if ((await page.$(selector)) !== null) {
          return;
        }
      }

      for (const selector of ChatGPTSelectors.auth.loggedOutMarkers) {
        if ((await page.$(selector)) !== null) {
          return;
        }
      }

      await new Promise((resolve) => {
        setTimeout(resolve, ATTACH_POLL_MS);
      });
    }
  }

  private async gotoStartupUrl(page: Page, startupUrl?: string): Promise<void> {
    await page.goto(startupUrl ?? DEFAULT_STARTUP_URL, { waitUntil: 'domcontentloaded' });
    await this.waitForAttachReady(page);
  }

  private async findExistingChatGPTPage(
    browser: Browser,
    startupUrl?: string,
    mode: PageBindingMode = 'launch',
  ): Promise<Page | null> {
    const candidates = browser
      .targets()
      .map((target) => ({
        target,
        score: this.scoreTarget(target, startupUrl),
      }))
      .filter((entry): entry is { target: Target; score: number } => entry.score !== null)
      .sort((left, right) => right.score - left.score);

    for (const candidate of candidates) {
      const page = await this.materializeTargetPage(candidate.target);
      if (!page) {
        continue;
      }

      const matchedExistingPage = await this.scorePage(page, startupUrl);
      if (matchedExistingPage !== null) {
        return page;
      }

      if (mode === 'attach') {
        const matchedAfterWait = await this.scorePageAfterReadyWait(page, startupUrl);
        if (matchedAfterWait !== null) {
          return page;
        }

        const recoveredPage = await this.recoverPageToStartupUrl(page, startupUrl);
        if (recoveredPage) {
          return recoveredPage;
        }
      }

      await this.releaseAttachResumeSession(page);
    }

    return null;
  }

  private async scorePageAfterReadyWait(page: Page, startupUrl?: string): Promise<number | null> {
    await this.waitForAttachReady(page);
    return this.scorePage(page, startupUrl);
  }

  private async recoverPageToStartupUrl(page: Page, startupUrl?: string): Promise<Page | null> {
    try {
      await this.gotoStartupUrl(page, startupUrl);
      return (await this.scorePage(page, startupUrl)) !== null ? page : null;
    } catch {
      return null;
    }
  }

  private scoreTarget(target: Target, startupUrl?: string): number | null {
    const targetType = target.type();
    if (targetType !== TargetType.PAGE && targetType !== TargetType.WEBVIEW) {
      return null;
    }

    const targetUrl = target.url();
    if (targetUrl.length === 0 || targetUrl === 'about:blank') {
      return startupUrl ? 1 : null;
    }

    if (!isChatGPTPage(targetUrl) || targetUrl.includes('/auth/login')) {
      return null;
    }

    let score = 100;
    if (targetUrl.includes('/c/')) {
      score += 20;
    }
    if (startupUrl && matchesStartupUrl(targetUrl, startupUrl)) {
      score += 10;
    }

    return score;
  }

  private async materializeTargetPage(target: Target): Promise<Page | null> {
    let resumeSession: Awaited<ReturnType<Target['createCDPSession']>> | null = null;
    try {
      resumeSession = await withTimeout(target.createCDPSession(), TARGET_MATERIALIZATION_TIMEOUT_MS);
      await withTimeout(
        resumeSession.send('Runtime.runIfWaitingForDebugger'),
        TARGET_MATERIALIZATION_TIMEOUT_MS,
      );

      const page = await withTimeout(target.page(), TARGET_MATERIALIZATION_TIMEOUT_MS);
      if (!page) {
        return null;
      }

      this.attachResumeSessions.set(page, resumeSession);
      return page;
    } catch {
      try {
        await resumeSession?.detach();
      } catch {
        // Ignore detach failures from transient attach sessions used only for resuming.
      }

      return null;
    }
  }

  private async releaseAttachResumeSession(page: Page): Promise<void> {
    const session = this.attachResumeSessions.get(page);
    if (!session) {
      return;
    }

    this.attachResumeSessions.delete(page);

    try {
      await session.detach();
    } catch {
      // Ignore detach failures for candidate pages that were not selected.
    }
  }

  private async scorePage(page: Page, startupUrl?: string): Promise<number | null> {
    const pageUrl = page.url();
    if (!isChatGPTPage(pageUrl) || pageUrl.includes('/auth/login')) {
      return null;
    }

    for (const selector of ChatGPTSelectors.auth.loggedOutMarkers) {
      if ((await page.$(selector)) !== null) {
        return null;
      }
    }

    let hasComposer = false;
    for (const selector of ChatGPTSelectors.composer.input) {
      if ((await page.$(selector)) !== null) {
        hasComposer = true;
        break;
      }
    }

    if (!hasComposer) {
      return null;
    }

    let score = 101;
    if (pageUrl.includes('/c/')) {
      score += 20;
    }

    if (startupUrl && matchesStartupUrl(pageUrl, startupUrl)) {
      score += 10;
    }

    return score > 1 ? score : null;
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }),
  ]);
}
