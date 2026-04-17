import type { ReviewRequest } from '../contracts';
import { buildAnalysisBundlePromptLines } from '../utils/analysis-bundle';

export type ReviewPayload = {
  prompt: string;
  remediationPrompt: string;
};

const REVIEW_JSON_EXAMPLE = [
  '```json',
  '{"status":"approved","summary":"<short summary>","findings":[],"missingTests":[],"architectureConcerns":[],"recommendedActions":[]}',
  '```',
].join('\n');

function buildTestEvidencePromptLines(request: ReviewRequest): string[] {
  return [
    '## Test Evidence Grade',
    `- overall grade: ${request.testEvidence.grade}`,
    `- evidence strength: ${request.testEvidence.strength}`,
    `- summary: ${request.testEvidence.summary}`,
    '- policy: treat unit and integration as strong evidence; treat compile-check and placeholder as weak evidence only.',
    ...(request.testEvidence.suiteAssessments.length > 0
      ? request.testEvidence.suiteAssessments.map((assessment) =>
          [
            `- ${assessment.suite}: status=${assessment.status}, grade=${assessment.grade}, strength=${assessment.strength}`,
            assessment.countsTowardOverall ? '' : ' (not counted toward overall grade)',
          ].join(''),
        )
      : ['- No suite-level assessment was recorded.']),
  ];
}

export class ReviewPayloadBuilder {
  public build(request: ReviewRequest): ReviewPayload {
    const prompt = [
      '# Task Review Request',
      `Review ID: ${request.reviewId}`,
      `Task ID: ${request.taskId}`,
      `Execution ID: ${request.executionId}`,
      '',
      '## Task',
      `Title: ${request.taskTitle}`,
      `Objective: ${request.objective}`,
      '',
      '## Scope',
      ...request.scope.inScope.map((line) => `- in-scope: ${line}`),
      ...request.scope.outOfScope.map((line) => `- out-of-scope: ${line}`),
      '',
      '## File Boundaries',
      ...request.allowedFiles.map((line) => `- allow: ${line}`),
      ...request.disallowedFiles.map((line) => `- deny: ${line}`),
      '',
      '## Acceptance Criteria',
      ...request.acceptanceCriteria.map(
        (criterion) =>
          `- ${criterion.id}: ${criterion.description} (${criterion.verificationMethod})`,
      ),
      '',
      '## Execution Summary',
      request.executionSummary,
      '',
      '## Patch Summary',
      `- changed files: ${request.changedFiles.join(', ') || 'none reported'}`,
      `- added lines: ${request.patchSummary.addedLines}`,
      `- removed lines: ${request.patchSummary.removedLines}`,
      ...request.patchSummary.notes.map((note) => `- note: ${note}`),
      ...(request.patchSummary.patchPath
        ? [`- patch path: ${request.patchSummary.patchPath}`]
        : []),
      '',
      '## Patch Diff',
      ...(request.patchArtifactContent
        ? [
            'Full diff content is attached separately as patch evidence.',
            'Use the attached latest.patch bundle file for the authoritative patch body.',
            'The inline diff body is intentionally omitted to keep the review request compact and avoid page instability.',
          ]
        : ['Patch diff content was not attached.']),
      '',
      '## Test Results',
      ...(request.testResults.length > 0
        ? request.testResults.map(
            (result) =>
              `- ${result.suite}: status=${result.status}, passed=${result.passed}, failed=${result.failed}, skipped=${result.skipped}`,
          )
        : ['- No test results were attached.']),
      '',
      ...buildTestEvidencePromptLines(request),
      ...(request.testLogExcerpt
        ? [
            '',
            '## Test Output Excerpt',
            'A full raw test log was recorded with the execution artifacts.',
            `Leading excerpt: ${request.testLogExcerpt.slice(0, 400).replace(/\s+/g, ' ').trim()}${request.testLogExcerpt.length > 400 ? ' ... [truncated]' : ''}`,
          ]
        : []),
      '',
      '## Architecture Constraints',
      ...(request.architectureConstraints.length > 0
        ? request.architectureConstraints.map((item) => `- ${item}`)
        : ['- No additional architecture constraints were provided.']),
      '',
      ...buildAnalysisBundlePromptLines(request.metadata),
      '',
      '## Required Response Format',
      'First provide a short human-readable review summary.',
      'Then include exactly one fenced JSON block that can be parsed by automation.',
      'The opening fence must be exactly ```json and the closing fence must be exactly ```.',
      'Do not output JSON{...}, do not prefix the object with the word JSON, and do not wrap the JSON in prose.',
      'The JSON object must have these keys:',
      '- status: approved | changes_requested | rejected | incomplete',
      '- summary: string',
      '- findings: string[]',
      '- missingTests: string[]',
      '- architectureConcerns: string[]',
      '- recommendedActions: string[]',
      '',
      'Example:',
      REVIEW_JSON_EXAMPLE,
    ].join('\n');

    return {
      prompt,
      remediationPrompt: [
        `The previous answer for review ${request.reviewId} was missing the required structured JSON block.`,
        'Re-issue the review with exactly two parts only:',
        '1. one short plain-text summary sentence',
        '2. exactly one raw JSON object on its own line',
        'The second part must begin with { and end with }.',
        'Do not use code fences. Do not output JSON{...}. Do not prefix the object with the word JSON. Do not add any prose after the JSON object.',
        'Use exactly these keys in the JSON object:',
        'status, summary, findings, missingTests, architectureConcerns, recommendedActions.',
        'Example:',
        '{"status":"approved","summary":"<short summary>","findings":[],"missingTests":[],"architectureConcerns":[],"recommendedActions":[]}',
      ].join('\n'),
    };
  }
}
