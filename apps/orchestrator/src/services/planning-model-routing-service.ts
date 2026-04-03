import { randomUUID } from 'node:crypto';

import {
  PlanningModelRoutingDecisionSchema,
  type PlanningModelRoutingDecision,
  type PlanningPhase,
} from '../contracts';

export class PlanningModelRoutingService {
  public constructor(
    private readonly config: {
      defaultModel: string;
      maxWaitMs: number;
      pollIntervalMs: number;
      stablePolls: number;
    },
  ) {}

  public resolve(input: {
    runId: string;
    phase: PlanningPhase;
    modelOverride?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): PlanningModelRoutingDecision {
    return PlanningModelRoutingDecisionSchema.parse({
      decisionId: randomUUID(),
      runId: input.runId,
      phase: input.phase,
      lane: 'pro_long_think',
      model: input.modelOverride ?? this.config.defaultModel,
      maxWaitMs: this.config.maxWaitMs,
      pollIntervalMs: this.config.pollIntervalMs,
      stablePolls: this.config.stablePolls,
      consumeRunningOutput: false,
      requestedAt: new Date().toISOString(),
      metadata: input.metadata ?? {},
    });
  }
}
