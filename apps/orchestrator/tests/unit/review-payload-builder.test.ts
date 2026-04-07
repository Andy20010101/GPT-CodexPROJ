import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { ReviewPayloadBuilder } from '../../src/services/review-payload-builder';

describe('ReviewPayloadBuilder', () => {
  it('hardens the remediation prompt with an explicit fenced-json example', () => {
    const builder = new ReviewPayloadBuilder();
    const payload = builder.build({
      reviewId: randomUUID(),
      runId: randomUUID(),
      taskId: randomUUID(),
      executionId: randomUUID(),
      reviewType: 'task_review',
      taskTitle: 'Task title',
      objective: 'Task objective',
      scope: {
        inScope: ['apps/user-query-api/src/models/**'],
        outOfScope: ['apps/orchestrator/**'],
      },
      allowedFiles: ['apps/user-query-api/src/models/**'],
      disallowedFiles: ['apps/orchestrator/**'],
      acceptanceCriteria: [
        {
          id: 'ac-1',
          description: 'criterion',
          verificationMethod: 'review',
          requiredEvidenceKinds: ['review_result'],
        },
      ],
      changedFiles: [],
      patchSummary: {
        changedFiles: [],
        addedLines: 0,
        removedLines: 0,
        notes: [],
      },
      patchArtifactContent: 'diff --git a/foo.ts b/foo.ts\n+console.log("ok");',
      testResults: [],
      testLogExcerpt: 'PASS tests/user-service.test.ts',
      executionSummary: 'summary',
      architectureConstraints: [],
      relatedEvidenceIds: [],
      metadata: {},
      createdAt: new Date().toISOString(),
    });

    expect(payload.prompt).toContain('The opening fence must be exactly ```json');
    expect(payload.prompt).toContain('Do not output JSON{...}');
    expect(payload.prompt).toContain('## Patch Diff');
    expect(payload.prompt).toContain('```diff');
    expect(payload.prompt).toContain('diff --git a/foo.ts b/foo.ts');
    expect(payload.prompt).toContain('## Test Output Excerpt');
    expect(payload.prompt).toContain('PASS tests/user-service.test.ts');
    expect(payload.remediationPrompt).toContain('The JSON fence must start with ```json and end with ```.');
    expect(payload.remediationPrompt).toContain('Do not output JSON{...}.');
    expect(payload.remediationPrompt).toContain('```json');
  });
});
