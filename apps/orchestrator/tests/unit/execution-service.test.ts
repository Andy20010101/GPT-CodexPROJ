import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  ExecutionRequestSchema,
  ExecutionResultSchema,
  TestResultSchema,
  type ExecutionRequest,
  type ExecutionResult,
  type TaskEnvelope,
} from '../../src/contracts';
import { createRunRecord } from '../../src/domain/run';
import { EvidenceLedgerService } from '../../src/services/evidence-ledger-service';
import { ExecutionEvidenceService } from '../../src/services/execution-evidence-service';
import { ExecutionService } from '../../src/services/execution-service';
import {
  ExecutorRegistry,
  NoopExecutor,
  type ExecutionExecutor,
} from '../../src/services/executor-registry';
import { FileEvidenceRepository } from '../../src/storage/file-evidence-repository';
import { FileExecutionRepository } from '../../src/storage/file-execution-repository';
import { createEmptyPatchSummary } from '../../src/utils/patch-parser';

class PassingExecutor implements ExecutionExecutor {
  public readonly type = 'command' as const;

  public getCapability() {
    return {
      type: this.type,
      description: 'passing executor',
      supportsPatchOutput: false,
      supportsTestResults: true,
      supportsStructuredPrompt: false,
      supportsWorkspaceCommands: true,
    };
  }

  public execute(request: ExecutionRequest): Promise<ExecutionResult> {
    return Promise.resolve(
      ExecutionResultSchema.parse({
        executionId: request.executionId,
        runId: request.runId,
        taskId: request.taskId,
        executorType: this.type,
        status: 'succeeded',
        startedAt: '2026-04-02T11:00:00.000Z',
        finishedAt: '2026-04-02T11:00:01.000Z',
        summary: 'executor passed',
        patchSummary: createEmptyPatchSummary(['No patch']),
        testResults: [
          TestResultSchema.parse({
            suite: 'unit',
            status: 'passed',
            passed: 1,
            failed: 0,
            skipped: 0,
          }),
        ],
        artifacts: [],
        stdout: 'ok',
        stderr: '',
        exitCode: 0,
        metadata: {},
      }),
    );
  }
}

function buildTask(runId: string, status: TaskEnvelope['status']): TaskEnvelope {
  return {
    taskId: randomUUID(),
    runId,
    title: 'Execute task',
    objective: 'Turn a task envelope into an execution request',
    executorType: 'command',
    scope: {
      inScope: ['apps/orchestrator/src/services'],
      outOfScope: ['services/chatgpt-web-bridge'],
    },
    allowedFiles: ['apps/orchestrator/src/services/**'],
    disallowedFiles: ['services/chatgpt-web-bridge/**'],
    dependencies: [],
    acceptanceCriteria: [
      {
        id: 'ac-1',
        description: 'Execution returns structured results',
        verificationMethod: 'automated_test',
        requiredEvidenceKinds: ['test_report'],
      },
    ],
    testPlan: [
      {
        id: 'tp-1',
        description: 'Run unit tests',
        verificationCommand: 'npm test',
        expectedRedSignal: 'failing tests',
        expectedGreenSignal: 'passing tests',
      },
    ],
    implementationNotes: ['Stay inside service layer boundaries.'],
    evidenceIds: [randomUUID()],
    metadata: {
      priority: 'high',
    },
    status,
    createdAt: '2026-04-02T10:00:00.000Z',
    updatedAt: '2026-04-02T10:00:00.000Z',
  };
}

describe('ExecutionService', () => {
  it('validates execution request and result schemas', () => {
    const request = ExecutionRequestSchema.parse({
      executionId: randomUUID(),
      runId: randomUUID(),
      taskId: randomUUID(),
      executorType: 'noop',
      workspacePath: '/tmp',
      title: 'Request',
      objective: 'Validate schemas',
      scope: {
        inScope: ['/tmp'],
        outOfScope: [],
      },
      allowedFiles: ['/tmp/**'],
      disallowedFiles: [],
      acceptanceCriteria: [
        {
          id: 'ac-1',
          description: 'Schema validates',
          verificationMethod: 'artifact',
          requiredEvidenceKinds: ['execution_result'],
        },
      ],
      testPlan: [],
      implementationNotes: [],
      architectureConstraints: [],
      relatedEvidenceIds: [],
      metadata: {},
      requestedAt: '2026-04-02T10:30:00.000Z',
    });

    const result = ExecutionResultSchema.parse({
      executionId: request.executionId,
      runId: request.runId,
      taskId: request.taskId,
      executorType: 'noop',
      status: 'partial',
      startedAt: '2026-04-02T10:30:01.000Z',
      finishedAt: '2026-04-02T10:30:02.000Z',
      summary: 'schema result',
      patchSummary: createEmptyPatchSummary([]),
      testResults: [],
      artifacts: [],
      stdout: '',
      stderr: '',
      exitCode: 0,
      metadata: {},
    });

    expect(request.executorType).toBe('noop');
    expect(result.status).toBe('partial');
  });

  it('builds requests and recommends tests_green after passing execution results', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'execution-service-'));
    const evidenceRepository = new FileEvidenceRepository(artifactDir);
    const executionRepository = new FileExecutionRepository(artifactDir);
    const ledger = new EvidenceLedgerService(evidenceRepository);
    const service = new ExecutionService(
      new ExecutorRegistry([new PassingExecutor(), new NoopExecutor()]),
      new ExecutionEvidenceService(executionRepository, ledger),
    );
    const run = createRunRecord({
      title: 'Execution run',
      createdBy: 'tester',
      stage: 'task_execution',
    });
    const task = buildTask(run.runId, 'tests_red');

    const request = service.buildRequest({
      run,
      task,
      workspacePath: '/home/administrator/code/GPT-CodexPROJ',
      architectureFreeze: {
        runId: run.runId,
        summary: 'Freeze',
        moduleDefinitions: [
          {
            moduleId: 'orchestrator',
            name: 'orchestrator',
            responsibility: 'control plane',
            ownedPaths: ['apps/orchestrator/src'],
            publicInterfaces: ['createOrchestratorService'],
            allowedDependencies: ['shared-contracts'],
          },
        ],
        dependencyRules: [
          {
            fromModuleId: 'orchestrator',
            toModuleId: 'shared-contracts',
            rule: 'allow',
            rationale: 'contracts',
          },
        ],
        invariants: ['No Puppeteer imports'],
        frozenAt: '2026-04-02T10:01:00.000Z',
        frozenBy: 'architect',
      },
      metadata: {
        requestedBy: 'tester',
      },
    });

    expect(request.architectureConstraints).toEqual(
      expect.arrayContaining(['No Puppeteer imports']),
    );
    expect(request.relatedEvidenceIds).toEqual(task.evidenceIds);

    const dispatch = await service.executeTask({
      run,
      task,
      producer: 'tester',
      workspacePath: '/home/administrator/code/GPT-CodexPROJ',
      onFailure: 'keep_implementing',
    });

    expect(dispatch.disposition.recommendedTaskState).toBe('tests_green');
    expect(dispatch.result.status).toBe('succeeded');
    expect(dispatch.evidence.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining(['execution_request', 'execution_result', 'test_report']),
    );
  });
});
