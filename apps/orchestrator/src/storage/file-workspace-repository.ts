import { WorkspaceRuntimeSchema, type WorkspaceRuntime } from '../contracts';
import { OrchestratorError } from '../utils/error';
import { readJsonFile, readJsonFilesInDirectory, writeJsonFile } from '../utils/file-store';
import { getRunRoot, getWorkspaceRecordFile } from '../utils/run-paths';
import path from 'node:path';

export class FileWorkspaceRepository {
  public constructor(private readonly artifactDir: string) {}

  public async saveWorkspace(record: WorkspaceRuntime): Promise<string> {
    const outputPath = getWorkspaceRecordFile(this.artifactDir, record.runId, record.workspaceId);
    await writeJsonFile(outputPath, WorkspaceRuntimeSchema.parse(record));
    return outputPath;
  }

  public async getWorkspace(runId: string, workspaceId: string): Promise<WorkspaceRuntime> {
    const outputPath = getWorkspaceRecordFile(this.artifactDir, runId, workspaceId);
    const raw = await readJsonFile<WorkspaceRuntime>(outputPath);
    if (!raw) {
      throw new OrchestratorError('WORKSPACE_NOT_FOUND', `Workspace ${workspaceId} was not found`, {
        runId,
        workspaceId,
      });
    }

    return WorkspaceRuntimeSchema.parse(raw);
  }

  public async listWorkspaces(runId: string): Promise<WorkspaceRuntime[]> {
    const directoryPath = path.join(getRunRoot(this.artifactDir, runId), 'workspace-runtime');
    const raw = await readJsonFilesInDirectory<WorkspaceRuntime>(directoryPath);
    return raw.map((value) => WorkspaceRuntimeSchema.parse(value));
  }
}
