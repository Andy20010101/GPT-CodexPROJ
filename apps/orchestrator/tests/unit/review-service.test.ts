/* eslint-disable @typescript-eslint/require-await */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type {
  ArchitectureFreeze,
  ExecutionResult,
  ReviewRequest,
  ReviewResult,
  TaskEnvelope,
} from '../../src/contracts';
import { createRunRecord } from '../../src/domain/run';
import { assessTestEvidence } from '../../src/domain/execution';
import { BridgeClientError, type BridgeClient } from '../../src/services/bridge-client';
import { EvidenceLedgerService } from '../../src/services/evidence-ledger-service';
import { ReviewService } from '../../src/services/review-service';
import { FileEvidenceRepository } from '../../src/storage/file-evidence-repository';
import { FileReviewRepository } from '../../src/storage/file-review-repository';
import { createEmptyPatchSummary, parsePatchSummary } from '../../src/utils/patch-parser';
import {
  getExecutionPatchConvergenceFile,
  getReviewRuntimeStateFile,
} from '../../src/utils/run-paths';

const DEFAULT_PATCH_ARTIFACT_CONTENT = [
  'diff --git a/apps/orchestrator/src/services/review-service.ts b/apps/orchestrator/src/services/review-service.ts',
  'index 1111111..2222222 100644',
  '--- a/apps/orchestrator/src/services/review-service.ts',
  '+++ b/apps/orchestrator/src/services/review-service.ts',
  '@@ -1 +1,2 @@',
  ' export class ExistingReviewService {}',
  '+export class HardenedReviewEvidence {}',
].join('\n');

function buildTask(runId: string): TaskEnvelope {
  return {
    taskId: randomUUID(),
    runId,
    title: 'Review the execution',
    objective: 'Check the patch and test evidence',
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
        description: 'Review must be structured',
        verificationMethod: 'review',
        requiredEvidenceKinds: ['review_result'],
      },
    ],
    testPlan: [],
    implementationNotes: [],
    evidenceIds: [],
    metadata: {},
    status: 'review_pending',
    createdAt: '2026-04-02T10:00:00.000Z',
    updatedAt: '2026-04-02T10:00:00.000Z',
  };
}

function buildExecutionResult(runId: string, taskId: string): ExecutionResult {
  return {
    executionId: randomUUID(),
    runId,
    taskId,
    executorType: 'codex',
    status: 'succeeded',
    startedAt: '2026-04-02T10:01:00.000Z',
    finishedAt: '2026-04-02T10:02:00.000Z',
    summary: 'Execution completed.',
    patchSummary: parsePatchSummary(DEFAULT_PATCH_ARTIFACT_CONTENT, {
      patchPath: '/tmp/review-service.patch',
      notes: ['Patch captured for review-service unit tests.'],
    }),
    testResults: [
      {
        suite: 'vitest',
        status: 'passed',
        passed: 1,
        failed: 0,
        skipped: 0,
      },
    ],
    artifacts: [
      {
        artifactId: randomUUID(),
        kind: 'patch',
        label: 'Patch artifact',
        content: DEFAULT_PATCH_ARTIFACT_CONTENT,
        metadata: {},
      },
    ],
    stdout: '',
    stderr: '',
    exitCode: 0,
    metadata: {},
  };
}

function buildArchitectureFreeze(runId: string): ArchitectureFreeze {
  return {
    runId,
    summary: 'Freeze services',
    moduleDefinitions: [
      {
        moduleId: 'orchestrator',
        name: 'orchestrator',
        responsibility: 'control plane',
        ownedPaths: ['apps/orchestrator/src'],
        publicInterfaces: ['createOrchestratorService'],
        allowedDependencies: ['shared-contracts'],
      },
    ],
    dependencyRules: [
      {
        fromModuleId: 'orchestrator',
        toModuleId: 'shared-contracts',
        rule: 'allow',
        rationale: 'contracts',
      },
    ],
    invariants: ['No Puppeteer imports'],
    frozenAt: '2026-04-02T10:03:00.000Z',
    frozenBy: 'architect',
  };
}

async function seedCompletedTaskReview(input: {
  artifactDir: string;
  runId: string;
  task: TaskEnvelope;
  executionId: string;
  reviewId?: string | undefined;
  patchArtifactContent: string;
  status: 'approved' | 'changes_requested' | 'rejected' | 'incomplete';
  createdAt: string;
  timestamp: string;
}): Promise<{
  request: ReviewRequest;
  result: ReviewResult;
}> {
  const repository = new FileReviewRepository(input.artifactDir);
  const reviewId = input.reviewId ?? randomUUID();
  const patchSummary = parsePatchSummary(input.patchArtifactContent, {
    patchPath: `/tmp/${reviewId}.patch`,
    notes: ['Seeded completed review for convergence tests.'],
  });
  const request: ReviewRequest = {
    reviewId,
    runId: input.runId,
    taskId: input.task.taskId,
    executionId: input.executionId,
    reviewType: 'task_review',
    taskTitle: input.task.title,
    objective: input.task.objective,
    scope: input.task.scope,
    allowedFiles: input.task.allowedFiles,
    disallowedFiles: input.task.disallowedFiles,
    acceptanceCriteria: input.task.acceptanceCriteria,
    changedFiles: patchSummary.changedFiles,
    patchSummary,
    patchArtifactContent: input.patchArtifactContent,
    testResults: [
      {
        suite: 'vitest',
        status: 'passed',
        passed: 1,
        failed: 0,
        skipped: 0,
      },
    ],
    testEvidence: assessTestEvidence([
      {
        suite: 'vitest',
        status: 'passed',
        passed: 1,
        failed: 0,
        skipped: 0,
      },
    ]),
    executionSummary: 'Seeded prior review request.',
    architectureConstraints: [],
    relatedEvidenceIds: [],
    metadata: {},
    createdAt: input.createdAt,
  };
  const result: ReviewResult = {
    reviewId,
    runId: input.runId,
    taskId: input.task.taskId,
    executionId: input.executionId,
    status: input.status,
    summary: `Seeded ${input.status} review.`,
    findings: input.status === 'changes_requested' ? ['Review requested changes.'] : [],
    missingTests: [],
    architectureConcerns: [],
    recommendedActions:
      input.status === 'changes_requested' ? ['Change the implementation before resubmitting.'] : [],
    bridgeArtifacts: {},
    rawStructuredReview: null,
    metadata: {},
    timestamp: input.timestamp,
  };

  await repository.saveRequest(request);
  await repository.saveResult({
    result,
  });

  return {
    request,
    result,
  };
}

function createService(
  artifactDir: string,
  bridgeClient: BridgeClient,
  config?: {
    browserUrl?: string;
  },
): ReviewService {
  return new ReviewService(
    bridgeClient,
    new FileReviewRepository(artifactDir),
    new EvidenceLedgerService(new FileEvidenceRepository(artifactDir)),
    undefined,
    {
      browserUrl: config?.browserUrl ?? 'https://chatgpt.com/',
      projectName: 'Review Project',
      modelHint: 'gpt-5.4',
      maxWaitMs: 1000,
    },
  );
}

function withRuntimeBridgeMethods(
  overrides: Omit<
    BridgeClient,
    'getBridgeHealth' | 'listDriftIncidents' | 'resumeSession' | 'recoverConversation' | 'getSnapshot'
  > & {
    recoverConversation?: BridgeClient['recoverConversation'];
    getSnapshot?: BridgeClient['getSnapshot'];
  },
): BridgeClient {
  return {
    async getBridgeHealth() {
      return {
        status: 'ready',
        checkedAt: '2026-04-02T10:00:00.000Z',
        activeSessions: 1,
        activeConversations: 1,
        issues: [],
        metadata: {},
      };
    },
    async listDriftIncidents() {
      return [];
    },
    async resumeSession(sessionId) {
      return {
        session: {
          sessionId,
          browserUrl: 'https://chatgpt.com/',
          connectedAt: '2026-04-02T10:00:00.000Z',
        },
        health: {
          status: 'ready',
          checkedAt: '2026-04-02T10:00:00.000Z',
          activeSessions: 1,
          activeConversations: 1,
          issues: [],
          metadata: {},
        },
      };
    },
    async recoverConversation(conversationId) {
      return {
        snapshot: {
          conversationId,
          sessionId: randomUUID(),
          projectName: 'Review Project',
          status: 'completed',
          source: 'memory',
          messages: [],
          startedAt: '2026-04-02T10:00:00.000Z',
          updatedAt: '2026-04-02T10:01:00.000Z',
        },
        health: {
          status: 'ready',
          checkedAt: '2026-04-02T10:01:00.000Z',
          activeSessions: 1,
          activeConversations: 1,
          issues: [],
          metadata: {},
        },
      };
    },
    async getSnapshot(conversationId) {
      return {
        conversationId,
        sessionId: randomUUID(),
        projectName: 'Review Project',
        status: 'completed',
        source: 'memory',
        messages: [],
        startedAt: '2026-04-02T10:00:00.000Z',
        updatedAt: '2026-04-02T10:01:00.000Z',
      };
    },
    ...overrides,
  };
}

describe('ReviewService', () => {
  it('excludes source zip attachments from review conversation input files', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'review-service-input-files-'));
    const run = createRunRecord({
      title: 'Review run',
      createdBy: 'tester',
      stage: 'task_execution',
    });
    const task = buildTask(run.runId);
    const executionResult = buildExecutionResult(run.runId, task.taskId);
    const analysisBundleDir = path.join(artifactDir, 'runs', run.runId, 'analysis-bundle');
    await fs.mkdir(analysisBundleDir, { recursive: true });
    const repoSummaryPath = path.join(analysisBundleDir, 'repo-summary.md');
    const latestPatchPath = path.join(analysisBundleDir, 'latest.patch');
    const sourceZipPath = path.join(analysisBundleDir, 'source.zip');
    await fs.writeFile(repoSummaryPath, '# repo\n');
    await fs.writeFile(latestPatchPath, 'diff --git a/file b/file\n');
    await fs.writeFile(sourceZipPath, 'zip-bytes');
    await fs.writeFile(
      path.join(analysisBundleDir, 'manifest.json'),
      JSON.stringify({
        runId: run.runId,
        version: 1,
        createdAt: '2026-04-02T10:00:00.000Z',
        bundleDir: analysisBundleDir,
        files: [
          {
            kind: 'repo_summary',
            path: repoSummaryPath,
            relativePath: 'repo-summary.md',
            optional: false,
          },
          {
            kind: 'latest_patch',
            path: latestPatchPath,
            relativePath: 'latest.patch',
            optional: false,
          },
          {
            kind: 'source_zip',
            path: sourceZipPath,
            relativePath: 'source.zip',
            optional: true,
          },
        ],
      }),
    );

    let capturedInputFiles: string[] = [];
    const service = createService(
      artifactDir,
      withRuntimeBridgeMethods({
        async openSession() {
          return {
            sessionId: randomUUID(),
            browserUrl: 'https://chatgpt.com/',
            connectedAt: '2026-04-02T10:00:00.000Z',
          };
        },
        async selectProject(input) {
          return {
            sessionId: input.sessionId,
            browserUrl: 'https://chatgpt.com/',
            projectName: input.projectName,
            model: input.model,
            connectedAt: '2026-04-02T10:00:00.000Z',
          };
        },
        async startConversation(input) {
          capturedInputFiles = input.inputFiles ?? [];
          return {
            conversationId: randomUUID(),
            sessionId: input.sessionId,
            projectName: input.projectName ?? 'Review Project',
            model: input.model,
            status: 'running',
            source: 'memory',
            messages: [],
            startedAt: '2026-04-02T10:00:00.000Z',
            updatedAt: '2026-04-02T10:00:00.000Z',
          };
        },
        async sendMessage() {
          throw new Error('unexpected');
        },
        async waitForCompletion() {
          throw new Error('unexpected');
        },
        async exportMarkdown() {
          throw new Error('unexpected');
        },
        async extractStructuredReview() {
          throw new Error('unexpected');
        },
      }),
    );

    await service.requestExecutionReview({
      run,
      task,
      executionResult,
      producer: 'reviewer',
      attempt: 1,
    });

    expect(capturedInputFiles).toEqual([repoSummaryPath, latestPatchPath]);
  });

  it('writes review artifacts and evidence when bridge review succeeds', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'review-service-success-'));
    const run = createRunRecord({
      title: 'Review run',
      createdBy: 'tester',
      stage: 'task_execution',
    });
    const task = buildTask(run.runId);
    const executionResult = buildExecutionResult(run.runId, task.taskId);
    const service = createService(
      artifactDir,
      withRuntimeBridgeMethods({
        async openSession() {
          return {
            sessionId: randomUUID(),
            browserUrl: 'https://chatgpt.com/',
            connectedAt: '2026-04-02T10:00:00.000Z',
          };
        },
        async selectProject(input) {
          return {
            sessionId: input.sessionId,
            browserUrl: 'https://chatgpt.com/',
            projectName: input.projectName,
            model: input.model,
            connectedAt: '2026-04-02T10:00:00.000Z',
          };
        },
        async startConversation(input) {
          return {
            conversationId: randomUUID(),
            sessionId: input.sessionId,
            projectName: input.projectName ?? 'Review Project',
            model: input.model,
            status: 'running',
            source: 'memory',
            messages: [],
            startedAt: '2026-04-02T10:00:00.000Z',
            updatedAt: '2026-04-02T10:00:00.000Z',
          };
        },
        async sendMessage() {
          throw new Error('sendMessage should not be called on success');
        },
        async waitForCompletion(conversationId) {
          return {
            conversationId,
            sessionId: randomUUID(),
            projectName: 'Review Project',
            model: 'gpt-5.4',
            status: 'completed',
            source: 'memory',
            messages: [],
            startedAt: '2026-04-02T10:00:00.000Z',
            updatedAt: '2026-04-02T10:01:00.000Z',
            lastAssistantMessage: 'approved',
          };
        },
        async exportMarkdown() {
          return {
            artifactPath: '/bridge/review.md',
            manifestPath: '/bridge/review-manifest.json',
            markdown: '# review\napproved\n',
          };
        },
        async extractStructuredReview() {
          return {
            artifactPath: '/bridge/structured.json',
            manifestPath: '/bridge/structured-manifest.json',
            payload: {
              status: 'approved',
              summary: 'Review approved the task.',
              findings: [],
              missingTests: [],
              architectureConcerns: [],
              recommendedActions: [],
            },
          };
        },
      }),
    );

    const review = await service.reviewExecution({
      run,
      task,
      executionResult,
      producer: 'reviewer',
      architectureFreeze: buildArchitectureFreeze(run.runId),
    });

    expect(review.result.status).toBe('approved');
    expect(await fs.readFile(path.join(review.reviewDir, 'review.md'), 'utf8')).toContain(
      'approved',
    );
    expect(
      await fs.readFile(path.join(review.reviewDir, 'structured-review.json'), 'utf8'),
    ).toContain('"status": "approved"');
    expect(review.runtimeState.status).toBe('review_materializing');
    expect(review.evidence.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining([
        'review_request',
        'review_result',
        'bridge_markdown',
        'bridge_structured_review',
      ]),
    );
  });

  it('normalizes review changedFiles from the patch artifact before dispatch', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'review-service-patch-normalize-'));
    const run = createRunRecord({
      title: 'Review run',
      createdBy: 'tester',
      stage: 'task_execution',
    });
    const task = buildTask(run.runId);
    const patchArtifactContent = [
      'diff --git a/apps/orchestrator/src/contracts/index.ts b/apps/orchestrator/src/contracts/index.ts',
      'index 1111111..2222222 100644',
      '--- a/apps/orchestrator/src/contracts/index.ts',
      '+++ b/apps/orchestrator/src/contracts/index.ts',
      '@@ -1 +1,2 @@',
      " export * from './existing';",
      "+export * from './self-improvement-env';",
      'diff --git a/apps/orchestrator/src/contracts/self-improvement-env.ts b/apps/orchestrator/src/contracts/self-improvement-env.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/apps/orchestrator/src/contracts/self-improvement-env.ts',
      '@@ -0,0 +1,2 @@',
      '+export const bootstrapEnv = true;',
      '+',
    ].join('\n');
    const executionResult: ExecutionResult = {
      ...buildExecutionResult(run.runId, task.taskId),
      patchSummary: {
        changedFiles: ['stale/path.ts'],
        addedLines: 999,
        removedLines: 111,
        patchPath: '/tmp/stale.diff',
        notes: ['stale patch summary'],
      },
      artifacts: [
        {
          artifactId: randomUUID(),
          kind: 'patch',
          label: 'Patch artifact',
          content: patchArtifactContent,
          metadata: {},
        },
      ],
    };
    const service = createService(
      artifactDir,
      withRuntimeBridgeMethods({
        async openSession() {
          return {
            sessionId: randomUUID(),
            browserUrl: 'https://chatgpt.com/',
            connectedAt: '2026-04-02T10:00:00.000Z',
          };
        },
        async selectProject(input) {
          return {
            sessionId: input.sessionId,
            browserUrl: 'https://chatgpt.com/',
            projectName: input.projectName,
            model: input.model,
            connectedAt: '2026-04-02T10:00:00.000Z',
          };
        },
        async startConversation(input) {
          return {
            conversationId: randomUUID(),
            sessionId: input.sessionId,
            projectName: input.projectName ?? 'Review Project',
            model: input.model,
            status: 'running',
            source: 'memory',
            messages: [],
            startedAt: '2026-04-02T10:00:00.000Z',
            updatedAt: '2026-04-02T10:00:00.000Z',
          };
        },
        async sendMessage() {
          throw new Error('unexpected');
        },
        async waitForCompletion() {
          throw new Error('unexpected');
        },
        async exportMarkdown() {
          throw new Error('unexpected');
        },
        async extractStructuredReview() {
          throw new Error('unexpected');
        },
      }),
    );

    const requested = await service.requestExecutionReview({
      run,
      task,
      executionResult,
      producer: 'reviewer',
      attempt: 1,
    });

    expect(requested.request.changedFiles).toEqual([
      'apps/orchestrator/src/contracts/index.ts',
      'apps/orchestrator/src/contracts/self-improvement-env.ts',
    ]);
    expect(requested.request.patchSummary.changedFiles).toEqual([
      'apps/orchestrator/src/contracts/index.ts',
      'apps/orchestrator/src/contracts/self-improvement-env.ts',
    ]);
    expect(requested.request.patchSummary.patchPath).toBe('/tmp/stale.diff');
    expect(requested.request.patchArtifactContent).toContain(
      'apps/orchestrator/src/contracts/self-improvement-env.ts',
    );
    expect(requested.request.testEvidence).toMatchObject({
      grade: 'unit',
      strength: 'strong',
    });
  });

  it('fails closed when the execution summary references files missing from the patch artifact', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'review-service-patch-missing-'));
    const run = createRunRecord({
      title: 'Review run',
      createdBy: 'tester',
      stage: 'task_execution',
    });
    const task = buildTask(run.runId);
    const patchArtifactContent = [
      'diff --git a/apps/orchestrator/src/contracts/index.ts b/apps/orchestrator/src/contracts/index.ts',
      'index 1111111..2222222 100644',
      '--- a/apps/orchestrator/src/contracts/index.ts',
      '+++ b/apps/orchestrator/src/contracts/index.ts',
      '@@ -1 +1,2 @@',
      " export * from './existing';",
      "+export * from './self-improvement-env';",
    ].join('\n');
    const executionResult: ExecutionResult = {
      ...buildExecutionResult(run.runId, task.taskId),
      summary: [
        'Execution completed.',
        '',
        'Patch summary:',
        '- [apps/orchestrator/src/contracts/index.ts](/tmp/workspace/apps/orchestrator/src/contracts/index.ts): `+1/-0`.',
        '- [apps/orchestrator/src/contracts/self-improvement-env.ts](/tmp/workspace/apps/orchestrator/src/contracts/self-improvement-env.ts): `+168/-0`.',
        '',
        'Errors: none.',
      ].join('\n'),
      patchSummary: {
        changedFiles: ['apps/orchestrator/src/contracts/index.ts'],
        addedLines: 1,
        removedLines: 0,
        patchPath: '/tmp/patch.diff',
        notes: ['Patch generated by Codex runner.'],
      },
      artifacts: [
        {
          artifactId: randomUUID(),
          kind: 'patch',
          label: 'Patch artifact',
          content: patchArtifactContent,
          metadata: {},
        },
      ],
    };
    let openSessionCount = 0;
    const service = createService(
      artifactDir,
      withRuntimeBridgeMethods({
        async openSession() {
          openSessionCount += 1;
          return {
            sessionId: randomUUID(),
            browserUrl: 'https://chatgpt.com/',
            connectedAt: '2026-04-02T10:00:00.000Z',
          };
        },
        async selectProject() {
          throw new Error('unexpected');
        },
        async startConversation() {
          throw new Error('unexpected');
        },
        async sendMessage() {
          throw new Error('unexpected');
        },
        async waitForCompletion() {
          throw new Error('unexpected');
        },
        async exportMarkdown() {
          throw new Error('unexpected');
        },
        async extractStructuredReview() {
          throw new Error('unexpected');
        },
      }),
    );

    await expect(
      service.requestExecutionReview({
        run,
        task,
        executionResult,
        producer: 'reviewer',
        attempt: 1,
      }),
    ).rejects.toMatchObject({
      code: 'REVIEW_EVIDENCE_INCOMPLETE',
      details: expect.objectContaining({
        missingFiles: ['apps/orchestrator/src/contracts/self-improvement-env.ts'],
      }),
    });
    expect(openSessionCount).toBe(0);
  });

  it('fails closed when the patch artifact does not materialize any changed files before dispatch', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'review-service-empty-changed-'));
    const run = createRunRecord({
      title: 'Review run',
      createdBy: 'tester',
      stage: 'task_execution',
    });
    const task = buildTask(run.runId);
    const executionResult: ExecutionResult = {
      ...buildExecutionResult(run.runId, task.taskId),
      patchSummary: createEmptyPatchSummary(['Malformed patch artifact in unit test.']),
      artifacts: [
        {
          artifactId: randomUUID(),
          kind: 'patch',
          label: 'Malformed patch artifact',
          content: ['@@ -1 +1 @@', '+console.log("missing diff header");'].join('\n'),
          metadata: {},
        },
      ],
    };
    let openSessionCount = 0;
    const service = createService(
      artifactDir,
      withRuntimeBridgeMethods({
        async openSession() {
          openSessionCount += 1;
          throw new Error('unexpected');
        },
        async selectProject() {
          throw new Error('unexpected');
        },
        async startConversation() {
          throw new Error('unexpected');
        },
        async sendMessage() {
          throw new Error('unexpected');
        },
        async waitForCompletion() {
          throw new Error('unexpected');
        },
        async exportMarkdown() {
          throw new Error('unexpected');
        },
        async extractStructuredReview() {
          throw new Error('unexpected');
        },
      }),
    );

    await expect(
      service.requestExecutionReview({
        run,
        task,
        executionResult,
        producer: 'reviewer',
        attempt: 1,
      }),
    ).rejects.toMatchObject({
      code: 'REVIEW_EVIDENCE_INCOMPLETE',
      details: expect.objectContaining({
        failClosed: true,
        manualAttentionRequired: true,
        reason: 'changed_files_missing',
      }),
    });
    expect(openSessionCount).toBe(0);
  });

  it('fails closed when the patch artifact ends after a hunk header before dispatch', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'review-service-patch-truncated-'));
    const run = createRunRecord({
      title: 'Review run',
      createdBy: 'tester',
      stage: 'task_execution',
    });
    const task = buildTask(run.runId);
    const patchArtifactContent = [
      'diff --git a/apps/orchestrator/src/services/review-service.ts b/apps/orchestrator/src/services/review-service.ts',
      'index 1111111..2222222 100644',
      '--- a/apps/orchestrator/src/services/review-service.ts',
      '+++ b/apps/orchestrator/src/services/review-service.ts',
      '@@ -1 +1,2 @@',
    ].join('\n');
    const executionResult: ExecutionResult = {
      ...buildExecutionResult(run.runId, task.taskId),
      patchSummary: parsePatchSummary(patchArtifactContent, {
        patchPath: '/tmp/truncated.patch',
        notes: ['Patch capture ended unexpectedly during review evidence materialization.'],
      }),
      artifacts: [
        {
          artifactId: randomUUID(),
          kind: 'patch',
          label: 'Truncated patch artifact',
          content: patchArtifactContent,
          metadata: {},
        },
      ],
    };
    let openSessionCount = 0;
    const service = createService(
      artifactDir,
      withRuntimeBridgeMethods({
        async openSession() {
          openSessionCount += 1;
          throw new Error('unexpected');
        },
        async selectProject() {
          throw new Error('unexpected');
        },
        async startConversation() {
          throw new Error('unexpected');
        },
        async sendMessage() {
          throw new Error('unexpected');
        },
        async waitForCompletion() {
          throw new Error('unexpected');
        },
        async exportMarkdown() {
          throw new Error('unexpected');
        },
        async extractStructuredReview() {
          throw new Error('unexpected');
        },
      }),
    );

    await expect(
      service.requestExecutionReview({
        run,
        task,
        executionResult,
        producer: 'reviewer',
        attempt: 1,
      }),
    ).rejects.toMatchObject({
      code: 'REVIEW_EVIDENCE_INCOMPLETE',
      details: expect.objectContaining({
        failClosed: true,
        manualAttentionRequired: true,
        reason: 'patch_artifact_truncated',
        truncationReasons: expect.arrayContaining([
          'Patch artifact did not materialize a reviewable diff body for apps/orchestrator/src/services/review-service.ts.',
          'Patch artifact ended after a hunk header for apps/orchestrator/src/services/review-service.ts.',
        ]),
      }),
    });
    expect(openSessionCount).toBe(0);
  });

  it('fails closed when the patch artifact metadata already marks the diff as truncated', async () => {
    const artifactDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'review-service-patch-truncated-metadata-'),
    );
    const run = createRunRecord({
      title: 'Review run',
      createdBy: 'tester',
      stage: 'task_execution',
    });
    const task = buildTask(run.runId);
    const executionResult: ExecutionResult = {
      ...buildExecutionResult(run.runId, task.taskId),
      artifacts: [
        {
          artifactId: randomUUID(),
          kind: 'patch',
          label: 'Truncated patch artifact',
          content: DEFAULT_PATCH_ARTIFACT_CONTENT,
          metadata: {
            truncated: true,
            omittedLines: 48,
          },
        },
      ],
    };
    let openSessionCount = 0;
    const service = createService(
      artifactDir,
      withRuntimeBridgeMethods({
        async openSession() {
          openSessionCount += 1;
          throw new Error('unexpected');
        },
        async selectProject() {
          throw new Error('unexpected');
        },
        async startConversation() {
          throw new Error('unexpected');
        },
        async sendMessage() {
          throw new Error('unexpected');
        },
        async waitForCompletion() {
          throw new Error('unexpected');
        },
        async exportMarkdown() {
          throw new Error('unexpected');
        },
        async extractStructuredReview() {
          throw new Error('unexpected');
        },
      }),
    );

    await expect(
      service.requestExecutionReview({
        run,
        task,
        executionResult,
        producer: 'reviewer',
        attempt: 1,
      }),
    ).rejects.toMatchObject({
      code: 'REVIEW_EVIDENCE_INCOMPLETE',
      details: expect.objectContaining({
        failClosed: true,
        manualAttentionRequired: true,
        reason: 'patch_artifact_truncated',
        truncationReasons: expect.arrayContaining([
          'Patch artifact metadata marks the diff evidence as truncated.',
        ]),
      }),
    });
    expect(openSessionCount).toBe(0);
  });

  it('fails closed when changed files are declared but the patch artifact is missing before dispatch', async () => {
    const artifactDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'review-service-patch-artifact-missing-'),
    );
    const run = createRunRecord({
      title: 'Review run',
      createdBy: 'tester',
      stage: 'task_execution',
    });
    const task = buildTask(run.runId);
    const executionResult: ExecutionResult = {
      ...buildExecutionResult(run.runId, task.taskId),
      patchSummary: {
        changedFiles: ['apps/orchestrator/src/services/review-service.ts'],
        addedLines: 1,
        removedLines: 0,
        patchPath: '/tmp/review-service.patch',
        notes: ['Patch summary exists but patch artifact is missing.'],
      },
      artifacts: [],
    };
    let openSessionCount = 0;
    const service = createService(
      artifactDir,
      withRuntimeBridgeMethods({
        async openSession() {
          openSessionCount += 1;
          throw new Error('unexpected');
        },
        async selectProject() {
          throw new Error('unexpected');
        },
        async startConversation() {
          throw new Error('unexpected');
        },
        async sendMessage() {
          throw new Error('unexpected');
        },
        async waitForCompletion() {
          throw new Error('unexpected');
        },
        async exportMarkdown() {
          throw new Error('unexpected');
        },
        async extractStructuredReview() {
          throw new Error('unexpected');
        },
      }),
    );

    await expect(
      service.requestExecutionReview({
        run,
        task,
        executionResult,
        producer: 'reviewer',
        attempt: 1,
      }),
    ).rejects.toMatchObject({
      code: 'REVIEW_EVIDENCE_INCOMPLETE',
      details: expect.objectContaining({
        failClosed: true,
        manualAttentionRequired: true,
        reason: 'patch_artifact_missing',
      }),
    });
    expect(openSessionCount).toBe(0);
  });

  it('fails closed when test results are missing before dispatch', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'review-service-tests-missing-'));
    const run = createRunRecord({
      title: 'Review run',
      createdBy: 'tester',
      stage: 'task_execution',
    });
    const task = buildTask(run.runId);
    const executionResult: ExecutionResult = {
      ...buildExecutionResult(run.runId, task.taskId),
      testResults: [],
    };
    let openSessionCount = 0;
    const service = createService(
      artifactDir,
      withRuntimeBridgeMethods({
        async openSession() {
          openSessionCount += 1;
          throw new Error('unexpected');
        },
        async selectProject() {
          throw new Error('unexpected');
        },
        async startConversation() {
          throw new Error('unexpected');
        },
        async sendMessage() {
          throw new Error('unexpected');
        },
        async waitForCompletion() {
          throw new Error('unexpected');
        },
        async exportMarkdown() {
          throw new Error('unexpected');
        },
        async extractStructuredReview() {
          throw new Error('unexpected');
        },
      }),
    );

    await expect(
      service.requestExecutionReview({
        run,
        task,
        executionResult,
        producer: 'reviewer',
        attempt: 1,
      }),
    ).rejects.toMatchObject({
      code: 'REVIEW_EVIDENCE_INCOMPLETE',
      details: expect.objectContaining({
        failClosed: true,
        manualAttentionRequired: true,
        reason: 'test_results_missing',
      }),
    });
    expect(openSessionCount).toBe(0);
  });

  it('fails closed when only degraded review evidence remains before dispatch', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'review-service-test-evidence-'));
    const run = createRunRecord({
      title: 'Review run',
      createdBy: 'tester',
      stage: 'task_execution',
    });
    const task = buildTask(run.runId);
    const executionResult: ExecutionResult = {
      ...buildExecutionResult(run.runId, task.taskId),
      testResults: [
        {
          suite: 'tsc --noEmit',
          status: 'passed',
          passed: 1,
          failed: 0,
          skipped: 0,
        },
      ],
    };
    let openSessionCount = 0;
    const service = createService(
      artifactDir,
      withRuntimeBridgeMethods({
        async openSession() {
          openSessionCount += 1;
          throw new Error('unexpected');
        },
        async selectProject() {
          throw new Error('unexpected');
        },
        async startConversation() {
          throw new Error('unexpected');
        },
        async sendMessage() {
          throw new Error('unexpected');
        },
        async waitForCompletion() {
          throw new Error('unexpected');
        },
        async exportMarkdown() {
          throw new Error('unexpected');
        },
        async extractStructuredReview() {
          throw new Error('unexpected');
        },
      }),
    );

    await expect(
      service.requestExecutionReview({
        run,
        task,
        executionResult,
        producer: 'reviewer',
        attempt: 1,
      }),
    ).rejects.toMatchObject({
      code: 'REVIEW_EVIDENCE_INCOMPLETE',
      details: expect.objectContaining({
        failClosed: true,
        manualAttentionRequired: true,
        reason: 'review_evidence_degraded',
        degradedEvidenceKinds: ['test_evidence'],
        testEvidenceGrade: 'compile-check',
        testEvidenceStrength: 'weak',
      }),
    });
    expect(openSessionCount).toBe(0);
  });

  it('fails closed and persists convergence evidence when the same bad patch repeats after changes_requested', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'review-service-convergence-'));
    const run = createRunRecord({
      title: 'Review run',
      createdBy: 'tester',
      stage: 'task_execution',
    });
    const task = buildTask(run.runId);
    const currentExecutionResult = buildExecutionResult(run.runId, task.taskId);
    await seedCompletedTaskReview({
      artifactDir,
      runId: run.runId,
      task,
      executionId: randomUUID(),
      patchArtifactContent: DEFAULT_PATCH_ARTIFACT_CONTENT,
      status: 'changes_requested',
      createdAt: '2026-04-02T09:59:00.000Z',
      timestamp: '2026-04-02T10:00:00.000Z',
    });
    let openSessionCount = 0;
    const service = createService(
      artifactDir,
      withRuntimeBridgeMethods({
        async openSession() {
          openSessionCount += 1;
          throw new Error('unexpected');
        },
        async selectProject() {
          throw new Error('unexpected');
        },
        async startConversation() {
          throw new Error('unexpected');
        },
        async sendMessage() {
          throw new Error('unexpected');
        },
        async waitForCompletion() {
          throw new Error('unexpected');
        },
        async exportMarkdown() {
          throw new Error('unexpected');
        },
        async extractStructuredReview() {
          throw new Error('unexpected');
        },
      }),
    );

    let error: unknown;
    try {
      await service.requestExecutionReview({
        run,
        task,
        executionResult: currentExecutionResult,
        producer: 'reviewer',
        attempt: 1,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      code: 'REVIEW_PATCH_CONVERGENCE_FAILED',
      details: expect.objectContaining({
        failClosed: true,
        manualAttentionRequired: true,
        reason: 'repeated_patch_convergence',
        threshold: 2,
        consecutiveRepeatCount: 2,
        matchedHistory: [
          expect.objectContaining({
            reviewStatus: 'changes_requested',
            comparison: 'identical',
          }),
        ],
      }),
    });
    expect(openSessionCount).toBe(0);

    const convergencePath = getExecutionPatchConvergenceFile(
      artifactDir,
      run.runId,
      currentExecutionResult.executionId,
    );
    const convergenceRecord = JSON.parse(await fs.readFile(convergencePath, 'utf8')) as Record<
      string,
      unknown
    >;
    expect(convergenceRecord).toMatchObject({
      runId: run.runId,
      taskId: task.taskId,
      executionId: currentExecutionResult.executionId,
      status: 'manual_attention_required',
      reason: 'repeated_patch_convergence_failed',
      threshold: 2,
      consecutiveRepeatCount: 2,
      matchedHistory: [
        expect.objectContaining({
          reviewStatus: 'changes_requested',
          comparison: 'identical',
        }),
      ],
    });
  });

  it('fails closed when the latest bad patch is only effectively identical to the previous review', async () => {
    const artifactDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'review-service-convergence-effective-'),
    );
    const run = createRunRecord({
      title: 'Review run',
      createdBy: 'tester',
      stage: 'task_execution',
    });
    const task = buildTask(run.runId);
    const priorPatchArtifactContent = [
      'diff --git a/apps/orchestrator/src/services/review-service.ts b/apps/orchestrator/src/services/review-service.ts',
      'index aaaaaaa..bbbbbbb 100644',
      '--- a/apps/orchestrator/src/services/review-service.ts',
      '+++ b/apps/orchestrator/src/services/review-service.ts',
      '@@ -20 +20,2 @@',
      ' export class ExistingReviewService {}',
      '+export class HardenedReviewEvidence {}',
    ].join('\n');
    await seedCompletedTaskReview({
      artifactDir,
      runId: run.runId,
      task,
      executionId: randomUUID(),
      patchArtifactContent: priorPatchArtifactContent,
      status: 'changes_requested',
      createdAt: '2026-04-02T09:59:00.000Z',
      timestamp: '2026-04-02T10:00:00.000Z',
    });
    let openSessionCount = 0;
    const service = createService(
      artifactDir,
      withRuntimeBridgeMethods({
        async openSession() {
          openSessionCount += 1;
          throw new Error('unexpected');
        },
        async selectProject() {
          throw new Error('unexpected');
        },
        async startConversation() {
          throw new Error('unexpected');
        },
        async sendMessage() {
          throw new Error('unexpected');
        },
        async waitForCompletion() {
          throw new Error('unexpected');
        },
        async exportMarkdown() {
          throw new Error('unexpected');
        },
        async extractStructuredReview() {
          throw new Error('unexpected');
        },
      }),
    );

    await expect(
      service.requestExecutionReview({
        run,
        task,
        executionResult: buildExecutionResult(run.runId, task.taskId),
        producer: 'reviewer',
        attempt: 1,
      }),
    ).rejects.toMatchObject({
      code: 'REVIEW_PATCH_CONVERGENCE_FAILED',
      details: expect.objectContaining({
        matchedHistory: [
          expect.objectContaining({
            reviewStatus: 'changes_requested',
            comparison: 'effectively_identical',
          }),
        ],
      }),
    });
    expect(openSessionCount).toBe(0);
  });

  it('persists conversation state immediately after the request stage', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'review-service-request-'));
    const run = createRunRecord({
      title: 'Review run',
      createdBy: 'tester',
      stage: 'task_execution',
    });
    const task = buildTask(run.runId);
    const executionResult = buildExecutionResult(run.runId, task.taskId);
    const conversationId = randomUUID();
    const sessionId = randomUUID();
    const service = createService(
      artifactDir,
      withRuntimeBridgeMethods({
        async openSession() {
          return {
            sessionId,
            browserUrl: 'https://chatgpt.com/',
            connectedAt: '2026-04-02T10:00:00.000Z',
          };
        },
        async selectProject(input) {
          return {
            sessionId: input.sessionId,
            browserUrl: 'https://chatgpt.com/',
            projectName: input.projectName,
            model: input.model,
            connectedAt: '2026-04-02T10:00:00.000Z',
          };
        },
        async startConversation(input) {
          return {
            conversationId,
            sessionId: input.sessionId,
            projectName: input.projectName ?? 'Review Project',
            model: input.model,
            status: 'running',
            source: 'memory',
            messages: [],
            startedAt: '2026-04-02T10:00:00.000Z',
            updatedAt: '2026-04-02T10:00:00.000Z',
          };
        },
        async sendMessage() {
          throw new Error('unexpected');
        },
        async waitForCompletion() {
          throw new Error('unexpected');
        },
        async exportMarkdown() {
          throw new Error('unexpected');
        },
        async extractStructuredReview() {
          throw new Error('unexpected');
        },
      }),
    );

    const requested = await service.requestExecutionReview({
      run,
      task,
      executionResult,
      producer: 'reviewer',
      attempt: 1,
    });

    expect(requested.runtimeState.status).toBe('review_waiting');
    expect(requested.runtimeState.conversationId).toBe(conversationId);
    expect(requested.runtimeState.sessionId).toBe(sessionId);

    const persisted = JSON.parse(
      await fs.readFile(
        getReviewRuntimeStateFile(artifactDir, run.runId, requested.request.reviewId),
        'utf8',
      ),
    ) as { conversationId?: string; status: string };
    expect(persisted.conversationId).toBe(conversationId);
    expect(persisted.status).toBe('review_waiting');
  });

  it('overrides a stale runtime browser URL when retrying a review request', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'review-service-browser-url-'));
    const run = createRunRecord({
      title: 'Review run',
      createdBy: 'tester',
      stage: 'task_execution',
    });
    const task = buildTask(run.runId);
    const executionResult = buildExecutionResult(run.runId, task.taskId);

    const staleService = createService(
      artifactDir,
      withRuntimeBridgeMethods({
        async openSession() {
          throw new BridgeClientError('BRIDGE_FETCH_FAILED', 'fetch failed', 0);
        },
        async selectProject() {
          throw new Error('unexpected');
        },
        async startConversation() {
          throw new Error('unexpected');
        },
        async sendMessage() {
          throw new Error('unexpected');
        },
        async waitForCompletion() {
          throw new Error('unexpected');
        },
        async exportMarkdown() {
          throw new Error('unexpected');
        },
        async extractStructuredReview() {
          throw new Error('unexpected');
        },
      }),
      {
        browserUrl: 'http://172.18.144.1:9668',
      },
    );

    await expect(
      staleService.requestExecutionReview({
        run,
        task,
        executionResult,
        producer: 'reviewer',
        attempt: 1,
      }),
    ).rejects.toMatchObject({
      code: 'BRIDGE_FETCH_FAILED',
    });

    let observedBrowserUrl: string | undefined;
    const retriedService = createService(
      artifactDir,
      withRuntimeBridgeMethods({
        async openSession(input) {
          observedBrowserUrl = input.browserUrl;
          throw new BridgeClientError('BRIDGE_FETCH_FAILED', 'fetch failed', 0);
        },
        async selectProject() {
          throw new Error('unexpected');
        },
        async startConversation() {
          throw new Error('unexpected');
        },
        async sendMessage() {
          throw new Error('unexpected');
        },
        async waitForCompletion() {
          throw new Error('unexpected');
        },
        async exportMarkdown() {
          throw new Error('unexpected');
        },
        async extractStructuredReview() {
          throw new Error('unexpected');
        },
      }),
      {
        browserUrl: 'http://172.18.144.1:9224',
      },
    );

    await expect(
      retriedService.requestExecutionReview({
        run,
        task,
        executionResult,
        producer: 'reviewer',
        attempt: 2,
      }),
    ).rejects.toMatchObject({
      code: 'BRIDGE_FETCH_FAILED',
    });

    expect(observedBrowserUrl).toBe('http://172.18.144.1:9224');

    const repository = new FileReviewRepository(artifactDir);
    const request = await repository.findRequestByExecution({
      runId: run.runId,
      taskId: task.taskId,
      executionId: executionResult.executionId,
      reviewType: 'task_review',
    });
    expect(request?.reviewId).toBeDefined();

    const persisted = JSON.parse(
      await fs.readFile(
        getReviewRuntimeStateFile(artifactDir, run.runId, request!.reviewId),
        'utf8',
      ),
    ) as { browserUrl?: string; status: string };
    expect(persisted.status).toBe('review_requested');
    expect(persisted.browserUrl).toBe('http://172.18.144.1:9224');
  });

  it('retries finalization after wait failure by reusing the same conversation', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'review-service-wait-retry-'));
    const run = createRunRecord({
      title: 'Review run',
      createdBy: 'tester',
      stage: 'task_execution',
    });
    const task = buildTask(run.runId);
    const executionResult = buildExecutionResult(run.runId, task.taskId);
    const conversationId = randomUUID();
    let startConversationCount = 0;
    let waitCount = 0;

    const service = createService(
      artifactDir,
      withRuntimeBridgeMethods({
        async openSession() {
          return {
            sessionId: randomUUID(),
            browserUrl: 'https://chatgpt.com/',
            connectedAt: '2026-04-02T10:00:00.000Z',
          };
        },
        async selectProject(input) {
          return {
            sessionId: input.sessionId,
            browserUrl: 'https://chatgpt.com/',
            projectName: input.projectName,
            model: input.model,
            connectedAt: '2026-04-02T10:00:00.000Z',
          };
        },
        async startConversation(input) {
          startConversationCount += 1;
          return {
            conversationId,
            sessionId: input.sessionId,
            projectName: input.projectName ?? 'Review Project',
            model: input.model,
            status: 'running',
            source: 'memory',
            messages: [],
            startedAt: '2026-04-02T10:00:00.000Z',
            updatedAt: '2026-04-02T10:00:00.000Z',
          };
        },
        async sendMessage() {
          throw new Error('unexpected');
        },
        async waitForCompletion(id) {
          waitCount += 1;
          if (waitCount === 1) {
            throw new BridgeClientError('BRIDGE_FETCH_FAILED', 'fetch failed', 0);
          }
          return {
            conversationId: id,
            sessionId: randomUUID(),
            projectName: 'Review Project',
            model: 'gpt-5.4',
            status: 'completed',
            source: 'memory',
            messages: [],
            startedAt: '2026-04-02T10:00:00.000Z',
            updatedAt: '2026-04-02T10:01:00.000Z',
          };
        },
        async recoverConversation() {
          throw new BridgeClientError('BRIDGE_RECOVERY_FAILED', 'recover failed', 500);
        },
        async exportMarkdown() {
          return {
            artifactPath: '/bridge/review.md',
            manifestPath: '/bridge/review-manifest.json',
            markdown: '# review\napproved\n',
          };
        },
        async extractStructuredReview() {
          return {
            artifactPath: '/bridge/structured.json',
            manifestPath: '/bridge/structured-manifest.json',
            payload: {
              status: 'approved',
              summary: 'Review approved the task.',
              findings: [],
              missingTests: [],
              architectureConcerns: [],
              recommendedActions: [],
            },
          };
        },
      }),
    );

    const requested = await service.requestExecutionReview({
      run,
      task,
      executionResult,
      producer: 'reviewer',
      attempt: 1,
    });
    const firstFinalize = await service.finalizeExecutionReview({
      run,
      task,
      executionResult,
      reviewId: requested.request.reviewId,
      producer: 'reviewer',
      attempt: 1,
    });

    expect(firstFinalize.status).toBe('pending');
    if (firstFinalize.status !== 'pending') {
      throw new Error('expected pending finalization');
    }
    expect(firstFinalize.error.code).toBe('REVIEW_FINALIZE_RETRYABLE');
    expect(firstFinalize.runtimeState.status).toBe('review_waiting');

    const secondFinalize = await service.finalizeExecutionReview({
      run,
      task,
      executionResult,
      reviewId: requested.request.reviewId,
      producer: 'reviewer',
      attempt: 2,
    });

    expect(secondFinalize.status).toBe('completed');
    if (secondFinalize.status !== 'completed') {
      throw new Error('expected completed finalization');
    }
    expect(secondFinalize.result.status).toBe('approved');
    expect(startConversationCount).toBe(1);
    expect(waitCount).toBe(2);
    expect(secondFinalize.runtimeState.conversationId).toBe(conversationId);
  });

  it('retries finalization after ChatGPT wait timeout by reusing the same conversation', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'review-service-timeout-retry-'));
    const run = createRunRecord({
      title: 'Review run',
      createdBy: 'tester',
      stage: 'task_execution',
    });
    const task = buildTask(run.runId);
    const executionResult = buildExecutionResult(run.runId, task.taskId);
    const conversationId = randomUUID();
    let startConversationCount = 0;
    let waitCount = 0;
    let recoverCount = 0;

    const service = createService(
      artifactDir,
      withRuntimeBridgeMethods({
        async openSession() {
          return {
            sessionId: randomUUID(),
            browserUrl: 'https://chatgpt.com/',
            connectedAt: '2026-04-02T10:00:00.000Z',
          };
        },
        async selectProject(input) {
          return {
            sessionId: input.sessionId,
            browserUrl: 'https://chatgpt.com/',
            projectName: input.projectName,
            model: input.model,
            connectedAt: '2026-04-02T10:00:00.000Z',
          };
        },
        async startConversation(input) {
          startConversationCount += 1;
          return {
            conversationId,
            sessionId: input.sessionId,
            projectName: input.projectName ?? 'Review Project',
            model: input.model,
            status: 'running',
            source: 'memory',
            messages: [],
            startedAt: '2026-04-02T10:00:00.000Z',
            updatedAt: '2026-04-02T10:00:00.000Z',
          };
        },
        async sendMessage() {
          throw new Error('unexpected');
        },
        async waitForCompletion(id) {
          waitCount += 1;
          if (waitCount === 1) {
            throw new BridgeClientError(
              'CHATGPT_NOT_READY',
              'Conversation did not complete before timeout',
              504,
              {
                conversationId: id,
              },
            );
          }
          return {
            conversationId: id,
            sessionId: randomUUID(),
            projectName: 'Review Project',
            model: 'gpt-5.4',
            status: 'completed',
            source: 'memory',
            messages: [],
            startedAt: '2026-04-02T10:00:00.000Z',
            updatedAt: '2026-04-02T10:05:00.000Z',
            lastAssistantMessage: 'approved',
          };
        },
        async recoverConversation(id) {
          recoverCount += 1;
          return {
            snapshot: {
              conversationId: id,
              sessionId: randomUUID(),
              projectName: 'Review Project',
              model: 'gpt-5.4',
              status: 'running',
              source: 'memory',
              messages: [],
              startedAt: '2026-04-02T10:00:00.000Z',
              updatedAt: '2026-04-02T10:03:00.000Z',
            },
            health: {
              status: 'ready',
              checkedAt: '2026-04-02T10:03:00.000Z',
              activeSessions: 1,
              activeConversations: 1,
              issues: [],
              metadata: {},
            },
          };
        },
        async exportMarkdown() {
          return {
            artifactPath: '/bridge/review.md',
            manifestPath: '/bridge/review-manifest.json',
            markdown: '# review\napproved\n',
          };
        },
        async extractStructuredReview() {
          return {
            artifactPath: '/bridge/structured.json',
            manifestPath: '/bridge/structured-manifest.json',
            payload: {
              status: 'approved',
              summary: 'Review approved the task.',
              findings: [],
              missingTests: [],
              architectureConcerns: [],
              recommendedActions: [],
            },
          };
        },
      }),
    );

    const requested = await service.requestExecutionReview({
      run,
      task,
      executionResult,
      producer: 'reviewer',
      attempt: 1,
    });
    const firstFinalize = await service.finalizeExecutionReview({
      run,
      task,
      executionResult,
      reviewId: requested.request.reviewId,
      producer: 'reviewer',
      attempt: 1,
    });

    expect(firstFinalize.status).toBe('pending');
    if (firstFinalize.status !== 'pending') {
      throw new Error('expected pending finalization');
    }
    expect(firstFinalize.error.code).toBe('REVIEW_FINALIZE_RETRYABLE');
    expect(firstFinalize.runtimeState.status).toBe('review_waiting');

    const secondFinalize = await service.finalizeExecutionReview({
      run,
      task,
      executionResult,
      reviewId: requested.request.reviewId,
      producer: 'reviewer',
      attempt: 2,
    });

    expect(secondFinalize.status).toBe('completed');
    if (secondFinalize.status !== 'completed') {
      throw new Error('expected completed finalization');
    }
    expect(secondFinalize.result.status).toBe('approved');
    expect(startConversationCount).toBe(1);
    expect(waitCount).toBe(2);
    expect(recoverCount).toBe(1);
    expect(secondFinalize.runtimeState.conversationId).toBe(conversationId);
  });

  it('requeues the same review request when the recovered conversation is stalled and requires retry', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'review-service-stalled-retry-'));
    const run = createRunRecord({
      title: 'Review run',
      createdBy: 'tester',
      stage: 'task_execution',
    });
    const task = buildTask(run.runId);
    const executionResult = buildExecutionResult(run.runId, task.taskId);
    const conversationId = randomUUID();
    let startConversationCount = 0;
    let waitCount = 0;
    let recoverCount = 0;

    const service = createService(
      artifactDir,
      withRuntimeBridgeMethods({
        async openSession() {
          return {
            sessionId: randomUUID(),
            browserUrl: 'https://chatgpt.com/',
            connectedAt: '2026-04-02T10:00:00.000Z',
          };
        },
        async selectProject(input) {
          return {
            sessionId: input.sessionId,
            browserUrl: 'https://chatgpt.com/',
            projectName: input.projectName,
            model: input.model,
            connectedAt: '2026-04-02T10:00:00.000Z',
          };
        },
        async startConversation(input) {
          startConversationCount += 1;
          return {
            conversationId,
            sessionId: input.sessionId,
            projectName: input.projectName ?? 'Review Project',
            model: input.model,
            status: 'running',
            source: 'memory',
            messages: [],
            startedAt: '2026-04-02T10:00:00.000Z',
            updatedAt: '2026-04-02T10:00:00.000Z',
          };
        },
        async sendMessage() {
          throw new Error('unexpected');
        },
        async waitForCompletion(id) {
          waitCount += 1;
          throw new BridgeClientError(
            'CONVERSATION_UNAVAILABLE',
            'Conversation appears stalled while ChatGPT is offering a retry action.',
            503,
            { conversationId: id, retryVisible: true },
          );
        },
        async recoverConversation(id) {
          recoverCount += 1;
          return {
            snapshot: {
              conversationId: id,
              sessionId: randomUUID(),
              projectName: 'Review Project',
              model: 'gpt-5.4',
              status: 'failed',
              source: 'memory',
              messages: [],
              startedAt: '2026-04-02T10:00:00.000Z',
              updatedAt: '2026-04-02T10:03:00.000Z',
            },
            health: {
              status: 'ready',
              checkedAt: '2026-04-02T10:03:00.000Z',
              activeSessions: 1,
              activeConversations: 1,
              issues: [],
              metadata: {},
            },
          };
        },
        async exportMarkdown() {
          throw new Error('unexpected');
        },
        async extractStructuredReview() {
          throw new Error('unexpected');
        },
      }),
    );

    const requested = await service.requestExecutionReview({
      run,
      task,
      executionResult,
      producer: 'reviewer',
      attempt: 1,
    });
    const finalized = await service.finalizeExecutionReview({
      run,
      task,
      executionResult,
      reviewId: requested.request.reviewId,
      producer: 'reviewer',
      attempt: 1,
    });

    expect(finalized.status).toBe('pending');
    if (finalized.status !== 'pending') {
      throw new Error('expected pending finalization');
    }
    expect(finalized.runtimeState.status).toBe('review_requested');
    expect(finalized.error.code).toBe('REVIEW_FINALIZE_RETRYABLE');
    expect(waitCount).toBe(1);
    expect(recoverCount).toBe(0);

    const redelivered = await service.requestExecutionReview({
      run,
      task,
      executionResult,
      producer: 'reviewer',
      attempt: 2,
    });

    expect(redelivered.request.reviewId).toBe(requested.request.reviewId);
    expect(redelivered.runtimeState.status).toBe('review_waiting');
    expect(startConversationCount).toBe(2);
  });

  it('requeues the same review request when the conversation is gone after recovery was already attempted', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'review-service-missing-conversation-'));
    const run = createRunRecord({
      title: 'Review run',
      createdBy: 'tester',
      stage: 'task_execution',
    });
    const task = buildTask(run.runId);
    const executionResult = buildExecutionResult(run.runId, task.taskId);
    const conversationId = randomUUID();
    let startConversationCount = 0;

    const service = createService(
      artifactDir,
      withRuntimeBridgeMethods({
        async openSession() {
          return {
            sessionId: randomUUID(),
            browserUrl: 'https://chatgpt.com/',
            connectedAt: '2026-04-02T10:00:00.000Z',
          };
        },
        async selectProject(input) {
          return {
            sessionId: input.sessionId,
            browserUrl: 'https://chatgpt.com/',
            projectName: input.projectName,
            model: input.model,
            connectedAt: '2026-04-02T10:00:00.000Z',
          };
        },
        async startConversation(input) {
          startConversationCount += 1;
          return {
            conversationId,
            sessionId: input.sessionId,
            projectName: input.projectName ?? 'Review Project',
            model: input.model,
            status: 'running',
            source: 'memory',
            messages: [],
            startedAt: '2026-04-02T10:00:00.000Z',
            updatedAt: '2026-04-02T10:00:00.000Z',
          };
        },
        async sendMessage() {
          throw new Error('unexpected');
        },
        async waitForCompletion() {
          throw new BridgeClientError(
            'CONVERSATION_NOT_FOUND',
            'Conversation was not found',
            404,
            { conversationId },
          );
        },
        async exportMarkdown() {
          throw new Error('unexpected');
        },
        async extractStructuredReview() {
          throw new Error('unexpected');
        },
      }),
    );

    const requested = await service.requestExecutionReview({
      run,
      task,
      executionResult,
      producer: 'reviewer',
      attempt: 1,
    });

    const repository = new FileReviewRepository(artifactDir);
    await repository.saveRuntimeState({
      ...(await repository.getRuntimeState(run.runId, requested.request.reviewId))!,
      recoveryAttempted: true,
    });

    const finalized = await service.finalizeExecutionReview({
      run,
      task,
      executionResult,
      reviewId: requested.request.reviewId,
      producer: 'reviewer',
      attempt: 2,
    });

    expect(finalized.status).toBe('pending');
    if (finalized.status !== 'pending') {
      throw new Error('expected pending finalization');
    }
    expect(finalized.runtimeState.status).toBe('review_requested');

    const redelivered = await service.requestExecutionReview({
      run,
      task,
      executionResult,
      producer: 'reviewer',
      attempt: 3,
    });

    expect(redelivered.request.reviewId).toBe(requested.request.reviewId);
    expect(redelivered.runtimeState.status).toBe('review_waiting');
    expect(startConversationCount).toBe(2);
  });

  it('recovers materialization from the same conversation after export failure', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'review-service-export-retry-'));
    const run = createRunRecord({
      title: 'Review run',
      createdBy: 'tester',
      stage: 'task_execution',
    });
    const task = buildTask(run.runId);
    const executionResult = buildExecutionResult(run.runId, task.taskId);
    const conversationId = randomUUID();
    let startConversationCount = 0;
    let exportCount = 0;

    const service = createService(
      artifactDir,
      withRuntimeBridgeMethods({
        async openSession() {
          return {
            sessionId: randomUUID(),
            browserUrl: 'https://chatgpt.com/',
            connectedAt: '2026-04-02T10:00:00.000Z',
          };
        },
        async selectProject(input) {
          return {
            sessionId: input.sessionId,
            browserUrl: 'https://chatgpt.com/',
            projectName: input.projectName,
            model: input.model,
            connectedAt: '2026-04-02T10:00:00.000Z',
          };
        },
        async startConversation(input) {
          startConversationCount += 1;
          return {
            conversationId,
            sessionId: input.sessionId,
            projectName: input.projectName ?? 'Review Project',
            model: input.model,
            status: 'running',
            source: 'memory',
            messages: [],
            startedAt: '2026-04-02T10:00:00.000Z',
            updatedAt: '2026-04-02T10:00:00.000Z',
          };
        },
        async sendMessage() {
          throw new Error('unexpected');
        },
        async waitForCompletion(id) {
          return {
            conversationId: id,
            sessionId: randomUUID(),
            projectName: 'Review Project',
            model: 'gpt-5.4',
            status: 'completed',
            source: 'memory',
            messages: [],
            startedAt: '2026-04-02T10:00:00.000Z',
            updatedAt: '2026-04-02T10:01:00.000Z',
          };
        },
        async exportMarkdown() {
          exportCount += 1;
          if (exportCount === 1) {
            throw new BridgeClientError('BRIDGE_FETCH_FAILED', 'fetch failed', 0);
          }
          return {
            artifactPath: '/bridge/review.md',
            manifestPath: '/bridge/review-manifest.json',
            markdown: '# review\napproved\n',
          };
        },
        async extractStructuredReview() {
          return {
            artifactPath: '/bridge/structured.json',
            manifestPath: '/bridge/structured-manifest.json',
            payload: {
              status: 'approved',
              summary: 'Review approved the task.',
              findings: [],
              missingTests: [],
              architectureConcerns: [],
              recommendedActions: [],
            },
          };
        },
      }),
    );

    const requested = await service.requestExecutionReview({
      run,
      task,
      executionResult,
      producer: 'reviewer',
      attempt: 1,
    });
    const firstFinalize = await service.finalizeExecutionReview({
      run,
      task,
      executionResult,
      reviewId: requested.request.reviewId,
      producer: 'reviewer',
      attempt: 1,
    });

    expect(firstFinalize.status).toBe('pending');
    if (firstFinalize.status !== 'pending') {
      throw new Error('expected pending finalization');
    }
    expect(firstFinalize.error.code).toBe('REVIEW_MATERIALIZATION_PENDING');
    expect(firstFinalize.runtimeState.status).toBe('review_materializing');

    const secondFinalize = await service.finalizeExecutionReview({
      run,
      task,
      executionResult,
      reviewId: requested.request.reviewId,
      producer: 'reviewer',
      attempt: 2,
    });

    expect(secondFinalize.status).toBe('completed');
    if (secondFinalize.status !== 'completed') {
      throw new Error('expected completed finalization');
    }
    expect(secondFinalize.result.status).toBe('approved');
    expect(startConversationCount).toBe(1);
    expect(exportCount).toBe(2);
    expect(secondFinalize.runtimeState.conversationId).toBe(conversationId);
  });
});
