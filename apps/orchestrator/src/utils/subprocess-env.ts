export function buildChildProcessEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
  overlay: Record<string, string> = {},
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) {
      continue;
    }
    if (key.startsWith('CODEX_')) {
      continue;
    }
    env[key] = value;
  }

  return {
    ...env,
    ...overlay,
  };
}
