import { createOrchestratorRuntimeBundle } from '../apps/orchestrator/src';
import {
  createBridgeClient,
  createCodexRunnerSequence,
  FakeWorktreeService,
} from '../apps/orchestrator/tests/helpers/runtime-fixtures';

async function main(): Promise<void> {
  const mode = process.env.PLANNING_PROOF_MODE === 'real' ? 'real' : 'mock_assisted';
  if (
    mode === 'real' &&
    (process.env.ENABLE_REAL_E2E_VALIDATION !== 'true' ||
      process.env.ENABLE_REAL_PLANNING_PROOF !== 'true')
  ) {
    throw new Error(
      'ENABLE_REAL_E2E_VALIDATION=true and ENABLE_REAL_PLANNING_PROOF=true are required before running the real fresh planning proof.',
    );
  }

  const bundle =
    mode === 'real'
      ? createOrchestratorRuntimeBundle()
      : createOrchestratorRuntimeBundle({
          bridgeClient: createBridgeClient(),
          codexRunner: createCodexRunnerSequence([
            {
              status: 'succeeded',
              summary: 'Mock-assisted planning proof execution completed.',
              stdout: 'done',
              stderr: '',
              exitCode: 0,
              patch:
                'diff --git a/tmp/e2e-targets/user-api-validation-1/src/user-service.ts b/tmp/e2e-targets/user-api-validation-1/src/user-service.ts\n+change\n',
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
  const report = await bundle.planningValidationService.validate({
    createdBy: process.env.USER ?? 'operator',
    mode,
    prompt: process.env.FRESH_PLANNING_PROMPT,
  });

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

void main().catch((error) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
