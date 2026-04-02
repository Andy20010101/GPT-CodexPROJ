import {
  WorkspaceCleanupRecordSchema,
  WorkspaceGcSummarySchema,
  WorkspaceLifecycleSchema,
  type WorkspaceCleanupRecord,
  type WorkspaceGcSummary,
  type WorkspaceLifecycle,
} from '../contracts';
import { readJsonFile, readJsonFilesInDirectory, writeJsonFile } from '../utils/file-store';
import {
  getRunsRoot,
  getRuntimeCleanupFile,
  getRuntimeGcFile,
  getRunWorkspacesRoot,
  getWorkspaceLifecycleFile,
} from '../utils/run-paths';

export class FileWorkspaceLifecycleRepository {
  public constructor(private readonly artifactDir: string) {}

  public async saveLifecycle(record: WorkspaceLifecycle): Promise<string> {
    const outputPath = getWorkspaceLifecycleFile(
      this.artifactDir,
      record.runId,
      record.workspaceId,
    );
    await writeJsonFile(outputPath, WorkspaceLifecycleSchema.parse(record));
    return outputPath;
  }

  public async getLifecycle(
    runId: string,
    workspaceId: string,
  ): Promise<WorkspaceLifecycle | null> {
    const raw = await readJsonFile<WorkspaceLifecycle>(
      getWorkspaceLifecycleFile(this.artifactDir, runId, workspaceId),
    );
    return raw ? WorkspaceLifecycleSchema.parse(raw) : null;
  }

  public async listForRun(runId: string): Promise<WorkspaceLifecycle[]> {
    const raw = await readJsonFilesInDirectory<WorkspaceLifecycle>(
      getRunWorkspacesRoot(this.artifactDir, runId),
    );
    return raw.map((entry) => WorkspaceLifecycleSchema.parse(entry));
  }

  public async listAll(): Promise<WorkspaceLifecycle[]> {
    const fs = await import('node:fs/promises');
    try {
      const entries = await fs.readdir(getRunsRoot(this.artifactDir), { withFileTypes: true });
      const records: WorkspaceLifecycle[] = [];
      for (const entry of entries.filter((item) => item.isDirectory())) {
        records.push(...(await this.listForRun(entry.name)));
      }
      return records;
    } catch (error) {
      const cast = error as NodeJS.ErrnoException;
      if (cast.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  public async saveCleanupRecord(record: WorkspaceCleanupRecord): Promise<string> {
    const outputPath = getRuntimeCleanupFile(this.artifactDir, record.cleanupId);
    await writeJsonFile(outputPath, WorkspaceCleanupRecordSchema.parse(record));
    return outputPath;
  }

  public async saveGcSummary(summary: WorkspaceGcSummary): Promise<string> {
    const outputPath = getRuntimeGcFile(this.artifactDir, summary.gcRunId);
    await writeJsonFile(outputPath, WorkspaceGcSummarySchema.parse(summary));
    return outputPath;
  }
}
