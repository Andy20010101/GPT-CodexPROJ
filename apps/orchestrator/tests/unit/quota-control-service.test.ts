import { describe, expect, it } from 'vitest';

import { JobRecordSchema } from '../../src/contracts';
import { createOrchestratorRuntimeBundle } from '../../src';
import { createArtifactDir } from '../helpers/runtime-fixtures';

describe('QuotaControlService', () => {
  it('blocks when kind quota is saturated', async () => {
    const artifactDir = await createArtifactDir('quota-control-');
    const bundle = createOrchestratorRuntimeBundle({
      artifactDir,
    });
    const active = JobRecordSchema.parse({
      jobId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0107',
      runId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0107',
      kind: 'release_review',
      status: 'running',
      attempt: 1,
      maxAttempts: 2,
      priority: 'high',
      createdAt: '2026-04-02T10:00:00.000Z',
      startedAt: '2026-04-02T10:00:01.000Z',
      availableAt: '2026-04-02T10:00:00.000Z',
      metadata: {},
      relatedEvidenceIds: [],
    });
    const candidate = JobRecordSchema.parse({
      jobId: 'cccccccc-cccc-4ccc-8ccc-cccccccc0107',
      runId: 'dddddddd-dddd-4ddd-8ddd-dddddddd0107',
      kind: 'release_review',
      status: 'queued',
      attempt: 1,
      maxAttempts: 2,
      priority: 'high',
      createdAt: '2026-04-02T10:00:02.000Z',
      availableAt: '2026-04-02T10:00:02.000Z',
      metadata: {},
      relatedEvidenceIds: [],
    });

    const decision = bundle.quotaControlService.evaluate({
      job: candidate,
      activeJobs: [active],
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('release_review');
  });
});
