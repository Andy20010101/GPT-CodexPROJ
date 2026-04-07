import type { Browser, Page } from 'puppeteer-core';

import { ChatGPTSelectors } from '../dom/selectors';

const DEFAULT_STARTUP_URL = 'https://chatgpt.com/';
const DEFAULT_ATTACH_WAIT_MS = 15_000;
const ATTACH_POLL_MS = 150;

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
  public async bindChatGPTPage(browser: Browser, startupUrl?: string): Promise<Page> {
    const pages = await browser.pages();
    const rankedPages = await Promise.all(
      [...pages].reverse().map(async (page) => ({
        page,
        score: await this.scorePage(page, startupUrl),
      })),
    );
    const existingPage = rankedPages
      .filter((entry): entry is { page: Page; score: number } => entry.score !== null)
      .sort((left, right) => right.score - left.score)
      .at(0);

    if (existingPage) {
      await existingPage.page.bringToFront();
      return existingPage.page;
    }

    const page = await browser.newPage();
    await page.goto(startupUrl ?? DEFAULT_STARTUP_URL, { waitUntil: 'domcontentloaded' });
    await this.waitForAttachReady(page);
    await page.bringToFront();

    return page;
  }

  public async createFreshChatGPTPage(browser: Browser, startupUrl?: string): Promise<Page> {
    const page = await browser.newPage();
    await page.goto(startupUrl ?? DEFAULT_STARTUP_URL, { waitUntil: 'domcontentloaded' });
    await this.waitForAttachReady(page);
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
