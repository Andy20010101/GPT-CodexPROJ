import type { GateType, TaskLoopState } from '../contracts';
import type { RunRecord } from '../domain/run';

export type RunStatusSummary = {
  runId: string;
  title: string;
  stage: RunRecord['stage'];
  requirementFrozen: boolean;
  architectureFrozen: boolean;
  taskGraphRegistered: boolean;
  taskCounts: Record<TaskLoopState, number>;
  evidenceCount: number;
  gateTotals: {
    passed: number;
    failed: number;
    byType: Partial<Record<GateType, { passed: number; failed: number }>>;
  };
};
