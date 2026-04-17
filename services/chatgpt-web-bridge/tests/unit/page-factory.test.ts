import { describe, expect, it } from 'vitest';

import { PageFactory } from '../../src/browser/page-factory';

type FakePage = {
  name: string;
  currentUrl: string;
  selectors: ReadonlySet<string>;
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
      state.currentUrl = url;
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
      state.currentUrl = url;
    },
    bringToFront: async () => {
      state.bringToFrontCalls += 1;
    },
  };
}

function createTarget(input: {
  type?: string;
  url: string;
  page: ReturnType<typeof createPage> | ReturnType<typeof createDelayedComposerPage>;
  requiresDebuggerResume?: boolean;
  sessionState?: {
    detachCalls: number;
  };
}): {
  type(): string;
  url(): string;
  page(): Promise<ReturnType<typeof createPage> | ReturnType<typeof createDelayedComposerPage>>;
  createCDPSession(): Promise<{
    send(method: string): Promise<Record<string, never>>;
    detach(): Promise<void>;
  }>;
} {
  let resumed = !input.requiresDebuggerResume;

  return {
    type: () => input.type ?? 'page',
    url: () => input.url,
    page: async () => {
      if (!resumed) {
        return await new Promise<never>(() => {
          // Intentionally unresolved until Runtime.runIfWaitingForDebugger resumes the target.
        });
      }

      return input.page;
    },
    createCDPSession: async () => ({
      send: async (method: string) => {
        if (method === 'Runtime.runIfWaitingForDebugger') {
          resumed = true;
        }

        return {};
      },
      detach: async () => {
        input.sessionState && (input.sessionState.detachCalls += 1);
      },
    }),
  };
}

describe('PageFactory', () => {
  it('prefers a logged-in composer-ready target in attach mode', async () => {
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
      targets: () => [
        createTarget({
          url: genericPage.url(),
          page: genericPage,
        }) as never,
        createTarget({
          url: composerReadyPage.url(),
          page: composerReadyPage,
        }) as never,
      ],
      newPage: async () => {
        throw new Error('should not create a new page');
      },
    };

    const selected = await new PageFactory().bindChatGPTPage(browser as never, {
      startupUrl: 'https://chatgpt.com/',
      mode: 'attach',
    });

    expect(selected.page).toBe(composerReadyPage);
    expect(selected.ownsPage).toBe(false);
    expect(composerReadyPage.bringToFrontCalls).toBe(1);
  });

  it('resumes a waiting target before materializing it in attach mode', async () => {
    const waitingPage = createPage({
      name: 'waiting-page',
      url: 'https://chatgpt.com/',
      selectors: ['#prompt-textarea'],
    });
    const sessionState = { detachCalls: 0 };
    const browser = {
      targets: () => [
        createTarget({
          url: waitingPage.url(),
          page: waitingPage,
          requiresDebuggerResume: true,
          sessionState,
        }) as never,
      ],
      newPage: async () => {
        throw new Error('should not create a new page');
      },
    };

    const selected = await new PageFactory().bindChatGPTPage(browser as never, {
      startupUrl: 'https://chatgpt.com/',
      mode: 'attach',
    });

    expect(selected.page).toBe(waitingPage);
    expect(selected.ownsPage).toBe(false);
    expect(waitingPage.bringToFrontCalls).toBe(1);
    expect(sessionState.detachCalls).toBe(0);
  });

  it('recovers an attached page by navigating the existing target to the startup url', async () => {
    const attachedBlankPage = createPage({
      name: 'attached-blank',
      url: 'about:blank',
      selectors: ['#prompt-textarea'],
    });
    let newPageCalls = 0;
    const browser = {
      targets: () => [
        createTarget({
          url: 'about:blank',
          page: attachedBlankPage,
        }) as never,
      ],
      newPage: async () => {
        newPageCalls += 1;
        throw new Error('should not create a new page in attach mode');
      },
    };

    const selected = await new PageFactory().bindChatGPTPage(browser as never, {
      startupUrl: 'https://chatgpt.com/',
      mode: 'attach',
    });

    expect(selected.page).toBe(attachedBlankPage);
    expect(selected.ownsPage).toBe(false);
    expect(attachedBlankPage.gotoCalls).toEqual(['https://chatgpt.com/']);
    expect(attachedBlankPage.bringToFrontCalls).toBe(1);
    expect(newPageCalls).toBe(0);
  });

  it('opens a new page in launch mode when no existing target satisfies attach readiness', async () => {
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
      targets: () => [
        createTarget({
          url: loggedOutPage.url(),
          page: loggedOutPage,
        }) as never,
      ],
      newPage: async () => newPage as never,
    };

    const selected = await new PageFactory().bindChatGPTPage(browser as never, {
      startupUrl: 'https://chatgpt.com/',
      mode: 'launch',
    });

    expect(selected.page).toBe(newPage);
    expect(selected.ownsPage).toBe(true);
    expect(newPage.gotoCalls).toEqual(['https://chatgpt.com/']);
    expect(newPage.bringToFrontCalls).toBe(1);
  });

  it('ignores existing conversation targets that do not expose the composer input', async () => {
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
      targets: () => [
        createTarget({
          url: staleConversationPage.url(),
          page: staleConversationPage,
        }) as never,
      ],
      newPage: async () => newPage as never,
    };

    const selected = await new PageFactory().bindChatGPTPage(browser as never, {
      startupUrl: 'https://chatgpt.com/',
      mode: 'launch',
    });

    expect(selected.page).toBe(newPage);
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

  it('resets an attached page to the startup url when preparing a fresh conversation', async () => {
    const attachedPage = createPage({
      name: 'attached-page',
      url: 'https://chatgpt.com/c/existing',
      selectors: ['#prompt-textarea'],
    });

    const selected = await new PageFactory().resetChatGPTPage(
      attachedPage as never,
      'https://chatgpt.com/',
    );

    expect(selected).toBe(attachedPage);
    expect(attachedPage.gotoCalls).toEqual(['https://chatgpt.com/']);
    expect(attachedPage.bringToFrontCalls).toBe(1);
  });
});
