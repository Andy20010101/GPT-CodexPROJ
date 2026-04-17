import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
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
import { buildPtySpawnPlan } from '../utils/pty-command';
import { buildChildProcessEnv } from '../utils/subprocess-env';
import { EvidenceLedgerService } from './evidence-ledger-service';

type ActiveProcess = {
  child: ChildProcessWithoutNullStreams;
  handle: ProcessHandle;
  stdout: string;
  stderr: string;
  finished: boolean;
  activityObserved: boolean;
  lastActivityAt: string;
  resolve: (value: ManagedProcessResult) => void;
  reject: (reason?: unknown) => void;
  timeout?: NodeJS.Timeout | undefined;
  forceKillTimer?: NodeJS.Timeout | undefined;
  stallCheckTimer?: NodeJS.Timeout | undefined;
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
    usePty?: boolean | undefined;
    mirrorOutput?: boolean | undefined;
    ptyScriptBin?: string | undefined;
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
        const spawnPlan = buildPtySpawnPlan({
          command: input.command,
          args: input.args,
          usePty: input.usePty,
          scriptBin: input.ptyScriptBin,
        });
        child = spawn(spawnPlan.command, [...spawnPlan.args], {
          cwd: input.workspacePath,
          env: buildChildProcessEnv(process.env, input.env ?? {}),
          shell: input.usePty ? spawnPlan.shell : (input.shell ?? false),
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
        activityObserved: false,
        lastActivityAt: startedAt,
        resolve,
        reject,
      };
      this.activeProcesses.set(input.jobId, active);

      void this.persistHandle(active.handle, 'Process started');

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        active.stdout += chunk;
        this.recordActivity(active, 'stdout');
        if (input.mirrorOutput) {
          process.stdout.write(chunk);
        }
      });
      child.stderr.on('data', (chunk: string) => {
        active.stderr += chunk;
        this.recordActivity(active, 'stderr');
        if (input.mirrorOutput) {
          process.stderr.write(chunk);
        }
      });
      child.on('error', (error) => {
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
        if (active.stallCheckTimer) {
          clearInterval(active.stallCheckTimer);
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
        if (active.stallCheckTimer) {
          clearInterval(active.stallCheckTimer);
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

      const stallTimeoutMs = readPositiveInteger(input.metadata?.stallTimeoutMs);
      if (stallTimeoutMs) {
        const outputPath = readString(input.metadata?.outputPath);
        active.stallCheckTimer = setInterval(() => {
          void this.checkForStalledProcess(active, {
            outputPath,
            stallTimeoutMs,
          });
        }, Math.max(250, Math.min(5_000, Math.floor(stallTimeoutMs / 4))));
      }
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

  private recordActivity(active: ActiveProcess, source: string, timestamp: string = new Date().toISOString()): void {
    const previous = readString(active.handle.metadata.lastActivitySource);
    active.activityObserved = true;
    active.lastActivityAt = timestamp;
    active.handle = ProcessHandleSchema.parse({
      ...active.handle,
      metadata: {
        ...active.handle.metadata,
        lastActivityAt: timestamp,
        lastActivitySource: source,
        ...(previous ? { previousActivitySource: previous } : {}),
      },
    });
  }

  private async checkForStalledProcess(
    active: ActiveProcess,
    input: {
      outputPath?: string | undefined;
      stallTimeoutMs: number;
    },
  ): Promise<void> {
    if (active.finished || active.terminationRequested) {
      return;
    }

    await this.observeActivityFile(active, input.outputPath, 'structured-output');

    let sessionLogPath = readString(active.handle.metadata.sessionLogPath);
    if (!sessionLogPath && typeof active.handle.pid === 'number') {
      sessionLogPath = await resolveCodexSessionLogPath(active.handle.pid);
      if (sessionLogPath) {
        active.handle = ProcessHandleSchema.parse({
          ...active.handle,
          metadata: {
            ...active.handle.metadata,
            sessionLogPath,
          },
        });
      }
    }
    await this.observeActivityFile(active, sessionLogPath, 'session-log');

    const lastActivityMs = Date.parse(active.lastActivityAt);
    if (!Number.isFinite(lastActivityMs) || lastActivityMs + input.stallTimeoutMs > Date.now()) {
      return;
    }

    const stalledAt = new Date().toISOString();
    active.handle = ProcessHandleSchema.parse({
      ...active.handle,
      metadata: {
        ...active.handle.metadata,
        timeout: true,
        stallDetectedAt: stalledAt,
        stallTimeoutMs: input.stallTimeoutMs,
      },
    });
    await this.requestTermination({
      jobId: active.handle.jobId,
      reason: 'stall-timeout',
      requestedBy: 'process-control-service',
    });
  }

  private async observeActivityFile(
    active: ActiveProcess,
    filePath: string | undefined,
    source: string,
  ): Promise<void> {
    if (!filePath) {
      return;
    }

    const observedAt = await readFileTimestamp(filePath);
    if (!observedAt) {
      return;
    }
    if (Date.parse(observedAt) <= Date.parse(active.lastActivityAt)) {
      return;
    }
    this.recordActivity(active, source, observedAt);
  }
}

async function resolveCodexSessionLogPath(pid: number): Promise<string | undefined> {
  try {
    const fdRoot = `/proc/${pid}/fd`;
    const entries = await fs.readdir(fdRoot);
    for (const entry of entries) {
      try {
        const linkTarget = await fs.readlink(path.join(fdRoot, entry));
        if (linkTarget.includes(`${path.sep}.codex${path.sep}sessions${path.sep}`) && linkTarget.endsWith('.jsonl')) {
          return linkTarget;
        }
      } catch {
        // Ignore individual fd races while the process is running.
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function readFileTimestamp(filePath: string): Promise<string | undefined> {
  try {
    const stats = await fs.stat(filePath);
    return stats.mtime.toISOString();
  } catch {
    return undefined;
  }
}

function readPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
