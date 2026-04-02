import type { ReviewRequest } from '../contracts';

export type ReviewPayload = {
  prompt: string;
  remediationPrompt: string;
};

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
      '',
      '## Test Results',
      ...(request.testResults.length > 0
        ? request.testResults.map(
            (result) =>
              `- ${result.suite}: status=${result.status}, passed=${result.passed}, failed=${result.failed}, skipped=${result.skipped}`,
          )
        : ['- No test results were attached.']),
      '',
      '## Architecture Constraints',
      ...(request.architectureConstraints.length > 0
        ? request.architectureConstraints.map((item) => `- ${item}`)
        : ['- No additional architecture constraints were provided.']),
      '',
      '## Required Response Format',
      'First provide a short human-readable review summary.',
      'Then include exactly one fenced JSON block that can be parsed by automation.',
      'The JSON object must have these keys:',
      '- status: approved | changes_requested | rejected | incomplete',
      '- summary: string',
      '- findings: string[]',
      '- missingTests: string[]',
      '- architectureConcerns: string[]',
      '- recommendedActions: string[]',
    ].join('\n');

    return {
      prompt,
      remediationPrompt: [
        `The previous answer for review ${request.reviewId} was missing the required structured JSON block.`,
        'Re-issue the review and include exactly one fenced JSON block with these keys:',
        'status, summary, findings, missingTests, architectureConcerns, recommendedActions.',
      ].join('\n'),
    };
  }
}
