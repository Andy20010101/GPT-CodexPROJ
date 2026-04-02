import type { FastifyInstance } from 'fastify';

import type { OrchestratorRuntimeBundle } from '../../index';
import { RunPathParamsSchema, TaskListResponseSchema } from '../schemas/run-api';
import {
  QueueTaskRequestSchema,
  QueueTaskResponseSchema,
  TaskPathParamsSchema,
} from '../schemas/task-api';

export function registerTaskRoutes(app: FastifyInstance, bundle: OrchestratorRuntimeBundle): void {
  app.get('/api/runs/:runId/tasks', async (request) => {
    const params = RunPathParamsSchema.parse(request.params);
    const data = await bundle.orchestratorService.listTasks(params.runId);
    return TaskListResponseSchema.parse({ ok: true, data });
  });

  app.post('/api/tasks/:taskId/queue', async (request) => {
    const params = TaskPathParamsSchema.parse(request.params);
    const body = QueueTaskRequestSchema.parse(request.body ?? {});
    const data = await bundle.workflowRuntimeService.queueTask({
      taskId: params.taskId,
      ...(body.command ? { command: body.command } : {}),
      ...(body.retryPolicy ? { retryPolicy: body.retryPolicy } : {}),
      metadata: body.metadata,
      runWorker: body.runWorker,
    });
    return QueueTaskResponseSchema.parse({ ok: true, data });
  });
}
