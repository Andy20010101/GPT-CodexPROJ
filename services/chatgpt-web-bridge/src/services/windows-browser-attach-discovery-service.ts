import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type WindowsPortProxyRule = {
  readonly listenAddress: string;
  readonly listenPort: number;
  readonly connectAddress: string;
  readonly connectPort: number;
};

export type WindowsBrowserProcess = {
  readonly name: string;
  readonly processId: number;
  readonly commandLine: string;
  readonly remoteDebuggingPort?: number | undefined;
};

export type WindowsBrowserAttachTopology = {
  readonly portProxyRules: readonly WindowsPortProxyRule[];
  readonly browserProcesses: readonly WindowsBrowserProcess[];
  readonly remoteDebuggingPorts: readonly number[];
};

type ExecFileImplementation = typeof execFileAsync;
type NarrowExecFileImplementation = (
  file: string,
  args: readonly string[],
) => Promise<{
  stdout: string;
  stderr: string;
}>;

function parsePort(value: string): number | null {
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

export function parseWindowsPortProxyRules(output: string): WindowsPortProxyRule[] {
  const rules: WindowsPortProxyRule[] = [];
  const seen = new Set<string>();

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match =
      /^([0-9.]+)\s+([0-9]+)\s+([0-9.]+)\s+([0-9]+)$/.exec(line) ??
      /^([0-9A-Fa-f:.]+)\s+([0-9]+)\s+([0-9A-Fa-f:.]+)\s+([0-9]+)$/.exec(line);
    if (!match) {
      continue;
    }
    const listenAddress = match[1];
    const listenPortRaw = match[2];
    const connectAddress = match[3];
    const connectPortRaw = match[4];
    if (!listenAddress || !listenPortRaw || !connectAddress || !connectPortRaw) {
      continue;
    }

    const listenPort = parsePort(listenPortRaw);
    const connectPort = parsePort(connectPortRaw);
    if (!listenPort || !connectPort) {
      continue;
    }

    const rule: WindowsPortProxyRule = {
      listenAddress,
      listenPort,
      connectAddress,
      connectPort,
    };
    const key = `${rule.listenAddress}:${rule.listenPort}->${rule.connectAddress}:${rule.connectPort}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    rules.push(rule);
  }

  return rules;
}

export function extractRemoteDebuggingPort(commandLine: string): number | undefined {
  const match = /--remote-debugging-port(?:=|\s+)(\d+)/i.exec(commandLine);
  if (!match) {
    return undefined;
  }
  const portValue = match[1];
  if (!portValue) {
    return undefined;
  }
  const parsed = parsePort(portValue);
  return parsed ?? undefined;
}

export function parseWindowsBrowserProcesses(output: string): WindowsBrowserProcess[] {
  const parsed = JSON.parse(output) as unknown;
  const entries = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  const processes: WindowsBrowserProcess[] = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const name = typeof record.Name === 'string' ? record.Name : undefined;
    const processId = typeof record.ProcessId === 'number' ? record.ProcessId : undefined;
    const commandLine =
      typeof record.CommandLine === 'string' ? record.CommandLine : undefined;
    if (!name || !processId || !commandLine) {
      continue;
    }
    processes.push({
      name,
      processId,
      commandLine,
      ...(extractRemoteDebuggingPort(commandLine)
        ? { remoteDebuggingPort: extractRemoteDebuggingPort(commandLine) }
        : {}),
    });
  }

  return processes;
}

export class WindowsBrowserAttachDiscoveryService {
  public constructor(
    private readonly execFileImplementation: NarrowExecFileImplementation = (
      file,
      args,
    ) => execFileAsync(file, args) as Promise<{ stdout: string; stderr: string }>,
    private readonly powershellPath = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
    private readonly netshPath = '/mnt/c/Windows/System32/netsh.exe',
  ) {}

  public async discover(): Promise<WindowsBrowserAttachTopology> {
    const [portProxyRules, browserProcesses] = await Promise.all([
      this.readPortProxyRules(),
      this.readBrowserProcesses(),
    ]);
    const remoteDebuggingPorts = [
      ...new Set(
        browserProcesses
          .map((process) => process.remoteDebuggingPort)
          .filter((port): port is number => typeof port === 'number'),
      ),
    ];

    return {
      portProxyRules,
      browserProcesses,
      remoteDebuggingPorts,
    };
  }

  private async readPortProxyRules(): Promise<WindowsPortProxyRule[]> {
    try {
      const { stdout } = await this.execFileImplementation(this.netshPath, [
        'interface',
        'portproxy',
        'show',
        'all',
      ]);
      return parseWindowsPortProxyRules(stdout);
    } catch {
      return [];
    }
  }

  private async readBrowserProcesses(): Promise<WindowsBrowserProcess[]> {
    try {
      const { stdout } = await this.execFileImplementation(this.powershellPath, [
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_Process -Filter "Name = \'chrome.exe\' OR Name = \'msedge.exe\'" | Select-Object Name,ProcessId,CommandLine | ConvertTo-Json -Depth 3',
      ]);
      return parseWindowsBrowserProcesses(stdout);
    } catch {
      return [];
    }
  }
}
