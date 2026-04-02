import path from 'node:path';

import { QueueStateSchema, type QueueState } from '../contracts';
import { readJsonFile, writeJsonFile } from '../utils/file-store';
import { getQueueRoot, getQueueStateFile } from '../utils/run-paths';

export class FileQueueRepository {
  public constructor(private readonly artifactDir: string) {}

  public async saveQueueState(state: QueueState): Promise<string> {
    const outputPath = getQueueStateFile(this.artifactDir, state.runId);
    await writeJsonFile(outputPath, QueueStateSchema.parse(state));
    return outputPath;
  }

  public async getQueueState(runId: string): Promise<QueueState | null> {
    const raw = await readJsonFile<QueueState>(getQueueStateFile(this.artifactDir, runId));
    return raw ? QueueStateSchema.parse(raw) : null;
  }

  public async saveRecoverySummary(runId: string, summary: unknown): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPath = path.join(
      getQueueRoot(this.artifactDir, runId),
      `recovery-${timestamp}.json`,
    );
    await writeJsonFile(outputPath, summary);
    return outputPath;
  }
}
