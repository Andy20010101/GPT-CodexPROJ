import puppeteer, { type Browser, type Page } from 'puppeteer-core';

import { AppError } from '../types/error';

import { PageFactory } from './page-factory';

type ManagedSession = {
  readonly browser: Browser;
  readonly page: Page;
  readonly ownsPage: boolean;
  readonly browserUrl: string;
  readonly startupUrl?: string | undefined;
};

export class BrowserManager {
  private readonly sessions = new Map<string, ManagedSession>();

  public constructor(private readonly pageFactory: PageFactory) {}

  public async openSession(input: {
    sessionId: string;
    browserEndpoint: string;
    startupUrl?: string | undefined;
  }): Promise<{ pageUrl: string; browserUrl: string }> {
    const browser = await puppeteer.connect({ browserURL: input.browserEndpoint });
    const knownPages = new Set(await browser.pages());
    const page = await this.pageFactory.bindChatGPTPage(browser, input.startupUrl);
    this.sessions.set(input.sessionId, {
      browser,
      page,
      ownsPage: !knownPages.has(page),
      browserUrl: input.browserEndpoint,
      startupUrl: input.startupUrl,
    });

    return { pageUrl: page.url(), browserUrl: input.browserEndpoint };
  }

  public getPage(sessionId: string): Page {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new AppError('SESSION_NOT_FOUND', 'Browser session not found', 404, { sessionId });
    }

    return session.page;
  }

  public async prepareFreshConversationPage(sessionId: string): Promise<Page> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new AppError('SESSION_NOT_FOUND', 'Browser session not found', 404, { sessionId });
    }

    const page = await this.pageFactory.createFreshChatGPTPage(session.browser, session.startupUrl);
    const previousPage = session.page;
    const shouldClosePreviousPage = session.ownsPage && previousPage !== page;
    this.sessions.set(sessionId, {
      ...session,
      page,
      ownsPage: true,
    });

    if (shouldClosePreviousPage) {
      await this.closePage(previousPage);
    }

    return page;
  }

  private async closePage(page: Page): Promise<void> {
    try {
      if (typeof page.isClosed === 'function' && page.isClosed()) {
        return;
      }
      await page.close();
    } catch {
      return;
    }
  }
}
