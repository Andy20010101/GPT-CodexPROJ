import { describe, expect, it } from 'vitest';

import type { FailureRecord } from '../../src/contracts';
import { FailureToTaskService } from '../../src/services/failure-to-task-service';
import { RemediationPlaybookService } from '../../src/services/remediation-playbook-service';

describe('FailureToTaskService', () => {
  it('builds a structured remediation task proposal from a failure record', () => {
    const service = new FailureToTaskService(new RemediationPlaybookService());
    const failure: FailureRecord = {
      failureId: '11111111-1111-1111-1111-111111111111',
      runId: '22222222-2222-2222-2222-222222222222',
      taskId: '33333333-3333-3333-3333-333333333333',
      source: 'bridge',
      taxonomy: 'drift',
      code: 'DOM_DRIFT_DETECTED',
      message: 'Required selectors are missing.',
      retriable: false,
      timestamp: '2026-04-02T20:10:00.000Z',
      metadata: {},
    };

    const proposal = service.propose({
      runId: failure.runId,
      taskId: failure.taskId,
      failure,
    });

    expect(proposal.suggestedTaskTitle).toContain('Selector update review');
    expect(proposal.recommendedPlaybook).toBe('selector_update_review');
    expect(proposal.allowedFiles).toEqual(
      expect.arrayContaining(['services/chatgpt-web-bridge/src/dom/**']),
    );
    expect(proposal.requiredEvidenceKinds).toEqual(
      expect.arrayContaining(['bridge_drift_incident']),
    );
  });
});
