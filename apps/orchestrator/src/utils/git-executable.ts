import fs from 'node:fs';

const DEFAULT_GIT_CANDIDATES = ['/usr/bin/git', 'git'] as const;

export function resolveGitExecutable(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.GIT_BIN?.trim();
  if (explicit) {
    return explicit;
  }

  for (const candidate of DEFAULT_GIT_CANDIDATES) {
    if (candidate.includes('/')) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
      continue;
    }
    return candidate;
  }

  return 'git';
}
