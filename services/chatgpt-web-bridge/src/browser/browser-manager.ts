import puppeteer, { type Browser, type Page } from 'puppeteer-core';

import { AppError } from '../types/error';

import { PageFactory } from './page-factory';

type ManagedSession = {
  readonly browser: Browser;
  readonly page: Page;
  readonly browserUrl: string;
  readonly startupUrl?: string | undefined;
};

export class BrowserManager {
  private readonly sessions = new Map<string, ManagedSession>();

  public constructor(private readonly pageFactory: PageFactory) {}

  public async openSession(input: {
    sessionId: string;
    browserUrl: string;
    startupUrl?: string | undefined;
  }): Promise<{ pageUrl: string }> {
    const browser = await puppeteer.connect({ browserURL: input.browserUrl });
    const page = await this.pageFactory.bindChatGPTPage(browser, input.startupUrl);
    this.sessions.set(input.sessionId, {
      browser,
      page,
      browserUrl: input.browserUrl,
      startupUrl: input.startupUrl,
    });

    return { pageUrl: page.url() };
  }

  public getPage(sessionId: string): Page {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new AppError('SESSION_NOT_FOUND', 'Browser session not found', 404, { sessionId });
    }

    return session.page;
  }
}
