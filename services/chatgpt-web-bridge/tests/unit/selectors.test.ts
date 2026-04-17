import { describe, expect, it } from 'vitest';

import { ChatGPTSelectors } from '../../src/dom/selectors';

describe('ChatGPTSelectors', () => {
  it('excludes composer pill retry affordances from retry-button detection', () => {
    expect(ChatGPTSelectors.composer.retryButton).toEqual([
      'button[aria-label*="Retry"]:not(.__composer-pill-remove)',
      'button[aria-label*="retry"]:not(.__composer-pill-remove)',
      'button[aria-label*="重试"]:not(.__composer-pill-remove)',
    ]);
  });
});
