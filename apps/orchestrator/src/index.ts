import { loadOrchestratorConfig } from './config';
import { OrchestratorService } from './application/orchestrator-service';
import { HttpBridgeClient, type BridgeClient } from './services/bridge-client';
import { CommandExecutor } from './services/command-executor';
import type { CommandRunner } from './services/command-executor';
import { CodexCliRunner } from './services/codex-cli-runner';
import { CodexExecutor } from './services/codex-executor';
import type { CodexRunner } from './services/codex-executor';
import { EvidenceLedgerService } from './services/evidence-ledger-service';
import { ExecutionEvidenceService } from './services/execution-evidence-service';
import { ExecutionService } from './services/execution-service';
import { ExecutorRegistry, NoopExecutor } from './services/executor-registry';
import { GateEvaluator } from './services/gate-evaluator';
import { CancellationService } from './services/cancellation-service';
import { ConcurrencyControlService } from './services/concurrency-control-service';
import { DaemonRuntimeService } from './services/daemon-runtime-service';
import { DaemonStatusService } from './services/daemon-status-service';
import { DrainService } from './services/drain-service';
import { HeartbeatService } from './services/heartbeat-service';
import { RecoveryService } from './services/recovery-service';
import { ReleaseGateService } from './services/release-gate-service';
import { ReleaseReviewService } from './services/release-review-service';
import { ReviewGateService } from './services/review-gate-service';
import { ReviewService } from './services/review-service';
import { RetryService } from './services/retry-service';
import { RunAcceptanceService } from './services/run-acceptance-service';
import { RunQueueService } from './services/run-queue-service';
import { ArchitectureFreezeService } from './services/architecture-freeze-service';
import { RequirementFreezeService } from './services/requirement-freeze-service';
import { StaleJobReclaimService } from './services/stale-job-reclaim-service';
import { TaskSchedulerService } from './services/task-scheduler-service';
import { TaskGraphService } from './services/task-graph-service';
import { TaskLoopService } from './services/task-loop-service';
import { WorkerLeaseService } from './services/worker-lease-service';
import { WorkerPoolService } from './services/worker-pool-service';
import { WorkerService } from './services/worker-service';
import { WorkflowRuntimeService } from './services/workflow-runtime-service';
import { WorkspaceRuntimeService } from './services/workspace-runtime-service';
import { WorktreeService } from './services/worktree-service';
import { FileCancellationRepository } from './storage/file-cancellation-repository';
import { FileDaemonRepository } from './storage/file-daemon-repository';
import { FileEvidenceRepository } from './storage/file-evidence-repository';
import { FileExecutionRepository } from './storage/file-execution-repository';
import { FileHeartbeatRepository } from './storage/file-heartbeat-repository';
import { FileJobRepository } from './storage/file-job-repository';
import { FileQueueRepository } from './storage/file-queue-repository';
import { FileReleaseRepository } from './storage/file-release-repository';
import { FileReviewRepository } from './storage/file-review-repository';
import { FileRunRepository } from './storage/file-run-repository';
import { FileTaskRepository } from './storage/file-task-repository';
import { FileWorkerRepository } from './storage/file-worker-repository';
import { FileWorkspaceRepository } from './storage/file-workspace-repository';
import { CodexCliCommandBuilder } from './utils/codex-cli-command-builder';
import type { ConcurrencyPolicy, RetryPolicy } from './contracts';

export type CreateOrchestratorServiceOptions = {
  artifactDir?: string;
  bridgeClient?: BridgeClient | undefined;
  codexRunner?: CodexRunner | undefined;
  commandRunner?: CommandRunner | undefined;
  worktreeService?: WorktreeService | undefined;
  retryPolicy?: RetryPolicy | undefined;
  concurrencyPolicy?: ConcurrencyPolicy | undefined;
  daemonWorkerCount?: number | undefined;
  daemonPollIntervalMs?: number | undefined;
  workerHeartbeatIntervalMs?: number | undefined;
  workerLeaseTtlMs?: number | undefined;
  staleHeartbeatThresholdMs?: number | undefined;
};

export type OrchestratorRuntimeBundle = {
  config: ReturnType<typeof loadOrchestratorConfig>;
  orchestratorService: OrchestratorService;
  workflowRuntimeService: WorkflowRuntimeService;
  workerService: WorkerService;
  runQueueService: RunQueueService;
  retryService: RetryService;
  recoveryService: RecoveryService;
  cancellationService: CancellationService;
  concurrencyControlService: ConcurrencyControlService;
  daemonRuntimeService: DaemonRuntimeService;
  daemonStatusService: DaemonStatusService;
  drainService: DrainService;
  heartbeatService: HeartbeatService;
  releaseReviewService: ReleaseReviewService;
  releaseGateService: ReleaseGateService;
  runAcceptanceService: RunAcceptanceService;
  staleJobReclaimService: StaleJobReclaimService;
  taskSchedulerService: TaskSchedulerService;
  workerLeaseService: WorkerLeaseService;
  workerPoolService: WorkerPoolService;
  runRepository: FileRunRepository;
  taskRepository: FileTaskRepository;
  evidenceRepository: FileEvidenceRepository;
  daemonRepository: FileDaemonRepository;
  workerRepository: FileWorkerRepository;
  heartbeatRepository: FileHeartbeatRepository;
  cancellationRepository: FileCancellationRepository;
  jobRepository: FileJobRepository;
  queueRepository: FileQueueRepository;
  releaseRepository: FileReleaseRepository;
};

export function createOrchestratorService(
  artifactDirOrOptions?: string | CreateOrchestratorServiceOptions,
): OrchestratorService {
  return createOrchestratorRuntimeBundle(artifactDirOrOptions).orchestratorService;
}

export function createOrchestratorRuntimeBundle(
  artifactDirOrOptions?: string | CreateOrchestratorServiceOptions,
): OrchestratorRuntimeBundle {
  const config = loadOrchestratorConfig();
  const options =
    typeof artifactDirOrOptions === 'string'
      ? { artifactDir: artifactDirOrOptions }
      : (artifactDirOrOptions ?? {});
  const retryPolicy = options.retryPolicy ?? config.defaultRetryPolicy;
  const concurrencyPolicy = options.concurrencyPolicy ?? config.concurrencyPolicy;
  const daemonWorkerCount = options.daemonWorkerCount ?? config.daemonWorkerCount;
  const daemonPollIntervalMs = options.daemonPollIntervalMs ?? config.daemonPollIntervalMs;
  const workerHeartbeatIntervalMs =
    options.workerHeartbeatIntervalMs ?? config.workerHeartbeatIntervalMs;
  const workerLeaseTtlMs = options.workerLeaseTtlMs ?? config.workerLeaseTtlMs;
  const staleHeartbeatThresholdMs =
    options.staleHeartbeatThresholdMs ?? config.staleHeartbeatThresholdMs;
  const resolvedArtifactDir = options.artifactDir ?? config.artifactDir;
  const runRepository = new FileRunRepository(resolvedArtifactDir);
  const taskRepository = new FileTaskRepository(resolvedArtifactDir);
  const evidenceRepository = new FileEvidenceRepository(resolvedArtifactDir);
  const daemonRepository = new FileDaemonRepository(resolvedArtifactDir);
  const executionRepository = new FileExecutionRepository(resolvedArtifactDir);
  const heartbeatRepository = new FileHeartbeatRepository(resolvedArtifactDir);
  const jobRepository = new FileJobRepository(resolvedArtifactDir);
  const cancellationRepository = new FileCancellationRepository(resolvedArtifactDir);
  const queueRepository = new FileQueueRepository(resolvedArtifactDir);
  const releaseRepository = new FileReleaseRepository(resolvedArtifactDir);
  const reviewRepository = new FileReviewRepository(resolvedArtifactDir);
  const workerRepository = new FileWorkerRepository(resolvedArtifactDir);
  const workspaceRepository = new FileWorkspaceRepository(resolvedArtifactDir);
  const evidenceLedgerService = new EvidenceLedgerService(evidenceRepository);
  const executionEvidenceService = new ExecutionEvidenceService(
    executionRepository,
    evidenceLedgerService,
  );
  const taskLoopService = new TaskLoopService(runRepository, taskRepository, evidenceRepository);
  const worktreeService = options.worktreeService ?? new WorktreeService();
  const workspaceRuntimeService = new WorkspaceRuntimeService(
    config.workspaceRuntimeBaseDir,
    workspaceRepository,
    evidenceLedgerService,
    worktreeService,
  );
  const bridgeClient = options.bridgeClient ?? new HttpBridgeClient(config.bridgeBaseUrl);
  const codexRunner =
    options.codexRunner ??
    (config.codexRunnerMode === 'cli'
      ? new CodexCliRunner(new CodexCliCommandBuilder(), {
          cliBin: config.codexCliBin,
          cliArgs: config.codexCliArgs,
          modelHint: config.reviewModelHint,
          timeoutMs: config.codexCliTimeoutMs,
        })
      : undefined);
  const executorRegistry = new ExecutorRegistry([
    new CodexExecutor(codexRunner),
    new CommandExecutor(options.commandRunner),
    new NoopExecutor(),
  ]);
  const reviewService = new ReviewService(
    bridgeClient,
    reviewRepository,
    evidenceLedgerService,
    undefined,
    {
      browserUrl: config.bridgeBrowserUrl,
      projectName: config.bridgeProjectName,
      modelHint: config.reviewModelHint,
      maxWaitMs: config.reviewMaxWaitMs,
    },
  );
  const reviewGateService = new ReviewGateService(
    evidenceRepository,
    evidenceLedgerService,
    taskLoopService,
  );
  const gateEvaluator = new GateEvaluator();
  const orchestratorService = new OrchestratorService(
    runRepository,
    taskRepository,
    evidenceRepository,
    new RequirementFreezeService(runRepository, evidenceLedgerService),
    new ArchitectureFreezeService(runRepository, evidenceLedgerService),
    new TaskGraphService(runRepository, taskRepository, evidenceLedgerService),
    taskLoopService,
    evidenceLedgerService,
    gateEvaluator,
    new ExecutionService(executorRegistry, executionEvidenceService),
    workspaceRuntimeService,
    reviewService,
    reviewGateService,
  );
  const runQueueService = new RunQueueService(
    runRepository,
    jobRepository,
    queueRepository,
    evidenceLedgerService,
    retryPolicy,
  );
  const retryService = new RetryService(
    resolvedArtifactDir,
    runRepository,
    runQueueService,
    evidenceLedgerService,
    retryPolicy,
  );
  const cancellationService = new CancellationService(
    runRepository,
    runQueueService,
    cancellationRepository,
    evidenceLedgerService,
  );
  const workerLeaseService = new WorkerLeaseService(
    runRepository,
    workerRepository,
    evidenceLedgerService,
    {
      leaseTtlMs: workerLeaseTtlMs,
      heartbeatIntervalMs: workerHeartbeatIntervalMs,
    },
  );
  const heartbeatService = new HeartbeatService(
    runRepository,
    heartbeatRepository,
    workerRepository,
    evidenceLedgerService,
    staleHeartbeatThresholdMs,
  );
  const concurrencyControlService = new ConcurrencyControlService(
    resolvedArtifactDir,
    runRepository,
    evidenceLedgerService,
    concurrencyPolicy,
  );
  const releaseReviewService = new ReleaseReviewService(
    bridgeClient,
    releaseRepository,
    taskRepository,
    executionRepository,
    evidenceRepository,
    evidenceLedgerService,
    {
      browserUrl: config.bridgeBrowserUrl,
      projectName: config.bridgeProjectName,
      modelHint: config.reviewModelHint,
      maxWaitMs: config.reviewMaxWaitMs,
    },
  );
  const releaseGateService = new ReleaseGateService(evidenceRepository, evidenceLedgerService);
  const runAcceptanceService = new RunAcceptanceService(
    runRepository,
    taskRepository,
    evidenceRepository,
    releaseRepository,
    evidenceLedgerService,
    gateEvaluator,
  );
  const taskSchedulerService = new TaskSchedulerService();
  const workerService = new WorkerService(
    orchestratorService,
    runRepository,
    taskRepository,
    runQueueService,
    retryService,
    releaseReviewService,
    releaseGateService,
    runAcceptanceService,
    cancellationService,
    {
      workspaceSourceRepoPath: config.workspaceSourceRepoPath,
      retryPolicy,
    },
  );
  const recoveryService = new RecoveryService(
    runRepository,
    jobRepository,
    queueRepository,
    runQueueService,
    retryService,
    evidenceLedgerService,
  );
  const staleJobReclaimService = new StaleJobReclaimService(
    resolvedArtifactDir,
    runRepository,
    jobRepository,
    workerRepository,
    runQueueService,
    retryService,
    heartbeatService,
    workerLeaseService,
    evidenceLedgerService,
  );
  const daemonStatusService = new DaemonStatusService(
    daemonRepository,
    runRepository,
    jobRepository,
    workerRepository,
    heartbeatRepository,
    concurrencyPolicy,
  );
  const workerPoolService = new WorkerPoolService(
    runRepository,
    runQueueService,
    workerRepository,
    workerLeaseService,
    heartbeatService,
    concurrencyControlService,
    workerService,
    evidenceLedgerService,
    {
      workerCount: daemonWorkerCount,
      leaseTtlMs: workerLeaseTtlMs,
      heartbeatIntervalMs: workerHeartbeatIntervalMs,
    },
  );
  const drainService = new DrainService(
    resolvedArtifactDir,
    daemonRepository,
    runRepository,
    evidenceLedgerService,
  );
  const workflowRuntimeService = new WorkflowRuntimeService(
    orchestratorService,
    runRepository,
    taskRepository,
    runQueueService,
    taskSchedulerService,
    workerService,
    recoveryService,
    retryPolicy,
  );
  const daemonRuntimeService = new DaemonRuntimeService(
    daemonRepository,
    runRepository,
    workflowRuntimeService,
    runQueueService,
    workerPoolService,
    drainService,
    daemonStatusService,
    staleJobReclaimService,
    evidenceLedgerService,
    {
      pollIntervalMs: daemonPollIntervalMs,
      autoQueueRunnableTasks: true,
    },
  );

  return {
    config,
    orchestratorService,
    workflowRuntimeService,
    workerService,
    runQueueService,
    retryService,
    recoveryService,
    cancellationService,
    concurrencyControlService,
    daemonRuntimeService,
    daemonStatusService,
    drainService,
    heartbeatService,
    releaseReviewService,
    releaseGateService,
    runAcceptanceService,
    staleJobReclaimService,
    taskSchedulerService,
    workerLeaseService,
    workerPoolService,
    runRepository,
    taskRepository,
    evidenceRepository,
    daemonRepository,
    workerRepository,
    heartbeatRepository,
    cancellationRepository,
    jobRepository,
    queueRepository,
    releaseRepository,
  };
}

export * from './application/orchestrator-service';
export * from './contracts';
export * from './services/bridge-client';
export * from './services/cancellation-service';
export * from './services/command-executor';
export * from './services/concurrency-control-service';
export * from './services/codex-cli-runner';
export * from './services/codex-executor';
export * from './services/daemon-runtime-service';
export * from './services/daemon-status-service';
export * from './services/drain-service';
export * from './services/execution-service';
export * from './services/executor-registry';
export * from './services/heartbeat-service';
export * from './services/release-gate-service';
export * from './services/release-review-service';
export * from './services/review-gate-service';
export * from './services/review-service';
export * from './services/retry-service';
export * from './services/run-acceptance-service';
export * from './services/run-queue-service';
export * from './services/stale-job-reclaim-service';
export * from './services/task-scheduler-service';
export * from './services/worker-lease-service';
export * from './services/worker-pool-service';
export * from './services/worker-service';
export * from './services/workflow-runtime-service';
export * from './services/workspace-runtime-service';
export * from './services/worktree-service';
