import { describe, expect, it, vi } from 'vitest';

import { BrowserReadinessProbeService } from '../../src/services/browser-readiness-probe-service';

describe('BrowserReadinessProbeService', () => {
  it('reports ready when CDP is reachable and the attached page has a composer', async () => {
    const connectBrowser = vi.fn().mockResolvedValue({
      disconnect: vi.fn(),
    });
    const service = new BrowserReadinessProbeService(
      {
        bindChatGPTPage: vi.fn().mockResolvedValue({
          page: {
            url: () => 'https://chatgpt.com/',
            title: vi.fn().mockResolvedValue('ChatGPT'),
            $: vi.fn(async (selector: string) => {
              if (selector === '#prompt-textarea') {
                return {};
              }
              return null;
            }),
          },
        }),
      },
      connectBrowser,
      vi.fn().mockResolvedValue({}),
    );

    const result = await service.probe({
      endpoint: 'http://127.0.0.1:9224',
      startupUrl: 'https://chatgpt.com/',
    });

    expect(result.cdpReachable).toBe(true);
    expect(result.loggedIn).toBe(true);
    expect(result.composerReady).toBe(true);
    expect(result.pageUrl).toBe('https://chatgpt.com/');
    expect(result.issues).toEqual([]);
    expect(connectBrowser).toHaveBeenCalledWith('http://127.0.0.1:9224');
  });

  it('does not report logged in when a logged-out marker is present', async () => {
    const service = new BrowserReadinessProbeService(
      {
        bindChatGPTPage: vi.fn().mockResolvedValue({
          page: {
            url: () => 'https://chatgpt.com/',
            title: vi.fn().mockResolvedValue('ChatGPT'),
            $: vi.fn(async (selector: string) => {
              if (selector === 'a[href*="/auth/login"]') {
                return {};
              }
              if (selector === '#prompt-textarea') {
                return {};
              }
              return null;
            }),
          },
        }),
      },
      vi.fn().mockResolvedValue({
        disconnect: vi.fn(),
      }),
      vi.fn().mockResolvedValue({}),
    );

    const result = await service.probe({
      endpoint: 'http://127.0.0.1:9224',
      startupUrl: 'https://chatgpt.com/',
    });

    expect(result.cdpReachable).toBe(true);
    expect(result.loggedIn).toBe(false);
    expect(result.composerReady).toBe(true);
    expect(result.issues).toContain('Logged-out marker matched: a[href*="/auth/login"]');
  });

  it('records a CDP probe failure without attempting attach', async () => {
    const bindChatGPTPage = vi.fn();
    const service = new BrowserReadinessProbeService(
      {
        bindChatGPTPage,
      },
      vi.fn(),
      vi.fn().mockRejectedValue(new Error('connection reset')),
    );

    const result = await service.probe({
      endpoint: 'http://127.0.0.1:9224',
      startupUrl: 'https://chatgpt.com/',
    });

    expect(result.cdpReachable).toBe(false);
    expect(result.loggedIn).toBe(false);
    expect(result.composerReady).toBe(false);
    expect(result.issues[0]).toContain('CDP probe failed');
    expect(bindChatGPTPage).not.toHaveBeenCalled();
  });
});
