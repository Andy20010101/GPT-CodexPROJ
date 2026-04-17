import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import {
  type PlanningMaterializedResult,
  PlanningMaterializedResultSchema,
} from '../apps/orchestrator/src/contracts/planning-materialized-result';
import {
  type PlanningPhase,
} from '../apps/orchestrator/src/contracts/planning-phase';
import {
  type PlanningRuntimeState,
  PlanningRuntimeStateSchema,
} from '../apps/orchestrator/src/contracts/planning-runtime-state';
import type { SelfImprovementEnvState } from '../apps/orchestrator/src/contracts/self-improvement-env';
import {
  type SelfImprovementCampaignState,
  SelfImprovementCampaignStateSchema,
  type SelfImprovementCampaignStopReason,
  type SelfImprovementRunGoal,
  SelfImprovementRunGoalSchema,
  type SelfImprovementRunTerminalState,
  SelfImprovementRunTerminalStateSchema,
  type SelfImprovementTodoGoal,
} from '../apps/orchestrator/src/contracts/self-improvement-governor';
import {
  doctorSelfImprovementEnvironment,
  ensureSelfImprovementEnvironment,
} from './self-improvement-env';
import {
  classifySelfImprovementRun,
  selectNextOrderedTodo,
} from './self-improvement-governor-shared.mjs';
import {
  getPlanningFinalizeRuntimeStateFile,
  getPlanningMaterializedResultFile,
  getPlanningRequestRuntimeStateFile,
  getRunAcceptanceFile,
  getRunAnalysisBundleManifestFile,
  getRunAnalysisBundleRoot,
  getRunFile,
  getRunRoot,
  getRunSelfImprovementGoalFile,
  getRunWatcherLatestJsonFile,
  getRunWatcherLatestMarkdownFile,
  getRunWatcherLogFile,
  getRunWatcherPidFile,
  getRunWatcherRoot,
  getSelfImprovementCampaignStateFile,
} from '../apps/orchestrator/src/utils/run-paths';

type Options = {
  orchestratorBaseUrl: string;
  bridgeBaseUrl?: string;
  browserEndpoint?: string;
  startupUrl: string;
  planningModelOverride: string;
  runId?: string;
  goalTodoId?: string;
  createdBy: string;
  title?: string;
  summary?: string;
  watchIntervalMs: number;
  waitForStartMs: number;
  planningWaitMs: number;
  planningPollMs: number;
  terminalPollMs: number;
  includeZip: boolean;
  artifactDir?: string;
  prepareOnly: boolean;
  governBetweenRuns: boolean;
  campaignId: string;
  iterationCap: number;
};

type RunRecord = {
  runId: string;
  title: string;
  summary?: string;
  createdBy?: string;
  stage: string;
  createdAt?: string;
  updatedAt?: string;
  requirementFreezePath?: string;
  architectureFreezePath?: string;
  taskGraphPath?: string;
};

type RunSummaryResponse = {
  run: {
    runId: string;
    stage: string;
    title: string;
  };
  summary: {
    taskGraphRegistered: boolean;
    taskCounts: Record<string, number>;
  };
  runtimeState: {
    status: string;
    queuedJobs: number;
    runningJobs: number;
    retriableJobs: number;
    failedJobs: number;
    blockedJobs: number;
    runnableTaskIds?: string[];
    blockedTaskIds?: string[];
    acceptedTaskIds?: string[];
  };
};

type RunTaskRecord = {
  taskId: string;
  title: string;
  status: string;
};

type PlanningFinalizeCompleted = {
  status: 'completed';
  materializedResult: PlanningMaterializedResult;
  materializedResultPath: string;
};

type PlanningFinalizePending = {
  status: 'pending';
  error: {
    code: string;
    message: string;
  };
};

type PersistedPlanningFinalizeState = {
  materializedResultPath: string;
  materializedResult: PlanningMaterializedResult | null;
  finalizeRuntimeStatePath: string;
  finalizeRuntimeState: PlanningRuntimeState | null;
  requestRuntimeStatePath: string;
  requestRuntimeState: PlanningRuntimeState | null;
};

type PlanningPhaseDriverConfig = {
  phaseKey: 'requirement' | 'architecture' | 'task-graph';
  directoryName: 'requirement' | 'architecture' | 'task-graph';
  requestPathname: string;
  finalizePathname: string;
  applyPathname: string;
  metadata: () => Record<string, unknown>;
  prompt: () => string;
  isApplied: (run: RunRecord) => boolean;
  applyBody: (options: Options) => Record<string, unknown>;
};

type GoalProfile = {
  profileId: string;
  goal: SelfImprovementTodoGoal;
  defaultTitlePrefix: string;
  defaultSummary: string;
  objectiveId: string;
  objective: string;
  primaryTarget: string;
  supportingDoc: string;
  allowedFiles: readonly string[];
  disallowedFiles: readonly string[];
  readOnlyReferences: readonly string[];
  criticalFiles: readonly string[];
  zipCandidates: readonly string[];
  requirementPrompt: () => string;
  architecturePrompt: () => string;
  taskGraphPrompt: () => string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const todoListPath = path.join(repoRoot, 'todolist.md');
const watcherScriptPath = path.join(repoRoot, 'scripts', 'watch-run-until-terminal.mjs');
const bootstrapModuleRelativePath = 'scripts/self-improvement-env.ts';
const runEntryRelativePath = 'scripts/run-real-self-improvement.ts';
const targetDocRelativePath = 'docs/architecture/REAL_SELF_IMPROVEMENT.md';
const DRIVER_FINALIZE_REQUEST_TIMEOUT_MS = 15_000;
const DRIVER_FINALIZE_RETRY_COOLDOWN_MS = 30_000;
const SUPPORTED_SELF_IMPROVEMENT_MODEL = 'ChatGPT';
const legacyBootstrapAllowedFiles = [
  bootstrapModuleRelativePath,
  runEntryRelativePath,
  targetDocRelativePath,
  'apps/orchestrator/src/contracts/self-improvement-env.ts',
  'apps/orchestrator/src/contracts/index.ts',
  'apps/orchestrator/src/utils/run-paths.ts',
] as const;
const runToRunGovernorAllowedFiles = [
  'scripts/run-real-self-improvement.ts',
  'scripts/watch-run-until-terminal.mjs',
  'scripts/self-improvement-governor-shared.mjs',
  'apps/orchestrator/src/contracts/self-improvement-governor.ts',
  'apps/orchestrator/src/contracts/index.ts',
  'apps/orchestrator/src/services/orchestrator-summary.ts',
  'apps/orchestrator/src/services/run-acceptance-service.ts',
  'apps/orchestrator/src/utils/run-paths.ts',
  'apps/orchestrator/tests/unit/run-paths.test.ts',
  'apps/orchestrator/tests/unit/self-improvement-governor.test.ts',
  'docs/architecture/PARALLEL_DELIVERY_AND_SELF_IMPROVEMENT.md',
  'docs/architecture/REAL_SELF_IMPROVEMENT.md',
  'docs/architecture/REAL_SELF_IMPROVEMENT_SOP.md',
  'todolist.md',
] as const;
const defaultDisallowedGoalFiles = [
  'packages/**',
  'services/**',
  'apps/orchestrator/src/services/**',
] as const;

const AnalysisBundleFileKindSchema = z.enum([
  'repo_summary',
  'critical_files',
  'latest_patch',
  'source_zip',
  'other',
]);

const AnalysisBundleFileSchema = z.object({
  kind: AnalysisBundleFileKindSchema,
  path: z.string().min(1),
  relativePath: z.string().min(1),
  optional: z.boolean().default(false),
});

type AnalysisBundleFile = z.infer<typeof AnalysisBundleFileSchema>;

const AnalysisBundleManifestSchema = z.object({
  runId: z.string().uuid(),
  bundleDir: z.string().min(1),
  createdAt: z.string().datetime(),
  files: z.array(AnalysisBundleFileSchema).min(1),
});

let activeGoalProfile: GoalProfile = createLegacyBootstrapGoalProfile();

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const bootstrapOptions = buildBootstrapEnvironmentOptions(options);
  const bootstrapDoctor = await doctorSelfImprovementEnvironment(bootstrapOptions);
  writeBootstrapPhaseMarker('doctor', bootstrapDoctor);
  const envState = options.prepareOnly
    ? bootstrapDoctor
    : await ensureSelfImprovementEnvironment(bootstrapOptions);
  if (!options.prepareOnly) {
    writeBootstrapPhaseMarker('ensure', envState);
  }
  writeBootstrapArtifactReference(envState);

  let campaignState = options.governBetweenRuns
    ? await loadOrCreateCampaignState(
        envState.authoritativeArtifactDir,
        options.campaignId,
        options.iterationCap,
      )
    : null;
  const initialRunId = options.runId ?? campaignState?.activeRunId;
  const initialGoalProfile = await resolveGoalProfile({
    options: {
      ...options,
      ...(initialRunId ? { runId: initialRunId } : {}),
    },
    artifactDir: envState.authoritativeArtifactDir,
    excludedTodoIds: campaignState ? getCampaignGoalHistory(campaignState) : [],
  });
  activeGoalProfile = initialGoalProfile;

  if (options.prepareOnly) {
    process.stdout.write(
      `${JSON.stringify(
        {
          mode: 'prepare-only',
          bootstrapPhases: {
            doctor: summarizeBootstrapPhase(bootstrapDoctor),
            ensure: null,
          },
          bootstrap: envState,
          envStatePath: envState.envStatePath,
          authoritativeArtifactDir: envState.authoritativeArtifactDir,
          authority: envState.artifactAuthority,
          watcherCleanup: envState.watcherCleanup,
          bridgeBaseUrl: envState.bridge.baseUrl,
          browserEndpoint: envState.browser.endpoint,
          selectedGoal: initialGoalProfile.goal,
          goalProfileId: initialGoalProfile.profileId,
          campaign:
            campaignState === null
              ? null
              : {
                  campaignId: campaignState.campaignId,
                  iterationCap: campaignState.iterationCap,
                  iterationsStarted: campaignState.iterationsStarted,
                  iterationsCompleted: campaignState.iterationsCompleted,
                  activeRunId: campaignState.activeRunId ?? null,
                },
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  if (
    campaignState &&
    !initialRunId &&
    campaignState.iterationsStarted >= options.iterationCap
  ) {
    campaignState = await writeAndReturnCampaignStopState({
      artifactDir: envState.authoritativeArtifactDir,
      state: campaignState,
      stopReason: 'iteration_cap_reached',
    });
    process.stdout.write(
      `${JSON.stringify(
        {
          mode: 'between-run-governor',
          campaign: {
            campaignId: campaignState.campaignId,
            iterationCap: campaignState.iterationCap,
            iterationsStarted: campaignState.iterationsStarted,
            iterationsCompleted: campaignState.iterationsCompleted,
            stopReason: 'iteration_cap_reached',
            statePath: getSelfImprovementCampaignStateFile(
              envState.authoritativeArtifactDir,
              campaignState.campaignId,
            ),
          },
          runs: [],
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  const runReports: Record<string, unknown>[] = [];
  let currentOptions: Options = {
    ...options,
    ...(initialRunId ? { runId: initialRunId } : {}),
  };
  let currentGoalProfile = initialGoalProfile;

  for (;;) {
    activeGoalProfile = currentGoalProfile;
    let run = currentOptions.runId
      ? await getRun(currentOptions.orchestratorBaseUrl, currentOptions.runId)
      : await createRun(currentOptions, currentGoalProfile);
    const runGoalPath = await persistRunGoal(
      envState.authoritativeArtifactDir,
      run.runId,
      currentGoalProfile,
    );
    if (campaignState) {
      campaignState = await startCampaignIteration({
        artifactDir: envState.authoritativeArtifactDir,
        state: campaignState,
        runId: run.runId,
        goal: currentGoalProfile.goal,
      });
    }

    const runRoot = getRunRoot(envState.authoritativeArtifactDir, run.runId);
    const watcher = await ensureWatcher({
      artifactDir: envState.authoritativeArtifactDir,
      runId: run.runId,
      baseUrl: currentOptions.orchestratorBaseUrl,
      intervalMs: currentOptions.watchIntervalMs,
    });

    const bundle = await ensureAnalysisBundle({
      artifactDir: envState.authoritativeArtifactDir,
      runId: run.runId,
      includeZip: currentOptions.includeZip,
      envStatePath: envState.envStatePath,
    });
    const planningResults = await drivePlanningSequence({
      options: currentOptions,
      run,
      artifactDir: envState.authoritativeArtifactDir,
    });
    run = planningResults.run;

    const summary = await waitForRunToStart(
      currentOptions.orchestratorBaseUrl,
      run.runId,
      currentOptions.waitForStartMs,
    );

    const attachmentEvidence = {
      requirement: await markdownShowsAttachments(
        planningResults.requirement.materializedResult.markdownPath,
      ),
      architecture: await markdownShowsAttachments(
        planningResults.architecture.materializedResult.markdownPath,
      ),
      taskGraph: await markdownShowsAttachments(
        planningResults.taskGraph.materializedResult.markdownPath,
      ),
    };

    let terminalState: SelfImprovementRunTerminalState | null = null;
    let stopReason: SelfImprovementCampaignStopReason | null = null;
    let nextGoalProfile: GoalProfile | null = null;

    if (currentOptions.governBetweenRuns) {
      terminalState = await waitForRunToReachTerminal({
        orchestratorBaseUrl: currentOptions.orchestratorBaseUrl,
        artifactDir: envState.authoritativeArtifactDir,
        runId: run.runId,
        pollMs: currentOptions.terminalPollMs,
      });

      if (terminalState.outcome !== 'accepted') {
        stopReason = 'terminal_outcome_requires_operator';
      } else if ((campaignState?.iterationsStarted ?? 0) >= currentOptions.iterationCap) {
        stopReason = 'iteration_cap_reached';
      } else {
        const nextGoalDecision = await resolveNextCampaignGoalProfile({
          excludedTodoIds: campaignState ? getCampaignGoalHistory(campaignState) : [],
        });
        stopReason = nextGoalDecision.stopReason;
        nextGoalProfile = nextGoalDecision.profile;
      }

      if (campaignState) {
        campaignState = await finishCampaignIteration({
          artifactDir: envState.authoritativeArtifactDir,
          state: campaignState,
          runId: run.runId,
          terminalState,
          ...(stopReason ? { stopReason } : {}),
        });
      }
    }

    const report = {
      runId: run.runId,
      goal: currentGoalProfile.goal,
      goalProfileId: currentGoalProfile.profileId,
      runGoalPath,
      runRoot,
      bootstrapPhases: {
        doctor: summarizeBootstrapPhase(bootstrapDoctor),
        ensure: summarizeBootstrapPhase(envState),
      },
      envStatePath: envState.envStatePath,
      authoritativeArtifactDir: envState.authoritativeArtifactDir,
      artifactAuthority: envState.artifactAuthority,
      bootstrap: envState,
      bundleDir: bundle.bundleDir,
      bundleManifestPath: bundle.manifestPath,
      bundleFiles: bundle.files.map((file) => file.relativePath),
      watcher,
      watcherCleanup: envState.watcherCleanup,
      planningArtifacts: {
        requirement: summarizePlanningArtifact(planningResults.requirement),
        architecture: summarizePlanningArtifact(planningResults.architecture),
        taskGraph: summarizePlanningArtifact(planningResults.taskGraph),
      },
      taskGraphApply: planningResults.taskGraphApply,
      attachmentsObservedInMarkdown: attachmentEvidence,
      currentRun: {
        stage: summary.run.stage,
        runtimeStatus: summary.runtimeState.status,
        queuedJobs: summary.runtimeState.queuedJobs,
        runningJobs: summary.runtimeState.runningJobs,
        retriableJobs: summary.runtimeState.retriableJobs,
        failedJobs: summary.runtimeState.failedJobs,
        blockedJobs: summary.runtimeState.blockedJobs,
      },
      terminalState,
      campaign:
        campaignState === null
          ? null
          : {
              campaignId: campaignState.campaignId,
              iterationCap: campaignState.iterationCap,
              iterationsStarted: campaignState.iterationsStarted,
              iterationsCompleted: campaignState.iterationsCompleted,
              stopReason,
              nextGoal: nextGoalProfile?.goal ?? null,
              statePath: getSelfImprovementCampaignStateFile(
                envState.authoritativeArtifactDir,
                campaignState.campaignId,
              ),
            },
    };
    runReports.push(report);

    if (!currentOptions.governBetweenRuns || !nextGoalProfile) {
      process.stdout.write(
        `${JSON.stringify(
          currentOptions.governBetweenRuns
            ? {
                mode: 'between-run-governor',
                campaign:
                  campaignState === null
                    ? null
                    : {
                        campaignId: campaignState.campaignId,
                        iterationCap: campaignState.iterationCap,
                        iterationsStarted: campaignState.iterationsStarted,
                        iterationsCompleted: campaignState.iterationsCompleted,
                        stopReason,
                        statePath: getSelfImprovementCampaignStateFile(
                          envState.authoritativeArtifactDir,
                          campaignState.campaignId,
                        ),
                      },
                runs: runReports,
              }
            : report,
          null,
          2,
        )}\n`,
      );
      return;
    }

    currentOptions = {
      ...currentOptions,
      runId: undefined,
      goalTodoId: undefined,
      title: undefined,
      summary: undefined,
    };
    currentGoalProfile = nextGoalProfile;
  }
}

function buildBootstrapEnvironmentOptions(options: Options): Parameters<
  typeof doctorSelfImprovementEnvironment
>[0] {
  return {
    orchestratorBaseUrl: options.orchestratorBaseUrl,
    ...(options.bridgeBaseUrl ? { bridgeBaseUrl: options.bridgeBaseUrl } : {}),
    ...(options.browserEndpoint ? { browserEndpoint: options.browserEndpoint } : {}),
    startupUrl: options.startupUrl,
    ...(options.artifactDir ? { artifactDir: options.artifactDir } : {}),
    runKind: 'self-improvement',
    ...(options.runId ? { runId: options.runId } : {}),
  };
}

function writeBootstrapPhaseMarker(
  phase: 'doctor' | 'ensure',
  envState: SelfImprovementEnvState,
): void {
  const label = phase.toUpperCase();
  process.stdout.write(`BOOTSTRAP_${label}_STATUS=${envState.overallStatus}\n`);
  process.stdout.write(`BOOTSTRAP_${label}_ENV_STATE_PATH=${envState.envStatePath}\n`);
}

function writeBootstrapArtifactReference(envState: SelfImprovementEnvState): void {
  process.stdout.write(`BOOTSTRAP_ENV_STATE_PATH=${envState.envStatePath}\n`);
  process.stdout.write(`BOOTSTRAP_ARTIFACT_DIR=${envState.authoritativeArtifactDir}\n`);
}

function summarizeBootstrapPhase(envState: SelfImprovementEnvState): {
  phase: SelfImprovementEnvState['phase'];
  overallStatus: SelfImprovementEnvState['overallStatus'];
  envStatePath: SelfImprovementEnvState['envStatePath'];
  authoritativeArtifactDir: SelfImprovementEnvState['authoritativeArtifactDir'];
  blockingIssues: number;
  recoveryActions: number;
} {
  return {
    phase: envState.phase,
    overallStatus: envState.overallStatus,
    envStatePath: envState.envStatePath,
    authoritativeArtifactDir: envState.authoritativeArtifactDir,
    blockingIssues: envState.blockingIssues.length,
    recoveryActions: envState.recoveryActions.length,
  };
}

function getActiveAllowedFiles(): readonly string[] {
  return activeGoalProfile.allowedFiles;
}

function getActiveDisallowedFiles(): readonly string[] {
  return activeGoalProfile.disallowedFiles;
}

function buildActivePlanningMetadata(): Record<string, unknown> {
  return {
    objective: activeGoalProfile.objectiveId,
    todoId: activeGoalProfile.goal.todoId,
    todoTitle: activeGoalProfile.goal.title,
    goalProfileId: activeGoalProfile.profileId,
    primaryTarget: activeGoalProfile.primaryTarget,
    supportingDoc: activeGoalProfile.supportingDoc,
  };
}

function formatDefaultRunTitle(profile: GoalProfile): string {
  const now = new Date().toISOString().replace(/[:.]/g, '-');
  return `${profile.defaultTitlePrefix}-${now}`;
}

function createLegacyBootstrapGoalProfile(): GoalProfile {
  return {
    profileId: 'legacy-bootstrap-v1',
    goal: {
      todoId: 'bootstrap',
      title: 'Environment bootstrap module.',
      section: 'Ordered Execution Queue',
      autoRunnable: false,
    },
    defaultTitlePrefix: 'real-self-improvement-bootstrap',
    defaultSummary: 'Bounded real self-improvement run for the environment bootstrap module.',
    objectiveId: 'bounded-environment-bootstrap-self-improvement',
    objective:
      'Improve the environment bootstrap module used by self-improvement and validation runs.',
    primaryTarget: bootstrapModuleRelativePath,
    supportingDoc: targetDocRelativePath,
    allowedFiles: legacyBootstrapAllowedFiles,
    disallowedFiles: defaultDisallowedGoalFiles,
    readOnlyReferences: [
      'todolist.md',
      'planning/review/release-review services',
      'chatgpt bridge attach surfaces',
    ],
    criticalFiles: [
      'todolist.md',
      bootstrapModuleRelativePath,
      runEntryRelativePath,
      'scripts/watch-run-until-terminal.mjs',
      targetDocRelativePath,
      'apps/orchestrator/src/contracts/self-improvement-env.ts',
      'apps/orchestrator/src/contracts/analysis-bundle.ts',
      'apps/orchestrator/src/utils/analysis-bundle.ts',
      'apps/orchestrator/src/utils/run-paths.ts',
      'apps/orchestrator/src/services/planning-payload-builder.ts',
      'apps/orchestrator/src/services/planning-service.ts',
      'apps/orchestrator/src/services/review-payload-builder.ts',
      'apps/orchestrator/src/services/review-service.ts',
      'apps/orchestrator/src/services/release-review-service.ts',
      'services/chatgpt-web-bridge/src/adapters/chatgpt-adapter.ts',
      'packages/shared-contracts/chatgpt/index.ts',
    ],
    zipCandidates: [
      'docs',
      'scripts',
      'apps/orchestrator/src/contracts/self-improvement-env.ts',
      'apps/orchestrator/src/contracts/analysis-bundle.ts',
      'apps/orchestrator/src/utils/analysis-bundle.ts',
      'apps/orchestrator/src/utils/run-paths.ts',
      'apps/orchestrator/src/services/planning-payload-builder.ts',
      'apps/orchestrator/src/services/planning-service.ts',
      'apps/orchestrator/src/services/review-payload-builder.ts',
      'apps/orchestrator/src/services/review-service.ts',
      'apps/orchestrator/src/services/release-review-service.ts',
      'services/chatgpt-web-bridge/src/adapters/chatgpt-adapter.ts',
      'packages/shared-contracts/chatgpt/index.ts',
      'todolist.md',
    ],
    requirementPrompt: buildLegacyRequirementPrompt,
    architecturePrompt: buildLegacyArchitecturePrompt,
    taskGraphPrompt: buildLegacyTaskGraphPrompt,
  };
}

function createRunToRunGovernorGoalProfile(goal: SelfImprovementTodoGoal): GoalProfile {
  return {
    profileId: 'run-to-run-governor-v1',
    goal,
    defaultTitlePrefix: 'real-self-improvement-governor',
    defaultSummary:
      'Bounded real self-improvement run for run-to-run governor, terminal detection, and next-goal selection.',
    objectiveId: 'bounded-run-to-run-governor',
    objective:
      'Add a bounded run-to-run governor for self-improvement campaigns with terminal-state detection, exactly-one next-goal selection, and iteration caps.',
    primaryTarget: runEntryRelativePath,
    supportingDoc: targetDocRelativePath,
    allowedFiles: runToRunGovernorAllowedFiles,
    disallowedFiles: defaultDisallowedGoalFiles,
    readOnlyReferences: [
      'handoff.md',
      'todolist.md',
      'watcher outputs and run acceptance artifacts',
      'planning/review/release-review services as read-only references',
    ],
    criticalFiles: [
      'handoff.md',
      'todolist.md',
      'scripts/run-real-self-improvement.ts',
      'scripts/watch-run-until-terminal.mjs',
      'scripts/self-improvement-governor-shared.mjs',
      'apps/orchestrator/src/contracts/self-improvement-governor.ts',
      'apps/orchestrator/src/contracts/index.ts',
      'apps/orchestrator/src/services/orchestrator-summary.ts',
      'apps/orchestrator/src/services/run-acceptance-service.ts',
      'apps/orchestrator/src/utils/run-paths.ts',
      'docs/architecture/PARALLEL_DELIVERY_AND_SELF_IMPROVEMENT.md',
      'docs/architecture/REAL_SELF_IMPROVEMENT.md',
      'docs/architecture/REAL_SELF_IMPROVEMENT_SOP.md',
    ],
    zipCandidates: [
      'scripts/run-real-self-improvement.ts',
      'scripts/watch-run-until-terminal.mjs',
      'scripts/self-improvement-governor-shared.mjs',
      'apps/orchestrator/src/contracts/self-improvement-governor.ts',
      'apps/orchestrator/src/contracts/index.ts',
      'apps/orchestrator/src/services/orchestrator-summary.ts',
      'apps/orchestrator/src/services/run-acceptance-service.ts',
      'apps/orchestrator/src/utils/run-paths.ts',
      'apps/orchestrator/tests/unit/run-paths.test.ts',
      'apps/orchestrator/tests/unit/self-improvement-governor.test.ts',
      'docs/architecture/PARALLEL_DELIVERY_AND_SELF_IMPROVEMENT.md',
      'docs/architecture/REAL_SELF_IMPROVEMENT.md',
      'docs/architecture/REAL_SELF_IMPROVEMENT_SOP.md',
      'todolist.md',
      'handoff.md',
    ],
    requirementPrompt: buildRunToRunGovernorRequirementPrompt,
    architecturePrompt: buildRunToRunGovernorArchitecturePrompt,
    taskGraphPrompt: buildRunToRunGovernorTaskGraphPrompt,
  };
}

function createGoalProfile(goal: SelfImprovementTodoGoal): GoalProfile | null {
  if (goal.todoId === '11') {
    return createRunToRunGovernorGoalProfile(goal);
  }

  return null;
}

function sanitizeCampaignId(value: string): string {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-');
  return sanitized.length > 0 ? sanitized : 'bounded-self-improvement';
}

async function loadTodoMarkdown(): Promise<string> {
  return fs.readFile(todoListPath, 'utf8');
}

function findTodoById(markdown: string, todoId: string): SelfImprovementTodoGoal | null {
  const lines = markdown.split(/\r?\n/);
  let currentSection: string | null = null;

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+?)\s*$/);
    if (headingMatch) {
      currentSection = headingMatch[1] ?? currentSection;
      continue;
    }

    if (currentSection !== 'Ordered Execution Queue') {
      continue;
    }

    const todoMatch = line.match(/^- \[( |x)\]\s+(\d+)\.\s+(.+?)\s*$/i);
    if (!todoMatch || todoMatch[2] !== todoId) {
      continue;
    }

    return {
      todoId,
      title: todoMatch[3] ?? `Todo ${todoId}`,
      section: 'Ordered Execution Queue',
      autoRunnable: todoId === '11',
    };
  }

  return null;
}

async function resolveGoalProfile(input: {
  options: Options;
  artifactDir: string;
  excludedTodoIds?: string[];
}): Promise<GoalProfile> {
  if (input.options.runId) {
    const persistedGoal = await readRunGoal(input.artifactDir, input.options.runId);
    if (persistedGoal) {
      const profile = createGoalProfile(persistedGoal.goal);
      if (!profile) {
        throw new Error(
          `Run ${input.options.runId} references unsupported goal todo ${persistedGoal.goal.todoId}.`,
        );
      }
      return profile;
    }

    return createLegacyBootstrapGoalProfile();
  }

  const todoMarkdown = await loadTodoMarkdown();
  const selectedGoal = input.options.goalTodoId
    ? findTodoById(todoMarkdown, input.options.goalTodoId)
    : selectNextOrderedTodo(todoMarkdown, {
        excludeTodoIds: input.excludedTodoIds ?? [],
      });

  if (!selectedGoal) {
    throw new Error('No unchecked bounded self-improvement todo is available in Ordered Execution Queue.');
  }

  const profile = createGoalProfile(selectedGoal);
  if (!profile) {
    throw new Error(
      `Todo ${selectedGoal.todoId} is not registered as an auto-runnable bounded self-improvement goal.`,
    );
  }

  return profile;
}

async function resolveNextCampaignGoalProfile(input: {
  excludedTodoIds: string[];
}): Promise<{
  profile: GoalProfile | null;
  stopReason: SelfImprovementCampaignStopReason | null;
}> {
  const selectedGoal = selectNextOrderedTodo(await loadTodoMarkdown(), {
    excludeTodoIds: input.excludedTodoIds,
  });
  if (!selectedGoal) {
    return {
      profile: null,
      stopReason: 'no_ordered_goal_remaining',
    };
  }
  if (!selectedGoal.autoRunnable) {
    return {
      profile: null,
      stopReason: 'next_goal_not_auto_runnable',
    };
  }

  const profile = createGoalProfile(selectedGoal);
  if (!profile) {
    return {
      profile: null,
      stopReason: 'next_goal_not_auto_runnable',
    };
  }

  return {
    profile,
    stopReason: null,
  };
}

async function readRunGoal(artifactDir: string, runId: string): Promise<SelfImprovementRunGoal | null> {
  try {
    const raw = parseJsonValue(
      await fs.readFile(getRunSelfImprovementGoalFile(artifactDir, runId), 'utf8'),
    );
    return SelfImprovementRunGoalSchema.parse(raw);
  } catch {
    return null;
  }
}

async function persistRunGoal(
  artifactDir: string,
  runId: string,
  profile: GoalProfile,
): Promise<string> {
  const filePath = getRunSelfImprovementGoalFile(artifactDir, runId);
  const payload = SelfImprovementRunGoalSchema.parse({
    version: 1,
    runId,
    selectedAt: new Date().toISOString(),
    profileId: profile.profileId,
    goal: profile.goal,
    allowedFiles: [...profile.allowedFiles],
    disallowedFiles: [...profile.disallowedFiles],
  });
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return filePath;
}

async function readCampaignState(
  artifactDir: string,
  campaignId: string,
): Promise<SelfImprovementCampaignState | null> {
  try {
    const raw = parseJsonValue(
      await fs.readFile(getSelfImprovementCampaignStateFile(artifactDir, campaignId), 'utf8'),
    );
    return SelfImprovementCampaignStateSchema.parse(raw);
  } catch {
    return null;
  }
}

async function writeCampaignState(
  artifactDir: string,
  state: SelfImprovementCampaignState,
): Promise<string> {
  const filePath = getSelfImprovementCampaignStateFile(artifactDir, state.campaignId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    `${JSON.stringify(SelfImprovementCampaignStateSchema.parse(state), null, 2)}\n`,
    'utf8',
  );
  return filePath;
}

function createCampaignState(campaignId: string, iterationCap: number): SelfImprovementCampaignState {
  const timestamp = new Date().toISOString();
  return SelfImprovementCampaignStateSchema.parse({
    version: 1,
    campaignId,
    createdAt: timestamp,
    updatedAt: timestamp,
    iterationCap,
    iterationsStarted: 0,
    iterationsCompleted: 0,
    history: [],
  });
}

function getCampaignGoalHistory(state: SelfImprovementCampaignState): string[] {
  return state.history.map((entry) => entry.goal.todoId);
}

async function loadOrCreateCampaignState(
  artifactDir: string,
  campaignId: string,
  iterationCap: number,
): Promise<SelfImprovementCampaignState> {
  const existing = await readCampaignState(artifactDir, campaignId);
  if (!existing) {
    const created = createCampaignState(campaignId, iterationCap);
    await writeCampaignState(artifactDir, created);
    return created;
  }

  const normalized = SelfImprovementCampaignStateSchema.parse({
    ...existing,
    updatedAt: existing.updatedAt,
    iterationCap,
  });
  await writeCampaignState(artifactDir, normalized);
  return normalized;
}

async function startCampaignIteration(input: {
  artifactDir: string;
  state: SelfImprovementCampaignState;
  runId: string;
  goal: SelfImprovementTodoGoal;
}): Promise<SelfImprovementCampaignState> {
  const existingActiveIteration = input.state.history.find(
    (entry) => entry.runId === input.runId && !entry.completedAt,
  );
  if (existingActiveIteration) {
    const resumed = SelfImprovementCampaignStateSchema.parse({
      ...input.state,
      updatedAt: new Date().toISOString(),
      activeRunId: input.runId,
      activeGoal: input.goal,
      stopReason: undefined,
    });
    await writeCampaignState(input.artifactDir, resumed);
    return resumed;
  }

  const iteration = input.state.iterationsStarted + 1;
  const updated = SelfImprovementCampaignStateSchema.parse({
    ...input.state,
    updatedAt: new Date().toISOString(),
    activeRunId: input.runId,
    activeGoal: input.goal,
    iterationsStarted: iteration,
    history: [
      ...input.state.history,
      {
        iteration,
        runId: input.runId,
        goal: input.goal,
        startedAt: new Date().toISOString(),
      },
    ],
    stopReason: undefined,
  });
  await writeCampaignState(input.artifactDir, updated);
  return updated;
}

async function finishCampaignIteration(input: {
  artifactDir: string;
  state: SelfImprovementCampaignState;
  runId: string;
  terminalState: SelfImprovementRunTerminalState;
  stopReason?: SelfImprovementCampaignStopReason;
}): Promise<SelfImprovementCampaignState> {
  const completedAt = new Date().toISOString();
  const updatedHistory = input.state.history.map((entry) =>
    entry.runId === input.runId
      ? {
          ...entry,
          completedAt,
          terminalState: input.terminalState,
        }
      : entry,
  );
  const updated = SelfImprovementCampaignStateSchema.parse({
    ...input.state,
    updatedAt: completedAt,
    activeRunId: undefined,
    activeGoal: undefined,
    iterationsCompleted: updatedHistory.filter((entry) => entry.completedAt).length,
    history: updatedHistory,
    lastTerminalState: input.terminalState,
    stopReason: input.stopReason,
  });
  await writeCampaignState(input.artifactDir, updated);
  return updated;
}

async function writeAndReturnCampaignStopState(input: {
  artifactDir: string;
  state: SelfImprovementCampaignState;
  stopReason: SelfImprovementCampaignStopReason;
}): Promise<SelfImprovementCampaignState> {
  const updated = SelfImprovementCampaignStateSchema.parse({
    ...input.state,
    updatedAt: new Date().toISOString(),
    stopReason: input.stopReason,
  });
  await writeCampaignState(input.artifactDir, updated);
  return updated;
}

async function readAuthoritativeRunRecord(
  artifactDir: string,
  runId: string,
): Promise<RunRecord | null> {
  try {
    return JSON.parse(await fs.readFile(getRunFile(artifactDir, runId), 'utf8')) as RunRecord;
  } catch {
    return null;
  }
}

async function hasRunAcceptanceArtifact(artifactDir: string, runId: string): Promise<boolean> {
  try {
    await fs.access(getRunAcceptanceFile(artifactDir, runId));
    return true;
  } catch {
    return false;
  }
}

async function getRunTasks(
  orchestratorBaseUrl: string,
  runId: string,
): Promise<RunTaskRecord[]> {
  return getJson(`${orchestratorBaseUrl}/api/runs/${runId}/tasks`);
}

async function detectTerminalRunState(input: {
  orchestratorBaseUrl: string;
  artifactDir: string;
  runId: string;
}): Promise<SelfImprovementRunTerminalState> {
  const [summary, tasks, authoritativeRun, hasRunAcceptance] = await Promise.all([
    getRunSummary(input.orchestratorBaseUrl, input.runId),
    getRunTasks(input.orchestratorBaseUrl, input.runId),
    readAuthoritativeRunRecord(input.artifactDir, input.runId),
    hasRunAcceptanceArtifact(input.artifactDir, input.runId),
  ]);

  return SelfImprovementRunTerminalStateSchema.parse(
    classifySelfImprovementRun({
      run: summary.run,
      authoritativeRun: authoritativeRun ?? summary.run,
      runtimeState: summary.runtimeState,
      summary: summary.summary,
      tasks,
      hasRunAcceptance,
    }),
  );
}

async function waitForRunToReachTerminal(input: {
  orchestratorBaseUrl: string;
  artifactDir: string;
  runId: string;
  pollMs: number;
}): Promise<SelfImprovementRunTerminalState> {
  for (;;) {
    const terminalState = await detectTerminalRunState(input);
    if (terminalState.terminal) {
      return terminalState;
    }
    await sleep(input.pollMs);
  }
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    orchestratorBaseUrl: 'http://127.0.0.1:3200',
    startupUrl: 'https://chatgpt.com/',
    planningModelOverride: SUPPORTED_SELF_IMPROVEMENT_MODEL,
    createdBy: 'codex',
    watchIntervalMs: 5000,
    waitForStartMs: 180000,
    planningWaitMs: 900000,
    planningPollMs: 5000,
    terminalPollMs: 10000,
    includeZip: true,
    prepareOnly: false,
    governBetweenRuns: false,
    campaignId: 'bounded-self-improvement',
    iterationCap: 1,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    switch (token) {
      case '--orchestrator-base-url':
        options.orchestratorBaseUrl = requireValue(token, next);
        index += 1;
        break;
      case '--bridge-base-url':
        options.bridgeBaseUrl = requireValue(token, next);
        index += 1;
        break;
      case '--browser-endpoint':
        options.browserEndpoint = requireValue(token, next);
        index += 1;
        break;
      case '--startup-url':
        options.startupUrl = requireValue(token, next);
        index += 1;
        break;
      case '--planning-model':
        options.planningModelOverride = requireValue(token, next);
        index += 1;
        break;
      case '--created-by':
        options.createdBy = requireValue(token, next);
        index += 1;
        break;
      case '--run-id':
        options.runId = requireValue(token, next);
        index += 1;
        break;
      case '--goal-todo-id':
        options.goalTodoId = requireValue(token, next);
        index += 1;
        break;
      case '--title':
        options.title = requireValue(token, next);
        index += 1;
        break;
      case '--summary':
        options.summary = requireValue(token, next);
        index += 1;
        break;
      case '--watch-interval-ms':
        options.watchIntervalMs = parsePositiveInteger(requireValue(token, next), token);
        index += 1;
        break;
      case '--wait-for-start-ms':
        options.waitForStartMs = parsePositiveInteger(requireValue(token, next), token);
        index += 1;
        break;
      case '--planning-wait-ms':
        options.planningWaitMs = parsePositiveInteger(requireValue(token, next), token);
        index += 1;
        break;
      case '--planning-poll-ms':
        options.planningPollMs = parsePositiveInteger(requireValue(token, next), token);
        index += 1;
        break;
      case '--terminal-poll-ms':
        options.terminalPollMs = parsePositiveInteger(requireValue(token, next), token);
        index += 1;
        break;
      case '--govern-between-runs':
        options.governBetweenRuns = true;
        break;
      case '--campaign-id':
        options.campaignId = sanitizeCampaignId(requireValue(token, next));
        index += 1;
        break;
      case '--iteration-cap':
        options.iterationCap = parsePositiveInteger(requireValue(token, next), token);
        index += 1;
        break;
      case '--no-zip':
        options.includeZip = false;
        break;
      case '--artifact-dir':
        options.artifactDir = path.resolve(requireValue(token, next));
        index += 1;
        break;
      case '--prepare-only':
        options.prepareOnly = true;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  return options;
}

export function buildPlanningRequestBody(
  options: Pick<Options, 'planningModelOverride'>,
  config: Pick<PlanningPhaseDriverConfig, 'prompt' | 'metadata'>,
): Record<string, unknown> {
  return {
    prompt: config.prompt(),
    requestedBy: 'run-real-self-improvement',
    producer: 'run-real-self-improvement',
    metadata: config.metadata(),
    modelOverride: options.planningModelOverride,
  };
}

async function createRun(options: Options, profile: GoalProfile): Promise<RunRecord> {
  return postJson(`${options.orchestratorBaseUrl}/api/runs`, {
    title: options.title ?? formatDefaultRunTitle(profile),
    createdBy: options.createdBy,
    summary: options.summary ?? profile.defaultSummary,
  });
}

async function getRun(orchestratorBaseUrl: string, runId: string): Promise<RunRecord> {
  const payload = await getJson<{ run: RunRecord }>(`${orchestratorBaseUrl}/api/runs/${runId}`);
  return payload.run;
}

async function drivePlanningSequence(input: {
  options: Options;
  run: RunRecord;
  artifactDir: string;
}): Promise<{
  run: RunRecord;
  requirement: PlanningFinalizeCompleted;
  architecture: PlanningFinalizeCompleted;
  taskGraph: PlanningFinalizeCompleted;
  taskGraphApply: { applied: boolean };
}> {
  let run = input.run;
  const requirement = await drivePlanningPhase({
    options: input.options,
    run,
    artifactDir: input.artifactDir,
    config: planningPhaseConfigs.requirement,
  });
  run = requirement.run;

  const architecture = await drivePlanningPhase({
    options: input.options,
    run,
    artifactDir: input.artifactDir,
    config: planningPhaseConfigs.architecture,
  });
  run = architecture.run;

  const taskGraph = await drivePlanningPhase({
    options: input.options,
    run,
    artifactDir: input.artifactDir,
    config: planningPhaseConfigs['task-graph'],
  });
  run = taskGraph.run;

  return {
    run,
    requirement: requirement.finalize,
    architecture: architecture.finalize,
    taskGraph: taskGraph.finalize,
    taskGraphApply: taskGraph.applyResponse as { applied: boolean },
  };
}

async function drivePlanningPhase(input: {
  options: Options;
  run: RunRecord;
  artifactDir: string;
  config: PlanningPhaseDriverConfig;
}): Promise<{
  run: RunRecord;
  finalize: PlanningFinalizeCompleted;
  applyResponse: Record<string, unknown>;
}> {
  if (input.config.isApplied(input.run)) {
    const finalize = await finalizePlanningPhase(
      input.options.orchestratorBaseUrl,
      input.artifactDir,
      input.run.runId,
      input.config.phaseKey,
      input.options.planningWaitMs,
      input.options.planningPollMs,
    );
    return {
      run: input.run,
      finalize,
      applyResponse: { applied: true, resumed: true, skippedApply: true },
    };
  }

  try {
    await postJson(
      `${input.options.orchestratorBaseUrl}/api/runs/${input.run.runId}/${input.config.requestPathname}`,
      buildPlanningRequestBody(input.options, input.config),
    );
  } catch (error) {
    throw new Error(
      `${input.config.phaseKey} request failed for run ${input.run.runId}. ` +
        `Resume with --run-id ${input.run.runId}. ` +
        (error instanceof Error ? error.message : String(error)),
    );
  }

  const finalize = await finalizePlanningPhase(
    input.options.orchestratorBaseUrl,
    input.artifactDir,
    input.run.runId,
    input.config.phaseKey,
    input.options.planningWaitMs,
    input.options.planningPollMs,
  );
  if (input.config.phaseKey === 'task-graph') {
    assertTaskGraphScope(finalize.materializedResult.payload);
  }

  let applyResponse: Record<string, unknown>;
  try {
    applyResponse = await postJson<Record<string, unknown>>(
      `${input.options.orchestratorBaseUrl}/api/runs/${input.run.runId}/${input.config.applyPathname}`,
      input.config.applyBody(input.options),
    );
  } catch (error) {
    throw new Error(
      `${input.config.phaseKey} apply failed for run ${input.run.runId}. ` +
        `Resume with --run-id ${input.run.runId}. ` +
        (error instanceof Error ? error.message : String(error)),
    );
  }
  if (input.config.phaseKey === 'task-graph' && applyResponse.applied !== true) {
    throw new Error('Task graph sufficiency check failed for the bounded self-improvement run.');
  }

  const updatedRun =
    'run' in applyResponse && applyResponse.run && typeof applyResponse.run === 'object'
      ? (applyResponse.run as RunRecord)
      : await getRun(input.options.orchestratorBaseUrl, input.run.runId);

  return {
    run: updatedRun,
    finalize,
    applyResponse,
  };
}

const planningPhaseConfigs: Record<
  PlanningPhaseDriverConfig['phaseKey'],
  PlanningPhaseDriverConfig
> = {
  requirement: {
    phaseKey: 'requirement',
    directoryName: 'requirement',
    requestPathname: 'requirement-request',
    finalizePathname: 'requirement-finalize',
    applyPathname: 'requirement-apply',
    metadata: buildActivePlanningMetadata,
    prompt: buildRequirementPrompt,
    isApplied: (run) => Boolean(run.requirementFreezePath),
    applyBody: () => ({
      appliedBy: 'run-real-self-improvement',
      metadata: buildActivePlanningMetadata(),
    }),
  },
  architecture: {
    phaseKey: 'architecture',
    directoryName: 'architecture',
    requestPathname: 'architecture-request',
    finalizePathname: 'architecture-finalize',
    applyPathname: 'architecture-apply',
    metadata: buildActivePlanningMetadata,
    prompt: buildArchitecturePrompt,
    isApplied: (run) => Boolean(run.architectureFreezePath),
    applyBody: () => ({
      appliedBy: 'run-real-self-improvement',
      metadata: buildActivePlanningMetadata(),
    }),
  },
  'task-graph': {
    phaseKey: 'task-graph',
    directoryName: 'task-graph',
    requestPathname: 'task-graph-request',
    finalizePathname: 'task-graph-finalize',
    applyPathname: 'task-graph-apply',
    metadata: buildActivePlanningMetadata,
    prompt: buildTaskGraphPrompt,
    isApplied: (run) => Boolean(run.taskGraphPath),
    applyBody: () => ({
      appliedBy: 'run-real-self-improvement',
      metadata: buildActivePlanningMetadata(),
      normalization: {
        defaultExecutorType: 'codex',
        defaultAllowedFiles: [...getActiveAllowedFiles()],
        defaultDisallowedFiles: [...getActiveDisallowedFiles()],
        defaultOutOfScope: [
          ...getActiveDisallowedFiles(),
          'other files outside the bounded self-improvement goal surface',
          'gate semantics',
          'acceptance rules',
          'task graph core semantics',
        ],
        sequentialDependencies: true,
      },
    }),
  },
};

async function ensureWatcher(input: {
  artifactDir: string;
  runId: string;
  baseUrl: string;
  intervalMs: number;
}): Promise<{
  pid: number;
  logPath: string;
  snapshotJsonPath: string;
  snapshotMdPath: string;
  pidFilePath: string;
  reused?: boolean;
}> {
  const pidFilePath = getRunWatcherPidFile(input.artifactDir, input.runId);
  try {
    const raw = parseJsonValue(await fs.readFile(pidFilePath, 'utf8')) as { pid?: number };
    if (typeof raw.pid === 'number' && isProcessRunning(raw.pid)) {
      return {
        pid: raw.pid,
        logPath: getRunWatcherLogFile(input.artifactDir, input.runId),
        snapshotJsonPath: getRunWatcherLatestJsonFile(input.artifactDir, input.runId),
        snapshotMdPath: getRunWatcherLatestMarkdownFile(input.artifactDir, input.runId),
        pidFilePath,
        reused: true,
      };
    }
  } catch {
    // Start a new watcher if the pid file is absent or stale.
  }

  return startWatcher(input);
}

async function ensureAnalysisBundle(input: {
  artifactDir: string;
  runId: string;
  includeZip: boolean;
  envStatePath: string;
}): Promise<{
  bundleDir: string;
  manifestPath: string;
  files: AnalysisBundleFile[];
}> {
  const manifestPath = getRunAnalysisBundleManifestFile(input.artifactDir, input.runId);
  try {
    const existing = AnalysisBundleManifestSchema.parse(
      JSON.parse(await fs.readFile(manifestPath, 'utf8')),
    );
    return {
      bundleDir: existing.bundleDir,
      manifestPath,
      files: [...existing.files],
    };
  } catch {
    return buildAnalysisBundle(input);
  }
}

async function startWatcher(input: {
  artifactDir: string;
  runId: string;
  baseUrl: string;
  intervalMs: number;
}): Promise<{
  pid: number;
  logPath: string;
  snapshotJsonPath: string;
  snapshotMdPath: string;
  pidFilePath: string;
}> {
  const watcherDir = getRunWatcherRoot(input.artifactDir, input.runId);
  const logPath = getRunWatcherLogFile(input.artifactDir, input.runId);
  const snapshotJsonPath = getRunWatcherLatestJsonFile(input.artifactDir, input.runId);
  const snapshotMdPath = getRunWatcherLatestMarkdownFile(input.artifactDir, input.runId);
  const pidFilePath = getRunWatcherPidFile(input.artifactDir, input.runId);
  await fs.mkdir(watcherDir, { recursive: true });
  const logHandle = await fs.open(logPath, 'a');
  const child = spawn(
    process.execPath,
    [
      watcherScriptPath,
      '--base-url',
      input.baseUrl,
      '--run-id',
      input.runId,
      '--artifact-dir',
      input.artifactDir,
      '--interval-ms',
      String(input.intervalMs),
      '--output-json',
      snapshotJsonPath,
      '--output-md',
      snapshotMdPath,
    ],
    {
      cwd: repoRoot,
      detached: true,
      stdio: ['ignore', logHandle.fd, logHandle.fd],
    },
  );
  child.unref();
  await logHandle.close();
  await fs.writeFile(
    pidFilePath,
    `${JSON.stringify(
      {
        pid: child.pid ?? -1,
        runId: input.runId,
        baseUrl: input.baseUrl,
        artifactDir: input.artifactDir,
        startedAt: new Date().toISOString(),
        outputJsonPath: snapshotJsonPath,
        outputMdPath: snapshotMdPath,
        logPath,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  return {
    pid: child.pid ?? -1,
    logPath,
    snapshotJsonPath,
    snapshotMdPath,
    pidFilePath,
  };
}

async function buildAnalysisBundle(input: {
  artifactDir: string;
  runId: string;
  includeZip: boolean;
  envStatePath: string;
}): Promise<{
  bundleDir: string;
  manifestPath: string;
  files: AnalysisBundleFile[];
}> {
  const bundleDir = getRunAnalysisBundleRoot(input.artifactDir, input.runId);
  const manifestPath = getRunAnalysisBundleManifestFile(input.artifactDir, input.runId);
  await fs.mkdir(bundleDir, { recursive: true });

  const repoSummaryPath = path.join(bundleDir, 'repo-summary.md');
  const criticalFilesPath = path.join(bundleDir, 'critical-files.md');
  const latestPatchPath = path.join(bundleDir, 'latest.patch');
  const envStateBundlePath = path.join(bundleDir, 'environment-state.json');
  const zipPath = path.join(bundleDir, 'source.zip');

  await fs.writeFile(repoSummaryPath, buildRepoSummaryMarkdown(input.runId), 'utf8');
  await fs.writeFile(criticalFilesPath, await buildCriticalFilesMarkdown(), 'utf8');
  await fs.writeFile(latestPatchPath, buildLatestPatch(), 'utf8');
  await fs.copyFile(input.envStatePath, envStateBundlePath);

  const files: AnalysisBundleFile[] = [
    {
      kind: 'repo_summary',
      path: repoSummaryPath,
      relativePath: path.relative(bundleDir, repoSummaryPath),
      optional: false,
    },
    {
      kind: 'critical_files',
      path: criticalFilesPath,
      relativePath: path.relative(bundleDir, criticalFilesPath),
      optional: false,
    },
    {
      kind: 'latest_patch',
      path: latestPatchPath,
      relativePath: path.relative(bundleDir, latestPatchPath),
      optional: false,
    },
    {
      kind: 'other',
      path: envStateBundlePath,
      relativePath: path.relative(bundleDir, envStateBundlePath),
      optional: false,
    },
  ];

  if (input.includeZip && createSourceZip(zipPath)) {
    files.push({
      kind: 'source_zip',
      path: zipPath,
      relativePath: path.relative(bundleDir, zipPath),
      optional: true,
    });
  }

  const manifest = AnalysisBundleManifestSchema.parse({
    runId: input.runId,
    bundleDir,
    createdAt: new Date().toISOString(),
    files,
  });
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return {
    bundleDir,
    manifestPath,
    files,
  };
}

function buildRepoSummaryMarkdown(runId: string): string {
  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
  const headCommit = runGit(['rev-parse', 'HEAD']);
  const status = runGit(['status', '--short']) || '(clean)';
  const latestCommit = runGit(['log', '-1', '--oneline']);
  const lines = [
    '# Repository Summary',
    '',
    `- generatedAt: ${new Date().toISOString()}`,
    `- repository: ${repoRoot}`,
    `- runId: ${runId}`,
    `- branch: ${branch}`,
    `- headCommit: ${headCommit}`,
    `- latestCommit: ${latestCommit}`,
    `- selectedGoal: ${activeGoalProfile.goal.todoId} ${activeGoalProfile.goal.title}`,
    `- primaryTarget: ${activeGoalProfile.primaryTarget}`,
    `- supportingDoc: ${activeGoalProfile.supportingDoc}`,
    '',
    '## Objective',
    activeGoalProfile.objective,
    '',
    '## Scope Guard',
    `- allow writes: ${getActiveAllowedFiles().join(', ')}`,
    `- read-only references: ${activeGoalProfile.readOnlyReferences.join(', ')}`,
    `- forbid writes: ${getActiveDisallowedFiles().join(', ')}, gate semantics, acceptance rules, task graph core semantics`,
    '',
    '## Current Git Status',
    '```text',
    status,
    '```',
    '',
    '## Proven Baseline',
    '- Formal real E2E already reached accepted on 2026-04-07.',
    '- Bridge file attachment support already exists via inputFiles.',
    '- The operator workflow now has a unified authoritative artifact root plus env-state output.',
    '',
  ];

  return `${lines.join('\n')}\n`;
}

async function buildCriticalFilesMarkdown(): Promise<string> {
  const files = activeGoalProfile.criticalFiles;

  const sections = ['# Critical Files', ''];
  for (const relativePath of files) {
    const absolutePath = path.join(repoRoot, relativePath);
    try {
      const raw = await fs.readFile(absolutePath, 'utf8');
      const content = truncate(raw, 16_000);
      sections.push(`## ${relativePath}`);
      sections.push('');
      sections.push('```' + detectLanguage(relativePath));
      sections.push(content);
      sections.push('```');
      sections.push('');
    } catch (error) {
      sections.push(`## ${relativePath}`);
      sections.push('');
      sections.push(`Unable to read file: ${String(error)}`);
      sections.push('');
    }
  }

  return `${sections.join('\n')}\n`;
}

function buildLatestPatch(): string {
  const patch = runGit(['diff', '--binary', 'HEAD', '--', '.']);
  if (patch.trim().length > 0) {
    return patch;
  }

  return '# No working tree diff was present when the analysis bundle was created.\n';
}

function createSourceZip(outputPath: string): boolean {
  const result = spawnSync('zip', ['-q', '-r', outputPath, ...activeGoalProfile.zipCandidates], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return result.status === 0;
}

function buildRequirementPrompt(): string {
  return activeGoalProfile.requirementPrompt();
}

function buildLegacyRequirementPrompt(): string {
  return [
    'Create a bounded first-pass self-improvement requirement freeze for an environment bootstrap module.',
    `The owned write surface is limited to: ${legacyBootstrapAllowedFiles.join(', ')}.`,
    'The deliverable must make self-improvement and validation runs detectable, recoverable, and auditable before planning starts.',
    'Use the attached analysis bundle first.',
    'Keep the scope low-risk, reusable, and auditable.',
    'Do not propose changes to gate semantics, acceptance rules, or task graph core semantics.',
    'Acceptance criteria must mention doctor/detect, ensure/bring-up, env-state output, and rerunnable operator workflow.',
  ].join('\n');
}

export function buildArchitecturePrompt(): string {
  return activeGoalProfile.architecturePrompt();
}

function buildLegacyArchitecturePrompt(): string {
  return [
    'Create a minimal architecture freeze for an environment bootstrap module that prepares the live self-improvement stack.',
    `The owned write surface must remain within: ${legacyBootstrapAllowedFiles.join(', ')}.`,
    'Reference planning/review/release-review and the bridge attach surfaces as integration points, not rewrite targets.',
    'Prefer the smallest valid architecture freeze: a single primary owned module is preferred.',
    'Do not invent extra external modules unless they are required by the schema and you can populate them concretely.',
    'Explicitly deny architectural changes to gates, acceptance semantics, and task graph core behavior.',
    'Output must strictly satisfy the architecture freeze JSON schema.',
    'Every moduleDefinitions item must include a non-empty ownedPaths array with at least one concrete repo path or repo path glob string. Never output ownedPaths: [].',
    'If you describe external boundary modules, use concrete ownedPaths from this repo, not abstract placeholders.',
    'If you include the planning/review boundary module, its moduleId must be exactly "planning-review-boundary".',
    'If you include the bridge attach boundary module, its moduleId must be exactly "bridge-attach-boundary".',
    'Do not invent moduleIds like "M_BROWSER_BRIDGE", "M_ARTIFACT_ROOTS", or similar abstract aliases.',
    'For every dependencyRules item, rule must be exactly one JSON string literal: "allow" or "deny".',
    'Do not put explanatory text, policy text, or full sentences into dependencyRules[].rule.',
    'Put all explanation in dependencyRules[].rationale; rationale must stay non-empty.',
    'If a dependency is read-only, bounded, or restricted, still encode rule as "allow" or "deny" and explain the restriction only in rationale.',
    'Bad example: {"fromModuleId":"M1","toModuleId":"orchestratorServiceAPI","rule":"Read-only dependency; must not alter orchestrator core behavior.","rationale":"..."}',
    'Good example: {"fromModuleId":"M1","toModuleId":"orchestratorServiceAPI","rule":"allow","rationale":"Read-only integration with orchestrator; must not alter orchestrator core behavior."}',
    'Use the attached analysis bundle as primary context.',
  ].join('\n');
}

function buildTaskGraphPrompt(): string {
  return activeGoalProfile.taskGraphPrompt();
}

function buildLegacyTaskGraphPrompt(): string {
  return [
    'Generate a strictly bounded 3-task graph for improving the environment bootstrap module only.',
    'Every task must set executorType to codex.',
    `Every task allowedFiles and scope.inScope must stay within ${legacyBootstrapAllowedFiles.join(', ')}.`,
    'Every task disallowedFiles must include packages/**, services/**, and apps/orchestrator/src/services/**.',
    'Every task scope.outOfScope must include gate semantics, acceptance rules, and task graph core semantics.',
    'Use these exact task titles in order: Bootstrap doctor baseline / Bootstrap ensure and run wiring / Environment bootstrap validation and docs.',
    'Task 1 should capture browser/bridge/orchestrator/artifact-root detection plus env-state output.',
    'Task 2 should wire the bootstrap module into the self-improvement run entrypoint.',
    'Task 3 should validate watcher usage, attachment evidence, env-state output, and operator documentation.',
    'For every acceptanceCriteria item, verificationMethod must be exactly one of these JSON string literals: "automated_test", "review", "manual", or "artifact".',
    'Never output verificationMethod values like "manual_review", "qa", "test", "check", or any other synonym.',
    'Use "review" for review-only checks, "manual" for operator/manual inspection, "artifact" for file or evidence deliverables, and "automated_test" only for executable tests.',
    'For every edge, kind must be exactly one JSON string literal: "blocks" or "informs".',
    'Never output edge kinds like "dependency", "depends_on", "prerequisite", or any other synonym.',
    'Use the attached analysis bundle first.',
  ].join('\n');
}

function buildRunToRunGovernorRequirementPrompt(): string {
  return [
    `Create a bounded self-improvement requirement freeze for todo ${activeGoalProfile.goal.todoId}: ${activeGoalProfile.goal.title}`,
    `The owned write surface is limited to: ${getActiveAllowedFiles().join(', ')}.`,
    'The deliverable must add a run-to-run governor that only acts between runs, never by changing gate semantics, acceptance rules, or task graph core semantics.',
    'Requirement output must define one explicit terminal-state detector, one exactly-one next-goal selector, and one iteration-cap stop policy.',
    'Requirement output must clearly separate automatic behavior inside one run from automatic behavior between runs.',
    'Use the attached analysis bundle first.',
  ].join('\n');
}

function buildRunToRunGovernorArchitecturePrompt(): string {
  return [
    `Create a minimal architecture freeze for todo ${activeGoalProfile.goal.todoId}: ${activeGoalProfile.goal.title}`,
    `The owned write surface must remain within: ${getActiveAllowedFiles().join(', ')}.`,
    'Keep the governor local to the bounded self-improvement entry flow. Small persisted state is allowed only for campaign tracking, goal selection, and terminal detection.',
    'Do not redesign gate semantics, acceptance semantics, or task graph core behavior.',
    'The architecture must distinguish run-scoped goal state from campaign-scoped governor state.',
    'Output must strictly satisfy the architecture freeze JSON schema.',
    'Every moduleDefinitions item must include a non-empty ownedPaths array.',
    'For every dependencyRules item, rule must be exactly "allow" or "deny".',
    'Use the attached analysis bundle as primary context.',
  ].join('\n');
}

function buildRunToRunGovernorTaskGraphPrompt(): string {
  return [
    `Generate a strictly bounded 3-task graph for todo ${activeGoalProfile.goal.todoId}: ${activeGoalProfile.goal.title}`,
    'Every task must set executorType to codex.',
    `Every task allowedFiles and scope.inScope must stay within ${getActiveAllowedFiles().join(', ')}.`,
    `Every task disallowedFiles must include ${getActiveDisallowedFiles().join(', ')}.`,
    'Every task scope.outOfScope must include gate semantics, acceptance rules, and task graph core semantics.',
    'Use these exact task titles in order: Terminal-state detection and goal state / Between-run governor and next-goal selection / Governor validation and documentation.',
    'Task 1 should add the explicit terminal-state detector and the run-scoped goal persistence needed for resume.',
    'Task 2 should add campaign state, next-goal selection, and iteration-cap stop policy to the bounded self-improvement entrypoint.',
    'Task 3 should update watcher output, docs, and tests so operators can distinguish automatic inside one run from automatic between runs.',
    'For every acceptanceCriteria item, verificationMethod must be exactly one of: "automated_test", "review", "manual", or "artifact".',
    'For every edge, kind must be exactly one of: "blocks" or "informs".',
    'Use the attached analysis bundle first.',
  ].join('\n');
}

async function finalizePlanningPhase(
  orchestratorBaseUrl: string,
  artifactDir: string,
  runId: string,
  phase: 'requirement' | 'architecture' | 'task-graph',
  maxWaitMs: number,
  pollMs: number,
): Promise<PlanningFinalizeCompleted> {
  const deadline = Date.now() + maxWaitMs;
  let lastPending: PlanningFinalizePending | null = null;
  let nextFinalizeAttemptAt = 0;
  const planningPhase = phaseKeyToPlanningPhase[phase];

  while (Date.now() <= deadline) {
    const persistedState = await readPersistedPlanningFinalizeState(
      artifactDir,
      runId,
      planningPhase,
    );
    if (hasUsablePersistedMaterializedResult(persistedState)) {
      return {
        status: 'completed',
        materializedResult: persistedState.materializedResult,
        materializedResultPath: persistedState.materializedResultPath,
      };
    }

    if (Date.now() >= nextFinalizeAttemptAt) {
      try {
        const result = await postJson<PlanningFinalizeCompleted | PlanningFinalizePending>(
          `${orchestratorBaseUrl}/api/runs/${runId}/${phase}-finalize`,
          {
            producer: 'run-real-self-improvement',
            metadata: buildActivePlanningMetadata(),
          },
          {
            timeoutMs: DRIVER_FINALIZE_REQUEST_TIMEOUT_MS,
          },
        );
        if (result.status === 'completed') {
          return result;
        }

        lastPending = result;
      } catch (error) {
        if (!isDurableFinalizeWaitError(error)) {
          throw error;
        }

        const persistedAfterTimeout = await readPersistedPlanningFinalizeState(
          artifactDir,
          runId,
          planningPhase,
        );
        if (hasUsablePersistedMaterializedResult(persistedAfterTimeout)) {
          return {
            status: 'completed',
            materializedResult: persistedAfterTimeout.materializedResult,
            materializedResultPath: persistedAfterTimeout.materializedResultPath,
          };
        }

        lastPending = derivePendingFromPersistedPlanningState(
          phase,
          persistedAfterTimeout,
          error,
        );
        nextFinalizeAttemptAt = Date.now() + Math.max(DRIVER_FINALIZE_RETRY_COOLDOWN_MS, pollMs);
      }
    }

    await sleep(pollMs);
  }

  if (lastPending) {
    throw new Error(
      `${phase} finalize timed out after ${maxWaitMs}ms: ${lastPending.error.code} ${lastPending.error.message}`,
    );
  }
  throw new Error(`${phase} finalize timed out after ${maxWaitMs}ms without a response.`);
}

const phaseKeyToPlanningPhase: Record<
  'requirement' | 'architecture' | 'task-graph',
  PlanningPhase
> = {
  requirement: 'requirement_freeze',
  architecture: 'architecture_freeze',
  'task-graph': 'task_graph_generation',
};

async function readPersistedPlanningFinalizeState(
  artifactDir: string,
  runId: string,
  phase: PlanningPhase,
): Promise<PersistedPlanningFinalizeState> {
  const materializedResultPath = getPlanningMaterializedResultFile(artifactDir, runId, phase);
  const finalizeRuntimeStatePath = getPlanningFinalizeRuntimeStateFile(artifactDir, runId, phase);
  const requestRuntimeStatePath = getPlanningRequestRuntimeStateFile(artifactDir, runId, phase);

  return {
    materializedResultPath,
    materializedResult: await readJsonFileIfExists(
      materializedResultPath,
      PlanningMaterializedResultSchema,
    ),
    finalizeRuntimeStatePath,
    finalizeRuntimeState: await readJsonFileIfExists(
      finalizeRuntimeStatePath,
      PlanningRuntimeStateSchema,
    ),
    requestRuntimeStatePath,
    requestRuntimeState: await readJsonFileIfExists(
      requestRuntimeStatePath,
      PlanningRuntimeStateSchema,
    ),
  };
}

function hasUsablePersistedMaterializedResult(
  state: PersistedPlanningFinalizeState,
): state is PersistedPlanningFinalizeState & { materializedResult: PlanningMaterializedResult } {
  if (!state.materializedResult) {
    return false;
  }

  const materializedPlanningId = state.materializedResult.planningId;
  const requestPlanningId = state.requestRuntimeState?.planningId;
  const finalizePlanningId = state.finalizeRuntimeState?.planningId;

  if (
    requestPlanningId &&
    requestPlanningId !== materializedPlanningId &&
    state.requestRuntimeState?.status !== 'planning_applied'
  ) {
    return false;
  }

  if (
    finalizePlanningId &&
    finalizePlanningId !== materializedPlanningId &&
    state.finalizeRuntimeState?.status !== 'planning_applied'
  ) {
    return false;
  }

  return true;
}

async function readJsonFileIfExists<T>(
  filePath: string,
  schema: { parse: (input: unknown) => T },
): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return schema.parse(parseJsonValue(raw));
  } catch {
    return null;
  }
}

function derivePendingFromPersistedPlanningState(
  phase: 'requirement' | 'architecture' | 'task-graph',
  state: PersistedPlanningFinalizeState,
  error: unknown,
): PlanningFinalizePending {
  const runtimeState = state.finalizeRuntimeState ?? state.requestRuntimeState;
  const runtimeStatus = runtimeState?.status ?? 'unknown';
  const conversationId = runtimeState?.conversationId ?? 'unlinked';
  const lastErrorMessage =
    error instanceof Error && error.message.trim().length > 0
      ? error.message
      : 'Finalize request is still running';

  return {
    status: 'pending',
    error: {
      code: 'PLANNING_FINALIZE_IN_PROGRESS',
      message: `${phase} finalize is continuing from persisted runtime state (${runtimeStatus}, conversationId=${conversationId}). Last driver wait error: ${lastErrorMessage}`,
    },
  };
}

function isDurableFinalizeWaitError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  if (message.startsWith('request timed out after') || message.includes('headers timeout')) {
    return true;
  }

  const cause = 'cause' in error ? (error as Error & { cause?: unknown }).cause : undefined;
  if (cause && typeof cause === 'object' && 'code' in cause) {
    return (cause as { code?: string }).code === 'UND_ERR_HEADERS_TIMEOUT';
  }

  return false;
}

function assertTaskGraphScope(payload: Record<string, unknown>): void {
  const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
  if (tasks.length !== 3) {
    throw new Error(
      `Expected exactly 3 tasks in the bounded task graph, received ${tasks.length}.`,
    );
  }

  for (const task of tasks) {
    if (!task || typeof task !== 'object') {
      throw new Error('Task graph payload contained a non-object task.');
    }
    const typedTask = task as {
      title?: unknown;
      allowedFiles?: unknown;
      scope?: { inScope?: unknown; outOfScope?: unknown } | undefined;
    };
    const allowedFiles = Array.isArray(typedTask.allowedFiles)
      ? typedTask.allowedFiles.filter((value): value is string => typeof value === 'string')
      : [];
    const inScope = Array.isArray(typedTask.scope?.inScope)
      ? typedTask.scope?.inScope.filter((value): value is string => typeof value === 'string')
      : [];
    const escaped =
      allowedFiles.length === 0 ||
      inScope.length === 0 ||
      allowedFiles.some((file) => !getActiveAllowedFiles().includes(file)) ||
      inScope.some((file) => !getActiveAllowedFiles().includes(file));
    if (escaped) {
      throw new Error(
        `Task graph escaped the bounded file scope for task "${String(typedTask.title ?? 'unknown')}".`,
      );
    }
  }
}

async function waitForRunToStart(
  orchestratorBaseUrl: string,
  runId: string,
  timeoutMs: number,
): Promise<RunSummaryResponse> {
  const deadline = Date.now() + timeoutMs;
  let lastSummary: RunSummaryResponse | null = null;

  while (Date.now() < deadline) {
    const summary = await getRunSummary(orchestratorBaseUrl, runId);
    lastSummary = summary;
    if (
      summary.runtimeState.status !== 'idle' ||
      summary.runtimeState.queuedJobs > 0 ||
      summary.runtimeState.runningJobs > 0 ||
      summary.run.stage !== 'foundation_ready'
    ) {
      return summary;
    }
    await sleep(5000);
  }

  if (!lastSummary) {
    throw new Error(`Timed out while waiting for run ${runId} to start.`);
  }
  return lastSummary;
}

async function getRunSummary(
  orchestratorBaseUrl: string,
  runId: string,
): Promise<RunSummaryResponse> {
  return getJson(`${orchestratorBaseUrl}/api/runs/${runId}/summary`);
}

async function markdownShowsAttachments(markdownPath: string | undefined): Promise<boolean> {
  if (!markdownPath) {
    return false;
  }
  try {
    const markdown = await fs.readFile(markdownPath, 'utf8');
    return markdown.includes('Attached files:');
  } catch {
    return false;
  }
}

function summarizePlanningArtifact(finalize: PlanningFinalizeCompleted): {
  materializedResultPath: string;
  markdownPath: string;
  structuredResultPath: string;
} {
  return {
    materializedResultPath: finalize.materializedResultPath,
    markdownPath: finalize.materializedResult.markdownPath,
    structuredResultPath: finalize.materializedResult.structuredResultPath,
  };
}

async function postJson<T>(
  url: string,
  body: Record<string, unknown>,
  options?: { timeoutMs?: number },
): Promise<T> {
  const controller =
    typeof options?.timeoutMs === 'number' && options.timeoutMs > 0
      ? new AbortController()
      : null;
  const timeoutHandle =
    controller && options?.timeoutMs
      ? setTimeout(() => {
          controller.abort(new Error(`Request timed out after ${options.timeoutMs}ms for ${url}`));
        }, options.timeoutMs)
      : null;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      ...(controller ? { signal: controller.signal } : {}),
    });
    const payload = parseDataEnvelope(await response.text(), url);
    if (!response.ok || !payload.ok) {
      throw new Error(`Request failed for ${url}: ${JSON.stringify(payload)}`);
    }
    return payload.data as T;
  } catch (error) {
    if (
      controller?.signal.aborted &&
      error instanceof Error &&
      error.name === 'AbortError' &&
      controller.signal.reason instanceof Error
    ) {
      throw controller.signal.reason;
    }
    throw error;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const payload = parseDataEnvelope(await response.text(), url);
  if (!response.ok || !payload.ok) {
    throw new Error(`Request failed for ${url}: ${JSON.stringify(payload)}`);
  }
  return payload.data as T;
}

function parseJsonValue(raw: string): unknown {
  return JSON.parse(raw) as unknown;
}

function parseDataEnvelope(
  raw: string,
  url: string,
): {
  ok: boolean;
  data: unknown;
} {
  const parsed = parseJsonValue(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`Request failed for ${url}: response body was not a JSON object`);
  }

  const record = parsed as Record<string, unknown>;
  if (typeof record.ok !== 'boolean') {
    throw new Error(`Request failed for ${url}: response body was missing a boolean ok field`);
  }

  return {
    ok: record.ok,
    data: record.data,
  };
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isMissingProcessError(error);
  }
}

function isMissingProcessError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ESRCH'
  );
}

function runGit(args: string[]): string {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  }
  return result.stdout.trimEnd();
}

function truncate(content: string, limit: number): string {
  if (content.length <= limit) {
    return content;
  }
  return `${content.slice(0, limit)}\n... [truncated]`;
}

function detectLanguage(filePath: string): string {
  if (filePath.endsWith('.ts')) {
    return 'ts';
  }
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) {
    return 'js';
  }
  if (filePath.endsWith('.json')) {
    return 'json';
  }
  if (filePath.endsWith('.md')) {
    return 'md';
  }
  if (filePath.endsWith('.patch') || filePath.endsWith('.diff')) {
    return 'diff';
  }
  return 'text';
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  void main();
}
