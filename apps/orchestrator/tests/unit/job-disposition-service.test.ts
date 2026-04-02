import { describe, expect, it } from 'vitest';

import { createOrchestratorRuntimeBundle } from '../../src';
import { ExecutionResultSchema, JobRecordSchema } from '../../src/contracts';
import { createArtifactDir } from '../helpers/runtime-fixtures';

describe('JobDispositionService', () => {
  it('marks timeout failures as retriable when attempts remain', async () => {
    const artifactDir = await createArtifactDir('job-disposition-timeout-');
    const bundle = createOrchestratorRuntimeBundle({
      artifactDir,
    });
    const run = await bundle.orchestratorService.createRun({
      title: 'job disposition',
      createdBy: 'tester',
    });
    const job = JobRecordSchema.parse({
      jobId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0108',
      runId: run.runId,
      taskId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0108',
      kind: 'task_execution',
      status: 'running',
      attempt: 1,
      maxAttempts: 2,
      priority: 'normal',
      createdAt: '2026-04-02T10:00:00.000Z',
      startedAt: '2026-04-02T10:00:01.000Z',
      availableAt: '2026-04-02T10:00:00.000Z',
      metadata: {},
      relatedEvidenceIds: [],
    });
    const result = ExecutionResultSchema.parse({
      executionId: 'cccccccc-cccc-4ccc-8ccc-cccccccc0108',
      runId: run.runId,
      taskId: job.taskId,
      executorType: 'codex',
      status: 'failed',
      startedAt: '2026-04-02T10:00:00.000Z',
      finishedAt: '2026-04-02T10:00:10.000Z',
      summary: 'timed out',
      patchSummary: {
        changedFiles: [],
        addedLines: 0,
        removedLines: 0,
        notes: [],
      },
      testResults: [],
      artifacts: [],
      stdout: '',
      stderr: 'timeout',
      exitCode: 1,
      metadata: {
        errorCode: 'RUNNER_TIMEOUT',
      },
    });

    const disposition = await bundle.jobDispositionService.forExecutionFailure({
      job,
      result,
      source: 'test',
    });
    expect(disposition.disposition.disposition).toBe('retriable');
  });

  it('marks missing codex cli as manual attention required', async () => {
    const artifactDir = await createArtifactDir('job-disposition-manual-');
    const bundle = createOrchestratorRuntimeBundle({
      artifactDir,
    });
    const run = await bundle.orchestratorService.createRun({
      title: 'job disposition manual',
      createdBy: 'tester',
    });
    const job = JobRecordSchema.parse({
      jobId: 'dddddddd-dddd-4ddd-8ddd-dddddddd0108',
      runId: run.runId,
      taskId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0108',
      kind: 'task_execution',
      status: 'running',
      attempt: 2,
      maxAttempts: 2,
      priority: 'normal',
      createdAt: '2026-04-02T10:00:00.000Z',
      startedAt: '2026-04-02T10:00:01.000Z',
      availableAt: '2026-04-02T10:00:00.000Z',
      metadata: {},
      relatedEvidenceIds: [],
    });
    const result = ExecutionResultSchema.parse({
      executionId: 'ffffffff-ffff-4fff-8fff-ffffffff0108',
      runId: run.runId,
      taskId: job.taskId,
      executorType: 'codex',
      status: 'failed',
      startedAt: '2026-04-02T10:00:00.000Z',
      finishedAt: '2026-04-02T10:00:10.000Z',
      summary: 'missing codex cli',
      patchSummary: {
        changedFiles: [],
        addedLines: 0,
        removedLines: 0,
        notes: [],
      },
      testResults: [],
      artifacts: [],
      stdout: '',
      stderr: 'missing',
      exitCode: 1,
      metadata: {
        errorCode: 'CODEX_CLI_NOT_FOUND',
      },
    });

    const disposition = await bundle.jobDispositionService.forExecutionFailure({
      job,
      result,
      source: 'test',
    });
    expect(disposition.disposition.disposition).toBe('manual_attention_required');
  });
});
