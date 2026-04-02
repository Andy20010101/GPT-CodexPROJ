import { HeartbeatRecordSchema, type HeartbeatRecord } from '../contracts';
import { readJsonFilesInDirectory, writeJsonFile } from '../utils/file-store';
import {
  getRunHeartbeatFile,
  getRunHeartbeatsRoot,
  getRuntimeHeartbeatFile,
  getRuntimeHeartbeatsRoot,
} from '../utils/run-paths';

export class FileHeartbeatRepository {
  public constructor(private readonly artifactDir: string) {}

  public async saveHeartbeat(heartbeat: HeartbeatRecord): Promise<{
    globalPath: string;
    runPath?: string | undefined;
  }> {
    const parsed = HeartbeatRecordSchema.parse(heartbeat);
    const globalPath = getRuntimeHeartbeatFile(this.artifactDir, parsed.heartbeatId);
    await writeJsonFile(globalPath, parsed);

    let runPath: string | undefined;
    if (parsed.runId) {
      runPath = getRunHeartbeatFile(this.artifactDir, parsed.runId, parsed.heartbeatId);
      await writeJsonFile(runPath, parsed);
    }

    return {
      globalPath,
      ...(runPath ? { runPath } : {}),
    };
  }

  public async listHeartbeats(): Promise<HeartbeatRecord[]> {
    const raw = await readJsonFilesInDirectory<HeartbeatRecord>(
      getRuntimeHeartbeatsRoot(this.artifactDir),
    );
    return raw.map((entry) => HeartbeatRecordSchema.parse(entry));
  }

  public async listHeartbeatsForRun(runId: string): Promise<HeartbeatRecord[]> {
    const raw = await readJsonFilesInDirectory<HeartbeatRecord>(
      getRunHeartbeatsRoot(this.artifactDir, runId),
    );
    return raw.map((entry) => HeartbeatRecordSchema.parse(entry));
  }
}
