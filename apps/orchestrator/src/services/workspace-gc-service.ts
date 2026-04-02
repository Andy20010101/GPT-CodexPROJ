import { randomUUID } from 'node:crypto';

import type { WorkspaceGcSummary } from '../contracts';
import { WorkspaceGcSummarySchema } from '../contracts';
import { FileWorkspaceLifecycleRepository } from '../storage/file-workspace-lifecycle-repository';
import { FileWorkspaceRepository } from '../storage/file-workspace-repository';
import { FileRunRepository } from '../storage/file-run-repository';
import { isWorkspaceExpired } from '../utils/workspace-retention';
import { EvidenceLedgerService } from './evidence-ledger-service';
import { WorkspaceCleanupService } from './workspace-cleanup-service';

export class WorkspaceGcService {
  public constructor(
    private readonly runRepository: FileRunRepository,
    private readonly workspaceRepository: FileWorkspaceRepository,
    private readonly lifecycleRepository: FileWorkspaceLifecycleRepository,
    private readonly cleanupService: WorkspaceCleanupService,
    private readonly evidenceLedgerService: EvidenceLedgerService,
  ) {}

  public async runGc(now: Date = new Date()): Promise<WorkspaceGcSummary> {
    const startedAt = new Date().toISOString();
    const lifecycles = await this.lifecycleRepository.listAll();
    let cleaned = 0;
    let retained = 0;
    let failed = 0;

    for (const lifecycle of lifecycles) {
      if (!isWorkspaceExpired(lifecycle, now)) {
        continue;
      }
      const workspace = await this.workspaceRepository.getWorkspace(
        lifecycle.runId,
        lifecycle.workspaceId,
      );
      const result = await this.cleanupService.cleanupWorkspace({
        lifecycle,
        workspace,
        reason: 'Workspace GC cleaned an expired workspace.',
      });
      if (result.status === 'completed') {
        cleaned += 1;
      } else {
        failed += 1;
      }
      if (result.action === 'retain') {
        retained += 1;
      }
    }

    const summary = WorkspaceGcSummarySchema.parse({
      gcRunId: randomUUID(),
      startedAt,
      finishedAt: new Date().toISOString(),
      scanned: lifecycles.length,
      cleaned,
      retained,
      failed,
      metadata: {},
    });
    const artifactPath = await this.lifecycleRepository.saveGcSummary(summary);
    const runs = await this.runRepository.listRuns();
    for (const run of runs.filter((entry) => entry.stage !== 'accepted')) {
      await this.evidenceLedgerService.appendEvidence({
        runId: run.runId,
        stage: run.stage,
        kind: 'workspace_gc',
        timestamp: summary.finishedAt,
        producer: 'workspace-gc-service',
        artifactPaths: [artifactPath],
        summary: `Workspace GC scanned ${summary.scanned} workspace(s).`,
        metadata: {
          gcRunId: summary.gcRunId,
          cleaned: summary.cleaned,
          retained: summary.retained,
          failed: summary.failed,
        },
      });
    }
    return summary;
  }
}
