import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { ReviewPayloadBuilder } from '../../src/services/review-payload-builder';

describe('ReviewPayloadBuilder', () => {
  it('hardens the remediation prompt with a raw-json remediation fallback', () => {
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
      changedFiles: ['foo.ts'],
      patchSummary: {
        changedFiles: ['foo.ts'],
        addedLines: 1,
        removedLines: 0,
        notes: [],
      },
      patchArtifactContent: 'diff --git a/foo.ts b/foo.ts\n+console.log("ok");',
      testResults: [
        {
          suite: 'vitest',
          status: 'passed',
          passed: 1,
          failed: 0,
          skipped: 0,
        },
      ],
      testEvidence: {
        grade: 'unit',
        strength: 'strong',
        summary: 'Strong evidence: at least one executed suite was classified as unit validation.',
        suiteAssessments: [
          {
            suite: 'vitest',
            status: 'passed',
            grade: 'unit',
            strength: 'strong',
            countsTowardOverall: true,
            rationale: 'Suite name indicates unit-test validation.',
          },
        ],
      },
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
    expect(payload.prompt).toContain('Full diff content is attached separately as patch evidence.');
    expect(payload.prompt).toContain('Use the attached latest.patch bundle file for the authoritative patch body.');
    expect(payload.prompt).toContain('- changed files: foo.ts');
    expect(payload.prompt).toContain('- vitest: status=passed, passed=1, failed=0, skipped=0');
    expect(payload.prompt).toContain('## Test Evidence Grade');
    expect(payload.prompt).toContain('- overall grade: unit');
    expect(payload.prompt).toContain('- evidence strength: strong');
    expect(payload.prompt).toContain(
      'treat unit and integration as strong evidence; treat compile-check and placeholder as weak evidence only.',
    );
    expect(payload.prompt).toContain('- vitest: status=passed, grade=unit, strength=strong');
    expect(payload.prompt).toContain('## Test Output Excerpt');
    expect(payload.prompt).toContain('PASS tests/user-service.test.ts');
    expect(payload.remediationPrompt).toContain('2. exactly one raw JSON object on its own line');
    expect(payload.remediationPrompt).toContain('The second part must begin with { and end with }.');
    expect(payload.remediationPrompt).toContain('Do not output JSON{...}.');
    expect(payload.remediationPrompt).toContain('Do not use code fences.');
    expect(payload.remediationPrompt).toContain(
      '{"status":"approved","summary":"<short summary>","findings":[],"missingTests":[],"architectureConcerns":[],"recommendedActions":[]}',
    );
  });
});
