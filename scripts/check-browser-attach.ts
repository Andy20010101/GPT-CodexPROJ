import {
  BrowserAttachDiagnosticResponseSchema,
  BrowserEndpointsResponseSchema,
} from '../services/chatgpt-web-bridge/src/api/schemas/diagnostics-contracts';
import { ApiFailureSchema } from '../packages/shared-contracts/chatgpt';

type ScriptOptions = {
  readonly baseUrl: string;
  readonly browserUrl?: string;
  readonly browserEndpoint?: string;
  readonly startupUrl?: string;
};

function parseArgs(argv: readonly string[]): ScriptOptions {
  const options: {
    baseUrl: string;
    browserUrl?: string;
    browserEndpoint?: string;
    startupUrl?: string;
  } = {
    baseUrl: process.env.BRIDGE_BASE_URL ?? 'http://127.0.0.1:3100',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--base-url') {
      options.baseUrl = argv[index + 1] ?? options.baseUrl;
      index += 1;
      continue;
    }
    if (arg === '--browser-url') {
      const browserUrl = argv[index + 1];
      if (browserUrl !== undefined) {
        options.browserUrl = browserUrl;
      }
      index += 1;
      continue;
    }
    if (arg === '--browser-endpoint') {
      const browserEndpoint = argv[index + 1];
      if (browserEndpoint !== undefined) {
        options.browserEndpoint = browserEndpoint;
      }
      index += 1;
      continue;
    }
    if (arg === '--startup-url') {
      const startupUrl = argv[index + 1];
      if (startupUrl !== undefined) {
        options.startupUrl = startupUrl;
      }
      index += 1;
      continue;
    }
  }

  return options;
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function ensureOk<T>(response: Response, schema: { parse(value: unknown): T }): Promise<T> {
  if (response.ok) {
    return schema.parse(await readJson(response));
  }

  const payload = ApiFailureSchema.safeParse(await readJson(response));
  if (payload.success) {
    throw new Error(`${payload.data.error.code}: ${payload.data.error.message}`);
  }

  throw new Error(`HTTP ${response.status} ${response.statusText}`);
}

function printSection(title: string): void {
  process.stdout.write(`\n${title}\n`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const query = new URLSearchParams();
  if (options.browserUrl) {
    query.set('browserUrl', options.browserUrl);
  }
  if (options.browserEndpoint) {
    query.set('browserEndpoint', options.browserEndpoint);
  }

  const endpointsResponse = await fetch(
    `${options.baseUrl}/api/diagnostics/browser-endpoints${
      query.size > 0 ? `?${query.toString()}` : ''
    }`,
  );
  const endpoints = await ensureOk(endpointsResponse, BrowserEndpointsResponseSchema);

  const diagnosticResponse = await fetch(`${options.baseUrl}/api/diagnostics/browser-attach/run`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      ...(options.browserUrl ? { browserUrl: options.browserUrl } : {}),
      ...(options.browserEndpoint ? { browserEndpoint: options.browserEndpoint } : {}),
      ...(options.startupUrl ? { startupUrl: options.startupUrl } : {}),
    }),
  });
  const diagnostic = await ensureOk(
    diagnosticResponse,
    BrowserAttachDiagnosticResponseSchema,
  );

  process.stdout.write(`Bridge base URL: ${options.baseUrl}\n`);
  process.stdout.write(
    `Requested browser URL: ${options.browserUrl ?? '<not provided; diagnostics used configured candidates>'}\n`,
  );
  process.stdout.write(
    `Requested browser endpoint: ${options.browserEndpoint ?? '<not provided>'}\n`,
  );

  printSection('Discovered Endpoint Candidates');
  if (endpoints.data.candidates.length === 0) {
    process.stdout.write('- none\n');
  } else {
    for (const candidate of endpoints.data.candidates) {
      process.stdout.write(
        `- ${candidate.endpoint} [${candidate.source}] ${candidate.reason}\n`,
      );
    }
  }

  printSection('Probe Summary');
  for (const probe of diagnostic.data.probes) {
    process.stdout.write(
      [
        `- ${probe.endpoint}`,
        `tcp=${probe.tcpReachable ? 'yes' : 'no'}`,
        `version=${probe.versionReachable ? 'yes' : 'no'}`,
        `list=${probe.listReachable ? 'yes' : 'no'}`,
        `targets=${probe.targetCount}`,
        `attachReady=${probe.attachReady ? 'yes' : 'no'}`,
        probe.failureCategory ? `failure=${probe.failureCategory}` : null,
      ]
        .filter((entry): entry is string => entry !== null)
        .join(' '),
    );
    const rootCause =
      typeof probe.metadata.topology === 'object' &&
      probe.metadata.topology &&
      'rootCause' in probe.metadata.topology &&
      typeof probe.metadata.topology.rootCause === 'string'
        ? probe.metadata.topology.rootCause
        : undefined;
    if (rootCause) {
      process.stdout.write(` rootCause=${rootCause}`);
    }
    process.stdout.write('\n');
  }

  printSection('Conclusion');
  process.stdout.write(`Attach ready: ${diagnostic.data.attachReady ? 'yes' : 'no'}\n`);
  process.stdout.write(
    `Selected candidate: ${diagnostic.data.selectedCandidate?.endpoint ?? '<none>'}\n`,
  );
  process.stdout.write(
    `/json/version reachable: ${
      diagnostic.data.probes.some((probe) => probe.versionReachable) ? 'yes' : 'no'
    }\n`,
  );
  process.stdout.write(
    `/json/list reachable: ${
      diagnostic.data.probes.some((probe) => probe.listReachable) ? 'yes' : 'no'
    }\n`,
  );
  process.stdout.write(
    `OpenSession preflight would ${
      diagnostic.data.attachReady && diagnostic.data.selectedCandidate ? 'pass' : 'fail'
    }\n`,
  );
  if (diagnostic.data.failureCategory) {
    process.stdout.write(`Failure category: ${diagnostic.data.failureCategory}\n`);
  }
  if (diagnostic.data.recommendations.length > 0) {
    process.stdout.write(
      `Recommendations: ${diagnostic.data.recommendations.join(' | ')}\n`,
    );
  }

  printSection('Artifacts');
  process.stdout.write(
    `Discovery artifact: ${endpoints.data.artifactPath ?? '<not reported>'}\n`,
  );
  process.stdout.write(
    `Latest diagnostic artifact: ${diagnostic.data.latestArtifactPath ?? '<not reported>'}\n`,
  );
  process.stdout.write(
    `Topology artifact: ${diagnostic.data.topologyArtifactPath ?? '<not reported>'}\n`,
  );

  if (diagnostic.data.attachReady && diagnostic.data.selectedCandidate) {
    printSection('Suggested Environment');
    process.stdout.write(
      `BRIDGE_BROWSER_URL=${diagnostic.data.selectedCandidate.endpoint}\n`,
    );
  } else {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
