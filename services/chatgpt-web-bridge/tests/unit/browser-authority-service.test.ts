import { describe, expect, it } from 'vitest';

import { BrowserAuthorityService } from '../../src/services/browser-authority-service';

describe('BrowserAuthorityService', () => {
  it('prefers an explicit DevTools endpoint from the request input', async () => {
    const service = new BrowserAuthorityService(
      {
        SELF_IMPROVEMENT_ENV_STATE_PATH: '/tmp/env-state.json',
        BRIDGE_BROWSER_URL: 'http://127.0.0.1:9668',
      },
      async () =>
        JSON.stringify({
          browser: {
            endpoint: 'http://172.18.144.1:9224',
          },
        }),
    );

    await expect(
      service.resolve({
        browserUrl: 'http://127.0.0.1:9333/json/version',
        startupUrl: 'https://chatgpt.com/',
      }),
    ).resolves.toEqual({
      browserEndpoint: 'http://127.0.0.1:9333',
      startupUrl: 'https://chatgpt.com/',
      source: 'request_input',
    });
  });

  it('falls back to the env-state browser authority before stale env browser urls', async () => {
    const service = new BrowserAuthorityService(
      {
        SELF_IMPROVEMENT_ENV_STATE_PATH: '/tmp/env-state.json',
        BRIDGE_BROWSER_URL: 'http://127.0.0.1:9668',
      },
      async () =>
        JSON.stringify({
          browser: {
            endpoint: 'http://172.18.144.1:9224',
          },
        }),
    );

    await expect(service.resolve({})).resolves.toEqual({
      browserEndpoint: 'http://172.18.144.1:9224',
      source: 'env_state_browser_authority',
    });
  });

  it('prefers connect-url and candidate env hints before chatgpt browser url', async () => {
    const service = new BrowserAuthorityService(
      {
        BRIDGE_BROWSER_CONNECT_URL: 'http://172.18.144.1:9224/json/version',
        BRIDGE_BROWSER_URL_CANDIDATES:
          'not-a-url,https://chatgpt.com/,http://172.18.144.1:9333/json/list',
        CHATGPT_BROWSER_URL: 'http://127.0.0.1:9668',
      },
      async () => null,
    );

    await expect(service.resolve({ startupUrl: 'https://chatgpt.com/' })).resolves.toEqual({
      browserEndpoint: 'http://172.18.144.1:9224',
      startupUrl: 'https://chatgpt.com/',
      source: 'env_connect_url',
    });
  });

  it('uses the first valid browser-url candidate when connect-url is absent', async () => {
    const service = new BrowserAuthorityService(
      {
        BRIDGE_BROWSER_URL_CANDIDATES:
          'not-a-url,https://chatgpt.com/,http://172.18.144.1:9333/json/list',
        CHATGPT_BROWSER_URL: 'http://127.0.0.1:9668',
      },
      async () => null,
    );

    await expect(service.resolve({})).resolves.toEqual({
      browserEndpoint: 'http://172.18.144.1:9333',
      source: 'env_browser_url_candidates',
    });
  });
});
