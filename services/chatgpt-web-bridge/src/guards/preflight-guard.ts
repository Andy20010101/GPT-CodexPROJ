import type { Page } from 'puppeteer-core';

import { DriftDetector, type SelectorProbe } from '../dom/drift-detector';
import {
  ChatGPTSelectors,
  ChatGPTSendRequirements,
  ChatGPTSessionAttachRequirements,
  ChatGPTSnapshotRequirements,
} from '../dom/selectors';
import { AppError } from '../types/error';

export type PageReadinessProfile = 'session_attach' | 'send' | 'snapshot';

class PuppeteerSelectorProbe implements SelectorProbe {
  public constructor(private readonly page: Page) {}

  public async exists(selector: string): Promise<boolean> {
    return (await this.page.$(selector)) !== null;
  }
}

export class PreflightGuard {
  public constructor(private readonly driftDetector = new DriftDetector()) {}

  public async ensureReady(
    page: Page,
    profile: PageReadinessProfile = 'send',
  ): Promise<void> {
    if (page.url().includes('/auth/login')) {
      throw new AppError('CHATGPT_NOT_READY', 'ChatGPT page is not logged in', 503, {
        url: page.url(),
      });
    }

    const probe = new PuppeteerSelectorProbe(page);
    for (const marker of ChatGPTSelectors.auth.loggedOutMarkers) {
      if (await probe.exists(marker)) {
        throw new AppError('CHATGPT_NOT_READY', 'Login prompt detected on ChatGPT page', 503, {
          selector: marker,
        });
      }
    }

    const requirements =
      profile === 'snapshot'
        ? ChatGPTSnapshotRequirements
        : profile === 'session_attach'
          ? ChatGPTSessionAttachRequirements
          : ChatGPTSendRequirements;

    await this.driftDetector.assertRequiredSelectors(probe, requirements, `preflight:${profile}`);
  }
}
