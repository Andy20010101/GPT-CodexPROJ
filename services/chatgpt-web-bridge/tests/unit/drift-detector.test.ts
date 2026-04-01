import { describe, expect, it } from 'vitest';

import { DriftDetector } from '../../src/dom/drift-detector';
import type { SelectorRequirement } from '../../src/dom/selectors';
import { AppError } from '../../src/types/error';

describe('DriftDetector', () => {
  it('throws a structured error when required selectors are missing', async () => {
    const driftDetector = new DriftDetector();
    const requirements: readonly SelectorRequirement[] = [
      {
        name: 'composer.input',
        candidates: ['#prompt-textarea'],
      },
    ];

    const probe = {
      exists: () => Promise.resolve(false),
    };

    await expect(
      driftDetector.assertRequiredSelectors(probe, requirements, 'test-page'),
    ).rejects.toThrowError(AppError);
  });
});
