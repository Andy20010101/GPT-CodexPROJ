import { DevtoolsEndpointSchema, type DevtoolsEndpoint } from '../api/schemas/diagnostics-contracts';

function hasSupportedPath(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname === '/json/version' ||
    pathname === '/json/list' ||
    pathname.startsWith('/devtools/browser/')
  );
}

export function normalizeDevtoolsEndpoint(input: string): DevtoolsEndpoint | null {
  try {
    const parsed = new URL(input);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    if (parsed.port.trim().length === 0) {
      return null;
    }
    if (!hasSupportedPath(parsed.pathname)) {
      return null;
    }

    const base = new URL(parsed.origin);
    return DevtoolsEndpointSchema.parse({
      endpoint: `${base.origin}`,
      host: base.hostname,
      port: Number.parseInt(base.port, 10),
      versionUrl: `${base.origin}/json/version`,
      listUrl: `${base.origin}/json/list`,
    });
  } catch {
    return null;
  }
}

export function isDevtoolsEndpoint(input: string | undefined): boolean {
  if (!input) {
    return false;
  }
  return normalizeDevtoolsEndpoint(input) !== null;
}

export function resolveStartupUrl(input: {
  browserUrl?: string | undefined;
  browserEndpoint?: string | undefined;
  startupUrl?: string | undefined;
}): string | undefined {
  if (input.startupUrl) {
    return input.startupUrl;
  }

  if (input.browserUrl && !isDevtoolsEndpoint(input.browserUrl)) {
    return input.browserUrl;
  }

  return undefined;
}

export function resolveBrowserEndpoint(input: {
  browserUrl?: string | undefined;
  browserEndpoint?: string | undefined;
}): string | undefined {
  if (input.browserEndpoint) {
    return normalizeDevtoolsEndpoint(input.browserEndpoint)?.endpoint;
  }

  if (input.browserUrl && isDevtoolsEndpoint(input.browserUrl)) {
    return normalizeDevtoolsEndpoint(input.browserUrl)?.endpoint;
  }

  return undefined;
}
