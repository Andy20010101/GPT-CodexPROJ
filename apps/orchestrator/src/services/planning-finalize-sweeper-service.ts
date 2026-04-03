import { randomUUID } from 'node:crypto';

import type {
  EvidenceManifest,
  PlanningFinalizeSweepSummary,
  PlanningPendingEntry,
  PlanningPendingStatus,
  PlanningPhase,
} from '../contracts';
import {
  PlanningFinalizeSweepSummarySchema,
  PlanningPendingEntrySchema,
} from '../contracts';
import { OrchestratorService } from '../application/orchestrator-service';
import { FilePlanningRepository } from '../storage/file-planning-repository';
import { FileRunRepository } from '../storage/file-run-repository';
import { writeJsonFile } from '../utils/file-store';
import {
  getPlanningFinalizeRuntimeStateFile,
  getPlanningMaterializedResultFile,
  getPlanningRecoverySummaryFile,
  getPlanningRequestFile,
  getPlanningRequestRuntimeStateFile,
} from '../utils/run-paths';
import { EvidenceLedgerService } from './evidence-ledger-service';

const PLANNING_PHASES: PlanningPhase[] = [
  'requirement_freeze',
  'architecture_freeze',
  'task_graph_generation',
];

export class PlanningFinalizeSweeperService {
  public constructor(
    private readonly runRepository: FileRunRepository,
    private readonly planningRepository: FilePlanningRepository,
    private readonly orchestratorService: OrchestratorService,
    private readonly evidenceLedgerService: EvidenceLedgerService,
  ) {}

  public async listPending(runId?: string | undefined): Promise<PlanningPendingEntry[]> {
    const runs = runId
      ? [await this.runRepository.getRun(runId)]
      : await this.runRepository.listRuns();
    const entries: PlanningPendingEntry[] = [];

    for (const run of runs) {
      for (const phase of PLANNING_PHASES) {
        const request = await this.planningRepository.getRequest(run.runId, phase);
        if (!request) {
          continue;
        }
        const requestState = await this.planningRepository.getRequestRuntimeState(run.runId, phase);
        if (!requestState?.conversationId) {
          continue;
        }
        const finalizeState = await this.planningRepository.getFinalizeRuntimeState(run.runId, phase);
        const materializedResult = await this.planningRepository.getMaterializedResult(run.runId, phase);
        if (materializedResult || finalizeState?.status === 'planning_applied') {
          continue;
        }
        const status = resolvePendingStatus(phase, finalizeState?.lastErrorCode, requestState.status);
        if (!status) {
          continue;
        }
        entries.push(
          PlanningPendingEntrySchema.parse({
            runId: run.runId,
            planningId: request.planningId,
            phase,
            status,
            conversationId: requestState.conversationId,
            conversationUrl: requestState.conversationUrl,
            requestRuntimeStatePath: getPlanningRequestRuntimeStateFile(
              this.planningRepository.getArtifactDir(),
              run.runId,
              phase,
            ),
            finalizeRuntimeStatePath: finalizeState
              ? getPlanningFinalizeRuntimeStateFile(
                  this.planningRepository.getArtifactDir(),
                  run.runId,
                  phase,
                )
              : undefined,
            requestPath: getPlanningRequestFile(this.planningRepository.getArtifactDir(), run.runId, phase),
            materializedResultPath: materializedResult
              ? getPlanningMaterializedResultFile(
                  this.planningRepository.getArtifactDir(),
                  run.runId,
                  phase,
                )
              : undefined,
            lastErrorCode: finalizeState?.lastErrorCode,
            lastErrorMessage: finalizeState?.lastErrorMessage,
            updatedAt: finalizeState?.updatedAt ?? requestState.updatedAt,
          }),
        );
      }
    }

    return entries;
  }

  public async run(input: {
    runId?: string | undefined;
    requestedBy: string;
  }): Promise<PlanningFinalizeSweepSummary> {
    const startedAt = new Date().toISOString();
    const pendingEntries = await this.listPending(input.runId);
    const affectedRunIds = [...new Set(pendingEntries.map((entry) => entry.runId))];
    const failures: PlanningFinalizeSweepSummary['failures'] = [];
    let recoveredCount = 0;
    let materializedCount = 0;
    let stillPendingCount = 0;

    for (const entry of pendingEntries) {
      try {
        const result = await this.finalizeEntry(entry);
        if (result.status === 'completed') {
          recoveredCount += 1;
          materializedCount += 1;
        } else {
          stillPendingCount += 1;
        }
      } catch (error) {
        stillPendingCount += 1;
        failures.push({
          runId: entry.runId,
          planningId: entry.planningId,
          phase: entry.phase,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const summary = PlanningFinalizeSweepSummarySchema.parse({
      sweepId: randomUUID(),
      requestedBy: input.requestedBy,
      startedAt,
      completedAt: new Date().toISOString(),
      runsScanned: input.runId ? 1 : (await this.runRepository.listRuns()).length,
      pendingCount: pendingEntries.length,
      recoveredCount,
      materializedCount,
      stillPendingCount,
      failures,
      entries: pendingEntries,
    });

    for (const runId of affectedRunIds) {
      await this.writeRunSummary(runId, summary);
    }

    return summary;
  }

  private async finalizeEntry(entry: PlanningPendingEntry) {
    switch (entry.phase) {
      case 'requirement_freeze':
        return this.orchestratorService.finalizeRequirementFreeze({
          runId: entry.runId,
          producer: 'planning-finalize-sweeper-service',
          metadata: {
            recoveredFromConversationId: entry.conversationId,
            recoveredFromConversationUrl: entry.conversationUrl,
          },
        });
      case 'architecture_freeze':
        return this.orchestratorService.finalizeArchitectureFreeze({
          runId: entry.runId,
          producer: 'planning-finalize-sweeper-service',
          metadata: {
            recoveredFromConversationId: entry.conversationId,
            recoveredFromConversationUrl: entry.conversationUrl,
          },
        });
      case 'task_graph_generation':
        return this.orchestratorService.finalizeTaskGraphGeneration({
          runId: entry.runId,
          producer: 'planning-finalize-sweeper-service',
          metadata: {
            recoveredFromConversationId: entry.conversationId,
            recoveredFromConversationUrl: entry.conversationUrl,
          },
        });
    }
  }

  private async writeRunSummary(
    runId: string,
    summary: PlanningFinalizeSweepSummary,
  ): Promise<EvidenceManifest> {
    const run = await this.runRepository.getRun(runId);
    const outputPath = getPlanningRecoverySummaryFile(this.planningRepository.getArtifactDir(), runId);
    await writeJsonFile(outputPath, {
      ...summary,
      entries: summary.entries.filter((entry) => entry.runId === runId),
    });
    return this.evidenceLedgerService.appendEvidence({
      runId,
      stage: run.stage,
      kind: 'planning_finalize_recovery',
      timestamp: summary.completedAt,
      producer: 'planning-finalize-sweeper-service',
      artifactPaths: [outputPath],
      summary: `Planning finalize sweeper processed ${runId}`,
      metadata: {
        sweepId: summary.sweepId,
        recoveredCount: summary.recoveredCount,
        materializedCount: summary.materializedCount,
        stillPendingCount: summary.stillPendingCount,
      },
    });
  }
}

function resolvePendingStatus(
  phase: PlanningPhase,
  lastErrorCode: string | undefined,
  requestStatus: string,
): PlanningPendingStatus | null {
  if (lastErrorCode === 'PLANNING_MATERIALIZATION_PENDING') {
    return suffixStatus(phase, 'materialization_pending');
  }
  if (
    lastErrorCode === 'PLANNING_FINALIZE_RETRYABLE' ||
    requestStatus === 'planning_waiting' ||
    requestStatus === 'planning_requested'
  ) {
    return suffixStatus(phase, 'finalize_retryable');
  }
  return null;
}

function suffixStatus(
  phase: PlanningPhase,
  suffix: 'finalize_retryable' | 'materialization_pending',
): PlanningPendingStatus {
  switch (phase) {
    case 'requirement_freeze':
      return `requirement_${suffix}`;
    case 'architecture_freeze':
      return `architecture_${suffix}`;
    case 'task_graph_generation':
      return `task_graph_${suffix}`;
  }
}
