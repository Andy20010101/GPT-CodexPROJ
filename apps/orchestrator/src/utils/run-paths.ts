import path from 'node:path';

export function getRunRoot(artifactDir: string, runId: string): string {
  return path.join(artifactDir, 'runs', runId);
}

export function getRunFile(artifactDir: string, runId: string): string {
  return path.join(getRunRoot(artifactDir, runId), 'run.json');
}

export function getExecutionRoot(artifactDir: string, runId: string, executionId: string): string {
  return path.join(getRunRoot(artifactDir, runId), 'executions', executionId);
}

export function getExecutionRequestFile(
  artifactDir: string,
  runId: string,
  executionId: string,
): string {
  return path.join(getExecutionRoot(artifactDir, runId, executionId), 'request.json');
}

export function getExecutionResultFile(
  artifactDir: string,
  runId: string,
  executionId: string,
): string {
  return path.join(getExecutionRoot(artifactDir, runId, executionId), 'result.json');
}

export function getReviewRoot(artifactDir: string, runId: string, reviewId: string): string {
  return path.join(getRunRoot(artifactDir, runId), 'reviews', reviewId);
}

export function getReviewRequestFile(artifactDir: string, runId: string, reviewId: string): string {
  return path.join(getReviewRoot(artifactDir, runId, reviewId), 'request.json');
}

export function getReviewResultFile(artifactDir: string, runId: string, reviewId: string): string {
  return path.join(getReviewRoot(artifactDir, runId, reviewId), 'result.json');
}

export function getWorkspaceRecordFile(
  artifactDir: string,
  runId: string,
  workspaceId: string,
): string {
  return path.join(getRunRoot(artifactDir, runId), 'workspaces', `${workspaceId}.json`);
}
