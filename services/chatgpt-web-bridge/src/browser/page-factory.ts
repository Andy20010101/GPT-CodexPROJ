import type { Browser, Page } from 'puppeteer-core';

export class PageFactory {
  public async bindChatGPTPage(browser: Browser, startupUrl?: string): Promise<Page> {
    const pages = await browser.pages();
    const existingPage = pages.find((page) => page.url().includes('chatgpt.com'));
    if (existingPage) {
      return existingPage;
    }

    const page = await browser.newPage();
    if (startupUrl) {
      await page.goto(startupUrl, { waitUntil: 'domcontentloaded' });
    } else {
      await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded' });
    }

    return page;
  }
}
