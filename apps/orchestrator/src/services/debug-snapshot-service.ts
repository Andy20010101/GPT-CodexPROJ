import { randomUUID } from 'node:crypto';

import type {
  CleanupPolicy,
  DebugSnapshot,
  ExecutionResult,
  FailureRecord,
  WorkspaceRuntime,
} from '../contracts';
import { DebugSnapshotSchema } from '../contracts';
import { FileDebugSnapshotRepository } from '../storage/file-debug-snapshot-repository';
import { summarizeDiff } from '../utils/diff-summary';
import { computeSnapshotRetention } from '../utils/snapshot-retention';
import { FileRunRepository } from '../storage/file-run-repository';
import { EvidenceLedgerService } from './evidence-ledger-service';

export class DebugSnapshotService {
  public constructor(
    private readonly runRepository: FileRunRepository,
    private readonly snapshotRepository: FileDebugSnapshotRepository,
    private readonly evidenceLedgerService: EvidenceLedgerService,
    private readonly defaultCleanupPolicy: CleanupPolicy,
  ) {}

  public async capture(input: {
    runId: string;
    taskId?: string | undefined;
    executionResult?: ExecutionResult | undefined;
    workspace?: WorkspaceRuntime | undefined;
    failure?: FailureRecord | undefined;
    reason: string;
    logPaths?: readonly string[] | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<DebugSnapshot> {
    const createdAt = new Date().toISOString();
    const snapshot = DebugSnapshotSchema.parse({
      snapshotId: randomUUID(),
      runId: input.runId,
      ...(input.taskId ? { taskId: input.taskId } : {}),
      ...(input.executionResult ? { executionId: input.executionResult.executionId } : {}),
      ...(input.workspace ? { workspaceId: input.workspace.workspaceId } : {}),
      reason: input.reason,
      ...(input.failure ? { failureCategory: input.failure.taxonomy } : {}),
      diffSummary: summarizeDiff({
        executionResult: input.executionResult,
      }),
      testSummary: summarizeTests(input.executionResult),
      logPaths: [...(input.logPaths ?? [])],
      createdAt,
      retentionExpiresAt: computeSnapshotRetention({
        createdAt,
        policy: this.defaultCleanupPolicy,
        failureCategory: input.failure?.taxonomy,
      }),
      metadata: {
        ...(input.executionResult ? { executionId: input.executionResult.executionId } : {}),
        ...(input.workspace ? { workspacePath: input.workspace.workspacePath } : {}),
        ...(input.metadata ?? {}),
      },
    });
    const paths = await this.snapshotRepository.saveSnapshot(snapshot);
    const run = await this.runRepository.getRun(snapshot.runId);
    await this.evidenceLedgerService.appendEvidence({
      runId: snapshot.runId,
      ...(snapshot.taskId ? { taskId: snapshot.taskId } : {}),
      stage: run.stage,
      kind: 'debug_snapshot',
      timestamp: snapshot.createdAt,
      producer: 'debug-snapshot-service',
      artifactPaths: [paths.globalPath, paths.runPath],
      summary: snapshot.reason,
      metadata: {
        snapshotId: snapshot.snapshotId,
        ...(snapshot.failureCategory ? { failureCategory: snapshot.failureCategory } : {}),
      },
    });
    return snapshot;
  }

  public async listSnapshots(runId?: string | undefined): Promise<DebugSnapshot[]> {
    return this.snapshotRepository.listSnapshots(runId);
  }
}

function summarizeTests(
  executionResult: ExecutionResult | undefined,
): DebugSnapshot['testSummary'] {
  if (!executionResult) {
    return {
      passed: 0,
      failed: 0,
      skipped: 0,
      suites: [],
      summary: 'No test results were recorded.',
    };
  }

  return {
    passed: executionResult.testResults.reduce((sum, entry) => sum + entry.passed, 0),
    failed: executionResult.testResults.reduce((sum, entry) => sum + entry.failed, 0),
    skipped: executionResult.testResults.reduce((sum, entry) => sum + entry.skipped, 0),
    suites: executionResult.testResults.map((entry) => entry.suite),
    summary:
      executionResult.testResults.length > 0
        ? `${executionResult.testResults.length} test suite(s) recorded.`
        : 'No test results were recorded.',
  };
}
