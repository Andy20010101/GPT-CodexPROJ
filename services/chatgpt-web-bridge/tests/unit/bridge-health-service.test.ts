import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { BridgeHealthService } from '../../src/services/bridge-health-service';

describe('BridgeHealthService', () => {
  it('records the latest bridge health summary and drift incidents', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bridge-health-'));
    const service = new BridgeHealthService(artifactDir);

    const healthPath = await service.recordHealth({
      status: 'degraded',
      checkedAt: '2026-04-02T18:00:00.000Z',
      activeSessions: 2,
      activeConversations: 1,
      issues: ['Recovered via selector fallback.'],
      latestIncidentId: '11111111-1111-1111-1111-111111111111',
      metadata: {
        sessionId: 'session-1',
      },
    });
    const incidentPath = await service.recordIncident({
      incidentId: '22222222-2222-2222-2222-222222222222',
      category: 'selector_fallback',
      status: 'recovered',
      summary: 'Recovered after applying selector fallbacks.',
      attempts: [
        {
          label: 'selector_fallback',
          outcome: 'succeeded',
        },
      ],
      occurredAt: '2026-04-02T18:00:00.000Z',
      resolvedAt: '2026-04-02T18:00:02.000Z',
      metadata: {},
    });

    await expect(fs.stat(healthPath)).resolves.toBeTruthy();
    await expect(fs.stat(incidentPath)).resolves.toBeTruthy();
    await expect(service.getLatestHealth()).resolves.toMatchObject({
      status: 'degraded',
      activeSessions: 2,
      latestIncidentId: '11111111-1111-1111-1111-111111111111',
    });
    await expect(service.listIncidents()).resolves.toEqual([
      expect.objectContaining({
        incidentId: '22222222-2222-2222-2222-222222222222',
        category: 'selector_fallback',
        status: 'recovered',
      }),
    ]);
  });
});
