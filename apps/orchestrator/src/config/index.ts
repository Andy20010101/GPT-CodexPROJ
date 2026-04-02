import path from 'node:path';

import type { ConcurrencyPolicy, ExecutorType, RetryPolicy } from '../contracts';

export type OrchestratorConfig = {
  artifactDir: string;
  apiHost: string;
  apiPort: number;
  bridgeBaseUrl: string;
  bridgeBrowserUrl: string;
  bridgeProjectName: string;
  reviewModelHint?: string | undefined;
  reviewMaxWaitMs: number;
  codexRunnerMode: 'stub' | 'cli';
  codexCliBin: string;
  codexCliArgs: string[];
  codexCliTimeoutMs: number;
  workspaceRuntimeBaseDir: string;
  workspaceSourceRepoPath: string;
  defaultExecutorType: ExecutorType;
  defaultRetryPolicy: RetryPolicy;
  daemonPollIntervalMs: number;
  daemonWorkerCount: number;
  workerHeartbeatIntervalMs: number;
  workerLeaseTtlMs: number;
  staleHeartbeatThresholdMs: number;
  concurrencyPolicy: ConcurrencyPolicy;
};

export function loadOrchestratorConfig(): OrchestratorConfig {
  const artifactDir =
    process.env.ORCHESTRATOR_ARTIFACT_DIR ?? path.resolve(__dirname, '..', '..', 'artifacts');

  return {
    artifactDir,
    apiHost: process.env.ORCHESTRATOR_API_HOST ?? '127.0.0.1',
    apiPort: parseInteger(process.env.ORCHESTRATOR_API_PORT, 3200),
    bridgeBaseUrl: process.env.BRIDGE_BASE_URL ?? 'http://127.0.0.1:3100',
    bridgeBrowserUrl: process.env.BRIDGE_BROWSER_URL ?? 'https://chatgpt.com/',
    bridgeProjectName: process.env.BRIDGE_PROJECT_NAME ?? 'Default',
    ...(process.env.REVIEW_MODEL_HINT ? { reviewModelHint: process.env.REVIEW_MODEL_HINT } : {}),
    reviewMaxWaitMs: parseInteger(process.env.REVIEW_MAX_WAIT_MS, 180000),
    codexRunnerMode: process.env.CODEX_RUNNER_MODE === 'cli' ? 'cli' : 'stub',
    codexCliBin: process.env.CODEX_CLI_BIN ?? 'codex',
    codexCliArgs: parseArgString(process.env.CODEX_CLI_ARGS),
    codexCliTimeoutMs: parseInteger(process.env.CODEX_CLI_TIMEOUT_MS, 600000),
    workspaceRuntimeBaseDir:
      process.env.WORKSPACE_RUNTIME_BASE_DIR ?? path.join(artifactDir, 'workspace-runtime'),
    workspaceSourceRepoPath:
      process.env.WORKSPACE_SOURCE_REPO_PATH ?? path.resolve(__dirname, '..', '..', '..', '..'),
    defaultExecutorType: parseExecutorType(process.env.DEFAULT_EXECUTOR_TYPE),
    defaultRetryPolicy: {
      maxAttempts: parseInteger(process.env.RUNTIME_MAX_ATTEMPTS, 2),
      backoffStrategy:
        process.env.RUNTIME_BACKOFF_STRATEGY === 'exponential' ? 'exponential' : 'fixed',
      baseDelayMs: parseInteger(process.env.RUNTIME_BASE_DELAY_MS, 0),
    },
    daemonPollIntervalMs: parseInteger(process.env.DAEMON_POLL_INTERVAL_MS, 250),
    daemonWorkerCount: parseInteger(process.env.DAEMON_WORKER_COUNT, 2),
    workerHeartbeatIntervalMs: parseInteger(process.env.DAEMON_HEARTBEAT_INTERVAL_MS, 500),
    workerLeaseTtlMs: parseInteger(process.env.DAEMON_LEASE_TTL_MS, 2000),
    staleHeartbeatThresholdMs: parseInteger(process.env.DAEMON_STALE_THRESHOLD_MS, 3000),
    concurrencyPolicy: {
      maxConcurrentJobs: parseInteger(process.env.DAEMON_MAX_CONCURRENT_JOBS, 2),
      maxConcurrentJobsPerRun: parseInteger(process.env.DAEMON_MAX_CONCURRENT_JOBS_PER_RUN, 1),
      deferDelayMs: parseInteger(process.env.DAEMON_CONCURRENCY_DEFER_MS, 250),
      exclusiveKeys: {
        task: process.env.DAEMON_EXCLUSIVE_TASK !== 'false',
        workspace: process.env.DAEMON_EXCLUSIVE_WORKSPACE !== 'false',
      },
    },
  };
}

function parseArgString(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseExecutorType(value: string | undefined): ExecutorType {
  if (value === 'codex' || value === 'command' || value === 'noop') {
    return value;
  }

  return 'codex';
}
