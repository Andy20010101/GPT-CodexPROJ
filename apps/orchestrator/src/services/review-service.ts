import { randomUUID } from 'node:crypto';

import type {
  ArchitectureFreeze,
  EvidenceManifest,
  ExecutionResult,
  ReviewEvidence,
  ReviewRequest,
  ReviewResult,
  ReviewType,
  TaskEnvelope,
} from '../contracts';
import { ReviewEvidenceSchema, ReviewRequestSchema } from '../contracts';
import type { RunRecord } from '../domain/run';
import { FileReviewRepository } from '../storage/file-review-repository';
import { normalizeReviewResult } from '../utils/review-result-normalizer';
import { BridgeClient, BridgeClientError } from './bridge-client';
import { EvidenceLedgerService } from './evidence-ledger-service';
import { ReviewPayloadBuilder } from './review-payload-builder';

export type ReviewDispatch = {
  evidence: EvidenceManifest[];
  reviewDir: string;
  reviewEvidence: ReviewEvidence;
  request: ReviewRequest;
  result: ReviewResult;
};

export class ReviewService {
  public constructor(
    private readonly bridgeClient: BridgeClient,
    private readonly reviewRepository: FileReviewRepository,
    private readonly evidenceLedgerService: EvidenceLedgerService,
    private readonly payloadBuilder: ReviewPayloadBuilder = new ReviewPayloadBuilder(),
    private readonly config: {
      browserUrl: string;
      projectName: string;
      modelHint?: string | undefined;
      maxWaitMs: number;
    },
  ) {}

  public async reviewExecution(input: {
    run: RunRecord;
    task: TaskEnvelope;
    executionResult: ExecutionResult;
    reviewType?: ReviewType | undefined;
    producer: string;
    architectureFreeze?: ArchitectureFreeze | null | undefined;
    relatedEvidenceIds?: readonly string[] | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<ReviewDispatch> {
    const request = this.buildRequest(input);
    const savedRequest = await this.reviewRepository.saveRequest(request);
    const evidence: EvidenceManifest[] = [];

    evidence.push(
      await this.evidenceLedgerService.appendEvidence({
        runId: request.runId,
        taskId: request.taskId,
        stage: input.run.stage,
        kind: 'review_request',
        timestamp: request.createdAt,
        producer: input.producer,
        artifactPaths: [savedRequest.requestPath],
        summary: `Prepared ${request.reviewType} request for execution ${request.executionId}`,
        metadata: {
          reviewId: request.reviewId,
        },
      }),
    );

    const payload = this.payloadBuilder.build(request);
    let conversationId: string | undefined;
    let bridgeMarkdown:
      | { artifactPath: string; manifestPath: string; markdown: string }
      | undefined;
    let structuredReview:
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
        prompt: payload.prompt,
        inputFiles: [],
      });
      conversationId = conversation.conversationId;
      await this.bridgeClient.waitForCompletion(conversation.conversationId, {
        maxWaitMs: this.config.maxWaitMs,
      });
      bridgeMarkdown = await this.bridgeClient.exportMarkdown(conversation.conversationId, {
        fileName: `${request.reviewId}.md`,
      });

      try {
        structuredReview = await this.bridgeClient.extractStructuredReview(
          conversation.conversationId,
          {
            fileName: `${request.reviewId}.json`,
          },
        );
      } catch (error) {
        const maybeBridgeError = this.toBridgeError(error);
        if (maybeBridgeError?.code === 'STRUCTURED_OUTPUT_NOT_FOUND') {
          await this.bridgeClient.sendMessage(conversation.conversationId, {
            message: payload.remediationPrompt,
            inputFiles: [],
          });
          await this.bridgeClient.waitForCompletion(conversation.conversationId, {
            maxWaitMs: this.config.maxWaitMs,
          });
          bridgeMarkdown = await this.bridgeClient.exportMarkdown(conversation.conversationId, {
            fileName: `${request.reviewId}.md`,
          });
          structuredReview = await this.bridgeClient.extractStructuredReview(
            conversation.conversationId,
            {
              fileName: `${request.reviewId}.json`,
            },
          );
        } else {
          throw error;
        }
      }
    } catch (error) {
      const maybeBridgeError = this.toBridgeError(error);
      bridgeError = maybeBridgeError ?? {
        code: 'REVIEW_BRIDGE_CALL_FAILED',
        message: error instanceof Error ? error.message : 'Unknown review bridge failure',
      };
    }

    const result =
      bridgeError || !structuredReview
        ? normalizeReviewResult({
            request,
            payload: structuredReview?.payload,
            bridgeArtifacts: {
              ...(conversationId ? { conversationId } : {}),
              ...(bridgeMarkdown
                ? {
                    markdownPath: bridgeMarkdown.artifactPath,
                    markdownManifestPath: bridgeMarkdown.manifestPath,
                  }
                : {}),
              ...(structuredReview
                ? {
                    structuredReviewPath: structuredReview.artifactPath,
                    structuredReviewManifestPath: structuredReview.manifestPath,
                  }
                : {}),
            },
            summaryFallback: bridgeError
              ? bridgeError.message
              : 'Structured review output is missing from the bridge response.',
            metadata: {
              ...(bridgeError
                ? {
                    errorCode:
                      bridgeError.code === 'STRUCTURED_OUTPUT_NOT_FOUND'
                        ? 'REVIEW_STRUCTURED_OUTPUT_MISSING'
                        : 'REVIEW_BRIDGE_CALL_FAILED',
                    bridgeError,
                  }
                : {
                    errorCode: 'REVIEW_STRUCTURED_OUTPUT_MISSING',
                  }),
              ...(input.metadata ?? {}),
            },
          })
        : normalizeReviewResult({
            request,
            payload: structuredReview.payload,
            bridgeArtifacts: {
              ...(conversationId ? { conversationId } : {}),
              markdownPath: bridgeMarkdown?.artifactPath,
              markdownManifestPath: bridgeMarkdown?.manifestPath,
              structuredReviewPath: structuredReview.artifactPath,
              structuredReviewManifestPath: structuredReview.manifestPath,
            },
            metadata: input.metadata,
          });

    const savedResult = await this.reviewRepository.saveResult({
      result,
      markdown: bridgeMarkdown?.markdown,
      structuredReview: structuredReview?.payload,
    });

    evidence.push(
      await this.evidenceLedgerService.appendEvidence({
        runId: result.runId,
        taskId: result.taskId,
        stage: input.run.stage,
        kind: 'review_result',
        timestamp: result.timestamp,
        producer: input.producer,
        artifactPaths: [savedResult.resultPath],
        summary: result.summary,
        metadata: {
          reviewId: result.reviewId,
          reviewStatus: result.status,
        },
      }),
    );

    if (savedResult.markdownPath) {
      evidence.push(
        await this.evidenceLedgerService.appendEvidence({
          runId: result.runId,
          taskId: result.taskId,
          stage: input.run.stage,
          kind: 'bridge_markdown',
          timestamp: result.timestamp,
          producer: input.producer,
          artifactPaths: [savedResult.markdownPath],
          summary: `Bridge markdown captured for review ${result.reviewId}`,
          metadata: {
            reviewId: result.reviewId,
            bridgeArtifactPath: bridgeMarkdown?.artifactPath,
          },
        }),
      );
    }

    if (savedResult.structuredReviewPath) {
      evidence.push(
        await this.evidenceLedgerService.appendEvidence({
          runId: result.runId,
          taskId: result.taskId,
          stage: input.run.stage,
          kind: 'bridge_structured_review',
          timestamp: result.timestamp,
          producer: input.producer,
          artifactPaths: [savedResult.structuredReviewPath],
          summary: `Structured review JSON captured for review ${result.reviewId}`,
          metadata: {
            reviewId: result.reviewId,
            reviewStatus: result.status,
            bridgeArtifactPath: structuredReview?.artifactPath,
          },
        }),
      );
    }

    return {
      evidence,
      reviewDir: savedResult.reviewDir,
      reviewEvidence: ReviewEvidenceSchema.parse({
        reviewId: request.reviewId,
        runId: request.runId,
        taskId: request.taskId,
        executionId: request.executionId,
        requestPath: savedRequest.requestPath,
        resultPath: savedResult.resultPath,
        ...(savedResult.markdownPath ? { markdownPath: savedResult.markdownPath } : {}),
        ...(savedResult.structuredReviewPath
          ? { structuredReviewPath: savedResult.structuredReviewPath }
          : {}),
        bridgeArtifactPaths: [
          ...(bridgeMarkdown ? [bridgeMarkdown.artifactPath, bridgeMarkdown.manifestPath] : []),
          ...(structuredReview
            ? [structuredReview.artifactPath, structuredReview.manifestPath]
            : []),
        ],
        evidenceIds: evidence.map((entry) => entry.evidenceId),
      }),
      request,
      result,
    };
  }

  private buildRequest(input: {
    run: RunRecord;
    task: TaskEnvelope;
    executionResult: ExecutionResult;
    reviewType?: ReviewType | undefined;
    architectureFreeze?: ArchitectureFreeze | null | undefined;
    relatedEvidenceIds?: readonly string[] | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): ReviewRequest {
    return ReviewRequestSchema.parse({
      reviewId: randomUUID(),
      runId: input.run.runId,
      taskId: input.task.taskId,
      executionId: input.executionResult.executionId,
      reviewType: input.reviewType ?? 'task_review',
      taskTitle: input.task.title,
      objective: input.task.objective,
      scope: input.task.scope,
      allowedFiles: input.task.allowedFiles,
      disallowedFiles: input.task.disallowedFiles,
      acceptanceCriteria: input.task.acceptanceCriteria,
      changedFiles: input.executionResult.patchSummary.changedFiles,
      patchSummary: input.executionResult.patchSummary,
      testResults: input.executionResult.testResults,
      executionSummary: input.executionResult.summary,
      architectureConstraints: buildArchitectureConstraints(input.architectureFreeze),
      relatedEvidenceIds: [...input.task.evidenceIds, ...(input.relatedEvidenceIds ?? [])],
      metadata: input.metadata ?? {},
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

function buildArchitectureConstraints(freeze: ArchitectureFreeze | null | undefined): string[] {
  if (!freeze) {
    return [];
  }

  return [
    ...freeze.invariants,
    ...freeze.dependencyRules.map(
      (rule) => `${rule.fromModuleId} -> ${rule.toModuleId}: ${rule.rule} (${rule.rationale})`,
    ),
  ];
}
