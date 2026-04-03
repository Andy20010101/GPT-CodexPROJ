import { randomUUID } from 'node:crypto';
import net from 'node:net';

import {
  BrowserEndpointProbeSchema,
  type BrowserAttachFailureCategory,
  type BrowserAttachRecommendation,
  type BrowserEndpointCandidate,
  type BrowserEndpointProbe,
  type DevtoolsTarget,
} from '../api/schemas/diagnostics-contracts';

type TcpProbeResult =
  | {
      reachable: true;
    }
  | {
      reachable: false;
      errorCode?: string | undefined;
      errorMessage?: string | undefined;
    };

type HttpFetch = typeof fetch;

type FetchFailure = {
  type: 'network' | 'http' | 'invalid_payload';
  message: string;
  status?: number | undefined;
  details?: unknown;
};

function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost';
}

function classifyTcpFailure(
  candidate: BrowserEndpointCandidate,
  errorCode: string | undefined,
): BrowserAttachFailureCategory {
  if (
    !isLoopbackHost(candidate.host) &&
    (errorCode === 'EHOSTUNREACH' ||
      errorCode === 'ENETUNREACH' ||
      errorCode === 'ETIMEDOUT' ||
      errorCode === 'ECONNRESET')
  ) {
    return 'HOST_NETWORK_UNREACHABLE';
  }
  return 'TCP_UNREACHABLE';
}

function dedupeRecommendations(
  recommendations: readonly BrowserAttachRecommendation[],
): BrowserAttachRecommendation[] {
  return [...new Set(recommendations)];
}

function buildRecommendations(input: {
  candidate: BrowserEndpointCandidate;
  failureCategory: BrowserAttachFailureCategory;
}): BrowserAttachRecommendation[] {
  switch (input.failureCategory) {
    case 'BROWSER_ENDPOINT_MISCONFIGURED':
      return ['use host IP instead of localhost'];
    case 'TCP_UNREACHABLE':
      return isLoopbackHost(input.candidate.host)
        ? ['use host IP instead of localhost', 'start Edge with --remote-debugging-port']
        : ['start Edge with --remote-debugging-port'];
    case 'HOST_NETWORK_UNREACHABLE':
      return ['enable mirrored networking or adjust firewall'];
    case 'DEVTOOLS_VERSION_UNREACHABLE':
      return [
        'start Edge with --remote-debugging-port',
        'check RemoteDebuggingAllowed policy',
      ];
    case 'DEVTOOLS_LIST_UNREACHABLE':
      return ['check RemoteDebuggingAllowed policy'];
    case 'NO_ATTACHABLE_TARGETS':
      return ['ensure correct user profile / target tab exists'];
    case 'REMOTE_DEBUGGING_DISABLED_OR_BLOCKED':
      return [
        'start Edge with --remote-debugging-port',
        'check RemoteDebuggingAllowed policy',
      ];
  }
}

function selectTarget(targets: DevtoolsTarget[]): DevtoolsTarget | undefined {
  return (
    targets.find((target) => (target.url ?? '').includes('chatgpt.com')) ??
    targets.find((target) => target.type === 'page') ??
    targets.at(0)
  );
}

async function defaultTcpProbe(
  candidate: BrowserEndpointCandidate,
  timeoutMs: number,
): Promise<TcpProbeResult> {
  return new Promise<TcpProbeResult>((resolve) => {
    const socket = net.createConnection({
      host: candidate.host,
      port: candidate.port,
    });

    const finalize = (result: TcpProbeResult): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finalize({ reachable: true }));
    socket.once('timeout', () =>
      finalize({
        reachable: false,
        errorCode: 'ETIMEDOUT',
        errorMessage: 'TCP probe timed out.',
      }),
    );
    socket.once('error', (error) =>
      finalize({
        reachable: false,
        errorCode: (error as NodeJS.ErrnoException).code,
        errorMessage: error.message,
      }),
    );
  });
}

export class DevtoolsProbeService {
  public constructor(
    private readonly fetchImplementation: HttpFetch = fetch,
    private readonly tcpProbe: (
      candidate: BrowserEndpointCandidate,
      timeoutMs: number,
    ) => Promise<TcpProbeResult> = defaultTcpProbe,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async probeCandidate(
    candidate: BrowserEndpointCandidate,
    input?: {
      timeoutMs?: number | undefined;
    },
  ): Promise<BrowserEndpointProbe> {
    const timeoutMs = input?.timeoutMs ?? 5000;
    const probedAt = this.now();
    const tcp = await this.tcpProbe(candidate, timeoutMs);
    if (!tcp.reachable) {
      const failureCategory = classifyTcpFailure(candidate, tcp.errorCode);
      return BrowserEndpointProbeSchema.parse({
        probeId: randomUUID(),
        endpoint: candidate.endpoint,
        candidate,
        tcpReachable: false,
        versionReachable: false,
        listReachable: false,
        attachReady: false,
        targetCount: 0,
        failureCategory,
        recommendations: buildRecommendations({
          candidate,
          failureCategory,
        }),
        probedAt,
        metadata: {
          evidenceKind: 'browser_endpoint_probe',
          tcpErrorCode: tcp.errorCode,
          tcpErrorMessage: tcp.errorMessage,
        },
      });
    }

    const versionResponse = await this.fetchJson(candidate.versionUrl, timeoutMs);
    if (!versionResponse.ok) {
      const failureCategory =
        versionResponse.failure.type === 'http' &&
        (versionResponse.failure.status === 403 || versionResponse.failure.status === 404)
          ? 'REMOTE_DEBUGGING_DISABLED_OR_BLOCKED'
          : 'DEVTOOLS_VERSION_UNREACHABLE';
      return BrowserEndpointProbeSchema.parse({
        probeId: randomUUID(),
        endpoint: candidate.endpoint,
        candidate,
        tcpReachable: true,
        versionReachable: false,
        listReachable: false,
        attachReady: false,
        targetCount: 0,
        failureCategory,
        recommendations: buildRecommendations({
          candidate,
          failureCategory,
        }),
        probedAt,
        metadata: {
          evidenceKind: 'browser_endpoint_probe',
          versionFailure: versionResponse.failure,
        },
      });
    }

    if (Array.isArray(versionResponse.payload)) {
      const failureCategory: BrowserAttachFailureCategory = 'DEVTOOLS_VERSION_UNREACHABLE';
      return BrowserEndpointProbeSchema.parse({
        probeId: randomUUID(),
        endpoint: candidate.endpoint,
        candidate,
        tcpReachable: true,
        versionReachable: false,
        listReachable: false,
        attachReady: false,
        targetCount: 0,
        failureCategory,
        recommendations: buildRecommendations({
          candidate,
          failureCategory,
        }),
        probedAt,
        metadata: {
          evidenceKind: 'browser_endpoint_probe',
          versionFailure: {
            type: 'invalid_payload',
            message: `Expected /json/version to return an object for ${candidate.versionUrl}`,
          },
        },
      });
    }

    const browserInfo = versionResponse.payload;
    const browserWebSocket =
      typeof browserInfo.webSocketDebuggerUrl === 'string'
        ? browserInfo.webSocketDebuggerUrl
        : undefined;

    const listResponse = await this.fetchJson(candidate.listUrl, timeoutMs);
    if (!listResponse.ok) {
      const failureCategory: BrowserAttachFailureCategory = 'DEVTOOLS_LIST_UNREACHABLE';
      return BrowserEndpointProbeSchema.parse({
        probeId: randomUUID(),
        endpoint: candidate.endpoint,
        candidate,
        tcpReachable: true,
        versionReachable: true,
        listReachable: false,
        attachReady: false,
        browserInfo,
        targetCount: 0,
        failureCategory,
        recommendations: buildRecommendations({
          candidate,
          failureCategory,
        }),
        probedAt,
        metadata: {
          evidenceKind: 'browser_endpoint_probe',
          listFailure: listResponse.failure,
        },
      });
    }

    if (!Array.isArray(listResponse.payload)) {
      const failureCategory: BrowserAttachFailureCategory = 'DEVTOOLS_LIST_UNREACHABLE';
      return BrowserEndpointProbeSchema.parse({
        probeId: randomUUID(),
        endpoint: candidate.endpoint,
        candidate,
        tcpReachable: true,
        versionReachable: true,
        listReachable: false,
        attachReady: false,
        browserInfo,
        targetCount: 0,
        failureCategory,
        recommendations: buildRecommendations({
          candidate,
          failureCategory,
        }),
        probedAt,
        metadata: {
          evidenceKind: 'browser_endpoint_probe',
          listFailure: {
            type: 'invalid_payload',
            message: `Expected /json/list to return an array for ${candidate.listUrl}`,
          },
        },
      });
    }

    const targets = listResponse.payload.map((entry) => entry as DevtoolsTarget);
    const attachableTargets = targets.filter((target) => {
      if (typeof target.type !== 'string') {
        return false;
      }
      if (target.type !== 'page' && target.type !== 'webview') {
        return false;
      }
      if (typeof target.url === 'string' && target.url.startsWith('devtools://')) {
        return false;
      }
      return true;
    });
    const selectedTarget = selectTarget(attachableTargets);
    const attachReady = Boolean(browserWebSocket || selectedTarget);
    const failureCategory = attachReady ? undefined : 'NO_ATTACHABLE_TARGETS';

    return BrowserEndpointProbeSchema.parse({
      probeId: randomUUID(),
      endpoint: candidate.endpoint,
      candidate,
      tcpReachable: true,
      versionReachable: true,
      listReachable: true,
      attachReady,
      browserInfo,
      targetCount: attachableTargets.length,
      ...(selectedTarget ? { selectedTarget } : {}),
      ...(failureCategory ? { failureCategory } : {}),
      recommendations: failureCategory
        ? buildRecommendations({
            candidate,
            failureCategory,
          })
        : dedupeRecommendations(
            selectedTarget ? [] : ['ensure correct user profile / target tab exists'],
          ),
      probedAt,
      metadata: {
        evidenceKind: 'browser_endpoint_probe',
        browserWebSocket,
      },
    });
  }

  private async fetchJson(
    url: string,
    timeoutMs: number,
  ): Promise<
    | {
        ok: true;
        payload: Record<string, unknown> | Array<Record<string, unknown>>;
      }
    | {
        ok: false;
        failure: FetchFailure;
      }
  > {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.fetchImplementation(url, {
        signal: controller.signal,
      });
      if (!response.ok) {
        return {
          ok: false,
          failure: {
            type: 'http',
            message: `HTTP ${response.status} while fetching ${url}`,
            status: response.status,
          },
        };
      }

      const payload = (await response.json()) as unknown;
      if (Array.isArray(payload)) {
        return {
          ok: true,
          payload: payload.filter((entry) => entry !== null && typeof entry === 'object') as Array<
            Record<string, unknown>
          >,
        };
      }
      if (payload !== null && typeof payload === 'object') {
        return {
          ok: true,
          payload: payload as Record<string, unknown>,
        };
      }
      return {
        ok: false,
        failure: {
          type: 'invalid_payload',
          message: `Expected JSON object or array while fetching ${url}`,
        },
      };
    } catch (error) {
      return {
        ok: false,
        failure: {
          type: 'network',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
