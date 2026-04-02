import { readJsonFile, readJsonFilesInDirectory, writeJsonFile } from '../utils/file-store';
import { getRunCancellationFile, getRunCancellationsRoot, getRunsRoot } from '../utils/run-paths';
import {
  CancellationRequestSchema,
  CancellationResultSchema,
  type CancellationRequest,
  type CancellationResult,
} from '../contracts';

export type CancellationEnvelope = {
  request: CancellationRequest;
  result?: CancellationResult | undefined;
};

export class FileCancellationRepository {
  public constructor(private readonly artifactDir: string) {}

  public async saveRequest(request: CancellationRequest): Promise<{
    path: string;
    envelope: CancellationEnvelope;
  }> {
    const parsed = CancellationRequestSchema.parse(request);
    const current = await this.readEnvelope(parsed.runId, parsed.cancellationId);
    const envelope: CancellationEnvelope = {
      request: parsed,
      result: current?.result,
    };
    const path = getRunCancellationFile(this.artifactDir, parsed.runId, parsed.cancellationId);
    await writeJsonFile(path, envelope);
    return { path, envelope };
  }

  public async saveResult(
    request: CancellationRequest,
    result: CancellationResult,
  ): Promise<{
    path: string;
    envelope: CancellationEnvelope;
  }> {
    const parsedRequest = CancellationRequestSchema.parse(request);
    const parsedResult = CancellationResultSchema.parse(result);
    const envelope: CancellationEnvelope = {
      request: parsedRequest,
      result: parsedResult,
    };
    const path = getRunCancellationFile(
      this.artifactDir,
      parsedRequest.runId,
      parsedRequest.cancellationId,
    );
    await writeJsonFile(path, envelope);
    return { path, envelope };
  }

  public async listForRun(runId: string): Promise<CancellationEnvelope[]> {
    return readJsonFilesInDirectory<CancellationEnvelope>(
      getRunCancellationsRoot(this.artifactDir, runId),
    );
  }

  public async findLatestForJob(jobId: string): Promise<CancellationEnvelope | null> {
    const fs = await import('node:fs/promises');
    let runEntries: import('node:fs').Dirent[];
    try {
      runEntries = await fs.readdir(getRunsRoot(this.artifactDir), { withFileTypes: true });
    } catch (error) {
      const castError = error as NodeJS.ErrnoException;
      if (castError.code === 'ENOENT') {
        return null;
      }
      throw error;
    }

    const matches: CancellationEnvelope[] = [];
    for (const runEntry of runEntries
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const envelopes = await this.listForRun(runEntry.name);
      matches.push(...envelopes.filter((envelope) => envelope.request.jobId === jobId));
    }

    return (
      matches
        .sort((left, right) => left.request.requestedAt.localeCompare(right.request.requestedAt))
        .at(-1) ?? null
    );
  }

  private async readEnvelope(
    runId: string,
    cancellationId: string,
  ): Promise<CancellationEnvelope | null> {
    return readJsonFile<CancellationEnvelope>(
      getRunCancellationFile(this.artifactDir, runId, cancellationId),
    );
  }
}
