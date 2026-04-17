import { describe, expect, it } from 'vitest';

type BuildSelfImprovementOperatorPlan = (input: Record<string, unknown>) => {
  existingRunResume: {
    resumeRecommended: boolean;
    prepareOnlyCommand: string | null;
    resumeCommand: string | null;
  };
  watcher: {
    restartCommand: string;
  };
  reviewRetry: {
    retryableJobs: Array<Record<string, unknown>>;
    manualAttentionJobs: Array<Record<string, unknown>>;
  };
  daemon: {
    resumeRecommended: boolean;
    resumeCommand: string;
  };
};

const { buildSelfImprovementOperatorPlan } = require('../../../../scripts/self-improvement-recovery-shared.mjs') as {
  buildSelfImprovementOperatorPlan: BuildSelfImprovementOperatorPlan;
};

const artifactDir = '/tmp/real-self-improvement/artifacts';
const runId = '11111111-1111-4111-8111-111111111111';
const baseUrl = 'http://127.0.0.1:3200';

function buildEnvState() {
  return {
    overallStatus: 'ready',
    orchestrator: {
      baseUrl,
    },
    bridge: {
      baseUrl: 'http://127.0.0.1:3115',
    },
    browser: {
      endpoint: 'http://172.18.144.1:9224',
      startupUrl: 'https://chatgpt.com/',
    },
  };
}

describe('buildSelfImprovementOperatorPlan', () => {
  it('surfaces prepare-only and --run-id resume commands when planning is incomplete', () => {
    const plan = buildSelfImprovementOperatorPlan({
      artifactDir,
      baseUrl,
      runId,
      run: {
        runId,
        stage: 'intake',
      },
      runtimeState: {
        queuedJobs: 0,
        retriableJobs: 0,
      },
      summary: {
        taskGraphRegistered: false,
      },
      envState: buildEnvState(),
      jobs: [],
      daemonStatus: null,
    });

    expect(plan.existingRunResume.resumeRecommended).toBe(true);
    expect(plan.existingRunResume.prepareOnlyCommand).toContain('--prepare-only');
    expect(plan.existingRunResume.resumeCommand).toContain(`--run-id '${runId}'`);
    expect(plan.watcher.restartCommand).toContain(`--artifact-dir '${artifactDir}'`);
  });

  it('surfaces retry commands for failed task_review_request jobs that still have attempts left', () => {
    const plan = buildSelfImprovementOperatorPlan({
      artifactDir,
      baseUrl,
      runId,
      run: {
        runId,
        stage: 'task_execution',
        taskGraphPath: `${artifactDir}/runs/${runId}/task-graph.json`,
      },
      runtimeState: {
        queuedJobs: 0,
        retriableJobs: 0,
      },
      summary: {
        taskGraphRegistered: true,
      },
      envState: buildEnvState(),
      jobs: [
        {
          jobId: '22222222-2222-4222-8222-222222222222',
          runId,
          taskId: '33333333-3333-4333-8333-333333333333',
          kind: 'task_review_request',
          status: 'failed',
          attempt: 1,
          maxAttempts: 2,
          priority: 'high',
          createdAt: '2026-04-13T09:00:00.000Z',
          finishedAt: '2026-04-13T09:10:00.000Z',
          metadata: {
            executionId: '44444444-4444-4444-8444-444444444444',
            reviewId: '55555555-5555-4555-8555-555555555555',
          },
          lastError: {
            code: 'WORKER_JOB_FAILED',
            message: 'bridge fetch failed',
          },
        },
      ],
      daemonStatus: null,
    });

    expect(plan.reviewRetry.retryableJobs).toHaveLength(1);
    expect(plan.reviewRetry.retryableJobs[0]).toMatchObject({
      jobId: '22222222-2222-4222-8222-222222222222',
      kind: 'task_review_request',
      retrySupported: true,
      reviewRuntimeStatePath: `${artifactDir}/runs/${runId}/reviews/55555555-5555-4555-8555-555555555555/runtime-state.json`,
    });
    expect(plan.reviewRetry.retryableJobs[0]?.retryCommand).toContain('/api/jobs/22222222-2222-4222-8222-222222222222/retry');
  });

  it('keeps manual-attention review jobs out of the retry list and recommends daemon resume when needed', () => {
    const plan = buildSelfImprovementOperatorPlan({
      artifactDir,
      baseUrl,
      runId,
      run: {
        runId,
        stage: 'task_execution',
        taskGraphPath: `${artifactDir}/runs/${runId}/task-graph.json`,
      },
      runtimeState: {
        queuedJobs: 1,
        retriableJobs: 1,
      },
      summary: {
        taskGraphRegistered: true,
      },
      envState: buildEnvState(),
      jobs: [
        {
          jobId: '66666666-6666-4666-8666-666666666666',
          runId,
          taskId: '77777777-7777-4777-8777-777777777777',
          kind: 'task_review_request',
          status: 'manual_attention_required',
          attempt: 1,
          maxAttempts: 2,
          priority: 'high',
          createdAt: '2026-04-13T10:00:00.000Z',
          finishedAt: '2026-04-13T10:10:00.000Z',
          metadata: {
            executionId: '88888888-8888-4888-8888-888888888888',
          },
          lastError: {
            code: 'WORKER_JOB_FAILED',
            message: 'browser endpoint fetch failed',
          },
        },
      ],
      daemonStatus: {
        daemonState: {
          daemonId: '99999999-9999-4999-8999-999999999999',
          state: 'paused',
        },
      },
    });

    expect(plan.reviewRetry.retryableJobs).toHaveLength(0);
    expect(plan.reviewRetry.manualAttentionJobs).toHaveLength(1);
    expect(plan.reviewRetry.manualAttentionJobs[0]?.retrySupported).toBe(false);
    expect(plan.daemon.resumeRecommended).toBe(true);
    expect(plan.daemon.resumeCommand).toContain('/api/daemon/resume');
  });
});
