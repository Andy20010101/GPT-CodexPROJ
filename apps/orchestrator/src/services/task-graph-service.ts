import { TaskEnvelopeSchema, TaskGraphSchema, type TaskGraph } from '../contracts';
import { assertRunStageTransition } from '../domain/stage';
import type { RunRecord } from '../domain/run';
import { OrchestratorError } from '../utils/error';
import { FileRunRepository } from '../storage/file-run-repository';
import { FileTaskRepository } from '../storage/file-task-repository';
import { EvidenceLedgerService } from './evidence-ledger-service';

export class TaskGraphService {
  public constructor(
    private readonly runRepository: FileRunRepository,
    private readonly taskRepository: FileTaskRepository,
    private readonly evidenceLedgerService: EvidenceLedgerService,
  ) {}

  public async registerTaskGraph(runId: string, graph: TaskGraph): Promise<RunRecord> {
    const parsedGraph = TaskGraphSchema.parse(graph);
    const run = await this.runRepository.getRun(runId);
    const architectureFreeze = await this.runRepository.getArchitectureFreeze(runId);
    if (!architectureFreeze) {
      throw new OrchestratorError(
        'ARCHITECTURE_FREEZE_REQUIRED',
        'Architecture freeze must exist before registering a task graph',
        { runId },
      );
    }

    assertRunStageTransition(run.stage, 'foundation_ready');
    const taskGraphPath = await this.taskRepository.saveTaskGraph(parsedGraph);

    for (const task of parsedGraph.tasks) {
      await this.taskRepository.saveTask(TaskEnvelopeSchema.parse(task));
    }

    await this.evidenceLedgerService.appendEvidence({
      runId,
      stage: 'foundation_ready',
      kind: 'task_graph',
      timestamp: parsedGraph.registeredAt,
      producer: 'task-graph-service',
      artifactPaths: [taskGraphPath],
      summary: `Registered ${parsedGraph.tasks.length} task envelopes`,
      metadata: {
        tasks: parsedGraph.tasks.length,
        edges: parsedGraph.edges.length,
      },
    });

    const updatedRun: RunRecord = {
      ...run,
      stage: 'foundation_ready',
      updatedAt: parsedGraph.registeredAt,
      taskGraphPath,
    };
    await this.runRepository.saveRun(updatedRun);
    return updatedRun;
  }
}
