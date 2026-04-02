import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createOrchestratorRuntimeBundle } from '../../src';

describe('RemediationService', () => {
  it('proposes and executes a controlled low-risk remediation action', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remediation-service-'));
    const bundle = createOrchestratorRuntimeBundle({ artifactDir });
    const run = await bundle.orchestratorService.createRun({
      title: 'Remediation run',
      createdBy: 'tester',
    });

    const proposed = await bundle.remediationService.propose({
      runId: run.runId,
      failure: {
        failureId: randomUUID(),
        runId: run.runId,
        source: 'evidence',
        taxonomy: 'execution',
        code: 'EVIDENCE_MISSING',
        message: 'Expected evidence artifact is missing.',
        retriable: false,
        timestamp: '2026-04-02T21:20:00.000Z',
        metadata: {},
      },
    });

    expect(proposed.policyDecision).toBe('auto_allowed');
    expect(proposed.status).toBe('proposed');

    const executed = await bundle.remediationService.execute({
      remediationId: proposed.remediationId,
      requestedBy: 'tester',
    });

    expect(executed.status).toBe('executed');
    expect(executed.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'capture_debug_snapshot',
          status: 'executed',
        }),
      ]),
    );
    await expect(
      bundle.remediationRepository.getResult(proposed.remediationId),
    ).resolves.toMatchObject({
      remediationId: proposed.remediationId,
      status: 'executed',
    });
    await expect(bundle.evidenceRepository.listEvidenceForRun(run.runId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'remediation_proposal' }),
        expect.objectContaining({ kind: 'remediation_result' }),
      ]),
    );
  });
});
