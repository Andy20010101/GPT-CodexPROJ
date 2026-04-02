/* eslint-disable @typescript-eslint/require-await */
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { createOrchestratorRuntimeBundle } from '../../src';
import { FileExecutionRepository } from '../../src/storage/file-execution-repository';
import {
  buildArchitectureFreeze,
  buildRequirementFreeze,
  buildTask,
  createArtifactDir,
  createBridgeClient,
} from '../helpers/runtime-fixtures';

describe('ReleaseReviewService', () => {
  it('aggregates accepted task and execution evidence into a release review request', async () => {
    const artifactDir = await createArtifactDir('release-review-service-');
    const bundle = createOrchestratorRuntimeBundle({
      artifactDir,
      bridgeClient: createBridgeClient({
        releaseReviewPayload: {
          status: 'approved',
          summary: 'Release review approved the run.',
          findings: [],
          outstandingLimitations: [],
          recommendedActions: [],
        },
      }),
    });
    const run = await bundle.orchestratorService.createRun({
      title: 'Release review run',
      createdBy: 'tester',
    });
    await bundle.orchestratorService.saveRequirementFreeze(
      run.runId,
      buildRequirementFreeze(run.runId),
    );
    await bundle.orchestratorService.saveArchitectureFreeze(
      run.runId,
      buildArchitectureFreeze(run.runId),
    );
    const task = buildTask(run.runId, {
      status: 'accepted',
      title: 'Accepted task',
    });
    await bundle.taskRepository.saveTask(task);
    await bundle.runRepository.saveRun({
      ...run,
      stage: 'release_review',
      updatedAt: '2026-04-02T15:12:00.000Z',
    });
    await bundle.orchestratorService.appendEvidence({
      runId: run.runId,
      taskId: task.taskId,
      stage: 'release_review',
      kind: 'review_result',
      timestamp: '2026-04-02T15:12:00.000Z',
      producer: 'tester',
      artifactPaths: [path.join(artifactDir, 'review-result.json')],
      summary: 'Task review approved the task.',
      metadata: {
        reviewStatus: 'approved',
      },
    });
    const executionRepository = new FileExecutionRepository(artifactDir);
    const savedExecution = await executionRepository.saveResult({
      executionId: '99999999-9999-4999-8999-999999999999',
      runId: run.runId,
      taskId: task.taskId,
      executorType: 'noop',
      status: 'succeeded',
      startedAt: '2026-04-02T15:12:01.000Z',
      finishedAt: '2026-04-02T15:12:02.000Z',
      summary: 'Execution completed successfully.',
      patchSummary: {
        changedFiles: ['apps/orchestrator/src/services/runtime.ts'],
        addedLines: 10,
        removedLines: 0,
        notes: ['Saved for release review aggregation.'],
      },
      testResults: [
        {
          suite: 'vitest',
          status: 'passed',
          passed: 2,
          failed: 0,
          skipped: 0,
        },
      ],
      artifacts: [],
      stdout: '',
      stderr: '',
      exitCode: 0,
      metadata: {},
    });
    await bundle.orchestratorService.appendEvidence({
      runId: run.runId,
      taskId: task.taskId,
      stage: 'release_review',
      kind: 'execution_result',
      timestamp: '2026-04-02T15:12:01.000Z',
      producer: 'tester',
      artifactPaths: [savedExecution.resultPath],
      summary: 'Execution completed successfully.',
      metadata: {},
    });
    await bundle.releaseReviewService.reviewRun({
      run: await bundle.runRepository.getRun(run.runId),
      producer: 'tester',
    });

    const releaseResults = await bundle.releaseRepository.listResultsForRun(run.runId);
    expect(releaseResults).toHaveLength(1);
    const requestPath = path.join(
      artifactDir,
      'runs',
      run.runId,
      'releases',
      releaseResults[0]!.releaseReviewId,
      'request.json',
    );
    const savedRequest = JSON.parse(await fs.readFile(requestPath, 'utf8')) as {
      acceptedTasks: Array<{ taskId: string }>;
      runSummary: string;
    };
    expect(savedRequest.acceptedTasks[0]?.taskId).toBe(task.taskId);
    expect(savedRequest.runSummary).toContain('1 accepted task');
  });
});
