import { createHash } from 'node:crypto';

import type {
  ExecutionResult,
  PatchFingerprint,
  PatchSimilarity,
  PatchSummary,
  TestEvidenceAssessment,
  TestEvidenceGrade,
  TestEvidenceSuiteAssessment,
  TestResult,
} from '../contracts';
import type { TaskLoopState } from '../contracts/task-loop-state';

export type ExecutionFailureDisposition = 'keep_implementing' | 'reject';

export type ExecutionDisposition = {
  recommendedTaskState: Extract<
    TaskLoopState,
    'tests_green' | 'implementation_in_progress' | 'rejected'
  >;
  testsPassed: boolean;
  shouldSubmitForReview: boolean;
  testEvidence: TestEvidenceAssessment;
  reason: string;
};

const PLACEHOLDER_SUITE_PATTERNS = [
  /\bplaceholder\b/u,
  /\bnoop\b/u,
  /\bno-op\b/u,
  /\bstub\b/u,
  /\bfake\b/u,
  /\bdummy\b/u,
];

const INTEGRATION_SUITE_PATTERNS = [
  /\bintegration\b/u,
  /\be2e\b/u,
  /end[-_ ]?to[-_ ]?end/u,
  /\bplaywright\b/u,
  /\bcypress\b/u,
];

const COMPILE_CHECK_SUITE_PATTERNS = [
  /\bcompile\b/u,
  /type[-_ ]?check/u,
  /\btsc\b/u,
  /no[-_ ]?emit/u,
];

const UNIT_SUITE_PATTERNS = [
  /\bunit\b/u,
  /\bvitest\b/u,
  /\bjest\b/u,
  /\bmocha\b/u,
  /\bava\b/u,
  /\bpytest\b/u,
];

const TEST_EVIDENCE_PRIORITY: readonly TestEvidenceGrade[] = [
  'placeholder',
  'compile-check',
  'unit',
  'integration',
];

const PATCH_METADATA_PREFIXES = [
  'index ',
  '--- ',
  '+++ ',
] as const;

const PATCH_STRUCTURAL_PREFIXES = [
  'diff --git ',
  'new file mode ',
  'deleted file mode ',
  'rename from ',
  'rename to ',
  'similarity index ',
  'Binary files ',
] as const;

export function assessTestEvidence(testResults: readonly TestResult[]): TestEvidenceAssessment {
  const suiteAssessments = testResults.map((result) => assessTestSuiteEvidence(result));
  const countedAssessments = suiteAssessments.filter((assessment) => assessment.countsTowardOverall);
  const grade =
    countedAssessments.reduce<TestEvidenceGrade>(
      (current, assessment) =>
        getTestEvidencePriority(assessment.grade) > getTestEvidencePriority(current)
          ? assessment.grade
          : current,
      'placeholder',
    ) ?? 'placeholder';
  const strength = getTestEvidenceStrength(grade);

  return {
    grade,
    strength,
    summary: buildTestEvidenceSummary({
      grade,
      countedAssessments,
      totalAssessments: suiteAssessments.length,
    }),
    suiteAssessments,
  };
}

export function didExecutionTestsPass(testResults: readonly TestResult[]): boolean {
  if (testResults.length === 0) {
    return false;
  }

  let hasPassingSuite = false;
  for (const result of testResults) {
    if (result.status === 'failed' || result.status === 'unknown' || result.failed > 0) {
      return false;
    }
    if (result.status === 'passed' && result.passed > 0) {
      hasPassingSuite = true;
    }
  }

  return hasPassingSuite;
}

export function recommendTaskStateAfterExecution(
  result: ExecutionResult,
  options: {
    onFailure?: ExecutionFailureDisposition | undefined;
  } = {},
): ExecutionDisposition {
  const testsPassed = didExecutionTestsPass(result.testResults);
  const testEvidence = assessTestEvidence(result.testResults);

  if (result.status === 'succeeded' && testsPassed) {
    return {
      recommendedTaskState: 'tests_green',
      testsPassed: true,
      shouldSubmitForReview: true,
      testEvidence,
      reason: 'Execution succeeded and returned passing test evidence.',
    };
  }

  if (options.onFailure === 'reject' && result.status === 'failed') {
    return {
      recommendedTaskState: 'rejected',
      testsPassed,
      shouldSubmitForReview: false,
      testEvidence,
      reason: 'Execution failed and the configured disposition is to reject the task.',
    };
  }

  return {
    recommendedTaskState: 'implementation_in_progress',
    testsPassed,
    shouldSubmitForReview: false,
    testEvidence,
    reason:
      result.status === 'failed'
        ? 'Execution failed; keep the task in implementation until a new attempt is ready.'
        : 'Execution did not return passing test evidence yet.',
  };
}

export function fingerprintPatch(input: {
  patchArtifactContent: string;
  patchSummary: Pick<PatchSummary, 'changedFiles' | 'addedLines' | 'removedLines'>;
}): PatchFingerprint {
  const rawPatch = normalizePatchLineEndings(input.patchArtifactContent).trim();
  const semanticPatch = normalizePatchForSemanticHash(rawPatch);

  return {
    rawHash: hashContent(rawPatch),
    semanticHash: hashContent(semanticPatch),
    changedFiles: normalizeChangedFiles(input.patchSummary.changedFiles),
    addedLines: input.patchSummary.addedLines,
    removedLines: input.patchSummary.removedLines,
  };
}

export function comparePatchFingerprints(
  current: PatchFingerprint,
  previous: PatchFingerprint,
): PatchSimilarity | null {
  if (current.rawHash === previous.rawHash) {
    return 'identical';
  }

  if (current.semanticHash === previous.semanticHash) {
    return 'effectively_identical';
  }

  return null;
}

function assessTestSuiteEvidence(result: TestResult): TestEvidenceSuiteAssessment {
  const normalizedSuite = result.suite.toLowerCase();
  const countsTowardOverall = result.status === 'passed' || result.status === 'failed';
  const { grade, rationale } = inferTestEvidenceGrade(normalizedSuite);

  return {
    suite: result.suite,
    status: result.status,
    grade,
    strength: getTestEvidenceStrength(grade),
    countsTowardOverall,
    rationale: countsTowardOverall
      ? rationale
      : `${rationale} This suite did not count toward the overall grade because its status was ${result.status}.`,
  };
}

function inferTestEvidenceGrade(normalizedSuite: string): {
  grade: TestEvidenceGrade;
  rationale: string;
} {
  if (matchesAnyPattern(normalizedSuite, PLACEHOLDER_SUITE_PATTERNS)) {
    return {
      grade: 'placeholder',
      rationale: 'Suite name indicates placeholder or stub validation.',
    };
  }

  if (matchesAnyPattern(normalizedSuite, INTEGRATION_SUITE_PATTERNS)) {
    return {
      grade: 'integration',
      rationale: 'Suite name indicates integration or end-to-end validation.',
    };
  }

  if (matchesAnyPattern(normalizedSuite, COMPILE_CHECK_SUITE_PATTERNS)) {
    return {
      grade: 'compile-check',
      rationale: 'Suite name indicates compile or typecheck validation.',
    };
  }

  if (matchesAnyPattern(normalizedSuite, UNIT_SUITE_PATTERNS)) {
    return {
      grade: 'unit',
      rationale: 'Suite name indicates unit-test validation.',
    };
  }

  return {
    grade: 'placeholder',
    rationale:
      'Suite name did not match unit, integration, or compile-check markers, so it is treated as placeholder evidence.',
  };
}

function matchesAnyPattern(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function normalizePatchLineEndings(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

function normalizePatchForSemanticHash(diff: string): string {
  const normalizedLines: string[] = [];

  for (const line of normalizePatchLineEndings(diff).split('\n')) {
    if (PATCH_METADATA_PREFIXES.some((prefix) => line.startsWith(prefix))) {
      continue;
    }

    if (PATCH_STRUCTURAL_PREFIXES.some((prefix) => line.startsWith(prefix))) {
      normalizedLines.push(line.trim());
      continue;
    }

    if (line.startsWith('@@')) {
      normalizedLines.push(normalizeHunkHeader(line));
      continue;
    }

    if (line.startsWith('+') || line.startsWith('-')) {
      normalizedLines.push(line);
      continue;
    }

    if (line.startsWith(' ')) {
      continue;
    }

    const trimmed = line.trim();
    if (trimmed.length > 0) {
      normalizedLines.push(trimmed);
    }
  }

  return normalizedLines.join('\n');
}

function normalizeHunkHeader(line: string): string {
  const match = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@(.*)$/u.exec(line);
  if (!match) {
    return '@@';
  }

  return `@@${match[1]}`;
}

function normalizeChangedFiles(files: readonly string[]): string[] {
  return [...new Set(files.map((file) => file.trim()).filter((file) => file.length > 0))].sort();
}

function hashContent(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function getTestEvidenceStrength(grade: TestEvidenceGrade): 'weak' | 'strong' {
  return grade === 'unit' || grade === 'integration' ? 'strong' : 'weak';
}

function getTestEvidencePriority(grade: TestEvidenceGrade): number {
  return TEST_EVIDENCE_PRIORITY.indexOf(grade);
}

function buildTestEvidenceSummary(input: {
  grade: TestEvidenceGrade;
  countedAssessments: readonly TestEvidenceSuiteAssessment[];
  totalAssessments: number;
}): string {
  if (input.totalAssessments === 0) {
    return 'Weak evidence: no test results were recorded, so the assessment defaults to placeholder.';
  }

  if (input.countedAssessments.length === 0) {
    return 'Weak evidence: only skipped or unknown suites were recorded, so no executed test evidence upgraded the grade.';
  }

  switch (input.grade) {
    case 'integration':
      return 'Strong evidence: at least one executed suite was classified as integration validation.';
    case 'unit':
      return 'Strong evidence: at least one executed suite was classified as unit validation.';
    case 'compile-check':
      return 'Weak evidence: the executed suites only reached compile-check validation.';
    case 'placeholder':
    default:
      return 'Weak evidence: the executed suites were placeholder or unclassified validation only.';
  }
}
