import path from 'node:path';

export function getRunsRoot(artifactDir: string): string {
  return path.join(artifactDir, 'runs');
}

export function getRunRoot(artifactDir: string, runId: string): string {
  return path.join(getRunsRoot(artifactDir), runId);
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

export function getJobsRoot(artifactDir: string, runId: string): string {
  return path.join(getRunRoot(artifactDir, runId), 'jobs');
}

export function getJobFile(artifactDir: string, runId: string, jobId: string): string {
  return path.join(getJobsRoot(artifactDir, runId), `${jobId}.json`);
}

export function getQueueRoot(artifactDir: string, runId: string): string {
  return path.join(getRunRoot(artifactDir, runId), 'queue');
}

export function getQueueStateFile(artifactDir: string, runId: string): string {
  return path.join(getQueueRoot(artifactDir, runId), 'queue-state.json');
}

export function getReleaseRoot(
  artifactDir: string,
  runId: string,
  releaseReviewId: string,
): string {
  return path.join(getRunRoot(artifactDir, runId), 'releases', releaseReviewId);
}

export function getReleaseRequestFile(
  artifactDir: string,
  runId: string,
  releaseReviewId: string,
): string {
  return path.join(getReleaseRoot(artifactDir, runId, releaseReviewId), 'request.json');
}

export function getReleaseResultFile(
  artifactDir: string,
  runId: string,
  releaseReviewId: string,
): string {
  return path.join(getReleaseRoot(artifactDir, runId, releaseReviewId), 'result.json');
}

export function getRunAcceptanceFile(artifactDir: string, runId: string): string {
  return path.join(getRunRoot(artifactDir, runId), 'run-acceptance.json');
}
