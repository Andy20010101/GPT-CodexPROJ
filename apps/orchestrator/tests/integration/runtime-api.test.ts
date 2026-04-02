/* eslint-disable @typescript-eslint/require-await */
import { describe, expect, it } from 'vitest';

import { buildServer } from '../../src/api/server';
import {
  buildArchitectureFreeze,
  buildRequirementFreeze,
  buildTask,
  createArtifactDir,
} from '../helpers/runtime-fixtures';

describe('runtime api integration', () => {
  it('creates a run, freezes it, registers a task graph, queues a task, and queries the job', async () => {
    const artifactDir = await createArtifactDir('runtime-api-');
    const app = buildServer({
      artifactDir,
    });

    const createRunResponse = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: {
        title: 'API run',
        createdBy: 'tester',
      },
    });
    const createRunBody: {
      ok: true;
      data: { runId: string };
    } = createRunResponse.json();
    expect(createRunResponse.statusCode).toBe(200);

    const runId = createRunBody.data.runId;
    await app.inject({
      method: 'POST',
      url: `/api/runs/${runId}/requirement-freeze`,
      payload: buildRequirementFreeze(runId),
    });
    await app.inject({
      method: 'POST',
      url: `/api/runs/${runId}/architecture-freeze`,
      payload: buildArchitectureFreeze(runId),
    });
    const task = buildTask(runId);
    await app.inject({
      method: 'POST',
      url: `/api/runs/${runId}/task-graph`,
      payload: {
        runId,
        tasks: [task],
        edges: [],
        registeredAt: '2026-04-02T15:20:00.000Z',
      },
    });

    const tasksResponse = await app.inject({
      method: 'GET',
      url: `/api/runs/${runId}/tasks`,
    });
    const tasksBody: {
      ok: true;
      data: Array<{ taskId: string }>;
    } = tasksResponse.json();
    expect(tasksBody.data).toHaveLength(1);

    const queueResponse = await app.inject({
      method: 'POST',
      url: `/api/tasks/${task.taskId}/queue`,
      payload: {},
    });
    const queueBody: {
      ok: true;
      data: { job: { jobId: string; status: string } };
    } = queueResponse.json();
    expect(queueBody.data.job.status).toBe('queued');

    const jobResponse = await app.inject({
      method: 'GET',
      url: `/api/jobs/${queueBody.data.job.jobId}`,
    });
    const jobBody: {
      ok: true;
      data: { jobId: string; kind: string };
    } = jobResponse.json();
    expect(jobBody.data.kind).toBe('task_execution');

    await app.close();
  });
});
