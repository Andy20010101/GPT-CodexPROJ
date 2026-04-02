import { PatchSummarySchema, type PatchSummary } from '../contracts';

export function createEmptyPatchSummary(notes: readonly string[] = []): PatchSummary {
  return PatchSummarySchema.parse({
    changedFiles: [],
    addedLines: 0,
    removedLines: 0,
    notes,
  });
}

export function parsePatchSummary(
  diff: string,
  options: {
    patchPath?: string | undefined;
    notes?: readonly string[] | undefined;
  } = {},
): PatchSummary {
  const changedFiles = new Set<string>();
  let addedLines = 0;
  let removedLines = 0;

  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      if (match?.[2]) {
        changedFiles.add(match[2]);
      }
      continue;
    }

    if (line.startsWith('+++ ') || line.startsWith('--- ')) {
      continue;
    }

    if (line.startsWith('+')) {
      addedLines += 1;
    } else if (line.startsWith('-')) {
      removedLines += 1;
    }
  }

  return PatchSummarySchema.parse({
    changedFiles: [...changedFiles],
    addedLines,
    removedLines,
    ...(options.patchPath ? { patchPath: options.patchPath } : {}),
    notes: options.notes ?? [],
  });
}
