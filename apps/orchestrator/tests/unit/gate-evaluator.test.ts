import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { GateEvaluator } from '../../src/services/gate-evaluator';
import { createRunRecord } from '../../src/domain/run';
import type { ArchitectureFreeze, RequirementFreeze, TaskEnvelope } from '../../src/contracts';

function buildRequirementFreeze(runId: string): RequirementFreeze {
  return {
    runId,
    title: 'Requirement freeze',
    summary: 'Lock the requirements',
    objectives: ['Ship the control plane'],
    nonGoals: ['Build the full runtime'],
    constraints: [],
    risks: [],
    acceptanceCriteria: [
      {
        id: 'ac-1',
        description: 'Must have tests',
        verificationMethod: 'automated_test',
        requiredEvidenceKinds: ['test_report'],
      },
    ],
    frozenAt: '2026-04-01T12:00:00.000Z',
    frozenBy: 'architect',
  };
}

function buildArchitectureFreeze(runId: string): ArchitectureFreeze {
  return {
    runId,
    summary: 'Freeze the module boundaries',
    moduleDefinitions: [
      {
        moduleId: 'orchestrator',
        name: 'orchestrator',
        responsibility: 'Control-plane orchestration',
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
        rationale: 'Reuse bridge schemas.',
      },
    ],
    invariants: ['No direct Puppeteer import'],
    frozenAt: '2026-04-01T12:05:00.000Z',
    frozenBy: 'architect',
  };
}

function buildTask(runId: string, status: TaskEnvelope['status']): TaskEnvelope {
  return {
    taskId: randomUUID(),
    runId,
    title: 'Implement ledger',
    objective: 'Store evidence on disk',
    scope: {
      inScope: ['apps/orchestrator/src/storage'],
      outOfScope: ['services/chatgpt-web-bridge'],
    },
    allowedFiles: ['apps/orchestrator/src/storage/**'],
    disallowedFiles: ['services/chatgpt-web-bridge/**'],
    dependencies: [],
    acceptanceCriteria: [
      {
        id: 'ac-1',
        description: 'Store evidence',
        verificationMethod: 'artifact',
        requiredEvidenceKinds: ['test_report'],
      },
    ],
    testPlan: [
      {
        id: 'test-1',
        description: 'Write evidence',
        expectedRedSignal: 'test fails',
        expectedGreenSignal: 'test passes',
      },
    ],
    implementationNotes: [],
    evidenceIds: [],
    status,
    createdAt: '2026-04-01T12:06:00.000Z',
    updatedAt: '2026-04-01T12:06:00.000Z',
  };
}

describe('GateEvaluator', () => {
  it('passes requirement gate when freeze has objectives and acceptance criteria', () => {
    const run = createRunRecord({
      title: 'Run',
      createdBy: 'tester',
      stage: 'requirement_frozen',
    });
    const evaluator = new GateEvaluator();

    const result = evaluator.evaluate({
      run,
      gateType: 'requirement_gate',
      evaluator: 'tester',
      evidence: [],
      requirementFreeze: buildRequirementFreeze(run.runId),
    });

    expect(result.passed).toBe(true);
  });

  it('rejects review gate when no review evidence exists', () => {
    const run = createRunRecord({
      title: 'Run',
      createdBy: 'tester',
      stage: 'task_execution',
    });
    const evaluator = new GateEvaluator();
    const task = buildTask(run.runId, 'review_pending');

    const result = evaluator.evaluate({
      run,
      gateType: 'review_gate',
      evaluator: 'tester',
      evidence: [],
      task,
    });

    expect(result.passed).toBe(false);
    expect(result.reasons).toContain('No review evidence is attached to the task.');
  });

  it('rejects architecture gate when the freeze is missing', () => {
    const run = createRunRecord({
      title: 'Run',
      createdBy: 'tester',
      stage: 'requirement_frozen',
    });
    const evaluator = new GateEvaluator();

    const result = evaluator.evaluate({
      run,
      gateType: 'architecture_gate',
      evaluator: 'tester',
      evidence: [],
      architectureFreeze: null,
    });

    expect(result.passed).toBe(false);
  });

  it('passes acceptance gate for an accepted task with review and test evidence', () => {
    const run = createRunRecord({
      title: 'Run',
      createdBy: 'tester',
      stage: 'release_review',
    });
    const evaluator = new GateEvaluator();
    const task = buildTask(run.runId, 'accepted');

    const result = evaluator.evaluate({
      run,
      gateType: 'acceptance_gate',
      evaluator: 'tester',
      task,
      evidence: [
        {
          evidenceId: randomUUID(),
          runId: run.runId,
          taskId: task.taskId,
          stage: 'release_review',
          kind: 'review_note',
          timestamp: '2026-04-01T12:10:00.000Z',
          producer: 'reviewer',
          artifactPaths: ['artifacts/review.md'],
          summary: 'Review completed',
          metadata: {},
        },
        {
          evidenceId: randomUUID(),
          runId: run.runId,
          taskId: task.taskId,
          stage: 'release_review',
          kind: 'test_report',
          timestamp: '2026-04-01T12:11:00.000Z',
          producer: 'tester',
          artifactPaths: ['artifacts/tests.txt'],
          summary: 'Tests passed',
          metadata: {},
        },
      ],
      requirementFreeze: buildRequirementFreeze(run.runId),
      architectureFreeze: buildArchitectureFreeze(run.runId),
    });

    expect(result.passed).toBe(true);
  });
});
