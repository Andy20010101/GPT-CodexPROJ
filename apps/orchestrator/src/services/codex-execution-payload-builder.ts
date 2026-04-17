import type { ExecutionRequest } from '../contracts';

const MAX_PROMPT_ARCHITECTURE_CONSTRAINTS = 8;

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
    const architectureConstraints = summarizeArchitectureConstraints(request.architectureConstraints);
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
      architectureConstraints: architectureConstraints.visible,
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
      '## Execution Guardrails',
      `- You are already inside the isolated task workspace at: ${request.workspacePath}`,
      '- Start by inspecting only the allowed files listed above.',
      '- Do not search parent directories or unrelated repo areas to rediscover context.',
      '- Treat deny patterns as hard boundaries; do not read or edit them.',
      '- Do not add import/require statements that reference deny patterns, even for type-only access or read-only inspection.',
      '- If a required allowed file is missing, fail fast and report the missing path instead of broadening the search.',
      '- Prefer verifying whether the current allowed-file implementation already satisfies the acceptance criteria before making new edits.',
      '- Keep commands and verification targeted to the allowed files and attached test plan only.',
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
      '- File boundaries and task scope above override any broader architectural context in this summary.',
      ...(sections.architectureConstraints.length > 0
        ? sections.architectureConstraints.map((line) => `- ${line}`)
        : ['- No extra architecture constraints were provided.']),
      ...(architectureConstraints.omittedCount > 0
        ? [
            `- ${architectureConstraints.omittedCount} additional architecture constraints were omitted from this prompt for focus; do not infer broader write scope from them.`,
          ]
        : []),
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

function summarizeArchitectureConstraints(
  constraints: readonly string[],
): {
  visible: readonly string[];
  omittedCount: number;
} {
  const unique = [...new Set(constraints)];
  const visible = unique.slice(0, MAX_PROMPT_ARCHITECTURE_CONSTRAINTS);
  return {
    visible,
    omittedCount: Math.max(0, unique.length - visible.length),
  };
}
