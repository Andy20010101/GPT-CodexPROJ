import { readJsonFile, readJsonFilesInDirectory, writeJsonFile } from '../utils/file-store';
import { getRuntimeProcessFile, getRuntimeProcessesRoot } from '../utils/run-paths';
import { ProcessHandleSchema, type ProcessHandle } from '../contracts';

export class FileProcessRepository {
  public constructor(private readonly artifactDir: string) {}

  public async saveProcessHandle(record: ProcessHandle): Promise<string> {
    const outputPath = getRuntimeProcessFile(this.artifactDir, record.processHandleId);
    await writeJsonFile(outputPath, ProcessHandleSchema.parse(record));
    return outputPath;
  }

  public async getProcessHandle(processHandleId: string): Promise<ProcessHandle | null> {
    const raw = await readJsonFile<ProcessHandle>(
      getRuntimeProcessFile(this.artifactDir, processHandleId),
    );
    return raw ? ProcessHandleSchema.parse(raw) : null;
  }

  public async listProcessHandles(): Promise<ProcessHandle[]> {
    const raw = await readJsonFilesInDirectory<ProcessHandle>(
      getRuntimeProcessesRoot(this.artifactDir),
    );
    return raw.map((entry) => ProcessHandleSchema.parse(entry));
  }

  public async findLatestByJob(jobId: string): Promise<ProcessHandle | null> {
    const records = await this.listProcessHandles();
    return (
      records
        .filter((entry) => entry.jobId === jobId)
        .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
        .at(-1) ?? null
    );
  }
}
