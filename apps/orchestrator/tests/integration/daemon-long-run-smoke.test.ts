import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

import { createArtifactDir } from '../helpers/runtime-fixtures';

const children: Array<import('node:child_process').ChildProcess> = [];

afterEach(() => {
  for (const child of children.splice(0)) {
    child.kill('SIGKILL');
  }
});

describe('daemon long-run smoke', () => {
  it('starts the daemon script, exposes metrics, and shuts down gracefully', async () => {
    const artifactDir = await createArtifactDir('daemon-script-');
    const repoRoot = path.resolve(__dirname, '../../../..');
    const scriptPath = path.resolve(__dirname, '../../../../scripts/run-orchestrator-daemon.ts');
    const child = spawn(process.execPath, ['--import', 'tsx', scriptPath], {
      cwd: repoRoot,
      env: {
        ...process.env,
        TMPDIR: '/tmp',
        ORCHESTRATOR_ARTIFACT_DIR: artifactDir,
        ORCHESTRATOR_DISABLE_LISTEN: 'true',
      },
      stdio: 'ignore',
    });
    children.push(child);

    await waitFor(async () => {
      try {
        await fs.access(path.join(artifactDir, 'runtime', 'daemon-state.json'));
        await fs.access(path.join(artifactDir, 'runtime', 'metrics-summary.json'));
        return true;
      } catch {
        return false;
      }
    }, 15000);

    const metrics = JSON.parse(
      await fs.readFile(path.join(artifactDir, 'runtime', 'metrics-summary.json'), 'utf8'),
    ) as { daemonState?: string };
    expect(metrics.daemonState).toBeDefined();

    child.kill('SIGTERM');

    await waitFor(async () => {
      try {
        await fs.access(path.join(artifactDir, 'runtime', 'daemon-state.json'));
        const raw = JSON.parse(
          await fs.readFile(path.join(artifactDir, 'runtime', 'daemon-state.json'), 'utf8'),
        ) as { state?: string };
        return raw.state === 'stopped' || raw.state === 'degraded';
      } catch {
        return false;
      }
    }, 15000);
  }, 25000);
});

async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}
