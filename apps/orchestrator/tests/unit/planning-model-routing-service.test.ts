import { describe, expect, it } from 'vitest';

import { PlanningModelRoutingService } from '../../src/services/planning-model-routing-service';

describe('PlanningModelRoutingService', () => {
  it('routes planning phases to the Pro long-think lane by default', () => {
    const service = new PlanningModelRoutingService({
      defaultModel: 'pro',
      maxWaitMs: 3_000_000,
      pollIntervalMs: 5000,
      stablePolls: 3,
    });

    const decision = service.resolve({
      runId: '4f447874-6e0a-4b1f-9d61-f693977f7cc7',
      phase: 'requirement_freeze',
    });

    expect(decision.lane).toBe('pro_long_think');
    expect(decision.model).toBe('pro');
    expect(decision.maxWaitMs).toBe(3_000_000);
    expect(decision.pollIntervalMs).toBe(5000);
    expect(decision.stablePolls).toBe(3);
    expect(decision.consumeRunningOutput).toBe(false);
  });
});
