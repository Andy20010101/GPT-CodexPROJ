import {
  WorkerLeaseSchema,
  WorkerRecordSchema,
  type WorkerLease,
  type WorkerRecord,
} from '../contracts';
import { readJsonFile, readJsonFilesInDirectory, writeJsonFile } from '../utils/file-store';
import {
  getRunWorkerFile,
  getRuntimeLeaseFile,
  getRuntimeLeasesRoot,
  getRuntimeWorkerFile,
  getRuntimeWorkersRoot,
} from '../utils/run-paths';

export class FileWorkerRepository {
  public constructor(private readonly artifactDir: string) {}

  public async saveWorker(
    worker: WorkerRecord,
    runId?: string | undefined,
  ): Promise<{
    globalPath: string;
    runPath?: string | undefined;
  }> {
    const parsed = WorkerRecordSchema.parse(worker);
    const globalPath = getRuntimeWorkerFile(this.artifactDir, parsed.workerId);
    await writeJsonFile(globalPath, parsed);

    let runPath: string | undefined;
    if (runId) {
      runPath = getRunWorkerFile(this.artifactDir, runId, parsed.workerId);
      await writeJsonFile(runPath, parsed);
    }

    return {
      globalPath,
      ...(runPath ? { runPath } : {}),
    };
  }

  public async getWorker(workerId: string): Promise<WorkerRecord | null> {
    const raw = await readJsonFile<WorkerRecord>(getRuntimeWorkerFile(this.artifactDir, workerId));
    return raw ? WorkerRecordSchema.parse(raw) : null;
  }

  public async listWorkers(): Promise<WorkerRecord[]> {
    const raw = await readJsonFilesInDirectory<WorkerRecord>(
      getRuntimeWorkersRoot(this.artifactDir),
    );
    return raw.map((entry) => WorkerRecordSchema.parse(entry));
  }

  public async saveLease(lease: WorkerLease): Promise<string> {
    const outputPath = getRuntimeLeaseFile(this.artifactDir, lease.jobId);
    await writeJsonFile(outputPath, WorkerLeaseSchema.parse(lease));
    return outputPath;
  }

  public async getLeaseByJob(jobId: string): Promise<WorkerLease | null> {
    const raw = await readJsonFile<WorkerLease>(getRuntimeLeaseFile(this.artifactDir, jobId));
    return raw ? WorkerLeaseSchema.parse(raw) : null;
  }

  public async listLeases(): Promise<WorkerLease[]> {
    const raw = await readJsonFilesInDirectory<WorkerLease>(getRuntimeLeasesRoot(this.artifactDir));
    return raw.map((entry) => WorkerLeaseSchema.parse(entry));
  }
}
