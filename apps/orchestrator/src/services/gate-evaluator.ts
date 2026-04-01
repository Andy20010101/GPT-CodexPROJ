import { randomUUID } from 'node:crypto';

import type {
  ArchitectureFreeze,
  EvidenceManifest,
  GateResult,
  GateType,
  RequirementFreeze,
  TaskEnvelope,
} from '../contracts';
import { GateResultSchema } from '../contracts';
import type { RunRecord } from '../domain/run';

type GateEvaluationInput = {
  run: RunRecord;
  gateType: GateType;
  evaluator: string;
  evidence: EvidenceManifest[];
  requirementFreeze?: RequirementFreeze | null | undefined;
  architectureFreeze?: ArchitectureFreeze | null | undefined;
  task?: TaskEnvelope | null | undefined;
  tasks?: readonly TaskEnvelope[] | undefined;
  metadata?: Record<string, unknown> | undefined;
};

export class GateEvaluator {
  public evaluate(input: GateEvaluationInput): GateResult {
    const reasons: string[] = [];

    switch (input.gateType) {
      case 'requirement_gate': {
        if (!input.requirementFreeze) {
          reasons.push('Requirement freeze is missing.');
        } else {
          if (input.requirementFreeze.objectives.length === 0) {
            reasons.push('Requirement freeze has no objectives.');
          }
          if (input.requirementFreeze.acceptanceCriteria.length === 0) {
            reasons.push('Requirement freeze has no acceptance criteria.');
          }
        }
        break;
      }
      case 'architecture_gate': {
        if (!input.architectureFreeze) {
          reasons.push('Architecture freeze is missing.');
        } else {
          if (input.architectureFreeze.moduleDefinitions.length === 0) {
            reasons.push('Architecture freeze has no module definitions.');
          }
          if (input.architectureFreeze.dependencyRules.length === 0) {
            reasons.push('Architecture freeze has no dependency rules.');
          }
        }
        break;
      }
      case 'red_test_gate': {
        if (!input.task) {
          reasons.push('Task is required for red test gate evaluation.');
        } else {
          if (input.task.testPlan.length === 0) {
            reasons.push('Task does not have a test plan.');
          }
          if (input.task.status !== 'tests_red') {
            reasons.push('Task has not reached tests_red.');
          }
        }
        break;
      }
      case 'review_gate': {
        if (!input.task) {
          reasons.push('Task is required for review gate evaluation.');
        } else {
          const hasReviewEvidence = input.evidence.some(
            (entry) => entry.kind === 'review_note' || entry.kind === 'bridge_structured_review',
          );
          if (input.task.status !== 'review_pending') {
            reasons.push('Task is not waiting for review.');
          }
          if (!hasReviewEvidence) {
            reasons.push('No review evidence is attached to the task.');
          }
        }
        break;
      }
      case 'acceptance_gate': {
        if (input.task) {
          const hasReviewEvidence = input.evidence.some(
            (entry) => entry.kind === 'review_note' || entry.kind === 'bridge_structured_review',
          );
          const hasTestEvidence = input.evidence.some((entry) => entry.kind === 'test_report');
          if (input.task.status !== 'accepted') {
            reasons.push('Task is not accepted yet.');
          }
          if (!hasReviewEvidence) {
            reasons.push('Acceptance requires review evidence.');
          }
          if (!hasTestEvidence) {
            reasons.push('Acceptance requires test evidence.');
          }
        } else {
          const tasks = input.tasks ?? [];
          if (tasks.length === 0) {
            reasons.push('Run has no registered tasks.');
          }
          if (tasks.some((task) => task.status !== 'accepted')) {
            reasons.push('All tasks must be accepted before the run can be accepted.');
          }
        }
        break;
      }
    }

    return GateResultSchema.parse({
      gateId: randomUUID(),
      runId: input.run.runId,
      ...(input.task ? { taskId: input.task.taskId } : {}),
      gateType: input.gateType,
      stage: input.run.stage,
      passed: reasons.length === 0,
      timestamp: new Date().toISOString(),
      evaluator: input.evaluator,
      reasons,
      evidenceIds: input.evidence.map((entry) => entry.evidenceId),
      metadata: input.metadata ?? {},
    });
  }
}
