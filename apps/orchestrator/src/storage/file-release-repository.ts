import path from 'node:path';

import {
  ReleaseAcceptanceSchema,
  ReleaseReviewRequestSchema,
  ReleaseReviewResultSchema,
  type ReleaseAcceptance,
  type ReleaseReviewRequest,
  type ReleaseReviewResult,
} from '../contracts';
import { readJsonFile, writeJsonFile, writeTextFile } from '../utils/file-store';
import {
  getReleaseRequestFile,
  getReleaseResultFile,
  getReleaseRoot,
  getRunAcceptanceFile,
} from '../utils/run-paths';

export class FileReleaseRepository {
  public constructor(private readonly artifactDir: string) {}

  public async saveRequest(
    request: ReleaseReviewRequest,
  ): Promise<{ releaseDir: string; requestPath: string }> {
    const parsed = ReleaseReviewRequestSchema.parse(request);
    const requestPath = getReleaseRequestFile(
      this.artifactDir,
      parsed.runId,
      parsed.releaseReviewId,
    );
    await writeJsonFile(requestPath, parsed);
    return {
      releaseDir: path.dirname(requestPath),
      requestPath,
    };
  }

  public async saveResult(input: {
    result: ReleaseReviewResult;
    markdown?: string | undefined;
    structuredReview?: Record<string, unknown> | undefined;
  }): Promise<{
    releaseDir: string;
    resultPath: string;
    markdownPath?: string | undefined;
    structuredReviewPath?: string | undefined;
  }> {
    const parsed = ReleaseReviewResultSchema.parse(input.result);
    const releaseDir = getReleaseRoot(this.artifactDir, parsed.runId, parsed.releaseReviewId);
    let markdownPath: string | undefined;
    if (input.markdown) {
      markdownPath = path.join(releaseDir, 'review.md');
      await writeTextFile(markdownPath, input.markdown);
    }

    let structuredReviewPath: string | undefined;
    if (input.structuredReview) {
      structuredReviewPath = path.join(releaseDir, 'structured-review.json');
      await writeJsonFile(structuredReviewPath, input.structuredReview);
    }

    const resultPath = getReleaseResultFile(this.artifactDir, parsed.runId, parsed.releaseReviewId);
    await writeJsonFile(resultPath, parsed);

    return {
      releaseDir,
      resultPath,
      ...(markdownPath ? { markdownPath } : {}),
      ...(structuredReviewPath ? { structuredReviewPath } : {}),
    };
  }

  public async listResultsForRun(runId: string): Promise<ReleaseReviewResult[]> {
    const directoryPath = path.join(this.artifactDir, 'runs', runId, 'releases');
    const fs = await import('node:fs/promises');
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(directoryPath, { withFileTypes: true });
    } catch (error) {
      const castError = error as NodeJS.ErrnoException;
      if (castError.code === 'ENOENT') {
        return [];
      }
      throw error;
    }

    const results: ReleaseReviewResult[] = [];
    for (const entry of entries
      .filter((item) => item.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const raw = await readJsonFile<ReleaseReviewResult>(
        path.join(directoryPath, entry.name, 'result.json'),
      );
      if (raw) {
        results.push(ReleaseReviewResultSchema.parse(raw));
      }
    }

    return results;
  }

  public async getLatestResult(runId: string): Promise<ReleaseReviewResult | null> {
    const results = await this.listResultsForRun(runId);
    return (
      results.sort((left, right) => left.timestamp.localeCompare(right.timestamp)).at(-1) ?? null
    );
  }

  public async saveAcceptance(record: ReleaseAcceptance): Promise<string> {
    const outputPath = getRunAcceptanceFile(this.artifactDir, record.runId);
    await writeJsonFile(outputPath, ReleaseAcceptanceSchema.parse(record));
    return outputPath;
  }

  public async getAcceptance(runId: string): Promise<ReleaseAcceptance | null> {
    const raw = await readJsonFile<ReleaseAcceptance>(
      getRunAcceptanceFile(this.artifactDir, runId),
    );
    return raw ? ReleaseAcceptanceSchema.parse(raw) : null;
  }
}
