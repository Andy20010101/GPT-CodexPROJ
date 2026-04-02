import type { ExecutionResult, RollbackStrategy, WorkspaceRuntime } from '../contracts';

export function buildRollbackPlan(input: {
  strategy: RollbackStrategy;
  reason: string;
  workspace?: WorkspaceRuntime | undefined;
  executionResult?: ExecutionResult | undefined;
}): string[] {
  const steps: string[] = [];

  switch (input.strategy) {
    case 'workspace_cleanup':
      steps.push(
        input.workspace
          ? `Remove isolated workspace at ${input.workspace.workspacePath}.`
          : 'Remove the isolated workspace for the failed task.',
      );
      break;
    case 'worktree_reset':
      steps.push('Reset the isolated worktree back to the recorded base commit.');
      break;
    case 'patch_revert_plan':
      steps.push('Review the recorded patch summary and prepare a revert patch plan.');
      break;
    case 'retain_workspace':
      steps.push('Retain the workspace for manual investigation instead of deleting it.');
      break;
  }

  if (input.executionResult?.patchSummary.changedFiles.length) {
    steps.push(
      `Inspect changed files: ${input.executionResult.patchSummary.changedFiles.join(', ')}.`,
    );
  }
  steps.push(`Reason: ${input.reason}`);

  return steps;
}
