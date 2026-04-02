import path from 'node:path';

import { JobRecordSchema, type JobRecord } from '../contracts';
import { OrchestratorError } from '../utils/error';
import { readJsonFile, readJsonFilesInDirectory, writeJsonFile } from '../utils/file-store';
import { getJobFile, getJobsRoot, getRunsRoot } from '../utils/run-paths';

export class FileJobRepository {
  public constructor(private readonly artifactDir: string) {}

  public async saveJob(job: JobRecord): Promise<string> {
    const outputPath = getJobFile(this.artifactDir, job.runId, job.jobId);
    await writeJsonFile(outputPath, JobRecordSchema.parse(job));
    return outputPath;
  }

  public async getJob(runId: string, jobId: string): Promise<JobRecord> {
    const outputPath = getJobFile(this.artifactDir, runId, jobId);
    const raw = await readJsonFile<JobRecord>(outputPath);
    if (!raw) {
      throw new OrchestratorError('JOB_NOT_FOUND', `Job ${jobId} was not found`, {
        runId,
        jobId,
      });
    }

    return JobRecordSchema.parse(raw);
  }

  public async findJob(jobId: string): Promise<JobRecord | null> {
    const runsRoot = getRunsRoot(this.artifactDir);
    const fs = await import('node:fs/promises');
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(runsRoot, { withFileTypes: true });
    } catch (error) {
      const castError = error as NodeJS.ErrnoException;
      if (castError.code === 'ENOENT') {
        return null;
      }
      throw error;
    }

    for (const entry of entries
      .filter((item) => item.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const outputPath = path.join(runsRoot, entry.name, 'jobs', `${jobId}.json`);
      const raw = await readJsonFile<JobRecord>(outputPath);
      if (raw) {
        return JobRecordSchema.parse(raw);
      }
    }

    return null;
  }

  public async listJobsForRun(runId: string): Promise<JobRecord[]> {
    const raw = await readJsonFilesInDirectory<JobRecord>(getJobsRoot(this.artifactDir, runId));
    return raw.map((entry) => JobRecordSchema.parse(entry));
  }
}
