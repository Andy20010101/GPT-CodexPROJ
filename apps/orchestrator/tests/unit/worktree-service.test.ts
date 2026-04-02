import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { WorktreeService } from '../../src/services/worktree-service';

const execFileAsync = promisify(execFile);

async function createGitRepo(): Promise<string> {
  const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'worktree-service-repo-'));
  await execFileAsync('git', ['init'], { cwd: repoDir });
  await execFileAsync('git', ['config', 'user.email', 'tester@example.com'], {
    cwd: repoDir,
  });
  await execFileAsync('git', ['config', 'user.name', 'Tester'], {
    cwd: repoDir,
  });
  await fs.writeFile(path.join(repoDir, 'README.md'), '# repo\n', 'utf8');
  await execFileAsync('git', ['add', 'README.md'], { cwd: repoDir });
  await execFileAsync('git', ['commit', '-m', 'init'], { cwd: repoDir });
  return repoDir;
}

describe('WorktreeService', () => {
  it('prepares, describes, and cleans up a git worktree', async () => {
    const repoDir = await createGitRepo();
    const worktreeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'worktree-service-root-'));
    const workspacePath = path.join(worktreeRoot, 'task-worktree');
    const service = new WorktreeService();

    const prepared = await service.prepareWorkspace({
      baseRepoPath: repoDir,
      workspacePath,
    });

    expect(prepared.mode).toBe('git_worktree');
    await expect(fs.stat(path.join(workspacePath, 'README.md'))).resolves.toBeTruthy();

    const described = await service.describeWorkspace({
      workspacePath,
    });
    expect(described.baseCommit).toBe(prepared.baseCommit);

    await service.cleanupWorkspace({
      baseRepoPath: repoDir,
      workspacePath,
    });
    await expect(fs.stat(workspacePath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
