import type { ExecutionResult, PatchSummary } from '../contracts';
import { DebugDiffSummarySchema, type DebugDiffSummary } from '../contracts';

export function summarizeDiff(input: {
  patchSummary?: PatchSummary | undefined;
  executionResult?: ExecutionResult | undefined;
}): DebugDiffSummary {
  const patchSummary = input.patchSummary ?? input.executionResult?.patchSummary;
  return DebugDiffSummarySchema.parse({
    changedFiles: patchSummary?.changedFiles ?? [],
    addedLines: patchSummary?.addedLines ?? 0,
    removedLines: patchSummary?.removedLines ?? 0,
    summary: buildSummary(patchSummary),
  });
}

function buildSummary(patchSummary: PatchSummary | undefined): string {
  if (!patchSummary || patchSummary.changedFiles.length === 0) {
    return 'No file-level diff summary was recorded.';
  }

  return `${patchSummary.changedFiles.length} file(s), +${patchSummary.addedLines}/-${patchSummary.removedLines}`;
}
