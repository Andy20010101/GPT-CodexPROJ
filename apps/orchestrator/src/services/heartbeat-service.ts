import { randomUUID } from 'node:crypto';

import type { HeartbeatRecord, JobRecord, WorkerRecord } from '../contracts';
import { HeartbeatRecordSchema, WorkerRecordSchema } from '../contracts';
import { FileHeartbeatRepository } from '../storage/file-heartbeat-repository';
import { FileWorkerRepository } from '../storage/file-worker-repository';
import { EvidenceLedgerService } from './evidence-ledger-service';
import { FileRunRepository } from '../storage/file-run-repository';

export class HeartbeatService {
  public constructor(
    private readonly runRepository: FileRunRepository,
    private readonly heartbeatRepository: FileHeartbeatRepository,
    private readonly workerRepository: FileWorkerRepository,
    private readonly evidenceLedgerService: EvidenceLedgerService,
    private readonly staleThresholdMs: number,
  ) {}

  public async recordHeartbeat(input: {
    daemonId: string;
    worker: WorkerRecord;
    job?: JobRecord | undefined;
    kind: 'worker' | 'job';
    timestamp?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<HeartbeatRecord> {
    const timestamp = input.timestamp ?? new Date().toISOString();
    const heartbeat = HeartbeatRecordSchema.parse({
      heartbeatId: randomUUID(),
      daemonId: input.daemonId,
      workerId: input.worker.workerId,
      ...(input.job ? { jobId: input.job.jobId, runId: input.job.runId } : {}),
      timestamp,
      kind: input.kind,
      metadata: input.metadata ?? {},
    });
    const worker = WorkerRecordSchema.parse({
      ...input.worker,
      lastHeartbeatAt: timestamp,
    });
    const paths = await this.heartbeatRepository.saveHeartbeat(heartbeat);
    await this.workerRepository.saveWorker(worker, input.job?.runId);

    if (input.job) {
      const run = await this.runRepository.getRun(input.job.runId);
      await this.evidenceLedgerService.appendEvidence({
        runId: input.job.runId,
        ...(input.job.taskId ? { taskId: input.job.taskId } : {}),
        stage: run.stage,
        kind: 'heartbeat',
        timestamp,
        producer: 'heartbeat-service',
        artifactPaths: [paths.globalPath, ...(paths.runPath ? [paths.runPath] : [])],
        summary: `Recorded ${input.kind} heartbeat for worker ${worker.workerId}`,
        metadata: {
          workerId: worker.workerId,
          ...(input.job ? { jobId: input.job.jobId } : {}),
        },
      });
    }

    return heartbeat;
  }

  public async getLatestHeartbeatForJob(jobId: string): Promise<HeartbeatRecord | null> {
    const heartbeats = await this.heartbeatRepository.listHeartbeats();
    return (
      heartbeats
        .filter((heartbeat) => heartbeat.jobId === jobId)
        .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
        .at(-1) ?? null
    );
  }

  public async getLatestHeartbeatForWorker(workerId: string): Promise<HeartbeatRecord | null> {
    const heartbeats = await this.heartbeatRepository.listHeartbeats();
    return (
      heartbeats
        .filter((heartbeat) => heartbeat.workerId === workerId)
        .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
        .at(-1) ?? null
    );
  }

  public isStale(timestamp: string, now: Date = new Date()): boolean {
    return new Date(timestamp).getTime() + this.staleThresholdMs <= now.getTime();
  }

  public getStaleThresholdMs(): number {
    return this.staleThresholdMs;
  }
}
