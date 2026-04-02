import { randomUUID } from 'node:crypto';

import type {
  EvidenceManifest,
  ReleaseReviewRequest,
  ReleaseReviewResult,
  TaskEnvelope,
} from '../contracts';
import { ReleaseReviewRequestSchema, ReleaseReviewResultSchema } from '../contracts';
import type { RunRecord } from '../domain/run';
import { FileEvidenceRepository } from '../storage/file-evidence-repository';
import { FileExecutionRepository } from '../storage/file-execution-repository';
import { FileReleaseRepository } from '../storage/file-release-repository';
import { FileTaskRepository } from '../storage/file-task-repository';
import { BridgeClient, BridgeClientError } from './bridge-client';
import { EvidenceLedgerService } from './evidence-ledger-service';

export type ReleaseReviewDispatch = {
  evidence: EvidenceManifest[];
  releaseDir: string;
  request: ReleaseReviewRequest;
  result: ReleaseReviewResult;
};

export class ReleaseReviewService {
  public constructor(
    private readonly bridgeClient: BridgeClient,
    private readonly releaseRepository: FileReleaseRepository,
    private readonly taskRepository: FileTaskRepository,
    private readonly executionRepository: FileExecutionRepository,
    private readonly evidenceRepository: FileEvidenceRepository,
    private readonly evidenceLedgerService: EvidenceLedgerService,
    private readonly config: {
      browserUrl: string;
      projectName: string;
      modelHint?: string | undefined;
      maxWaitMs: number;
    },
  ) {}

  public async reviewRun(input: {
    run: RunRecord;
    producer: string;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<ReleaseReviewDispatch> {
    const request = await this.buildRequest(input.run, input.metadata);
    const savedRequest = await this.releaseRepository.saveRequest(request);
    const evidence: EvidenceManifest[] = [];

    evidence.push(
      await this.evidenceLedgerService.appendEvidence({
        runId: request.runId,
        stage: input.run.stage,
        kind: 'release_review_request',
        timestamp: request.createdAt,
        producer: input.producer,
        artifactPaths: [savedRequest.requestPath],
        summary: `Prepared release review request ${request.releaseReviewId}`,
        metadata: {
          releaseReviewId: request.releaseReviewId,
        },
      }),
    );

    const prompt = buildReleaseReviewPrompt(request);
    const remediationPrompt = buildReleaseRemediationPrompt(request.releaseReviewId);
    let conversationId: string | undefined;
    let markdown: { artifactPath: string; manifestPath: string; markdown: string } | undefined;
    let structured:
      | { artifactPath: string; manifestPath: string; payload: Record<string, unknown> }
      | undefined;
    let bridgeError: { code: string; message: string; details?: unknown } | undefined;

    try {
      const session = await this.bridgeClient.openSession({
        browserUrl: this.config.browserUrl,
      });
      await this.bridgeClient.selectProject({
        sessionId: session.sessionId,
        projectName: this.config.projectName,
        ...(this.config.modelHint ? { model: this.config.modelHint } : {}),
      });
      const conversation = await this.bridgeClient.startConversation({
        sessionId: session.sessionId,
        projectName: this.config.projectName,
        ...(this.config.modelHint ? { model: this.config.modelHint } : {}),
        prompt,
        inputFiles: [],
      });
      conversationId = conversation.conversationId;
      await this.bridgeClient.waitForCompletion(conversation.conversationId, {
        maxWaitMs: this.config.maxWaitMs,
      });
      markdown = await this.bridgeClient.exportMarkdown(conversation.conversationId, {
        fileName: `${request.releaseReviewId}.md`,
      });
      try {
        structured = await this.bridgeClient.extractStructuredReview(conversation.conversationId, {
          fileName: `${request.releaseReviewId}.json`,
        });
      } catch (error) {
        const maybeBridgeError = this.toBridgeError(error);
        if (maybeBridgeError?.code === 'STRUCTURED_OUTPUT_NOT_FOUND') {
          await this.bridgeClient.sendMessage(conversation.conversationId, {
            message: remediationPrompt,
            inputFiles: [],
          });
          await this.bridgeClient.waitForCompletion(conversation.conversationId, {
            maxWaitMs: this.config.maxWaitMs,
          });
          markdown = await this.bridgeClient.exportMarkdown(conversation.conversationId, {
            fileName: `${request.releaseReviewId}.md`,
          });
          structured = await this.bridgeClient.extractStructuredReview(
            conversation.conversationId,
            {
              fileName: `${request.releaseReviewId}.json`,
            },
          );
        } else {
          throw error;
        }
      }
    } catch (error) {
      const maybeBridgeError = this.toBridgeError(error);
      bridgeError = maybeBridgeError ?? {
        code: 'RELEASE_REVIEW_FAILED',
        message: error instanceof Error ? error.message : 'Unknown release review failure',
      };
    }

    const result = buildReleaseReviewResult({
      request,
      structuredPayload: structured?.payload,
      bridgeArtifacts: {
        ...(conversationId ? { conversationId } : {}),
        ...(markdown
          ? {
              markdownPath: markdown.artifactPath,
              markdownManifestPath: markdown.manifestPath,
            }
          : {}),
        ...(structured
          ? {
              structuredReviewPath: structured.artifactPath,
              structuredReviewManifestPath: structured.manifestPath,
            }
          : {}),
      },
      metadata: {
        ...(bridgeError
          ? {
              errorCode:
                bridgeError.code === 'STRUCTURED_OUTPUT_NOT_FOUND'
                  ? 'REVIEW_STRUCTURED_OUTPUT_MISSING'
                  : 'RELEASE_REVIEW_FAILED',
              bridgeError,
            }
          : {}),
        ...(input.metadata ?? {}),
      },
      summaryFallback: bridgeError
        ? bridgeError.message
        : 'Structured release review output is missing from the bridge response.',
    });

    const savedResult = await this.releaseRepository.saveResult({
      result,
      markdown: markdown?.markdown,
      structuredReview: structured?.payload,
    });

    evidence.push(
      await this.evidenceLedgerService.appendEvidence({
        runId: result.runId,
        stage: input.run.stage,
        kind: 'release_review_result',
        timestamp: result.timestamp,
        producer: input.producer,
        artifactPaths: [savedResult.resultPath],
        summary: result.summary,
        metadata: {
          releaseReviewId: result.releaseReviewId,
          reviewStatus: result.status,
        },
      }),
    );

    if (savedResult.markdownPath) {
      evidence.push(
        await this.evidenceLedgerService.appendEvidence({
          runId: result.runId,
          stage: input.run.stage,
          kind: 'release_markdown',
          timestamp: result.timestamp,
          producer: input.producer,
          artifactPaths: [savedResult.markdownPath],
          summary: `Bridge markdown captured for release review ${result.releaseReviewId}`,
          metadata: {
            releaseReviewId: result.releaseReviewId,
          },
        }),
      );
    }

    if (savedResult.structuredReviewPath) {
      evidence.push(
        await this.evidenceLedgerService.appendEvidence({
          runId: result.runId,
          stage: input.run.stage,
          kind: 'release_structured_review',
          timestamp: result.timestamp,
          producer: input.producer,
          artifactPaths: [savedResult.structuredReviewPath],
          summary: `Structured release review JSON captured for ${result.releaseReviewId}`,
          metadata: {
            releaseReviewId: result.releaseReviewId,
            reviewStatus: result.status,
          },
        }),
      );
    }

    return {
      evidence,
      releaseDir: savedResult.releaseDir,
      request,
      result,
    };
  }

  private async buildRequest(
    run: RunRecord,
    metadata?: Record<string, unknown> | undefined,
  ): Promise<ReleaseReviewRequest> {
    const tasks = await this.taskRepository.listTasks(run.runId);
    const acceptedTasks = tasks.filter((task) => task.status === 'accepted');
    const executionSummaries = await Promise.all(
      acceptedTasks.map(async (task) => {
        const latestExecution = (
          await this.executionRepository.listResultsForTask(run.runId, task.taskId)
        )
          .sort((left, right) => left.finishedAt.localeCompare(right.finishedAt))
          .at(-1);

        return {
          task,
          latestExecution,
        };
      }),
    );
    const reviewEvidence = await this.evidenceRepository.listEvidenceForRun(run.runId);

    return ReleaseReviewRequestSchema.parse({
      releaseReviewId: randomUUID(),
      runId: run.runId,
      objective: `Determine whether run ${run.runId} is ready for final acceptance.`,
      runSummary: `${acceptedTasks.length} accepted task(s) out of ${tasks.length}.`,
      acceptedTasks: executionSummaries.map(({ task, latestExecution }) =>
        summarizeAcceptedTask(task, latestExecution?.summary),
      ),
      executionSummaries: executionSummaries
        .filter((entry) => entry.latestExecution)
        .map(({ task, latestExecution }) => ({
          executionId: latestExecution?.executionId as string,
          taskId: task.taskId,
          summary: latestExecution?.summary as string,
          status: latestExecution?.status as 'succeeded' | 'failed' | 'partial',
        })),
      reviewFindingsSummaries: reviewEvidence
        .filter((entry) => entry.kind === 'review_result')
        .map((entry) => entry.summary),
      outstandingLimitations: acceptedTasks.flatMap((task) =>
        task.implementationNotes.length > 0
          ? [`${task.title}: ${task.implementationNotes.at(-1)}`]
          : [],
      ),
      relatedEvidenceIds: reviewEvidence.map((entry) => entry.evidenceId),
      metadata: metadata ?? {},
      createdAt: new Date().toISOString(),
    });
  }

  private toBridgeError(
    error: unknown,
  ): { code: string; message: string; details?: unknown } | undefined {
    if (error instanceof BridgeClientError) {
      return {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      };
    }
    return undefined;
  }
}

function summarizeAcceptedTask(task: TaskEnvelope, summary?: string | undefined) {
  return {
    taskId: task.taskId,
    title: task.title,
    objective: task.objective,
    changedFiles: [],
    testSuites: task.testPlan.map((item) => item.id),
    summary: summary ?? `Task ${task.taskId} was accepted.`,
  };
}

function buildReleaseReviewPrompt(request: ReleaseReviewRequest): string {
  return [
    '# Release Review Request',
    `Release Review ID: ${request.releaseReviewId}`,
    `Run ID: ${request.runId}`,
    '',
    '## Objective',
    request.objective,
    '',
    '## Run Summary',
    request.runSummary,
    '',
    '## Accepted Tasks',
    ...request.acceptedTasks.map(
      (task) =>
        `- ${task.taskId}: ${task.title} | objective=${task.objective} | summary=${task.summary}`,
    ),
    '',
    '## Execution Summaries',
    ...(request.executionSummaries.length > 0
      ? request.executionSummaries.map(
          (item) =>
            `- ${item.executionId}: task=${item.taskId}, status=${item.status}, summary=${item.summary}`,
        )
      : ['- No execution summaries were found.']),
    '',
    '## Prior Review Findings',
    ...(request.reviewFindingsSummaries.length > 0
      ? request.reviewFindingsSummaries.map((item) => `- ${item}`)
      : ['- No prior findings were recorded.']),
    '',
    '## Outstanding Limitations',
    ...(request.outstandingLimitations.length > 0
      ? request.outstandingLimitations.map((item) => `- ${item}`)
      : ['- No additional limitations were recorded.']),
    '',
    '## Required Response Format',
    'First provide a short human-readable release review summary.',
    'Then include exactly one fenced JSON block with these keys:',
    '- status: approved | changes_requested | rejected | incomplete',
    '- summary: string',
    '- findings: string[]',
    '- outstandingLimitations: string[]',
    '- recommendedActions: string[]',
  ].join('\n');
}

function buildReleaseRemediationPrompt(releaseReviewId: string): string {
  return [
    `The previous answer for release review ${releaseReviewId} was missing the required structured JSON block.`,
    'Re-issue the release review and include exactly one fenced JSON block with keys:',
    'status, summary, findings, outstandingLimitations, recommendedActions.',
  ].join('\n');
}

function buildReleaseReviewResult(input: {
  request: ReleaseReviewRequest;
  structuredPayload?: Record<string, unknown> | undefined;
  bridgeArtifacts: ReleaseReviewResult['bridgeArtifacts'];
  metadata?: Record<string, unknown> | undefined;
  summaryFallback: string;
}): ReleaseReviewResult {
  const payload = input.structuredPayload ?? null;
  const status = readReleaseStatus(payload);
  const summary =
    (typeof payload?.summary === 'string' && payload.summary.trim().length > 0
      ? payload.summary.trim()
      : undefined) ?? input.summaryFallback;

  return ReleaseReviewResultSchema.parse({
    releaseReviewId: input.request.releaseReviewId,
    runId: input.request.runId,
    status,
    summary,
    findings: readStringArray(payload, ['findings', 'issues']),
    outstandingLimitations: readStringArray(payload, ['outstandingLimitations', 'limitations']),
    recommendedActions: readStringArray(payload, ['recommendedActions', 'nextActions']),
    bridgeArtifacts: input.bridgeArtifacts,
    rawStructuredReview: payload,
    metadata: input.metadata ?? {},
    timestamp: new Date().toISOString(),
  });
}

function readReleaseStatus(payload: Record<string, unknown> | null): ReleaseReviewResult['status'] {
  const value =
    typeof payload?.status === 'string'
      ? payload.status.toLowerCase()
      : typeof payload?.decision === 'string'
        ? payload.decision.toLowerCase()
        : undefined;

  switch (value) {
    case 'approved':
    case 'approve':
      return 'approved';
    case 'changes_requested':
    case 'changes-requested':
    case 'request_changes':
    case 'request-changes':
      return 'changes_requested';
    case 'rejected':
    case 'reject':
      return 'rejected';
    default:
      return 'incomplete';
  }
}

function readStringArray(
  payload: Record<string, unknown> | null,
  keys: readonly string[],
): string[] {
  if (!payload) {
    return [];
  }
  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value
        .map((item) => (typeof item === 'string' ? item.trim() : JSON.stringify(item)))
        .filter((item) => item.length > 0);
    }
  }
  return [];
}
