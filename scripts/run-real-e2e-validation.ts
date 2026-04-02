import { createOrchestratorRuntimeBundle } from '../apps/orchestrator/src';

async function main(): Promise<void> {
  if (process.env.ENABLE_REAL_E2E_VALIDATION !== 'true') {
    throw new Error(
      'ENABLE_REAL_E2E_VALIDATION=true is required before running the real validation harness.',
    );
  }

  const bundle = createOrchestratorRuntimeBundle();
  const report = await bundle.e2eValidationService.validate({
    createdBy: process.env.USER ?? 'operator',
    mode: 'real',
    title: process.env.E2E_VALIDATION_TITLE,
    summary: process.env.E2E_VALIDATION_SUMMARY,
  });

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

void main().catch((error) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
