import { describe, expect, it } from 'vitest';

import { createOrchestratorRuntimeBundle } from '../../src';
import { createArtifactDir } from '../helpers/runtime-fixtures';

describe('FailureClassificationService', () => {
  it('classifies timeout, materialization, planning, drift, and environment failures', async () => {
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
    const materialization = bundle.failureClassificationService.classify({
      runId: run.runId,
      source: 'test',
      error: {
        code: 'REVIEW_MATERIALIZATION_PENDING',
        message: 'export failed after conversation completion',
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
    const planningInvalid = bundle.failureClassificationService.classify({
      runId: run.runId,
      source: 'test',
      error: {
        code: 'PLANNING_INVALID',
        message: 'task graph did not match the schema',
      },
    });

    expect(timeout.taxonomy).toBe('timeout');
    expect(materialization.taxonomy).toBe('materialization');
    expect(planningInvalid.taxonomy).toBe('planning');
    expect(drift.taxonomy).toBe('drift');
    expect(environment.taxonomy).toBe('environment');
  });
});
