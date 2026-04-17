import puppeteer from 'puppeteer-core';

import { PageFactory } from '../browser/page-factory';
import { ChatGPTSelectors } from '../dom/selectors';

const DEVTOOLS_PROTOCOL_TIMEOUT_MS = 600_000;

type ProbePage = {
  url(): string;
  title(): Promise<string>;
  $(selector: string): Promise<unknown>;
};

type BoundProbePage = {
  page: ProbePage;
};

type ProbeBrowser = {
  disconnect(): Promise<void> | void;
};

export type BrowserReadinessProbeResult = {
  endpoint: string;
  startupUrl: string;
  versionUrl: string;
  listUrl: string;
  cdpReachable: boolean;
  loggedIn: boolean;
  composerReady: boolean;
  pageUrl: string | null;
  pageTitle: string | null;
  issues: string[];
};

export type BrowserReadinessProbeInput = {
  endpoint: string;
  startupUrl: string;
};

type BrowserConnector = (browserURL: string) => Promise<ProbeBrowser>;

type ProbePageFactory = {
  bindChatGPTPage(
    browser: ProbeBrowser,
    input: {
      startupUrl: string;
      mode: 'attach';
    },
  ): Promise<BoundProbePage>;
};

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

export class BrowserReadinessProbeService {
  public constructor(
    private readonly pageFactory: ProbePageFactory = new PageFactory() as unknown as ProbePageFactory,
    private readonly connectBrowser: BrowserConnector = async (browserURL) =>
      (await puppeteer.connect({
        browserURL,
        protocolTimeout: DEVTOOLS_PROTOCOL_TIMEOUT_MS,
      })) as unknown as ProbeBrowser,
    private readonly fetchJsonImpl: (url: string) => Promise<unknown> = fetchJson,
  ) {}

  public async probe(input: BrowserReadinessProbeInput): Promise<BrowserReadinessProbeResult> {
    const versionUrl = new URL('/json/version', ensureTrailingSlash(input.endpoint)).toString();
    const listUrl = new URL('/json/list', ensureTrailingSlash(input.endpoint)).toString();
    const issues: string[] = [];
    let cdpReachable = false;
    let loggedIn = false;
    let composerReady = false;
    let pageUrl: string | null = null;
    let pageTitle: string | null = null;

    try {
      await this.fetchJsonImpl(versionUrl);
      await this.fetchJsonImpl(listUrl);
      cdpReachable = true;
    } catch (error) {
      issues.push(`CDP probe failed: ${String(error)}`);
    }

    if (cdpReachable) {
      try {
        const browser = await this.connectBrowser(input.endpoint);
        try {
          const binding = await this.pageFactory.bindChatGPTPage(browser, {
            startupUrl: input.startupUrl,
            mode: 'attach',
          });
          pageUrl = binding.page.url();
          pageTitle = await binding.page.title();

          for (const selector of ChatGPTSelectors.auth.loggedOutMarkers) {
            if ((await binding.page.$(selector)) !== null) {
              issues.push(`Logged-out marker matched: ${selector}`);
            }
          }

          for (const selector of ChatGPTSelectors.composer.input) {
            if ((await binding.page.$(selector)) !== null) {
              composerReady = true;
              break;
            }
          }

          loggedIn = composerReady && issues.every((issue) => !issue.startsWith('Logged-out marker'));
        } finally {
          await browser.disconnect();
        }
      } catch (error) {
        issues.push(`Browser attach probe failed: ${String(error)}`);
      }
    }

    return {
      endpoint: input.endpoint,
      startupUrl: input.startupUrl,
      versionUrl,
      listUrl,
      cdpReachable,
      loggedIn,
      composerReady,
      pageUrl,
      pageTitle,
      issues,
    };
  }
}
