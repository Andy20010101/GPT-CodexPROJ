import type {
  ConcurrencyPolicy,
  DaemonState,
  HeartbeatRecord,
  JobRecord,
  RuntimeMetrics,
  WorkerLease,
  WorkerRecord,
} from '../contracts';
import { RuntimeMetricsSchema } from '../contracts';
import { isLeaseExpired } from './lease-expiry';

export function buildRuntimeMetrics(input: {
  daemonState: DaemonState;
  workers: readonly WorkerRecord[];
  jobs: readonly JobRecord[];
  heartbeats: readonly HeartbeatRecord[];
  leases: readonly WorkerLease[];
  concurrencyPolicy: ConcurrencyPolicy;
  now?: Date | undefined;
  recentWindowMs?: number | undefined;
}): RuntimeMetrics {
  const now = input.now ?? new Date();
  const recentWindowMs = input.recentWindowMs ?? 60 * 60 * 1000;
  const recentCutoff = now.getTime() - recentWindowMs;
  const workerCounts = {
    idle: input.workers.filter((worker) => worker.status === 'idle').length,
    polling: input.workers.filter((worker) => worker.status === 'polling').length,
    running: input.workers.filter((worker) => worker.status === 'running').length,
    paused: input.workers.filter((worker) => worker.status === 'paused').length,
    draining: input.workers.filter((worker) => worker.status === 'draining').length,
    stopped: input.workers.filter((worker) => worker.status === 'stopped').length,
  };
  const queueDepth = {
    queued: input.jobs.filter((job) => job.status === 'queued').length,
    runnable: input.jobs.filter(
      (job) =>
        (job.status === 'queued' || job.status === 'retriable') &&
        (!job.availableAt || new Date(job.availableAt).getTime() <= now.getTime()),
    ).length,
    blocked: input.jobs.filter((job) => job.status === 'blocked').length,
    retriable: input.jobs.filter((job) => job.status === 'retriable').length,
    running: input.jobs.filter((job) => job.status === 'running').length,
  };
  const activeRunCount = new Set(
    input.jobs
      .filter(
        (job) => job.status === 'queued' || job.status === 'retriable' || job.status === 'running',
      )
      .map((job) => job.runId),
  ).size;
  const staleJobCount = input.leases.filter((lease) => isLeaseExpired(lease.expiresAt, now)).length;
  const recentFailureCount = input.jobs.filter(
    (job) =>
      job.status === 'failed' &&
      job.finishedAt &&
      new Date(job.finishedAt).getTime() >= recentCutoff,
  ).length;
  const recentRecoveryCount = input.heartbeats.filter(
    (heartbeat) =>
      heartbeat.metadata.recovered === true &&
      new Date(heartbeat.timestamp).getTime() >= recentCutoff,
  ).length;

  return RuntimeMetricsSchema.parse({
    daemonId: input.daemonState.daemonId,
    daemonState: input.daemonState.state,
    workerCounts,
    queueDepth,
    activeRunCount,
    staleJobCount,
    recentFailureCount,
    recentRecoveryCount,
    concurrencyPolicy: input.concurrencyPolicy,
    lastUpdatedAt: now.toISOString(),
  });
}
