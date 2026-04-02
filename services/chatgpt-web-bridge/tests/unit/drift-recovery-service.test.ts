import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { SelectorRequirement } from '../../src/dom/selectors';
import { DriftRecoveryService } from '../../src/services/drift-recovery-service';
import { BridgeHealthService } from '../../src/services/bridge-health-service';
import { AppError } from '../../src/types/error';

function createProbe(existingSelectors: readonly string[]) {
  return {
    exists(selector: string) {
      return Promise.resolve(existingSelectors.includes(selector));
    },
  };
}

describe('DriftRecoveryService', () => {
  it('recovers by applying selector fallbacks when primary selectors are missing', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bridge-drift-recovery-'));
    const healthService = new BridgeHealthService(artifactDir);
    const service = new DriftRecoveryService(healthService);
    const requirements: readonly SelectorRequirement[] = [
      {
        name: 'composer.input',
        candidates: ['#prompt-textarea'],
      },
    ];

    const result = await service.recover({
      sessionId: '11111111-1111-1111-1111-111111111111',
      pageUrl: 'https://chatgpt.com/',
      probe: createProbe(['textarea[data-testid="prompt-textarea"]']),
      requirements,
    });

    expect(result.health.status).toBe('degraded');
    expect(result.incident).toMatchObject({
      category: 'selector_fallback',
      status: 'recovered',
    });
    await expect(healthService.listIncidents()).resolves.toHaveLength(1);
  });

  it('reports needs_reauth without throwing when login is required', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bridge-needs-reauth-'));
    const healthService = new BridgeHealthService(artifactDir);
    const service = new DriftRecoveryService(healthService);

    const result = await service.recover({
      sessionId: '11111111-1111-1111-1111-111111111111',
      pageUrl: 'https://chatgpt.com/auth/login',
      probe: createProbe([]),
      requirements: [],
      loggedOutDetected: true,
    });

    expect(result.health.status).toBe('needs_reauth');
    expect(result.incident?.status).toBe('failed');
  });

  it('throws a structured DOM drift error when recovery cannot restore missing selectors', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bridge-drift-unrecoverable-'));
    const healthService = new BridgeHealthService(artifactDir);
    const service = new DriftRecoveryService(healthService);

    await expect(
      service.recover({
        conversationId: '33333333-3333-3333-3333-333333333333',
        pageUrl: 'https://chatgpt.com/c/example',
        probe: createProbe([]),
        requirements: [
          {
            name: 'response.messages',
            candidates: ['[data-message-author-role]'],
          },
        ],
      }),
    ).rejects.toThrowError(AppError);

    await expect(healthService.listIncidents()).resolves.toHaveLength(1);
    await expect(healthService.getLatestHealth()).resolves.toMatchObject({
      status: 'dom_drift_detected',
    });
  });
});
