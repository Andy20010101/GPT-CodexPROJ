import type { JobRecord, StabilityIncident, StabilityReport } from '../contracts';
import { StabilityIncidentSchema, StabilityReportSchema } from '../contracts';
import { FileDebugSnapshotRepository } from '../storage/file-debug-snapshot-repository';
import { FileFailureRepository } from '../storage/file-failure-repository';
import { FileJobRepository } from '../storage/file-job-repository';
import { FileRemediationRepository } from '../storage/file-remediation-repository';
import { FileRollbackRepository } from '../storage/file-rollback-repository';
import { FileRunRepository } from '../storage/file-run-repository';
import { FileStabilityRepository } from '../storage/file-stability-repository';
import { FileWorkspaceLifecycleRepository } from '../storage/file-workspace-lifecycle-repository';
import { EvidenceLedgerService } from './evidence-ledger-service';

export class StabilityGovernanceService {
  public constructor(
    private readonly runRepository: FileRunRepository,
    private readonly jobRepository: FileJobRepository,
    private readonly failureRepository: FileFailureRepository,
    private readonly rollbackRepository: FileRollbackRepository,
    private readonly snapshotRepository: FileDebugSnapshotRepository,
    private readonly remediationRepository: FileRemediationRepository,
    private readonly stabilityRepository: FileStabilityRepository,
    private readonly workspaceLifecycleRepository: FileWorkspaceLifecycleRepository,
    private readonly evidenceLedgerService: EvidenceLedgerService,
  ) {}

  public async recordIncident(input: StabilityIncident): Promise<StabilityIncident> {
    const incident = StabilityIncidentSchema.parse(input);
    const paths = await this.stabilityRepository.saveIncident(incident);
    if (incident.runId) {
      const run = await this.runRepository.getRun(incident.runId);
      await this.evidenceLedgerService.appendEvidence({
        runId: incident.runId,
        ...(incident.taskId ? { taskId: incident.taskId } : {}),
        stage: run.stage,
        kind: incident.source === 'bridge' ? 'bridge_drift_incident' : 'failure_record',
        timestamp: incident.occurredAt,
        producer: 'stability-governance-service',
        artifactPaths: [paths.runPath ?? paths.globalPath],
        summary: incident.summary,
        metadata: {
          incidentId: incident.incidentId,
          category: incident.category,
          status: incident.status,
        },
      });
    }
    return incident;
  }

  public async listIncidents(runId?: string | undefined): Promise<StabilityIncident[]> {
    return this.stabilityRepository.listIncidents(runId);
  }

  public async generateReport(): Promise<StabilityReport> {
    const [runs, failures, rollbacks, snapshots, remediations, incidents] = await Promise.all([
      this.runRepository.listRuns(),
      this.failureRepository.listFailures(),
      this.rollbackRepository.listRecords(),
      this.snapshotRepository.listSnapshots(),
      this.remediationRepository.listResults(),
      this.stabilityRepository.listIncidents(),
    ]);

    const jobs = (
      await Promise.all(runs.map(async (run) => this.jobRepository.listJobsForRun(run.runId)))
    ).flat();
    const lifecycles = (
      await Promise.all(
        runs.map(async (run) => this.workspaceLifecycleRepository.listForRun(run.runId)),
      )
    ).flat();

    const tasksByRun = new Map<string, JobRecord[]>();
    for (const job of jobs.filter((entry) => entry.taskId)) {
      const taskJobs = tasksByRun.get(job.taskId as string) ?? [];
      taskJobs.push(job);
      tasksByRun.set(job.taskId as string, taskJobs);
    }

    const report = StabilityReportSchema.parse({
      generatedAt: new Date().toISOString(),
      recurringIncidentCategories: summarizeIncidents(incidents),
      meanAttemptsPerTask:
        tasksByRun.size === 0
          ? 0
          : [...tasksByRun.values()].reduce(
              (sum, taskJobs) => sum + Math.max(...taskJobs.map((entry) => entry.attempt)),
              0,
            ) / tasksByRun.size,
      rollbackCount: rollbacks.length,
      retainedWorkspaceCount: lifecycles.filter((entry) => entry.status === 'retained').length,
      unresolvedDriftIncidents: incidents.filter(
        (entry) => entry.category.includes('drift') && entry.status !== 'resolved',
      ).length,
      manualAttentionBacklog: jobs.filter((entry) => entry.status === 'manual_attention_required')
        .length,
      recommendedRemediationPaths: [
        ...new Set(remediations.map((entry) => entry.category).filter((entry) => entry.length > 0)),
      ],
      metadata: {
        failureCount: failures.length,
        snapshotCount: snapshots.length,
      },
    });

    const artifactPath = await this.stabilityRepository.saveStabilityReport(report);
    for (const run of runs) {
      await this.evidenceLedgerService.appendEvidence({
        runId: run.runId,
        stage: run.stage,
        kind: 'stability_report',
        timestamp: report.generatedAt,
        producer: 'stability-governance-service',
        artifactPaths: [artifactPath],
        summary: 'Generated runtime stability governance report.',
        metadata: {
          rollbackCount: report.rollbackCount,
          manualAttentionBacklog: report.manualAttentionBacklog,
        },
      });
    }
    return report;
  }

  public async getLatestReport(): Promise<StabilityReport | null> {
    return this.stabilityRepository.getStabilityReport();
  }
}

function summarizeIncidents(
  incidents: readonly StabilityIncident[],
): StabilityReport['recurringIncidentCategories'] {
  const counts = new Map<string, number>();
  for (const incident of incidents) {
    counts.set(incident.category, (counts.get(incident.category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([category, count]) => ({
      category,
      count,
    }));
}
