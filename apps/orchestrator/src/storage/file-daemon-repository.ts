import {
  DaemonStateSchema,
  RuntimeMetricsSchema,
  type DaemonState,
  type RuntimeMetrics,
} from '../contracts';
import { readJsonFile, writeJsonFile } from '../utils/file-store';
import {
  getRunDaemonStateFile,
  getRuntimeDaemonStateFile,
  getRuntimeMetricsFile,
} from '../utils/run-paths';

export class FileDaemonRepository {
  public constructor(private readonly artifactDir: string) {}

  public async saveDaemonState(
    state: DaemonState,
    runId?: string | undefined,
  ): Promise<{
    globalPath: string;
    runPath?: string | undefined;
  }> {
    const parsed = DaemonStateSchema.parse(state);
    const globalPath = getRuntimeDaemonStateFile(this.artifactDir);
    await writeJsonFile(globalPath, parsed);

    let runPath: string | undefined;
    if (runId) {
      runPath = getRunDaemonStateFile(this.artifactDir, runId);
      await writeJsonFile(runPath, parsed);
    }

    return {
      globalPath,
      ...(runPath ? { runPath } : {}),
    };
  }

  public async getDaemonState(): Promise<DaemonState | null> {
    const raw = await readJsonFile<DaemonState>(getRuntimeDaemonStateFile(this.artifactDir));
    return raw ? DaemonStateSchema.parse(raw) : null;
  }

  public async saveRuntimeMetrics(metrics: RuntimeMetrics): Promise<string> {
    const outputPath = getRuntimeMetricsFile(this.artifactDir);
    await writeJsonFile(outputPath, RuntimeMetricsSchema.parse(metrics));
    return outputPath;
  }

  public async getRuntimeMetrics(): Promise<RuntimeMetrics | null> {
    const raw = await readJsonFile<RuntimeMetrics>(getRuntimeMetricsFile(this.artifactDir));
    return raw ? RuntimeMetricsSchema.parse(raw) : null;
  }
}
