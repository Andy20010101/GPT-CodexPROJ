import { describe, expect, it } from 'vitest';

import { resolveGitExecutable } from '../../src/utils/git-executable';

describe('resolveGitExecutable', () => {
  it('prefers an explicit GIT_BIN when present', () => {
    expect(
      resolveGitExecutable({
        GIT_BIN: '/custom/git',
      } as NodeJS.ProcessEnv),
    ).toBe('/custom/git');
  });

  it('falls back to a usable default when GIT_BIN is absent', () => {
    expect(resolveGitExecutable({} as NodeJS.ProcessEnv)).toBeTypeOf('string');
    expect(resolveGitExecutable({} as NodeJS.ProcessEnv).length).toBeGreaterThan(0);
  });
});
