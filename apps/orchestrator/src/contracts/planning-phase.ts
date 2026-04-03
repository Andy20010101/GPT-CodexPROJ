import { z } from 'zod';

export const PlanningPhaseSchema = z.enum([
  'requirement_freeze',
  'architecture_freeze',
  'task_graph_generation',
]);

export type PlanningPhase = z.infer<typeof PlanningPhaseSchema>;

export const PlanningDirectorySchema = z.enum(['requirement', 'architecture', 'task-graph']);

export type PlanningDirectory = z.infer<typeof PlanningDirectorySchema>;

export function planningPhaseToDirectory(phase: PlanningPhase): PlanningDirectory {
  switch (phase) {
    case 'requirement_freeze':
      return 'requirement';
    case 'architecture_freeze':
      return 'architecture';
    case 'task_graph_generation':
      return 'task-graph';
  }
}
