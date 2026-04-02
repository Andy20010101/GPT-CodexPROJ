import { describe, expect, it } from 'vitest';

import { JobRecordSchema } from '../../src/contracts';
import { createOrchestratorRuntimeBundle } from '../../src';
import { createArtifactDir } from '../helpers/runtime-fixtures';

describe('ConcurrencyControlService', () => {
  it('defers jobs for global, per-run, and exclusive-key conflicts', async () => {
    const artifactDir = await createArtifactDir('concurrency-control-');
    const bundle = createOrchestratorRuntimeBundle({
      artifactDir,
      concurrencyPolicy: {
        maxConcurrentJobs: 1,
        maxConcurrentJobsPerRun: 1,
        deferDelayMs: 100,
        exclusiveKeys: {
          task: true,
          workspace: true,
        },
      },
    });
    const activeJob = JobRecordSchema.parse({
      jobId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      runId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      taskId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      kind: 'task_execution',
      status: 'running',
      attempt: 1,
      maxAttempts: 2,
      createdAt: '2026-04-02T16:10:00.000Z',
      startedAt: '2026-04-02T16:10:01.000Z',
      availableAt: '2026-04-02T16:10:00.000Z',
      metadata: {
        workspacePath: '/tmp/ws-a',
      },
      relatedEvidenceIds: [],
    });
    const candidate = JobRecordSchema.parse({
      jobId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      runId: activeJob.runId,
      taskId: activeJob.taskId,
      kind: 'task_execution',
      status: 'queued',
      attempt: 1,
      maxAttempts: 2,
      createdAt: '2026-04-02T16:10:00.000Z',
      availableAt: '2026-04-02T16:10:00.000Z',
      metadata: {
        workspacePath: '/tmp/ws-a',
      },
      relatedEvidenceIds: [],
    });

    const decision = bundle.concurrencyControlService.evaluate({
      job: candidate,
      activeJobs: [activeJob],
      now: new Date('2026-04-02T16:10:05.000Z'),
    });

    expect(decision.allowed).toBe(false);
    expect(decision.action).toBe('defer');
    expect(decision.reason).toContain('Global concurrency limit');
  });
});
