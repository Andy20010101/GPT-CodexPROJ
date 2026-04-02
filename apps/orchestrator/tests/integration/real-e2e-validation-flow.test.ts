import fs from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createOrchestratorRuntimeBundle } from '../../src';
import {
  FakeWorktreeService,
  createArtifactDir,
  createBridgeClient,
  createCodexRunnerSequence,
} from '../helpers/runtime-fixtures';

describe('real e2e validation flow', () => {
  it('runs a mock-assisted end-to-end validation report through acceptance', async () => {
    const artifactDir = await createArtifactDir('real-e2e-validation-');
    const bundle = createOrchestratorRuntimeBundle({
      artifactDir,
      bridgeClient: createBridgeClient(),
      codexRunner: createCodexRunnerSequence([
        {
          status: 'succeeded',
          summary: 'Codex validation execution completed.',
          stdout: 'validation execution complete',
          stderr: '',
          exitCode: 0,
          patch:
            'diff --git a/apps/orchestrator/artifacts/validation.txt b/apps/orchestrator/artifacts/validation.txt\n+validated\n',
          testResults: [
            {
              suite: 'vitest',
              status: 'passed',
              passed: 1,
              failed: 0,
              skipped: 0,
            },
          ],
          metadata: {},
        },
      ]),
      worktreeService: new FakeWorktreeService(),
    });

    const report = await bundle.e2eValidationService.validate({
      createdBy: 'tester',
    });

    expect(report.verdict).toBe('passed');
    await expect(bundle.runRepository.getRun(report.runId)).resolves.toMatchObject({
      stage: 'accepted',
    });
    await expect(
      bundle.stabilityRepository.getValidationReport(report.runId),
    ).resolves.toMatchObject({
      runId: report.runId,
      verdict: 'passed',
    });
    await expect(
      fs.stat(path.join(artifactDir, 'runs', report.runId, 'validation', 'validation-report.json')),
    ).resolves.toBeTruthy();
  });

  it.skipIf(process.env.ENABLE_REAL_E2E_VALIDATION !== 'true')(
    'provides an opt-in harness for real bridge and Codex validation',
    async () => {
      const bundle = createOrchestratorRuntimeBundle();
      const report = await bundle.e2eValidationService.validate({
        createdBy: 'tester',
        mode: 'real',
      });

      expect(['passed', 'passed_with_manual_attention']).toContain(report.verdict);
    },
  );
});
