import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import {
  BrowserAttachDiagnosticSchema,
  BrowserAttachPreflightSchema,
  BrowserEndpointCandidateSchema,
  BrowserEndpointDiscoverySchema,
  BrowserEndpointProbeSchema,
  type BrowserAttachDiagnostic,
  type BrowserAttachFailureCategory,
  type BrowserAttachPreflight,
  type BrowserAttachRecommendation,
  type BrowserEndpointCandidate,
  type BrowserEndpointDiscovery,
  type BrowserEndpointProbe,
} from '../api/schemas/diagnostics-contracts';
import { resolveStartupUrl } from '../utils/devtools-endpoint-normalizer';
import { BridgeHealthService } from './bridge-health-service';
import { BrowserEndpointDiscoveryService } from './browser-endpoint-discovery-service';
import { DevtoolsProbeService } from './devtools-probe-service';

const execFileAsync = promisify(execFile);
const DEFAULT_POWERSHELL_PATH =
  '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';

type WindowsLocalSourceProbeResult = {
  readonly endpoint: string;
  readonly available: boolean;
  readonly versionReachable?: boolean | undefined;
  readonly listReachable?: boolean | undefined;
  readonly failureCategory?: BrowserAttachFailureCategory | undefined;
  readonly metadata: Record<string, unknown>;
};

type WindowsLocalSourceProbeInput = {
  readonly connectAddress: string;
  readonly connectPort: number;
  readonly timeoutMs: number;
};

type WindowsLocalSourceProbe = (
  input: WindowsLocalSourceProbeInput,
) => Promise<WindowsLocalSourceProbeResult>;

type ExecFileImplementation = (
  file: string,
  args: readonly string[],
) => Promise<{
  stdout: string;
  stderr: string;
}>;

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function parseJsonValue(raw: string): unknown {
  return JSON.parse(raw) as unknown;
}

function dedupeRecommendations(
  recommendations: readonly BrowserAttachRecommendation[],
): BrowserAttachRecommendation[] {
  return [...new Set(recommendations)];
}

function summarizeFailureCategory(
  probes: BrowserAttachDiagnostic['probes'],
): BrowserAttachFailureCategory | undefined {
  const priority: BrowserAttachFailureCategory[] = [
    'BROWSER_ENDPOINT_MISCONFIGURED',
    'REMOTE_DEBUGGING_DISABLED_OR_BLOCKED',
    'DEVTOOLS_LIST_UNREACHABLE',
    'DEVTOOLS_VERSION_UNREACHABLE',
    'NO_ATTACHABLE_TARGETS',
    'HOST_NETWORK_UNREACHABLE',
    'TCP_UNREACHABLE',
  ];

  for (const category of priority) {
    if (probes.some((probe) => probe.failureCategory === category)) {
      return category;
    }
  }

  return undefined;
}

function updateCandidateState(
  candidate: BrowserEndpointCandidate,
  state: BrowserEndpointCandidate['state'],
  failureCategory?: BrowserAttachFailureCategory | undefined,
): BrowserEndpointCandidate {
  return BrowserEndpointCandidateSchema.parse({
    ...candidate,
    state,
    ...(failureCategory ? { lastFailureCategory: failureCategory } : {}),
  });
}

function classifyWindowsLocalFailure(
  payload: {
    ok: boolean;
    statusCode?: number | undefined;
    parseOk?: boolean | undefined;
  },
  phase: 'version' | 'list',
): BrowserAttachFailureCategory {
  if (!payload.ok) {
    if (payload.statusCode === 403 || payload.statusCode === 404) {
      return 'REMOTE_DEBUGGING_DISABLED_OR_BLOCKED';
    }
    return phase === 'version' ? 'DEVTOOLS_VERSION_UNREACHABLE' : 'DEVTOOLS_LIST_UNREACHABLE';
  }

  return phase === 'version' ? 'DEVTOOLS_VERSION_UNREACHABLE' : 'DEVTOOLS_LIST_UNREACHABLE';
}

function buildTopologyRecommendations(input: {
  primaryProbe: BrowserEndpointProbe;
  windowsLocalSource?: WindowsLocalSourceProbeResult | undefined;
}): BrowserAttachRecommendation[] {
  const recommendations: BrowserAttachRecommendation[] = [];
  if (!input.windowsLocalSource?.available) {
    return recommendations;
  }

  if (
    input.windowsLocalSource.versionReachable &&
    input.windowsLocalSource.listReachable &&
    !input.primaryProbe.attachReady
  ) {
    recommendations.push('enable mirrored networking or adjust firewall');
    if (input.primaryProbe.candidate.host === '127.0.0.1' || input.primaryProbe.candidate.host === 'localhost') {
      recommendations.push('use host IP instead of localhost');
    }
    return recommendations;
  }

  if (!input.windowsLocalSource.versionReachable || !input.windowsLocalSource.listReachable) {
    recommendations.push('start Edge with --remote-debugging-port');
    recommendations.push('check RemoteDebuggingAllowed policy');
  }

  return recommendations;
}

function buildTopologyRootCause(input: {
  primaryProbe: BrowserEndpointProbe;
  windowsLocalSource?: WindowsLocalSourceProbeResult | undefined;
}): string | undefined {
  if (!input.windowsLocalSource?.available) {
    return 'windows_local_source_probe_unavailable';
  }

  if (
    input.windowsLocalSource.versionReachable &&
    input.windowsLocalSource.listReachable &&
    !input.primaryProbe.attachReady
  ) {
    return 'browser_local_source_healthy_wsl_visible_proxy_broken';
  }

  if (!input.windowsLocalSource.versionReachable || !input.windowsLocalSource.listReachable) {
    return 'browser_local_source_unhealthy';
  }

  if (input.primaryProbe.attachReady) {
    return 'browser_local_source_and_proxy_path_healthy';
  }

  return undefined;
}

function buildWindowsLocalSourceMetadata(
  candidate: BrowserEndpointCandidate,
  connectAddress: string,
  connectPort: number,
): Record<string, unknown> {
  return {
    candidateEndpoint: candidate.endpoint,
    connectAddress,
    connectPort,
  };
}

async function defaultProbeWindowsLocalSource(
  input: WindowsLocalSourceProbeInput,
  execFileImplementation: ExecFileImplementation = (file, args) =>
    execFileAsync(file, args) as Promise<{ stdout: string; stderr: string }>,
  powershellPath = DEFAULT_POWERSHELL_PATH,
): Promise<WindowsLocalSourceProbeResult> {
  const endpoint = `http://${input.connectAddress}:${input.connectPort}`;
  const versionUrl = `${endpoint}/json/version`;
  const listUrl = `${endpoint}/json/list`;
  const timeoutSeconds = Math.max(1, Math.ceil(input.timeoutMs / 1000));
  const script = [
    '$ErrorActionPreference="Stop"',
    'function Invoke-DevtoolsProbe($Url, $TimeoutSeconds) {',
    '  try {',
    '    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSeconds',
    '    return [pscustomobject]@{ ok = $true; statusCode = [int]$response.StatusCode; body = $response.Content }',
    '  } catch {',
    '    $statusCode = $null',
    '    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {',
    '      $statusCode = [int]$_.Exception.Response.StatusCode',
    '    }',
    '    return [pscustomobject]@{ ok = $false; statusCode = $statusCode; message = $_.Exception.Message }',
    '  }',
    '}',
    `$version = Invoke-DevtoolsProbe "${versionUrl}" ${timeoutSeconds}`,
    `$list = Invoke-DevtoolsProbe "${listUrl}" ${timeoutSeconds}`,
    '[pscustomobject]@{ version = $version; list = $list } | ConvertTo-Json -Depth 6 -Compress',
  ].join('; ');

  try {
    const { stdout } = await execFileImplementation(powershellPath, ['-NoProfile', '-Command', script]);
    const parsed = JSON.parse(stdout) as {
      version?: {
        ok?: boolean;
        statusCode?: number;
        body?: string;
        message?: string;
      };
      list?: {
        ok?: boolean;
        statusCode?: number;
        body?: string;
        message?: string;
      };
    };

    const versionPayload = parsed.version ?? {};
    const listPayload = parsed.list ?? {};

    if (!versionPayload.ok) {
      return {
        endpoint,
        available: true,
        versionReachable: false,
        listReachable: false,
        failureCategory: classifyWindowsLocalFailure(
          {
            ok: false,
            statusCode: versionPayload.statusCode,
          },
          'version',
        ),
        metadata: {
          versionFailure: versionPayload,
        },
      };
    }

    let versionBodyParseOk = false;
    try {
      const parsedVersionBody = parseJsonValue(versionPayload.body ?? '{}');
      versionBodyParseOk = parsedVersionBody !== null && !Array.isArray(parsedVersionBody);
    } catch {
      versionBodyParseOk = false;
    }
    if (!versionBodyParseOk) {
      return {
        endpoint,
        available: true,
        versionReachable: false,
        listReachable: false,
        failureCategory: 'DEVTOOLS_VERSION_UNREACHABLE',
        metadata: {
          versionFailure: {
            ...versionPayload,
            parseOk: false,
          },
        },
      };
    }

    if (!listPayload.ok) {
      return {
        endpoint,
        available: true,
        versionReachable: true,
        listReachable: false,
        failureCategory: classifyWindowsLocalFailure(
          {
            ok: false,
            statusCode: listPayload.statusCode,
          },
          'list',
        ),
        metadata: {
          listFailure: listPayload,
        },
      };
    }

    let listBodyParseOk = false;
    try {
      const parsedListBody = parseJsonValue(listPayload.body ?? '[]');
      listBodyParseOk = Array.isArray(parsedListBody);
    } catch {
      listBodyParseOk = false;
    }
    if (!listBodyParseOk) {
      return {
        endpoint,
        available: true,
        versionReachable: true,
        listReachable: false,
        failureCategory: 'DEVTOOLS_LIST_UNREACHABLE',
        metadata: {
          listFailure: {
            ...listPayload,
            parseOk: false,
          },
        },
      };
    }

    return {
      endpoint,
      available: true,
      versionReachable: true,
      listReachable: true,
      metadata: {},
    };
  } catch (error) {
    return {
      endpoint,
      available: false,
      metadata: {
        error: error instanceof Error ? error.message : String(error),
        probeUnavailable: true,
      },
    };
  }
}

export class BrowserAttachDiagnosticsService {
  public constructor(
    private readonly artifactDir: string,
    private readonly discoveryService: BrowserEndpointDiscoveryService,
    private readonly probeService: DevtoolsProbeService,
    private readonly bridgeHealthService?: BridgeHealthService,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly windowsLocalSourceProbe: WindowsLocalSourceProbe = (input) =>
      defaultProbeWindowsLocalSource(input),
  ) {}

  public async listBrowserEndpoints(input?: {
    browserUrl?: string | undefined;
    browserEndpoint?: string | undefined;
  }): Promise<BrowserEndpointDiscovery> {
    const discovery = await this.discoveryService.discover(input);
    const artifactPath = path.join(this.artifactDir, 'diagnostics', 'browser-endpoints.json');
    await writeJson(artifactPath, discovery);
    return BrowserEndpointDiscoverySchema.parse({
      ...discovery,
      artifactPath,
      metadata: {
        ...discovery.metadata,
        evidenceKind: 'browser_attach_readiness',
      },
    });
  }

  public async runBrowserAttachDiagnostic(input?: {
    browserUrl?: string | undefined;
    browserEndpoint?: string | undefined;
    startupUrl?: string | undefined;
  }): Promise<BrowserAttachDiagnostic> {
    const discovery = await this.listBrowserEndpoints({
      browserUrl: input?.browserUrl,
      browserEndpoint: input?.browserEndpoint,
    });
    const effectiveStartupUrl = resolveStartupUrl(input ?? {});

    const probes: BrowserAttachDiagnostic['probes'] = [];
    const candidates: BrowserEndpointCandidate[] = [];
    const topologySummary: Array<Record<string, unknown>> = [];
    let selectedCandidate: BrowserEndpointCandidate | undefined;
    let selectedTarget: BrowserAttachDiagnostic['selectedTarget'] | undefined;

    for (const candidate of discovery.candidates) {
      const probe = await this.probeService.probeCandidate(candidate);
      const layeredMetadata: Record<string, unknown> = {};
      let layeredRecommendations = [...probe.recommendations];

      if (candidate.source === 'windows_portproxy_rule') {
        const connectAddress =
          typeof candidate.metadata.connectAddress === 'string'
            ? candidate.metadata.connectAddress
            : '127.0.0.1';
        const connectPort =
          typeof candidate.metadata.connectPort === 'number'
            ? candidate.metadata.connectPort
            : undefined;
        if (connectPort) {
          const windowsLocalSource = await this.windowsLocalSourceProbe({
            connectAddress,
            connectPort,
            timeoutMs: 5000,
          });
          const rootCause = buildTopologyRootCause({
            primaryProbe: probe,
            windowsLocalSource,
          });
          layeredRecommendations = dedupeRecommendations([
            ...layeredRecommendations,
            ...buildTopologyRecommendations({
              primaryProbe: probe,
              windowsLocalSource,
            }),
          ]);
          layeredMetadata.topology = {
            portProxyPath: {
              endpoint: candidate.endpoint,
              failureCategory: probe.failureCategory,
              tcpReachable: probe.tcpReachable,
              versionReachable: probe.versionReachable,
              listReachable: probe.listReachable,
            },
            windowsLocalSource: {
              ...buildWindowsLocalSourceMetadata(candidate, connectAddress, connectPort),
              ...windowsLocalSource,
            },
            ...(rootCause ? { rootCause } : {}),
          };
          topologySummary.push({
            endpoint: candidate.endpoint,
            source: candidate.source,
            topology: layeredMetadata.topology,
          });
        }
      }

      const probeArtifactPath = path.join(
        this.artifactDir,
        'diagnostics',
        'probes',
        `${probe.probeId}.json`,
      );
      const parsedProbe = BrowserEndpointProbeSchema.parse({
        ...probe,
        recommendations: layeredRecommendations,
        artifactPath: probeArtifactPath,
        metadata: {
          ...probe.metadata,
          ...layeredMetadata,
        },
      });
      await writeJson(probeArtifactPath, parsedProbe);
      probes.push(parsedProbe);

      if (parsedProbe.attachReady && !selectedCandidate) {
        selectedCandidate = updateCandidateState(candidate, 'candidate_selected');
        selectedTarget = parsedProbe.selectedTarget;
        candidates.push(selectedCandidate);
        continue;
      }

      if (parsedProbe.attachReady) {
        candidates.push(updateCandidateState(candidate, 'candidate_reachable'));
        continue;
      }

      candidates.push(
        updateCandidateState(candidate, 'candidate_rejected', parsedProbe.failureCategory),
      );
    }

    const failureCategory = selectedCandidate ? undefined : summarizeFailureCategory(probes);
    const recommendations = selectedCandidate
      ? dedupeRecommendations(probes.flatMap((probe) => probe.recommendations))
      : dedupeRecommendations([
          ...probes.flatMap((probe) => probe.recommendations),
          ...(failureCategory === 'TCP_UNREACHABLE'
            ? ['start Edge with --remote-debugging-port' as const]
            : []),
        ]);

    const topologyArtifactPath = path.join(
      this.artifactDir,
      'diagnostics',
      'browser-attach-topology-latest.json',
    );
    await writeJson(topologyArtifactPath, {
      requestedBrowserUrl: input?.browserUrl,
      requestedBrowserEndpoint: input?.browserEndpoint,
      effectiveStartupUrl,
      discoveryArtifactPath: discovery.artifactPath,
      hostIpCandidates: discovery.metadata.hostIpCandidates ?? [],
      windowsPortProxyRules: discovery.metadata.windowsPortProxyRules ?? [],
      windowsBrowserProcesses: discovery.metadata.windowsBrowserProcesses ?? [],
      windowsRemoteDebuggingPorts: discovery.metadata.windowsRemoteDebuggingPorts ?? [],
      layeredCandidates: topologySummary,
      createdAt: this.now(),
    });

    const latestArtifactPath = path.join(
      this.artifactDir,
      'diagnostics',
      'browser-attach-latest.json',
    );
    const diagnostic = BrowserAttachDiagnosticSchema.parse({
      diagnosticId: randomUUID(),
      ...(input?.browserUrl ? { requestedBrowserUrl: input.browserUrl } : {}),
      ...(input?.browserEndpoint ? { requestedBrowserEndpoint: input.browserEndpoint } : {}),
      ...(effectiveStartupUrl ? { effectiveStartupUrl } : {}),
      attachReady: Boolean(selectedCandidate),
      candidates,
      probes,
      ...(selectedCandidate ? { selectedCandidate } : {}),
      ...(selectedTarget ? { selectedTarget } : {}),
      ...(failureCategory ? { failureCategory } : {}),
      recommendations,
      ...(discovery.artifactPath ? { discoveryArtifactPath: discovery.artifactPath } : {}),
      topologyArtifactPath,
      latestArtifactPath,
      createdAt: this.now(),
      metadata: {
        evidenceKinds: ['browser_attach_diagnostic', 'browser_attach_readiness'],
        topologySummary,
      },
    });

    await writeJson(latestArtifactPath, diagnostic);
    await this.bridgeHealthService?.recordHealth({
      status: diagnostic.attachReady ? 'ready' : 'degraded',
      checkedAt: diagnostic.createdAt,
      activeSessions: 0,
      activeConversations: 0,
      issues: diagnostic.attachReady
        ? []
        : [
            diagnostic.failureCategory ??
              'Browser attach diagnostic did not find a usable DevTools endpoint.',
          ],
      metadata: {
        diagnosticId: diagnostic.diagnosticId,
        ...(selectedCandidate ? { selectedEndpoint: selectedCandidate.endpoint } : {}),
      },
    });

    return diagnostic;
  }

  public async recordBrowserAttachPreflight(input: {
    diagnostic: BrowserAttachDiagnostic;
    allowOpenSession: boolean;
  }): Promise<BrowserAttachPreflight> {
    const artifactPath = path.join(
      this.artifactDir,
      'diagnostics',
      'browser-attach-preflight-latest.json',
    );
    const preflight = BrowserAttachPreflightSchema.parse({
      preflightId: randomUUID(),
      diagnosticId: input.diagnostic.diagnosticId,
      ...(input.diagnostic.requestedBrowserUrl
        ? { requestedBrowserUrl: input.diagnostic.requestedBrowserUrl }
        : {}),
      ...(input.diagnostic.requestedBrowserEndpoint
        ? { requestedBrowserEndpoint: input.diagnostic.requestedBrowserEndpoint }
        : {}),
      ...(input.diagnostic.selectedCandidate
        ? { effectiveBrowserUrl: input.diagnostic.selectedCandidate.endpoint }
        : {}),
      ...(input.diagnostic.effectiveStartupUrl
        ? { effectiveStartupUrl: input.diagnostic.effectiveStartupUrl }
        : {}),
      allowOpenSession: input.allowOpenSession,
      ...(input.diagnostic.failureCategory
        ? { failureCategory: input.diagnostic.failureCategory }
        : {}),
      recommendations: input.diagnostic.recommendations,
      artifactPath,
      createdAt: this.now(),
      metadata: {
        evidenceKind: 'browser_attach_preflight',
      },
    });
    await writeJson(artifactPath, preflight);
    return preflight;
  }

  public async getLatestBrowserAttachDiagnostic(): Promise<BrowserAttachDiagnostic | null> {
    const latestArtifactPath = path.join(
      this.artifactDir,
      'diagnostics',
      'browser-attach-latest.json',
    );
    try {
      const raw = await fs.readFile(latestArtifactPath, 'utf8');
      return BrowserAttachDiagnosticSchema.parse(JSON.parse(raw));
    } catch (error) {
      const cast = error as NodeJS.ErrnoException;
      if (cast.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }
}
