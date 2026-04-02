import { describe, expect, it } from 'vitest';

import { TaskSchedulerService } from '../../src/services/task-scheduler-service';
import { buildTask } from '../helpers/runtime-fixtures';

describe('TaskSchedulerService', () => {
  it('computes runnable tasks from blocking dependencies', () => {
    const runId = '11111111-1111-4111-8111-111111111111';
    const taskA = buildTask(runId, {
      taskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      status: 'accepted',
      title: 'A',
    });
    const taskB = buildTask(runId, {
      taskId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      status: 'drafted',
      title: 'B',
    });
    const taskC = buildTask(runId, {
      taskId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      status: 'drafted',
      title: 'C',
    });
    const scheduler = new TaskSchedulerService();

    const plan = scheduler.computePlan({
      runId,
      stage: 'task_execution',
      graph: {
        runId,
        tasks: [taskA, taskB, taskC],
        edges: [
          {
            fromTaskId: taskA.taskId,
            toTaskId: taskB.taskId,
            kind: 'blocks',
          },
          {
            fromTaskId: taskB.taskId,
            toTaskId: taskC.taskId,
            kind: 'blocks',
          },
        ],
        registeredAt: '2026-04-02T15:05:00.000Z',
      },
      tasks: [taskA, taskB, taskC],
      jobs: [],
    });

    expect(plan.runnableTasks.map((task) => task.taskId)).toEqual([taskB.taskId]);
    expect(plan.runtimeState.blockedTaskIds).toEqual([taskC.taskId]);
  });

  it('queues release review only after every task is accepted', () => {
    const runId = '22222222-2222-4222-8222-222222222222';
    const taskA = buildTask(runId, {
      taskId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      status: 'accepted',
    });
    const taskB = buildTask(runId, {
      taskId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      status: 'accepted',
    });
    const scheduler = new TaskSchedulerService();

    const plan = scheduler.computePlan({
      runId,
      stage: 'release_review',
      graph: {
        runId,
        tasks: [taskA, taskB],
        edges: [],
        registeredAt: '2026-04-02T15:05:00.000Z',
      },
      tasks: [taskA, taskB],
      jobs: [],
    });

    expect(plan.shouldQueueReleaseReview).toBe(true);
    expect(plan.runtimeState.status).toBe('release_pending');
  });
});
