import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  discoverHostIpCandidates,
  parseDefaultRouteGateways,
  parseResolvConfNameservers,
} from '../../src/utils/host-ip-discovery';

describe('host-ip-discovery', () => {
  it('parses default route gateways from /proc/net/route format', () => {
    const content = [
      'Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT',
      'eth0\t00000000\t010012AC\t0003\t0\t0\t0\t00000000\t0\t0\t0',
      'eth0\t0002A8C0\t00000000\t0001\t0\t0\t0\t00FFFFFF\t0\t0\t0',
    ].join('\n');

    expect(parseDefaultRouteGateways(content)).toEqual(['172.18.0.1']);
  });

  it('parses resolv.conf nameserver entries', () => {
    const content = ['nameserver 172.22.224.1', 'search localdomain', 'nameserver 8.8.8.8'].join(
      '\n',
    );

    expect(parseResolvConfNameservers(content)).toEqual(['172.22.224.1']);
  });

  it('discovers unique host ip candidates from route and resolv.conf files', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'host-ip-discovery-'));
    const routePath = path.join(tempDir, 'route');
    const resolvConfPath = path.join(tempDir, 'resolv.conf');

    await fs.writeFile(
      routePath,
      [
        'Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT',
        'eth0\t00000000\t010012AC\t0003\t0\t0\t0\t00000000\t0\t0\t0',
      ].join('\n'),
      'utf8',
    );
    await fs.writeFile(
      resolvConfPath,
      ['nameserver 172.22.224.1', 'nameserver 172.18.0.1'].join('\n'),
      'utf8',
    );

    const candidates = await discoverHostIpCandidates({
      routePath,
      resolvConfPath,
    });

    expect(candidates).toEqual([
      {
        host: '172.18.0.1',
        source: 'default_route_gateway',
        reason: 'Discovered from the default route gateway visible to WSL.',
      },
      {
        host: '172.22.224.1',
        source: 'resolv_conf_nameserver',
        reason: 'Discovered from resolv.conf nameserver entries visible to WSL.',
      },
    ]);
  });
});
