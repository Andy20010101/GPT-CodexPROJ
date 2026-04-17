import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  ExecutionRequestSchema,
  ExecutionResultSchema,
  TestResultSchema,
} from '../../src/contracts';
import { EvidenceLedgerService } from '../../src/services/evidence-ledger-service';
import { ExecutionEvidenceService } from '../../src/services/execution-evidence-service';
import { FileEvidenceRepository } from '../../src/storage/file-evidence-repository';
import { FileExecutionRepository } from '../../src/storage/file-execution-repository';
import { createEmptyPatchSummary } from '../../src/utils/patch-parser';

describe('ExecutionEvidenceService', () => {
  it('persists execution artifacts and mirrors them into the evidence ledger', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'execution-evidence-'));
    const evidenceRepository = new FileEvidenceRepository(artifactDir);
    const executionRepository = new FileExecutionRepository(artifactDir);
    const ledger = new EvidenceLedgerService(evidenceRepository);
    const service = new ExecutionEvidenceService(executionRepository, ledger);
    const executionId = randomUUID();
    const runId = randomUUID();
    const taskId = randomUUID();

    const request = ExecutionRequestSchema.parse({
      executionId,
      runId,
      taskId,
      executorType: 'codex',
      workspacePath: '/home/administrator/code/GPT-CodexPROJ',
      title: 'Record execution evidence',
      objective: 'Save request/result and write evidence records',
      scope: {
        inScope: ['apps/orchestrator/src'],
        outOfScope: [],
      },
      allowedFiles: ['apps/orchestrator/src/**'],
      disallowedFiles: [],
      acceptanceCriteria: [
        {
          id: 'ac-1',
          description: 'Execution evidence is queryable',
          verificationMethod: 'artifact',
          requiredEvidenceKinds: ['test_report'],
        },
      ],
      testPlan: [],
      implementationNotes: [],
      architectureConstraints: [],
      relatedEvidenceIds: [],
      metadata: {},
      requestedAt: '2026-04-02T09:00:00.000Z',
    });

    const result = ExecutionResultSchema.parse({
      executionId,
      runId,
      taskId,
      executorType: 'codex',
      status: 'failed',
      startedAt: '2026-04-02T09:00:01.000Z',
      finishedAt: '2026-04-02T09:00:02.000Z',
      summary: 'Execution failed but evidence should still land on disk.',
      patchSummary: createEmptyPatchSummary(['No patch for this execution.']),
      testResults: [
        TestResultSchema.parse({
          suite: 'vitest execution',
          status: 'failed',
          passed: 0,
          failed: 1,
          skipped: 0,
        }),
      ],
      artifacts: [
        {
          artifactId: randomUUID(),
          kind: 'review-input',
          label: 'payload',
          content: '# request',
          metadata: {},
        },
      ],
      stdout: 'stdout',
      stderr: 'stderr',
      exitCode: 1,
      metadata: {},
    });

    const recorded = await service.recordExecutionResult({
      request,
      result,
      producer: 'tester',
      stage: 'task_execution',
    });

    expect(await fs.readFile(path.join(recorded.executionDir, 'request.json'), 'utf8')).toContain(
      executionId,
    );
    expect(await fs.readFile(path.join(recorded.executionDir, 'result.json'), 'utf8')).toContain(
      'Execution failed but evidence should still land on disk.',
    );
    expect(await fs.readFile(path.join(recorded.executionDir, 'stdout.log'), 'utf8')).toBe(
      'stdout',
    );
    expect(await fs.readFile(path.join(recorded.executionDir, 'stderr.log'), 'utf8')).toBe(
      'stderr',
    );
    expect(recorded.evidence.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining([
        'execution_request',
        'execution_result',
        'review_input',
        'test_report',
        'command_log',
      ]),
    );

    const summary = await service.summarizeExecutionForTask(runId, taskId);
    expect(summary.totalExecutions).toBe(1);
    expect(summary.byStatus.failed).toBe(1);
    expect(summary.latestExecutionId).toBe(executionId);
  });
});
