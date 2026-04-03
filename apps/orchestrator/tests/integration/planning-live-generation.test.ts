import { describe, expect, it } from 'vitest';

import { buildServer } from '../../src/api/server';
import { createOrchestratorRuntimeBundle } from '../../src';
import {
  createArtifactDir,
  createBridgeClient,
  createCodexRunnerSequence,
  FakeWorktreeService,
} from '../helpers/runtime-fixtures';

const RAW_PROMPT = 'Live planning proof prompt';

describe('planning live generation integration', { timeout: 20_000 }, () => {
  it('runs requirement, architecture, and task graph through request/finalize/apply', async () => {
    const artifactDir = await createArtifactDir('planning-api-');
    const app = buildServer({
      runtimeBundle: createOrchestratorRuntimeBundle({
        artifactDir,
        bridgeClient: createBridgeClient(),
        codexRunner: createCodexRunnerSequence([
          {
            status: 'succeeded',
            summary: 'Codex planning proof execution completed.',
            stdout: 'done',
            stderr: '',
            exitCode: 0,
            patch: 'diff --git a/tmp/file.ts b/tmp/file.ts\n+change\n',
            testResults: [
              {
                suite: 'vitest',
                status: 'passed',
                passed: 1,
                failed: 0,
                skipped: 0,
              },
            ],
            metadata: {},
          },
        ]),
        worktreeService: new FakeWorktreeService(),
      }),
    });

    const createRunResponse = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: {
        title: 'Planning API run',
        createdBy: 'tester',
        summary: RAW_PROMPT,
      },
    });
    const runId = (createRunResponse.json() as { data: { runId: string } }).data.runId;

    const requirementRequest = await app.inject({
      method: 'POST',
      url: `/api/runs/${runId}/requirement-request`,
      payload: {
        prompt: RAW_PROMPT,
      },
    });
    expect(requirementRequest.statusCode).toBe(200);
    expect(
      (requirementRequest.json() as { data: { requestRuntimeState: { conversationId?: string } } }).data
        .requestRuntimeState.conversationId,
    ).toBeTruthy();

    const requirementFinalize = await app.inject({
      method: 'POST',
      url: `/api/runs/${runId}/requirement-finalize`,
      payload: {},
    });
    expect((requirementFinalize.json() as { data: { status: string } }).data.status).toBe(
      'completed',
    );

    const requirementApply = await app.inject({
      method: 'POST',
      url: `/api/runs/${runId}/requirement-apply`,
      payload: {},
    });
    expect((requirementApply.json() as { data: { run: { stage: string } } }).data.run.stage).toBe(
      'requirement_frozen',
    );

    const architectureRequest = await app.inject({
      method: 'POST',
      url: `/api/runs/${runId}/architecture-request`,
      payload: {},
    });
    expect(architectureRequest.statusCode).toBe(200);

    const architectureFinalize = await app.inject({
      method: 'POST',
      url: `/api/runs/${runId}/architecture-finalize`,
      payload: {},
    });
    expect((architectureFinalize.json() as { data: { status: string } }).data.status).toBe(
      'completed',
    );

    const architectureApply = await app.inject({
      method: 'POST',
      url: `/api/runs/${runId}/architecture-apply`,
      payload: {},
    });
    expect((architectureApply.json() as { data: { run: { stage: string } } }).data.run.stage).toBe(
      'architecture_frozen',
    );

    const taskGraphRequest = await app.inject({
      method: 'POST',
      url: `/api/runs/${runId}/task-graph-request`,
      payload: {},
    });
    expect(taskGraphRequest.statusCode).toBe(200);

    const taskGraphFinalize = await app.inject({
      method: 'POST',
      url: `/api/runs/${runId}/task-graph-finalize`,
      payload: {},
    });
    expect((taskGraphFinalize.json() as { data: { status: string } }).data.status).toBe(
      'completed',
    );

    const taskGraphApply = await app.inject({
      method: 'POST',
      url: `/api/runs/${runId}/task-graph-apply`,
      payload: {
        normalization: {
          defaultExecutorType: 'codex',
          defaultAllowedFiles: ['tmp/e2e-targets/user-api-validation-1/**'],
          defaultDisallowedFiles: ['apps/**', 'services/**', 'packages/**'],
          defaultOutOfScope: ['apps/**', 'services/**', 'packages/**'],
          sequentialDependencies: true,
        },
      },
    });
    const taskGraphApplyBody = taskGraphApply.json() as {
      data: { applied: boolean; decision: { status: string }; run: { stage: string } };
    };
    expect(taskGraphApplyBody.data.applied).toBe(true);
    expect(taskGraphApplyBody.data.decision.status).toBe('passed');
    expect(taskGraphApplyBody.data.run.stage).toBe('foundation_ready');

    await app.close();
  });

  it('recovers planning finalization through the sweeper using the same conversation', async () => {
    const artifactDir = await createArtifactDir('planning-sweeper-');
    let waitCalls = 0;
    let recoverCalls = 0;
    const baseBridgeClient = createBridgeClient();
    const bridgeClient = {
      ...baseBridgeClient,
      async waitForCompletion(conversationId: string, input: { maxWaitMs?: number }) {
        waitCalls += 1;
        if (waitCalls === 1) {
          throw new Error(`still running after ${input.maxWaitMs ?? 0}ms`);
        }
        return baseBridgeClient.waitForCompletion(conversationId, input);
      },
      async recoverConversation(conversationId: string) {
        recoverCalls += 1;
        if (recoverCalls === 1) {
          return {
            snapshot: {
              conversationId,
              sessionId: '2d79c3de-4375-47ea-a823-c724c9a774a2',
              projectName: 'Planning Proof',
              model: 'pro',
              status: 'running' as const,
              source: 'memory' as const,
              messages: [],
              startedAt: '2026-04-03T00:00:00.000Z',
              updatedAt: '2026-04-03T00:00:10.000Z',
            },
            health: {
              status: 'ready' as const,
              checkedAt: '2026-04-03T00:00:10.000Z',
              activeSessions: 1,
              activeConversations: 1,
              issues: [],
              metadata: {},
            },
          };
        }
        return baseBridgeClient.recoverConversation(conversationId, {});
      },
    };
    const app = buildServer({
      runtimeBundle: createOrchestratorRuntimeBundle({
        artifactDir,
        bridgeClient,
        worktreeService: new FakeWorktreeService(),
      }),
    });

    const createRunResponse = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: {
        title: 'Planning sweeper run',
        createdBy: 'tester',
        summary: RAW_PROMPT,
      },
    });
    const runId = (createRunResponse.json() as { data: { runId: string } }).data.runId;

    await app.inject({
      method: 'POST',
      url: `/api/runs/${runId}/requirement-request`,
      payload: {
        prompt: RAW_PROMPT,
      },
    });

    const firstFinalize = await app.inject({
      method: 'POST',
      url: `/api/runs/${runId}/requirement-finalize`,
      payload: {},
    });
    expect((firstFinalize.json() as { data: { status: string } }).data.status).toBe('pending');

    const pendingBefore = await app.inject({
      method: 'GET',
      url: '/api/runtime/planning-finalize-pending',
    });
    expect(
      (pendingBefore.json() as { data: { entries: Array<{ runId: string }> } }).data.entries.some(
        (entry) => entry.runId === runId,
      ),
    ).toBe(true);

    const sweeperResponse = await app.inject({
      method: 'POST',
      url: '/api/runtime/planning-finalize-sweeper/run',
      payload: {
        requestedBy: 'tester',
      },
    });
    expect(
      (sweeperResponse.json() as { data: { summary: { recoveredCount: number } } }).data.summary
        .recoveredCount,
    ).toBeGreaterThanOrEqual(1);

    const secondFinalize = await app.inject({
      method: 'POST',
      url: `/api/runs/${runId}/requirement-finalize`,
      payload: {},
    });
    expect((secondFinalize.json() as { data: { status: string } }).data.status).toBe('completed');

    await app.close();
  });

  it('proves fresh live planning through the first accepted task and downstream unlock', async () => {
    const artifactDir = await createArtifactDir('planning-proof-');
    const bundle = createOrchestratorRuntimeBundle({
      artifactDir,
      bridgeClient: createBridgeClient(),
      codexRunner: createCodexRunnerSequence([
        {
          status: 'succeeded',
          summary: 'Codex planning proof execution completed.',
          stdout: 'done',
          stderr: '',
          exitCode: 0,
          patch:
            'diff --git a/tmp/e2e-targets/user-api-validation-1/src/user-service.ts b/tmp/e2e-targets/user-api-validation-1/src/user-service.ts\n+change\n',
          testResults: [
            {
              suite: 'vitest',
              status: 'passed',
              passed: 1,
              failed: 0,
              skipped: 0,
            },
          ],
          metadata: {},
        },
      ]),
      worktreeService: new FakeWorktreeService(),
    });

    const report = await bundle.planningValidationService.validate({
      createdBy: 'tester',
      mode: 'mock_assisted',
      prompt: RAW_PROMPT,
    });

    expect(report.firstTaskAccepted).toBe(true);
    expect(report.firstTaskReviewId).toBeTruthy();
    expect(report.downstreamUnlockedTaskIds.length).toBeGreaterThan(0);
  });
});
