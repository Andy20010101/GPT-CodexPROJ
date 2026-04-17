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

  it('overlays allowed source files, including untracked files, onto the workspace', async () => {
    const repoDir = await createGitRepo();
    await fs.mkdir(path.join(repoDir, 'scripts'), { recursive: true });
    await fs.writeFile(path.join(repoDir, 'README.md'), '# repo changed\n', 'utf8');
    await fs.writeFile(path.join(repoDir, 'scripts', 'self-improvement-env.ts'), 'export {};\n', 'utf8');
    await fs.writeFile(path.join(repoDir, 'ignored.txt'), 'ignore me\n', 'utf8');

    const worktreeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'worktree-service-overlay-'));
    const workspacePath = path.join(worktreeRoot, 'task-worktree');
    const service = new WorktreeService();

    await service.prepareWorkspace({
      baseRepoPath: repoDir,
      workspacePath,
    });
    const summary = await service.syncSourceOverlay({
      baseRepoPath: repoDir,
      workspacePath,
      includePaths: ['README.md', 'scripts/self-improvement-env.ts'],
    });

    await expect(fs.readFile(path.join(workspacePath, 'README.md'), 'utf8')).resolves.toBe(
      '# repo changed\n',
    );
    await expect(
      fs.readFile(path.join(workspacePath, 'scripts', 'self-improvement-env.ts'), 'utf8'),
    ).resolves.toBe('export {};\n');
    await expect(fs.stat(path.join(workspacePath, 'ignored.txt'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(summary.copiedPaths).toEqual(['README.md', 'scripts/self-improvement-env.ts']);
    expect(summary.deletedPaths).toEqual([]);

    await service.cleanupWorkspace({
      baseRepoPath: repoDir,
      workspacePath,
    });
  });
});
