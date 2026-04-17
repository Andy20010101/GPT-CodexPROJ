import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import {
  BrowserEndpointCandidateSchema,
  BrowserEndpointDiscoverySchema,
  type BrowserEndpointCandidate,
  type BrowserEndpointCandidateSource,
  type BrowserEndpointDiscovery,
} from '../api/schemas/diagnostics-contracts';
import { normalizeDevtoolsEndpoint } from '../utils/devtools-endpoint-normalizer';
import {
  discoverHostIpCandidates,
  type HostIpCandidate,
} from '../utils/host-ip-discovery';
import {
  WindowsBrowserAttachDiscoveryService,
  type WindowsBrowserAttachTopology,
} from './windows-browser-attach-discovery-service';
import { BrowserAuthorityService } from './browser-authority-service';

type DiscoveryEnv = Record<string, string | undefined>;

function parsePorts(env: DiscoveryEnv): number[] {
  const configured = env.BRIDGE_BROWSER_PORTS;
  const raw = configured && configured.trim().length > 0 ? configured.split(',') : ['9222', '9223'];
  const ports = raw
    .map((entry) => Number.parseInt(entry.trim(), 10))
    .filter((entry) => Number.isInteger(entry) && entry > 0);
  return ports.length > 0 ? [...new Set(ports)] : [9222, 9223];
}

function splitCandidates(value: string | undefined): string[] {
  if (!value || value.trim().length === 0) {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function isWildcardListenAddress(address: string): boolean {
  return address === '0.0.0.0' || address === '::' || address === '*';
}

export class BrowserEndpointDiscoveryService {
  public constructor(
    private readonly env: DiscoveryEnv = process.env,
    private readonly hostIpDiscovery: () => Promise<HostIpCandidate[]> = () =>
      discoverHostIpCandidates(),
    private readonly windowsAttachDiscovery: () => Promise<WindowsBrowserAttachTopology> = () =>
      new WindowsBrowserAttachDiscoveryService().discover(),
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly readAuthorityFile: (filePath: string) => Promise<string | null> = async (
      filePath,
    ) => {
      try {
        return await fs.readFile(filePath, 'utf8');
      } catch {
        return null;
      }
    },
    private readonly browserAuthorityService: BrowserAuthorityService = new BrowserAuthorityService(
      env,
      readAuthorityFile,
    ),
  ) {}

  public async discover(input?: {
    browserUrl?: string | undefined;
    browserEndpoint?: string | undefined;
  }): Promise<BrowserEndpointDiscovery> {
    const candidates: BrowserEndpointCandidate[] = [];
    const seen = new Set<string>();
    const ports = parsePorts(this.env);
    const [hostIpCandidates, windowsAttachTopology] = await Promise.all([
      this.hostIpDiscovery(),
      this.windowsAttachDiscovery(),
    ]);

      const pushCandidate = (
        rawUrl: string,
        source: BrowserEndpointCandidateSource,
        reason: string,
        metadata?: Record<string, unknown>,
      ): void => {
      const normalized = normalizeDevtoolsEndpoint(rawUrl);
      if (!normalized) {
        return;
      }
      if (seen.has(normalized.endpoint)) {
        return;
      }
      seen.add(normalized.endpoint);
      candidates.push(
        BrowserEndpointCandidateSchema.parse({
          candidateId: randomUUID(),
          endpoint: normalized.endpoint,
          host: normalized.host,
          port: normalized.port,
          versionUrl: normalized.versionUrl,
          listUrl: normalized.listUrl,
          source,
          reason,
          state: 'candidate_discovered',
          discoveredAt: this.now(),
          metadata: {
            evidenceKind: 'browser_endpoint_candidate',
            ...metadata,
          },
        }),
      );
    };

    if (input?.browserEndpoint) {
      pushCandidate(
        input.browserEndpoint,
        'request_input',
        'Requested browserEndpoint override was already a DevTools-compatible endpoint.',
      );
    } else if (input?.browserUrl) {
      pushCandidate(
        input.browserUrl,
        'request_input',
        'Requested browserUrl legacy alias was already a DevTools-compatible endpoint.',
      );
    }

    const authorityBrowserEndpoint = await this.browserAuthorityService.readAuthorityBrowserEndpoint();
    if (authorityBrowserEndpoint) {
      pushCandidate(
        authorityBrowserEndpoint,
        'env_state_browser_authority',
        'Discovered from SELF_IMPROVEMENT_ENV_STATE_PATH browser authority.',
      );
    }

    pushCandidate(
      this.env.BRIDGE_BROWSER_URL ?? '',
      'env_browser_url',
      'Discovered from BRIDGE_BROWSER_URL.',
    );
    pushCandidate(
      this.env.BRIDGE_BROWSER_CONNECT_URL ?? '',
      'env_connect_url',
      'Discovered from BRIDGE_BROWSER_CONNECT_URL.',
    );
    pushCandidate(
      this.env.CHATGPT_BROWSER_URL ?? '',
      'env_chatgpt_browser_url',
      'Discovered from CHATGPT_BROWSER_URL.',
    );

    for (const candidate of splitCandidates(this.env.BRIDGE_BROWSER_URL_CANDIDATES)) {
      pushCandidate(
        candidate,
        'env_browser_url_candidates',
        'Discovered from BRIDGE_BROWSER_URL_CANDIDATES.',
      );
    }

    for (const remoteDebuggingPort of windowsAttachTopology.remoteDebuggingPorts) {
      pushCandidate(
        `http://127.0.0.1:${remoteDebuggingPort}`,
        'windows_browser_process',
        `Discovered active Windows browser remote debugging port ${remoteDebuggingPort} from browser process command lines.`,
        {
          remoteDebuggingPort,
          topologyLayer: 'windows_local_source',
        },
      );
      pushCandidate(
        `http://localhost:${remoteDebuggingPort}`,
        'windows_browser_process',
        `Discovered active Windows browser remote debugging port ${remoteDebuggingPort} from browser process command lines.`,
        {
          remoteDebuggingPort,
          topologyLayer: 'windows_local_source',
        },
      );
      for (const hostCandidate of hostIpCandidates) {
        pushCandidate(
          `http://${hostCandidate.host}:${remoteDebuggingPort}`,
          'windows_browser_process',
          `Derived from an active Windows browser remote debugging port ${remoteDebuggingPort} combined with the WSL-visible host candidate ${hostCandidate.host}.`,
          {
            remoteDebuggingPort,
            topologyLayer: 'wsl_visible_host_candidate',
            hostCandidate,
          },
        );
      }
    }

    for (const rule of windowsAttachTopology.portProxyRules) {
      const matchedRemoteDebuggingPort = windowsAttachTopology.remoteDebuggingPorts.includes(
        rule.connectPort,
      );
      const reasonSuffix = matchedRemoteDebuggingPort
        ? ` It matches an active Windows browser remote debugging port ${rule.connectPort}.`
        : ` It forwards to Windows ${rule.connectAddress}:${rule.connectPort}.`;

      if (!isWildcardListenAddress(rule.listenAddress) && rule.listenAddress !== '127.0.0.1') {
        pushCandidate(
          `http://${rule.listenAddress}:${rule.listenPort}`,
          'windows_portproxy_rule',
          `Discovered from Windows portproxy listen ${rule.listenAddress}:${rule.listenPort}.${reasonSuffix}`,
          {
            listenAddress: rule.listenAddress,
            listenPort: rule.listenPort,
            connectAddress: rule.connectAddress,
            connectPort: rule.connectPort,
            matchedRemoteDebuggingPort,
            topologyLayer: 'wsl_visible_portproxy',
          },
        );
      } else {
        for (const hostCandidate of hostIpCandidates) {
          pushCandidate(
            `http://${hostCandidate.host}:${rule.listenPort}`,
            'windows_portproxy_rule',
            `Discovered from Windows portproxy listen ${rule.listenAddress}:${rule.listenPort} via WSL host candidate ${hostCandidate.host}.${reasonSuffix}`,
            {
              listenAddress: rule.listenAddress,
              listenPort: rule.listenPort,
              connectAddress: rule.connectAddress,
              connectPort: rule.connectPort,
              matchedRemoteDebuggingPort,
              hostCandidate,
              topologyLayer: 'wsl_visible_portproxy',
            },
          );
        }
      }
    }

    for (const port of ports) {
      pushCandidate(
        `http://127.0.0.1:${port}`,
        'localhost',
        `Default localhost candidate for port ${port}.`,
      );
      pushCandidate(
        `http://localhost:${port}`,
        'localhost',
        `Default localhost hostname candidate for port ${port}.`,
      );
    }

    for (const hostCandidate of hostIpCandidates) {
      for (const port of ports) {
        pushCandidate(
          `http://${hostCandidate.host}:${port}`,
          hostCandidate.source,
          `${hostCandidate.reason} Port ${port} is part of the active browser endpoint candidate set.`,
        );
      }
    }

    return BrowserEndpointDiscoverySchema.parse({
      discoveryId: randomUUID(),
      ...(input?.browserUrl ? { requestedBrowserUrl: input.browserUrl } : {}),
      ...(input?.browserEndpoint ? { requestedBrowserEndpoint: input.browserEndpoint } : {}),
      candidates,
      discoveredAt: this.now(),
      metadata: {
        evidenceKind: 'browser_attach_readiness',
        ports,
        hostIpCandidates,
        windowsPortProxyRules: windowsAttachTopology.portProxyRules,
        windowsBrowserProcesses: windowsAttachTopology.browserProcesses,
        windowsRemoteDebuggingPorts: windowsAttachTopology.remoteDebuggingPorts,
      },
    });
  }
}
