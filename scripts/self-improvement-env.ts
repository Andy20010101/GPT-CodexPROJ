import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  SelfImprovementEnvStateSchema,
  type SelfImprovementEnvAction,
  type SelfImprovementEnvBlockingIssue,
  type SelfImprovementEnvArtifactAuthority,
  type SelfImprovementEnvAuditPaths,
  type SelfImprovementEnvBrowser,
  type SelfImprovementEnvMode,
  type SelfImprovementEnvRecoveryAction,
  type SelfImprovementEnvRunKind,
  type SelfImprovementEnvService,
  type SelfImprovementEnvState,
  type SelfImprovementEnvWatcherCleanup,
} from '../apps/orchestrator/src/contracts/self-improvement-env';
import {
  getBootstrapEnvStateFile,
  getSelfImprovementEnvLogFile,
  getSelfImprovementEnvStateFile,
} from '../apps/orchestrator/src/utils/run-paths';

type CliOptions = EnsureEnvironmentOptions & {
  mode: SelfImprovementEnvMode;
};

type BootstrapScope = {
  runKind: SelfImprovementEnvRunKind;
  envStatePath: string;
};

export type EnsureEnvironmentOptions = {
  orchestratorBaseUrl?: string;
  bridgeBaseUrl?: string;
  browserEndpoint?: string;
  startupUrl?: string;
  artifactDir?: string;
  runKind?: SelfImprovementEnvRunKind;
  runId?: string;
};

type ServiceStartupResult = {
  status: 'reused' | 'started' | 'failed';
  pid: number | null;
  issues: string[];
  action: SelfImprovementEnvAction;
};

type BrowserProbeResult = {
  browser: SelfImprovementEnvBrowser;
  action: SelfImprovementEnvAction;
};

type BrowserTarget = {
  type?: string;
  title?: string;
  url?: string;
};

type BridgeAttachDiagnostic = {
  attachReady: boolean;
  failureCategory?: string;
  recommendations: string[];
  selectedTarget?: BrowserTarget;
};

type WatcherProcess = {
  pid: number;
  runId: string | null;
  outputJsonPath: string | null;
  outputMdPath: string | null;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const DEFAULT_ORCHESTRATOR_BASE_URL = 'http://127.0.0.1:3200';
const DEFAULT_BRIDGE_BASE_URL = 'http://127.0.0.1:3100';
const DEFAULT_STARTUP_URL = 'https://chatgpt.com/';
const DEFAULT_HTTP_TIMEOUT_MS = 2_000;

export async function doctorSelfImprovementEnvironment(
  options: EnsureEnvironmentOptions = {},
): Promise<SelfImprovementEnvState> {
  return buildEnvironmentState('doctor', options);
}

export async function ensureSelfImprovementEnvironment(
  options: EnsureEnvironmentOptions = {},
): Promise<SelfImprovementEnvState> {
  return buildEnvironmentState('ensure', options);
}

async function buildEnvironmentState(
  mode: SelfImprovementEnvMode,
  options: EnsureEnvironmentOptions,
): Promise<SelfImprovementEnvState> {
  const orchestratorBaseUrl = options.orchestratorBaseUrl ?? DEFAULT_ORCHESTRATOR_BASE_URL;
  let artifactAuthority = await resolveArtifactAuthority(orchestratorBaseUrl, options.artifactDir);
  let bootstrapScope = resolveBootstrapScope(options, artifactAuthority.artifactDir);
  let { runKind, envStatePath } = bootstrapScope;
  const bridgeBaseUrl = await resolveBridgeBaseUrl(orchestratorBaseUrl, options.bridgeBaseUrl);
  const browserEndpoint = await resolveBrowserEndpoint(orchestratorBaseUrl, options.browserEndpoint);
  const startupUrl = options.startupUrl ?? DEFAULT_STARTUP_URL;
  const generatedAt = new Date().toISOString();
  const actions: SelfImprovementEnvAction[] = [];

  const orchestratorStartup = await ensureLocalHttpService({
    ensure: mode === 'ensure',
    baseUrl: orchestratorBaseUrl,
    artifactDir: artifactAuthority.artifactDir,
    envStatePath,
    service: 'orchestrator',
    bridgeBaseUrl,
    ...(browserEndpoint ? { browserEndpoint } : {}),
  });
  actions.push(orchestratorStartup.action);
  if (orchestratorStartup.status !== 'failed') {
    artifactAuthority = await resolveArtifactAuthority(orchestratorBaseUrl, options.artifactDir);
    bootstrapScope = resolveBootstrapScope(options, artifactAuthority.artifactDir);
    ({ runKind, envStatePath } = bootstrapScope);
  }

  const watcherCleanup =
    mode === 'ensure'
      ? await stopMismatchedWatchers(artifactAuthority.artifactDir)
      : {
          authoritativeArtifactDir: artifactAuthority.artifactDir,
          stopped: [],
          kept: listWatcherProcesses().length,
        };
  actions.push({
    kind: 'cleanup_watchers',
    status:
      mode === 'ensure'
        ? watcherCleanup.stopped.length > 0
          ? 'started'
          : 'reused'
        : 'skipped',
    summary:
      mode === 'ensure'
        ? watcherCleanup.stopped.length > 0
          ? `Stopped ${watcherCleanup.stopped.length} watcher(s) writing outside ${artifactAuthority.artifactDir}.`
          : `No watcher cleanup was required under ${artifactAuthority.artifactDir}.`
        : `Watcher cleanup is skipped in doctor mode under ${artifactAuthority.artifactDir}.`,
  });

  const bridgeStartup = await ensureLocalHttpService({
    ensure: mode === 'ensure',
    baseUrl: bridgeBaseUrl,
    artifactDir: artifactAuthority.artifactDir,
    envStatePath,
    service: 'bridge',
    ...(browserEndpoint ? { browserEndpoint } : {}),
  });
  actions.push(bridgeStartup.action);

  const artifactRoot = await inspectArtifactRoot(artifactAuthority.artifactDir);
  const browserProbe = await probeBrowser({
    endpoint: browserEndpoint,
    startupUrl,
    bridgeBaseUrl,
  });
  actions.push(browserProbe.action);

  const orchestratorService = toServiceState(orchestratorBaseUrl, orchestratorStartup);
  const bridgeService = toServiceState(bridgeBaseUrl, bridgeStartup);
  const overallStatus =
    orchestratorService.status !== 'failed' &&
    bridgeService.status !== 'failed' &&
    Boolean(browserProbe.browser.endpoint) &&
    browserProbe.browser.cdpReachable &&
    browserProbe.browser.loggedIn &&
    browserProbe.browser.composerReady &&
    artifactRoot.writable
      ? 'ready'
      : 'needs_operator';
  const blockingIssues = collectBlockingIssues({
    orchestrator: orchestratorService,
    bridge: bridgeService,
    browser: browserProbe.browser,
    artifactRoot,
  });
  const recoveryActions = collectRecoveryActions(actions);
  const auditPaths = buildAuditPaths(artifactAuthority.artifactDir, envStatePath);

  const state = SelfImprovementEnvStateSchema.parse({
    version: 1,
    runKind,
    phase: mode,
    status: overallStatus,
    blockingIssues,
    recoveryActions,
    timestamps: {
      generatedAt,
    },
    auditPaths,
    mode,
    generatedAt,
    envStatePath,
    authoritativeArtifactDir: artifactAuthority.artifactDir,
    overallStatus,
    artifactAuthority,
    orchestrator: orchestratorService,
    bridge: bridgeService,
    browser: browserProbe.browser,
    artifactRoot,
    watcherCleanup,
    actions,
  });

  await fs.mkdir(path.dirname(envStatePath), { recursive: true });
  await fs.writeFile(envStatePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

  if (state.overallStatus !== 'ready' && mode === 'ensure') {
    throw new Error(`Environment bootstrap did not reach ready state. Env state: ${envStatePath}`);
  }

  return SelfImprovementEnvStateSchema.parse(state);
}

function buildAuditPaths(artifactDir: string, envStatePath: string): SelfImprovementEnvAuditPaths {
  return {
    envState: envStatePath,
    orchestratorLog: getSelfImprovementEnvLogFile(artifactDir, 'orchestrator'),
    bridgeLog: getSelfImprovementEnvLogFile(artifactDir, 'bridge'),
  };
}

function collectBlockingIssues(input: {
  orchestrator: SelfImprovementEnvService;
  bridge: SelfImprovementEnvService;
  browser: SelfImprovementEnvBrowser;
  artifactRoot: SelfImprovementEnvState['artifactRoot'];
}): SelfImprovementEnvBlockingIssue[] {
  return [
    ...input.orchestrator.issues.map((message) => ({
      component: 'orchestrator' as const,
      message,
    })),
    ...input.bridge.issues.map((message) => ({
      component: 'bridge' as const,
      message,
    })),
    ...input.browser.issues.map((message) => ({
      component: 'browser' as const,
      message,
    })),
    ...input.artifactRoot.issues.map((message) => ({
      component: 'artifact-root' as const,
      message,
    })),
  ];
}

function collectRecoveryActions(
  actions: readonly SelfImprovementEnvAction[],
): SelfImprovementEnvRecoveryAction[] {
  return actions
    .filter((action) => action.status === 'failed' || action.status === 'skipped')
    .map((action) => ({
      kind: action.kind,
      summary: action.summary,
    }));
}

function toServiceState(
  baseUrl: string,
  startup: ServiceStartupResult,
): SelfImprovementEnvService {
  const status = startup.status === 'reused' ? 'ready' : startup.status;
  return {
    baseUrl,
    status,
    issues: startup.issues,
    pid: startup.pid,
  };
}

async function inspectArtifactRoot(artifactDir: string): Promise<SelfImprovementEnvState['artifactRoot']> {
  const issues: string[] = [];
  let exists = true;
  try {
    await fs.mkdir(artifactDir, { recursive: true });
  } catch (error) {
    exists = false;
    issues.push(`Unable to create artifact root: ${String(error)}`);
  }

  let writable = false;
  if (exists) {
    const probePath = path.join(artifactDir, '.env-bootstrap-write-probe');
    try {
      await fs.writeFile(probePath, 'ok\n', 'utf8');
      await fs.unlink(probePath);
      writable = true;
    } catch (error) {
      issues.push(`Artifact root is not writable: ${String(error)}`);
    }
  }

  return {
    path: artifactDir,
    exists,
    writable,
    issues,
  };
}

async function resolveBridgeBaseUrl(
  orchestratorBaseUrl: string,
  explicitBridgeBaseUrl: string | undefined,
): Promise<string> {
  if (explicitBridgeBaseUrl) {
    return explicitBridgeBaseUrl;
  }

  const orchestratorPid = findLocalListeningPid(orchestratorBaseUrl, getPortFromBaseUrl(orchestratorBaseUrl));
  const environment = orchestratorPid
    ? await readProcessEnvironment(orchestratorPid)
    : new Map<string, string>();
  return environment.get('BRIDGE_BASE_URL') ?? process.env.BRIDGE_BASE_URL ?? DEFAULT_BRIDGE_BASE_URL;
}

async function resolveBrowserEndpoint(
  orchestratorBaseUrl: string,
  explicitBrowserEndpoint: string | undefined,
): Promise<string | null> {
  if (explicitBrowserEndpoint) {
    return explicitBrowserEndpoint;
  }

  const orchestratorPid = findLocalListeningPid(orchestratorBaseUrl, getPortFromBaseUrl(orchestratorBaseUrl));
  const environment = orchestratorPid
    ? await readProcessEnvironment(orchestratorPid)
    : new Map<string, string>();
  return environment.get('BRIDGE_BROWSER_URL') ?? process.env.BRIDGE_BROWSER_URL ?? null;
}

async function ensureLocalHttpService(input: {
  ensure: boolean;
  baseUrl: string;
  artifactDir: string;
  envStatePath: string;
  service: 'orchestrator' | 'bridge';
  bridgeBaseUrl?: string;
  browserEndpoint?: string;
}): Promise<ServiceStartupResult> {
  if (await isHttpHealthy(input.baseUrl, input.service)) {
    return {
      status: 'reused',
      pid: findLocalListeningPid(input.baseUrl, getPortFromBaseUrl(input.baseUrl)),
      issues: [],
      action: {
        kind: input.service === 'orchestrator' ? 'reuse_orchestrator' : 'reuse_bridge',
        status: 'reused',
        summary: `Reused live ${input.service} at ${input.baseUrl}.`,
      },
    };
  }

  if (!input.ensure || !isLoopbackHost(new URL(input.baseUrl).hostname)) {
    return {
      status: 'failed',
      pid: null,
      issues: [`${input.service} health check failed at ${input.baseUrl}.`],
      action: {
        kind: input.service === 'orchestrator' ? 'reuse_orchestrator' : 'reuse_bridge',
        status: 'failed',
        summary: `Unable to reuse ${input.service} at ${input.baseUrl}.`,
      },
    };
  }

  const started = await startLocalService(input);
  if (started.status === 'started') {
    return {
      status: 'started',
      pid: started.pid,
      issues: [],
      action: {
        kind: input.service === 'orchestrator' ? 'start_orchestrator' : 'start_bridge',
        status: 'started',
        summary: `Started ${input.service} at ${input.baseUrl}.`,
      },
    };
  }

  return {
    status: 'failed',
    pid: started.pid,
    issues: [`Unable to start ${input.service} at ${input.baseUrl}.`],
    action: {
      kind: input.service === 'orchestrator' ? 'start_orchestrator' : 'start_bridge',
      status: 'failed',
      summary: `Failed to start ${input.service} at ${input.baseUrl}.`,
    },
  };
}

async function startLocalService(input: {
  baseUrl: string;
  artifactDir: string;
  envStatePath: string;
  service: 'orchestrator' | 'bridge';
  bridgeBaseUrl?: string;
  browserEndpoint?: string;
}): Promise<{ status: 'started' | 'failed'; pid: number | null }> {
  const url = new URL(input.baseUrl);
  const logPath = getSelfImprovementEnvLogFile(input.artifactDir, input.service);
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  const logHandle = await fs.open(logPath, 'a');
  const env = {
    ...process.env,
  } as NodeJS.ProcessEnv;
  env.SELF_IMPROVEMENT_ENV_STATE_PATH = input.envStatePath;

  let commandArgs: string[];
  if (input.service === 'orchestrator') {
    env.ORCHESTRATOR_API_HOST = url.hostname;
    env.ORCHESTRATOR_API_PORT = String(getPortFromBaseUrl(input.baseUrl));
    env.ORCHESTRATOR_ARTIFACT_DIR = input.artifactDir;
    if (input.bridgeBaseUrl) {
      env.BRIDGE_BASE_URL = input.bridgeBaseUrl;
    }
    if (input.browserEndpoint) {
      env.BRIDGE_BROWSER_URL = input.browserEndpoint;
    }
    if (process.env.CODEX_RUNNER_MODE) {
      env.CODEX_RUNNER_MODE = process.env.CODEX_RUNNER_MODE;
    } else {
      env.CODEX_RUNNER_MODE = 'cli';
    }
    commandArgs = ['--import', 'tsx', path.join(repoRoot, 'apps/orchestrator/src/api/server.ts')];
  } else {
    env.HOST = url.hostname;
    env.PORT = String(getPortFromBaseUrl(input.baseUrl));
    if (input.browserEndpoint) {
      env.BRIDGE_BROWSER_URL = input.browserEndpoint;
    }
    commandArgs = ['--import', 'tsx', path.join(repoRoot, 'services/chatgpt-web-bridge/src/index.ts')];
  }

  const child = spawn(process.execPath, commandArgs, {
    cwd: repoRoot,
    detached: true,
    stdio: ['ignore', logHandle.fd, logHandle.fd],
    env,
  });
  child.unref();
  await logHandle.close();

  const ready = await waitForHttpHealth(input.baseUrl, input.service, 15_000);
  return {
    status: ready ? 'started' : 'failed',
    pid: child.pid ?? null,
  };
}

async function probeBrowser(input: {
  endpoint: string | null;
  startupUrl: string;
  bridgeBaseUrl?: string;
}): Promise<BrowserProbeResult> {
  if (!input.endpoint) {
    return {
      browser: {
        endpoint: null,
        startupUrl: input.startupUrl,
        versionUrl: null,
        listUrl: null,
        cdpReachable: false,
        loggedIn: false,
        composerReady: false,
        pageUrl: null,
        pageTitle: null,
        issues: ['No browser authority endpoint is available.'],
      },
      action: {
        kind: 'probe_browser',
        status: 'failed',
        summary: 'No browser authority endpoint was available for readiness probing.',
      },
    };
  }

  const versionUrl = new URL('/json/version', ensureTrailingSlash(input.endpoint)).toString();
  const listUrl = new URL('/json/list', ensureTrailingSlash(input.endpoint)).toString();
  const issues: string[] = [];

  let cdpReachable = false;
  let loggedIn = false;
  let composerReady = false;
  let pageUrl: string | null = null;
  let pageTitle: string | null = null;

  const diagnostic = input.bridgeBaseUrl
    ? await fetchBridgeAttachDiagnostic({
        bridgeBaseUrl: input.bridgeBaseUrl,
        browserEndpoint: input.endpoint,
        startupUrl: input.startupUrl,
      }).catch(() => null)
    : null;
  if (diagnostic) {
    loggedIn = diagnostic.attachReady;
    composerReady = diagnostic.attachReady;
    pageUrl = readNonEmptyString(diagnostic.selectedTarget?.url) ?? null;
    pageTitle = readNonEmptyString(diagnostic.selectedTarget?.title) ?? null;
    if (!diagnostic.attachReady) {
      if (diagnostic.failureCategory) {
        issues.push(`Bridge attach diagnostic reported ${diagnostic.failureCategory}.`);
      }
      issues.push(...diagnostic.recommendations.map((item) => `Recommendation: ${item}`));
    }
  }

  try {
    await fetchJson(versionUrl);
    cdpReachable = true;
  } catch {
    issues.push(`Browser version endpoint is not reachable at ${versionUrl}.`);
  }

  try {
    const payload = await fetchJson(listUrl);
    if (Array.isArray(payload)) {
      cdpReachable = true;
      const selectedTarget = selectBrowserTarget(payload);
      if (!pageUrl) {
        pageUrl = readNonEmptyString(selectedTarget?.url) ?? null;
      }
      if (!pageTitle) {
        pageTitle = readNonEmptyString(selectedTarget?.title) ?? null;
      }
      if (!diagnostic) {
        loggedIn = selectedTarget ? !looksLoggedOut(selectedTarget) : false;
        composerReady = selectedTarget ? looksComposerReady(selectedTarget, input.startupUrl) : false;
      }
    } else {
      issues.push(`Expected ${listUrl} to return an array of browser targets.`);
    }
  } catch {
    issues.push(`Browser target list is not reachable at ${listUrl}.`);
  }

  if (!loggedIn) {
    issues.push('Browser probe did not confirm a logged-in ChatGPT session.');
  }
  if (!composerReady) {
    issues.push('Browser probe did not confirm a ChatGPT composer-ready page.');
  }

  return {
    browser: {
      endpoint: input.endpoint,
      startupUrl: input.startupUrl,
      versionUrl,
      listUrl,
      cdpReachable,
      loggedIn,
      composerReady,
      pageUrl,
      pageTitle,
      issues,
    },
    action: {
      kind: 'probe_browser',
      status: loggedIn && composerReady ? 'reused' : 'failed',
      summary:
        loggedIn && composerReady
          ? `Reused live browser session at ${input.endpoint}.`
          : `Browser probe did not find a logged-in ChatGPT composer at ${input.endpoint}.`,
    },
  };
}

async function fetchBridgeAttachDiagnostic(input: {
  bridgeBaseUrl: string;
  browserEndpoint: string;
  startupUrl: string;
}): Promise<BridgeAttachDiagnostic> {
  const url = new URL('/api/diagnostics/browser-attach', ensureTrailingSlash(input.bridgeBaseUrl));
  url.searchParams.set('browserEndpoint', input.browserEndpoint);
  url.searchParams.set('startupUrl', input.startupUrl);
  const payload = await fetchJson(url.toString());
  const data =
    typeof payload === 'object' && payload !== null && 'data' in payload
      ? (payload as { data?: unknown }).data
      : null;
  if (typeof data !== 'object' || data === null) {
    throw new Error('Bridge attach diagnostic did not return a data object.');
  }
  const diagnosticData = data as {
    selectedTarget?: unknown;
    attachReady?: unknown;
    failureCategory?: unknown;
    recommendations?: unknown;
  };

  let selectedTarget: BrowserTarget | undefined;
  if (typeof diagnosticData.selectedTarget === 'object' && diagnosticData.selectedTarget !== null) {
    const parsedTarget: BrowserTarget = {};
    const type = readNonEmptyString((diagnosticData.selectedTarget as BrowserTarget).type);
    const title = readNonEmptyString((diagnosticData.selectedTarget as BrowserTarget).title);
    const urlValue = readNonEmptyString((diagnosticData.selectedTarget as BrowserTarget).url);
    if (type) {
      parsedTarget.type = type;
    }
    if (title) {
      parsedTarget.title = title;
    }
    if (urlValue) {
      parsedTarget.url = urlValue;
    }
    selectedTarget = parsedTarget;
  }

  const diagnostic: BridgeAttachDiagnostic = {
    attachReady: diagnosticData.attachReady === true,
    recommendations: Array.isArray(diagnosticData.recommendations)
      ? (diagnosticData.recommendations
          .map((item) => readNonEmptyString(item))
          .filter((item): item is string => item !== undefined))
      : [],
  };
  const failureCategory = readNonEmptyString(diagnosticData.failureCategory);
  if (failureCategory) {
    diagnostic.failureCategory = failureCategory;
  }
  if (selectedTarget) {
    diagnostic.selectedTarget = selectedTarget;
  }
  return diagnostic;
}

function selectBrowserTarget(payload: unknown[]): BrowserTarget | undefined {
  const targets = payload.filter(isBrowserTarget);
  return (
    targets.find((target) => isChatGptUrl(target.url) && target.type === 'page') ??
    targets.find((target) => target.type === 'page') ??
    targets[0]
  );
}

function isBrowserTarget(value: unknown): value is BrowserTarget {
  return typeof value === 'object' && value !== null;
}

function looksLoggedOut(target: BrowserTarget): boolean {
  const url = target.url?.toLowerCase() ?? '';
  const title = target.title?.toLowerCase() ?? '';
  return (
    url.includes('/auth') ||
    url.includes('/login') ||
    title.includes('log in') ||
    title.includes('sign in')
  );
}

function looksComposerReady(target: BrowserTarget, startupUrl: string): boolean {
  if (looksLoggedOut(target)) {
    return false;
  }

  const url = target.url?.toLowerCase() ?? '';
  const title = target.title?.toLowerCase() ?? '';
  const startupHost = safeHost(startupUrl);
  return (
    title.includes('chatgpt') ||
    url.includes('/c/') ||
    (startupHost !== null && url.includes(startupHost))
  );
}

function isChatGptUrl(url: string | undefined): boolean {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return parsed.hostname.includes('chatgpt.com');
  } catch {
    return false;
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function safeHost(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(DEFAULT_HTTP_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function isHttpHealthy(
  baseUrl: string,
  service: 'orchestrator' | 'bridge',
): Promise<boolean> {
  try {
    const endpoint = service === 'orchestrator' ? `${baseUrl}/health` : `${baseUrl}/api/health/bridge`;
    const response = await fetch(endpoint, {
      signal: AbortSignal.timeout(DEFAULT_HTTP_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForHttpHealth(
  baseUrl: string,
  service: 'orchestrator' | 'bridge',
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isHttpHealthy(baseUrl, service)) {
      return true;
    }
    await sleep(500);
  }
  return false;
}

export async function resolveArtifactAuthority(
  orchestratorBaseUrl: string,
  explicitArtifactDir: string | undefined,
): Promise<SelfImprovementEnvArtifactAuthority> {
  const orchestratorPort = getPortFromBaseUrl(orchestratorBaseUrl);
  if (explicitArtifactDir) {
    return {
      artifactDir: path.resolve(explicitArtifactDir),
      source: 'cli',
      orchestratorPid: null,
      orchestratorPort,
    };
  }

  const orchestratorPid = findLocalListeningPid(orchestratorBaseUrl, orchestratorPort);
  const processEnvironment = orchestratorPid
    ? await readProcessEnvironment(orchestratorPid)
    : new Map<string, string>();
  const processArtifactDir = processEnvironment.get('ORCHESTRATOR_ARTIFACT_DIR');
  if (processArtifactDir) {
    return {
      artifactDir: path.resolve(processArtifactDir),
      source: 'orchestrator_env',
      orchestratorPid,
      orchestratorPort,
    };
  }

  if (orchestratorPid) {
    return {
      artifactDir: path.join(repoRoot, 'apps', 'orchestrator', 'artifacts'),
      source: 'orchestrator_default',
      orchestratorPid,
      orchestratorPort,
    };
  }

  return {
    artifactDir: path.resolve(
      explicitArtifactDir ?? path.join(repoRoot, 'apps', 'orchestrator', 'artifacts'),
    ),
    source: 'cli',
    orchestratorPid: null,
    orchestratorPort,
  };
}

function getPortFromBaseUrl(baseUrl: string): number {
  const url = new URL(baseUrl);
  if (url.port) {
    return Number.parseInt(url.port, 10);
  }

  return url.protocol === 'https:' ? 443 : 80;
}

function findLocalListeningPid(orchestratorBaseUrl: string, port: number): number | null {
  const url = new URL(orchestratorBaseUrl);
  if (!isLoopbackHost(url.hostname)) {
    return null;
  }

  const ssResult = spawnSync('bash', ['-lc', `ss -ltnp '( sport = :${port} )'`], {
    encoding: 'utf8',
  });
  if (ssResult.status === 0) {
    const pid = parsePidFromSocketInspection(ssResult.stdout);
    if (pid) {
      return pid;
    }
  }

  const lsofResult = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], {
    encoding: 'utf8',
  });
  if (lsofResult.status === 0) {
    const pid = parsePidFromLsof(lsofResult.stdout);
    if (pid) {
      return pid;
    }
  }

  return null;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
}

function parsePidFromSocketInspection(output: string): number | null {
  const match = output.match(/pid=(\d+)/);
  const pidValue = match?.[1];
  if (!pidValue) {
    return null;
  }

  const pid = Number.parseInt(pidValue, 10);
  return Number.isFinite(pid) ? pid : null;
}

function parsePidFromLsof(output: string): number | null {
  const match = output.match(/^p(\d+)$/m);
  const pidValue = match?.[1];
  if (!pidValue) {
    return null;
  }

  const pid = Number.parseInt(pidValue, 10);
  return Number.isFinite(pid) ? pid : null;
}

async function readProcessEnvironment(pid: number): Promise<Map<string, string>> {
  const environ = await fs.readFile(`/proc/${pid}/environ`);
  const variables = new Map<string, string>();
  for (const rawEntry of environ.toString('utf8').split('\u0000')) {
    if (!rawEntry) {
      continue;
    }
    const separatorIndex = rawEntry.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }
    variables.set(rawEntry.slice(0, separatorIndex), rawEntry.slice(separatorIndex + 1));
  }
  return variables;
}

export async function stopMismatchedWatchers(
  authoritativeArtifactDir: string,
): Promise<SelfImprovementEnvWatcherCleanup> {
  const watchers = listWatcherProcesses();
  const stopped: SelfImprovementEnvWatcherCleanup['stopped'] = [];
  let kept = 0;

  for (const watcher of watchers) {
    if (watcherWritesOutsideAuthoritativeRoot(watcher, authoritativeArtifactDir)) {
      await terminateProcess(watcher.pid);
      stopped.push({
        pid: watcher.pid,
        runId: watcher.runId,
        reason: 'mismatched_artifact_root',
      });
      continue;
    }

    kept += 1;
  }

  return {
    authoritativeArtifactDir,
    stopped,
    kept,
  };
}

function listWatcherProcesses(): WatcherProcess[] {
  const result = spawnSync('ps', ['-eo', 'pid=,args='], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    return [];
  }

  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('watch-run-until-terminal.mjs'))
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.*)$/);
      const pidValue = match?.[1];
      const command = match?.[2];
      if (!pidValue || !command) {
        return null;
      }
      return {
        pid: Number.parseInt(pidValue, 10),
        runId: readWatcherArg(command, '--run-id'),
        outputJsonPath: readWatcherArg(command, '--output-json'),
        outputMdPath: readWatcherArg(command, '--output-md'),
      } satisfies WatcherProcess;
    })
    .filter((entry): entry is WatcherProcess => entry !== null && Number.isFinite(entry.pid));
}

function readWatcherArg(command: string, flag: string): string | null {
  const escapedFlag = flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = command.match(new RegExp(`${escapedFlag}\\s+(\\S+)`));
  return match?.[1] ?? null;
}

function watcherWritesOutsideAuthoritativeRoot(
  watcher: WatcherProcess,
  authoritativeArtifactDir: string,
): boolean {
  const paths = [watcher.outputJsonPath, watcher.outputMdPath].filter(
    (value): value is string => Boolean(value),
  );
  if (paths.length === 0) {
    return false;
  }

  return paths.some((filePath) => {
    const relative = path.relative(authoritativeArtifactDir, filePath);
    return relative === '' || relative.startsWith('..') || path.isAbsolute(relative);
  });
}

async function terminateProcess(pid: number): Promise<void> {
  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    if (!isMissingProcessError(error)) {
      throw error;
    }
    return;
  }

  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) {
      return;
    }
    await sleep(100);
  }

  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    if (!isMissingProcessError(error)) {
      throw error;
    }
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isMissingProcessError(error);
  }
}

function isMissingProcessError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ESRCH'
  );
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function resolveBootstrapScope(
  options: EnsureEnvironmentOptions,
  artifactDir: string,
): BootstrapScope {
  const runKind = options.runKind ?? 'validation';
  const envStatePath = options.runId
    ? getBootstrapEnvStateFile(artifactDir, options.runId, runKind)
    : getSelfImprovementEnvStateFile(artifactDir);

  return {
    runKind,
    envStatePath,
  };
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    mode: 'ensure',
    orchestratorBaseUrl: DEFAULT_ORCHESTRATOR_BASE_URL,
    startupUrl: DEFAULT_STARTUP_URL,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    switch (token) {
      case 'doctor':
        options.mode = 'doctor';
        break;
      case 'ensure':
        options.mode = 'ensure';
        break;
      case '--orchestrator-base-url':
        options.orchestratorBaseUrl = requireValue(token, next);
        index += 1;
        break;
      case '--bridge-base-url':
        options.bridgeBaseUrl = requireValue(token, next);
        index += 1;
        break;
      case '--browser-endpoint':
        options.browserEndpoint = requireValue(token, next);
        index += 1;
        break;
      case '--startup-url':
        options.startupUrl = requireValue(token, next);
        index += 1;
        break;
      case '--artifact-dir':
        options.artifactDir = path.resolve(requireValue(token, next));
        index += 1;
        break;
      case '--run-kind': {
        const runKind = requireValue(token, next);
        if (runKind !== 'self-improvement' && runKind !== 'validation') {
          throw new Error(`--run-kind must be "self-improvement" or "validation", received ${runKind}`);
        }
        options.runKind = runKind;
        index += 1;
        break;
      }
      case '--run-id':
        options.runId = requireValue(token, next);
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  return options;
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const state =
    options.mode === 'doctor'
      ? await doctorSelfImprovementEnvironment(options)
      : await ensureSelfImprovementEnvironment(options);
  process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
  if (options.mode === 'doctor' && state.status !== 'ready') {
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
