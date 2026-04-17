import puppeteer, { type Browser, type Page } from 'puppeteer-core';

import { AppError } from '../types/error';

import { PageFactory } from './page-factory';
import { SessionPageBootstrapper } from './session-page-bootstrapper';

const DEVTOOLS_PROTOCOL_TIMEOUT_MS = 600_000;

type ManagedSession = {
  readonly browser: Browser;
  readonly sessionPage: Page;
  readonly browserUrl: string;
  readonly startupUrl?: string | undefined;
};

export class BrowserManager {
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly sessionPageBootstrapper: SessionPageBootstrapper;

  public constructor(private readonly pageFactory: PageFactory) {
    this.sessionPageBootstrapper = new SessionPageBootstrapper(pageFactory);
  }

  public async openSession(input: {
    sessionId: string;
    browserEndpoint: string;
    startupUrl?: string | undefined;
  }): Promise<{ pageUrl: string; browserUrl: string }> {
    const browser = await puppeteer.connect({
      browserURL: input.browserEndpoint,
      protocolTimeout: DEVTOOLS_PROTOCOL_TIMEOUT_MS,
    });
    const bootstrap = await this.sessionPageBootstrapper.bootstrap(browser, input.startupUrl);
    const page = bootstrap.sessionPage;
    this.sessions.set(input.sessionId, {
      browser,
      sessionPage: page,
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

    return session.sessionPage;
  }

  public async rebindSessionPage(sessionId: string): Promise<Page> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new AppError('SESSION_NOT_FOUND', 'Browser session not found', 404, { sessionId });
    }

    const rebound = await this.pageFactory.bindChatGPTPage(session.browser, {
      ...(session.startupUrl !== undefined ? { startupUrl: session.startupUrl } : {}),
      mode: 'attach',
    });
    this.sessions.set(sessionId, {
      ...session,
      sessionPage: rebound.page,
    });
    return rebound.page;
  }

  public async prepareFreshConversationPage(sessionId: string): Promise<Page> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new AppError('SESSION_NOT_FOUND', 'Browser session not found', 404, { sessionId });
    }

    const page = await this.pageFactory.createFreshChatGPTPage(session.browser, session.startupUrl);
    const previousPage = session.sessionPage;
    const shouldClosePreviousPage = previousPage !== page;
    this.sessions.set(sessionId, {
      ...session,
      sessionPage: page,
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
