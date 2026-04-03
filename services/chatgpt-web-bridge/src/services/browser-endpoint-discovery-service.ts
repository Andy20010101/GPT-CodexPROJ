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

export class BrowserEndpointDiscoveryService {
  public constructor(
    private readonly env: DiscoveryEnv = process.env,
    private readonly hostIpDiscovery: () => Promise<HostIpCandidate[]> = () =>
      discoverHostIpCandidates(),
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async discover(input?: {
    browserUrl?: string | undefined;
  }): Promise<BrowserEndpointDiscovery> {
    const candidates: BrowserEndpointCandidate[] = [];
    const seen = new Set<string>();
    const ports = parsePorts(this.env);

    const pushCandidate = (
      rawUrl: string,
      source: BrowserEndpointCandidateSource,
      reason: string,
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
          },
        }),
      );
    };

    if (input?.browserUrl) {
      pushCandidate(
        input.browserUrl,
        'request_input',
        'Requested browser URL was already a DevTools-compatible endpoint.',
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

    const hostIpCandidates = await this.hostIpDiscovery();
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
      candidates,
      discoveredAt: this.now(),
      metadata: {
        evidenceKind: 'browser_attach_readiness',
        ports,
      },
    });
  }
}
