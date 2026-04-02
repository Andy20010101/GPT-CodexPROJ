import { describe, expect, it } from 'vitest';

import {
  buildTask,
  bootstrapRuntimeBundle,
  createArtifactDir,
  createBridgeClient,
  createCodexRunnerSequence,
} from '../helpers/runtime-fixtures';

describe('multi-task runtime flow', () => {
  it(
    'unlocks dependent tasks and auto-runs release review when predecessors are accepted',
    {
      timeout: 20000,
    },
    async () => {
      const artifactDir = await createArtifactDir('multi-task-run-');
      const taskA = buildTask('00000000-0000-4000-8000-000000000001', {
        taskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        title: 'A',
      });
      const taskB = buildTask('00000000-0000-4000-8000-000000000001', {
        taskId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        title: 'B',
      });
      const taskC = buildTask('00000000-0000-4000-8000-000000000001', {
        taskId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        title: 'C',
      });
      const { bundle, runId } = await bootstrapRuntimeBundle({
        artifactDir,
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
        bridgeClient: createBridgeClient(),
        codexRunner: createCodexRunnerSequence([
          {
            status: 'succeeded',
            summary: 'task A complete',
            stdout: '',
            stderr: '',
            exitCode: 0,
            patch: 'diff --git a/a.ts b/a.ts\n+task a\n',
            testResults: [{ suite: 'vitest', status: 'passed', passed: 1, failed: 0, skipped: 0 }],
            metadata: {},
          },
          {
            status: 'succeeded',
            summary: 'task B complete',
            stdout: '',
            stderr: '',
            exitCode: 0,
            patch: 'diff --git a/b.ts b/b.ts\n+task b\n',
            testResults: [{ suite: 'vitest', status: 'passed', passed: 1, failed: 0, skipped: 0 }],
            metadata: {},
          },
          {
            status: 'succeeded',
            summary: 'task C complete',
            stdout: '',
            stderr: '',
            exitCode: 0,
            patch: 'diff --git a/c.ts b/c.ts\n+task c\n',
            testResults: [{ suite: 'vitest', status: 'passed', passed: 1, failed: 0, skipped: 0 }],
            metadata: {},
          },
        ]),
      });

      const firstState = await bundle.workflowRuntimeService.enqueueRunnableTasks(runId);
      expect(firstState.queuedJobs).toBeGreaterThanOrEqual(1);
      expect(firstState.acceptedTaskIds).toEqual([]);

      const drained = await bundle.workflowRuntimeService.drainRun(runId);
      const run = await bundle.orchestratorService.getRun(runId);
      const tasks = await bundle.orchestratorService.listTasks(runId);
      const evidence = await bundle.orchestratorService.summarizeRunEvidence(runId);

      expect(drained.processedJobs).toBeGreaterThanOrEqual(4);
      expect(run.stage).toBe('accepted');
      expect(tasks.every((task) => task.status === 'accepted')).toBe(true);
      expect(evidence.byKind.release_review_result).toBe(1);
      expect(evidence.byKind.run_acceptance).toBe(1);
    },
  );

  it(
    'keeps the run in release_review when release review requests changes',
    {
      timeout: 10000,
    },
    async () => {
      const artifactDir = await createArtifactDir('multi-task-run-release-fail-');
      const task = buildTask('00000000-0000-4000-8000-000000000002');
      const { bundle, runId } = await bootstrapRuntimeBundle({
        artifactDir,
        tasks: [task],
        bridgeClient: createBridgeClient({
          releaseReviewPayload: {
            status: 'changes_requested',
            summary: 'Release review found unresolved issues.',
            findings: ['Need another acceptance note.'],
            outstandingLimitations: ['Release review is not satisfied.'],
            recommendedActions: ['Return to release review after remediation.'],
          },
        }),
      });

      await bundle.workflowRuntimeService.drainRun(runId);

      const run = await bundle.orchestratorService.getRun(runId);
      expect(run.stage).toBe('release_review');
      await expect(
        bundle.runAcceptanceService.acceptRun({
          runId,
          acceptedBy: 'tester',
        }),
      ).rejects.toMatchObject({
        code: 'RUN_ACCEPTANCE_BLOCKED',
      });
    },
  );
});
