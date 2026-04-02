import { readJsonFile, readJsonFilesInDirectory, writeJsonFile } from '../utils/file-store';
import {
  getRunRemediationFile,
  getRunRemediationRoot,
  getRuntimeRemediationFile,
  getRuntimeRemediationRoot,
} from '../utils/run-paths';
import { RemediationResultSchema, type RemediationResult } from '../contracts';

export class FileRemediationRepository {
  public constructor(private readonly artifactDir: string) {}

  public async saveResult(
    result: RemediationResult,
  ): Promise<{ globalPath: string; runPath: string }> {
    const parsed = RemediationResultSchema.parse(result);
    const globalPath = getRuntimeRemediationFile(this.artifactDir, parsed.remediationId);
    const runPath = getRunRemediationFile(this.artifactDir, parsed.runId, parsed.remediationId);
    await writeJsonFile(globalPath, parsed);
    await writeJsonFile(runPath, parsed);
    return { globalPath, runPath };
  }

  public async getResult(remediationId: string): Promise<RemediationResult | null> {
    const raw = await readJsonFile<RemediationResult>(
      getRuntimeRemediationFile(this.artifactDir, remediationId),
    );
    return raw ? RemediationResultSchema.parse(raw) : null;
  }

  public async listResults(runId?: string | undefined): Promise<RemediationResult[]> {
    const raw = await readJsonFilesInDirectory<RemediationResult>(
      runId
        ? getRunRemediationRoot(this.artifactDir, runId)
        : getRuntimeRemediationRoot(this.artifactDir),
    );
    return raw.map((entry) => RemediationResultSchema.parse(entry));
  }
}
