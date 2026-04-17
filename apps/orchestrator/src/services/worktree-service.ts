import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { WorkspaceRuntimeModeSchema, type WorkspaceRuntimeMode } from '../contracts';
import { OrchestratorError } from '../utils/error';
import { resolveGitExecutable } from '../utils/git-executable';

const execFileAsync = promisify(execFile);

export type WorkspaceDescriptor = {
  workspacePath: string;
  baseRepoPath: string;
  baseCommit: string;
  mode: WorkspaceRuntimeMode;
  branchName?: string | undefined;
};

export type WorkspaceOverlaySummary = {
  copiedPaths: string[];
  deletedPaths: string[];
};

export interface GitProcessRunner {
  run(input: { args: readonly string[]; cwd: string }): Promise<{ stdout: string; stderr: string }>;
}

export class ExecFileGitProcessRunner implements GitProcessRunner {
  public async run(input: {
    args: readonly string[];
    cwd: string;
  }): Promise<{ stdout: string; stderr: string }> {
    const result = await execFileAsync(resolveGitExecutable(), [...input.args], {
      cwd: input.cwd,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
}

export class WorktreeService {
  public constructor(
    private readonly gitRunner: GitProcessRunner = new ExecFileGitProcessRunner(),
  ) {}

  public async prepareWorkspace(input: {
    baseRepoPath: string;
    workspacePath: string;
    baseCommit?: string | undefined;
    mode?: WorkspaceRuntimeMode | undefined;
  }): Promise<WorkspaceDescriptor> {
    const mode = WorkspaceRuntimeModeSchema.parse(input.mode ?? 'git_worktree');
    if (mode !== 'git_worktree') {
      throw new OrchestratorError(
        'WORKSPACE_PREPARE_FAILED',
        'Only git_worktree mode is implemented in the current runtime shell.',
        { mode },
      );
    }

    try {
      await fs.mkdir(path.dirname(input.workspacePath), { recursive: true });
      const baseRepoPath = (
        await this.runGit(input.baseRepoPath, ['rev-parse', '--show-toplevel'])
      ).stdout.trim();
      const baseCommit =
        input.baseCommit ?? (await this.runGit(baseRepoPath, ['rev-parse', 'HEAD'])).stdout.trim();

      await this.runGit(baseRepoPath, [
        'worktree',
        'add',
        '--detach',
        input.workspacePath,
        baseCommit,
      ]);

      return {
        workspacePath: input.workspacePath,
        baseRepoPath,
        baseCommit,
        mode,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown worktree failure';
      throw new OrchestratorError(
        'WORKSPACE_PREPARE_FAILED',
        `Failed to prepare isolated workspace: ${message}`,
        {
          baseRepoPath: input.baseRepoPath,
          workspacePath: input.workspacePath,
        },
      );
    }
  }

  public async cleanupWorkspace(input: {
    baseRepoPath: string;
    workspacePath: string;
    mode?: WorkspaceRuntimeMode | undefined;
  }): Promise<void> {
    const mode = WorkspaceRuntimeModeSchema.parse(input.mode ?? 'git_worktree');
    if (mode !== 'git_worktree') {
      return;
    }

    await this.runGit(input.baseRepoPath, ['worktree', 'remove', '--force', input.workspacePath]);
  }

  public async describeWorkspace(input: {
    workspacePath: string;
    mode?: WorkspaceRuntimeMode | undefined;
  }): Promise<WorkspaceDescriptor> {
    const mode = WorkspaceRuntimeModeSchema.parse(input.mode ?? 'git_worktree');
    const baseRepoPath = (
      await this.runGit(input.workspacePath, ['rev-parse', '--show-toplevel'])
    ).stdout.trim();
    const baseCommit = (
      await this.runGit(input.workspacePath, ['rev-parse', 'HEAD'])
    ).stdout.trim();

    return {
      workspacePath: input.workspacePath,
      baseRepoPath,
      baseCommit,
      mode,
    };
  }

  public async syncSourceOverlay(input: {
    baseRepoPath: string;
    workspacePath: string;
    includePaths: readonly string[];
  }): Promise<WorkspaceOverlaySummary> {
    if (input.includePaths.length === 0) {
      return {
        copiedPaths: [],
        deletedPaths: [],
      };
    }

    const baseRepoPath = (
      await this.runGit(input.baseRepoPath, ['rev-parse', '--show-toplevel'])
    ).stdout.trim();
    const normalizedPatterns = input.includePaths.map((value) => normalizeRepoRelativePath(value));
    const copiedPaths = new Set<string>();
    const deletedPaths = new Set<string>();
    const exactPaths = normalizedPatterns.filter((value) => !hasGlobPattern(value));
    const globPatterns = normalizedPatterns.filter(hasGlobPattern);

    for (const relativePath of exactPaths) {
      const sourcePath = path.join(baseRepoPath, relativePath);
      const targetPath = path.join(input.workspacePath, relativePath);

      if (await pathExists(sourcePath)) {
        await copyPath(sourcePath, targetPath);
        copiedPaths.add(relativePath);
        continue;
      }

      if (await pathExists(targetPath)) {
        await fs.rm(targetPath, { force: true, recursive: true });
        deletedPaths.add(relativePath);
      }
    }

    if (globPatterns.length > 0) {
      const trackedAndUntracked = (
        await this.runGit(baseRepoPath, ['ls-files', '--cached', '--others', '--exclude-standard'])
      ).stdout
        .split('\n')
        .map((value) => normalizeRepoRelativePath(value))
        .filter((value) => value.length > 0);

      for (const relativePath of trackedAndUntracked) {
        if (!matchesAnyPattern(relativePath, globPatterns)) {
          continue;
        }

        const sourcePath = path.join(baseRepoPath, relativePath);
        if (!(await pathExists(sourcePath))) {
          continue;
        }

        const targetPath = path.join(input.workspacePath, relativePath);
        await copyPath(sourcePath, targetPath);
        copiedPaths.add(relativePath);
      }
    }

    return {
      copiedPaths: [...copiedPaths].sort(),
      deletedPaths: [...deletedPaths].sort(),
    };
  }

  private async runGit(
    cwd: string,
    args: readonly string[],
  ): Promise<{ stdout: string; stderr: string }> {
    return this.gitRunner.run({
      args,
      cwd,
    });
  }
}

function normalizeRepoRelativePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.?\//, '').trim();
}

function hasGlobPattern(value: string): boolean {
  return value.includes('*');
}

function matchesAnyPattern(candidatePath: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(candidatePath));
}

function globToRegExp(pattern: string): RegExp {
  let escaped = '';

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*') {
      const isGlobStar = pattern[index + 1] === '*';
      escaped += isGlobStar ? '.*' : '[^/]*';
      if (isGlobStar) {
        index += 1;
      }
      continue;
    }

    switch (character) {
      case '.':
      case '+':
      case '?':
      case '^':
      case '$':
      case '{':
      case '}':
      case '(':
      case ')':
      case '|':
      case '[':
      case ']':
      case '\\':
        escaped += `\\${character}`;
        break;
      default:
        escaped += character;
        break;
    }
  }

  return new RegExp(`^${escaped}$`);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function copyPath(sourcePath: string, targetPath: string): Promise<void> {
  const stat = await fs.stat(sourcePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });

  if (stat.isDirectory()) {
    await fs.cp(sourcePath, targetPath, {
      recursive: true,
      force: true,
    });
    return;
  }

  await fs.copyFile(sourcePath, targetPath);
  await fs.chmod(targetPath, stat.mode);
}
