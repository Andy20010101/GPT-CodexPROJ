import fs from 'node:fs/promises';

import {
  normalizeDevtoolsEndpoint,
  resolveBrowserEndpoint,
  resolveStartupUrl,
} from '../utils/devtools-endpoint-normalizer';

type AuthorityEnv = Record<string, string | undefined>;

export type BrowserAuthorityResolutionSource =
  | 'request_input'
  | 'env_state_browser_authority'
  | 'env_browser_url'
  | 'env_connect_url'
  | 'env_browser_url_candidates'
  | 'env_chatgpt_browser_url'
  | 'unresolved';

export type BrowserAuthorityResolution = {
  browserEndpoint: string | null;
  startupUrl?: string | undefined;
  source: BrowserAuthorityResolutionSource;
};

export class BrowserAuthorityService {
  public constructor(
    private readonly env: AuthorityEnv = process.env,
    private readonly readAuthorityFile: (filePath: string) => Promise<string | null> = async (
      filePath,
    ) => {
      try {
        return await fs.readFile(filePath, 'utf8');
      } catch {
        return null;
      }
    },
  ) {}

  public async resolve(input: {
    browserUrl?: string | undefined;
    browserEndpoint?: string | undefined;
    startupUrl?: string | undefined;
  }): Promise<BrowserAuthorityResolution> {
    const startupUrl = resolveStartupUrl(input);
    const explicitBrowserEndpoint = resolveBrowserEndpoint(input);
    if (explicitBrowserEndpoint) {
      return {
        browserEndpoint: explicitBrowserEndpoint,
        ...(startupUrl ? { startupUrl } : {}),
        source: 'request_input',
      };
    }

    const authorityBrowserEndpoint = await this.readAuthorityBrowserEndpoint();
    if (authorityBrowserEndpoint) {
      return {
        browserEndpoint: authorityBrowserEndpoint,
        ...(startupUrl ? { startupUrl } : {}),
        source: 'env_state_browser_authority',
      };
    }

    const envBridgeBrowserUrl = this.normalizeEnvEndpoint(this.env.BRIDGE_BROWSER_URL);
    if (envBridgeBrowserUrl) {
      return {
        browserEndpoint: envBridgeBrowserUrl,
        ...(startupUrl ? { startupUrl } : {}),
        source: 'env_browser_url',
      };
    }

    const envConnectUrl = this.normalizeEnvEndpoint(this.env.BRIDGE_BROWSER_CONNECT_URL);
    if (envConnectUrl) {
      return {
        browserEndpoint: envConnectUrl,
        ...(startupUrl ? { startupUrl } : {}),
        source: 'env_connect_url',
      };
    }

    const envBrowserUrlCandidate = this.resolveFirstCandidate(
      this.env.BRIDGE_BROWSER_URL_CANDIDATES,
    );
    if (envBrowserUrlCandidate) {
      return {
        browserEndpoint: envBrowserUrlCandidate,
        ...(startupUrl ? { startupUrl } : {}),
        source: 'env_browser_url_candidates',
      };
    }

    const envChatGptBrowserUrl = this.normalizeEnvEndpoint(this.env.CHATGPT_BROWSER_URL);
    if (envChatGptBrowserUrl) {
      return {
        browserEndpoint: envChatGptBrowserUrl,
        ...(startupUrl ? { startupUrl } : {}),
        source: 'env_chatgpt_browser_url',
      };
    }

    return {
      browserEndpoint: null,
      ...(startupUrl ? { startupUrl } : {}),
      source: 'unresolved',
    };
  }

  public async readAuthorityBrowserEndpoint(): Promise<string | null> {
    const authorityPath = this.env.SELF_IMPROVEMENT_ENV_STATE_PATH;
    if (!authorityPath) {
      return null;
    }

    const raw = await this.readAuthorityFile(authorityPath);
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as {
        browser?: { endpoint?: unknown };
      };
      return typeof parsed.browser?.endpoint === 'string'
        ? normalizeDevtoolsEndpoint(parsed.browser.endpoint)?.endpoint ?? null
        : null;
    } catch {
      return null;
    }
  }

  private normalizeEnvEndpoint(value: string | undefined): string | null {
    if (!value) {
      return null;
    }
    return normalizeDevtoolsEndpoint(value)?.endpoint ?? null;
  }

  private resolveFirstCandidate(value: string | undefined): string | null {
    if (!value || value.trim().length === 0) {
      return null;
    }

    for (const candidate of value.split(',')) {
      const normalized = this.normalizeEnvEndpoint(candidate.trim());
      if (normalized) {
        return normalized;
      }
    }

    return null;
  }
}
