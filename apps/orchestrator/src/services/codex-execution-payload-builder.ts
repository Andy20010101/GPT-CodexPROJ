import type { ExecutionRequest } from '../contracts';

export type CodexExecutionPayload = {
  executionId: string;
  runId: string;
  taskId: string;
  prompt: string;
  sections: {
    title: string;
    objective: string;
    scope: readonly string[];
    allowedFiles: readonly string[];
    disallowedFiles: readonly string[];
    acceptanceCriteria: readonly string[];
    testPlan: readonly string[];
    implementationNotes: readonly string[];
    architectureConstraints: readonly string[];
  };
  metadata: Record<string, unknown>;
};

export class CodexExecutionPayloadBuilder {
  public build(request: ExecutionRequest): CodexExecutionPayload {
    const sections = {
      title: request.title,
      objective: request.objective,
      scope: [
        ...request.scope.inScope.map((value) => `in-scope: ${value}`),
        ...request.scope.outOfScope.map((value) => `out-of-scope: ${value}`),
      ],
      allowedFiles: request.allowedFiles,
      disallowedFiles: request.disallowedFiles,
      acceptanceCriteria: request.acceptanceCriteria.map(
        (criterion) =>
          `${criterion.id}: ${criterion.description} (${criterion.verificationMethod})`,
      ),
      testPlan: request.testPlan.map(
        (item) =>
          `${item.id}: ${item.description}; red="${item.expectedRedSignal}"; green="${item.expectedGreenSignal}"`,
      ),
      implementationNotes: request.implementationNotes,
      architectureConstraints: request.architectureConstraints,
    } as const;

    const prompt = [
      '# Codex Execution Request',
      `Execution ID: ${request.executionId}`,
      `Run ID: ${request.runId}`,
      `Task ID: ${request.taskId}`,
      '',
      '## Task',
      `Title: ${request.title}`,
      `Objective: ${request.objective}`,
      '',
      '## Scope',
      ...sections.scope.map((line) => `- ${line}`),
      '',
      '## File Boundaries',
      ...sections.allowedFiles.map((line) => `- allow: ${line}`),
      ...sections.disallowedFiles.map((line) => `- deny: ${line}`),
      '',
      '## Acceptance Criteria',
      ...sections.acceptanceCriteria.map((line) => `- ${line}`),
      '',
      '## Test Plan',
      ...(sections.testPlan.length > 0
        ? sections.testPlan.map((line) => `- ${line}`)
        : ['- No explicit test plan was attached.']),
      '',
      '## Implementation Notes',
      ...(sections.implementationNotes.length > 0
        ? sections.implementationNotes.map((line) => `- ${line}`)
        : ['- No additional implementation notes.']),
      '',
      '## Architecture Constraints',
      ...(sections.architectureConstraints.length > 0
        ? sections.architectureConstraints.map((line) => `- ${line}`)
        : ['- No extra architecture constraints were provided.']),
      '',
      '## Required Output',
      '- Return a concise execution summary.',
      '- Report patch summary with changed files and line deltas.',
      '- Report structured test results for any executed tests.',
      '- Report errors explicitly if execution fails or is partial.',
    ].join('\n');

    return {
      executionId: request.executionId,
      runId: request.runId,
      taskId: request.taskId,
      prompt,
      sections,
      metadata: {
        workspacePath: request.workspacePath,
        relatedEvidenceIds: request.relatedEvidenceIds,
        executorType: request.executorType,
        ...request.metadata,
      },
    };
  }
}
