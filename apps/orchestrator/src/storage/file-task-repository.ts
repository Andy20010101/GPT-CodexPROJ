import path from 'node:path';

import {
  TaskEnvelopeSchema,
  TaskGraphSchema,
  type TaskEnvelope,
  type TaskGraph,
} from '../contracts';
import { OrchestratorError } from '../utils/error';
import {
  ensureDirectory,
  readJsonFile,
  readJsonFilesInDirectory,
  writeJsonFile,
} from '../utils/file-store';
import { getRunsRoot, getRunRoot } from '../utils/run-paths';

export class FileTaskRepository {
  public constructor(private readonly artifactDir: string) {}

  public async saveTaskGraph(graph: TaskGraph): Promise<string> {
    const outputPath = path.join(getRunRoot(this.artifactDir, graph.runId), 'task-graph.json');
    await writeJsonFile(outputPath, TaskGraphSchema.parse(graph));
    return outputPath;
  }

  public async getTaskGraph(runId: string): Promise<TaskGraph | null> {
    const outputPath = path.join(getRunRoot(this.artifactDir, runId), 'task-graph.json');
    const raw = await readJsonFile<TaskGraph>(outputPath);
    return raw ? TaskGraphSchema.parse(raw) : null;
  }

  public async saveTask(task: TaskEnvelope): Promise<string> {
    const outputPath = this.getTaskFile(task.runId, task.taskId);
    await writeJsonFile(outputPath, TaskEnvelopeSchema.parse(task));
    return outputPath;
  }

  public async getTask(runId: string, taskId: string): Promise<TaskEnvelope> {
    const outputPath = this.getTaskFile(runId, taskId);
    const raw = await readJsonFile<TaskEnvelope>(outputPath);
    if (!raw) {
      throw new OrchestratorError('TASK_NOT_FOUND', `Task ${taskId} was not found`, {
        runId,
        taskId,
      });
    }

    return TaskEnvelopeSchema.parse(raw);
  }

  public async listTasks(runId: string): Promise<TaskEnvelope[]> {
    const directoryPath = path.join(getRunRoot(this.artifactDir, runId), 'tasks');
    const raw = await readJsonFilesInDirectory<TaskEnvelope>(directoryPath);
    return raw.map((value) => TaskEnvelopeSchema.parse(value));
  }

  public async findTask(taskId: string): Promise<TaskEnvelope | null> {
    const runsRoot = getRunsRoot(this.artifactDir);
    await ensureDirectory(runsRoot);
    const runEntries = await pathScopedDirectoryEntries(runsRoot);
    for (const runEntry of runEntries) {
      const outputPath = path.join(runEntry, 'tasks', `${taskId}.json`);
      const raw = await readJsonFile<TaskEnvelope>(outputPath);
      if (raw) {
        return TaskEnvelopeSchema.parse(raw);
      }
    }

    return null;
  }

  private getTaskFile(runId: string, taskId: string): string {
    return path.join(getRunRoot(this.artifactDir, runId), 'tasks', `${taskId}.json`);
  }
}

async function pathScopedDirectoryEntries(root: string): Promise<string[]> {
  const fs = await import('node:fs/promises');
  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .sort((left, right) => left.localeCompare(right));
}
