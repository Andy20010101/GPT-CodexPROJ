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
