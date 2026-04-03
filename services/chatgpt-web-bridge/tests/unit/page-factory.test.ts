import { describe, expect, it } from 'vitest';

import { PageFactory } from '../../src/browser/page-factory';

type FakePage = {
  readonly name: string;
  readonly currentUrl: string;
  readonly selectors: ReadonlySet<string>;
  gotoCalls: string[];
};

function createPage(input: {
  name: string;
  url: string;
  selectors?: readonly string[];
}): FakePage & {
  url(): string;
  $(selector: string): Promise<{ selector: string } | null>;
  goto(url: string): Promise<void>;
} {
  const page: FakePage = {
    name: input.name,
    currentUrl: input.url,
    selectors: new Set(input.selectors ?? []),
    gotoCalls: [],
  };

  return {
    ...page,
    url: () => page.currentUrl,
    $: async (selector: string) => (page.selectors.has(selector) ? { selector } : null),
    goto: async (url: string) => {
      page.gotoCalls.push(url);
    },
  };
}

describe('PageFactory', () => {
  it('prefers a logged-in composer-ready page over a generic chatgpt tab', async () => {
    const genericPage = createPage({
      name: 'generic',
      url: 'https://chatgpt.com/',
    });
    const composerReadyPage = createPage({
      name: 'composer-ready',
      url: 'https://chatgpt.com/c/existing',
      selectors: ['#prompt-textarea'],
    });
    const browser = {
      pages: async () => [genericPage as never, composerReadyPage as never],
      newPage: async () => {
        throw new Error('should not create a new page');
      },
    };

    const selected = await new PageFactory().bindChatGPTPage(
      browser as never,
      'https://chatgpt.com/',
    );

    expect(selected).toBe(composerReadyPage);
  });

  it('opens a new page when no existing page satisfies attach readiness', async () => {
    const loggedOutPage = createPage({
      name: 'logged-out',
      url: 'https://chatgpt.com/auth/login',
    });
    const newPage = createPage({
      name: 'new-page',
      url: 'about:blank',
      selectors: ['#prompt-textarea'],
    });
    const browser = {
      pages: async () => [loggedOutPage as never],
      newPage: async () => newPage as never,
    };

    const selected = await new PageFactory().bindChatGPTPage(
      browser as never,
      'https://chatgpt.com/',
    );

    expect(selected).toBe(newPage);
    expect(newPage.gotoCalls).toEqual(['https://chatgpt.com/']);
  });
});
