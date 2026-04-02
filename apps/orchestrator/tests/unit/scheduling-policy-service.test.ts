import { describe, expect, it } from 'vitest';

import { JobRecordSchema } from '../../src/contracts';
import { createOrchestratorRuntimeBundle } from '../../src';
import { createArtifactDir } from '../helpers/runtime-fixtures';

describe('SchedulingPolicyService', () => {
  it('orders urgent before low priority and prefers less loaded runs', async () => {
    const artifactDir = await createArtifactDir('scheduler-policy-');
    const bundle = createOrchestratorRuntimeBundle({
      artifactDir,
    });
    const jobs = [
      JobRecordSchema.parse({
        jobId: '11111111-1111-4111-8111-111111111111',
        runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        taskId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        kind: 'task_execution',
        status: 'queued',
        attempt: 1,
        maxAttempts: 2,
        priority: 'low',
        createdAt: '2026-04-02T10:00:00.000Z',
        availableAt: '2026-04-02T10:00:00.000Z',
        metadata: {},
        relatedEvidenceIds: [],
      }),
      JobRecordSchema.parse({
        jobId: '22222222-2222-4222-8222-222222222222',
        runId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        taskId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        kind: 'task_execution',
        status: 'queued',
        attempt: 1,
        maxAttempts: 2,
        priority: 'urgent',
        createdAt: '2026-04-02T10:00:01.000Z',
        availableAt: '2026-04-02T10:00:01.000Z',
        metadata: {},
        relatedEvidenceIds: [],
      }),
    ];

    const ordered = bundle.schedulingPolicyService.orderRunnableJobs({
      jobs,
      activeJobs: [],
    });

    expect(ordered.map((job) => job.jobId)).toEqual([
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
    ]);
  });
});
