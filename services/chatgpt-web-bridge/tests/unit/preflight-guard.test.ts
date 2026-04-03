import { describe, expect, it } from 'vitest';

import { PreflightGuard } from '../../src/guards/preflight-guard';
import { AppError } from '../../src/types/error';

type FakePage = {
  readonly urlValue: string;
  readonly selectors: ReadonlySet<string>;
};

function createPage(input?: {
  url?: string;
  selectors?: readonly string[];
}) {
  const page: FakePage = {
    urlValue: input?.url ?? 'https://chatgpt.com/',
    selectors: new Set(input?.selectors ?? []),
  };

  return {
    url: () => page.urlValue,
    $: async (selector: string) => (page.selectors.has(selector) ? { selector } : null),
  };
}

describe('PreflightGuard', () => {
  it('allows a blank new conversation page during session attach readiness', async () => {
    const guard = new PreflightGuard();
    const page = createPage({
      selectors: ['#prompt-textarea'],
    });

    await expect(guard.ensureReady(page as never, 'session_attach')).resolves.toBeUndefined();
  });

  it('still requires response messages for snapshot readiness', async () => {
    const guard = new PreflightGuard();
    const page = createPage({
      selectors: ['#prompt-textarea'],
    });

    await expect(guard.ensureReady(page as never, 'snapshot')).rejects.toMatchObject({
      code: 'DOM_DRIFT_DETECTED',
    } satisfies Partial<AppError>);
  });
});
