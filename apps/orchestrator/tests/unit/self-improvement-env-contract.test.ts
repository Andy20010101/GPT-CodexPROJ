import { describe, expect, it } from 'vitest';

import { SelfImprovementEnvStateSchema } from '../../src/contracts';

describe('SelfImprovementEnvStateSchema', () => {
  it('accepts a ready env-state payload', () => {
    const parsed = SelfImprovementEnvStateSchema.parse({
      version: 1,
      runKind: 'self-improvement',
      phase: 'ensure',
      status: 'ready',
      blockingIssues: [],
      recoveryActions: [],
      timestamps: {
        generatedAt: '2026-04-07T09:00:00.000Z',
      },
      auditPaths: {
        envState: '/tmp/artifacts/runtime/self-improvement-env/env-state.json',
      },
      mode: 'ensure',
      generatedAt: '2026-04-07T09:00:00.000Z',
      envStatePath: '/tmp/artifacts/runtime/self-improvement-env/env-state.json',
      authoritativeArtifactDir: '/tmp/artifacts',
      overallStatus: 'ready',
      artifactAuthority: {
        artifactDir: '/tmp/artifacts',
        source: 'orchestrator_env',
        orchestratorPid: 123,
        orchestratorPort: 3200,
      },
      orchestrator: {
        baseUrl: 'http://127.0.0.1:3200',
        status: 'ready',
        issues: [],
        pid: 123,
      },
      bridge: {
        baseUrl: 'http://127.0.0.1:3101',
        status: 'ready',
        issues: [],
        pid: 456,
      },
      browser: {
        endpoint: 'http://172.18.144.1:9667',
        startupUrl: 'https://chatgpt.com/',
        versionUrl: 'http://172.18.144.1:9667/json/version',
        listUrl: 'http://172.18.144.1:9667/json/list',
        cdpReachable: true,
        loggedIn: true,
        composerReady: true,
        pageUrl: 'https://chatgpt.com/',
        pageTitle: 'ChatGPT',
        issues: [],
      },
      artifactRoot: {
        path: '/tmp/artifacts',
        exists: true,
        writable: true,
        issues: [],
      },
      watcherCleanup: {
        authoritativeArtifactDir: '/tmp/artifacts',
        stopped: [],
        kept: 0,
      },
      actions: [
        {
          kind: 'reuse_orchestrator',
          status: 'reused',
          summary: 'Reused live orchestrator.',
        },
      ],
    });

    expect(parsed.overallStatus).toBe('ready');
    expect(parsed.browser.loggedIn).toBe(true);
  });

  it('accepts a needs_operator payload with no resolved browser authority endpoint', () => {
    const parsed = SelfImprovementEnvStateSchema.parse({
      version: 1,
      runKind: 'self-improvement',
      phase: 'doctor',
      status: 'needs_operator',
      blockingIssues: [
        {
          component: 'browser',
          message: 'No browser authority endpoint is available.',
        },
      ],
      recoveryActions: [],
      timestamps: {
        generatedAt: '2026-04-07T09:00:00.000Z',
      },
      auditPaths: {
        envState: '/tmp/artifacts/runtime/self-improvement-env/env-state.json',
      },
      mode: 'doctor',
      generatedAt: '2026-04-07T09:00:00.000Z',
      envStatePath: '/tmp/artifacts/runtime/self-improvement-env/env-state.json',
      authoritativeArtifactDir: '/tmp/artifacts',
      overallStatus: 'needs_operator',
      artifactAuthority: {
        artifactDir: '/tmp/artifacts',
        source: 'orchestrator_default',
        orchestratorPid: null,
        orchestratorPort: 3200,
      },
      orchestrator: {
        baseUrl: 'http://127.0.0.1:3200',
        status: 'failed',
        issues: [],
        pid: null,
      },
      bridge: {
        baseUrl: 'http://127.0.0.1:3101',
        status: 'failed',
        issues: [],
        pid: null,
      },
      browser: {
        endpoint: null,
        startupUrl: 'https://chatgpt.com/',
        versionUrl: null,
        listUrl: null,
        cdpReachable: false,
        loggedIn: false,
        composerReady: false,
        pageUrl: null,
        pageTitle: null,
        issues: ['No browser authority endpoint is available.'],
      },
      artifactRoot: {
        path: '/tmp/artifacts',
        exists: true,
        writable: true,
        issues: [],
      },
      watcherCleanup: {
        authoritativeArtifactDir: '/tmp/artifacts',
        stopped: [],
        kept: 0,
      },
      actions: [
        {
          kind: 'probe_browser',
          status: 'failed',
          summary: 'No browser authority endpoint was available for readiness probing.',
        },
      ],
    });

    expect(parsed.browser.endpoint).toBeNull();
    expect(parsed.overallStatus).toBe('needs_operator');
  });
});
