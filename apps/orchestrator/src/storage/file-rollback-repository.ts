import { readJsonFile, readJsonFilesInDirectory, writeJsonFile } from '../utils/file-store';
import {
  getRunRollbackFile,
  getRunRollbackRoot,
  getRuntimeRollbackFile,
  getRuntimeRollbackRoot,
} from '../utils/run-paths';
import { RollbackRecordSchema, type RollbackRecord } from '../contracts';

export class FileRollbackRepository {
  public constructor(private readonly artifactDir: string) {}

  public async saveRecord(
    record: RollbackRecord,
  ): Promise<{ globalPath: string; runPath: string }> {
    const parsed = RollbackRecordSchema.parse(record);
    const globalPath = getRuntimeRollbackFile(this.artifactDir, parsed.rollbackId);
    const runPath = getRunRollbackFile(this.artifactDir, parsed.runId, parsed.rollbackId);
    await writeJsonFile(globalPath, parsed);
    await writeJsonFile(runPath, parsed);
    return { globalPath, runPath };
  }

  public async getRecord(rollbackId: string): Promise<RollbackRecord | null> {
    const raw = await readJsonFile<RollbackRecord>(
      getRuntimeRollbackFile(this.artifactDir, rollbackId),
    );
    return raw ? RollbackRecordSchema.parse(raw) : null;
  }

  public async listRecords(runId?: string | undefined): Promise<RollbackRecord[]> {
    const raw = await readJsonFilesInDirectory<RollbackRecord>(
      runId
        ? getRunRollbackRoot(this.artifactDir, runId)
        : getRuntimeRollbackRoot(this.artifactDir),
    );
    return raw.map((entry) => RollbackRecordSchema.parse(entry));
  }
}
