import { OrchestratorError } from '../utils/error';
import type { RunnerCancellation } from '../contracts';
import { FileRunRepository } from '../storage/file-run-repository';
import { EvidenceLedgerService } from './evidence-ledger-service';
import { ProcessControlService, type ManagedProcessResult } from './process-control-service';

export type RunnerLifecycleResult = ManagedProcessResult & {
  errorCode?: string | undefined;
  cancellation?: RunnerCancellation | undefined;
};

export class RunnerLifecycleService {
  public constructor(
    private readonly runRepository: FileRunRepository,
    private readonly evidenceLedgerService: EvidenceLedgerService,
    private readonly processControlService: ProcessControlService,
  ) {}

  public async runCommand(input: {
    runId: string;
    taskId?: string | undefined;
    jobId: string;
    workspacePath: string;
    command: string;
    args: readonly string[];
    stdin?: string | undefined;
    env?: Record<string, string> | undefined;
    shell?: boolean | undefined;
    timeoutMs: number;
    usePty?: boolean | undefined;
    mirrorOutput?: boolean | undefined;
    ptyScriptBin?: string | undefined;
    producer: string;
    metadata?: Record<string, unknown> | undefined;
    onSettled?: (() => Promise<void> | void) | undefined;
  }): Promise<RunnerLifecycleResult> {
    try {
      const result = await this.processControlService.runProcess({
        runId: input.runId,
        ...(input.taskId ? { taskId: input.taskId } : {}),
        jobId: input.jobId,
        workspacePath: input.workspacePath,
        command: input.command,
        args: input.args,
        ...(input.stdin ? { stdin: input.stdin } : {}),
        ...(input.env ? { env: input.env } : {}),
        ...(input.shell !== undefined ? { shell: input.shell } : {}),
        ...(input.usePty !== undefined ? { usePty: input.usePty } : {}),
        ...(input.mirrorOutput !== undefined ? { mirrorOutput: input.mirrorOutput } : {}),
        ...(input.ptyScriptBin ? { ptyScriptBin: input.ptyScriptBin } : {}),
        timeoutMs: input.timeoutMs,
        metadata: input.metadata,
      });
      const errorCode =
        result.outcome === 'timeout'
          ? 'RUNNER_TIMEOUT'
          : result.outcome === 'cancelled'
            ? 'RUNNER_CANCELLED'
            : undefined;
      await this.appendLifecycleEvidence(input, result, errorCode);
      return {
        ...result,
        ...(errorCode ? { errorCode } : {}),
      };
    } catch (error) {
      const code = error instanceof OrchestratorError ? error.code : 'RUNNER_LIFECYCLE_FAILED';
      throw new OrchestratorError(code, error instanceof Error ? error.message : 'Runner failed', {
        jobId: input.jobId,
        runId: input.runId,
      });
    } finally {
      await input.onSettled?.();
    }
  }

  public async requestCancellation(input: {
    jobId: string;
    reason: string;
    requestedBy?: string | undefined;
  }): Promise<RunnerCancellation> {
    return this.processControlService.requestTermination(input);
  }

  public async getLatestProcessForJob(jobId: string) {
    return this.processControlService.getLatestProcessForJob(jobId);
  }

  private async appendLifecycleEvidence(
    input: {
      runId: string;
      taskId?: string | undefined;
      jobId: string;
      producer: string;
    },
    result: ManagedProcessResult,
    errorCode?: string | undefined,
  ): Promise<void> {
    const run = await this.runRepository.getRun(input.runId);
    await this.evidenceLedgerService.appendEvidence({
      runId: input.runId,
      ...(input.taskId ? { taskId: input.taskId } : {}),
      stage: run.stage,
      kind: 'runner_lifecycle',
      timestamp: result.handle.endedAt ?? result.handle.startedAt,
      producer: input.producer,
      artifactPaths: [result.handlePath],
      summary: `Runner finished with outcome ${result.outcome}`,
      metadata: {
        jobId: input.jobId,
        processHandleId: result.handle.processHandleId,
        exitCode: result.exitCode,
        signal: result.signal,
        outcome: result.outcome,
        ...(errorCode ? { errorCode } : {}),
      },
    });
  }
}
