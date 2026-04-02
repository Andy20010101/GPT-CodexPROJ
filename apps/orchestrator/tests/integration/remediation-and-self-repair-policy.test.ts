import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createOrchestratorRuntimeBundle } from '../../src';
import { createArtifactDir } from '../helpers/runtime-fixtures';

describe('remediation and self-repair policy integration', () => {
  it('executes low-risk remediation actions and leaves medium-risk actions pending review', async () => {
    const artifactDir = await createArtifactDir('remediation-policy-');
    const bundle = createOrchestratorRuntimeBundle({ artifactDir });
    const run = await bundle.orchestratorService.createRun({
      title: 'Remediation integration run',
      createdBy: 'tester',
    });

    const autoProposal = await bundle.remediationService.propose({
      runId: run.runId,
      failure: {
        failureId: randomUUID(),
        runId: run.runId,
        source: 'evidence',
        taxonomy: 'execution',
        code: 'EVIDENCE_MISSING',
        message: 'Evidence artifact is missing.',
        retriable: false,
        timestamp: '2026-04-02T21:30:00.000Z',
        metadata: {},
      },
    });
    const autoResult = await bundle.remediationService.execute({
      remediationId: autoProposal.remediationId,
      requestedBy: 'tester',
    });

    const reviewProposal = await bundle.remediationService.propose({
      runId: run.runId,
      failure: {
        failureId: randomUUID(),
        runId: run.runId,
        source: 'runner',
        taxonomy: 'timeout',
        code: 'RUNNER_TIMEOUT',
        message: 'Runner timed out.',
        retriable: true,
        timestamp: '2026-04-02T21:31:00.000Z',
        metadata: {},
      },
    });
    const reviewResult = await bundle.remediationService.execute({
      remediationId: reviewProposal.remediationId,
      requestedBy: 'tester',
    });

    expect(autoProposal.policyDecision).toBe('auto_allowed');
    expect(autoResult.status).toBe('executed');
    expect(autoResult.actions[0]?.kind).toBe('capture_debug_snapshot');

    expect(reviewProposal.policyDecision).toBe('review_required');
    expect(reviewResult.status).toBe('review_required');
    expect(reviewResult.actions[0]).toMatchObject({
      kind: 'manual_attention',
      status: 'skipped',
    });

    await expect(bundle.remediationRepository.listResults(run.runId)).resolves.toHaveLength(2);
    await expect(bundle.evidenceRepository.listEvidenceForRun(run.runId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'self_repair_policy_decision' }),
        expect.objectContaining({ kind: 'remediation_result' }),
      ]),
    );
  });
});
