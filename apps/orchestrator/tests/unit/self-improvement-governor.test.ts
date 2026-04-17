import { describe, expect, it } from 'vitest';

import {
  SelfImprovementCampaignStateSchema,
  SelfImprovementRunGoalSchema,
} from '../../src/contracts';
import {
  classifySelfImprovementRun,
  selectNextOrderedTodo,
} from '../../../../scripts/self-improvement-governor-shared.mjs';

describe('SelfImprovementGovernor contracts', () => {
  it('accepts a persisted run-goal payload', () => {
    const parsed = SelfImprovementRunGoalSchema.parse({
      version: 1,
      runId: '11111111-1111-4111-8111-111111111111',
      selectedAt: '2026-04-13T09:00:00.000Z',
      profileId: 'bounded-governor-v1',
      goal: {
        todoId: '11',
        title: 'Add a run-to-run governor for bounded self-improvement campaigns.',
        section: 'Ordered Execution Queue',
        autoRunnable: true,
      },
      allowedFiles: ['scripts/run-real-self-improvement.ts'],
      disallowedFiles: ['services/**'],
    });

    expect(parsed.goal.todoId).toBe('11');
    expect(parsed.allowedFiles).toHaveLength(1);
  });

  it('accepts a campaign state with one completed iteration', () => {
    const parsed = SelfImprovementCampaignStateSchema.parse({
      version: 1,
      campaignId: 'bounded-self-improvement',
      createdAt: '2026-04-13T09:00:00.000Z',
      updatedAt: '2026-04-13T11:00:00.000Z',
      iterationCap: 2,
      iterationsStarted: 1,
      iterationsCompleted: 1,
      history: [
        {
          iteration: 1,
          runId: '11111111-1111-4111-8111-111111111111',
          goal: {
            todoId: '11',
            title: 'Add a run-to-run governor for bounded self-improvement campaigns.',
            section: 'Ordered Execution Queue',
            autoRunnable: true,
          },
          startedAt: '2026-04-13T09:00:00.000Z',
          completedAt: '2026-04-13T11:00:00.000Z',
          terminalState: {
            version: 1,
            runId: '11111111-1111-4111-8111-111111111111',
            classifiedAt: '2026-04-13T11:00:00.000Z',
            terminal: true,
            outcome: 'accepted',
            reason: 'Run reached accepted stage and persisted run-acceptance evidence.',
            runStage: 'accepted',
            runtimeStatus: 'accepted',
            taskGraphRegistered: true,
            totalTasks: 3,
            acceptedTasks: 3,
            runnableTasks: 0,
            blockedTasks: 0,
            queuedJobs: 0,
            runningJobs: 0,
            retriableJobs: 0,
            failedJobs: 0,
            blockedJobs: 0,
            hasRunAcceptance: true,
          },
        },
      ],
      lastTerminalState: {
        version: 1,
        runId: '11111111-1111-4111-8111-111111111111',
        classifiedAt: '2026-04-13T11:00:00.000Z',
        terminal: true,
        outcome: 'accepted',
        reason: 'Run reached accepted stage and persisted run-acceptance evidence.',
        runStage: 'accepted',
        runtimeStatus: 'accepted',
        taskGraphRegistered: true,
        totalTasks: 3,
        acceptedTasks: 3,
        runnableTasks: 0,
        blockedTasks: 0,
        queuedJobs: 0,
        runningJobs: 0,
        retriableJobs: 0,
        failedJobs: 0,
        blockedJobs: 0,
        hasRunAcceptance: true,
      },
    });

    expect(parsed.history[0]?.terminalState?.outcome).toBe('accepted');
    expect(parsed.iterationsCompleted).toBe(1);
  });
});

describe('classifySelfImprovementRun', () => {
  it('treats authoritative accepted state plus run-acceptance evidence as terminal', () => {
    const classified = classifySelfImprovementRun({
      run: {
        runId: '11111111-1111-4111-8111-111111111111',
        stage: 'release_review',
      },
      authoritativeRun: {
        runId: '11111111-1111-4111-8111-111111111111',
        stage: 'accepted',
        taskGraphPath: '/tmp/task-graph.json',
      },
      runtimeState: {
        status: 'accepted',
        queuedJobs: 0,
        runningJobs: 0,
        retriableJobs: 0,
        failedJobs: 0,
        blockedJobs: 0,
        runnableTaskIds: [],
        blockedTaskIds: [],
      },
      summary: {
        taskGraphRegistered: true,
      },
      tasks: [{ status: 'accepted' }, { status: 'accepted' }, { status: 'accepted' }],
      hasRunAcceptance: true,
      classifiedAt: '2026-04-13T11:00:00.000Z',
    });

    expect(classified.terminal).toBe(true);
    expect(classified.outcome).toBe('accepted');
  });

  it('keeps an intake run with no task graph as non-terminal', () => {
    const classified = classifySelfImprovementRun({
      run: {
        runId: '11111111-1111-4111-8111-111111111111',
        stage: 'intake',
      },
      runtimeState: {
        status: 'idle',
        queuedJobs: 0,
        runningJobs: 0,
        retriableJobs: 0,
        failedJobs: 0,
        blockedJobs: 0,
        runnableTaskIds: [],
        blockedTaskIds: [],
      },
      summary: {
        taskGraphRegistered: false,
      },
      tasks: [],
      hasRunAcceptance: false,
      classifiedAt: '2026-04-13T11:00:00.000Z',
    });

    expect(classified.terminal).toBe(false);
    expect(classified.outcome).toBe('non_terminal');
  });

  it('treats a stalled task-execution run with failed jobs as manual attention terminal', () => {
    const classified = classifySelfImprovementRun({
      run: {
        runId: '11111111-1111-4111-8111-111111111111',
        stage: 'task_execution',
        taskGraphPath: '/tmp/task-graph.json',
      },
      runtimeState: {
        status: 'idle',
        queuedJobs: 0,
        runningJobs: 0,
        retriableJobs: 0,
        failedJobs: 2,
        blockedJobs: 1,
        runnableTaskIds: [],
        blockedTaskIds: ['22222222-2222-4222-8222-222222222222'],
      },
      summary: {
        taskGraphRegistered: true,
      },
      tasks: [{ status: 'accepted' }, { status: 'implementation_in_progress' }],
      hasRunAcceptance: false,
      classifiedAt: '2026-04-13T11:00:00.000Z',
    });

    expect(classified.terminal).toBe(true);
    expect(classified.outcome).toBe('manual_attention_required');
  });
});

describe('selectNextOrderedTodo', () => {
  it('selects exactly one next unchecked item from the ordered execution queue', () => {
    const selected = selectNextOrderedTodo(`# Project Todo

## Ordered Execution Queue

- [x] 10. Finish docs.
- [ ] 11. Add a run-to-run governor for bounded self-improvement campaigns.
- [ ] 12. Clean artifact hygiene and .gitignore.

## Reliability And Operator Workflow

- [ ] Improve run interruption and resume ergonomics.
`);

    expect(selected).toEqual({
      todoId: '11',
      title: 'Add a run-to-run governor for bounded self-improvement campaigns.',
      section: 'Ordered Execution Queue',
      autoRunnable: true,
    });
  });

  it('returns null when the ordered execution queue has no remaining unchecked item', () => {
    const selected = selectNextOrderedTodo(`# Project Todo

## Ordered Execution Queue

- [x] 11. Add a run-to-run governor for bounded self-improvement campaigns.

## Reliability And Operator Workflow

- [ ] Improve run interruption and resume ergonomics.
`);

    expect(selected).toBeNull();
  });

  it('skips todo ids that are already present in campaign history', () => {
    const selected = selectNextOrderedTodo(
      `# Project Todo

## Ordered Execution Queue

- [ ] 11. Add a run-to-run governor for bounded self-improvement campaigns.
- [ ] 12. Clean artifact hygiene and .gitignore.
`,
      {
        excludeTodoIds: ['11'],
      },
    );

    expect(selected).toEqual({
      todoId: '12',
      title: 'Clean artifact hygiene and .gitignore.',
      section: 'Ordered Execution Queue',
      autoRunnable: false,
    });
  });
});
