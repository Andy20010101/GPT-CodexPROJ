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
  it('rebinds the session to a fresh page before a new conversation starts', async () => {
    const existingPage = {
      url: () => 'https://chatgpt.com/c/existing',
      close: vi.fn(async () => undefined),
      isClosed: vi.fn(() => false),
    };
    const freshPage = {
      url: () => 'https://chatgpt.com/',
      close: vi.fn(async () => undefined),
      isClosed: vi.fn(() => false),
    };
    const browser = {
      pages: vi.fn(async () => [existingPage]),
    };
    connect.mockResolvedValue(browser);

    const pageFactory = {
      bindChatGPTPage: vi.fn(async () => existingPage),
      createFreshChatGPTPage: vi.fn(async () => freshPage),
    };

    const manager = new BrowserManager(pageFactory as never);
    await manager.openSession({
      sessionId: 'session-1',
      browserEndpoint: 'http://127.0.0.1:9667',
      startupUrl: 'https://chatgpt.com/',
    });

    expect(manager.getPage('session-1')).toBe(existingPage);

    const rebound = await manager.prepareFreshConversationPage('session-1');

    expect(rebound).toBe(freshPage);
    expect(pageFactory.createFreshChatGPTPage).toHaveBeenCalledWith(
      browser,
      'https://chatgpt.com/',
    );
    expect(manager.getPage('session-1')).toBe(freshPage);
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
      pages: vi.fn(async () => []),
    };
    connect.mockResolvedValue(browser);

    const pageFactory = {
      bindChatGPTPage: vi.fn(async () => bridgeOwnedPage),
      createFreshChatGPTPage: vi.fn(async () => freshPage),
    };

    const manager = new BrowserManager(pageFactory as never);
    await manager.openSession({
      sessionId: 'session-1',
      browserEndpoint: 'http://127.0.0.1:9667',
      startupUrl: 'https://chatgpt.com/',
    });

    const rebound = await manager.prepareFreshConversationPage('session-1');

    expect(rebound).toBe(freshPage);
    expect(bridgeOwnedPage.close).toHaveBeenCalledTimes(1);
  });
});
