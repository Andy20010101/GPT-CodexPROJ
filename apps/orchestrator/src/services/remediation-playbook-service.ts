import type { FailureRecord, RemediationPlaybook, StabilityIncident } from '../contracts';

import { RemediationPlaybookSchema } from '../contracts';

const DEFAULT_PLAYBOOKS: readonly RemediationPlaybook[] = [
  {
    playbookId: 'bridge-drift-recovery',
    category: 'bridge_drift_recovery',
    title: 'Bridge drift recovery',
    description:
      'Investigate selector drift, resume the browser session, and restore bridge health.',
    riskLevel: 'low',
    defaultAllowedFiles: [
      'services/chatgpt-web-bridge/src/dom/**',
      'services/chatgpt-web-bridge/src/guards/**',
      'services/chatgpt-web-bridge/src/services/**',
    ],
    requiredEvidenceKinds: ['bridge_health', 'bridge_drift_incident'],
    autoExecutable: true,
  },
  {
    playbookId: 'runner-timeout-recovery',
    category: 'runner_timeout_recovery',
    title: 'Runner timeout recovery',
    description: 'Assess timeout causes, retained workspace state, and retry or resume options.',
    riskLevel: 'medium',
    defaultAllowedFiles: [
      'apps/orchestrator/src/services/**',
      'apps/orchestrator/src/contracts/**',
      'apps/orchestrator/src/utils/**',
    ],
    requiredEvidenceKinds: ['runner_resume_state', 'failure_record'],
    autoExecutable: false,
  },
  {
    playbookId: 'workspace-cleanup-repair',
    category: 'workspace_cleanup_repair',
    title: 'Workspace cleanup repair',
    description: 'Repair stale workspace cleanup and retention policy issues.',
    riskLevel: 'low',
    defaultAllowedFiles: [
      'apps/orchestrator/src/services/workspace-*.ts',
      'apps/orchestrator/src/contracts/cleanup-policy.ts',
    ],
    requiredEvidenceKinds: ['workspace_cleanup', 'workspace_gc'],
    autoExecutable: true,
  },
  {
    playbookId: 'evidence-gap-repair',
    category: 'evidence_gap_repair',
    title: 'Evidence gap repair',
    description:
      'Repair missing evidence or artifact references without changing control-plane rules.',
    riskLevel: 'low',
    defaultAllowedFiles: [
      'apps/orchestrator/src/services/**',
      'apps/orchestrator/src/storage/**',
      'apps/orchestrator/src/utils/**',
    ],
    requiredEvidenceKinds: ['debug_snapshot', 'failure_record'],
    autoExecutable: true,
  },
  {
    playbookId: 'prompt-template-repair',
    category: 'prompt_template_repair',
    title: 'Prompt template repair',
    description: 'Strengthen prompt templates and structured output instructions.',
    riskLevel: 'low',
    defaultAllowedFiles: [
      'apps/orchestrator/src/services/*review*.ts',
      'apps/orchestrator/src/services/*payload*.ts',
    ],
    requiredEvidenceKinds: ['review_request', 'bridge_structured_review'],
    autoExecutable: true,
  },
  {
    playbookId: 'selector-update-review',
    category: 'selector_update_review',
    title: 'Selector update review',
    description: 'Review and update ChatGPT DOM selectors or fallbacks.',
    riskLevel: 'medium',
    defaultAllowedFiles: [
      'services/chatgpt-web-bridge/src/dom/**',
      'services/chatgpt-web-bridge/src/guards/**',
      'services/chatgpt-web-bridge/src/adapters/**',
    ],
    requiredEvidenceKinds: ['bridge_drift_incident'],
    autoExecutable: false,
  },
  {
    playbookId: 'retry-policy-tuning',
    category: 'retry_policy_tuning',
    title: 'Retry policy tuning',
    description:
      'Adjust runtime retry policy or timeout configuration for repeated transient failures.',
    riskLevel: 'medium',
    defaultAllowedFiles: [
      'apps/orchestrator/src/config/**',
      'apps/orchestrator/src/services/retry-service.ts',
      'apps/orchestrator/src/services/runner-lifecycle-service.ts',
    ],
    requiredEvidenceKinds: ['failure_record', 'runtime_metrics'],
    autoExecutable: false,
  },
  {
    playbookId: 'manual-attention',
    category: 'manual_attention',
    title: 'Manual attention required',
    description: 'Escalate to a human because the issue is outside low-risk automated remediation.',
    riskLevel: 'high',
    defaultAllowedFiles: [],
    requiredEvidenceKinds: ['failure_record'],
    autoExecutable: false,
  },
] as const;

export class RemediationPlaybookService {
  private readonly playbooks = DEFAULT_PLAYBOOKS.map((entry) =>
    RemediationPlaybookSchema.parse(entry),
  );

  public listPlaybooks(): RemediationPlaybook[] {
    return [...this.playbooks];
  }

  public getPlaybook(playbookId: string): RemediationPlaybook | null {
    return this.playbooks.find((entry) => entry.playbookId === playbookId) ?? null;
  }

  public match(input: {
    failure?: FailureRecord | null | undefined;
    incident?: StabilityIncident | null | undefined;
    findings?: readonly string[] | undefined;
  }): RemediationPlaybook {
    if (input.incident?.category.includes('drift')) {
      return this.requireCategory('bridge_drift_recovery');
    }

    if (input.failure?.taxonomy === 'timeout') {
      return this.requireCategory('runner_timeout_recovery');
    }

    if (
      input.failure?.code.includes('WORKSPACE') ||
      input.incident?.category.includes('cleanup') ||
      input.incident?.source === 'workspace'
    ) {
      return this.requireCategory('workspace_cleanup_repair');
    }

    if (input.failure?.taxonomy === 'drift') {
      return this.requireCategory('selector_update_review');
    }

    if (input.failure?.code.includes('STRUCTURED_OUTPUT') || input.findings?.length) {
      return this.requireCategory('prompt_template_repair');
    }

    if (input.failure?.code.includes('EVIDENCE') || input.incident?.category.includes('evidence')) {
      return this.requireCategory('evidence_gap_repair');
    }

    if (input.failure?.taxonomy === 'transient' || input.failure?.taxonomy === 'runner') {
      return this.requireCategory('retry_policy_tuning');
    }

    return this.requireCategory('manual_attention');
  }

  private requireCategory(category: RemediationPlaybook['category']): RemediationPlaybook {
    const playbook = this.playbooks.find((entry) => entry.category === category);
    if (!playbook) {
      throw new Error(`Playbook ${category} is not configured.`);
    }
    return playbook;
  }
}
