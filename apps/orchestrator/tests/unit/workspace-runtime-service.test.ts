/* eslint-disable @typescript-eslint/require-await */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createRunRecord } from '../../src/domain/run';
import { EvidenceLedgerService } from '../../src/services/evidence-ledger-service';
import { WorkspaceRuntimeService } from '../../src/services/workspace-runtime-service';
import { WorktreeService } from '../../src/services/worktree-service';
import { FileEvidenceRepository } from '../../src/storage/file-evidence-repository';
import { FileWorkspaceRepository } from '../../src/storage/file-workspace-repository';

class FakeWorktreeService extends WorktreeService {
  public override async prepareWorkspace(input: { baseRepoPath: string; workspacePath: string }) {
    await fs.mkdir(input.workspacePath, { recursive: true });
    return {
      workspacePath: input.workspacePath,
      baseRepoPath: input.baseRepoPath,
      baseCommit: 'abc123',
      mode: 'git_worktree' as const,
    };
  }

  public override async cleanupWorkspace(): Promise<void> {}

  public override async describeWorkspace(input: { workspacePath: string }) {
    return {
      workspacePath: input.workspacePath,
      baseRepoPath: '/tmp/base-repo',
      baseCommit: 'abc123',
      mode: 'git_worktree' as const,
    };
  }
}

describe('WorkspaceRuntimeService', () => {
  it('persists workspace runtime metadata and emits workspace evidence', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-runtime-artifacts-'));
    const workspaceBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-runtime-base-'));
    const workspaceRepository = new FileWorkspaceRepository(artifactDir);
    const evidenceRepository = new FileEvidenceRepository(artifactDir);
    const evidenceLedger = new EvidenceLedgerService(evidenceRepository);
    const service = new WorkspaceRuntimeService(
      workspaceBaseDir,
      workspaceRepository,
      evidenceLedger,
      new FakeWorktreeService(),
    );
    const run = createRunRecord({
      title: 'Workspace runtime',
      createdBy: 'tester',
      stage: 'task_execution',
    });
    const taskId = randomUUID();

    const record = await service.prepareWorkspace({
      run,
      taskId,
      executorType: 'codex',
      baseRepoPath: '/tmp/base-repo',
      metadata: {
        purpose: 'test',
      },
    });

    expect(record.status).toBe('prepared');
    expect(record.workspacePath).toContain(run.runId);
    const persisted = await workspaceRepository.getWorkspace(run.runId, record.workspaceId);
    expect(persisted.metadata).toEqual({
      purpose: 'test',
    });

    const evidence = await evidenceRepository.listEvidenceForTask(run.runId, taskId);
    expect(evidence.map((entry) => entry.kind)).toContain('workspace_runtime');
  });
});
