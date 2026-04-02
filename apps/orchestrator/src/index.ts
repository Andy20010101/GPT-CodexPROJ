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
import { FailureClassificationService } from './services/failure-classification-service';
import { FailureToTaskService } from './services/failure-to-task-service';
import { JobDispositionService } from './services/job-disposition-service';
import { PriorityQueueService } from './services/priority-queue-service';
import { ProcessControlService } from './services/process-control-service';
import { QuotaControlService } from './services/quota-control-service';
import { RecoveryService } from './services/recovery-service';
import { DebugSnapshotService } from './services/debug-snapshot-service';
import { E2eValidationService } from './services/e2e-validation-service';
import { ReleaseGateService } from './services/release-gate-service';
import { ReleaseReviewService } from './services/release-review-service';
import { RemediationPlaybookService } from './services/remediation-playbook-service';
import { RemediationService } from './services/remediation-service';
import { ReviewGateService } from './services/review-gate-service';
import { ReviewService } from './services/review-service';
import { RetainedWorkspaceService } from './services/retained-workspace-service';
import { RetryService } from './services/retry-service';
import { RollbackService } from './services/rollback-service';
import { RunnerLifecycleService } from './services/runner-lifecycle-service';
import { RunnerResumeService } from './services/runner-resume-service';
import { RunAcceptanceService } from './services/run-acceptance-service';
import { RunQueueService } from './services/run-queue-service';
import { ArchitectureFreezeService } from './services/architecture-freeze-service';
import { SchedulingPolicyService } from './services/scheduling-policy-service';
import { RequirementFreezeService } from './services/requirement-freeze-service';
import { SelfRepairPolicyService } from './services/self-repair-policy-service';
import { StabilityGovernanceService } from './services/stability-governance-service';
import { StaleJobReclaimService } from './services/stale-job-reclaim-service';
import { TaskSchedulerService } from './services/task-scheduler-service';
import { TaskGraphService } from './services/task-graph-service';
import { TaskLoopService } from './services/task-loop-service';
import { WorkerLeaseService } from './services/worker-lease-service';
import { WorkerPoolService } from './services/worker-pool-service';
import { WorkerService } from './services/worker-service';
import { WorkflowRuntimeService } from './services/workflow-runtime-service';
import { WorkspaceCleanupService } from './services/workspace-cleanup-service';
import { WorkspaceGcService } from './services/workspace-gc-service';
import { WorkspaceRuntimeService } from './services/workspace-runtime-service';
import { WorktreeService } from './services/worktree-service';
import { FileCancellationRepository } from './storage/file-cancellation-repository';
import { FileDaemonRepository } from './storage/file-daemon-repository';
import { FileDebugSnapshotRepository } from './storage/file-debug-snapshot-repository';
import { FileEvidenceRepository } from './storage/file-evidence-repository';
import { FileExecutionRepository } from './storage/file-execution-repository';
import { FileFailureRepository } from './storage/file-failure-repository';
import { FileHeartbeatRepository } from './storage/file-heartbeat-repository';
import { FileJobRepository } from './storage/file-job-repository';
import { FileProcessRepository } from './storage/file-process-repository';
import { FileQueueRepository } from './storage/file-queue-repository';
import { FileReleaseRepository } from './storage/file-release-repository';
import { FileRemediationRepository } from './storage/file-remediation-repository';
import { FileReviewRepository } from './storage/file-review-repository';
import { FileRollbackRepository } from './storage/file-rollback-repository';
import { FileRunRepository } from './storage/file-run-repository';
import { FileSchedulingRepository } from './storage/file-scheduling-repository';
import { FileStabilityRepository } from './storage/file-stability-repository';
import { FileTaskRepository } from './storage/file-task-repository';
import { FileWorkerRepository } from './storage/file-worker-repository';
import { FileWorkspaceLifecycleRepository } from './storage/file-workspace-lifecycle-repository';
import { FileWorkspaceRepository } from './storage/file-workspace-repository';
import { CodexCliCommandBuilder } from './utils/codex-cli-command-builder';
import type { CleanupPolicy, ConcurrencyPolicy, RetryPolicy, SchedulingPolicy } from './contracts';

export type CreateOrchestratorServiceOptions = {
  artifactDir?: string;
  bridgeClient?: BridgeClient | undefined;
  codexRunner?: CodexRunner | undefined;
  commandRunner?: CommandRunner | undefined;
  worktreeService?: WorktreeService | undefined;
  retryPolicy?: RetryPolicy | undefined;
  concurrencyPolicy?: ConcurrencyPolicy | undefined;
  schedulingPolicy?: SchedulingPolicy | undefined;
  workspaceCleanupPolicy?: CleanupPolicy | undefined;
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
  failureClassificationService: FailureClassificationService;
  failureToTaskService: FailureToTaskService;
  jobDispositionService: JobDispositionService;
  debugSnapshotService: DebugSnapshotService;
  e2eValidationService: E2eValidationService;
  processControlService: ProcessControlService;
  quotaControlService: QuotaControlService;
  remediationPlaybookService: RemediationPlaybookService;
  remediationService: RemediationService;
  retainedWorkspaceService: RetainedWorkspaceService;
  rollbackService: RollbackService;
  runnerLifecycleService: RunnerLifecycleService;
  runnerResumeService: RunnerResumeService;
  schedulingPolicyService: SchedulingPolicyService;
  selfRepairPolicyService: SelfRepairPolicyService;
  stabilityGovernanceService: StabilityGovernanceService;
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
  workspaceCleanupService: WorkspaceCleanupService;
  workspaceGcService: WorkspaceGcService;
  runRepository: FileRunRepository;
  taskRepository: FileTaskRepository;
  evidenceRepository: FileEvidenceRepository;
  debugSnapshotRepository: FileDebugSnapshotRepository;
  daemonRepository: FileDaemonRepository;
  workerRepository: FileWorkerRepository;
  heartbeatRepository: FileHeartbeatRepository;
  cancellationRepository: FileCancellationRepository;
  failureRepository: FileFailureRepository;
  jobRepository: FileJobRepository;
  processRepository: FileProcessRepository;
  queueRepository: FileQueueRepository;
  releaseRepository: FileReleaseRepository;
  remediationRepository: FileRemediationRepository;
  rollbackRepository: FileRollbackRepository;
  schedulingRepository: FileSchedulingRepository;
  stabilityRepository: FileStabilityRepository;
  workspaceLifecycleRepository: FileWorkspaceLifecycleRepository;
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
  const schedulingPolicy = options.schedulingPolicy ?? config.schedulingPolicy;
  const workspaceCleanupPolicy = options.workspaceCleanupPolicy ?? config.workspaceCleanupPolicy;
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
  const debugSnapshotRepository = new FileDebugSnapshotRepository(resolvedArtifactDir);
  const executionRepository = new FileExecutionRepository(resolvedArtifactDir);
  const failureRepository = new FileFailureRepository(resolvedArtifactDir);
  const heartbeatRepository = new FileHeartbeatRepository(resolvedArtifactDir);
  const jobRepository = new FileJobRepository(resolvedArtifactDir);
  const processRepository = new FileProcessRepository(resolvedArtifactDir);
  const cancellationRepository = new FileCancellationRepository(resolvedArtifactDir);
  const queueRepository = new FileQueueRepository(resolvedArtifactDir);
  const releaseRepository = new FileReleaseRepository(resolvedArtifactDir);
  const remediationRepository = new FileRemediationRepository(resolvedArtifactDir);
  const reviewRepository = new FileReviewRepository(resolvedArtifactDir);
  const rollbackRepository = new FileRollbackRepository(resolvedArtifactDir);
  const schedulingRepository = new FileSchedulingRepository(resolvedArtifactDir);
  const stabilityRepository = new FileStabilityRepository(resolvedArtifactDir);
  const workerRepository = new FileWorkerRepository(resolvedArtifactDir);
  const workspaceLifecycleRepository = new FileWorkspaceLifecycleRepository(resolvedArtifactDir);
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
  const workspaceCleanupService = new WorkspaceCleanupService(
    runRepository,
    workspaceLifecycleRepository,
    evidenceLedgerService,
    worktreeService,
    workspaceCleanupPolicy,
  );
  const workspaceGcService = new WorkspaceGcService(
    runRepository,
    workspaceRepository,
    workspaceLifecycleRepository,
    workspaceCleanupService,
    evidenceLedgerService,
  );
  const retainedWorkspaceService = new RetainedWorkspaceService(
    workspaceLifecycleRepository,
    workspaceRepository,
  );
  const processControlService = new ProcessControlService(
    processRepository,
    runRepository,
    evidenceLedgerService,
    {
      gracefulSignal: 'SIGTERM',
      graceMs: config.runnerTerminateGraceMs,
      forcedSignal: config.runnerKillSignal,
      forceKillAfterMs: config.runnerForceKillAfterMs,
    },
  );
  const runnerLifecycleService = new RunnerLifecycleService(
    runRepository,
    evidenceLedgerService,
    processControlService,
  );
  const bridgeClient = options.bridgeClient ?? new HttpBridgeClient(config.bridgeBaseUrl);
  const codexRunner =
    options.codexRunner ??
    (config.codexRunnerMode === 'cli'
      ? new CodexCliRunner(
          new CodexCliCommandBuilder(),
          {
            cliBin: config.codexCliBin,
            cliArgs: config.codexCliArgs,
            modelHint: config.reviewModelHint,
            timeoutMs: config.codexCliTimeoutMs,
          },
          undefined,
          undefined,
          runnerLifecycleService,
        )
      : undefined);
  const executorRegistry = new ExecutorRegistry([
    new CodexExecutor(codexRunner),
    new CommandExecutor(options.commandRunner, runnerLifecycleService, config.codexCliTimeoutMs),
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
  const failureClassificationService = new FailureClassificationService(
    runRepository,
    failureRepository,
    evidenceLedgerService,
  );
  const rollbackService = new RollbackService(
    runRepository,
    rollbackRepository,
    evidenceLedgerService,
  );
  const debugSnapshotService = new DebugSnapshotService(
    runRepository,
    debugSnapshotRepository,
    evidenceLedgerService,
    workspaceCleanupPolicy,
  );
  const remediationPlaybookService = new RemediationPlaybookService();
  const failureToTaskService = new FailureToTaskService(remediationPlaybookService);
  const selfRepairPolicyService = new SelfRepairPolicyService();
  const remediationService = new RemediationService(
    runRepository,
    remediationRepository,
    evidenceLedgerService,
    remediationPlaybookService,
    failureToTaskService,
    selfRepairPolicyService,
    workspaceGcService,
  );
  const jobDispositionService = new JobDispositionService(
    resolvedArtifactDir,
    runRepository,
    failureClassificationService,
    evidenceLedgerService,
  );
  const runnerResumeService = new RunnerResumeService(
    runRepository,
    processRepository,
    stabilityRepository,
    evidenceLedgerService,
    retainedWorkspaceService,
  );
  const cancellationService = new CancellationService(
    runRepository,
    runQueueService,
    cancellationRepository,
    evidenceLedgerService,
    runnerLifecycleService,
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
  const quotaControlService = new QuotaControlService(
    resolvedArtifactDir,
    runRepository,
    evidenceLedgerService,
    schedulingPolicy.quotaPolicy,
    concurrencyPolicy.deferDelayMs,
  );
  const schedulingPolicyService = new SchedulingPolicyService(
    schedulingRepository,
    runRepository,
    evidenceLedgerService,
    new PriorityQueueService(),
    quotaControlService,
    schedulingPolicy,
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
    workspaceCleanupService,
    jobDispositionService,
    rollbackService,
    debugSnapshotService,
    retainedWorkspaceService,
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
    runnerResumeService,
  );
  const stabilityGovernanceService = new StabilityGovernanceService(
    runRepository,
    jobRepository,
    failureRepository,
    rollbackRepository,
    debugSnapshotRepository,
    remediationRepository,
    stabilityRepository,
    workspaceLifecycleRepository,
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
    schedulingPolicyService,
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
  const e2eValidationService = new E2eValidationService(
    orchestratorService,
    workflowRuntimeService,
    runRepository,
    taskRepository,
    executionRepository,
    reviewRepository,
    releaseRepository,
    workspaceLifecycleRepository,
    rollbackRepository,
    stabilityRepository,
    stabilityGovernanceService,
    evidenceLedgerService,
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
    workspaceGcService,
    evidenceLedgerService,
    {
      pollIntervalMs: daemonPollIntervalMs,
      gcIntervalMs: config.daemonGcIntervalMs,
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
    failureClassificationService,
    failureToTaskService,
    jobDispositionService,
    debugSnapshotService,
    e2eValidationService,
    processControlService,
    quotaControlService,
    remediationPlaybookService,
    remediationService,
    retainedWorkspaceService,
    rollbackService,
    runnerLifecycleService,
    runnerResumeService,
    schedulingPolicyService,
    selfRepairPolicyService,
    stabilityGovernanceService,
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
    workspaceCleanupService,
    workspaceGcService,
    runRepository,
    taskRepository,
    evidenceRepository,
    debugSnapshotRepository,
    daemonRepository,
    workerRepository,
    heartbeatRepository,
    cancellationRepository,
    failureRepository,
    jobRepository,
    processRepository,
    queueRepository,
    releaseRepository,
    remediationRepository,
    rollbackRepository,
    schedulingRepository,
    stabilityRepository,
    workspaceLifecycleRepository,
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
export * from './services/failure-classification-service';
export * from './services/failure-to-task-service';
export * from './services/heartbeat-service';
export * from './services/job-disposition-service';
export * from './services/debug-snapshot-service';
export * from './services/e2e-validation-service';
export * from './services/remediation-playbook-service';
export * from './services/remediation-service';
export * from './services/retained-workspace-service';
export * from './services/rollback-service';
export * from './services/runner-resume-service';
export * from './services/self-repair-policy-service';
export * from './services/stability-governance-service';
export * from './services/process-control-service';
export * from './services/quota-control-service';
export * from './services/release-gate-service';
export * from './services/release-review-service';
export * from './services/review-gate-service';
export * from './services/review-service';
export * from './services/retry-service';
export * from './services/runner-lifecycle-service';
export * from './services/run-acceptance-service';
export * from './services/run-queue-service';
export * from './services/scheduling-policy-service';
export * from './services/stale-job-reclaim-service';
export * from './services/task-scheduler-service';
export * from './services/worker-lease-service';
export * from './services/worker-pool-service';
export * from './services/worker-service';
export * from './services/workflow-runtime-service';
export * from './services/workspace-cleanup-service';
export * from './services/workspace-gc-service';
export * from './services/workspace-runtime-service';
export * from './services/worktree-service';
