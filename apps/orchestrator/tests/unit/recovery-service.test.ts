import { describe, expect, it } from 'vitest';

import { createOrchestratorRuntimeBundle } from '../../src';
import {
  buildArchitectureFreeze,
  buildRequirementFreeze,
  createArtifactDir,
} from '../helpers/runtime-fixtures';

describe('RecoveryService', () => {
  it('requeues interrupted running jobs and restores queued jobs into queue state', async () => {
    const artifactDir = await createArtifactDir('recovery-service-');
    const bundle = createOrchestratorRuntimeBundle({
      artifactDir,
      retryPolicy: {
        maxAttempts: 3,
        backoffStrategy: 'fixed',
        baseDelayMs: 0,
      },
    });
    const run = await bundle.orchestratorService.createRun({
      title: 'Recovery run',
      createdBy: 'tester',
    });
    await bundle.orchestratorService.saveRequirementFreeze(
      run.runId,
      buildRequirementFreeze(run.runId),
    );
    await bundle.orchestratorService.saveArchitectureFreeze(
      run.runId,
      buildArchitectureFreeze(run.runId),
    );

    const runningJob = await bundle.runQueueService.enqueueJob({
      runId: run.runId,
      kind: 'release_review',
      maxAttempts: 3,
    });
    await bundle.runQueueService.dequeueNextRunnable(run.runId);

    const queuedJob = await bundle.runQueueService.enqueueJob({
      runId: run.runId,
      kind: 'release_review',
      maxAttempts: 3,
    });

    const summary = await bundle.recoveryService.recover();
    const recoveredRunningJob = await bundle.runQueueService.getJob(runningJob.jobId);
    const recoveredQueuedJob = await bundle.runQueueService.getJob(queuedJob.jobId);

    expect(summary.requeuedJobs).toBe(1);
    expect(summary.restoredQueuedJobs).toBe(1);
    expect(recoveredRunningJob.status).toBe('retriable');
    expect(recoveredQueuedJob.status).toBe('queued');
  });

  it('releases unreleased terminal-job leases and clears the stale worker assignment', async () => {
    const artifactDir = await createArtifactDir('recovery-terminal-lease-');
    const bundle = createOrchestratorRuntimeBundle({
      artifactDir,
      retryPolicy: {
        maxAttempts: 3,
        backoffStrategy: 'fixed',
        baseDelayMs: 0,
      },
    });
    const run = await bundle.orchestratorService.createRun({
      title: 'Recovery terminal lease run',
      createdBy: 'tester',
    });
    await bundle.orchestratorService.saveRequirementFreeze(
      run.runId,
      buildRequirementFreeze(run.runId),
    );
    await bundle.orchestratorService.saveArchitectureFreeze(
      run.runId,
      buildArchitectureFreeze(run.runId),
    );

    const job = await bundle.runQueueService.enqueueJob({
      runId: run.runId,
      kind: 'release_review',
      maxAttempts: 3,
    });
    const runningJob = await bundle.runQueueService.dequeueNextRunnable(run.runId);
    if (!runningJob) {
      throw new Error('Expected a running job for terminal lease recovery test.');
    }
    const workerId = '00000000-0000-4000-8000-000000000099-worker-1';

    await bundle.workerRepository.saveWorker(
      {
        workerId,
        daemonId: '00000000-0000-4000-8000-000000000099',
        status: 'running',
        currentJobId: runningJob.jobId,
        startedAt: new Date().toISOString(),
        lastHeartbeatAt: new Date().toISOString(),
        metadata: {},
      },
      run.runId,
    );
    await bundle.workerLeaseService.acquireJobLease({
      workerId,
      job: runningJob,
    });
    await bundle.runQueueService.markSucceeded({
      jobId: runningJob.jobId,
    });

    await bundle.recoveryService.recover();

    const recoveredLease = await bundle.workerLeaseService.getLease(job.jobId);
    const recoveredWorker = await bundle.workerRepository.getWorker(workerId);

    expect(recoveredLease?.metadata.releasedAt).toBeTypeOf('string');
    expect(recoveredLease?.metadata.releaseReason).toBe('terminal_job');
    expect(recoveredWorker?.status).toBe('stopped');
    expect(recoveredWorker?.currentJobId).toBeUndefined();
  });

  it('reconciles orphaned running process handles for terminal jobs', async () => {
    const artifactDir = await createArtifactDir('recovery-terminal-process-');
    const bundle = createOrchestratorRuntimeBundle({
      artifactDir,
      retryPolicy: {
        maxAttempts: 3,
        backoffStrategy: 'fixed',
        baseDelayMs: 0,
      },
    });
    const run = await bundle.orchestratorService.createRun({
      title: 'Recovery terminal process run',
      createdBy: 'tester',
    });
    await bundle.orchestratorService.saveRequirementFreeze(
      run.runId,
      buildRequirementFreeze(run.runId),
    );
    await bundle.orchestratorService.saveArchitectureFreeze(
      run.runId,
      buildArchitectureFreeze(run.runId),
    );

    const job = await bundle.runQueueService.enqueueJob({
      runId: run.runId,
      kind: 'task_execution',
      taskId: '00000000-0000-4000-8000-000000000088',
      maxAttempts: 3,
    });
    const runningJob = await bundle.runQueueService.dequeueNextRunnable(run.runId);
    if (!runningJob) {
      throw new Error('Expected a running job for terminal process recovery test.');
    }
    const workerId = '00000000-0000-4000-8000-000000000088-worker-1';

    await bundle.workerRepository.saveWorker(
      {
        workerId,
        daemonId: '00000000-0000-4000-8000-000000000088',
        status: 'running',
        currentJobId: runningJob.jobId,
        startedAt: new Date().toISOString(),
        lastHeartbeatAt: new Date().toISOString(),
        metadata: {},
      },
      run.runId,
    );
    await bundle.workerLeaseService.acquireJobLease({
      workerId,
      job: runningJob,
    });
    await bundle.processRepository.saveProcessHandle({
      processHandleId: '00000000-0000-4000-8000-00000000f088',
      runId: run.runId,
      taskId: runningJob.taskId,
      jobId: runningJob.jobId,
      workspacePath: '/tmp/terminal-workspace',
      command: 'codex',
      args: ['exec'],
      pid: 999999,
      status: 'running',
      startedAt: '2026-04-09T00:00:00.000Z',
      metadata: {
        executionId: '00000000-0000-4000-8000-00000000e088',
      },
    });
    await bundle.runQueueService.markSucceeded({
      jobId: runningJob.jobId,
    });

    await bundle.recoveryService.recover();

    const recoveredLease = await bundle.workerLeaseService.getLease(job.jobId);
    const recoveredWorker = await bundle.workerRepository.getWorker(workerId);
    const recoveredHandle = await bundle.processRepository.findLatestByJob(job.jobId);

    expect(recoveredLease?.metadata.releaseReason).toBe('terminal_job');
    expect(recoveredWorker?.status).toBe('stopped');
    expect(recoveredWorker?.currentJobId).toBeUndefined();
    expect(recoveredHandle?.status).toBe('terminated');
    expect(recoveredHandle?.metadata).toMatchObject({
      recoveredBy: 'recovery-service',
      recoveryReason: 'process_missing',
      orphaned: true,
    });
  });

  it('reconciles orphaned running processes before requeueing interrupted jobs', async () => {
    const artifactDir = await createArtifactDir('recovery-orphaned-process-');
    const bundle = createOrchestratorRuntimeBundle({
      artifactDir,
      retryPolicy: {
        maxAttempts: 3,
        backoffStrategy: 'fixed',
        baseDelayMs: 0,
      },
    });
    const run = await bundle.orchestratorService.createRun({
      title: 'Recovery orphaned process run',
      createdBy: 'tester',
    });
    await bundle.orchestratorService.saveRequirementFreeze(
      run.runId,
      buildRequirementFreeze(run.runId),
    );
    await bundle.orchestratorService.saveArchitectureFreeze(
      run.runId,
      buildArchitectureFreeze(run.runId),
    );

    const job = await bundle.runQueueService.enqueueJob({
      runId: run.runId,
      kind: 'task_execution',
      taskId: '00000000-0000-4000-8000-000000000777',
      maxAttempts: 3,
    });
    const runningJob = await bundle.runQueueService.dequeueNextRunnable(run.runId);
    if (!runningJob) {
      throw new Error('Expected a running job for orphaned process recovery test.');
    }
    const workerId = '00000000-0000-4000-8000-000000000777-worker-1';

    await bundle.workerRepository.saveWorker(
      {
        workerId,
        daemonId: '00000000-0000-4000-8000-000000000777',
        status: 'running',
        currentJobId: runningJob.jobId,
        startedAt: new Date().toISOString(),
        lastHeartbeatAt: new Date().toISOString(),
        metadata: {},
      },
      run.runId,
    );
    await bundle.workerLeaseService.acquireJobLease({
      workerId,
      job: runningJob,
    });
    await bundle.processRepository.saveProcessHandle({
      processHandleId: '00000000-0000-4000-8000-00000000f777',
      runId: run.runId,
      taskId: runningJob.taskId,
      jobId: runningJob.jobId,
      workspacePath: '/tmp/orphaned-workspace',
      command: 'codex',
      args: ['exec'],
      pid: 999999,
      status: 'running',
      startedAt: '2026-04-09T00:00:00.000Z',
      metadata: {
        executionId: '00000000-0000-4000-8000-00000000e777',
      },
    });

    await bundle.recoveryService.recover();

    const recoveredJob = await bundle.runQueueService.getJob(job.jobId);
    const recoveredLease = await bundle.workerLeaseService.getLease(job.jobId);
    const recoveredWorker = await bundle.workerRepository.getWorker(workerId);
    const recoveredHandle = await bundle.processRepository.findLatestByJob(job.jobId);

    expect(recoveredJob.status).toBe('retriable');
    expect(recoveredJob.attempt).toBe(2);
    expect(recoveredLease?.metadata.releaseReason).toBe('recovered_interrupted_job');
    expect(recoveredWorker?.status).toBe('stopped');
    expect(recoveredWorker?.currentJobId).toBeUndefined();
    expect(recoveredHandle?.status).toBe('terminated');
    expect(recoveredHandle?.metadata).toMatchObject({
      recoveredBy: 'recovery-service',
      recoveryReason: 'process_missing',
      orphaned: true,
    });
  });
});
