import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import {
  ProcessHandleSchema,
  RunnerCancellationSchema,
  type ProcessHandle,
  type RunnerCancellation,
} from '../contracts';
import { FileProcessRepository } from '../storage/file-process-repository';
import { FileRunRepository } from '../storage/file-run-repository';
import { OrchestratorError } from '../utils/error';
import { EvidenceLedgerService } from './evidence-ledger-service';

type ActiveProcess = {
  child: ChildProcessWithoutNullStreams;
  handle: ProcessHandle;
  stdout: string;
  stderr: string;
  finished: boolean;
  resolve: (value: ManagedProcessResult) => void;
  reject: (reason?: unknown) => void;
  timeout?: NodeJS.Timeout | undefined;
  forceKillTimer?: NodeJS.Timeout | undefined;
  terminationRequested?: RunnerCancellation | undefined;
};

export type ManagedProcessResult = {
  handle: ProcessHandle;
  handlePath: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  outcome: 'completed' | 'cancelled' | 'timeout' | 'failed_to_start';
};

export class ProcessControlService {
  private readonly activeProcesses = new Map<string, ActiveProcess>();

  public constructor(
    private readonly processRepository: FileProcessRepository,
    private readonly runRepository: FileRunRepository,
    private readonly evidenceLedgerService: EvidenceLedgerService,
    private readonly config: {
      gracefulSignal: NodeJS.Signals;
      graceMs: number;
      forcedSignal: NodeJS.Signals;
      forceKillAfterMs: number;
    },
  ) {}

  public async runProcess(input: {
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
    metadata?: Record<string, unknown> | undefined;
  }): Promise<ManagedProcessResult> {
    const startedAt = new Date().toISOString();
    const handle = ProcessHandleSchema.parse({
      processHandleId: randomUUID(),
      runId: input.runId,
      ...(input.taskId ? { taskId: input.taskId } : {}),
      jobId: input.jobId,
      workspacePath: input.workspacePath,
      command: input.command,
      args: [...input.args],
      status: 'running',
      startedAt,
      metadata: input.metadata ?? {},
    });

    return new Promise<ManagedProcessResult>((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(input.command, [...input.args], {
          cwd: input.workspacePath,
          env: {
            ...process.env,
            ...(input.env ?? {}),
          },
          shell: input.shell ?? false,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (error) {
        void this.persistFailureToStart(handle, error).then(reject);
        return;
      }

      const active: ActiveProcess = {
        child,
        handle: {
          ...handle,
          ...(typeof child.pid === 'number' ? { pid: child.pid } : {}),
        },
        stdout: '',
        stderr: '',
        finished: false,
        resolve,
        reject,
      };
      this.activeProcesses.set(input.jobId, active);

      void this.persistHandle(active.handle, 'Process started');

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        active.stdout += chunk;
      });
      child.stderr.on('data', (chunk: string) => {
        active.stderr += chunk;
      });
      child.on('error', (error) => {
        if (active.finished) {
          return;
        }
        void this.persistFailureToStart(active.handle, error).then(reject);
      });
      child.on('close', (exitCode, signal) => {
        if (active.finished) {
          return;
        }
        active.finished = true;
        this.activeProcesses.delete(input.jobId);
        if (active.timeout) {
          clearTimeout(active.timeout);
        }
        if (active.forceKillTimer) {
          clearTimeout(active.forceKillTimer);
        }
        const durationMs = Date.now() - new Date(startedAt).getTime();
        const outcome =
          active.handle.metadata.timeout === true
            ? 'timeout'
            : active.terminationRequested?.outcome === 'forced_kill'
              ? 'cancelled'
              : active.terminationRequested?.outcome === 'terminate_requested'
                ? 'cancelled'
                : signal === this.config.forcedSignal
                  ? 'cancelled'
                  : 'completed';
        const finalHandle = ProcessHandleSchema.parse({
          ...active.handle,
          status:
            outcome === 'timeout'
              ? 'killed'
              : signal === this.config.forcedSignal
                ? 'killed'
                : active.terminationRequested
                  ? 'terminated'
                  : 'exited',
          endedAt: new Date().toISOString(),
          exitCode,
          signal: signal ?? null,
          durationMs,
          metadata: {
            ...active.handle.metadata,
            ...(active.terminationRequested ? { cancellation: active.terminationRequested } : {}),
          },
        });
        void this.persistHandle(finalHandle, `Process ${finalHandle.status}`).then((handlePath) => {
          resolve({
            handle: finalHandle,
            handlePath,
            stdout: active.stdout,
            stderr: active.stderr,
            exitCode,
            signal: signal ?? null,
            durationMs,
            outcome,
          });
        });
      });

      if (input.stdin) {
        child.stdin.write(input.stdin);
      }
      child.stdin.end();

      active.timeout = setTimeout(() => {
        active.handle = {
          ...active.handle,
          metadata: {
            ...active.handle.metadata,
            timeout: true,
          },
        };
        void this.requestTermination({
          jobId: input.jobId,
          reason: 'timeout',
        });
      }, input.timeoutMs);
    });
  }

  public requestTermination(input: {
    jobId: string;
    reason: string;
    requestedBy?: string | undefined;
  }): Promise<RunnerCancellation> {
    const active = this.activeProcesses.get(input.jobId);
    const requestedAt = new Date().toISOString();
    if (!active) {
      return Promise.resolve(
        RunnerCancellationSchema.parse({
          jobId: input.jobId,
          outcome: 'not_found',
          requestedAt,
          gracefulSignal: this.config.gracefulSignal,
          forcedSignal: this.config.forcedSignal,
          graceMs: this.config.graceMs,
          forceKillAfterMs: this.config.forceKillAfterMs,
          metadata: {
            reason: input.reason,
            requestedBy: input.requestedBy ?? 'system',
          },
        }),
      );
    }

    if (active.finished) {
      return Promise.resolve(
        RunnerCancellationSchema.parse({
          jobId: input.jobId,
          processHandleId: active.handle.processHandleId,
          outcome: 'already_exited',
          requestedAt,
          completedAt: new Date().toISOString(),
          gracefulSignal: this.config.gracefulSignal,
          forcedSignal: this.config.forcedSignal,
          graceMs: this.config.graceMs,
          forceKillAfterMs: this.config.forceKillAfterMs,
          metadata: {
            reason: input.reason,
          },
        }),
      );
    }

    active.child.kill(this.config.gracefulSignal);
    const request = RunnerCancellationSchema.parse({
      jobId: input.jobId,
      processHandleId: active.handle.processHandleId,
      outcome: 'terminate_requested',
      requestedAt,
      gracefulSignal: this.config.gracefulSignal,
      forcedSignal: this.config.forcedSignal,
      graceMs: this.config.graceMs,
      forceKillAfterMs: this.config.forceKillAfterMs,
      metadata: {
        reason: input.reason,
        requestedBy: input.requestedBy ?? 'system',
      },
    });
    active.terminationRequested = request;
    active.forceKillTimer = setTimeout(() => {
      if (active.finished) {
        return;
      }
      active.child.kill(this.config.forcedSignal);
      active.terminationRequested = RunnerCancellationSchema.parse({
        ...request,
        outcome: 'forced_kill',
        completedAt: new Date().toISOString(),
      });
    }, this.config.forceKillAfterMs);
    return Promise.resolve(request);
  }

  public async getLatestProcessForJob(jobId: string): Promise<ProcessHandle | null> {
    const active = this.activeProcesses.get(jobId);
    if (active) {
      return active.handle;
    }
    return this.processRepository.findLatestByJob(jobId);
  }

  private async persistFailureToStart(handle: ProcessHandle, error: unknown): Promise<never> {
    const message = error instanceof Error ? error.message : 'Failed to start child process.';
    const failedHandle = ProcessHandleSchema.parse({
      ...handle,
      status: 'failed_to_start',
      endedAt: new Date().toISOString(),
      exitCode: null,
      signal: null,
      metadata: {
        ...handle.metadata,
        error: message,
      },
    });
    await this.persistHandle(failedHandle, 'Process failed to start');
    throw new OrchestratorError('PROCESS_START_FAILED', message, {
      jobId: handle.jobId,
      runId: handle.runId,
    });
  }

  private async persistHandle(handle: ProcessHandle, summary: string): Promise<string> {
    const path = await this.processRepository.saveProcessHandle(handle);
    const run = await this.runRepository.getRun(handle.runId);
    await this.evidenceLedgerService.appendEvidence({
      runId: handle.runId,
      ...(handle.taskId ? { taskId: handle.taskId } : {}),
      stage: run.stage,
      kind: 'process_handle',
      timestamp: handle.endedAt ?? handle.startedAt,
      producer: 'process-control-service',
      artifactPaths: [path],
      summary,
      metadata: {
        processHandleId: handle.processHandleId,
        jobId: handle.jobId,
        status: handle.status,
        ...(handle.pid ? { pid: handle.pid } : {}),
      },
    });
    return path;
  }
}
