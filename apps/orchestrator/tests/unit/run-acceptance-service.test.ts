import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createOrchestratorRuntimeBundle } from '../../src';
import {
  buildArchitectureFreeze,
  buildRequirementFreeze,
  buildTask,
  createArtifactDir,
} from '../helpers/runtime-fixtures';

describe('RunAcceptanceService', () => {
  it('accepts a run only after a passing release gate exists', async () => {
    const artifactDir = await createArtifactDir('run-acceptance-service-');
    const bundle = createOrchestratorRuntimeBundle({
      artifactDir,
    });
    const run = await bundle.orchestratorService.createRun({
      title: 'Acceptance run',
      createdBy: 'tester',
    });
    await bundle.orchestratorService.saveRequirementFreeze(
      run.runId,
      buildRequirementFreeze(run.runId),
    );
    await bundle.orchestratorService.saveArchitectureFreeze(
      run.runId,
      buildArchitectureFreeze(run.runId),
    );
    const acceptedTask = buildTask(run.runId, {
      status: 'accepted',
    });
    await bundle.taskRepository.saveTask(acceptedTask);
    await bundle.runRepository.saveRun({
      ...run,
      stage: 'release_review',
      updatedAt: '2026-04-02T15:14:00.000Z',
    });
    await bundle.releaseRepository.saveResult({
      result: {
        releaseReviewId: randomUUID(),
        runId: run.runId,
        status: 'approved',
        summary: 'Release review approved the run.',
        findings: [],
        outstandingLimitations: [],
        recommendedActions: [],
        bridgeArtifacts: {},
        rawStructuredReview: null,
        metadata: {},
        timestamp: '2026-04-02T15:14:00.000Z',
      },
    });
    await bundle.releaseGateService.recordReleaseGate({
      run: await bundle.runRepository.getRun(run.runId),
      evaluator: 'tester',
      reviewResult: {
        releaseReviewId: randomUUID(),
        runId: run.runId,
        status: 'approved',
        summary: 'approved',
        findings: [],
        outstandingLimitations: [],
        recommendedActions: [],
        bridgeArtifacts: {},
        rawStructuredReview: null,
        metadata: {},
        timestamp: '2026-04-02T15:14:00.000Z',
      },
    });

    const result = await bundle.runAcceptanceService.acceptRun({
      runId: run.runId,
      acceptedBy: 'tester',
    });

    expect(result.run.stage).toBe('accepted');
    expect(result.acceptance.runId).toBe(run.runId);
  });

  it('blocks run acceptance when the release gate is missing', async () => {
    const artifactDir = await createArtifactDir('run-acceptance-blocked-');
    const bundle = createOrchestratorRuntimeBundle({
      artifactDir,
    });
    const run = await bundle.orchestratorService.createRun({
      title: 'Blocked acceptance run',
      createdBy: 'tester',
    });
    await bundle.runRepository.saveRun({
      ...run,
      stage: 'release_review',
      updatedAt: '2026-04-02T15:14:00.000Z',
    });

    await expect(
      bundle.runAcceptanceService.acceptRun({
        runId: run.runId,
        acceptedBy: 'tester',
      }),
    ).rejects.toMatchObject({
      code: 'RUN_ACCEPTANCE_BLOCKED',
    });
  });
});
