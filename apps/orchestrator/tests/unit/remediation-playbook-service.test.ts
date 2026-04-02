import { describe, expect, it } from 'vitest';

import type { FailureRecord, StabilityIncident } from '../../src/contracts';
import { RemediationPlaybookService } from '../../src/services/remediation-playbook-service';

describe('RemediationPlaybookService', () => {
  it('matches bridge drift incidents to the bridge drift recovery playbook', () => {
    const service = new RemediationPlaybookService();
    const incident: StabilityIncident = {
      incidentId: '11111111-1111-1111-1111-111111111111',
      runId: '22222222-2222-2222-2222-222222222222',
      source: 'bridge',
      category: 'dom_drift_detected',
      severity: 'high',
      status: 'open',
      summary: 'Selector drift detected.',
      relatedEvidenceIds: [],
      occurredAt: '2026-04-02T20:00:00.000Z',
      metadata: {},
    };

    const playbook = service.match({ incident });
    expect(playbook.category).toBe('bridge_drift_recovery');
    expect(playbook.autoExecutable).toBe(true);
  });

  it('matches timeout failures to the runner timeout recovery playbook', () => {
    const service = new RemediationPlaybookService();
    const failure: FailureRecord = {
      failureId: '33333333-3333-3333-3333-333333333333',
      runId: '22222222-2222-2222-2222-222222222222',
      source: 'runner',
      taxonomy: 'timeout',
      code: 'RUNNER_TIMEOUT',
      message: 'Runner timed out.',
      retriable: true,
      timestamp: '2026-04-02T20:01:00.000Z',
      metadata: {},
    };

    const playbook = service.match({ failure });
    expect(playbook.category).toBe('runner_timeout_recovery');
    expect(playbook.riskLevel).toBe('medium');
  });

  it('falls back to manual attention when no low-risk match exists', () => {
    const service = new RemediationPlaybookService();
    const playbook = service.match({
      failure: {
        failureId: '44444444-4444-4444-4444-444444444444',
        runId: '22222222-2222-2222-2222-222222222222',
        source: 'runtime',
        taxonomy: 'unknown',
        code: 'UNEXPECTED_STATE',
        message: 'Unknown failure.',
        retriable: false,
        timestamp: '2026-04-02T20:02:00.000Z',
        metadata: {},
      },
    });

    expect(playbook.category).toBe('manual_attention');
    expect(playbook.autoExecutable).toBe(false);
  });
});
