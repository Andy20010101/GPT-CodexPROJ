import { readJsonFile, readJsonFilesInDirectory, writeJsonFile } from '../utils/file-store';
import {
  getRunFailureFile,
  getRunFailuresRoot,
  getRuntimeFailureFile,
  getRuntimeFailuresRoot,
} from '../utils/run-paths';
import { FailureRecordSchema, type FailureRecord } from '../contracts';

export class FileFailureRepository {
  public constructor(private readonly artifactDir: string) {}

  public async saveFailure(record: FailureRecord): Promise<{
    globalPath: string;
    runPath: string;
  }> {
    const parsed = FailureRecordSchema.parse(record);
    const globalPath = getRuntimeFailureFile(this.artifactDir, parsed.failureId);
    const runPath = getRunFailureFile(this.artifactDir, parsed.runId, parsed.failureId);
    await writeJsonFile(globalPath, parsed);
    await writeJsonFile(runPath, parsed);
    return {
      globalPath,
      runPath,
    };
  }

  public async getFailure(failureId: string): Promise<FailureRecord | null> {
    const raw = await readJsonFile<FailureRecord>(
      getRuntimeFailureFile(this.artifactDir, failureId),
    );
    return raw ? FailureRecordSchema.parse(raw) : null;
  }

  public async listFailuresForRun(runId: string): Promise<FailureRecord[]> {
    const raw = await readJsonFilesInDirectory<FailureRecord>(
      getRunFailuresRoot(this.artifactDir, runId),
    );
    return raw.map((entry) => FailureRecordSchema.parse(entry));
  }

  public async listFailures(): Promise<FailureRecord[]> {
    const raw = await readJsonFilesInDirectory<FailureRecord>(
      getRuntimeFailuresRoot(this.artifactDir),
    );
    return raw.map((entry) => FailureRecordSchema.parse(entry));
  }

  public async findLatestForJob(jobId: string): Promise<FailureRecord | null> {
    const failures = await this.listFailures();
    return (
      failures
        .filter((entry) => entry.jobId === jobId)
        .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
        .at(-1) ?? null
    );
  }
}
