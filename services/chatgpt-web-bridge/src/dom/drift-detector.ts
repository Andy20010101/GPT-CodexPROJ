import { AppError } from '../types/error';

import type { SelectorRequirement } from './selectors';

export interface SelectorProbe {
  exists(selector: string): Promise<boolean>;
}

export class DriftDetector {
  public async assertRequiredSelectors(
    probe: SelectorProbe,
    requirements: readonly SelectorRequirement[],
    context = 'chatgpt',
  ): Promise<void> {
    const missing: SelectorRequirement[] = [];

    for (const requirement of requirements) {
      const results = await Promise.all(
        requirement.candidates.map(async (candidate) => probe.exists(candidate)),
      );
      if (!results.some(Boolean)) {
        missing.push(requirement);
      }
    }

    if (missing.length > 0) {
      throw new AppError('DOM_DRIFT_DETECTED', 'Critical ChatGPT selectors are missing', 503, {
        context,
        missing,
      });
    }
  }
}
