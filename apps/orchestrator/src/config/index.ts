import path from 'node:path';

import type { ExecutorType } from '../contracts';

export type OrchestratorConfig = {
  artifactDir: string;
  bridgeBaseUrl: string;
  bridgeBrowserUrl: string;
  bridgeProjectName: string;
  reviewModelHint?: string | undefined;
  reviewMaxWaitMs: number;
  codexRunnerMode: 'stub' | 'cli';
  codexCliBin: string;
  codexCliArgs: string[];
  codexCliTimeoutMs: number;
  workspaceRuntimeBaseDir: string;
  defaultExecutorType: ExecutorType;
};

export function loadOrchestratorConfig(): OrchestratorConfig {
  const artifactDir =
    process.env.ORCHESTRATOR_ARTIFACT_DIR ?? path.resolve(__dirname, '..', '..', 'artifacts');

  return {
    artifactDir,
    bridgeBaseUrl: process.env.BRIDGE_BASE_URL ?? 'http://127.0.0.1:3100',
    bridgeBrowserUrl: process.env.BRIDGE_BROWSER_URL ?? 'https://chatgpt.com/',
    bridgeProjectName: process.env.BRIDGE_PROJECT_NAME ?? 'Default',
    ...(process.env.REVIEW_MODEL_HINT ? { reviewModelHint: process.env.REVIEW_MODEL_HINT } : {}),
    reviewMaxWaitMs: parseInteger(process.env.REVIEW_MAX_WAIT_MS, 180000),
    codexRunnerMode: process.env.CODEX_RUNNER_MODE === 'cli' ? 'cli' : 'stub',
    codexCliBin: process.env.CODEX_CLI_BIN ?? 'codex',
    codexCliArgs: parseArgString(process.env.CODEX_CLI_ARGS),
    codexCliTimeoutMs: parseInteger(process.env.CODEX_CLI_TIMEOUT_MS, 600000),
    workspaceRuntimeBaseDir:
      process.env.WORKSPACE_RUNTIME_BASE_DIR ?? path.join(artifactDir, 'workspace-runtime'),
    defaultExecutorType: parseExecutorType(process.env.DEFAULT_EXECUTOR_TYPE),
  };
}

function parseArgString(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseExecutorType(value: string | undefined): ExecutorType {
  if (value === 'codex' || value === 'command' || value === 'noop') {
    return value;
  }

  return 'codex';
}
