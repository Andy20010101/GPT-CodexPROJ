import { randomUUID } from 'node:crypto';

import type {
  ArchitectureFreeze,
  EvidenceManifest,
  ExecutionArtifact,
  ExecutionResult,
  PatchConvergenceRecord,
  PatchFingerprint,
  ReviewEvidence,
  ReviewRequest,
  ReviewResult,
  ReviewRuntimeState,
  ReviewType,
  TaskEnvelope,
} from '../contracts';
import {
  PatchConvergenceRecordSchema,
  PatchFingerprintSchema,
  ReviewEvidenceSchema,
  ReviewRequestSchema,
  ReviewRuntimeStateSchema,
} from '../contracts';
import type { RunRecord } from '../domain/run';
import { assessTestEvidence, comparePatchFingerprints, fingerprintPatch } from '../domain/execution';
import { FileReviewRepository } from '../storage/file-review-repository';
import { OrchestratorError } from '../utils/error';
import { writeJsonFile } from '../utils/file-store';
import { parsePatchSummary } from '../utils/patch-parser';
import { normalizeReviewResult } from '../utils/review-result-normalizer';
import {
  getExecutionPatchConvergenceFile,
  getReviewRequestFile,
  getReviewResultFile,
  getReviewRoot,
  getReviewRuntimeStateFile,
} from '../utils/run-paths';
import {
  mergeMetadataWithAnalysisBundle,
  readAnalysisBundleInputFiles,
  resolveRunAnalysisBundle,
} from '../utils/analysis-bundle';
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

const REPEATED_PATCH_CONVERGENCE_THRESHOLD = 2;

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
    const analysisBundle = await resolveRunAnalysisBundle(artifactDir, input.run.runId);
    const latestRequest = await this.reviewRepository.findRequestByExecution({
      runId: input.run.runId,
      taskId: input.task.taskId,
      executionId: input.executionResult.executionId,
      reviewType: input.reviewType ?? 'task_review',
    });
    const latestRuntimeState = latestRequest
      ? await this.reviewRepository.getRuntimeState(input.run.runId, latestRequest.reviewId)
      : null;
    const latestResult = latestRequest
      ? await this.reviewRepository.getResult(input.run.runId, latestRequest.reviewId)
      : null;
    const rerunIncompleteReview =
      latestRuntimeState?.status === 'review_applied' && latestResult?.status === 'incomplete';
    const existingRequest = rerunIncompleteReview ? null : latestRequest;
    const requestMetadata = mergeMetadataWithAnalysisBundle(
      {
        ...(input.metadata ?? {}),
        ...(rerunIncompleteReview && latestRequest ? { previousReviewId: latestRequest.reviewId } : {}),
      },
      analysisBundle,
    );
    const request =
      existingRequest ??
      (await this.buildRequest({
        ...input,
        metadata: requestMetadata,
      }));
    const reviewDir = getReviewRoot(artifactDir, request.runId, request.reviewId);
    const requestPath = getReviewRequestFile(artifactDir, request.runId, request.reviewId);
    const runtimeStatePath = getReviewRuntimeStateFile(
      artifactDir,
      request.runId,
      request.reviewId,
    );
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
            testEvidenceGrade: request.testEvidence.grade,
            testEvidenceStrength: request.testEvidence.strength,
          },
        }),
      );
    }

    const currentState = await this.reviewRepository.getRuntimeState(
      request.runId,
      request.reviewId,
    );
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
      browserUrl: this.config.browserUrl,
      requestJobId: input.requestJobId ?? currentState?.requestJobId,
      metadata: {
        ...(currentState?.metadata ?? {}),
        ...(input.metadata ?? {}),
        ...mergeMetadataWithAnalysisBundle(undefined, analysisBundle),
        browserUrl: this.config.browserUrl,
        projectName: this.config.projectName,
      },
      remediationAttempted: false,
      recoveryAttempted: false,
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
        inputFiles: readReviewInputFiles(request.metadata),
      }, {
        timeoutMs: this.config.maxWaitMs,
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
        remediationAttempted: false,
        recoveryAttempted: false,
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
        browserUrl: this.config.browserUrl,
        requestJobId: input.requestJobId ?? seededState.requestJobId,
        metadata: {
          ...seededState.metadata,
          ...(input.metadata ?? {}),
        },
        remediationAttempted: false,
        recoveryAttempted: false,
        lastError: this.toBridgeError(error) ?? {
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
    const runtimeStatePath = getReviewRuntimeStateFile(
      artifactDir,
      request.runId,
      request.reviewId,
    );
    const existingResult = await this.reviewRepository.getResult(request.runId, request.reviewId);
    let runtimeState = await this.requireRuntimeState(request);

    const retryingIncompleteResult =
      existingResult?.status === 'incomplete' && Boolean(runtimeState.conversationId);

    if (existingResult && !retryingIncompleteResult) {
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
            ? [extracted.structuredReview.artifactPath, extracted.structuredReview.manifestPath]
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

  private async buildRequest(input: {
    run: RunRecord;
    task: TaskEnvelope;
    executionResult: ExecutionResult;
    reviewType?: ReviewType | undefined;
    architectureFreeze?: ArchitectureFreeze | null | undefined;
    relatedEvidenceIds?: readonly string[] | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<ReviewRequest> {
    const patchEvidence = this.normalizePatchEvidence(input.executionResult);
    const testEvidence = assessTestEvidence(input.executionResult.testResults);
    if (patchEvidence.changedFiles.length === 0) {
      this.throwReviewEvidenceIncomplete(
        'changed_files_missing',
        'Review evidence did not materialize any changed files before dispatch.',
        {
          executionId: input.executionResult.executionId,
          patchArtifactPresent: Boolean(patchEvidence.patchArtifactContent),
          declaredChangedFiles: normalizeFileList(input.executionResult.patchSummary.changedFiles),
        },
      );
    }
    if (input.executionResult.testResults.length === 0) {
      this.throwReviewEvidenceIncomplete(
        'test_results_missing',
        'Review evidence does not include any test results before dispatch.',
        {
          executionId: input.executionResult.executionId,
          changedFiles: patchEvidence.changedFiles,
        },
      );
    }
    if (patchEvidence.truncationReasons.length > 0) {
      this.throwReviewEvidenceIncomplete(
        'patch_artifact_truncated',
        'Review evidence patch artifact is truncated or degraded and cannot support a trustworthy review dispatch.',
        {
          executionId: input.executionResult.executionId,
          changedFiles: patchEvidence.changedFiles,
          truncationReasons: patchEvidence.truncationReasons,
        },
      );
    }
    if (testEvidence.strength === 'weak') {
      this.throwReviewEvidenceIncomplete(
        'review_evidence_degraded',
        'Review evidence only contains degraded validation signals before dispatch.',
        {
          executionId: input.executionResult.executionId,
          changedFiles: patchEvidence.changedFiles,
          degradedEvidenceKinds: ['test_evidence'],
          testEvidenceGrade: testEvidence.grade,
          testEvidenceStrength: testEvidence.strength,
          testEvidenceSummary: testEvidence.summary,
        },
      );
    }
    const testLogExcerpt =
      this.extractExecutionArtifactContent(input.executionResult.artifacts, 'test-log') ??
      this.extractExecutionArtifactContent(input.executionResult.artifacts, 'command-log');
    const patchFingerprint = await this.assertPatchConvergence({
      run: input.run,
      task: input.task,
      executionResult: input.executionResult,
      reviewType: input.reviewType ?? 'task_review',
      patchSummary: patchEvidence.patchSummary,
      patchArtifactContent: patchEvidence.patchArtifactContent,
    });

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
      changedFiles: patchEvidence.changedFiles,
      patchSummary: patchEvidence.patchSummary,
      ...(patchEvidence.patchArtifactContent
        ? { patchArtifactContent: patchEvidence.patchArtifactContent }
        : {}),
      testResults: input.executionResult.testResults,
      testEvidence,
      ...(testLogExcerpt ? { testLogExcerpt } : {}),
      executionSummary: input.executionResult.summary,
      architectureConstraints: buildArchitectureConstraints(input.architectureFreeze),
      relatedEvidenceIds: [...input.task.evidenceIds, ...(input.relatedEvidenceIds ?? [])],
      metadata: {
        ...(input.metadata ?? {}),
        ...(patchFingerprint ? { patchFingerprint } : {}),
      },
      createdAt: new Date().toISOString(),
    });
  }

  private async assertPatchConvergence(input: {
    run: RunRecord;
    task: TaskEnvelope;
    executionResult: ExecutionResult;
    reviewType: ReviewType;
    patchSummary: ExecutionResult['patchSummary'];
    patchArtifactContent?: string | undefined;
  }): Promise<PatchFingerprint | undefined> {
    if (input.reviewType !== 'task_review' || !input.patchArtifactContent) {
      return undefined;
    }

    const currentFingerprint = fingerprintPatch({
      patchArtifactContent: input.patchArtifactContent,
      patchSummary: input.patchSummary,
    });
    const history = await this.listLatestTaskReviewAttemptsByExecution(
      input.run.runId,
      input.task.taskId,
    );
    const matchedHistory: PatchConvergenceRecord['matchedHistory'] = [];

    for (let index = history.length - 1; index >= 0; index -= 1) {
      const attempt = history[index];
      if (!attempt) {
        continue;
      }
      if (attempt.executionId === input.executionResult.executionId) {
        continue;
      }
      if (attempt.reviewStatus !== 'changes_requested' && attempt.reviewStatus !== 'rejected') {
        break;
      }
      if (!attempt.fingerprint) {
        break;
      }

      const comparison = comparePatchFingerprints(currentFingerprint, attempt.fingerprint);
      if (!comparison) {
        break;
      }

      matchedHistory.push({
        reviewId: attempt.reviewId,
        executionId: attempt.executionId,
        reviewStatus: attempt.reviewStatus,
        comparison,
        requestCreatedAt: attempt.requestCreatedAt,
        reviewTimestamp: attempt.reviewTimestamp,
        fingerprint: attempt.fingerprint,
      });
    }

    if (matchedHistory.length + 1 < REPEATED_PATCH_CONVERGENCE_THRESHOLD) {
      return currentFingerprint;
    }

    const record = PatchConvergenceRecordSchema.parse({
      runId: input.run.runId,
      taskId: input.task.taskId,
      executionId: input.executionResult.executionId,
      status: 'manual_attention_required',
      reason: 'repeated_patch_convergence_failed',
      threshold: REPEATED_PATCH_CONVERGENCE_THRESHOLD,
      consecutiveRepeatCount: matchedHistory.length + 1,
      detectedAt: new Date().toISOString(),
      summary: buildPatchConvergenceSummary(input.executionResult.executionId, matchedHistory.length + 1),
      currentFingerprint,
      matchedHistory,
    });
    const convergenceArtifactPath = getExecutionPatchConvergenceFile(
      this.reviewRepository.getArtifactDir(),
      input.run.runId,
      input.executionResult.executionId,
    );
    await writeJsonFile(convergenceArtifactPath, record);

    throw new OrchestratorError(
      'REVIEW_PATCH_CONVERGENCE_FAILED',
      'Repeated identical or effectively identical patch detected after review feedback. Review dispatch is stopped and requires manual attention.',
      {
        failClosed: true,
        manualAttentionRequired: true,
        reason: 'repeated_patch_convergence',
        convergenceArtifactPath,
        threshold: REPEATED_PATCH_CONVERGENCE_THRESHOLD,
        consecutiveRepeatCount: record.consecutiveRepeatCount,
        currentFingerprint,
        matchedHistory: record.matchedHistory,
      },
    );
  }

  private extractExecutionArtifactContent(
    artifacts: readonly ExecutionArtifact[],
    kind: ExecutionArtifact['kind'],
  ): string | undefined {
    const artifact = this.findExecutionArtifact(artifacts, kind);
    return artifact?.content?.trim() || undefined;
  }

  private findExecutionArtifact(
    artifacts: readonly ExecutionArtifact[],
    kind: ExecutionArtifact['kind'],
  ): ExecutionArtifact | undefined {
    return artifacts.find((entry) => entry.kind === kind && entry.content?.trim());
  }

  private normalizePatchEvidence(executionResult: ExecutionResult): {
    changedFiles: string[];
    patchSummary: ExecutionResult['patchSummary'];
    patchArtifactContent?: string | undefined;
    truncationReasons: string[];
  } {
    const patchArtifact = this.findExecutionArtifact(executionResult.artifacts, 'patch');
    const patchArtifactContent = patchArtifact?.content?.trim() || undefined;
    const summaryPatchFiles = extractExecutionSummaryPatchFiles(executionResult.summary);
    const declaredChangedFiles = normalizeFileList(executionResult.patchSummary.changedFiles);

    if (!patchArtifactContent) {
      if (summaryPatchFiles.length > 0 || declaredChangedFiles.length > 0) {
        this.throwReviewEvidenceIncomplete(
          'patch_artifact_missing',
          'Review evidence is missing the patch artifact required before dispatch.',
          {
            executionId: executionResult.executionId,
            declaredChangedFiles,
            summaryPatchFiles,
          },
        );
      }

      return {
        changedFiles: declaredChangedFiles,
        patchSummary: executionResult.patchSummary,
        truncationReasons: [],
      };
    }

    const patchSummary = parsePatchSummary(patchArtifactContent, {
      patchPath: executionResult.patchSummary.patchPath,
      notes: executionResult.patchSummary.notes,
    });
    const patchArtifactFiles = normalizeFileList(patchSummary.changedFiles);
    const missingFiles = summaryPatchFiles.filter((file) => !patchArtifactFiles.includes(file));

    if (missingFiles.length > 0) {
      this.throwReviewEvidenceIncomplete(
        'patch_artifact_incomplete',
        'Review evidence patch artifact is incomplete and does not cover every changed file described by the execution result.',
        {
          executionId: executionResult.executionId,
          missingFiles,
          patchArtifactFiles,
          declaredChangedFiles,
          summaryPatchFiles,
        },
      );
    }

    return {
      changedFiles: patchArtifactFiles,
      patchSummary: {
        ...patchSummary,
        changedFiles: patchArtifactFiles,
      },
      patchArtifactContent,
      truncationReasons: assessPatchArtifactTruncation({
        content: patchArtifactContent,
        metadata: patchArtifact?.metadata,
        notes: executionResult.patchSummary.notes,
      }),
    };
  }

  private async listLatestTaskReviewAttemptsByExecution(
    runId: string,
    taskId: string,
  ): Promise<
    Array<{
      executionId: string;
      reviewId: string;
      reviewStatus: ReviewResult['status'];
      requestCreatedAt: string;
      reviewTimestamp: string;
      fingerprint?: PatchFingerprint | undefined;
    }>
  > {
    const [requests, results] = await Promise.all([
      this.reviewRepository.listRequestsForRun(runId),
      this.reviewRepository.listResultsForRun(runId),
    ]);
    const resultsByReviewId = new Map(results.map((result) => [result.reviewId, result]));
    const latestByExecutionId = new Map<
      string,
      {
        executionId: string;
        reviewId: string;
        reviewStatus: ReviewResult['status'];
        requestCreatedAt: string;
        reviewTimestamp: string;
        fingerprint?: PatchFingerprint | undefined;
      }
    >();

    for (const request of requests) {
      if (request.taskId !== taskId || request.reviewType !== 'task_review') {
        continue;
      }

      const result = resultsByReviewId.get(request.reviewId);
      if (!result) {
        continue;
      }

      const candidate = {
        executionId: request.executionId,
        reviewId: request.reviewId,
        reviewStatus: result.status,
        requestCreatedAt: request.createdAt,
        reviewTimestamp: result.timestamp,
        fingerprint: this.readPatchFingerprintFromRequest(request),
      };
      const existing = latestByExecutionId.get(request.executionId);

      if (!existing || candidate.reviewTimestamp.localeCompare(existing.reviewTimestamp) > 0) {
        latestByExecutionId.set(request.executionId, candidate);
      }
    }

    return [...latestByExecutionId.values()].sort((left, right) =>
      left.reviewTimestamp.localeCompare(right.reviewTimestamp),
    );
  }

  private readPatchFingerprintFromRequest(request: ReviewRequest): PatchFingerprint | undefined {
    const metadataFingerprint = PatchFingerprintSchema.safeParse(request.metadata.patchFingerprint);
    if (metadataFingerprint.success) {
      return metadataFingerprint.data;
    }

    if (!request.patchArtifactContent) {
      return undefined;
    }

    return fingerprintPatch({
      patchArtifactContent: request.patchArtifactContent,
      patchSummary: request.patchSummary,
    });
  }

  private throwReviewEvidenceIncomplete(
    reason:
      | 'changed_files_missing'
      | 'patch_artifact_missing'
      | 'patch_artifact_incomplete'
      | 'patch_artifact_truncated'
      | 'test_results_missing'
      | 'review_evidence_degraded',
    message: string,
    details: Record<string, unknown>,
  ): never {
    throw new OrchestratorError(
      'REVIEW_EVIDENCE_INCOMPLETE',
      `${message} Review dispatch is fail-closed and requires manual attention.`,
      {
        failClosed: true,
        manualAttentionRequired: true,
        reason,
        ...details,
      },
    );
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
      const bridgeError = this.toBridgeError(error);
      if (
        bridgeError?.code === 'CONVERSATION_UNAVAILABLE' ||
        (bridgeError?.code === 'CONVERSATION_NOT_FOUND' && input.previous.recoveryAttempted)
      ) {
        return this.returnPending({
          request: input.request,
          previous: input.previous,
          status: 'review_requested',
          attempt: input.attempt,
          finalizeJobId: input.finalizeJobId,
          metadata: {
            ...input.previous.metadata,
            ...(input.metadata ?? {}),
          },
          error: {
            code: 'REVIEW_FINALIZE_RETRYABLE',
            message:
              bridgeError.code === 'CONVERSATION_NOT_FOUND'
                ? 'Review conversation is no longer available and must be re-dispatched from a fresh conversation.'
                : 'Review conversation failed on the ChatGPT page and must be re-dispatched from a fresh conversation.',
            details: bridgeError.details,
          },
        });
      }

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
            details: bridgeError ?? error,
          },
        });
      }

      try {
        const recovered = await this.bridgeClient.recoverConversation(conversationId, {
          sessionId: input.previous.sessionId,
          browserUrl: input.previous.browserUrl,
          pageUrl: input.previous.pageUrl,
          projectName: input.previous.projectName,
          model: input.previous.model,
          inputFiles: readReviewInputFiles(input.request.metadata),
        });
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

        if (recovered.snapshot.status === 'failed') {
          return this.returnPending({
            request: input.request,
            previous: input.previous,
            status: 'review_requested',
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
                'Recovered review conversation is in a failed state and must be re-dispatched from a fresh conversation.',
              details: {
                recoveryStatus: recovered.snapshot.status,
                pageUrl: recovered.snapshot.pageUrl,
              },
            },
          });
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
            inputFiles: readReviewInputFiles(input.request.metadata),
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
      ...((input.markdownPath ?? input.result.bridgeArtifacts.markdownPath)
        ? {
            markdownPath: input.markdownPath ?? input.result.bridgeArtifacts.markdownPath,
          }
        : {}),
      ...((input.structuredReviewPath ?? input.result.bridgeArtifacts.structuredReviewPath)
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

function buildPatchConvergenceSummary(executionId: string, consecutiveRepeatCount: number): string {
  return `Execution ${executionId} repeated the same review-failing patch ${consecutiveRepeatCount} time(s) in a row.`;
}

function extractExecutionSummaryPatchFiles(summary: string): string[] {
  const markerIndex = summary.indexOf('Patch summary:');
  if (markerIndex < 0) {
    return [];
  }

  const section = summary.slice(markerIndex + 'Patch summary:'.length);
  const files = new Set<string>();

  for (const line of section.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (!trimmed.startsWith('- ')) {
      if (files.size > 0) {
        break;
      }
      continue;
    }

    for (const match of trimmed.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
      const label = match[1];
      const target = match[2];
      if (!label || !target) {
        continue;
      }
      const candidate = normalizeSummaryFileReference(label, target);
      if (candidate) {
        files.add(candidate);
      }
    }
  }

  return [...files];
}

function normalizeSummaryFileReference(label: string, target: string): string | null {
  const normalizedLabel = normalizeRepoRelativePath(label);
  if (normalizedLabel) {
    return normalizedLabel;
  }

  const normalizedTarget =
    target.replace(/^file:\/\//, '').replaceAll('\\', '/').split('#')[0] ?? '';
  const markers = ['/apps/', '/scripts/', '/services/', '/packages/', '/tests/'];
  for (const marker of markers) {
    const markerIndex = normalizedTarget.lastIndexOf(marker);
    if (markerIndex >= 0) {
      return normalizeRepoRelativePath(normalizedTarget.slice(markerIndex + 1));
    }
  }

  return null;
}

function normalizeFileList(files: readonly string[]): string[] {
  return [...new Set(files.map((file) => normalizeRepoRelativePath(file)).filter((file) => file.length > 0))];
}

function normalizeRepoRelativePath(value: string): string {
  const normalized = value
    .replaceAll('\\', '/')
    .trim()
    .replace(/^\.?\//, '')
    .replace(/^\/+/, '');

  if (
    normalized.length === 0 ||
    normalized.startsWith('http://') ||
    normalized.startsWith('https://')
  ) {
    return '';
  }

  return normalized;
}

function assessPatchArtifactTruncation(input: {
  content: string;
  metadata: Record<string, unknown> | undefined;
  notes: readonly string[];
}): string[] {
  const reasons = new Set<string>();

  if (isArtifactMetadataTruncated(input.metadata)) {
    reasons.add('Patch artifact metadata marks the diff evidence as truncated.');
  }

  for (const note of input.notes) {
    if (containsTruncationMarker(note)) {
      reasons.add(`Patch summary note indicates truncation: ${note}`);
    }
  }

  const explicitMarker = findExplicitPatchTruncationMarker(input.content);
  if (explicitMarker) {
    reasons.add(`Patch artifact ends with an explicit truncation marker: ${explicitMarker}`);
  }

  for (const file of findPatchBlocksWithoutReviewablePayload(input.content)) {
    reasons.add(
      `Patch artifact did not materialize a reviewable diff body for ${file}.`,
    );
  }

  for (const file of findPatchBlocksWithDanglingHunkHeader(input.content)) {
    reasons.add(`Patch artifact ended after a hunk header for ${file}.`);
  }

  return [...reasons];
}

function isArtifactMetadataTruncated(metadata: Record<string, unknown> | undefined): boolean {
  if (!metadata) {
    return false;
  }

  const truncationBooleanKeys = [
    'truncated',
    'isTruncated',
    'wasTruncated',
    'outputTruncated',
    'patchTruncated',
  ] as const;
  for (const key of truncationBooleanKeys) {
    if (metadata[key] === true) {
      return true;
    }
  }

  const truncationCountKeys = [
    'truncatedBytes',
    'truncatedLines',
    'omittedBytes',
    'omittedLines',
  ] as const;
  for (const key of truncationCountKeys) {
    const value = metadata[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return true;
    }
  }

  const statusKeys = ['status', 'artifactStatus', 'captureStatus'] as const;
  for (const key of statusKeys) {
    const value = metadata[key];
    if (typeof value === 'string' && containsTruncationMarker(value)) {
      return true;
    }
  }

  return false;
}

function containsTruncationMarker(value: string): boolean {
  return /\btruncat(?:ed|ion)?\b|\bomitted\b|\belided\b|\bclipped\b/ui.test(value);
}

function findExplicitPatchTruncationMarker(content: string): string | null {
  const lastMeaningfulLine = [...content.split('\n')]
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .at(-1);

  if (!lastMeaningfulLine) {
    return null;
  }

  if (
    /^\.\.\.\s*(?:\[[^\]]*truncat[^\]]*\]|truncat(?:ed|ion)?|omitted|elided)/ui.test(
      lastMeaningfulLine,
    ) ||
    /^\[[^\]]*truncat[^\]]*\]$/ui.test(lastMeaningfulLine)
  ) {
    return lastMeaningfulLine;
  }

  return null;
}

function findPatchBlocksWithoutReviewablePayload(content: string): string[] {
  return collectPatchBlockDiagnostics(content)
    .filter((block) => !block.hasReviewablePayload)
    .map((block) => block.file);
}

function findPatchBlocksWithDanglingHunkHeader(content: string): string[] {
  return collectPatchBlockDiagnostics(content)
    .filter((block) => block.hasDanglingHunkHeader)
    .map((block) => block.file);
}

function collectPatchBlockDiagnostics(content: string): Array<{
  file: string;
  hasReviewablePayload: boolean;
  hasDanglingHunkHeader: boolean;
}> {
  const diagnostics: Array<{
    file: string;
    hasReviewablePayload: boolean;
    hasDanglingHunkHeader: boolean;
  }> = [];
  let current:
    | {
        file: string;
        hasReviewablePayload: boolean;
        hasDanglingHunkHeader: boolean;
      }
    | undefined;

  for (const line of content.split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (current) {
        diagnostics.push(current);
      }
      current = {
        file: readPatchBlockFile(line),
        hasReviewablePayload: false,
        hasDanglingHunkHeader: false,
      };
      continue;
    }

    if (!current) {
      continue;
    }

    if (startsReviewableNonHunkPayload(line)) {
      current.hasReviewablePayload = true;
      current.hasDanglingHunkHeader = false;
      continue;
    }

    if (line.startsWith('@@ ')) {
      current.hasDanglingHunkHeader = true;
      continue;
    }

    if (
      current.hasDanglingHunkHeader &&
      (line.startsWith(' ') ||
        line.startsWith('+') ||
        line.startsWith('-') ||
        line.startsWith('\\ No newline at end of file'))
    ) {
      current.hasReviewablePayload = true;
      current.hasDanglingHunkHeader = false;
    }
  }

  if (current) {
    diagnostics.push(current);
  }

  return diagnostics;
}

function readPatchBlockFile(line: string): string {
  const match = /^diff --git a\/(.+?) b\/(.+)$/u.exec(line);
  return match?.[2] ?? 'unknown file';
}

function startsReviewableNonHunkPayload(line: string): boolean {
  return (
    line === 'GIT binary patch' ||
    line.startsWith('Binary files ') ||
    line.startsWith('similarity index ') ||
    line.startsWith('rename from ') ||
    line.startsWith('rename to ') ||
    line.startsWith('copy from ') ||
    line.startsWith('copy to ') ||
    line.startsWith('old mode ') ||
    line.startsWith('new mode ') ||
    line.startsWith('deleted file mode ') ||
    line.startsWith('new file mode ')
  );
}

function readReviewInputFiles(metadata: Record<string, unknown> | undefined): string[] {
  const bundle = metadata?.analysisBundle;
  if (bundle && typeof bundle === 'object') {
    const rawFiles = (bundle as { files?: unknown }).files;
    if (Array.isArray(rawFiles)) {
      const filtered = rawFiles.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') {
          return [];
        }

        const pathValue = (entry as { path?: unknown }).path;
        const kindValue = (entry as { kind?: unknown }).kind;
        if (typeof pathValue !== 'string' || pathValue.length === 0) {
          return [];
        }

        return kindValue === 'source_zip' ? [] : [pathValue];
      });
      if (filtered.length > 0) {
        return filtered;
      }
    }
  }

  return readAnalysisBundleInputFiles(metadata).filter((filePath) => !filePath.endsWith('.zip'));
}

function isPendingFinalize<T>(value: ReviewFinalizePending | T): value is ReviewFinalizePending {
  return (
    typeof value === 'object' && value !== null && 'status' in value && value.status === 'pending'
  );
}
