import { describe, expect, it } from 'vitest';

import { createOrchestratorRuntimeBundle } from '../../src';
import { createArtifactDir } from '../helpers/runtime-fixtures';

describe('FailureClassificationService', () => {
  it('classifies timeout, drift, and environment failures', async () => {
    const artifactDir = await createArtifactDir('failure-classify-');
    const bundle = createOrchestratorRuntimeBundle({
      artifactDir,
    });
    const run = await bundle.orchestratorService.createRun({
      title: 'failure test',
      createdBy: 'tester',
    });

    const timeout = await bundle.failureClassificationService.recordFailure({
      runId: run.runId,
      source: 'test',
      error: {
        code: 'RUNNER_TIMEOUT',
        message: 'runner timed out',
      },
    });
    const drift = bundle.failureClassificationService.classify({
      runId: run.runId,
      source: 'test',
      error: {
        code: 'DOM_DRIFT_DETECTED',
        message: 'selector missing',
      },
    });
    const environment = bundle.failureClassificationService.classify({
      runId: run.runId,
      source: 'test',
      error: {
        code: 'WORKSPACE_PREPARE_FAILED',
        message: 'worktree failed',
      },
    });

    expect(timeout.taxonomy).toBe('timeout');
    expect(drift.taxonomy).toBe('drift');
    expect(environment.taxonomy).toBe('environment');
  });
});
