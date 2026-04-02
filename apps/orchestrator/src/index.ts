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
import { ReviewGateService } from './services/review-gate-service';
import { ReviewService } from './services/review-service';
import { ArchitectureFreezeService } from './services/architecture-freeze-service';
import { RequirementFreezeService } from './services/requirement-freeze-service';
import { TaskGraphService } from './services/task-graph-service';
import { TaskLoopService } from './services/task-loop-service';
import { WorkspaceRuntimeService } from './services/workspace-runtime-service';
import { WorktreeService } from './services/worktree-service';
import { FileEvidenceRepository } from './storage/file-evidence-repository';
import { FileExecutionRepository } from './storage/file-execution-repository';
import { FileReviewRepository } from './storage/file-review-repository';
import { FileRunRepository } from './storage/file-run-repository';
import { FileTaskRepository } from './storage/file-task-repository';
import { FileWorkspaceRepository } from './storage/file-workspace-repository';
import { CodexCliCommandBuilder } from './utils/codex-cli-command-builder';

export type CreateOrchestratorServiceOptions = {
  artifactDir?: string;
  bridgeClient?: BridgeClient | undefined;
  codexRunner?: CodexRunner | undefined;
  commandRunner?: CommandRunner | undefined;
  worktreeService?: WorktreeService | undefined;
};

export function createOrchestratorService(
  artifactDirOrOptions?: string | CreateOrchestratorServiceOptions,
): OrchestratorService {
  const config = loadOrchestratorConfig();
  const options =
    typeof artifactDirOrOptions === 'string'
      ? { artifactDir: artifactDirOrOptions }
      : (artifactDirOrOptions ?? {});
  const resolvedArtifactDir = options.artifactDir ?? config.artifactDir;
  const runRepository = new FileRunRepository(resolvedArtifactDir);
  const taskRepository = new FileTaskRepository(resolvedArtifactDir);
  const evidenceRepository = new FileEvidenceRepository(resolvedArtifactDir);
  const executionRepository = new FileExecutionRepository(resolvedArtifactDir);
  const reviewRepository = new FileReviewRepository(resolvedArtifactDir);
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

  return new OrchestratorService(
    runRepository,
    taskRepository,
    evidenceRepository,
    new RequirementFreezeService(runRepository, evidenceLedgerService),
    new ArchitectureFreezeService(runRepository, evidenceLedgerService),
    new TaskGraphService(runRepository, taskRepository, evidenceLedgerService),
    taskLoopService,
    evidenceLedgerService,
    new GateEvaluator(),
    new ExecutionService(executorRegistry, executionEvidenceService),
    workspaceRuntimeService,
    reviewService,
    reviewGateService,
  );
}

export * from './application/orchestrator-service';
export * from './contracts';
export * from './services/bridge-client';
export * from './services/command-executor';
export * from './services/codex-cli-runner';
export * from './services/codex-executor';
export * from './services/execution-service';
export * from './services/executor-registry';
export * from './services/review-gate-service';
export * from './services/review-service';
export * from './services/workspace-runtime-service';
export * from './services/worktree-service';
