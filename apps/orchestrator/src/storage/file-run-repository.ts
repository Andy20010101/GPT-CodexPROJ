import path from 'node:path';

import {
  ArchitectureFreezeSchema,
  RequirementFreezeSchema,
  type ArchitectureFreeze,
  type RequirementFreeze,
} from '../contracts';
import { type RunRecord, RunRecordSchema } from '../domain/run';
import { OrchestratorError } from '../utils/error';
import { readJsonFile, writeJsonFile } from '../utils/file-store';
import { getRunFile, getRunRoot, getRunsRoot } from '../utils/run-paths';

export class FileRunRepository {
  public constructor(private readonly artifactDir: string) {}

  public async createRun(run: RunRecord): Promise<RunRecord> {
    await this.saveRun(run);
    return run;
  }

  public async saveRun(run: RunRecord): Promise<RunRecord> {
    const outputPath = getRunFile(this.artifactDir, run.runId);
    await writeJsonFile(outputPath, RunRecordSchema.parse(run));
    return run;
  }

  public async getRun(runId: string): Promise<RunRecord> {
    const outputPath = getRunFile(this.artifactDir, runId);
    const raw = await readJsonFile<RunRecord>(outputPath);
    if (!raw) {
      throw new OrchestratorError('RUN_NOT_FOUND', `Run ${runId} was not found`, { runId });
    }
    return RunRecordSchema.parse(raw);
  }

  public async listRuns(): Promise<RunRecord[]> {
    const runsRoot = getRunsRoot(this.artifactDir);
    const fs = await import('node:fs/promises');
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(runsRoot, { withFileTypes: true });
    } catch (error) {
      const castError = error as NodeJS.ErrnoException;
      if (castError.code === 'ENOENT') {
        return [];
      }
      throw error;
    }

    const runs: RunRecord[] = [];
    for (const entry of entries
      .filter((item) => item.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const raw = await readJsonFile<RunRecord>(getRunFile(this.artifactDir, entry.name));
      if (raw) {
        runs.push(RunRecordSchema.parse(raw));
      }
    }
    return runs;
  }

  public async saveRequirementFreeze(freeze: RequirementFreeze): Promise<string> {
    const outputPath = path.join(
      getRunRoot(this.artifactDir, freeze.runId),
      'requirement-freeze.json',
    );
    await writeJsonFile(outputPath, RequirementFreezeSchema.parse(freeze));
    return outputPath;
  }

  public async getRequirementFreeze(runId: string): Promise<RequirementFreeze | null> {
    const outputPath = path.join(getRunRoot(this.artifactDir, runId), 'requirement-freeze.json');
    const raw = await readJsonFile<RequirementFreeze>(outputPath);
    return raw ? RequirementFreezeSchema.parse(raw) : null;
  }

  public async saveArchitectureFreeze(freeze: ArchitectureFreeze): Promise<string> {
    const outputPath = path.join(
      getRunRoot(this.artifactDir, freeze.runId),
      'architecture-freeze.json',
    );
    await writeJsonFile(outputPath, ArchitectureFreezeSchema.parse(freeze));
    return outputPath;
  }

  public async getArchitectureFreeze(runId: string): Promise<ArchitectureFreeze | null> {
    const outputPath = path.join(getRunRoot(this.artifactDir, runId), 'architecture-freeze.json');
    const raw = await readJsonFile<ArchitectureFreeze>(outputPath);
    return raw ? ArchitectureFreezeSchema.parse(raw) : null;
  }
}
