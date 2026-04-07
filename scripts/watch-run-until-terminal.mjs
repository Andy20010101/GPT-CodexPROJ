import fs from 'node:fs/promises';
import path from 'node:path';

const TERMINAL_RUN_STAGES = new Set(['accepted', 'rejected', 'failed', 'cancelled']);
const TERMINAL_RUNTIME_STATUSES = new Set(['accepted', 'failed', 'cancelled']);

function parseArgs(argv) {
  const options = {
    baseUrl: 'http://127.0.0.1:3204',
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

  return `${lines.join('\n')}\n`;
}

function isTerminal(snapshot) {
  return (
    TERMINAL_RUN_STAGES.has(snapshot.run.stage) ||
    TERMINAL_RUNTIME_STATUSES.has(snapshot.runtimeState.status)
  );
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

  return {
    generatedAt: new Date().toISOString(),
    run: summaryBody.data.run,
    runtimeState: summaryBody.data.runtimeState,
    summary: summaryBody.data.summary,
    tasks: tasksBody.data,
  };
}

function printConsoleSummary(snapshot) {
  const accepted = snapshot.tasks.filter((task) => task.status === 'accepted').length;
  process.stdout.write(
    `[${snapshot.generatedAt}] stage=${snapshot.run.stage} runtime=${snapshot.runtimeState.status} ` +
      `accepted=${accepted}/${snapshot.tasks.length} runningJobs=${snapshot.runtimeState.runningJobs} ` +
      `queuedJobs=${snapshot.runtimeState.queuedJobs}\n`,
  );
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
