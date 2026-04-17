export type PtySpawnPlan = {
  command: string;
  args: string[];
  shell: boolean;
};

const DEFAULT_SCRIPT_BIN = '/usr/bin/script';
const POSIX_SINGLE_QUOTE_ESCAPE = "'\"'\"'";

export function buildPtySpawnPlan(input: {
  command: string;
  args: readonly string[];
  usePty?: boolean | undefined;
  scriptBin?: string | undefined;
}): PtySpawnPlan {
  if (!input.usePty) {
    return {
      command: input.command,
      args: [...input.args],
      shell: false,
    };
  }

  return {
    command: input.scriptBin ?? DEFAULT_SCRIPT_BIN,
    args: ['-qefc', buildShellCommand(input.command, input.args), '/dev/null'],
    shell: false,
  };
}

function buildShellCommand(command: string, args: readonly string[]): string {
  return [command, ...args].map(quotePosixArg).join(' ');
}

function quotePosixArg(value: string): string {
  if (value.length === 0) {
    return "''";
  }

  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", POSIX_SINGLE_QUOTE_ESCAPE)}'`;
}
