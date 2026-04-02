import { randomUUID } from 'node:crypto';

import type {
  FailureToTask,
  RemediationPlaybook,
  SelfRepairPolicy,
  SelfRepairPolicyDecisionRecord,
} from '../contracts';
import { SelfRepairPolicyDecisionRecordSchema, SelfRepairPolicySchema } from '../contracts';

const DEFAULT_PROHIBITED_PATTERNS = [
  'apps/orchestrator/src/domain/stage.ts',
  'apps/orchestrator/src/services/gate-evaluator.ts',
  'apps/orchestrator/src/services/run-acceptance-service.ts',
  'apps/orchestrator/src/contracts/evidence-manifest.ts',
  'apps/orchestrator/src/contracts/task-graph.ts',
];

export class SelfRepairPolicyService {
  private readonly policy: SelfRepairPolicy;

  public constructor(policy?: Partial<SelfRepairPolicy> | undefined) {
    this.policy = SelfRepairPolicySchema.parse({
      autoAllowedCategories: [
        'bridge_drift_recovery',
        'evidence_gap_repair',
        'prompt_template_repair',
        'workspace_cleanup_repair',
        ...(policy?.autoAllowedCategories ?? []),
      ],
      reviewRequiredCategories: [
        'runner_timeout_recovery',
        'selector_update_review',
        'retry_policy_tuning',
        ...(policy?.reviewRequiredCategories ?? []),
      ],
      manualOnlyCategories: ['manual_attention', ...(policy?.manualOnlyCategories ?? [])],
      prohibitedPathPatterns: [
        ...DEFAULT_PROHIBITED_PATTERNS,
        ...(policy?.prohibitedPathPatterns ?? []),
      ],
    });
  }

  public getPolicy(): SelfRepairPolicy {
    return this.policy;
  }

  public decide(input: {
    runId: string;
    taskId?: string | undefined;
    playbook: RemediationPlaybook;
    proposal?: FailureToTask | undefined;
    targetPaths?: readonly string[] | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): SelfRepairPolicyDecisionRecord {
    const targetPaths = [...(input.targetPaths ?? input.proposal?.allowedFiles ?? [])];
    const prohibited = targetPaths.find((target) =>
      this.policy.prohibitedPathPatterns.some((pattern) => target.includes(pattern)),
    );

    const decision =
      prohibited || this.policy.manualOnlyCategories.includes(input.playbook.category)
        ? 'manual_only'
        : this.policy.autoAllowedCategories.includes(input.playbook.category)
          ? 'auto_allowed'
          : this.policy.reviewRequiredCategories.includes(input.playbook.category)
            ? 'review_required'
            : 'manual_only';

    return SelfRepairPolicyDecisionRecordSchema.parse({
      decisionId: randomUUID(),
      runId: input.runId,
      ...(input.taskId ? { taskId: input.taskId } : {}),
      category: input.playbook.category,
      decision,
      reason: prohibited
        ? `Target path ${prohibited} is prohibited for automatic self-repair.`
        : `Category ${input.playbook.category} maps to ${decision}.`,
      targetPaths,
      decidedAt: new Date().toISOString(),
      metadata: input.metadata ?? {},
    });
  }
}
