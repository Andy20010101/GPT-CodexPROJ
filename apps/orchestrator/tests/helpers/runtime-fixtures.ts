/* eslint-disable @typescript-eslint/require-await */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { createOrchestratorRuntimeBundle, type OrchestratorRuntimeBundle } from '../../src';
import type {
  ArchitectureFreeze,
  BridgeDriftIncident,
  BridgeHealthSummary,
  CleanupPolicy,
  RequirementFreeze,
  SchedulingPolicy,
  TaskEnvelope,
  TaskGraph,
} from '../../src/contracts';
import { BridgeClientError, type BridgeClient } from '../../src/services/bridge-client';
import type { CodexRunner, CodexRunnerResponse } from '../../src/services/codex-executor';
import { WorktreeService } from '../../src/services/worktree-service';

export function buildRequirementFreeze(runId: string): RequirementFreeze {
  return {
    runId,
    title: 'Runtime requirement freeze',
    summary: 'Freeze the multi-task runtime requirements.',
    objectives: ['Drive a multi-task run through execution, review, and acceptance.'],
    nonGoals: ['Build a distributed scheduler.'],
    constraints: [
      {
        id: 'constraint-1',
        title: 'Single process',
        description: 'Runtime must stay file-backed and single-process.',
        severity: 'hard',
      },
    ],
    risks: [],
    acceptanceCriteria: [
      {
        id: 'ac-1',
        description: 'Runtime writes job and review evidence.',
        verificationMethod: 'automated_test',
        requiredEvidenceKinds: ['job_record', 'review_result'],
      },
    ],
    frozenAt: '2026-04-02T15:00:00.000Z',
    frozenBy: 'architect',
  };
}

export function buildArchitectureFreeze(runId: string): ArchitectureFreeze {
  return {
    runId,
    summary: 'Freeze runtime, queue, and review boundaries.',
    moduleDefinitions: [
      {
        moduleId: 'orchestrator',
        name: 'orchestrator',
        responsibility: 'Control-plane and workflow runtime orchestration.',
        ownedPaths: ['apps/orchestrator/src'],
        publicInterfaces: ['createOrchestratorRuntimeBundle'],
        allowedDependencies: ['shared-contracts'],
      },
    ],
    dependencyRules: [
      {
        fromModuleId: 'orchestrator',
        toModuleId: 'shared-contracts',
        rule: 'allow',
        rationale: 'Reuse shared schemas.',
      },
    ],
    invariants: ['Runtime must not import puppeteer directly.'],
    frozenAt: '2026-04-02T15:01:00.000Z',
    frozenBy: 'architect',
  };
}

export function buildTask(runId: string, overrides: Partial<TaskEnvelope> = {}): TaskEnvelope {
  return {
    taskId: randomUUID(),
    runId,
    title: 'Runtime task',
    objective: 'Drive execution through runtime workers.',
    executorType: 'codex',
    scope: {
      inScope: ['apps/orchestrator/src/services'],
      outOfScope: ['services/chatgpt-web-bridge'],
    },
    allowedFiles: ['apps/orchestrator/src/services/**'],
    disallowedFiles: ['services/chatgpt-web-bridge/**'],
    dependencies: [],
    acceptanceCriteria: [
      {
        id: 'ac-1',
        description: 'Task reaches accepted with structured review evidence.',
        verificationMethod: 'automated_test',
        requiredEvidenceKinds: ['review_result'],
      },
    ],
    testPlan: [
      {
        id: 'tp-1',
        description: 'Document the failing test first.',
        verificationCommand: 'npm test',
        expectedRedSignal: 'red test',
        expectedGreenSignal: 'green test',
      },
    ],
    implementationNotes: [],
    evidenceIds: [],
    metadata: {},
    status: 'drafted',
    createdAt: '2026-04-02T15:02:00.000Z',
    updatedAt: '2026-04-02T15:02:00.000Z',
    ...overrides,
  };
}

export class FakeWorktreeService extends WorktreeService {
  public override async prepareWorkspace(input: { baseRepoPath: string; workspacePath: string }) {
    await fs.mkdir(input.workspacePath, { recursive: true });
    await fs.writeFile(path.join(input.workspacePath, 'README.md'), '# workspace\n', 'utf8');
    return {
      workspacePath: input.workspacePath,
      baseRepoPath: input.baseRepoPath,
      baseCommit: 'abc123',
      mode: 'git_worktree' as const,
    };
  }

  public override async cleanupWorkspace(input: { workspacePath: string }): Promise<void> {
    await fs.rm(input.workspacePath, { recursive: true, force: true });
  }

  public override async describeWorkspace(input: { workspacePath: string }) {
    return {
      workspacePath: input.workspacePath,
      baseRepoPath: '/tmp/base-repo',
      baseCommit: 'abc123',
      mode: 'git_worktree' as const,
    };
  }
}

export function createBridgeClient(options?: {
  taskReviewPayload?: Record<string, unknown>;
  releaseReviewPayload?: Record<string, unknown>;
  requirementPlanningPayload?: Record<string, unknown>;
  architecturePlanningPayload?: Record<string, unknown>;
  taskGraphPlanningPayload?: Record<string, unknown>;
  taskExtractError?: Error;
  releaseExtractError?: Error;
  requirementExtractError?: Error;
  architectureExtractError?: Error;
  taskGraphExtractError?: Error;
  bridgeHealth?: BridgeHealthSummary;
  driftIncidents?: BridgeDriftIncident[];
}): BridgeClient {
  const conversationKinds = new Map<
    string,
    'task' | 'release' | 'requirement' | 'architecture' | 'task_graph'
  >();
  const sessionId = randomUUID();
  const bridgeHealth = options?.bridgeHealth ?? {
    status: 'ready' as const,
    checkedAt: '2026-04-02T15:03:00.000Z',
    activeSessions: 1,
    activeConversations: conversationKinds.size,
    issues: [],
    metadata: {},
  };

  return {
    async openSession() {
      return {
        sessionId,
        browserUrl: 'https://chatgpt.com/',
        connectedAt: '2026-04-02T15:03:00.000Z',
      };
    },
    async getBridgeHealth() {
      return {
        ...bridgeHealth,
        activeConversations: conversationKinds.size,
      };
    },
    async listDriftIncidents() {
      return options?.driftIncidents ?? [];
    },
    async selectProject(input) {
      return {
        sessionId: input.sessionId,
        browserUrl: 'https://chatgpt.com/',
        projectName: input.projectName,
        model: input.model,
        connectedAt: '2026-04-02T15:03:00.000Z',
      };
    },
    async resumeSession(sessionId) {
      return {
        session: {
          sessionId,
          browserUrl: 'https://chatgpt.com/',
          projectName: 'Review Project',
          model: 'gpt-5.4',
          connectedAt: '2026-04-02T15:03:00.000Z',
        },
        health: {
          ...bridgeHealth,
          activeConversations: conversationKinds.size,
        },
      };
    },
    async startConversation(input) {
      const conversationId = randomUUID();
      conversationKinds.set(conversationId, classifyConversationKind(input.prompt));
      return {
        conversationId,
        sessionId: input.sessionId,
        projectName: input.projectName ?? 'Review Project',
        model: input.model,
        status: 'running',
        source: 'memory',
        messages: [],
        startedAt: '2026-04-02T15:03:00.000Z',
        updatedAt: '2026-04-02T15:03:00.000Z',
      };
    },
    async recoverConversation(conversationId) {
      return {
        snapshot: {
          conversationId,
          sessionId,
          projectName: 'Review Project',
          model: 'gpt-5.4',
          status: 'completed',
          source: 'memory',
          messages: [],
          startedAt: '2026-04-02T15:03:00.000Z',
          updatedAt: '2026-04-02T15:03:10.000Z',
        },
        health: {
          ...bridgeHealth,
          activeConversations: conversationKinds.size,
        },
      };
    },
    async getSnapshot(conversationId) {
      return {
        conversationId,
        sessionId,
        projectName: 'Review Project',
        model: 'gpt-5.4',
        status: 'completed',
        source: 'memory',
        messages: [],
        startedAt: '2026-04-02T15:03:00.000Z',
        updatedAt: '2026-04-02T15:03:10.000Z',
      };
    },
    async sendMessage(conversationId) {
      return {
        conversationId,
        sessionId,
        projectName: 'Review Project',
        status: 'running',
        source: 'memory',
        messages: [],
        startedAt: '2026-04-02T15:03:05.000Z',
        updatedAt: '2026-04-02T15:03:05.000Z',
      };
    },
    async waitForCompletion(conversationId) {
      return {
        conversationId,
        sessionId,
        projectName: 'Review Project',
        model: 'gpt-5.4',
        status: 'completed',
        source: 'memory',
        messages: [],
        startedAt: '2026-04-02T15:03:00.000Z',
        updatedAt: '2026-04-02T15:03:10.000Z',
      };
    },
    async exportMarkdown(conversationId) {
      const kind = conversationKinds.get(conversationId) ?? 'task';
      return {
        artifactPath: `/bridge/${kind}.md`,
        manifestPath: `/bridge/${kind}-manifest.json`,
        markdown: `# ${kind}\nstructured output follows\n`,
      };
    },
    async extractStructuredReview(conversationId) {
      const kind = conversationKinds.get(conversationId) ?? 'task';
      if (kind === 'task' && options?.taskExtractError) {
        throw options.taskExtractError;
      }
      if (kind === 'release' && options?.releaseExtractError) {
        throw options.releaseExtractError;
      }
      if (kind === 'requirement' && options?.requirementExtractError) {
        throw options.requirementExtractError;
      }
      if (kind === 'architecture' && options?.architectureExtractError) {
        throw options.architectureExtractError;
      }
      if (kind === 'task_graph' && options?.taskGraphExtractError) {
        throw options.taskGraphExtractError;
      }

      const payload =
        kind === 'release'
          ? (options?.releaseReviewPayload ?? {
              status: 'approved',
              summary: 'Release review approved the run.',
              findings: [],
              outstandingLimitations: [],
              recommendedActions: [],
            })
          : kind === 'requirement'
            ? (options?.requirementPlanningPayload ?? {
                title: 'Planning requirement freeze',
                summary: 'Freeze the fresh planning proof requirements.',
                objectives: ['Generate live planning before execution.'],
                nonGoals: ['Do not redesign the orchestrator.'],
                constraints: [
                  {
                    id: 'constraint-1',
                    title: 'Proof only',
                    description: 'Use the disposable validation target.',
                    severity: 'hard',
                  },
                ],
                risks: [],
                acceptanceCriteria: [
                  {
                    id: 'ac-1',
                    description: 'The run reaches an accepted first task.',
                    verificationMethod: 'automated_test',
                    requiredEvidenceKinds: ['execution_result', 'review_result'],
                  },
                ],
              })
            : kind === 'architecture'
              ? (options?.architecturePlanningPayload ?? {
                  summary: 'Architecture freeze for the disposable validation target.',
                  moduleDefinitions: [
                    {
                      moduleId: 'validation-target',
                      name: 'validation-target',
                      responsibility: 'Own the disposable user-api validation project.',
                      ownedPaths: ['tmp/e2e-targets/user-api-validation-1/**'],
                      publicInterfaces: ['src/app.ts'],
                      allowedDependencies: ['tests'],
                    },
                  ],
                  dependencyRules: [
                    {
                      fromModuleId: 'tests',
                      toModuleId: 'validation-target',
                      rule: 'allow',
                      rationale: 'Tests execute the disposable target.',
                    },
                  ],
                  invariants: ['Planning proof stays inside the disposable target.'],
                })
              : kind === 'task_graph'
                ? (options?.taskGraphPlanningPayload ?? {
                    tasks: [
                      {
                        title: 'Foundation repository and service',
                        objective: 'Create the repository and service foundation.',
                        allowedFiles: ['tmp/e2e-targets/user-api-validation-1/**'],
                        disallowedFiles: ['apps/**', 'services/**', 'packages/**'],
                        scope: {
                          inScope: ['tmp/e2e-targets/user-api-validation-1/**'],
                          outOfScope: ['apps/**', 'services/**', 'packages/**'],
                        },
                        dependencies: [],
                        acceptanceCriteria: [
                          {
                            description: 'Foundation code is present with test coverage.',
                            verificationMethod: 'automated_test',
                            requiredEvidenceKinds: ['execution_result', 'review_result'],
                          },
                        ],
                        testPlan: [
                          {
                            description: 'Run the stage 1 validation command.',
                            expectedRedSignal: 'red',
                            expectedGreenSignal: 'green',
                          },
                        ],
                        implementationNotes: ['Create the baseline files first.'],
                      },
                      {
                        title: 'TTL cache layer',
                        objective: 'Add TTL cache behavior.',
                        allowedFiles: ['tmp/e2e-targets/user-api-validation-1/**'],
                        disallowedFiles: ['apps/**', 'services/**', 'packages/**'],
                        scope: {
                          inScope: ['tmp/e2e-targets/user-api-validation-1/**'],
                          outOfScope: ['apps/**', 'services/**', 'packages/**'],
                        },
                        dependencies: ['Foundation repository and service'],
                        acceptanceCriteria: [
                          {
                            description: 'TTL cache behavior is implemented with tests.',
                            verificationMethod: 'automated_test',
                            requiredEvidenceKinds: ['execution_result', 'review_result'],
                          },
                        ],
                        testPlan: [
                          {
                            description: 'Run the stage 2 validation command.',
                            expectedRedSignal: 'red',
                            expectedGreenSignal: 'green',
                          },
                        ],
                        implementationNotes: ['Layer caching after the repository exists.'],
                      },
                      {
                        title: 'HTTP handler and structured errors',
                        objective: 'Add request handling and structured error paths.',
                        allowedFiles: ['tmp/e2e-targets/user-api-validation-1/**'],
                        disallowedFiles: ['apps/**', 'services/**', 'packages/**'],
                        scope: {
                          inScope: ['tmp/e2e-targets/user-api-validation-1/**'],
                          outOfScope: ['apps/**', 'services/**', 'packages/**'],
                        },
                        dependencies: ['TTL cache layer'],
                        acceptanceCriteria: [
                          {
                            description: 'HTTP and error behavior is covered by tests.',
                            verificationMethod: 'automated_test',
                            requiredEvidenceKinds: ['execution_result', 'review_result'],
                          },
                        ],
                        testPlan: [
                          {
                            description: 'Run the stage 3 validation command.',
                            expectedRedSignal: 'red',
                            expectedGreenSignal: 'green',
                          },
                        ],
                        implementationNotes: ['Wire the route after service and cache exist.'],
                      },
                    ],
                    edges: [],
                  })
          : (options?.taskReviewPayload ?? {
              status: 'approved',
              summary: 'Task review approved the change.',
              findings: [],
              missingTests: [],
              architectureConcerns: [],
              recommendedActions: [],
            });

      return {
        artifactPath: `/bridge/${kind}.json`,
        manifestPath: `/bridge/${kind}-structured-manifest.json`,
        payload,
      };
    },
  };
}

function classifyConversationKind(
  prompt: string,
): 'task' | 'release' | 'requirement' | 'architecture' | 'task_graph' {
  if (prompt.includes('# Release Review Request')) {
    return 'release';
  }
  if (prompt.includes('system requirement freeze agent')) {
    return 'requirement';
  }
  if (prompt.includes('system architecture freeze agent')) {
    return 'architecture';
  }
  if (prompt.includes('system task graph generation agent')) {
    return 'task_graph';
  }
  return 'task';
}

function normalizePatchForReviewFixture(patch: string): string {
  const normalized = patch.replace(/\r\n/g, '\n').trimEnd();
  const blocks: string[][] = [];
  let current: string[] | undefined;

  for (const line of normalized.split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (current) {
        blocks.push(current);
      }
      current = [line];
      continue;
    }

    if (current) {
      current.push(line);
    }
  }

  if (current) {
    blocks.push(current);
  }

  if (blocks.length === 0) {
    return patch;
  }

  return blocks.map((block) => normalizePatchBlock(block)).join('\n');
}

function normalizePatchBlock(block: readonly string[]): string {
  const [header, ...body] = block;
  if (!header) {
    return block.join('\n');
  }
  if (body.some((line) => /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/u.test(line))) {
    return block.join('\n');
  }

  const file = /^diff --git a\/(.+?) b\/(.+)$/u.exec(header)?.[2] ?? 'file.ts';
  const payload = body.filter((line) => {
    if (
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('@@ ')
    ) {
      return false;
    }

    return (
      line.startsWith(' ') ||
      line.startsWith('+') ||
      line.startsWith('-') ||
      line.startsWith('\\ No newline at end of file')
    );
  });
  const reviewablePayload = payload.length > 0 ? payload : ['+fixture change'];
  const newLineCount = Math.max(
    1,
    reviewablePayload.filter(
      (line) => !line.startsWith('-') && line !== '\\ No newline at end of file',
    ).length,
  );

  return [
    header,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -0,0 +1,${newLineCount} @@`,
    ...reviewablePayload,
  ].join('\n');
}

function normalizeCodexRunnerResponse(response: CodexRunnerResponse): CodexRunnerResponse {
  if (!response.patch) {
    return response;
  }

  return {
    ...response,
    patch: normalizePatchForReviewFixture(response.patch),
  };
}

export function createCodexRunnerSequence(
  sequence: Array<CodexRunnerResponse | Error>,
): CodexRunner {
  let index = 0;

  return {
    async run() {
      const next = sequence[index] ?? sequence.at(-1);
      index += 1;
      if (!next) {
        throw new Error('No runner response was configured');
      }
      if (next instanceof Error) {
        throw next;
      }
      return normalizeCodexRunnerResponse(next);
    },
  };
}

export function createControllableCodexRunner(initialResponse: CodexRunnerResponse) {
  const calls: number[] = [];
  let pending:
    | {
        resolve: (value: CodexRunnerResponse) => void;
        reject: (reason?: unknown) => void;
      }
    | undefined;

  const runner: CodexRunner = {
    async run() {
      calls.push(Date.now());
      return new Promise<CodexRunnerResponse>((resolve, reject) => {
        pending = {
          resolve,
          reject,
        };
      });
    },
  };

  return {
    runner,
    callCount(): number {
      return calls.length;
    },
    resolve(response: CodexRunnerResponse = initialResponse): void {
      pending?.resolve(normalizeCodexRunnerResponse(response));
      pending = undefined;
    },
    reject(error: Error): void {
      pending?.reject(error);
      pending = undefined;
    },
  };
}

export async function createArtifactDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function waitForCondition(
  check: () => boolean | Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out after ${timeoutMs}ms`);
}

export async function bootstrapRuntimeBundle(input: {
  artifactDir: string;
  tasks: TaskEnvelope[];
  edges?: TaskGraph['edges'];
  bridgeClient?: BridgeClient;
  codexRunner?: CodexRunner;
  worktreeService?: WorktreeService;
  daemonWorkerCount?: number;
  schedulingPolicy?: SchedulingPolicy;
  workspaceCleanupPolicy?: CleanupPolicy;
}): Promise<{
  bundle: OrchestratorRuntimeBundle;
  runId: string;
}> {
  const bundle = createOrchestratorRuntimeBundle({
    artifactDir: input.artifactDir,
    bridgeClient: input.bridgeClient ?? createBridgeClient(),
    codexRunner:
      input.codexRunner ??
      createCodexRunnerSequence([
        {
          status: 'succeeded',
          summary: 'Codex CLI completed the task.',
          stdout: 'done',
          stderr: '',
          exitCode: 0,
          patch: 'diff --git a/file.ts b/file.ts\n+change\n',
          testResults: [
            {
              suite: 'vitest',
              status: 'passed',
              passed: 1,
              failed: 0,
              skipped: 0,
            },
          ],
          metadata: {},
        },
      ]),
    worktreeService: input.worktreeService ?? new FakeWorktreeService(),
    ...(input.daemonWorkerCount ? { daemonWorkerCount: input.daemonWorkerCount } : {}),
    ...(input.schedulingPolicy ? { schedulingPolicy: input.schedulingPolicy } : {}),
    ...(input.workspaceCleanupPolicy
      ? { workspaceCleanupPolicy: input.workspaceCleanupPolicy }
      : {}),
  });
  const run = await bundle.orchestratorService.createRun({
    title: 'Runtime run',
    createdBy: 'tester',
  });
  await bundle.orchestratorService.saveRequirementFreeze(
    run.runId,
    buildRequirementFreeze(run.runId),
  );
  await bundle.orchestratorService.evaluateGate({
    runId: run.runId,
    gateType: 'requirement_gate',
    evaluator: 'tester',
  });
  await bundle.orchestratorService.saveArchitectureFreeze(
    run.runId,
    buildArchitectureFreeze(run.runId),
  );
  await bundle.orchestratorService.evaluateGate({
    runId: run.runId,
    gateType: 'architecture_gate',
    evaluator: 'tester',
  });
  await bundle.orchestratorService.registerTaskGraph(run.runId, {
    runId: run.runId,
    tasks: input.tasks.map((task) => ({
      ...task,
      runId: run.runId,
    })),
    edges: input.edges ?? [],
    registeredAt: '2026-04-02T15:04:00.000Z',
  });
  return {
    bundle,
    runId: run.runId,
  };
}

export function missingStructuredOutputError(
  message = 'Structured output missing.',
): BridgeClientError {
  return new BridgeClientError('STRUCTURED_OUTPUT_NOT_FOUND', message, 404);
}
