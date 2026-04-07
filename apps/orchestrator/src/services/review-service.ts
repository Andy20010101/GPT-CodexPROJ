import { randomUUID } from 'node:crypto';

import type {
  ArchitectureFreeze,
  EvidenceManifest,
  ExecutionArtifact,
  ExecutionResult,
  ReviewEvidence,
  ReviewRequest,
  ReviewResult,
  ReviewRuntimeState,
  ReviewType,
  TaskEnvelope,
} from '../contracts';
import {
  ReviewEvidenceSchema,
  ReviewRequestSchema,
  ReviewRuntimeStateSchema,
} from '../contracts';
import type { RunRecord } from '../domain/run';
import { FileReviewRepository } from '../storage/file-review-repository';
import { OrchestratorError } from '../utils/error';
import { normalizeReviewResult } from '../utils/review-result-normalizer';
import {
  getReviewRequestFile,
  getReviewResultFile,
  getReviewRoot,
  getReviewRuntimeStateFile,
} from '../utils/run-paths';
import { BridgeClient, BridgeClientError } from './bridge-client';
import { EvidenceLedgerService } from './evidence-ledger-service';
import { ReviewPayloadBuilder } from './review-payload-builder';

export type ReviewDispatch = {
  evidence: EvidenceManifest[];
  reviewDir: string;
  reviewEvidence: ReviewEvidence;
  request: ReviewRequest;
  result: ReviewResult;
  runtimeState: ReviewRuntimeState;
};

export type ReviewRequestDispatch = {
  evidence: EvidenceManifest[];
  reviewDir: string;
  request: ReviewRequest;
  requestPath: string;
  runtimeState: ReviewRuntimeState;
  runtimeStatePath: string;
};

export type ReviewFinalizePending = {
  status: 'pending';
  reviewDir: string;
  request: ReviewRequest;
  runtimeState: ReviewRuntimeState;
  error: {
    code: 'REVIEW_FINALIZE_RETRYABLE' | 'REVIEW_MATERIALIZATION_PENDING';
    message: string;
    details?: unknown;
  };
};

export type ReviewFinalizeCompleted = ReviewDispatch & {
  status: 'completed';
};

export type ReviewFinalizeDispatch = ReviewFinalizePending | ReviewFinalizeCompleted;

type BridgeErrorShape = {
  code: string;
  message: string;
  details?: unknown;
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

  public async requestExecutionReview(input: {
    run: RunRecord;
    task: TaskEnvelope;
    executionResult: ExecutionResult;
    reviewType?: ReviewType | undefined;
    producer: string;
    architectureFreeze?: ArchitectureFreeze | null | undefined;
    relatedEvidenceIds?: readonly string[] | undefined;
    metadata?: Record<string, unknown> | undefined;
    attempt?: number | undefined;
    requestJobId?: string | undefined;
  }): Promise<ReviewRequestDispatch> {
    const artifactDir = this.reviewRepository.getArtifactDir();
    const existingRequest = await this.reviewRepository.findRequestByExecution({
      runId: input.run.runId,
      taskId: input.task.taskId,
      executionId: input.executionResult.executionId,
      reviewType: input.reviewType ?? 'task_review',
    });
    const request = existingRequest ?? this.buildRequest(input);
    const reviewDir = getReviewRoot(artifactDir, request.runId, request.reviewId);
    const requestPath = getReviewRequestFile(artifactDir, request.runId, request.reviewId);
    const runtimeStatePath = getReviewRuntimeStateFile(artifactDir, request.runId, request.reviewId);
    const evidence: EvidenceManifest[] = [];

    if (!existingRequest) {
      await this.reviewRepository.saveRequest(request);
      evidence.push(
        await this.evidenceLedgerService.appendEvidence({
          runId: request.runId,
          taskId: request.taskId,
          stage: input.run.stage,
          kind: 'review_request',
          timestamp: request.createdAt,
          producer: input.producer,
          artifactPaths: [requestPath],
          summary: `Prepared ${request.reviewType} request for execution ${request.executionId}`,
          metadata: {
            reviewId: request.reviewId,
          },
        }),
      );
    }

    const currentState = await this.reviewRepository.getRuntimeState(request.runId, request.reviewId);
    if (
      currentState &&
      currentState.conversationId &&
      (currentState.status === 'review_waiting' ||
        currentState.status === 'review_materializing' ||
        currentState.status === 'review_applied')
    ) {
      return {
        evidence,
        reviewDir,
        request,
        requestPath,
        runtimeState: currentState,
        runtimeStatePath,
      };
    }

    const seededState = await this.persistRuntimeState({
      request,
      previous: currentState,
      status: 'review_requested',
      attempt: input.attempt ?? currentState?.attempt ?? 1,
      requestJobId: input.requestJobId ?? currentState?.requestJobId,
      metadata: {
        ...(currentState?.metadata ?? {}),
        ...(input.metadata ?? {}),
        browserUrl: this.config.browserUrl,
        projectName: this.config.projectName,
      },
    });

    try {
      const payload = this.payloadBuilder.build(request);
      const session = await this.bridgeClient.openSession({
        browserUrl: this.config.browserUrl,
      });
      const selectedSession = await this.bridgeClient.selectProject({
        sessionId: session.sessionId,
        projectName: this.config.projectName,
        ...(this.config.modelHint ? { model: this.config.modelHint } : {}),
      });
      const conversation = await this.bridgeClient.startConversation({
        sessionId: selectedSession.sessionId,
        projectName: this.config.projectName,
        ...(this.config.modelHint ? { model: this.config.modelHint } : {}),
        prompt: payload.prompt,
        inputFiles: [],
      });
      const waitingState = await this.persistRuntimeState({
        request,
        previous: seededState,
        status: 'review_waiting',
        attempt: input.attempt ?? seededState.attempt,
        sessionId: selectedSession.sessionId,
        conversationId: conversation.conversationId,
        browserUrl: selectedSession.browserUrl,
        pageUrl: conversation.pageUrl ?? selectedSession.pageUrl,
        projectName: conversation.projectName,
        model: conversation.model ?? selectedSession.model ?? this.config.modelHint,
        requestJobId: input.requestJobId ?? seededState.requestJobId,
        metadata: {
          ...seededState.metadata,
          ...(input.metadata ?? {}),
        },
        clearLastError: true,
      });

      return {
        evidence,
        reviewDir,
        request,
        requestPath,
        runtimeState: waitingState,
        runtimeStatePath,
      };
    } catch (error) {
      await this.persistRuntimeState({
        request,
        previous: seededState,
        status: 'review_requested',
        attempt: input.attempt ?? seededState.attempt,
        requestJobId: input.requestJobId ?? seededState.requestJobId,
        metadata: {
          ...seededState.metadata,
          ...(input.metadata ?? {}),
        },
        lastError:
          this.toBridgeError(error) ?? {
            code: 'REVIEW_REQUEST_FAILED',
            message: error instanceof Error ? error.message : 'Review request failed',
            details: error,
          },
      });
      throw error;
    }
  }

  public async finalizeExecutionReview(input: {
    run: RunRecord;
    task: TaskEnvelope;
    executionResult: ExecutionResult;
    reviewId: string;
    producer: string;
    metadata?: Record<string, unknown> | undefined;
    attempt?: number | undefined;
    finalizeJobId?: string | undefined;
  }): Promise<ReviewFinalizeDispatch> {
    const artifactDir = this.reviewRepository.getArtifactDir();
    const request = await this.reviewRepository.getRequest(input.run.runId, input.reviewId);
    if (!request) {
      throw new OrchestratorError(
        'REVIEW_REQUEST_NOT_FOUND',
        `Review request ${input.reviewId} was not found`,
        {
          runId: input.run.runId,
          taskId: input.task.taskId,
          reviewId: input.reviewId,
        },
      );
    }

    const reviewDir = getReviewRoot(artifactDir, request.runId, request.reviewId);
    const runtimeStatePath = getReviewRuntimeStateFile(artifactDir, request.runId, request.reviewId);
    const existingResult = await this.reviewRepository.getResult(request.runId, request.reviewId);
    let runtimeState = await this.requireRuntimeState(request);

    if (existingResult) {
      return {
        status: 'completed',
        evidence: [],
        reviewDir,
        reviewEvidence: this.buildReviewEvidence({
          request,
          result: existingResult,
          runtimeStatePath,
          evidence: [],
        }),
        request,
        result: existingResult,
        runtimeState,
      };
    }

    if (!runtimeState.conversationId) {
      return this.returnPending({
        request,
        previous: runtimeState,
        status: runtimeState.status,
        attempt: input.attempt ?? runtimeState.attempt,
        finalizeJobId: input.finalizeJobId ?? runtimeState.finalizeJobId,
        metadata: {
          ...runtimeState.metadata,
          ...(input.metadata ?? {}),
        },
        error: {
          code: 'REVIEW_FINALIZE_RETRYABLE',
          message: 'Review conversation has not been created yet.',
          details: {
            reviewId: request.reviewId,
          },
        },
      });
    }

    runtimeState = await this.persistRuntimeState({
      request,
      previous: runtimeState,
      status: runtimeState.status,
      attempt: input.attempt ?? runtimeState.attempt,
      finalizeJobId: input.finalizeJobId ?? runtimeState.finalizeJobId,
      metadata: {
        ...runtimeState.metadata,
        ...(input.metadata ?? {}),
      },
      clearLastError: true,
    });

    if (runtimeState.status === 'review_waiting') {
      const waitResult = await this.waitForConversationCompletion({
        request,
        previous: runtimeState,
        attempt: input.attempt ?? runtimeState.attempt,
        finalizeJobId: input.finalizeJobId ?? runtimeState.finalizeJobId,
        metadata: {
          ...runtimeState.metadata,
          ...(input.metadata ?? {}),
        },
      });
      if ('status' in waitResult && waitResult.status === 'pending') {
        return waitResult;
      }
      runtimeState = waitResult.runtimeState;
    }

    let bridgeMarkdown:
      | { artifactPath: string; manifestPath: string; markdown: string }
      | undefined;
    try {
      bridgeMarkdown = await this.bridgeClient.exportMarkdown(runtimeState.conversationId!, {
        fileName: `${request.reviewId}.md`,
      });
    } catch (error) {
      return this.returnPending({
        request,
        previous: runtimeState,
        status: 'review_materializing',
        attempt: input.attempt ?? runtimeState.attempt,
        finalizeJobId: input.finalizeJobId ?? runtimeState.finalizeJobId,
        metadata: {
          ...runtimeState.metadata,
          ...(input.metadata ?? {}),
        },
        error: {
          code: 'REVIEW_MATERIALIZATION_PENDING',
          message:
            'Review conversation completed, but markdown export failed. Retry finalization from the existing conversation.',
          details: this.toBridgeError(error) ?? error,
        },
      });
    }

    const payload = this.payloadBuilder.build(request);
    const extractionResult = await this.extractStructuredReview({
      request,
      previous: runtimeState,
      remediationPrompt: payload.remediationPrompt,
      attempt: input.attempt ?? runtimeState.attempt,
      finalizeJobId: input.finalizeJobId ?? runtimeState.finalizeJobId,
      metadata: {
        ...runtimeState.metadata,
        ...(input.metadata ?? {}),
      },
    });
    if (isPendingFinalize(extractionResult)) {
      return extractionResult;
    }
    const extracted = extractionResult;
    runtimeState = extracted.runtimeState;

    const result = normalizeReviewResult({
      request,
      payload: extracted.structuredReview?.payload,
      bridgeArtifacts: {
        conversationId: runtimeState.conversationId,
        markdownPath: bridgeMarkdown.artifactPath,
        markdownManifestPath: bridgeMarkdown.manifestPath,
        ...(extracted.structuredReview
          ? {
              structuredReviewPath: extracted.structuredReview.artifactPath,
              structuredReviewManifestPath: extracted.structuredReview.manifestPath,
            }
          : {}),
      },
      summaryFallback:
        extracted.errorCode === 'REVIEW_STRUCTURED_OUTPUT_MISSING'
          ? 'No structured review JSON block was found in the assistant output.'
          : undefined,
      metadata: {
        ...(extracted.errorCode ? { errorCode: extracted.errorCode } : {}),
        ...(runtimeState.metadata.recoveryOutcome
          ? { recoveryCode: runtimeState.metadata.recoveryOutcome }
          : {}),
        ...(input.metadata ?? {}),
      },
    });

    const savedResult = await this.reviewRepository.saveResult({
      result,
      markdown: bridgeMarkdown.markdown,
      structuredReview: extracted.structuredReview?.payload,
    });

    runtimeState = await this.persistRuntimeState({
      request,
      previous: runtimeState,
      status: 'review_materializing',
      attempt: input.attempt ?? runtimeState.attempt,
      finalizeJobId: input.finalizeJobId ?? runtimeState.finalizeJobId,
      metadata: {
        ...runtimeState.metadata,
        ...(input.metadata ?? {}),
        resultPath: savedResult.resultPath,
        ...(savedResult.markdownPath ? { markdownPath: savedResult.markdownPath } : {}),
        ...(savedResult.structuredReviewPath
          ? { structuredReviewPath: savedResult.structuredReviewPath }
          : {}),
      },
      clearLastError: true,
    });

    const evidence: EvidenceManifest[] = [];
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
            bridgeArtifactPath: bridgeMarkdown.artifactPath,
          },
        }),
      );
    }

    if (savedResult.structuredReviewPath && extracted.structuredReview) {
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
            bridgeArtifactPath: extracted.structuredReview.artifactPath,
          },
        }),
      );
    }

    return {
      status: 'completed',
      evidence,
      reviewDir: savedResult.reviewDir,
      reviewEvidence: this.buildReviewEvidence({
        request,
        result,
        runtimeStatePath,
        markdownPath: savedResult.markdownPath,
        structuredReviewPath: savedResult.structuredReviewPath,
        bridgeArtifactPaths: [
          bridgeMarkdown.artifactPath,
          bridgeMarkdown.manifestPath,
          ...(extracted.structuredReview
            ? [
                extracted.structuredReview.artifactPath,
                extracted.structuredReview.manifestPath,
              ]
            : []),
        ],
        evidence,
      }),
      request,
      result,
      runtimeState,
    };
  }

  public async markReviewApplied(input: {
    request: ReviewRequest;
    previous: ReviewRuntimeState;
    metadata?: Record<string, unknown> | undefined;
    finalizeJobId?: string | undefined;
  }): Promise<ReviewRuntimeState> {
    return this.persistRuntimeState({
      request: input.request,
      previous: input.previous,
      status: 'review_applied',
      attempt: input.previous.attempt,
      finalizeJobId: input.finalizeJobId ?? input.previous.finalizeJobId,
      metadata: {
        ...input.previous.metadata,
        ...(input.metadata ?? {}),
      },
      clearLastError: true,
      completedAt: new Date().toISOString(),
    });
  }

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
    const requested = await this.requestExecutionReview(input);
    const finalized = await this.finalizeExecutionReview({
      run: input.run,
      task: input.task,
      executionResult: input.executionResult,
      reviewId: requested.request.reviewId,
      producer: input.producer,
      metadata: input.metadata,
    });
    if (finalized.status === 'pending') {
      throw new OrchestratorError(finalized.error.code, finalized.error.message, {
        reviewId: requested.request.reviewId,
        runtimeState: finalized.runtimeState,
        details: finalized.error.details,
      });
    }

    const evidence = [...requested.evidence, ...finalized.evidence];
    return {
      ...finalized,
      evidence,
      reviewEvidence: ReviewEvidenceSchema.parse({
        ...finalized.reviewEvidence,
        evidenceIds: evidence.map((entry) => entry.evidenceId),
      }),
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
    const patchArtifactContent = this.extractExecutionArtifactContent(
      input.executionResult.artifacts,
      'patch',
    );
    const testLogExcerpt =
      this.extractExecutionArtifactContent(input.executionResult.artifacts, 'test-log') ??
      this.extractExecutionArtifactContent(input.executionResult.artifacts, 'command-log');

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
      ...(patchArtifactContent ? { patchArtifactContent } : {}),
      testResults: input.executionResult.testResults,
      ...(testLogExcerpt ? { testLogExcerpt } : {}),
      executionSummary: input.executionResult.summary,
      architectureConstraints: buildArchitectureConstraints(input.architectureFreeze),
      relatedEvidenceIds: [...input.task.evidenceIds, ...(input.relatedEvidenceIds ?? [])],
      metadata: input.metadata ?? {},
      createdAt: new Date().toISOString(),
    });
  }

  private extractExecutionArtifactContent(
    artifacts: readonly ExecutionArtifact[],
    kind: ExecutionArtifact['kind'],
  ): string | undefined {
    const artifact = artifacts.find((entry) => entry.kind === kind && entry.content?.trim());
    return artifact?.content?.trim() || undefined;
  }

  private async waitForConversationCompletion(input: {
    request: ReviewRequest;
    previous: ReviewRuntimeState;
    attempt: number;
    finalizeJobId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<{ runtimeState: ReviewRuntimeState } | ReviewFinalizePending> {
    const conversationId = input.previous.conversationId;
    if (!conversationId) {
      return this.returnPending({
        request: input.request,
        previous: input.previous,
        status: 'review_waiting',
        attempt: input.attempt,
        finalizeJobId: input.finalizeJobId,
        metadata: input.metadata,
        error: {
          code: 'REVIEW_FINALIZE_RETRYABLE',
          message: 'Review conversation is missing from runtime state.',
        },
      });
    }

    try {
      const snapshot = await this.bridgeClient.waitForCompletion(conversationId, {
        maxWaitMs: this.config.maxWaitMs,
      });
      return {
        runtimeState: await this.persistRuntimeState({
          request: input.request,
          previous: input.previous,
          status: 'review_materializing',
          attempt: input.attempt,
          finalizeJobId: input.finalizeJobId,
          sessionId: snapshot.sessionId,
          pageUrl: snapshot.pageUrl ?? input.previous.pageUrl,
          metadata: {
            ...input.previous.metadata,
            ...(input.metadata ?? {}),
          },
          clearLastError: true,
        }),
      };
    } catch (error) {
      if (input.previous.recoveryAttempted) {
        return this.returnPending({
          request: input.request,
          previous: input.previous,
          status: 'review_waiting',
          attempt: input.attempt,
          finalizeJobId: input.finalizeJobId,
          metadata: {
            ...input.previous.metadata,
            ...(input.metadata ?? {}),
          },
          error: {
            code: 'REVIEW_FINALIZE_RETRYABLE',
            message:
              'Review conversation exists, but completion could not be confirmed yet. Retry finalization from the persisted conversation.',
            details: this.toBridgeError(error) ?? error,
          },
        });
      }

      try {
        const recovered = await this.bridgeClient.recoverConversation(conversationId, {});
        if (recovered.snapshot.status === 'completed') {
          return {
            runtimeState: await this.persistRuntimeState({
              request: input.request,
              previous: input.previous,
              status: 'review_materializing',
              attempt: input.attempt,
              finalizeJobId: input.finalizeJobId,
              sessionId: recovered.snapshot.sessionId,
              pageUrl: recovered.snapshot.pageUrl ?? input.previous.pageUrl,
              metadata: {
                ...input.previous.metadata,
                ...(input.metadata ?? {}),
                recoveryOutcome: 'REVIEW_RECOVERED_FROM_CONVERSATION',
              },
              recoveryAttempted: true,
              clearLastError: true,
            }),
          };
        }

        return this.returnPending({
          request: input.request,
          previous: input.previous,
          status: 'review_waiting',
          attempt: input.attempt,
          finalizeJobId: input.finalizeJobId,
          metadata: {
            ...input.previous.metadata,
            ...(input.metadata ?? {}),
            recoveryOutcome: 'REVIEW_RECOVERED_FROM_CONVERSATION',
          },
          recoveryAttempted: true,
          error: {
            code: 'REVIEW_FINALIZE_RETRYABLE',
            message:
              'Conversation recovery succeeded, but the review is still running. Retry finalization from the same conversation.',
            details: {
              recoveryStatus: recovered.snapshot.status,
            },
          },
        });
      } catch (recoveryError) {
        return this.returnPending({
          request: input.request,
          previous: input.previous,
          status: 'review_waiting',
          attempt: input.attempt,
          finalizeJobId: input.finalizeJobId,
          metadata: {
            ...input.previous.metadata,
            ...(input.metadata ?? {}),
          },
          error: {
            code: 'REVIEW_FINALIZE_RETRYABLE',
            message:
              'Review conversation exists, but completion could not be confirmed yet. Retry finalization from the persisted conversation.',
            details: {
              waitError: this.toBridgeError(error) ?? error,
              recoveryError: this.toBridgeError(recoveryError) ?? recoveryError,
            },
          },
        });
      }
    }
  }

  private async extractStructuredReview(input: {
    request: ReviewRequest;
    previous: ReviewRuntimeState;
    remediationPrompt: string;
    attempt: number;
    finalizeJobId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<
    | {
        runtimeState: ReviewRuntimeState;
        structuredReview:
          | {
              artifactPath: string;
              manifestPath: string;
              payload: Record<string, unknown>;
            }
          | undefined;
        errorCode?: 'REVIEW_STRUCTURED_OUTPUT_MISSING' | undefined;
      }
    | ReviewFinalizePending
  > {
    const conversationId = input.previous.conversationId;
    if (!conversationId) {
      return this.returnPending({
        request: input.request,
        previous: input.previous,
        status: 'review_materializing',
        attempt: input.attempt,
        finalizeJobId: input.finalizeJobId,
        metadata: input.metadata,
        error: {
          code: 'REVIEW_MATERIALIZATION_PENDING',
          message: 'Review conversation is missing while extracting structured review.',
        },
      });
    }

    try {
      const structuredReview = await this.bridgeClient.extractStructuredReview(conversationId, {
        fileName: `${input.request.reviewId}.json`,
      });
      return {
        runtimeState: input.previous,
        structuredReview,
      };
    } catch (error) {
      const bridgeError = this.toBridgeError(error);
      if (bridgeError?.code === 'STRUCTURED_OUTPUT_NOT_FOUND') {
        if (input.previous.remediationAttempted) {
          return {
            runtimeState: input.previous,
            structuredReview: undefined,
            errorCode: 'REVIEW_STRUCTURED_OUTPUT_MISSING',
          };
        }

        const remediationState = await this.persistRuntimeState({
          request: input.request,
          previous: input.previous,
          status: 'review_materializing',
          attempt: input.attempt,
          finalizeJobId: input.finalizeJobId,
          metadata: {
            ...input.previous.metadata,
            ...(input.metadata ?? {}),
          },
          remediationAttempted: true,
          clearLastError: true,
        });

        try {
          await this.bridgeClient.sendMessage(conversationId, {
            message: input.remediationPrompt,
            inputFiles: [],
          });

          const waitingState = await this.persistRuntimeState({
            request: input.request,
            previous: remediationState,
            status: 'review_waiting',
            attempt: input.attempt,
            finalizeJobId: input.finalizeJobId,
            metadata: {
              ...remediationState.metadata,
              ...(input.metadata ?? {}),
            },
            clearLastError: true,
          });
          const waitResult = await this.waitForConversationCompletion({
            request: input.request,
            previous: waitingState,
            attempt: input.attempt,
            finalizeJobId: input.finalizeJobId,
            metadata: input.metadata,
          });
          if ('status' in waitResult && waitResult.status === 'pending') {
            return waitResult;
          }

          return this.extractStructuredReview({
            ...input,
            previous: waitResult.runtimeState,
          });
        } catch (remediationError) {
          return this.returnPending({
            request: input.request,
            previous: remediationState,
            status: 'review_materializing',
            attempt: input.attempt,
            finalizeJobId: input.finalizeJobId,
            metadata: {
              ...remediationState.metadata,
              ...(input.metadata ?? {}),
            },
            error: {
              code: 'REVIEW_MATERIALIZATION_PENDING',
              message:
                'Structured review extraction required remediation, but the follow-up bridge call failed. Retry finalization from the existing conversation.',
              details: this.toBridgeError(remediationError) ?? remediationError,
            },
          });
        }
      }

      return this.returnPending({
        request: input.request,
        previous: input.previous,
        status: 'review_materializing',
        attempt: input.attempt,
        finalizeJobId: input.finalizeJobId,
        metadata: {
          ...input.previous.metadata,
          ...(input.metadata ?? {}),
        },
        error: {
          code: 'REVIEW_MATERIALIZATION_PENDING',
          message:
            'Review conversation completed, but structured review extraction failed. Retry finalization from the existing conversation.',
          details: bridgeError ?? error,
        },
      });
    }
  }

  private async requireRuntimeState(request: ReviewRequest): Promise<ReviewRuntimeState> {
    const state = await this.reviewRepository.getRuntimeState(request.runId, request.reviewId);
    if (!state) {
      throw new OrchestratorError(
        'REVIEW_RUNTIME_STATE_NOT_FOUND',
        `Review runtime state ${request.reviewId} was not found`,
        {
          runId: request.runId,
          taskId: request.taskId,
          reviewId: request.reviewId,
        },
      );
    }
    return state;
  }

  private async returnPending(input: {
    request: ReviewRequest;
    previous: ReviewRuntimeState;
    status: ReviewRuntimeState['status'];
    attempt: number;
    finalizeJobId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
    recoveryAttempted?: boolean | undefined;
    error: ReviewFinalizePending['error'];
  }): Promise<ReviewFinalizePending> {
    const runtimeState = await this.persistRuntimeState({
      request: input.request,
      previous: input.previous,
      status: input.status,
      attempt: input.attempt,
      finalizeJobId: input.finalizeJobId,
      metadata: {
        ...input.previous.metadata,
        ...(input.metadata ?? {}),
      },
      recoveryAttempted: input.recoveryAttempted,
      lastError: {
        code: input.error.code,
        message: input.error.message,
        details: input.error.details,
      },
    });

    return {
      status: 'pending',
      reviewDir: getReviewRoot(
        this.reviewRepository.getArtifactDir(),
        input.request.runId,
        input.request.reviewId,
      ),
      request: input.request,
      runtimeState,
      error: input.error,
    };
  }

  private async persistRuntimeState(input: {
    request: ReviewRequest;
    previous?: ReviewRuntimeState | null | undefined;
    status: ReviewRuntimeState['status'];
    attempt: number;
    sessionId?: string | undefined;
    conversationId?: string | undefined;
    browserUrl?: string | undefined;
    pageUrl?: string | undefined;
    projectName?: string | undefined;
    model?: string | undefined;
    requestJobId?: string | undefined;
    finalizeJobId?: string | undefined;
    remediationAttempted?: boolean | undefined;
    recoveryAttempted?: boolean | undefined;
    metadata?: Record<string, unknown> | undefined;
    lastError?: BridgeErrorShape | undefined;
    clearLastError?: boolean | undefined;
    completedAt?: string | undefined;
  }): Promise<ReviewRuntimeState> {
    const previous = input.previous ?? null;
    const state = ReviewRuntimeStateSchema.parse({
      reviewId: input.request.reviewId,
      runId: input.request.runId,
      taskId: input.request.taskId,
      executionId: input.request.executionId,
      reviewType: input.request.reviewType,
      status: input.status,
      attempt: input.attempt,
      sessionId: input.sessionId ?? previous?.sessionId,
      conversationId: input.conversationId ?? previous?.conversationId,
      browserUrl: input.browserUrl ?? previous?.browserUrl ?? this.config.browserUrl,
      pageUrl: input.pageUrl ?? previous?.pageUrl,
      projectName: input.projectName ?? previous?.projectName ?? this.config.projectName,
      model: input.model ?? previous?.model ?? this.config.modelHint,
      requestJobId: input.requestJobId ?? previous?.requestJobId,
      finalizeJobId: input.finalizeJobId ?? previous?.finalizeJobId,
      remediationAttempted: input.remediationAttempted ?? previous?.remediationAttempted ?? false,
      recoveryAttempted: input.recoveryAttempted ?? previous?.recoveryAttempted ?? false,
      ...(input.clearLastError
        ? {}
        : {
            lastErrorCode: input.lastError?.code ?? previous?.lastErrorCode,
            lastErrorMessage: input.lastError?.message ?? previous?.lastErrorMessage,
            ...(input.lastError?.details !== undefined
              ? { lastErrorDetails: input.lastError.details }
              : previous?.lastErrorDetails !== undefined
                ? { lastErrorDetails: previous.lastErrorDetails }
                : {}),
          }),
      createdAt: previous?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: input.completedAt ?? previous?.completedAt,
      metadata: {
        ...(previous?.metadata ?? {}),
        ...(input.metadata ?? {}),
      },
    });

    await this.reviewRepository.saveRuntimeState(state);
    return state;
  }

  private buildReviewEvidence(input: {
    request: ReviewRequest;
    result: ReviewResult;
    runtimeStatePath: string;
    evidence: readonly EvidenceManifest[];
    markdownPath?: string | undefined;
    structuredReviewPath?: string | undefined;
    bridgeArtifactPaths?: readonly string[] | undefined;
  }): ReviewEvidence {
    return ReviewEvidenceSchema.parse({
      reviewId: input.request.reviewId,
      runId: input.request.runId,
      taskId: input.request.taskId,
      executionId: input.request.executionId,
      requestPath: getReviewRequestFile(
        this.reviewRepository.getArtifactDir(),
        input.request.runId,
        input.request.reviewId,
      ),
      runtimeStatePath: input.runtimeStatePath,
      resultPath: getReviewResultFile(
        this.reviewRepository.getArtifactDir(),
        input.result.runId,
        input.result.reviewId,
      ),
      ...(input.markdownPath ?? input.result.bridgeArtifacts.markdownPath
        ? {
            markdownPath:
              input.markdownPath ?? input.result.bridgeArtifacts.markdownPath,
          }
        : {}),
      ...(input.structuredReviewPath ?? input.result.bridgeArtifacts.structuredReviewPath
        ? {
            structuredReviewPath:
              input.structuredReviewPath ?? input.result.bridgeArtifacts.structuredReviewPath,
          }
        : {}),
      bridgeArtifactPaths: [...(input.bridgeArtifactPaths ?? [])],
      evidenceIds: input.evidence.map((entry) => entry.evidenceId),
    });
  }

  private toBridgeError(error: unknown): BridgeErrorShape | undefined {
    if (error instanceof BridgeClientError) {
      return {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
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

function isPendingFinalize<T>(value: ReviewFinalizePending | T): value is ReviewFinalizePending {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    value.status === 'pending'
  );
}
