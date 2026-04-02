import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  ExecutionArtifactSchema,
  ExecutionRequestSchema,
  ExecutionResultSchema,
  type ExecutionArtifact,
  type ExecutionRequest,
  type ExecutionResult,
  type TestResult,
} from '../contracts';
import { ensureDirectory, readJsonFile, writeJsonFile, writeTextFile } from '../utils/file-store';
import {
  getExecutionRequestFile,
  getExecutionResultFile,
  getExecutionRoot,
  getRunRoot,
} from '../utils/run-paths';

export class FileExecutionRepository {
  public constructor(private readonly artifactDir: string) {}

  public async saveRequest(
    request: ExecutionRequest,
  ): Promise<{ executionDir: string; requestPath: string }> {
    const parsedRequest = ExecutionRequestSchema.parse(request);
    const requestPath = getExecutionRequestFile(
      this.artifactDir,
      parsedRequest.runId,
      parsedRequest.executionId,
    );
    await writeJsonFile(requestPath, parsedRequest);
    return {
      executionDir: path.dirname(requestPath),
      requestPath,
    };
  }

  public async saveResult(
    result: ExecutionResult,
  ): Promise<{ executionDir: string; result: ExecutionResult; resultPath: string }> {
    const parsedResult = ExecutionResultSchema.parse(result);
    const executionDir = getExecutionRoot(
      this.artifactDir,
      parsedResult.runId,
      parsedResult.executionId,
    );
    await ensureDirectory(executionDir);

    const stdoutPath = path.join(executionDir, 'stdout.log');
    const stderrPath = path.join(executionDir, 'stderr.log');
    await writeTextFile(stdoutPath, parsedResult.stdout);
    await writeTextFile(stderrPath, parsedResult.stderr);

    const testResultsPath = path.join(executionDir, 'test-results.json');
    if (parsedResult.testResults.length > 0) {
      await writeJsonFile(testResultsPath, parsedResult.testResults);
    }

    const materializedArtifacts = await this.materializeArtifacts(
      executionDir,
      parsedResult.artifacts,
    );

    const artifacts = [...materializedArtifacts];
    const patchArtifact = artifacts.find((artifact) => artifact.kind === 'patch');
    const patchSummary =
      parsedResult.patchSummary.patchPath || !patchArtifact?.path
        ? parsedResult.patchSummary
        : {
            ...parsedResult.patchSummary,
            patchPath: patchArtifact.path,
          };

    if (parsedResult.stdout.trim().length > 0) {
      artifacts.push(
        ExecutionArtifactSchema.parse({
          artifactId: randomUUID(),
          kind: 'command-log',
          label: 'stdout',
          path: stdoutPath,
          metadata: {
            stream: 'stdout',
          },
        }),
      );
    }

    if (parsedResult.stderr.trim().length > 0) {
      artifacts.push(
        ExecutionArtifactSchema.parse({
          artifactId: randomUUID(),
          kind: 'command-log',
          label: 'stderr',
          path: stderrPath,
          metadata: {
            stream: 'stderr',
          },
        }),
      );
    }

    const testResults = parsedResult.testResults.map((entry) =>
      entry.rawArtifactPath || parsedResult.testResults.length === 0
        ? entry
        : ({ ...entry, rawArtifactPath: testResultsPath } satisfies TestResult),
    );

    if (parsedResult.testResults.length > 0) {
      artifacts.push(
        ExecutionArtifactSchema.parse({
          artifactId: randomUUID(),
          kind: 'test-log',
          label: 'test-results',
          path: testResultsPath,
          metadata: {
            source: 'execution-result',
          },
        }),
      );
    }

    const persistedResult = ExecutionResultSchema.parse({
      ...parsedResult,
      patchSummary,
      testResults,
      artifacts,
    });

    const resultPath = getExecutionResultFile(
      this.artifactDir,
      persistedResult.runId,
      persistedResult.executionId,
    );
    await writeJsonFile(resultPath, persistedResult);

    return {
      executionDir,
      result: persistedResult,
      resultPath,
    };
  }

  public async getRequest(runId: string, executionId: string): Promise<ExecutionRequest | null> {
    const requestPath = getExecutionRequestFile(this.artifactDir, runId, executionId);
    const raw = await readJsonFile<ExecutionRequest>(requestPath);
    return raw ? ExecutionRequestSchema.parse(raw) : null;
  }

  public async getResult(runId: string, executionId: string): Promise<ExecutionResult | null> {
    const resultPath = getExecutionResultFile(this.artifactDir, runId, executionId);
    const raw = await readJsonFile<ExecutionResult>(resultPath);
    return raw ? ExecutionResultSchema.parse(raw) : null;
  }

  public async listResultsForTask(runId: string, taskId: string): Promise<ExecutionResult[]> {
    const executionsDir = path.join(getRunRoot(this.artifactDir, runId), 'executions');

    try {
      const entries = await fs.readdir(executionsDir, { withFileTypes: true });
      const results: ExecutionResult[] = [];

      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (!entry.isDirectory()) {
          continue;
        }
        const result = await this.getResult(runId, entry.name);
        if (result && result.taskId === taskId) {
          results.push(result);
        }
      }

      return results;
    } catch (error) {
      const castError = error as NodeJS.ErrnoException;
      if (castError.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  private async materializeArtifacts(
    executionDir: string,
    artifacts: readonly ExecutionArtifact[],
  ): Promise<ExecutionArtifact[]> {
    const materialized: ExecutionArtifact[] = [];

    for (const [index, artifact] of artifacts.entries()) {
      if (artifact.path) {
        materialized.push(ExecutionArtifactSchema.parse(artifact));
        continue;
      }

      if (!artifact.content) {
        materialized.push(ExecutionArtifactSchema.parse(artifact));
        continue;
      }

      const fileName = this.buildArtifactFileName(artifact, index);
      const outputPath = path.join(executionDir, fileName);
      await writeTextFile(outputPath, artifact.content);
      materialized.push(
        ExecutionArtifactSchema.parse({
          ...artifact,
          path: outputPath,
        }),
      );
    }

    return materialized;
  }

  private buildArtifactFileName(artifact: ExecutionArtifact, index: number): string {
    const normalizedLabel = artifact.label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const extensionByKind: Record<ExecutionArtifact['kind'], string> = {
      patch: 'diff',
      'test-log': 'log',
      'command-log': 'log',
      'review-input': 'md',
      'review-output': 'md',
      'build-log': 'log',
    };
    const extension = extensionByKind[artifact.kind];
    return `${String(index + 1).padStart(2, '0')}-${artifact.kind}-${normalizedLabel}.${extension}`;
  }
}
