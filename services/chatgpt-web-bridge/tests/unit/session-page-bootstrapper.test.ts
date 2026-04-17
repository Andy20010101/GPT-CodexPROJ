import { describe, expect, it, vi } from 'vitest';

import { SessionPageBootstrapper } from '../../src/browser/session-page-bootstrapper';

describe('SessionPageBootstrapper', () => {
  it('reuses the attached page when the bound page is already bridge-owned', async () => {
    const attachedPage = { url: () => 'https://chatgpt.com/' };
    const pageFactory = {
      bindChatGPTPage: vi.fn(async () => ({
        page: attachedPage,
        ownsPage: true,
      })),
      createFreshChatGPTPage: vi.fn(async () => {
        throw new Error('should not allocate a new session page');
      }),
    };

    const result = await new SessionPageBootstrapper(pageFactory as never).bootstrap(
      {} as never,
      'https://chatgpt.com/',
    );

    expect(result).toEqual({
      attachPage: attachedPage,
      sessionPage: attachedPage,
      attachOwnsPage: true,
    });
  });

  it('allocates a dedicated session page when attach binds an existing page', async () => {
    const attachedPage = { url: () => 'https://chatgpt.com/c/existing' };
    const sessionPage = { url: () => 'https://chatgpt.com/' };
    const browser = {};
    const pageFactory = {
      bindChatGPTPage: vi.fn(async () => ({
        page: attachedPage,
        ownsPage: false,
      })),
      createFreshChatGPTPage: vi.fn(async () => sessionPage),
    };

    const result = await new SessionPageBootstrapper(pageFactory as never).bootstrap(
      browser as never,
      'https://chatgpt.com/',
    );

    expect(pageFactory.bindChatGPTPage).toHaveBeenCalledWith(browser, {
      startupUrl: 'https://chatgpt.com/',
      mode: 'attach',
    });
    expect(pageFactory.createFreshChatGPTPage).toHaveBeenCalledWith(browser, 'https://chatgpt.com/');
    expect(result).toEqual({
      attachPage: attachedPage,
      sessionPage,
      attachOwnsPage: false,
    });
  });
});
