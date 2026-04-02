import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { WorkspaceRuntimeModeSchema, type WorkspaceRuntimeMode } from '../contracts';
import { OrchestratorError } from '../utils/error';

const execFileAsync = promisify(execFile);

export type WorkspaceDescriptor = {
  workspacePath: string;
  baseRepoPath: string;
  baseCommit: string;
  mode: WorkspaceRuntimeMode;
  branchName?: string | undefined;
};

export interface GitProcessRunner {
  run(input: { args: readonly string[]; cwd: string }): Promise<{ stdout: string; stderr: string }>;
}

export class ExecFileGitProcessRunner implements GitProcessRunner {
  public async run(input: {
    args: readonly string[];
    cwd: string;
  }): Promise<{ stdout: string; stderr: string }> {
    const result = await execFileAsync('git', [...input.args], {
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
