import fs from 'node:fs/promises';
import path from 'node:path';
import { classifySelfImprovementRun } from './self-improvement-governor-shared.mjs';
import { buildSelfImprovementOperatorPlan } from './self-improvement-recovery-shared.mjs';

function parseArgs(argv) {
  const options = {
    artifactDir: undefined,
    baseUrl: 'http://127.0.0.1:3200',
    intervalMs: 5000,
    once: false,
    outputJson: undefined,
    outputMd: undefined,
    runId: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    switch (token) {
      case '--artifact-dir':
        options.artifactDir = next;
        index += 1;
        break;
      case '--base-url':
        options.baseUrl = next;
        index += 1;
        break;
      case '--run-id':
        options.runId = next;
        index += 1;
        break;
      case '--interval-ms':
        options.intervalMs = Number.parseInt(next, 10);
        index += 1;
        break;
      case '--output-json':
        options.outputJson = next;
        index += 1;
        break;
      case '--output-md':
        options.outputMd = next;
        index += 1;
        break;
      case '--once':
        options.once = true;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!options.runId) {
    throw new Error('--run-id is required');
  }

  if (!Number.isFinite(options.intervalMs) || options.intervalMs <= 0) {
    throw new Error('--interval-ms must be a positive integer');
  }

  return options;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function formatTaskLine(task) {
  return `- ${task.taskId} | ${task.status} | ${task.title}`;
}

function buildMarkdown(snapshot) {
  const accepted = snapshot.tasks.filter((task) => task.status === 'accepted').length;
  const pending = snapshot.tasks.filter((task) => task.status !== 'accepted').length;
  const lines = [
    `# Run Watch`,
    ``,
    `- generatedAt: ${snapshot.generatedAt}`,
    `- runId: ${snapshot.run.runId}`,
    `- title: ${snapshot.run.title}`,
    `- stage: ${snapshot.run.stage}`,
    `- runtimeStatus: ${snapshot.runtimeState.status}`,
    `- runningJobs: ${snapshot.runtimeState.runningJobs}`,
    `- queuedJobs: ${snapshot.runtimeState.queuedJobs}`,
    `- retriableJobs: ${snapshot.runtimeState.retriableJobs}`,
    `- blockedJobs: ${snapshot.runtimeState.blockedJobs}`,
    `- acceptedTasks: ${accepted}/${snapshot.tasks.length}`,
    `- pendingTasks: ${pending}`,
    `- terminal: ${snapshot.terminalState.terminal}`,
    `- terminalOutcome: ${snapshot.terminalState.outcome}`,
    `- terminalReason: ${snapshot.terminalState.reason}`,
    ``,
    `## Tasks`,
    ...snapshot.tasks.map(formatTaskLine),
  ];

  if (snapshot.runtimeState.acceptedTaskIds.length > 0) {
    lines.push('', '## Accepted Task IDs', ...snapshot.runtimeState.acceptedTaskIds.map((id) => `- ${id}`));
  }

  if (snapshot.runtimeState.blockedTaskIds.length > 0) {
    lines.push('', '## Blocked Task IDs', ...snapshot.runtimeState.blockedTaskIds.map((id) => `- ${id}`));
  }

  if (snapshot.operatorPlan) {
    lines.push(
      '',
      '## Operator Surface',
      `- envStatePath: ${snapshot.operatorPlan.artifactPaths.envStatePath}`,
      `- runJsonPath: ${snapshot.operatorPlan.artifactPaths.runJsonPath}`,
      `- watcherLatestJsonPath: ${snapshot.operatorPlan.artifactPaths.watcherLatestJsonPath}`,
      `- watcherLatestMarkdownPath: ${snapshot.operatorPlan.artifactPaths.watcherLatestMarkdownPath}`,
      `- jobsRoot: ${snapshot.operatorPlan.artifactPaths.jobsRoot}`,
      `- reviewsRoot: ${snapshot.operatorPlan.artifactPaths.reviewsRoot}`,
      `- watcherRestartCommand: \`${snapshot.operatorPlan.watcher.restartCommand}\``,
      `- watcherOneShotCommand: \`${snapshot.operatorPlan.watcher.oneShotCommand}\``,
      `- existingRunPrepareOnly: ${
        snapshot.operatorPlan.existingRunResume.prepareOnlyCommand
          ? `\`${snapshot.operatorPlan.existingRunResume.prepareOnlyCommand}\``
          : 'Unavailable: env-state endpoints are missing.'
      }`,
      `- existingRunResumeRecommended: ${snapshot.operatorPlan.existingRunResume.resumeRecommended}`,
      `- existingRunResumeReason: ${snapshot.operatorPlan.existingRunResume.reason}`,
      `- existingRunResumeCommand: ${
        snapshot.operatorPlan.existingRunResume.resumeCommand
          ? `\`${snapshot.operatorPlan.existingRunResume.resumeCommand}\``
          : 'Unavailable: env-state endpoints are missing.'
      }`,
      `- daemonState: ${snapshot.operatorPlan.daemon.state ?? 'unknown'}`,
      `- daemonResumeRecommended: ${snapshot.operatorPlan.daemon.resumeRecommended}`,
      `- daemonResumeReason: ${snapshot.operatorPlan.daemon.reason}`,
      `- daemonStatusCommand: \`${snapshot.operatorPlan.daemon.statusCommand}\``,
      `- daemonResumeCommand: \`${snapshot.operatorPlan.daemon.resumeCommand}\``,
    );

    if (snapshot.operatorPlan.reviewRetry.retryableJobs.length > 0) {
      lines.push('', '## Review Retry Candidates');
      for (const job of snapshot.operatorPlan.reviewRetry.retryableJobs) {
        lines.push(
          `### ${job.kind} ${job.jobId}`,
          `- status: ${job.status}`,
          `- attempt: ${job.attempt}/${job.maxAttempts}`,
          `- taskId: ${job.taskId ?? 'n/a'}`,
          `- executionId: ${job.executionId ?? 'n/a'}`,
          `- reviewId: ${job.reviewId ?? 'n/a'}`,
          `- jobPath: ${job.jobPath}`,
          `- reviewRuntimeStatePath: ${job.reviewRuntimeStatePath ?? 'n/a'}`,
          `- lastError: ${job.lastError?.code ?? 'n/a'} ${job.lastError?.message ?? ''}`.trimEnd(),
          `- inspectJob: \`${job.inspectCommands.job}\``,
          `- inspectFailure: \`${job.inspectCommands.failure}\``,
          `- inspectProcess: \`${job.inspectCommands.process}\``,
          `- retry: \`${job.retryCommand}\``,
        );
      }
    }

    if (snapshot.operatorPlan.reviewRetry.manualAttentionJobs.length > 0) {
      lines.push('', '## Review Manual Attention');
      for (const job of snapshot.operatorPlan.reviewRetry.manualAttentionJobs) {
        lines.push(
          `### ${job.kind} ${job.jobId}`,
          `- status: ${job.status}`,
          `- attempt: ${job.attempt}/${job.maxAttempts}`,
          `- taskId: ${job.taskId ?? 'n/a'}`,
          `- executionId: ${job.executionId ?? 'n/a'}`,
          `- reviewId: ${job.reviewId ?? 'n/a'}`,
          `- jobPath: ${job.jobPath}`,
          `- reviewRuntimeStatePath: ${job.reviewRuntimeStatePath ?? 'n/a'}`,
          `- lastError: ${job.lastError?.code ?? 'n/a'} ${job.lastError?.message ?? ''}`.trimEnd(),
          `- inspectJob: \`${job.inspectCommands.job}\``,
          `- inspectFailure: \`${job.inspectCommands.failure}\``,
          `- inspectProcess: \`${job.inspectCommands.process}\``,
          `- retryBlockedReason: ${job.retryBlockedReason ?? 'n/a'}`,
        );
      }
    }
  }

  return `${lines.join('\n')}\n`;
}

function isTerminal(snapshot) {
  return snapshot.terminalState.terminal;
}

async function ensureParent(filePath) {
  if (!filePath) {
    return;
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function writeOutputs(snapshot, options) {
  if (options.outputJson) {
    await ensureParent(options.outputJson);
    await fs.writeFile(options.outputJson, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  }

  if (options.outputMd) {
    await ensureParent(options.outputMd);
    await fs.writeFile(options.outputMd, buildMarkdown(snapshot), 'utf8');
  }
}

async function pollSnapshot(options) {
  const summaryBody = await fetchJson(
    `${options.baseUrl}/api/runs/${options.runId}/summary`,
  );
  const tasksBody = await fetchJson(`${options.baseUrl}/api/runs/${options.runId}/tasks`);
  const daemonStatusBody = await fetchJsonOrNull(`${options.baseUrl}/api/daemon/status`);
  const runFile = options.artifactDir
    ? path.join(options.artifactDir, 'runs', options.runId, 'run.json')
    : null;
  const runAcceptanceFile = options.artifactDir
    ? path.join(options.artifactDir, 'runs', options.runId, 'run-acceptance.json')
    : null;
  const envStateFile = options.artifactDir
    ? path.join(options.artifactDir, 'runtime', 'self-improvement-env', 'env-state.json')
    : null;
  const authoritativeRun =
    runFile === null ? null : await readJsonIfExists(runFile);
  const hasRunAcceptance =
    runAcceptanceFile === null ? false : await fileExists(runAcceptanceFile);
  const envState = envStateFile === null ? null : await readJsonIfExists(envStateFile);
  const jobs = options.artifactDir
    ? await readRunJobs(options.artifactDir, options.runId)
    : [];

  const terminalState = classifySelfImprovementRun({
    run: summaryBody.data.run,
    authoritativeRun: authoritativeRun ?? summaryBody.data.run,
    runtimeState: summaryBody.data.runtimeState,
    summary: summaryBody.data.summary,
    tasks: tasksBody.data,
    hasRunAcceptance,
  });

  return {
    generatedAt: new Date().toISOString(),
    run: summaryBody.data.run,
    runtimeState: summaryBody.data.runtimeState,
    summary: summaryBody.data.summary,
    tasks: tasksBody.data,
    terminalState,
    ...(options.artifactDir
      ? {
          operatorPlan: buildSelfImprovementOperatorPlan({
            artifactDir: options.artifactDir,
            baseUrl: options.baseUrl,
            runId: options.runId,
            run: authoritativeRun ?? summaryBody.data.run,
            runtimeState: summaryBody.data.runtimeState,
            summary: summaryBody.data.summary,
            envState,
            jobs,
            daemonStatus: daemonStatusBody?.data ?? null,
          }),
        }
      : {}),
  };
}

function printConsoleSummary(snapshot) {
  const accepted = snapshot.tasks.filter((task) => task.status === 'accepted').length;
  process.stdout.write(
    `[${snapshot.generatedAt}] stage=${snapshot.run.stage} runtime=${snapshot.runtimeState.status} ` +
      `accepted=${accepted}/${snapshot.tasks.length} runningJobs=${snapshot.runtimeState.runningJobs} ` +
      `queuedJobs=${snapshot.runtimeState.queuedJobs} terminal=${snapshot.terminalState.outcome}\n`,
  );
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function readRunJobs(artifactDir, runId) {
  const jobsRoot = path.join(artifactDir, 'runs', runId, 'jobs');
  try {
    const entries = await fs.readdir(jobsRoot, { withFileTypes: true });
    const jobs = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map(async (entry) => readJsonIfExists(path.join(jobsRoot, entry.name))),
    );
    return jobs.filter((job) => job !== null);
  } catch {
    return [];
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function fetchJsonOrNull(url) {
  try {
    return await fetchJson(url);
  } catch {
    return null;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  while (true) {
    const snapshot = await pollSnapshot(options);
    await writeOutputs(snapshot, options);
    printConsoleSummary(snapshot);

    if (options.once || isTerminal(snapshot)) {
      break;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, options.intervalMs);
    });
  }
}

await main();
