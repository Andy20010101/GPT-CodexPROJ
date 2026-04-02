import { describe, expect, it } from 'vitest';

import { SelfRepairPolicyService } from '../../src/services/self-repair-policy-service';
import { RemediationPlaybookService } from '../../src/services/remediation-playbook-service';

describe('SelfRepairPolicyService', () => {
  it('allows low-risk bridge drift recovery automatically', () => {
    const playbookService = new RemediationPlaybookService();
    const policyService = new SelfRepairPolicyService();

    const decision = policyService.decide({
      runId: '11111111-1111-1111-1111-111111111111',
      playbook: playbookService.match({
        incident: {
          incidentId: '22222222-2222-2222-2222-222222222222',
          source: 'bridge',
          category: 'bridge_drift_detected',
          severity: 'medium',
          status: 'open',
          summary: 'Bridge drift detected.',
          relatedEvidenceIds: [],
          occurredAt: '2026-04-02T20:20:00.000Z',
          metadata: {},
        },
      }),
      targetPaths: ['services/chatgpt-web-bridge/src/dom/selectors.ts'],
    });

    expect(decision.decision).toBe('auto_allowed');
  });

  it('forces manual approval when remediation targets prohibited control-plane files', () => {
    const playbookService = new RemediationPlaybookService();
    const policyService = new SelfRepairPolicyService();

    const decision = policyService.decide({
      runId: '11111111-1111-1111-1111-111111111111',
      playbook: playbookService.match({
        failure: {
          failureId: '33333333-3333-3333-3333-333333333333',
          runId: '11111111-1111-1111-1111-111111111111',
          source: 'runtime',
          taxonomy: 'execution',
          code: 'EVIDENCE_MISSING',
          message: 'Evidence is missing.',
          retriable: false,
          timestamp: '2026-04-02T20:21:00.000Z',
          metadata: {},
        },
      }),
      targetPaths: ['apps/orchestrator/src/services/run-acceptance-service.ts'],
    });

    expect(decision.decision).toBe('manual_only');
    expect(decision.reason).toContain('prohibited');
  });
});
