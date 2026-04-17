export type ClassifiedRunTerminalState = {
  version: 1;
  runId: string;
  classifiedAt: string;
  terminal: boolean;
  outcome: 'non_terminal' | 'accepted' | 'manual_attention_required';
  reason: string;
  runStage: string;
  runtimeStatus: string;
  taskGraphRegistered: boolean;
  totalTasks: number;
  acceptedTasks: number;
  runnableTasks: number;
  blockedTasks: number;
  queuedJobs: number;
  runningJobs: number;
  retriableJobs: number;
  failedJobs: number;
  blockedJobs: number;
  hasRunAcceptance: boolean;
};

export type OrderedTodoGoal = {
  todoId: string;
  title: string;
  section: 'Ordered Execution Queue';
  autoRunnable: boolean;
};

export function classifySelfImprovementRun(input: {
  run: {
    runId: string;
    stage: string;
    taskGraphPath?: string;
  };
  authoritativeRun?: {
    runId: string;
    stage: string;
    taskGraphPath?: string;
  };
  runtimeState: {
    status: string;
    queuedJobs: number;
    runningJobs: number;
    retriableJobs: number;
    failedJobs: number;
    blockedJobs: number;
    runnableTaskIds?: string[];
    blockedTaskIds?: string[];
  };
  summary?: {
    taskGraphRegistered?: boolean;
  };
  tasks?: Array<{
    status?: string;
  }>;
  hasRunAcceptance?: boolean;
  classifiedAt?: string;
}): ClassifiedRunTerminalState;

export function selectNextOrderedTodo(
  markdown: string,
  options?: {
    excludeTodoIds?: string[];
  },
): OrderedTodoGoal | null;
