import { readJsonFile, writeJsonFile } from '../utils/file-store';
import { getRuntimeSchedulingStateFile } from '../utils/run-paths';
import { SchedulingStateSchema, type SchedulingState } from '../contracts';

export class FileSchedulingRepository {
  public constructor(private readonly artifactDir: string) {}

  public async saveState(state: SchedulingState): Promise<string> {
    const outputPath = getRuntimeSchedulingStateFile(this.artifactDir);
    await writeJsonFile(outputPath, SchedulingStateSchema.parse(state));
    return outputPath;
  }

  public async getState(): Promise<SchedulingState | null> {
    const raw = await readJsonFile<SchedulingState>(
      getRuntimeSchedulingStateFile(this.artifactDir),
    );
    return raw ? SchedulingStateSchema.parse(raw) : null;
  }
}
