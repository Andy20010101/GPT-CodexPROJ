import { describe, expect, it } from 'vitest';

import { PlanningSufficiencyGateService } from '../../src/services/planning-sufficiency-gate-service';
import {
  buildArchitectureFreeze,
  buildRequirementFreeze,
  buildTask,
} from '../helpers/runtime-fixtures';

describe('PlanningSufficiencyGateService', () => {
  it('passes when requirement, architecture, and task graph are complete', () => {
    const service = new PlanningSufficiencyGateService();
    const runId = '3d3d89be-6a1b-4e2f-bf4a-bb6c4f6494d2';
    const task1 = buildTask(runId);
    const task2 = buildTask(runId, {
      title: 'Task 2',
      dependencies: [task1.taskId],
      taskId: '4d336d07-8e01-46bf-bc75-f2792f1c2c4f',
    });

    const decision = service.evaluate({
      runId,
      evaluator: 'tester',
      requirementFreeze: buildRequirementFreeze(runId),
      architectureFreeze: buildArchitectureFreeze(runId),
      taskGraph: {
        runId,
        tasks: [task1, task2],
        edges: [
          {
            fromTaskId: task1.taskId,
            toTaskId: task2.taskId,
            kind: 'blocks',
          },
        ],
        registeredAt: '2026-04-03T00:00:00.000Z',
      },
    });

    expect(decision.status).toBe('passed');
    expect(decision.passed).toBe(true);
  });

  it('marks planning incomplete when requirement non-goals and task test plans are missing', () => {
    const service = new PlanningSufficiencyGateService();
    const runId = 'c59f7233-bd10-4144-a769-a32fb0458ee5';
    const requirement = {
      ...buildRequirementFreeze(runId),
      nonGoals: [],
      constraints: [],
    };
    const task = buildTask(runId, {
      testPlan: [],
      allowedFiles: [],
    });

    const decision = service.evaluate({
      runId,
      evaluator: 'tester',
      requirementFreeze: requirement,
      architectureFreeze: buildArchitectureFreeze(runId),
      taskGraph: {
        runId,
        tasks: [task],
        edges: [],
        registeredAt: '2026-04-03T00:00:00.000Z',
      },
    });

    expect(decision.status).toBe('planning_incomplete');
    expect(decision.reasons).toEqual(
      expect.arrayContaining([
        'Requirement freeze has no explicit non-goals.',
        'Requirement freeze has no explicit constraints.',
        'Every task must include objective, acceptance criteria, test plan, scope, and allowed files.',
      ]),
    );
  });

  it('marks planning for manual review when multiple tasks have no dependency relation', () => {
    const service = new PlanningSufficiencyGateService();
    const runId = 'f8c7ca7b-a476-4906-9b31-0a5ca51b1d5e';
    const task1 = buildTask(runId);
    const task2 = buildTask(runId, {
      title: 'Independent task',
      taskId: '67d3e848-ec0b-49df-9f95-8459937e9bc3',
    });

    const decision = service.evaluate({
      runId,
      evaluator: 'tester',
      requirementFreeze: buildRequirementFreeze(runId),
      architectureFreeze: buildArchitectureFreeze(runId),
      taskGraph: {
        runId,
        tasks: [task1, task2],
        edges: [],
        registeredAt: '2026-04-03T00:00:00.000Z',
      },
    });

    expect(decision.status).toBe('planning_requires_manual_review');
  });
});
