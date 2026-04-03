import { randomUUID } from 'node:crypto';

import type {
  ArchitectureFreeze,
  PlanningSufficiencyDecision,
  RequirementFreeze,
  TaskGraph,
} from '../contracts';
import { PlanningSufficiencyDecisionSchema } from '../contracts';

export class PlanningSufficiencyGateService {
  public evaluate(input: {
    runId: string;
    evaluator: string;
    requirementFreeze?: RequirementFreeze | null | undefined;
    architectureFreeze?: ArchitectureFreeze | null | undefined;
    taskGraph?: TaskGraph | null | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): PlanningSufficiencyDecision {
    const incompleteReasons: string[] = [];
    const invalidReasons: string[] = [];
    const manualReviewReasons: string[] = [];

    const requirementFreeze = input.requirementFreeze ?? null;
    if (!requirementFreeze) {
      incompleteReasons.push('Requirement freeze is missing.');
    } else {
      if (requirementFreeze.objectives.length === 0) {
        incompleteReasons.push('Requirement freeze has no clear objectives.');
      }
      if (requirementFreeze.nonGoals.length === 0) {
        incompleteReasons.push('Requirement freeze has no explicit non-goals.');
      }
      if (requirementFreeze.constraints.length === 0) {
        incompleteReasons.push('Requirement freeze has no explicit constraints.');
      }
      if (
        requirementFreeze.acceptanceCriteria.length === 0 ||
        requirementFreeze.acceptanceCriteria.some(
          (criterion) => criterion.description.trim().length === 0,
        )
      ) {
        incompleteReasons.push('Requirement freeze acceptance criteria are incomplete.');
      }
    }

    const architectureFreeze = input.architectureFreeze ?? null;
    if (!architectureFreeze) {
      incompleteReasons.push('Architecture freeze is missing.');
    } else {
      if (architectureFreeze.moduleDefinitions.length === 0) {
        incompleteReasons.push('Architecture freeze has no module definitions.');
      }
      if (architectureFreeze.dependencyRules.length === 0) {
        incompleteReasons.push('Architecture freeze has no dependency rules.');
      }
      if (
        architectureFreeze.moduleDefinitions.every(
          (module) => module.publicInterfaces.length === 0 && module.allowedDependencies.length === 0,
        )
      ) {
        manualReviewReasons.push(
          'Architecture freeze does not describe interface boundaries or dependency surfaces clearly.',
        );
      }
    }

    const taskGraph = input.taskGraph ?? null;
    if (!taskGraph) {
      incompleteReasons.push('Task graph is missing.');
    } else {
      if (taskGraph.tasks.length === 0) {
        invalidReasons.push('Task graph contains no tasks.');
      }
      if (
        taskGraph.tasks.some(
          (task) =>
            task.objective.trim().length === 0 ||
            task.acceptanceCriteria.length === 0 ||
            task.testPlan.length === 0 ||
            task.allowedFiles.length === 0 ||
            task.scope.inScope.length === 0,
        )
      ) {
        incompleteReasons.push(
          'Every task must include objective, acceptance criteria, test plan, scope, and allowed files.',
        );
      }
      const dependencyCount =
        taskGraph.edges.length +
        taskGraph.tasks.reduce((count, task) => count + task.dependencies.length, 0);
      if (taskGraph.tasks.length > 1 && dependencyCount === 0) {
        manualReviewReasons.push(
          'Task graph has multiple tasks but no dependency relation was defined.',
        );
      }
    }

    let status: PlanningSufficiencyDecision['status'] = 'passed';
    let reasons: string[] = [];
    if (invalidReasons.length > 0) {
      status = 'planning_invalid';
      reasons = invalidReasons;
    } else if (incompleteReasons.length > 0) {
      status = 'planning_incomplete';
      reasons = incompleteReasons;
    } else if (manualReviewReasons.length > 0) {
      status = 'planning_requires_manual_review';
      reasons = manualReviewReasons;
    }

    return PlanningSufficiencyDecisionSchema.parse({
      decisionId: randomUUID(),
      runId: input.runId,
      phase: 'task_graph_generation',
      status,
      passed: status === 'passed',
      reasons,
      evaluator: input.evaluator,
      timestamp: new Date().toISOString(),
      metadata: input.metadata ?? {},
    });
  }
}
