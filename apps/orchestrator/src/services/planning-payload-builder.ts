import type {
  ArchitectureFreeze,
  PlanningPhase,
  PlanningRequest,
  RequirementFreeze,
} from '../contracts';

const JSON_REQUIREMENT = [
  'Return exactly one fenced JSON block.',
  'Do not include prose before or after the JSON block.',
  'The JSON must be a single object that matches the requested schema.',
].join(' ');

export class PlanningPayloadBuilder {
  public build(input: {
    request: PlanningRequest;
    phase: PlanningPhase;
    requirementFreeze?: RequirementFreeze | null | undefined;
    architectureFreeze?: ArchitectureFreeze | null | undefined;
  }): {
    prompt: string;
    remediationPrompt: string;
  } {
    switch (input.phase) {
      case 'requirement_freeze':
        return buildRequirementPrompt(input.request);
      case 'architecture_freeze':
        return buildArchitecturePrompt(input.request, input.requirementFreeze);
      case 'task_graph_generation':
        return buildTaskGraphPrompt(
          input.request,
          input.requirementFreeze,
          input.architectureFreeze,
        );
    }
  }
}

function buildRequirementPrompt(request: PlanningRequest): {
  prompt: string;
  remediationPrompt: string;
} {
  return {
    prompt: [
      'You are the system requirement freeze agent.',
      JSON_REQUIREMENT,
      'Schema:',
      '- title: string',
      '- summary: string',
      '- objectives: string[] (min 1)',
      '- nonGoals: string[]',
      '- constraints: { id, title, description, severity, rationale? }[]',
      '- risks: { id, title, description, severity, mitigation? }[]',
      '- acceptanceCriteria: { id, description, verificationMethod, measurableOutcome?, requiredEvidenceKinds }[] (min 1)',
      'Requirements:',
      '- Freeze the user intent into clear goals, non-goals, constraints, risks, and testable acceptance criteria.',
      '- Acceptance criteria must be objectively verifiable.',
      '- Keep the output concise but operational.',
      `Run ID: ${request.runId}`,
      request.sourcePrompt
        ? `Original requirement prompt:\n${request.sourcePrompt}`
        : `Prompt:\n${request.prompt}`,
    ].join('\n'),
    remediationPrompt: [
      'The previous answer did not contain exactly one valid JSON object.',
      'Reply again with exactly one ```json fenced block and no extra prose.',
      'The JSON must match the requirement freeze schema from the original prompt.',
    ].join('\n'),
  };
}

function buildArchitecturePrompt(
  request: PlanningRequest,
  requirementFreeze?: RequirementFreeze | null | undefined,
): {
  prompt: string;
  remediationPrompt: string;
} {
  return {
    prompt: [
      'You are the system architecture freeze agent.',
      JSON_REQUIREMENT,
      'Schema:',
      '- summary: string',
      '- moduleDefinitions: { moduleId, name, responsibility, ownedPaths, publicInterfaces, allowedDependencies }[] (min 1)',
      '- dependencyRules: { fromModuleId, toModuleId, rule, rationale }[] (min 1)',
      '- invariants: string[]',
      'Requirements:',
      '- Define crisp module boundaries and allowed dependency directions.',
      '- Cover data flow or interface boundaries in module responsibilities and dependency rules.',
      '- Reflect the frozen requirements faithfully.',
      `Run ID: ${request.runId}`,
      `Original planning prompt:\n${request.sourcePrompt ?? request.prompt}`,
      requirementFreeze
        ? `Requirement freeze:\n${JSON.stringify(requirementFreeze, null, 2)}`
        : 'Requirement freeze: unavailable',
    ].join('\n'),
    remediationPrompt: [
      'The previous answer did not contain exactly one valid JSON object.',
      'Reply again with exactly one ```json fenced block and no extra prose.',
      'The JSON must match the architecture freeze schema from the original prompt.',
    ].join('\n'),
  };
}

function buildTaskGraphPrompt(
  request: PlanningRequest,
  requirementFreeze?: RequirementFreeze | null | undefined,
  architectureFreeze?: ArchitectureFreeze | null | undefined,
): {
  prompt: string;
  remediationPrompt: string;
} {
  return {
    prompt: [
      'You are the system task graph generation agent.',
      JSON_REQUIREMENT,
      'Schema:',
      '- tasks: array of objects (min 3). Each task must include:',
      '  - taskId?: string',
      '  - title: string',
      '  - objective: string',
      '  - executorType?: "codex" | "command" | "noop"',
      '  - scope?: { inScope: string[], outOfScope: string[] }',
      '  - allowedFiles: string[]',
      '  - disallowedFiles: string[]',
      '  - dependencies: string[]',
      '  - acceptanceCriteria: { id?, description, verificationMethod, measurableOutcome?, requiredEvidenceKinds }[]',
      '  - testPlan: { id?, description, verificationCommand?, expectedRedSignal, expectedGreenSignal }[]',
      '  - implementationNotes: string[]',
      '  - metadata?: object',
      '- edges: { fromTaskId, toTaskId, kind }[]',
      'Requirements:',
      '- Return executable task decomposition, not advice.',
      '- At least one dependency chain must exist so a downstream task is initially blocked and can be unlocked later.',
      '- Every task must have objective, acceptance criteria, test plan, and file boundaries.',
      '- Keep tasks scoped tightly enough for controlled execution.',
      `Run ID: ${request.runId}`,
      `Original planning prompt:\n${request.sourcePrompt ?? request.prompt}`,
      requirementFreeze
        ? `Requirement freeze:\n${JSON.stringify(requirementFreeze, null, 2)}`
        : 'Requirement freeze: unavailable',
      architectureFreeze
        ? `Architecture freeze:\n${JSON.stringify(architectureFreeze, null, 2)}`
        : 'Architecture freeze: unavailable',
    ].join('\n'),
    remediationPrompt: [
      'The previous answer did not contain exactly one valid JSON object.',
      'Reply again with exactly one ```json fenced block and no extra prose.',
      'The JSON must match the task graph generation schema from the original prompt.',
    ].join('\n'),
  };
}
