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
    'getBridgeHealth' | 'listDriftIncidents' | 'resumeSession' | 'recoverConversation'
  >,
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
    expect(review.evidence.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining([
        'review_request',
        'review_result',
        'bridge_markdown',
        'bridge_structured_review',
      ]),
    );
  });

  it('returns incomplete when the bridge keeps missing structured output', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'review-service-missing-'));
    const run = createRunRecord({
      title: 'Review run',
      createdBy: 'tester',
      stage: 'task_execution',
    });
    const task = buildTask(run.runId);
    const executionResult = buildExecutionResult(run.runId, task.taskId);
    let sendMessageCount = 0;
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
            status: 'running',
            source: 'memory',
            messages: [],
            startedAt: '2026-04-02T10:00:00.000Z',
            updatedAt: '2026-04-02T10:00:00.000Z',
          };
        },
        async sendMessage() {
          sendMessageCount += 1;
          return {
            conversationId: randomUUID(),
            sessionId: randomUUID(),
            projectName: 'Review Project',
            status: 'running',
            source: 'memory',
            messages: [],
            startedAt: '2026-04-02T10:00:00.000Z',
            updatedAt: '2026-04-02T10:00:01.000Z',
          };
        },
        async waitForCompletion(conversationId) {
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
        async exportMarkdown() {
          return {
            artifactPath: '/bridge/review.md',
            manifestPath: '/bridge/review-manifest.json',
            markdown: '# review\nmissing json\n',
          };
        },
        async extractStructuredReview() {
          throw new BridgeClientError(
            'STRUCTURED_OUTPUT_NOT_FOUND',
            'Missing structured output',
            404,
          );
        },
      }),
    );

    const review = await service.reviewExecution({
      run,
      task,
      executionResult,
      producer: 'reviewer',
    });

    expect(sendMessageCount).toBe(1);
    expect(review.result.status).toBe('incomplete');
    expect(review.result.metadata.errorCode).toBe('REVIEW_STRUCTURED_OUTPUT_MISSING');
    expect(review.evidence.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining(['review_request', 'review_result', 'bridge_markdown']),
    );
  });

  it('returns incomplete when a bridge call fails before review extraction', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'review-service-bridge-fail-'));
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
          throw new BridgeClientError('SESSION_NOT_FOUND', 'No browser session', 404);
        },
        async selectProject() {
          throw new Error('unreachable');
        },
        async startConversation() {
          throw new Error('unreachable');
        },
        async sendMessage() {
          throw new Error('unreachable');
        },
        async waitForCompletion() {
          throw new Error('unreachable');
        },
        async exportMarkdown() {
          throw new Error('unreachable');
        },
        async extractStructuredReview() {
          throw new Error('unreachable');
        },
      }),
    );

    const review = await service.reviewExecution({
      run,
      task,
      executionResult,
      producer: 'reviewer',
    });

    expect(review.result.status).toBe('incomplete');
    expect(review.result.metadata.errorCode).toBe('REVIEW_BRIDGE_CALL_FAILED');
    expect(review.evidence.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining(['review_request', 'review_result']),
    );
  });
});
