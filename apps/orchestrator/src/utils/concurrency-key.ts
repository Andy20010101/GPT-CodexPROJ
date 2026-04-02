import type { JobRecord } from '../contracts';

export function buildConcurrencyKeys(
  job: Pick<JobRecord, 'runId' | 'taskId' | 'kind' | 'metadata'>,
): string[] {
  const keys = new Set<string>();
  if (job.taskId) {
    keys.add(`task:${job.taskId}`);
  }

  const workspacePath = readString(job.metadata.workspacePath);
  const workspaceId = readString(job.metadata.workspaceId);
  if (workspacePath) {
    keys.add(`workspace:${workspacePath}`);
  } else if (workspaceId) {
    keys.add(`workspace:${workspaceId}`);
  }

  if (job.kind === 'release_review') {
    keys.add(`release:${job.runId}`);
  }

  return [...keys];
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
