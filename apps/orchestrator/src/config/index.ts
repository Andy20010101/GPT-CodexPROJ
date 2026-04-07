import path from 'node:path';

import type {
  CleanupPolicy,
  ConcurrencyPolicy,
  ExecutorType,
  RetryPolicy,
  SchedulingPolicy,
} from '../contracts';

export type OrchestratorConfig = {
  artifactDir: string;
  apiHost: string;
  apiPort: number;
  bridgeBaseUrl: string;
  bridgeBrowserUrl: string;
  bridgeProjectName: string;
  reviewModelHint?: string | undefined;
  reviewMaxWaitMs: number;
  planningModelHint: string;
  planningMaxWaitMs: number;
  planningPollIntervalMs: number;
  planningStablePolls: number;
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
  schedulingPolicy: SchedulingPolicy;
  workspaceCleanupPolicy: CleanupPolicy;
  daemonGcIntervalMs: number;
  runnerTerminateGraceMs: number;
  runnerKillSignal: NodeJS.Signals;
  runnerForceKillAfterMs: number;
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
    reviewMaxWaitMs: parseInteger(process.env.REVIEW_MAX_WAIT_MS, 900000),
    planningModelHint: process.env.PLANNING_MODEL_HINT ?? 'pro',
    planningMaxWaitMs: parseInteger(process.env.PLANNING_MAX_WAIT_MS, 3_000_000),
    planningPollIntervalMs: parseInteger(process.env.PLANNING_POLL_INTERVAL_MS, 5000),
    planningStablePolls: parseInteger(process.env.PLANNING_STABLE_POLLS, 3),
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
    schedulingPolicy: {
      quotaPolicy: {
        maxConcurrentJobsGlobal: parseInteger(process.env.DAEMON_MAX_CONCURRENT_JOBS, 2),
        maxConcurrentJobsPerRun: parseInteger(process.env.DAEMON_MAX_CONCURRENT_JOBS_PER_RUN, 1),
        maxConcurrentJobsPerKind: {
          task_execution: parseInteger(process.env.SCHEDULER_MAX_TASK_EXECUTION, 2),
          task_review: parseInteger(process.env.SCHEDULER_MAX_TASK_REVIEW, 1),
          task_review_request: parseInteger(process.env.SCHEDULER_MAX_TASK_REVIEW_REQUEST, 1),
          task_review_finalize: parseInteger(process.env.SCHEDULER_MAX_TASK_REVIEW_FINALIZE, 1),
          release_review: parseInteger(process.env.SCHEDULER_MAX_RELEASE_REVIEW, 1),
        },
        reservedSlots: [],
      },
      fairnessWindowMs: parseInteger(process.env.SCHEDULER_FAIRNESS_WINDOW_MS, 1000),
      priorityOrder: ['urgent', 'high', 'normal', 'low'],
      releaseReviewBoostMs: parseInteger(process.env.SCHEDULER_RELEASE_BOOST_MS, 5000),
    },
    workspaceCleanupPolicy: {
      ttlMs: parseInteger(process.env.WORKSPACE_TTL_MS, 3_600_000),
      retainOnFailure: process.env.WORKSPACE_RETAIN_ON_FAILURE !== 'false',
      retainOnRejectedReview: process.env.WORKSPACE_RETAIN_ON_REJECTED_REVIEW !== 'false',
      retainOnDebug: process.env.WORKSPACE_RETAIN_ON_DEBUG !== 'false',
      maxRetainedPerRun: parseInteger(process.env.WORKSPACE_MAX_RETAINED_PER_RUN, 3),
      cleanupMode: parseCleanupMode(process.env.WORKSPACE_CLEANUP_MODE),
    },
    daemonGcIntervalMs: parseInteger(process.env.DAEMON_GC_INTERVAL_MS, 1000),
    runnerTerminateGraceMs: parseInteger(process.env.RUNNER_TERMINATE_GRACE_MS, 250),
    runnerKillSignal: parseSignal(process.env.RUNNER_KILL_SIGNAL),
    runnerForceKillAfterMs: parseInteger(process.env.RUNNER_FORCE_KILL_AFTER_MS, 750),
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

function parseCleanupMode(value: string | undefined): CleanupPolicy['cleanupMode'] {
  return value === 'immediate' || value === 'manual' ? value : 'delayed';
}

function parseSignal(value: string | undefined): NodeJS.Signals {
  switch (value) {
    case 'SIGINT':
    case 'SIGKILL':
    case 'SIGTERM':
      return value;
    default:
      return 'SIGKILL';
  }
}
