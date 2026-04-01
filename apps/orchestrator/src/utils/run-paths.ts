import path from 'node:path';

export function getRunRoot(artifactDir: string, runId: string): string {
  return path.join(artifactDir, 'runs', runId);
}

export function getRunFile(artifactDir: string, runId: string): string {
  return path.join(getRunRoot(artifactDir, runId), 'run.json');
}
