import { describe, expect, it } from 'vitest';

import {
  resolveBrowserEndpoint,
  resolveStartupUrl,
} from '../../src/utils/devtools-endpoint-normalizer';

describe('devtools-endpoint-normalizer', () => {
  it('treats browserUrl=https://chatgpt.com/ as a startup page instead of a DevTools endpoint', () => {
    expect(
      resolveBrowserEndpoint({
        browserUrl: 'https://chatgpt.com/',
      }),
    ).toBeUndefined();
    expect(
      resolveStartupUrl({
        browserUrl: 'https://chatgpt.com/',
      }),
    ).toBe('https://chatgpt.com/');
  });

  it('keeps browserUrl=http://host:port as a legacy DevTools endpoint alias', () => {
    expect(
      resolveBrowserEndpoint({
        browserUrl: 'http://172.22.224.1:9225',
      }),
    ).toBe('http://172.22.224.1:9225');
    expect(
      resolveStartupUrl({
        browserUrl: 'http://172.22.224.1:9225',
      }),
    ).toBeUndefined();
  });
});
