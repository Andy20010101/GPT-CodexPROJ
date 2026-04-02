import path from 'node:path';

import {
  ReviewRequestSchema,
  ReviewResultSchema,
  type ReviewRequest,
  type ReviewResult,
} from '../contracts';
import { readJsonFile, writeJsonFile, writeTextFile } from '../utils/file-store';
import { getReviewRequestFile, getReviewResultFile, getReviewRoot } from '../utils/run-paths';

export class FileReviewRepository {
  public constructor(private readonly artifactDir: string) {}

  public async saveRequest(
    request: ReviewRequest,
  ): Promise<{ reviewDir: string; requestPath: string }> {
    const parsedRequest = ReviewRequestSchema.parse(request);
    const requestPath = getReviewRequestFile(
      this.artifactDir,
      parsedRequest.runId,
      parsedRequest.reviewId,
    );
    await writeJsonFile(requestPath, parsedRequest);
    return {
      reviewDir: path.dirname(requestPath),
      requestPath,
    };
  }

  public async saveResult(input: {
    result: ReviewResult;
    markdown?: string | undefined;
    structuredReview?: Record<string, unknown> | undefined;
  }): Promise<{
    markdownPath?: string | undefined;
    result: ReviewResult;
    resultPath: string;
    reviewDir: string;
    structuredReviewPath?: string | undefined;
  }> {
    const parsedResult = ReviewResultSchema.parse(input.result);
    const reviewDir = getReviewRoot(this.artifactDir, parsedResult.runId, parsedResult.reviewId);

    let markdownPath: string | undefined;
    if (input.markdown) {
      markdownPath = path.join(reviewDir, 'review.md');
      await writeTextFile(markdownPath, input.markdown);
    }

    let structuredReviewPath: string | undefined;
    if (input.structuredReview) {
      structuredReviewPath = path.join(reviewDir, 'structured-review.json');
      await writeJsonFile(structuredReviewPath, input.structuredReview);
    }

    const resultPath = getReviewResultFile(
      this.artifactDir,
      parsedResult.runId,
      parsedResult.reviewId,
    );
    await writeJsonFile(resultPath, parsedResult);

    return {
      ...(markdownPath ? { markdownPath } : {}),
      result: parsedResult,
      resultPath,
      reviewDir,
      ...(structuredReviewPath ? { structuredReviewPath } : {}),
    };
  }

  public async getResult(runId: string, reviewId: string): Promise<ReviewResult | null> {
    const resultPath = getReviewResultFile(this.artifactDir, runId, reviewId);
    const raw = await readJsonFile<ReviewResult>(resultPath);
    return raw ? ReviewResultSchema.parse(raw) : null;
  }

  public async listResultsForRun(runId: string): Promise<ReviewResult[]> {
    const directoryPath = path.join(this.artifactDir, 'runs', runId, 'reviews');
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

    const results: ReviewResult[] = [];
    for (const entry of entries
      .filter((item) => item.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const raw = await readJsonFile<ReviewResult>(
        path.join(directoryPath, entry.name, 'result.json'),
      );
      if (raw) {
        results.push(ReviewResultSchema.parse(raw));
      }
    }

    return results;
  }
}
