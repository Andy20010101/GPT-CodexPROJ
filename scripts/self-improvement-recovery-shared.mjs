import path from 'node:path';

const REVIEW_JOB_KINDS = new Set(['task_review_request', 'task_review_finalize']);
const RETRYABLE_JOB_STATUSES = new Set(['failed', 'blocked', 'retriable', 'queued', 'running']);
const DEFAULT_PLANNING_MODEL = 'ChatGPT';
const DEFAULT_STARTUP_URL = 'https://chatgpt.com/';

function shellQuote(value) {
  if (value === '') {
    return "''";
  }

  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function buildCliFlag(flag, value) {
  return `${flag} ${shellQuote(value)}`;
}

function joinCommand(parts) {
  return parts.filter(Boolean).join(' ');
}

function readString(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function getRunRoot(artifactDir, runId) {
  return path.join(artifactDir, 'runs', runId);
}

function getReviewRuntimeStatePath(artifactDir, runId, reviewId) {
  return path.join(getRunRoot(artifactDir, runId), 'reviews', reviewId, 'runtime-state.json');
}

function getJobPath(artifactDir, runId, jobId) {
  return path.join(getRunRoot(artifactDir, runId), 'jobs', `${jobId}.json`);
}

function canRetryJob(job) {
  const status = readString(job?.status);
  const attempt = Number.isFinite(job?.attempt) ? job.attempt : null;
  const maxAttempts = Number.isFinite(job?.maxAttempts) ? job.maxAttempts : null;
  if (!status || attempt === null || maxAttempts === null) {
    return false;
  }

  return (
    RETRYABLE_JOB_STATUSES.has(status) &&
    (status === 'retriable' || status === 'queued' || attempt < maxAttempts)
  );
}

function getJobTimestamp(job) {
  return (
    readString(job?.finishedAt) ??
    readString(job?.startedAt) ??
    readString(job?.availableAt) ??
    readString(job?.createdAt) ??
    ''
  );
}

function sortJobsByNewest(jobs) {
  return [...jobs].sort((left, right) => getJobTimestamp(right).localeCompare(getJobTimestamp(left)));
}

function buildInspectCommands(baseUrl, jobId) {
  return {
    job: `curl -sS ${shellQuote(`${baseUrl}/api/jobs/${jobId}`)}`,
    failure: `curl -sS ${shellQuote(`${baseUrl}/api/jobs/${jobId}/failure`)}`,
    process: `curl -sS ${shellQuote(`${baseUrl}/api/jobs/${jobId}/process`)}`,
  };
}

function buildRetryCommand(baseUrl, jobId) {
  return joinCommand([
    'curl -sS -X POST',
    shellQuote(`${baseUrl}/api/jobs/${jobId}/retry`),
    "-H 'content-type: application/json'",
    `-d '${JSON.stringify({ immediate: true, runWorker: true })}'`,
  ]);
}

function buildDaemonCommands(baseUrl) {
  return {
    status: `curl -sS ${shellQuote(`${baseUrl}/api/daemon/status`)}`,
    resume: joinCommand([
      'curl -sS -X POST',
      shellQuote(`${baseUrl}/api/daemon/resume`),
      "-H 'content-type: application/json'",
      `-d '${JSON.stringify({ requestedBy: 'operator' })}'`,
    ]),
  };
}

function buildRunDriverCommand(envState, runId, options = {}) {
  if (!envState?.orchestrator?.baseUrl) {
    return null;
  }

  const startupUrl = readString(envState?.browser?.startupUrl) ?? DEFAULT_STARTUP_URL;
  const parts = [
    options.prepareOnly ? '' : 'CODEX_RUNNER_MODE=cli',
    'node --import tsx scripts/run-real-self-improvement.ts',
    buildCliFlag('--orchestrator-base-url', envState.orchestrator.baseUrl),
  ];
  if (readString(envState?.bridge?.baseUrl)) {
    parts.push(buildCliFlag('--bridge-base-url', envState.bridge.baseUrl));
  }
  if (readString(envState?.browser?.endpoint)) {
    parts.push(buildCliFlag('--browser-endpoint', envState.browser.endpoint));
  }
  parts.push(buildCliFlag('--startup-url', startupUrl));
  parts.push(buildCliFlag('--planning-model', DEFAULT_PLANNING_MODEL));
  parts.push(buildCliFlag('--run-id', runId));
  if (options.prepareOnly) {
    parts.push('--prepare-only');
  }

  return joinCommand(parts);
}

function buildWatcherCommand(baseUrl, artifactDir, runId, options = {}) {
  const parts = [
    'node scripts/watch-run-until-terminal.mjs',
    buildCliFlag('--artifact-dir', artifactDir),
    buildCliFlag('--base-url', baseUrl),
    buildCliFlag('--run-id', runId),
  ];
  if (options.once) {
    parts.push('--once');
  } else {
    parts.push(
      buildCliFlag('--output-json', path.join(getRunRoot(artifactDir, runId), 'watcher', 'latest.json')),
    );
    parts.push(
      buildCliFlag('--output-md', path.join(getRunRoot(artifactDir, runId), 'watcher', 'latest.md')),
    );
  }
  return joinCommand(parts);
}

function summarizeReviewJob(baseUrl, artifactDir, runId, job) {
  const reviewId = readString(job?.metadata?.reviewId);
  const retrySupported = canRetryJob(job);
  return {
    jobId: job.jobId,
    kind: job.kind,
    status: job.status,
    attempt: job.attempt,
    maxAttempts: job.maxAttempts,
    taskId: readString(job.taskId),
    executionId: readString(job?.metadata?.executionId),
    workspaceId: readString(job?.metadata?.workspaceId),
    reviewId,
    jobPath: getJobPath(artifactDir, runId, job.jobId),
    reviewRuntimeStatePath:
      reviewId === null ? null : getReviewRuntimeStatePath(artifactDir, runId, reviewId),
    lastError: job.lastError
      ? {
          code: readString(job.lastError.code),
          message: readString(job.lastError.message),
        }
      : null,
    inspectCommands: buildInspectCommands(baseUrl, job.jobId),
    retrySupported,
    retryCommand: retrySupported ? buildRetryCommand(baseUrl, job.jobId) : null,
    retryBlockedReason:
      retrySupported
        ? null
        : job.status === 'manual_attention_required'
          ? 'Job is already manual_attention_required; inspect artifacts before deciding on any further action.'
          : job.attempt >= job.maxAttempts
            ? `Job reached maxAttempts (${job.attempt}/${job.maxAttempts}).`
            : `Job status ${job.status} is not retriable through /api/jobs/:jobId/retry.`,
  };
}

export function buildSelfImprovementOperatorPlan(input) {
  const runId = input.runId;
  const artifactDir = input.artifactDir;
  const baseUrl = input.baseUrl;
  const summary = input.summary ?? {};
  const runtimeState = input.runtimeState ?? {};
  const daemonState = input.daemonStatus?.daemonState ?? null;
  const daemonCommands = buildDaemonCommands(baseUrl);
  const jobs = Array.isArray(input.jobs) ? input.jobs : [];
  const reviewJobs = sortJobsByNewest(jobs).filter((job) => REVIEW_JOB_KINDS.has(job.kind));
  const retryableReviewJobs = reviewJobs
    .filter((job) => canRetryJob(job))
    .slice(0, input.maxReviewJobs ?? 3)
    .map((job) => summarizeReviewJob(baseUrl, artifactDir, runId, job));
  const manualAttentionReviewJobs = reviewJobs
    .filter((job) => job.status === 'manual_attention_required')
    .slice(0, input.maxReviewJobs ?? 3)
    .map((job) => summarizeReviewJob(baseUrl, artifactDir, runId, job));
  const envState = input.envState ?? null;
  const taskGraphRegistered =
    summary.taskGraphRegistered === true || typeof input.run?.taskGraphPath === 'string';
  const fullRunResumeCommand = envState ? buildRunDriverCommand(envState, runId) : null;
  const prepareOnlyCommand = envState
    ? buildRunDriverCommand(envState, runId, { prepareOnly: true })
    : null;
  const queuedOrRetriableWork =
    (runtimeState.queuedJobs ?? 0) > 0 || (runtimeState.retriableJobs ?? 0) > 0;

  return {
    artifactPaths: {
      envStatePath: path.join(artifactDir, 'runtime', 'self-improvement-env', 'env-state.json'),
      runJsonPath: path.join(getRunRoot(artifactDir, runId), 'run.json'),
      watcherLatestJsonPath: path.join(getRunRoot(artifactDir, runId), 'watcher', 'latest.json'),
      watcherLatestMarkdownPath: path.join(getRunRoot(artifactDir, runId), 'watcher', 'latest.md'),
      jobsRoot: path.join(getRunRoot(artifactDir, runId), 'jobs'),
      reviewsRoot: path.join(getRunRoot(artifactDir, runId), 'reviews'),
    },
    watcher: {
      restartCommand: buildWatcherCommand(baseUrl, artifactDir, runId),
      oneShotCommand: buildWatcherCommand(baseUrl, artifactDir, runId, { once: true }),
    },
    existingRunResume: {
      prepareOnlyCommand,
      resumeCommand: fullRunResumeCommand,
      resumeRecommended: taskGraphRegistered !== true,
      reason:
        taskGraphRegistered !== true
          ? 'Task graph is not yet registered, so rerunning the bounded entrypoint with --run-id can continue planning.'
          : 'Run already progressed beyond planning; use watcher/artifacts to understand state, then choose retry or daemon resume if needed.',
      envStateReady: envState?.overallStatus === 'ready',
    },
    daemon: {
      state: readString(daemonState?.state),
      statusCommand: daemonCommands.status,
      resumeCommand: daemonCommands.resume,
      resumeRecommended:
        queuedOrRetriableWork && daemonState !== null && daemonState.state !== 'running',
      reason:
        queuedOrRetriableWork && daemonState !== null && daemonState.state !== 'running'
          ? `Queued or retriable work remains while the daemon is ${daemonState.state}.`
          : queuedOrRetriableWork
            ? 'Queued or retriable work remains, but daemon status is unavailable.'
            : 'No queued or retriable work currently requires daemon resume.',
    },
    reviewRetry: {
      retryableJobs: retryableReviewJobs,
      manualAttentionJobs: manualAttentionReviewJobs,
    },
  };
}
