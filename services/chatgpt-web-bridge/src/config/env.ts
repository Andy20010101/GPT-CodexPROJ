import path from 'node:path';

export type BridgeConfig = {
  readonly host: string;
  readonly port: number;
  readonly artifactDir: string;
};

export function loadBridgeConfig(): BridgeConfig {
  const defaultArtifacts = path.resolve(__dirname, '..', 'artifacts');
  const rawPort = process.env.PORT;
  const parsedPort = rawPort ? Number(rawPort) : 3100;

  return {
    host: process.env.HOST ?? '127.0.0.1',
    port: Number.isFinite(parsedPort) ? parsedPort : 3100,
    artifactDir: process.env.BRIDGE_ARTIFACT_DIR ?? defaultArtifacts,
  };
}
