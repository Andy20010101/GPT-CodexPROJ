import { randomUUID } from 'node:crypto';

import type { FailureRecord, FailureToTask, StabilityIncident } from '../contracts';
import { FailureToTaskSchema } from '../contracts';

import { RemediationPlaybookService } from './remediation-playbook-service';

export class FailureToTaskService {
  public constructor(private readonly remediationPlaybookService: RemediationPlaybookService) {}

  public propose(input: {
    runId: string;
    taskId?: string | undefined;
    failure?: FailureRecord | null | undefined;
    incident?: StabilityIncident | null | undefined;
    findings?: readonly string[] | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): FailureToTask {
    const playbook = this.remediationPlaybookService.match(input);
    const titleSource = input.incident?.summary ?? input.failure?.message ?? 'runtime remediation';

    return FailureToTaskSchema.parse({
      proposalId: randomUUID(),
      runId: input.runId,
      ...(input.taskId ? { taskId: input.taskId } : {}),
      ...(input.failure ? { sourceFailureId: input.failure.failureId } : {}),
      ...(input.incident ? { sourceIncidentId: input.incident.incidentId } : {}),
      suggestedTaskTitle: `[Remediation] ${playbook.title}`,
      objective: `Address ${titleSource}. Follow the ${playbook.title.toLowerCase()} playbook.`,
      riskLevel: playbook.riskLevel,
      allowedFiles: playbook.defaultAllowedFiles,
      requiredEvidenceKinds: playbook.requiredEvidenceKinds,
      recommendedPlaybook: playbook.category,
      metadata: input.metadata ?? {},
      createdAt: new Date().toISOString(),
    });
  }
}
