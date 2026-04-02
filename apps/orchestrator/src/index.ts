import { loadOrchestratorConfig } from './config';
import { OrchestratorService } from './application/orchestrator-service';
import { CommandExecutor } from './services/command-executor';
import { CodexExecutor } from './services/codex-executor';
import { EvidenceLedgerService } from './services/evidence-ledger-service';
import { ExecutionEvidenceService } from './services/execution-evidence-service';
import { ExecutionService } from './services/execution-service';
import { ExecutorRegistry, NoopExecutor } from './services/executor-registry';
import { GateEvaluator } from './services/gate-evaluator';
import { ArchitectureFreezeService } from './services/architecture-freeze-service';
import { RequirementFreezeService } from './services/requirement-freeze-service';
import { TaskGraphService } from './services/task-graph-service';
import { TaskLoopService } from './services/task-loop-service';
import { FileEvidenceRepository } from './storage/file-evidence-repository';
import { FileExecutionRepository } from './storage/file-execution-repository';
import { FileRunRepository } from './storage/file-run-repository';
import { FileTaskRepository } from './storage/file-task-repository';

export function createOrchestratorService(artifactDir?: string): OrchestratorService {
  const config = loadOrchestratorConfig();
  const resolvedArtifactDir = artifactDir ?? config.artifactDir;
  const runRepository = new FileRunRepository(resolvedArtifactDir);
  const taskRepository = new FileTaskRepository(resolvedArtifactDir);
  const evidenceRepository = new FileEvidenceRepository(resolvedArtifactDir);
  const executionRepository = new FileExecutionRepository(resolvedArtifactDir);
  const evidenceLedgerService = new EvidenceLedgerService(evidenceRepository);
  const executionEvidenceService = new ExecutionEvidenceService(
    executionRepository,
    evidenceLedgerService,
  );
  const executorRegistry = new ExecutorRegistry([
    new CodexExecutor(),
    new CommandExecutor(),
    new NoopExecutor(),
  ]);

  return new OrchestratorService(
    runRepository,
    taskRepository,
    evidenceRepository,
    new RequirementFreezeService(runRepository, evidenceLedgerService),
    new ArchitectureFreezeService(runRepository, evidenceLedgerService),
    new TaskGraphService(runRepository, taskRepository, evidenceLedgerService),
    new TaskLoopService(runRepository, taskRepository, evidenceRepository),
    evidenceLedgerService,
    new GateEvaluator(),
    new ExecutionService(executorRegistry, executionEvidenceService),
  );
}

export * from './application/orchestrator-service';
export * from './contracts';
export * from './services/bridge-client';
export * from './services/command-executor';
export * from './services/codex-executor';
export * from './services/execution-service';
export * from './services/executor-registry';
