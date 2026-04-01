import path from 'node:path';

export type OrchestratorConfig = {
  artifactDir: string;
  bridgeBaseUrl: string;
};

export function loadOrchestratorConfig(): OrchestratorConfig {
  return {
    artifactDir:
      process.env.ORCHESTRATOR_ARTIFACT_DIR ?? path.resolve(__dirname, '..', '..', 'artifacts'),
    bridgeBaseUrl: process.env.BRIDGE_BASE_URL ?? 'http://127.0.0.1:3100',
  };
}
