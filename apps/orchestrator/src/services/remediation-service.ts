import { randomUUID } from 'node:crypto';

import type {
  FailureRecord,
  RemediationAction,
  RemediationResult,
  StabilityIncident,
} from '../contracts';
import { RemediationResultSchema, type SelfRepairPolicyDecisionRecord } from '../contracts';
import { FileRemediationRepository } from '../storage/file-remediation-repository';
import { FileRunRepository } from '../storage/file-run-repository';
import { normalizeRemediationActions } from '../utils/remediation-action-normalizer';
import { EvidenceLedgerService } from './evidence-ledger-service';
import { FailureToTaskService } from './failure-to-task-service';
import { RemediationPlaybookService } from './remediation-playbook-service';
import { SelfRepairPolicyService } from './self-repair-policy-service';
import { WorkspaceGcService } from './workspace-gc-service';

export class RemediationService {
  public constructor(
    private readonly runRepository: FileRunRepository,
    private readonly remediationRepository: FileRemediationRepository,
    private readonly evidenceLedgerService: EvidenceLedgerService,
    private readonly playbookService: RemediationPlaybookService,
    private readonly failureToTaskService: FailureToTaskService,
    private readonly selfRepairPolicyService: SelfRepairPolicyService,
    private readonly workspaceGcService: WorkspaceGcService,
  ) {}

  public async listResults(runId?: string | undefined): Promise<RemediationResult[]> {
    return this.remediationRepository.listResults(runId);
  }

  public async propose(input: {
    runId: string;
    taskId?: string | undefined;
    jobId?: string | undefined;
    failure?: FailureRecord | null | undefined;
    incident?: StabilityIncident | null | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<RemediationResult> {
    const playbook = this.playbookService.match(input);
    const proposal = this.failureToTaskService.propose(input);
    const decision = this.selfRepairPolicyService.decide({
      runId: input.runId,
      taskId: input.taskId,
      playbook,
      proposal,
    });

    const result = await this.persistResult({
      remediationId: randomUUID(),
      runId: input.runId,
      taskId: input.taskId,
      jobId: input.jobId,
      failureId: input.failure?.failureId,
      incidentId: input.incident?.incidentId,
      playbookId: playbook.playbookId,
      category: playbook.category,
      status:
        decision.decision === 'auto_allowed'
          ? 'proposed'
          : decision.decision === 'review_required'
            ? 'review_required'
            : 'manual_only',
      policyDecision: decision.decision,
      summary: proposal.objective,
      proposal,
      actions: [],
      artifactPaths: [],
      metadata: {
        policyDecisionId: decision.decisionId,
        ...(input.metadata ?? {}),
      },
      timestamp: new Date().toISOString(),
    });
    await this.appendPolicyEvidence(decision, result);
    return result;
  }

  public async execute(input: {
    remediationId: string;
    requestedBy: string;
  }): Promise<RemediationResult> {
    const current = await this.remediationRepository.getResult(input.remediationId);
    if (!current) {
      throw new Error(`Remediation ${input.remediationId} was not found.`);
    }

    const actions = await this.buildActions(current, input.requestedBy);
    const next = await this.persistResult({
      ...current,
      status:
        current.policyDecision === 'auto_allowed'
          ? 'executed'
          : current.policyDecision === 'review_required'
            ? 'review_required'
            : 'manual_only',
      actions: [...actions],
      metadata: {
        ...current.metadata,
        executedBy: input.requestedBy,
      },
      timestamp: new Date().toISOString(),
    });
    await this.appendExecutionEvidence(next);
    return next;
  }

  private async buildActions(
    remediation: RemediationResult,
    requestedBy: string,
  ): Promise<readonly RemediationAction[]> {
    if (remediation.policyDecision !== 'auto_allowed') {
      return normalizeRemediationActions([
        {
          actionId: randomUUID(),
          remediationId: remediation.remediationId,
          kind: 'manual_attention',
          status: 'skipped',
          summary: `Remediation requires ${remediation.policyDecision}.`,
          artifactPaths: [],
          metadata: {
            requestedBy,
          },
        },
      ]);
    }

    if (remediation.category === 'workspace_cleanup_repair') {
      const summary = await this.workspaceGcService.runGc();
      return normalizeRemediationActions([
        {
          actionId: randomUUID(),
          remediationId: remediation.remediationId,
          kind: 'trigger_workspace_gc',
          status: 'executed',
          summary: `Triggered workspace GC ${summary.gcRunId}.`,
          artifactPaths: [],
          metadata: {
            gcRunId: summary.gcRunId,
            requestedBy,
          },
        },
      ]);
    }

    if (remediation.category === 'evidence_gap_repair') {
      return normalizeRemediationActions([
        {
          actionId: randomUUID(),
          remediationId: remediation.remediationId,
          kind: 'capture_debug_snapshot',
          status: 'executed',
          summary: 'Flagged a controlled debug snapshot remediation action.',
          artifactPaths: [],
          metadata: {
            requestedBy,
          },
        },
      ]);
    }

    return normalizeRemediationActions([
      {
        actionId: randomUUID(),
        remediationId: remediation.remediationId,
        kind: 'propose_remediation_task',
        status: 'executed',
        summary: 'Generated a controlled remediation task proposal.',
        artifactPaths: [],
        metadata: {
          requestedBy,
        },
      },
    ]);
  }

  private async persistResult(input: RemediationResult): Promise<RemediationResult> {
    const parsed = RemediationResultSchema.parse(input);
    const paths = await this.remediationRepository.saveResult(parsed);
    return {
      ...parsed,
      artifactPaths: [paths.globalPath, paths.runPath],
    };
  }

  private async appendPolicyEvidence(
    decision: SelfRepairPolicyDecisionRecord,
    result: RemediationResult,
  ): Promise<void> {
    const run = await this.runRepository.getRun(result.runId);
    await this.evidenceLedgerService.appendEvidence({
      runId: result.runId,
      ...(result.taskId ? { taskId: result.taskId } : {}),
      stage: run.stage,
      kind: 'self_repair_policy_decision',
      timestamp: decision.decidedAt,
      producer: 'remediation-service',
      artifactPaths: result.artifactPaths,
      summary: decision.reason,
      metadata: {
        remediationId: result.remediationId,
        decision: decision.decision,
      },
    });
    await this.evidenceLedgerService.appendEvidence({
      runId: result.runId,
      ...(result.taskId ? { taskId: result.taskId } : {}),
      stage: run.stage,
      kind: 'remediation_proposal',
      timestamp: result.timestamp,
      producer: 'remediation-service',
      artifactPaths: result.artifactPaths,
      summary: result.summary,
      metadata: {
        remediationId: result.remediationId,
        category: result.category,
      },
    });
  }

  private async appendExecutionEvidence(result: RemediationResult): Promise<void> {
    const run = await this.runRepository.getRun(result.runId);
    await this.evidenceLedgerService.appendEvidence({
      runId: result.runId,
      ...(result.taskId ? { taskId: result.taskId } : {}),
      stage: run.stage,
      kind: 'remediation_result',
      timestamp: result.timestamp,
      producer: 'remediation-service',
      artifactPaths: result.artifactPaths,
      summary: result.summary,
      metadata: {
        remediationId: result.remediationId,
        status: result.status,
        actionCount: result.actions.length,
      },
    });
  }
}
