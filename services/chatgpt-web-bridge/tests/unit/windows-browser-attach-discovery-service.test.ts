import { describe, expect, it } from 'vitest';

import {
  extractRemoteDebuggingPort,
  parseWindowsBrowserProcesses,
  parseWindowsPortProxyRules,
  WindowsBrowserAttachDiscoveryService,
} from '../../src/services/windows-browser-attach-discovery-service';

describe('WindowsBrowserAttachDiscoveryService', () => {
  it('parses Windows portproxy rules', () => {
    const output = `
侦听 ipv4:                 连接到 ipv4:

地址            端口        地址            端口
--------------- ----------  --------------- ----------
172.18.144.1    9223        127.0.0.1       9222
172.18.144.1    9225        127.0.0.1       9224
`;

    expect(parseWindowsPortProxyRules(output)).toEqual([
      {
        listenAddress: '172.18.144.1',
        listenPort: 9223,
        connectAddress: '127.0.0.1',
        connectPort: 9222,
      },
      {
        listenAddress: '172.18.144.1',
        listenPort: 9225,
        connectAddress: '127.0.0.1',
        connectPort: 9224,
      },
    ]);
  });

  it('extracts remote debugging ports from browser command lines', () => {
    expect(
      extractRemoteDebuggingPort(
        '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9224 --user-data-dir=C:\\tmp\\codex-chrome-alt',
      ),
    ).toBe(9224);
    expect(
      extractRemoteDebuggingPort(
        '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port 9333',
      ),
    ).toBe(9333);
    expect(
      extractRemoteDebuggingPort('"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"'),
    ).toBeUndefined();
  });

  it('parses Windows browser process JSON and discovers remote debugging ports', async () => {
    const json = JSON.stringify([
      {
        Name: 'chrome.exe',
        ProcessId: 1234,
        CommandLine:
          '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9224 --user-data-dir=C:\\tmp\\codex-chrome-alt',
      },
      {
        Name: 'msedge.exe',
        ProcessId: 5678,
        CommandLine: '"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"',
      },
    ]);

    expect(parseWindowsBrowserProcesses(json)).toEqual([
      {
        name: 'chrome.exe',
        processId: 1234,
        commandLine:
          '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9224 --user-data-dir=C:\\tmp\\codex-chrome-alt',
        remoteDebuggingPort: 9224,
      },
      {
        name: 'msedge.exe',
        processId: 5678,
        commandLine: '"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"',
      },
    ]);

    const service = new WindowsBrowserAttachDiscoveryService(
      async (file, args) => {
        if (file.endsWith('netsh.exe')) {
          return {
            stdout: `
172.18.144.1    9225        127.0.0.1       9224
`,
            stderr: '',
          };
        }

        if (
          file.endsWith('powershell.exe') &&
          args.some((argument) => argument.includes('Get-CimInstance Win32_Process'))
        ) {
          return {
            stdout: json,
            stderr: '',
          };
        }

        throw new Error(`unexpected command: ${file} ${args.join(' ')}`);
      },
    );

    await expect(service.discover()).resolves.toEqual({
      portProxyRules: [
        {
          listenAddress: '172.18.144.1',
          listenPort: 9225,
          connectAddress: '127.0.0.1',
          connectPort: 9224,
        },
      ],
      browserProcesses: [
        {
          name: 'chrome.exe',
          processId: 1234,
          commandLine:
            '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9224 --user-data-dir=C:\\tmp\\codex-chrome-alt',
          remoteDebuggingPort: 9224,
        },
        {
          name: 'msedge.exe',
          processId: 5678,
          commandLine:
            '"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"',
        },
      ],
      remoteDebuggingPorts: [9224],
    });
  });
});
