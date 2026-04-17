import type { Browser, Page } from 'puppeteer-core';

import type { PageFactory } from './page-factory';

export type SessionPageBootstrap = {
  attachPage: Page;
  sessionPage: Page;
  attachOwnsPage: boolean;
};

export class SessionPageBootstrapper {
  public constructor(private readonly pageFactory: PageFactory) {}

  public async bootstrap(browser: Browser, startupUrl?: string): Promise<SessionPageBootstrap> {
    const binding = await this.pageFactory.bindChatGPTPage(browser, {
      ...(startupUrl ? { startupUrl } : {}),
      mode: 'attach',
    });

    if (binding.ownsPage) {
      return {
        attachPage: binding.page,
        sessionPage: binding.page,
        attachOwnsPage: true,
      };
    }

    const sessionPage = await this.pageFactory.createFreshChatGPTPage(browser, startupUrl);
    return {
      attachPage: binding.page,
      sessionPage,
      attachOwnsPage: false,
    };
  }
}
