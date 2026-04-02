/* eslint-disable @typescript-eslint/require-await */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { createOrchestratorRuntimeBundle, type OrchestratorRuntimeBundle } from '../../src';
import type {
  ArchitectureFreeze,
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
  taskExtractError?: Error;
  releaseExtractError?: Error;
}): BridgeClient {
  const conversationKinds = new Map<string, 'task' | 'release'>();
  const sessionId = randomUUID();

  return {
    async openSession() {
      return {
        sessionId,
        browserUrl: 'https://chatgpt.com/',
        connectedAt: '2026-04-02T15:03:00.000Z',
      };
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
    async startConversation(input) {
      const conversationId = randomUUID();
      conversationKinds.set(
        conversationId,
        input.prompt.includes('# Release Review Request') ? 'release' : 'task',
      );
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
        artifactPath: `/bridge/${kind}-review.md`,
        manifestPath: `/bridge/${kind}-review-manifest.json`,
        markdown: `# ${kind} review\nstructured output follows\n`,
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

      const payload =
        kind === 'release'
          ? (options?.releaseReviewPayload ?? {
              status: 'approved',
              summary: 'Release review approved the run.',
              findings: [],
              outstandingLimitations: [],
              recommendedActions: [],
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
        artifactPath: `/bridge/${kind}-structured-review.json`,
        manifestPath: `/bridge/${kind}-structured-review-manifest.json`,
        payload,
      };
    },
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
      return next;
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
      pending?.resolve(response);
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
