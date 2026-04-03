import fs from 'node:fs/promises';

export type HostIpCandidate = {
  readonly host: string;
  readonly source: 'default_route_gateway' | 'resolv_conf_nameserver';
  readonly reason: string;
};

function isIpv4(value: string): boolean {
  const match = /^(\d{1,3}\.){3}\d{1,3}$/.test(value);
  if (!match) {
    return false;
  }
  return value.split('.').every((segment) => {
    const parsed = Number.parseInt(segment, 10);
    return parsed >= 0 && parsed <= 255;
  });
}

function isLikelyLocalHostCandidate(value: string): boolean {
  if (!isIpv4(value)) {
    return false;
  }

  const octets = value.split('.').map((segment) => Number.parseInt(segment, 10));
  const [first, second] = octets;
  if (first === undefined || second === undefined) {
    return false;
  }

  if (first === 10) {
    return true;
  }
  if (first === 172 && second >= 16 && second <= 31) {
    return true;
  }
  if (first === 192 && second === 168) {
    return true;
  }
  if (first === 100 && second >= 64 && second <= 127) {
    return true;
  }
  if (first === 169 && second === 254) {
    return true;
  }

  return false;
}

function decodeGateway(hex: string): string | null {
  if (!/^[0-9A-Fa-f]{8}$/.test(hex)) {
    return null;
  }

  const bytes = hex.match(/../g);
  if (!bytes) {
    return null;
  }

  return bytes
    .reverse()
    .map((entry) => Number.parseInt(entry, 16))
    .join('.');
}

export function parseDefaultRouteGateways(content: string): string[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length <= 1) {
    return [];
  }

  const gateways = new Set<string>();
  for (const line of lines.slice(1)) {
    const columns = line.split(/\s+/);
    if (columns.length < 3) {
      continue;
    }
    const destination = columns[1];
    const gateway = columns[2];
    if (!destination || !gateway) {
      continue;
    }
    if (destination !== '00000000') {
      continue;
    }
    const decoded = decodeGateway(gateway);
    if (decoded && isIpv4(decoded)) {
      gateways.add(decoded);
    }
  }

  return [...gateways];
}

export function parseResolvConfNameservers(content: string): string[] {
  const hosts = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*nameserver\s+([0-9.]+)\s*$/.exec(line);
    if (!match) {
      continue;
    }
    const host = match[1];
    if (!host) {
      continue;
    }
    if (isLikelyLocalHostCandidate(host)) {
      hosts.add(host);
    }
  }
  return [...hosts];
}

export async function discoverHostIpCandidates(input?: {
  routePath?: string | undefined;
  resolvConfPath?: string | undefined;
}): Promise<HostIpCandidate[]> {
  const routePath = input?.routePath ?? '/proc/net/route';
  const resolvConfPath = input?.resolvConfPath ?? '/etc/resolv.conf';
  const candidates: HostIpCandidate[] = [];
  const seen = new Set<string>();

  try {
    const routeContent = await fs.readFile(routePath, 'utf8');
    for (const host of parseDefaultRouteGateways(routeContent)) {
      if (!isLikelyLocalHostCandidate(host)) {
        continue;
      }
      if (!seen.has(host)) {
        seen.add(host);
        candidates.push({
          host,
          source: 'default_route_gateway',
          reason: 'Discovered from the default route gateway visible to WSL.',
        });
      }
    }
  } catch {
    // Discovery is best-effort.
  }

  try {
    const resolvConfContent = await fs.readFile(resolvConfPath, 'utf8');
    for (const host of parseResolvConfNameservers(resolvConfContent)) {
      if (!seen.has(host)) {
        seen.add(host);
        candidates.push({
          host,
          source: 'resolv_conf_nameserver',
          reason: 'Discovered from resolv.conf nameserver entries visible to WSL.',
        });
      }
    }
  } catch {
    // Discovery is best-effort.
  }

  return candidates;
}
