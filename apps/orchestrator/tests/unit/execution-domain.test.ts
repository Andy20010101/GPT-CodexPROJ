import { describe, expect, it } from 'vitest';

import {
  assessTestEvidence,
  comparePatchFingerprints,
  fingerprintPatch,
  recommendTaskStateAfterExecution,
} from '../../src/domain/execution';
import { ExecutionResultSchema } from '../../src/contracts';
import { createEmptyPatchSummary } from '../../src/utils/patch-parser';

function buildResult(
  testResults: Array<{
    suite: string;
    status: 'passed' | 'failed' | 'skipped' | 'unknown';
    passed: number;
    failed: number;
    skipped: number;
  }>,
) {
  return ExecutionResultSchema.parse({
    executionId: '00000000-0000-4000-8000-000000000111',
    runId: '00000000-0000-4000-8000-000000000222',
    taskId: '00000000-0000-4000-8000-000000000333',
    executorType: 'codex',
    status: 'succeeded',
    startedAt: '2026-04-10T10:00:00.000Z',
    finishedAt: '2026-04-10T10:00:01.000Z',
    summary: 'execution finished',
    patchSummary: createEmptyPatchSummary([]),
    testResults,
    artifacts: [],
    stdout: '',
    stderr: '',
    exitCode: 0,
    metadata: {},
  });
}

describe('execution domain', () => {
  it('treats succeeded executions with passed suites and skipped suites as tests_green', () => {
    const disposition = recommendTaskStateAfterExecution(
      buildResult([
        {
          suite: 'ensure_rerun_stability',
          status: 'passed',
          passed: 4,
          failed: 0,
          skipped: 0,
        },
        {
          suite: 'targeted_typecheck',
          status: 'skipped',
          passed: 0,
          failed: 0,
          skipped: 1,
        },
      ]),
    );

    expect(disposition.testsPassed).toBe(true);
    expect(disposition.recommendedTaskState).toBe('tests_green');
    expect(disposition.shouldSubmitForReview).toBe(true);
    expect(disposition.testEvidence).toMatchObject({
      grade: 'placeholder',
      strength: 'weak',
    });
  });

  it('does not treat fully skipped executions as passing test evidence', () => {
    const disposition = recommendTaskStateAfterExecution(
      buildResult([
        {
          suite: 'targeted_typecheck',
          status: 'skipped',
          passed: 0,
          failed: 0,
          skipped: 1,
        },
      ]),
    );

    expect(disposition.testsPassed).toBe(false);
    expect(disposition.recommendedTaskState).toBe('implementation_in_progress');
    expect(disposition.shouldSubmitForReview).toBe(false);
    expect(disposition.testEvidence).toMatchObject({
      grade: 'placeholder',
      strength: 'weak',
    });
  });

  it('does not treat unknown suites as passing test evidence', () => {
    const disposition = recommendTaskStateAfterExecution(
      buildResult([
        {
          suite: 'ensure_rerun_stability',
          status: 'passed',
          passed: 4,
          failed: 0,
          skipped: 0,
        },
        {
          suite: 'postcheck',
          status: 'unknown',
          passed: 0,
          failed: 0,
          skipped: 0,
        },
      ]),
    );

    expect(disposition.testsPassed).toBe(false);
    expect(disposition.recommendedTaskState).toBe('implementation_in_progress');
    expect(disposition.testEvidence).toMatchObject({
      grade: 'placeholder',
      strength: 'weak',
    });
  });

  it('grades unit suites as strong evidence', () => {
    const assessment = assessTestEvidence(
      buildResult([
        {
          suite: 'vitest unit',
          status: 'passed',
          passed: 12,
          failed: 0,
          skipped: 0,
        },
      ]).testResults,
    );

    expect(assessment).toMatchObject({
      grade: 'unit',
      strength: 'strong',
    });
    expect(assessment.suiteAssessments[0]).toMatchObject({
      suite: 'vitest unit',
      grade: 'unit',
      strength: 'strong',
      countsTowardOverall: true,
    });
  });

  it('grades integration suites as strong evidence', () => {
    const assessment = assessTestEvidence(
      buildResult([
        {
          suite: 'playwright integration',
          status: 'passed',
          passed: 3,
          failed: 0,
          skipped: 0,
        },
      ]).testResults,
    );

    expect(assessment).toMatchObject({
      grade: 'integration',
      strength: 'strong',
    });
  });

  it('grades compile-check suites as weak evidence', () => {
    const assessment = assessTestEvidence(
      buildResult([
        {
          suite: 'tsc --noEmit',
          status: 'passed',
          passed: 1,
          failed: 0,
          skipped: 0,
        },
      ]).testResults,
    );

    expect(assessment).toMatchObject({
      grade: 'compile-check',
      strength: 'weak',
    });
  });

  it('does not let skipped compile checks upgrade the overall evidence grade', () => {
    const assessment = assessTestEvidence(
      buildResult([
        {
          suite: 'tsc --noEmit',
          status: 'skipped',
          passed: 0,
          failed: 0,
          skipped: 1,
        },
      ]).testResults,
    );

    expect(assessment).toMatchObject({
      grade: 'placeholder',
      strength: 'weak',
    });
    expect(assessment.suiteAssessments[0]).toMatchObject({
      grade: 'compile-check',
      countsTowardOverall: false,
    });
  });

  it('treats byte-for-byte identical patches as identical fingerprints', () => {
    const fingerprint = fingerprintPatch({
      patchArtifactContent: [
        'diff --git a/apps/orchestrator/src/services/review-service.ts b/apps/orchestrator/src/services/review-service.ts',
        'index 1111111..2222222 100644',
        '--- a/apps/orchestrator/src/services/review-service.ts',
        '+++ b/apps/orchestrator/src/services/review-service.ts',
        '@@ -1 +1,2 @@',
        ' export class ExistingReviewService {}',
        '+export class HardenedReviewEvidence {}',
      ].join('\n'),
      patchSummary: {
        changedFiles: ['apps/orchestrator/src/services/review-service.ts'],
        addedLines: 1,
        removedLines: 0,
      },
    });

    expect(comparePatchFingerprints(fingerprint, fingerprint)).toBe('identical');
  });

  it('treats patches with different index lines and hunk offsets as effectively identical', () => {
    const previous = fingerprintPatch({
      patchArtifactContent: [
        'diff --git a/apps/orchestrator/src/services/review-service.ts b/apps/orchestrator/src/services/review-service.ts',
        'index 1111111..2222222 100644',
        '--- a/apps/orchestrator/src/services/review-service.ts',
        '+++ b/apps/orchestrator/src/services/review-service.ts',
        '@@ -1 +1,2 @@ buildReviewRequest',
        ' export class ExistingReviewService {}',
        '+export class HardenedReviewEvidence {}',
      ].join('\n'),
      patchSummary: {
        changedFiles: ['apps/orchestrator/src/services/review-service.ts'],
        addedLines: 1,
        removedLines: 0,
      },
    });
    const current = fingerprintPatch({
      patchArtifactContent: [
        'diff --git a/apps/orchestrator/src/services/review-service.ts b/apps/orchestrator/src/services/review-service.ts',
        'index aaaaaaa..bbbbbbb 100644',
        '--- a/apps/orchestrator/src/services/review-service.ts',
        '+++ b/apps/orchestrator/src/services/review-service.ts',
        '@@ -20 +20,2 @@ buildReviewRequest',
        ' export class ExistingReviewService {}',
        '+export class HardenedReviewEvidence {}',
      ].join('\n'),
      patchSummary: {
        changedFiles: ['apps/orchestrator/src/services/review-service.ts'],
        addedLines: 1,
        removedLines: 0,
      },
    });

    expect(previous.rawHash).not.toBe(current.rawHash);
    expect(comparePatchFingerprints(current, previous)).toBe('effectively_identical');
  });
});
