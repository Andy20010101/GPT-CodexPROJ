import { describe, expect, it } from 'vitest';

import { PageFactory } from '../../src/browser/page-factory';

type FakePage = {
  readonly name: string;
  readonly currentUrl: string;
  readonly selectors: ReadonlySet<string>;
  gotoCalls: string[];
  bringToFrontCalls: number;
};

function createPage(input: {
  name: string;
  url: string;
  selectors?: readonly string[];
}): FakePage & {
  url(): string;
  $(selector: string): Promise<{ selector: string } | null>;
  goto(url: string): Promise<void>;
  bringToFront(): Promise<void>;
} {
  const state: FakePage = {
    name: input.name,
    currentUrl: input.url,
    selectors: new Set(input.selectors ?? []),
    gotoCalls: [],
    bringToFrontCalls: 0,
  };

  return {
    get name() {
      return state.name;
    },
    get currentUrl() {
      return state.currentUrl;
    },
    get selectors() {
      return state.selectors;
    },
    get gotoCalls() {
      return state.gotoCalls;
    },
    get bringToFrontCalls() {
      return state.bringToFrontCalls;
    },
    url: () => state.currentUrl,
    $: async (selector: string) => (state.selectors.has(selector) ? { selector } : null),
    goto: async (url: string) => {
      state.gotoCalls.push(url);
    },
    bringToFront: async () => {
      state.bringToFrontCalls += 1;
    },
  };
}

function createDelayedComposerPage(input: {
  name: string;
  url: string;
  composerAppearsAfterChecks: number;
}): {
  readonly name: string;
  readonly currentUrl: string;
  gotoCalls: string[];
  composerChecks: number;
  bringToFrontCalls: number;
  url(): string;
  $(selector: string): Promise<{ selector: string } | null>;
  goto(url: string): Promise<void>;
  bringToFront(): Promise<void>;
} {
  const state = {
    name: input.name,
    currentUrl: input.url,
    gotoCalls: [] as string[],
    composerChecks: 0,
    bringToFrontCalls: 0,
  };

  return {
    get name() {
      return state.name;
    },
    get currentUrl() {
      return state.currentUrl;
    },
    get gotoCalls() {
      return state.gotoCalls;
    },
    get composerChecks() {
      return state.composerChecks;
    },
    get bringToFrontCalls() {
      return state.bringToFrontCalls;
    },
    url: () => state.currentUrl,
    $: async (selector: string) => {
      if (selector === '#prompt-textarea') {
        state.composerChecks += 1;
        if (state.composerChecks >= input.composerAppearsAfterChecks) {
          return { selector };
        }
      }
      return null;
    },
    goto: async (url: string) => {
      state.gotoCalls.push(url);
    },
    bringToFront: async () => {
      state.bringToFrontCalls += 1;
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
    expect(composerReadyPage.bringToFrontCalls).toBe(1);
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
    expect(newPage.bringToFrontCalls).toBe(1);
  });

  it('ignores existing conversation pages that do not expose the composer input', async () => {
    const staleConversationPage = createPage({
      name: 'stale-conversation',
      url: 'https://chatgpt.com/c/existing',
    });
    const newPage = createPage({
      name: 'new-page',
      url: 'about:blank',
      selectors: ['#prompt-textarea'],
    });
    const browser = {
      pages: async () => [staleConversationPage as never],
      newPage: async () => newPage as never,
    };

    const selected = await new PageFactory().bindChatGPTPage(
      browser as never,
      'https://chatgpt.com/',
    );

    expect(selected).toBe(newPage);
    expect(newPage.gotoCalls).toEqual(['https://chatgpt.com/']);
    expect(newPage.bringToFrontCalls).toBe(1);
  });

  it('creates a fresh page for new conversations instead of reusing an existing one', async () => {
    const freshPage = createPage({
      name: 'fresh-page',
      url: 'about:blank',
      selectors: ['#prompt-textarea'],
    });
    const browser = {
      newPage: async () => freshPage as never,
    };

    const selected = await new PageFactory().createFreshChatGPTPage(
      browser as never,
      'https://chatgpt.com/',
    );

    expect(selected).toBe(freshPage);
    expect(freshPage.gotoCalls).toEqual(['https://chatgpt.com/']);
    expect(freshPage.bringToFrontCalls).toBe(1);
  });

  it('waits for a fresh page to expose the composer before returning it', async () => {
    const delayedPage = createDelayedComposerPage({
      name: 'delayed-page',
      url: 'https://chatgpt.com/',
      composerAppearsAfterChecks: 3,
    });
    const browser = {
      newPage: async () => delayedPage as never,
    };

    const selected = await new PageFactory().createFreshChatGPTPage(
      browser as never,
      'https://chatgpt.com/',
    );

    expect(selected).toBe(delayedPage);
    expect(delayedPage.gotoCalls).toEqual(['https://chatgpt.com/']);
    expect(delayedPage.composerChecks).toBeGreaterThanOrEqual(3);
    expect(delayedPage.bringToFrontCalls).toBe(1);
  });
});
