import { readJsonFile, readJsonFilesInDirectory, writeJsonFile } from '../utils/file-store';
import {
  getRunSnapshotFile,
  getRunSnapshotsRoot,
  getRuntimeSnapshotFile,
  getRuntimeSnapshotsRoot,
} from '../utils/run-paths';
import { DebugSnapshotSchema, type DebugSnapshot } from '../contracts';

export class FileDebugSnapshotRepository {
  public constructor(private readonly artifactDir: string) {}

  public async saveSnapshot(
    snapshot: DebugSnapshot,
  ): Promise<{ globalPath: string; runPath: string }> {
    const parsed = DebugSnapshotSchema.parse(snapshot);
    const globalPath = getRuntimeSnapshotFile(this.artifactDir, parsed.snapshotId);
    const runPath = getRunSnapshotFile(this.artifactDir, parsed.runId, parsed.snapshotId);
    await writeJsonFile(globalPath, parsed);
    await writeJsonFile(runPath, parsed);
    return { globalPath, runPath };
  }

  public async getSnapshot(snapshotId: string): Promise<DebugSnapshot | null> {
    const raw = await readJsonFile<DebugSnapshot>(
      getRuntimeSnapshotFile(this.artifactDir, snapshotId),
    );
    return raw ? DebugSnapshotSchema.parse(raw) : null;
  }

  public async listSnapshots(runId?: string | undefined): Promise<DebugSnapshot[]> {
    const raw = await readJsonFilesInDirectory<DebugSnapshot>(
      runId
        ? getRunSnapshotsRoot(this.artifactDir, runId)
        : getRuntimeSnapshotsRoot(this.artifactDir),
    );
    return raw.map((entry) => DebugSnapshotSchema.parse(entry));
  }
}
