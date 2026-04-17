import { describe, expect, it, vi } from 'vitest';

import { BrowserManager } from '../../src/browser/browser-manager';

const { connect } = vi.hoisted(() => ({
  connect: vi.fn(),
}));

vi.mock('puppeteer-core', () => ({
  default: {
    connect,
  },
}));

describe('BrowserManager', () => {
  it('allocates a dedicated page when the attached session does not own the page', async () => {
    const existingPage = {
      url: () => 'https://chatgpt.com/c/existing',
      close: vi.fn(async () => undefined),
      isClosed: vi.fn(() => false),
    };
    const dedicatedPage = {
      url: () => 'https://chatgpt.com/',
      close: vi.fn(async () => undefined),
      isClosed: vi.fn(() => false),
    };
    const freshPage = {
      url: () => 'https://chatgpt.com/',
      close: vi.fn(async () => undefined),
      isClosed: vi.fn(() => false),
    };
    const browser = {};
    connect.mockResolvedValue(browser);

    const pageFactory = {
      bindChatGPTPage: vi.fn(async () => ({
        page: existingPage,
        ownsPage: false,
      })),
      resetChatGPTPage: vi.fn(async () => {
        throw new Error('should not reset bridge-owned dedicated pages');
      }),
      createFreshChatGPTPage: vi
        .fn()
        .mockResolvedValueOnce(dedicatedPage)
        .mockResolvedValueOnce(freshPage),
    };

    const manager = new BrowserManager(pageFactory as never);
    await manager.openSession({
      sessionId: 'session-1',
      browserEndpoint: 'http://127.0.0.1:9667',
      startupUrl: 'https://chatgpt.com/',
    });

    expect(connect).toHaveBeenCalledWith({
      browserURL: 'http://127.0.0.1:9667',
      protocolTimeout: 600_000,
    });

    expect(manager.getPage('session-1')).toBe(dedicatedPage);

    const rebound = await manager.prepareFreshConversationPage('session-1');

    expect(rebound).toBe(freshPage);
    expect(pageFactory.bindChatGPTPage).toHaveBeenCalledWith(browser, {
      startupUrl: 'https://chatgpt.com/',
      mode: 'attach',
    });
    expect(pageFactory.createFreshChatGPTPage).toHaveBeenNthCalledWith(
      1,
      browser,
      'https://chatgpt.com/',
    );
    expect(pageFactory.createFreshChatGPTPage).toHaveBeenNthCalledWith(
      2,
      browser,
      'https://chatgpt.com/',
    );
    expect(pageFactory.resetChatGPTPage).not.toHaveBeenCalled();
    expect(manager.getPage('session-1')).toBe(freshPage);
    expect(dedicatedPage.close).toHaveBeenCalledTimes(1);
    expect(existingPage.close).not.toHaveBeenCalled();
  });

  it('closes the previously bridge-owned page when rebinding to a fresh page', async () => {
    const bridgeOwnedPage = {
      url: () => 'https://chatgpt.com/',
      close: vi.fn(async () => undefined),
      isClosed: vi.fn(() => false),
    };
    const freshPage = {
      url: () => 'https://chatgpt.com/',
      close: vi.fn(async () => undefined),
      isClosed: vi.fn(() => false),
    };
    const browser = {
    };
    connect.mockResolvedValue(browser);

    const pageFactory = {
      bindChatGPTPage: vi.fn(async () => ({
        page: bridgeOwnedPage,
        ownsPage: true,
      })),
      createFreshChatGPTPage: vi.fn(async () => freshPage),
      resetChatGPTPage: vi.fn(async () => {
        throw new Error('should not reuse bridge-owned pages');
      }),
    };

    const manager = new BrowserManager(pageFactory as never);
    await manager.openSession({
      sessionId: 'session-1',
      browserEndpoint: 'http://127.0.0.1:9667',
      startupUrl: 'https://chatgpt.com/',
    });

    expect(connect).toHaveBeenCalledWith({
      browserURL: 'http://127.0.0.1:9667',
      protocolTimeout: 600_000,
    });

    const rebound = await manager.prepareFreshConversationPage('session-1');

    expect(rebound).toBe(freshPage);
    expect(bridgeOwnedPage.close).toHaveBeenCalledTimes(1);
  });
});
