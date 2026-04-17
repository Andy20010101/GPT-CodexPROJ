import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadOrchestratorConfig } from '../../src/config';

const ORIGINAL_ENV = { ...process.env };

describe('loadOrchestratorConfig', () => {
  afterEach(async () => {
    for (const key of Object.keys(process.env)) {
      if (!(key in ORIGINAL_ENV)) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('prefers the browser endpoint from the shared env-state authority file', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-config-'));
    const envStatePath = path.join(tempDir, 'env-state.json');
    await fs.writeFile(
      envStatePath,
      JSON.stringify({
        browser: {
          endpoint: 'http://172.18.144.1:9224',
        },
      }),
      'utf8',
    );

    process.env.SELF_IMPROVEMENT_ENV_STATE_PATH = envStatePath;
    process.env.BRIDGE_BROWSER_URL = 'http://172.18.144.1:9668';

    const config = loadOrchestratorConfig();

    expect(config.bridgeBrowserUrl).toBe('http://172.18.144.1:9224');
  });
});
