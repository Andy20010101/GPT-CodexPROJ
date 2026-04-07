/* eslint-disable @typescript-eslint/require-await */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { ArchitectureFreeze, ExecutionResult, TaskEnvelope } from '../../src/contracts';
import { createRunRecord } from '../../src/domain/run';
import { BridgeClientError, type BridgeClient } from '../../src/services/bridge-client';
import { EvidenceLedgerService } from '../../src/services/evidence-ledger-service';
import { ReviewService } from '../../src/services/review-service';
import { FileEvidenceRepository } from '../../src/storage/file-evidence-repository';
import { FileReviewRepository } from '../../src/storage/file-review-repository';
import { createEmptyPatchSummary } from '../../src/utils/patch-parser';
import { getReviewRuntimeStateFile } from '../../src/utils/run-paths';

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
    patchSummary: createEmptyPatchSummary(['No patch body in this unit test.']),
    testResults: [
      {
        suite: 'vitest',
        status: 'passed',
        passed: 1,
        failed: 0,
        skipped: 0,
      },
    ],
    artifacts: [],
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

function createService(artifactDir: string, bridgeClient: BridgeClient): ReviewService {
  return new ReviewService(
    bridgeClient,
    new FileReviewRepository(artifactDir),
    new EvidenceLedgerService(new FileEvidenceRepository(artifactDir)),
    undefined,
    {
      browserUrl: 'https://chatgpt.com/',
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
