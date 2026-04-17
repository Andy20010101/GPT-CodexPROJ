import { createHash, randomUUID } from 'node:crypto';
import { ZodError } from 'zod';

import type {
  ArchitectureFreeze,
  EvidenceManifest,
  PlanningApplyRepairOperation,
  PlanningMaterializedResult,
  PlanningModelRoutingDecision,
  PlanningPhase,
  PlanningRequest,
  PlanningRuntimeState,
  RequirementFreeze,
  TaskGraph,
  TaskGraphEdge,
  TaskTestPlanItem,
} from '../contracts';
import {
  ArchitectureFreezeSchema,
  PlanningApplyRemediationInputSchema,
  PlanningApplyRemediationOutputSchema,
  PlanningApplyRetryResultSchema,
  PlanningConversationLinkSchema,
  PlanningMaterializedResultSchema,
  PlanningRuntimeStateSchema,
  PlanningTaskGraphOutputSchema,
  RequirementFreezeSchema,
  TaskGraphSchema,
} from '../contracts';
import type { RunRecord } from '../domain/run';
import { FilePlanningRepository } from '../storage/file-planning-repository';
import { OrchestratorError } from '../utils/error';
import { writeJsonFile } from '../utils/file-store';
import {
  getPlanningApplyRemediationInputFile,
  getPlanningApplyRemediationOutputFile,
  getPlanningApplyRetryResultFile,
  getPlanningFinalizeRuntimeStateFile,
  getPlanningMaterializedResultFile,
  getPlanningRequestFile,
  getPlanningRequestRuntimeStateFile,
} from '../utils/run-paths';
import {
  mergeMetadataWithAnalysisBundle,
  readAnalysisBundleInputFiles,
  resolveRunAnalysisBundle,
} from '../utils/analysis-bundle';
import { BridgeClient, BridgeClientError } from './bridge-client';
import { EvidenceLedgerService } from './evidence-ledger-service';
import { PlanningModelRoutingService } from './planning-model-routing-service';
import { PlanningPayloadBuilder } from './planning-payload-builder';

type BridgeErrorShape = {
  code: string;
  message: string;
  details?: unknown;
};

type PlanningResultMap = {
  requirement_freeze: RequirementFreeze;
  architecture_freeze: ArchitectureFreeze;
  task_graph_generation: TaskGraph;
};

type PlanningApplyErrorDetails = {
  name?: string;
  message: string;
  details?: unknown;
};

type PlanningApplyRepairClassification =
  | {
      classification: 'repairable';
      reasonCode: string;
      reasonMessage: string;
      followUpPrompt: string;
      repairs: PlanningApplyRepairOperation[];
      repairedPayload: Record<string, unknown>;
    }
  | {
      classification: 'fatal';
      reasonCode: string;
      reasonMessage: string;
      followUpPrompt?: string;
      repairs: PlanningApplyRepairOperation[];
    };

const architectureBoundaryOwnedPathsByModuleId: Readonly<Record<string, readonly string[]>> = {
  'planning-review-boundary': [
    'apps/orchestrator/src/services/planning-service.ts',
    'apps/orchestrator/src/services/review-service.ts',
    'apps/orchestrator/src/services/release-review-service.ts',
    'apps/orchestrator/src/services/planning-payload-builder.ts',
    'apps/orchestrator/src/services/review-payload-builder.ts',
  ],
  'bridge-attach-boundary': [
    'services/chatgpt-web-bridge/src/browser/browser-manager.ts',
    'services/chatgpt-web-bridge/src/browser/page-factory.ts',
    'services/chatgpt-web-bridge/src/adapters/chatgpt-adapter.ts',
  ],
};

const taskGraphVerificationMethodAliases: Readonly<Record<string, RequirementFreeze['acceptanceCriteria'][number]['verificationMethod']>> = {
  static_analysis: 'automated_test',
  code_review: 'review',
  documentation_review: 'review',
};

export type PlanningRequestDispatch = {
  evidence: EvidenceManifest[];
  modelRoutingDecision: PlanningModelRoutingDecision;
  planningDir: string;
  request: PlanningRequest;
  requestPath: string;
  requestRuntimeState: PlanningRuntimeState;
  requestRuntimeStatePath: string;
};

export type PlanningFinalizePending = {
  status: 'pending';
  planningDir: string;
  request: PlanningRequest;
  requestRuntimeState: PlanningRuntimeState;
  finalizeRuntimeState: PlanningRuntimeState;
  error: {
    code: 'PLANNING_FINALIZE_RETRYABLE' | 'PLANNING_MATERIALIZATION_PENDING';
    message: string;
    details?: unknown;
  };
};

export type PlanningFinalizeCompleted = {
  status: 'completed';
  evidence: EvidenceManifest[];
  planningDir: string;
  request: PlanningRequest;
  requestRuntimeState: PlanningRuntimeState;
  finalizeRuntimeState: PlanningRuntimeState;
  materializedResult: PlanningMaterializedResult;
  materializedResultPath: string;
};

export type PlanningFinalizeDispatch = PlanningFinalizePending | PlanningFinalizeCompleted;

export type PlanningApplyDispatch<Phase extends PlanningPhase> = {
  evidence: EvidenceManifest[];
  planningDir: string;
  request: PlanningRequest;
  requestRuntimeState: PlanningRuntimeState;
  finalizeRuntimeState: PlanningRuntimeState;
  materializedResult: PlanningMaterializedResult;
  normalizedResult: PlanningResultMap[Phase];
};

export class PlanningService {
  public constructor(
    private readonly bridgeClient: BridgeClient,
    private readonly planningRepository: FilePlanningRepository,
    private readonly evidenceLedgerService: EvidenceLedgerService,
    private readonly routingService: PlanningModelRoutingService,
    private readonly payloadBuilder: PlanningPayloadBuilder = new PlanningPayloadBuilder(),
    private readonly config: {
      browserUrl: string;
      projectName: string;
      requestTimeoutMs: number;
    },
  ) {}

  public async requestPhase(input: {
    run: RunRecord;
    phase: PlanningPhase;
    prompt?: string | undefined;
    producer: string;
    requestedBy: string;
    sourcePrompt?: string | undefined;
    requirementFreeze?: RequirementFreeze | null | undefined;
    architectureFreeze?: ArchitectureFreeze | null | undefined;
    metadata?: Record<string, unknown> | undefined;
    attempt?: number | undefined;
    requestJobId?: string | undefined;
    modelOverride?: string | undefined;
  }): Promise<PlanningRequestDispatch> {
    const analysisBundle = await resolveRunAnalysisBundle(
      this.planningRepository.getArtifactDir(),
      input.run.runId,
    );
    const existingRequest = await this.planningRepository.getRequest(input.run.runId, input.phase);
    const request =
      existingRequest ??
      this.buildRequest({
        run: input.run,
        phase: input.phase,
        prompt: input.prompt,
        requestedBy: input.requestedBy,
        sourcePrompt: input.sourcePrompt,
        metadata: mergeMetadataWithAnalysisBundle(input.metadata, analysisBundle),
      });
    const planningDir = getPlanningDir(
      this.planningRepository.getArtifactDir(),
      input.run.runId,
      input.phase,
    );
    const requestPath = getPlanningRequestFile(
      this.planningRepository.getArtifactDir(),
      request.runId,
      request.phase,
    );
    const requestRuntimeStatePath = getPlanningRequestRuntimeStateFile(
      this.planningRepository.getArtifactDir(),
      request.runId,
      request.phase,
    );
    const evidence: EvidenceManifest[] = [];

    if (!existingRequest) {
      await this.planningRepository.saveRequest(request);
      evidence.push(
        await this.evidenceLedgerService.appendEvidence({
          runId: request.runId,
          stage: input.run.stage,
          kind: 'planning_request',
          timestamp: request.createdAt,
          producer: input.producer,
          artifactPaths: [requestPath],
          summary: `Prepared ${request.phase} planning request ${request.planningId}`,
          metadata: {
            planningId: request.planningId,
            phase: request.phase,
          },
        }),
      );
    }

    const currentRequestState = await this.planningRepository.getRequestRuntimeState(
      request.runId,
      request.phase,
    );
    const currentFinalizeState = await this.planningRepository.getFinalizeRuntimeState(
      request.runId,
      request.phase,
    );
    const routingDecision =
      (await this.planningRepository.getModelRoutingDecision(request.runId, request.phase)) ??
      this.routingService.resolve({
        runId: request.runId,
        phase: request.phase,
        modelOverride: input.modelOverride,
        metadata: input.metadata,
      });

    if (
      currentRequestState &&
      currentRequestState.conversationId &&
      (currentRequestState.status === 'planning_waiting' ||
        currentRequestState.status === 'planning_materialized' ||
        currentFinalizeState?.status === 'planning_applied')
    ) {
      return {
        evidence,
        modelRoutingDecision: routingDecision,
        planningDir,
        request,
        requestPath,
        requestRuntimeState: currentRequestState,
        requestRuntimeStatePath,
      };
    }

    const routingDecisionPath =
      await this.planningRepository.saveModelRoutingDecision(routingDecision);
    if (!currentRequestState) {
      evidence.push(
        await this.evidenceLedgerService.appendEvidence({
          runId: request.runId,
          stage: input.run.stage,
          kind: 'planning_model_routing_decision',
          timestamp: routingDecision.requestedAt,
          producer: input.producer,
          artifactPaths: [routingDecisionPath],
          summary: `Routed ${request.phase} to ${routingDecision.lane}`,
          metadata: {
            planningId: request.planningId,
            phase: request.phase,
            model: routingDecision.model,
          },
        }),
      );
    }

    const seededState = await this.persistRequestRuntimeState({
      request,
      previous: currentRequestState,
      status: 'planning_requested',
      attempt: input.attempt ?? currentRequestState?.attempt ?? 1,
      requestJobId: input.requestJobId ?? currentRequestState?.requestJobId,
      model: routingDecision.model,
      metadata: {
        ...(currentRequestState?.metadata ?? {}),
        ...(input.metadata ?? {}),
        ...mergeMetadataWithAnalysisBundle(undefined, analysisBundle),
        browserUrl: this.config.browserUrl,
        projectName: this.config.projectName,
      },
    });

    try {
      const payload = this.payloadBuilder.build({
        request,
        phase: input.phase,
        requirementFreeze: input.requirementFreeze,
        architectureFreeze: input.architectureFreeze,
      });
      const session = await this.bridgeClient.openSession({
        browserUrl: this.config.browserUrl,
      }, {
        timeoutMs: this.config.requestTimeoutMs,
      });
      const selectedSession = await this.bridgeClient.selectProject({
        sessionId: session.sessionId,
        projectName: this.config.projectName,
        model: routingDecision.model,
      }, {
        timeoutMs: this.config.requestTimeoutMs,
      });
      const conversation = await this.bridgeClient.startConversation({
        sessionId: selectedSession.sessionId,
        projectName: this.config.projectName,
        model: routingDecision.model,
        prompt: payload.prompt,
        inputFiles: readAnalysisBundleInputFiles(request.metadata),
      }, {
        timeoutMs: this.config.requestTimeoutMs,
      });

      const conversationLinkPath = await this.planningRepository.saveConversationLink(
        PlanningConversationLinkSchema.parse({
          planningId: request.planningId,
          runId: request.runId,
          phase: request.phase,
          sessionId: selectedSession.sessionId,
          conversationId: conversation.conversationId,
          conversationUrl: conversation.pageUrl ?? selectedSession.pageUrl,
          browserUrl: selectedSession.browserUrl,
          model: conversation.model ?? routingDecision.model,
          linkedAt: new Date().toISOString(),
          metadata: mergeMetadataWithAnalysisBundle(input.metadata, analysisBundle),
        }),
      );
      evidence.push(
        await this.evidenceLedgerService.appendEvidence({
          runId: request.runId,
          stage: input.run.stage,
          kind: 'planning_conversation_link',
          timestamp: new Date().toISOString(),
          producer: input.producer,
          artifactPaths: [conversationLinkPath],
          summary: `Linked ${request.phase} planning request ${request.planningId} to bridge conversation`,
          metadata: {
            planningId: request.planningId,
            phase: request.phase,
            conversationId: conversation.conversationId,
          },
        }),
      );

      const waitingState = await this.persistRequestRuntimeState({
        request,
        previous: seededState,
        status: 'planning_waiting',
        attempt: input.attempt ?? seededState.attempt,
        requestJobId: input.requestJobId ?? seededState.requestJobId,
        sessionId: selectedSession.sessionId,
        conversationId: conversation.conversationId,
        conversationUrl: conversation.pageUrl ?? selectedSession.pageUrl,
        browserUrl: selectedSession.browserUrl,
        projectName: conversation.projectName,
        model: conversation.model ?? selectedSession.model ?? routingDecision.model,
        metadata: {
          ...seededState.metadata,
          ...(input.metadata ?? {}),
        },
        clearLastError: true,
      });

      return {
        evidence,
        modelRoutingDecision: routingDecision,
        planningDir,
        request,
        requestPath,
        requestRuntimeState: waitingState,
        requestRuntimeStatePath,
      };
    } catch (error) {
      await this.persistRequestRuntimeState({
        request,
        previous: seededState,
        status: 'planning_requested',
        attempt: input.attempt ?? seededState.attempt,
        requestJobId: input.requestJobId ?? seededState.requestJobId,
        model: routingDecision.model,
        metadata: {
          ...seededState.metadata,
          ...(input.metadata ?? {}),
        },
        lastError: this.toBridgeError(error) ?? {
          code: 'PLANNING_REQUEST_FAILED',
          message: error instanceof Error ? error.message : 'Planning request failed',
          details: error,
        },
      });
      throw error;
    }
  }

  public async finalizePhase(input: {
    run: RunRecord;
    phase: PlanningPhase;
    producer: string;
    metadata?: Record<string, unknown> | undefined;
    attempt?: number | undefined;
    finalizeJobId?: string | undefined;
    requirementFreeze?: RequirementFreeze | null | undefined;
    architectureFreeze?: ArchitectureFreeze | null | undefined;
  }): Promise<PlanningFinalizeDispatch> {
    const request = await this.requireRequest(input.run.runId, input.phase);
    const planningDir = getPlanningDir(
      this.planningRepository.getArtifactDir(),
      request.runId,
      request.phase,
    );
    const requestRuntimeState = await this.requireRequestRuntimeState(request);
    const existingResult = await this.planningRepository.getMaterializedResult(
      request.runId,
      request.phase,
    );
    let finalizeState =
      (await this.planningRepository.getFinalizeRuntimeState(request.runId, request.phase)) ??
      this.createFinalizeStateFromRequest(request, requestRuntimeState);

    if (existingResult) {
      return {
        status: 'completed',
        evidence: [],
        planningDir,
        request,
        requestRuntimeState,
        finalizeRuntimeState: finalizeState,
        materializedResult: existingResult,
        materializedResultPath: getPlanningMaterializedResultFile(
          this.planningRepository.getArtifactDir(),
          request.runId,
          request.phase,
        ),
      };
    }

    if (!requestRuntimeState.conversationId) {
      return this.returnPending({
        request,
        requestRuntimeState,
        previous: finalizeState,
        attempt: input.attempt ?? finalizeState.attempt,
        finalizeJobId: input.finalizeJobId ?? finalizeState.finalizeJobId,
        metadata: input.metadata,
        error: {
          code: 'PLANNING_FINALIZE_RETRYABLE',
          message: 'Planning conversation has not been created yet.',
          details: {
            planningId: request.planningId,
            phase: request.phase,
          },
        },
      });
    }

    finalizeState = await this.persistFinalizeRuntimeState({
      request,
      previous: finalizeState,
      status: finalizeState.status,
      attempt: input.attempt ?? finalizeState.attempt,
      finalizeJobId: input.finalizeJobId ?? finalizeState.finalizeJobId,
      metadata: input.metadata,
      clearLastError: true,
    });

    const finalizeEvidence: EvidenceManifest[] = [
      await this.evidenceLedgerService.appendEvidence({
        runId: request.runId,
        stage: input.run.stage,
        kind: 'planning_finalize_attempt',
        timestamp: new Date().toISOString(),
        producer: input.producer,
        artifactPaths: [
          getPlanningFinalizeRuntimeStateFile(
            this.planningRepository.getArtifactDir(),
            request.runId,
            request.phase,
          ),
        ],
        summary: `Finalized ${request.phase} planning request ${request.planningId}`,
        metadata: {
          planningId: request.planningId,
          phase: request.phase,
          conversationId: requestRuntimeState.conversationId,
        },
      }),
    ];

    if (
      finalizeState.status === 'planning_waiting' ||
      finalizeState.status === 'planning_requested'
    ) {
      const waitResult = await this.waitForConversationCompletion({
        request,
        requestRuntimeState,
        previous: finalizeState,
        attempt: input.attempt ?? finalizeState.attempt,
        finalizeJobId: input.finalizeJobId ?? finalizeState.finalizeJobId,
        metadata: input.metadata,
      });
      if ('status' in waitResult && waitResult.status === 'pending') {
        return waitResult;
      }
      finalizeState = waitResult.finalizeRuntimeState;
    }

    let bridgeMarkdown:
      | {
          artifactPath: string;
          manifestPath: string;
          markdown: string;
        }
      | undefined;
    const conversationId = requestRuntimeState.conversationId;
    if (!conversationId) {
      throw new OrchestratorError(
        'PLANNING_CONVERSATION_REQUIRED',
        'Planning markdown export requires a conversationId in runtime state.',
        {
          phase: request.phase,
          planningId: request.planningId,
          runId: request.runId,
        },
      );
    }
    try {
      bridgeMarkdown = await this.bridgeClient.exportMarkdown(conversationId, {
        fileName: `${request.phase}-${request.planningId}.md`,
      });
    } catch (error) {
      return this.returnPending({
        request,
        requestRuntimeState,
        previous: finalizeState,
        status: 'planning_materializing',
        attempt: input.attempt ?? finalizeState.attempt,
        finalizeJobId: input.finalizeJobId ?? finalizeState.finalizeJobId,
        metadata: input.metadata,
        error: {
          code: 'PLANNING_MATERIALIZATION_PENDING',
          message:
            'Planning conversation completed, but markdown export failed. Retry finalization from the existing conversation.',
          details: this.toBridgeError(error) ?? error,
        },
      });
    }

    const payload = this.payloadBuilder.build({
      request,
      phase: input.phase,
      requirementFreeze: input.requirementFreeze,
      architectureFreeze: input.architectureFreeze,
    });
    const extracted = await this.extractStructuredOutput({
      request,
      requestRuntimeState,
      previous: finalizeState,
      remediationPrompt: payload.remediationPrompt,
      attempt: input.attempt ?? finalizeState.attempt,
      finalizeJobId: input.finalizeJobId ?? finalizeState.finalizeJobId,
      metadata: input.metadata,
    });
    if (isPlanningPending(extracted)) {
      return extracted;
    }
    finalizeState = extracted.finalizeRuntimeState;

    const materializedResult = PlanningMaterializedResultSchema.parse({
      planningId: request.planningId,
      runId: request.runId,
      phase: request.phase,
      conversationId: requestRuntimeState.conversationId,
      conversationUrl: requestRuntimeState.conversationUrl,
      materializedAt: new Date().toISOString(),
      producer: input.producer,
      markdownPath: bridgeMarkdown.artifactPath,
      markdownManifestPath: bridgeMarkdown.manifestPath,
      structuredResultPath: extracted.structuredResult.artifactPath,
      structuredResultManifestPath: extracted.structuredResult.manifestPath,
      payload: extracted.structuredResult.payload,
      metadata: {
        ...(input.metadata ?? {}),
      },
    });
    const materializedResultPath =
      await this.planningRepository.saveMaterializedResult(materializedResult);
    finalizeEvidence.push(
      await this.evidenceLedgerService.appendEvidence({
        runId: request.runId,
        stage: input.run.stage,
        kind: 'planning_materialized_result',
        timestamp: materializedResult.materializedAt,
        producer: input.producer,
        artifactPaths: [materializedResultPath],
        summary: `Materialized ${request.phase} planning result ${request.planningId}`,
        metadata: {
          planningId: request.planningId,
          phase: request.phase,
          conversationId: requestRuntimeState.conversationId,
        },
      }),
    );

    finalizeState = await this.persistFinalizeRuntimeState({
      request,
      previous: finalizeState,
      status: 'planning_materialized',
      attempt: input.attempt ?? finalizeState.attempt,
      finalizeJobId: input.finalizeJobId ?? finalizeState.finalizeJobId,
      metadata: {
        ...(finalizeState.metadata ?? {}),
        ...(input.metadata ?? {}),
        materializedResultPath,
      },
      clearLastError: true,
    });

    return {
      status: 'completed',
      evidence: finalizeEvidence,
      planningDir,
      request,
      requestRuntimeState,
      finalizeRuntimeState: finalizeState,
      materializedResult,
      materializedResultPath,
    };
  }

  public async applyPhase<Phase extends PlanningPhase>(input: {
    run: RunRecord;
    phase: Phase;
    appliedBy: string;
    metadata?: Record<string, unknown> | undefined;
    normalization?: Record<string, unknown> | undefined;
  }): Promise<PlanningApplyDispatch<Phase>> {
    const request = await this.requireRequest(input.run.runId, input.phase);
    const requestRuntimeState = await this.requireRequestRuntimeState(request);
    let finalizeRuntimeState = await this.requireFinalizeRuntimeState(request);
    let materializedResult = await this.requireMaterializedResult(request);
    let normalizedResult: PlanningResultMap[Phase];
    const evidence: EvidenceManifest[] = [];

    try {
      normalizedResult = this.normalizePhaseResult({
        phase: input.phase,
        request,
        payload: materializedResult.payload,
        appliedBy: input.appliedBy,
        normalization: input.normalization,
      }) as PlanningResultMap[Phase];
    } catch (error) {
      const remediation = await this.tryRepairPlanningApplyError({
        run: input.run,
        request,
        finalizeRuntimeState,
        materializedResult,
        appliedBy: input.appliedBy,
        normalization: input.normalization,
        metadata: input.metadata,
        error,
      });
      if (!remediation) {
        throw error;
      }
      finalizeRuntimeState = remediation.finalizeRuntimeState;
      materializedResult = remediation.materializedResult;
      normalizedResult = remediation.normalizedResult as PlanningResultMap[Phase];
      evidence.push(...remediation.evidence);
    }

    const updatedMaterializedResult = PlanningMaterializedResultSchema.parse({
      ...materializedResult,
      normalizedResult,
      metadata: {
        ...materializedResult.metadata,
        ...(input.metadata ?? {}),
      },
    });
    await this.planningRepository.saveMaterializedResult(updatedMaterializedResult);

    return {
      evidence,
      planningDir: getPlanningDir(
        this.planningRepository.getArtifactDir(),
        request.runId,
        request.phase,
      ),
      request,
      requestRuntimeState,
      finalizeRuntimeState,
      materializedResult: updatedMaterializedResult,
      normalizedResult,
    };
  }

  public async markPlanningApplied(input: {
    request: PlanningRequest;
    previous: PlanningRuntimeState;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<PlanningRuntimeState> {
    return this.persistFinalizeRuntimeState({
      request: input.request,
      previous: input.previous,
      status: 'planning_applied',
      attempt: input.previous.attempt,
      finalizeJobId: input.previous.finalizeJobId,
      metadata: {
        ...(input.previous.metadata ?? {}),
        ...(input.metadata ?? {}),
      },
      clearLastError: true,
      completedAt: new Date().toISOString(),
    });
  }

  private async tryRepairPlanningApplyError(input: {
    run: RunRecord;
    request: PlanningRequest;
    finalizeRuntimeState: PlanningRuntimeState;
    materializedResult: PlanningMaterializedResult;
    appliedBy: string;
    normalization?: Record<string, unknown> | undefined;
    metadata?: Record<string, unknown> | undefined;
    error: unknown;
  }): Promise<{
    evidence: EvidenceManifest[];
    finalizeRuntimeState: PlanningRuntimeState;
    materializedResult: PlanningMaterializedResult;
    normalizedResult: RequirementFreeze | ArchitectureFreeze | TaskGraph;
  } | null> {
    const classification = this.classifyPlanningApplyError({
      runId: input.request.runId,
      phase: input.request.phase,
      payload: input.materializedResult.payload,
      error: input.error,
    });

    const remediationId = randomUUID();
    const artifactDir = this.planningRepository.getArtifactDir();
    const remediationInputPath = getPlanningApplyRemediationInputFile(
      artifactDir,
      input.request.runId,
      input.request.phase,
    );
    const remediationOutputPath = getPlanningApplyRemediationOutputFile(
      artifactDir,
      input.request.runId,
      input.request.phase,
    );
    const retryResultPath = getPlanningApplyRetryResultFile(
      artifactDir,
      input.request.runId,
      input.request.phase,
    );
    const sourceMaterializedResultPath = getPlanningMaterializedResultFile(
      artifactDir,
      input.request.runId,
      input.request.phase,
    );
    const originalError = this.toPlanningApplyErrorDetails(input.error);
    const remediationInput = PlanningApplyRemediationInputSchema.parse({
      remediationId,
      runId: input.request.runId,
      planningId: input.request.planningId,
      phase: input.request.phase,
      classification: classification.classification,
      reasonCode: classification.reasonCode,
      reasonMessage: classification.reasonMessage,
      detectedAt: new Date().toISOString(),
      sourceMaterializedResultPath,
      originalError,
      ...(classification.followUpPrompt
        ? { followUpPrompt: classification.followUpPrompt }
        : {}),
      plannedRepairs: classification.repairs,
    });
    await writeJsonFile(remediationInputPath, remediationInput);

    const evidence: EvidenceManifest[] = [
      await this.evidenceLedgerService.appendEvidence({
        runId: input.request.runId,
        stage: input.run.stage,
        kind: 'remediation_proposal',
        timestamp: remediationInput.detectedAt,
        producer: input.appliedBy,
        artifactPaths: [remediationInputPath],
        summary: `${classification.classification === 'repairable' ? 'Detected repairable' : 'Detected fatal'} ${input.request.phase} apply error ${classification.reasonCode}`,
        metadata: {
          planningId: input.request.planningId,
          phase: input.request.phase,
          remediationId,
          reasonCode: classification.reasonCode,
        },
      }),
    ];

    if (classification.classification === 'fatal') {
      await this.persistFinalizeRuntimeState({
        request: input.request,
        previous: input.finalizeRuntimeState,
        status: input.finalizeRuntimeState.status,
        attempt: input.finalizeRuntimeState.attempt,
        metadata: {
          ...(input.metadata ?? {}),
          planningApplyRemediationInputPath: remediationInputPath,
          planningApplyRemediationClassification: 'fatal',
          planningApplyRemediationReasonCode: classification.reasonCode,
        },
        lastError: {
          code: 'PLANNING_APPLY_SCHEMA_FATAL',
          message: classification.reasonMessage,
          details: {
            remediationInputPath,
            originalError,
          },
        },
      });
      return null;
    }

    const remediationOutput = PlanningApplyRemediationOutputSchema.parse({
      remediationId,
      runId: input.request.runId,
      planningId: input.request.planningId,
      phase: input.request.phase,
      appliedAt: new Date().toISOString(),
      appliedRepairs: classification.repairs,
      repairedPayload: classification.repairedPayload,
    });
    await writeJsonFile(remediationOutputPath, remediationOutput);
    evidence.push(
      await this.evidenceLedgerService.appendEvidence({
        runId: input.request.runId,
        stage: input.run.stage,
        kind: 'remediation_result',
        timestamp: remediationOutput.appliedAt,
        producer: input.appliedBy,
        artifactPaths: [remediationOutputPath],
        summary: `Applied ${input.request.phase} remediation ${classification.reasonCode}`,
        metadata: {
          planningId: input.request.planningId,
          phase: input.request.phase,
          remediationId,
          repairKinds: classification.repairs.map((repair) => repair.kind),
        },
      }),
    );

    const remediatedMaterializedResult = PlanningMaterializedResultSchema.parse({
      ...input.materializedResult,
      payload: classification.repairedPayload,
      metadata: {
        ...input.materializedResult.metadata,
        ...(input.metadata ?? {}),
        planningApplyRemediation: {
          remediationId,
          inputPath: remediationInputPath,
          outputPath: remediationOutputPath,
          reasonCode: classification.reasonCode,
          repairKinds: classification.repairs.map((repair) => repair.kind),
        },
      },
    });
    await this.planningRepository.saveMaterializedResult(remediatedMaterializedResult);

    const remediationState = await this.persistFinalizeRuntimeState({
      request: input.request,
      previous: input.finalizeRuntimeState,
      status: input.finalizeRuntimeState.status,
      attempt: input.finalizeRuntimeState.attempt,
      metadata: {
        ...(input.metadata ?? {}),
        planningApplyRemediationInputPath: remediationInputPath,
        planningApplyRemediationOutputPath: remediationOutputPath,
        planningApplyRetryResultPath: retryResultPath,
        planningApplyRemediationClassification: 'repairable',
        planningApplyRemediationReasonCode: classification.reasonCode,
        planningApplyRemediationRepairKinds: classification.repairs.map((repair) => repair.kind),
      },
      remediationAttempted: true,
      lastError: {
        code: 'PLANNING_APPLY_SCHEMA_REPAIRABLE',
        message: classification.reasonMessage,
        details: {
          remediationInputPath,
          remediationOutputPath,
          repairs: classification.repairs,
        },
      },
    });

    try {
      const normalizedResult = this.normalizePhaseResult({
        phase: input.request.phase,
        request: input.request,
        payload: remediatedMaterializedResult.payload,
        appliedBy: input.appliedBy,
        normalization: input.normalization,
      });
      const retryResult = PlanningApplyRetryResultSchema.parse({
        remediationId,
        runId: input.request.runId,
        planningId: input.request.planningId,
        phase: input.request.phase,
        attemptedAt: new Date().toISOString(),
        status: 'retry_succeeded',
        resultMessage: `${input.request.phase} apply payload normalized successfully after remediation.`,
      });
      await writeJsonFile(retryResultPath, retryResult);
      evidence.push(
        await this.evidenceLedgerService.appendEvidence({
          runId: input.request.runId,
          stage: input.run.stage,
          kind: 'remediation_result',
          timestamp: retryResult.attemptedAt,
          producer: input.appliedBy,
          artifactPaths: [retryResultPath],
          summary: `Retried ${input.request.phase} apply successfully after remediation`,
          metadata: {
            planningId: input.request.planningId,
            phase: input.request.phase,
            remediationId,
            retryStatus: retryResult.status,
          },
        }),
      );
      return {
        evidence,
        finalizeRuntimeState: remediationState,
        materializedResult: remediatedMaterializedResult,
        normalizedResult,
      };
    } catch (retryError) {
      const retryResult = PlanningApplyRetryResultSchema.parse({
        remediationId,
        runId: input.request.runId,
        planningId: input.request.planningId,
        phase: input.request.phase,
        attemptedAt: new Date().toISOString(),
        status: 'retry_failed',
        resultMessage: `${input.request.phase} apply payload remained invalid after remediation.`,
        error: {
          message:
            retryError instanceof Error ? retryError.message : 'Unknown remediation retry failure.',
          details: this.toPlanningApplyErrorDetails(retryError).details,
        },
      });
      await writeJsonFile(retryResultPath, retryResult);
      evidence.push(
        await this.evidenceLedgerService.appendEvidence({
          runId: input.request.runId,
          stage: input.run.stage,
          kind: 'remediation_result',
          timestamp: retryResult.attemptedAt,
          producer: input.appliedBy,
          artifactPaths: [retryResultPath],
          summary: `Remediation retry for ${input.request.phase} apply still failed`,
          metadata: {
            planningId: input.request.planningId,
            phase: input.request.phase,
            remediationId,
            retryStatus: retryResult.status,
          },
        }),
      );
      await this.persistFinalizeRuntimeState({
        request: input.request,
        previous: remediationState,
        status: remediationState.status,
        attempt: remediationState.attempt,
        metadata: {
          ...(input.metadata ?? {}),
          planningApplyRetryResultPath: retryResultPath,
        },
        remediationAttempted: true,
        lastError: {
          code: 'PLANNING_APPLY_SCHEMA_FATAL',
          message: retryResult.resultMessage,
          details: retryResult.error,
        },
      });
      throw retryError;
    }
  }

  private classifyPlanningApplyError(input: {
    runId: string;
    phase: PlanningPhase;
    payload: Record<string, unknown>;
    error: unknown;
  }): PlanningApplyRepairClassification {
    if (input.phase === 'architecture_freeze') {
      return this.classifyArchitectureApplyError(input.payload);
    }

    if (input.phase === 'task_graph_generation') {
      return this.classifyTaskGraphApplyError(input.runId, input.payload);
    }

    return {
      classification: 'fatal',
      reasonCode: 'UNSUPPORTED_PLANNING_APPLY_ERROR',
      reasonMessage:
        'Planning apply failed and no deterministic remediation is registered for this phase.',
      repairs: [],
    };
  }

  private classifyArchitectureApplyError(
    rawPayload: Record<string, unknown>,
  ): PlanningApplyRepairClassification {
    const payload = cloneJsonRecord(rawPayload);
    const moduleDefinitions = Array.isArray(payload.moduleDefinitions)
      ? payload.moduleDefinitions
      : [];
    const dependencyRules = Array.isArray(payload.dependencyRules) ? payload.dependencyRules : [];
    const repairs: PlanningApplyRepairOperation[] = [];
    const unsupported: string[] = [];

    moduleDefinitions.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        unsupported.push(`moduleDefinitions[${index}] is not an object`);
        return;
      }
      const module = entry as Record<string, unknown>;
      const moduleId = readString(module.moduleId, `module-${index + 1}`);
      const ownedPaths = Array.isArray(module.ownedPaths)
        ? module.ownedPaths.filter((value): value is string => typeof value === 'string')
        : [];
      if (ownedPaths.length > 0) {
        return;
      }

      const repairedOwnedPaths = architectureBoundaryOwnedPathsByModuleId[moduleId];
      if (!repairedOwnedPaths || repairedOwnedPaths.length === 0) {
        unsupported.push(`moduleDefinitions[${index}].ownedPaths is empty for unsupported module ${moduleId}`);
        return;
      }

      module.ownedPaths = [...repairedOwnedPaths];
      repairs.push({
        kind: 'populate_boundary_owned_paths',
        target: moduleId,
        field: 'moduleDefinitions[].ownedPaths',
        rationale: 'Boundary modules must enumerate the concrete external surfaces they describe.',
        before: ownedPaths,
        after: [...repairedOwnedPaths],
      });
    });

    dependencyRules.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        unsupported.push(`dependencyRules[${index}] is not an object`);
        return;
      }
      const ruleEntry = entry as Record<string, unknown>;
      const rawRule = typeof ruleEntry.rule === 'string' ? ruleEntry.rule.trim().toLowerCase() : '';
      if (rawRule === 'allow' || rawRule === 'deny') {
        return;
      }
      if (rawRule === 'allowed' || rawRule === 'forbidden') {
        const canonicalRule = rawRule === 'forbidden' ? 'deny' : 'allow';
        const fromModuleId = readString(ruleEntry.fromModuleId, `module-${index + 1}`);
        const toModuleId = readString(ruleEntry.toModuleId, `module-${index + 2}`);
        ruleEntry.rule = canonicalRule;
        repairs.push({
          kind: 'canonicalize_dependency_rule_alias',
          target: `${fromModuleId}->${toModuleId}`,
          field: 'dependencyRules[].rule',
          rationale: 'Architecture freeze dependency rules must use the canonical allow/deny enum.',
          before: rawRule,
          after: canonicalRule,
        });
        return;
      }
      unsupported.push(`dependencyRules[${index}].rule used unsupported value "${String(ruleEntry.rule ?? '')}"`);
    });

    if (repairs.length === 0 || unsupported.length > 0) {
      return {
        classification: 'fatal',
        reasonCode:
          unsupported.length > 0 ? 'ARCHITECTURE_SCHEMA_FATAL' : 'UNSUPPORTED_PLANNING_APPLY_ERROR',
        reasonMessage:
          unsupported.length > 0
            ? `Architecture apply failed with unsupported schema violations: ${unsupported.join('; ')}`
            : 'Architecture apply failed without a registered deterministic remediation path.',
        repairs,
        ...(repairs.length > 0
          ? {
              followUpPrompt:
                'Repair only the flagged schema-invalid architecture fields and preserve the rest of the architecture verbatim.',
            }
          : {}),
      };
    }

    return {
      classification: 'repairable',
      reasonCode: 'ARCHITECTURE_SCHEMA_REPAIRABLE',
      reasonMessage:
        'Architecture apply failed with repairable schema violations; boundary ownedPaths and dependency rule aliases can be canonicalized deterministically.',
      followUpPrompt: [
        'Repair only the schema-invalid parts of the architecture payload before apply.',
        'Populate non-empty ownedPaths for boundary modules with the concrete boundary surfaces they describe.',
        'Canonicalize dependencyRules.rule values to allow/deny only.',
        'Do not change the architecture summary, owned write surface, invariants, or out-of-scope semantics.',
      ].join(' '),
      repairs,
      repairedPayload: payload,
    };
  }

  private classifyTaskGraphApplyError(
    runId: string,
    rawPayload: Record<string, unknown>,
  ): PlanningApplyRepairClassification {
    const payload = cloneJsonRecord(rawPayload);
    const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
    const edges = Array.isArray(payload.edges) ? payload.edges : [];
    const repairs: PlanningApplyRepairOperation[] = [];
    const unsupported: string[] = [];
    const canonicalTaskIds = new Map<string, string>();
    const canonicalTaskIdsByTitle = new Map<string, string>();

    tasks.forEach((entry, taskIndex) => {
      if (!entry || typeof entry !== 'object') {
        return;
      }
      const task = entry as Record<string, unknown>;
      const title = readString(task.title, `Task ${taskIndex + 1}`);
      const rawTaskId =
        typeof task.taskId === 'string' && task.taskId.trim().length > 0 ? task.taskId.trim() : '';
      if (rawTaskId && isUuidString(rawTaskId)) {
        canonicalTaskIds.set(rawTaskId, rawTaskId);
        canonicalTaskIdsByTitle.set(title, rawTaskId);
        return;
      }

      const canonicalTaskId = deterministicTaskGraphUuid(runId, rawTaskId || title, title, taskIndex);
      task.taskId = canonicalTaskId;
      if (rawTaskId) {
        canonicalTaskIds.set(rawTaskId, canonicalTaskId);
      }
      canonicalTaskIdsByTitle.set(title, canonicalTaskId);
      repairs.push({
        kind: 'canonicalize_task_reference_id',
        target: rawTaskId || title,
        field: 'tasks[].taskId',
        rationale:
          'Task-graph tasks must use UUID taskIds; legacy planning aliases are deterministically canonicalized before apply.',
        before: rawTaskId || null,
        after: canonicalTaskId,
      });
    });

    tasks.forEach((entry, taskIndex) => {
      if (!entry || typeof entry !== 'object') {
        unsupported.push(`tasks[${taskIndex}] is not an object`);
        return;
      }
      const task = entry as Record<string, unknown>;
      const taskId = readString(task.taskId, `task-${taskIndex + 1}`);
      const dependencies = Array.isArray(task.dependencies) ? task.dependencies : [];
      dependencies.forEach((dependency, dependencyIndex) => {
        if (typeof dependency !== 'string' || dependency.trim().length === 0) {
          unsupported.push(
            `tasks[${taskIndex}].dependencies[${dependencyIndex}] is not a non-empty string`,
          );
          return;
        }
        const rawDependency = dependency.trim();
        if (isUuidString(rawDependency)) {
          return;
        }
        const canonicalDependency =
          canonicalTaskIds.get(rawDependency) ?? canonicalTaskIdsByTitle.get(rawDependency);
        if (!canonicalDependency) {
          unsupported.push(
            `tasks[${taskIndex}].dependencies[${dependencyIndex}] used unsupported task reference "${rawDependency}"`,
          );
          return;
        }
        dependencies[dependencyIndex] = canonicalDependency;
        repairs.push({
          kind: 'canonicalize_task_reference_id',
          target: `${taskId}:dependency:${rawDependency}`,
          field: 'tasks[].dependencies[]',
          rationale:
            'Task-graph dependency references must resolve to canonical UUID taskIds before apply.',
          before: rawDependency,
          after: canonicalDependency,
        });
      });
      const acceptanceCriteria = Array.isArray(task.acceptanceCriteria) ? task.acceptanceCriteria : [];
      acceptanceCriteria.forEach((criterionEntry, criterionIndex) => {
        if (!criterionEntry || typeof criterionEntry !== 'object') {
          unsupported.push(`tasks[${taskIndex}].acceptanceCriteria[${criterionIndex}] is not an object`);
          return;
        }
        const criterion = criterionEntry as Record<string, unknown>;
        const rawMethod =
          typeof criterion.verificationMethod === 'string'
            ? criterion.verificationMethod.trim().toLowerCase()
            : '';
        if (
          rawMethod === '' ||
          rawMethod === 'automated_test' ||
          rawMethod === 'review' ||
          rawMethod === 'manual' ||
          rawMethod === 'artifact'
        ) {
          return;
        }

        const canonicalMethod = taskGraphVerificationMethodAliases[rawMethod];
        if (!canonicalMethod) {
          unsupported.push(
            `tasks[${taskIndex}].acceptanceCriteria[${criterionIndex}].verificationMethod used unsupported value "${String(criterion.verificationMethod ?? '')}"`,
          );
          return;
        }

        const criterionId = readString(
          criterion.id,
          `${taskId}-ac-${criterionIndex + 1}`,
        );
        criterion.verificationMethod = canonicalMethod;
        repairs.push({
          kind: 'canonicalize_verification_method_alias',
          target: `${taskId}:${criterionId}`,
          field: 'tasks[].acceptanceCriteria[].verificationMethod',
          rationale:
            'Task-graph acceptance criteria must use the canonical automated_test/review/manual/artifact enum.',
          before: rawMethod,
          after: canonicalMethod,
        });
      });
    });

    edges.forEach((entry, edgeIndex) => {
      if (!entry || typeof entry !== 'object') {
        unsupported.push(`edges[${edgeIndex}] is not an object`);
        return;
      }
      const edge = entry as Record<string, unknown>;
      for (const field of ['fromTaskId', 'toTaskId'] as const) {
        const edgeReference = edge[field];
        const rawReference =
          typeof edgeReference === 'string' && edgeReference.trim().length > 0
            ? edgeReference.trim()
            : '';
        if (!rawReference) {
          unsupported.push(`edges[${edgeIndex}].${field} is not a non-empty string`);
          continue;
        }
        if (isUuidString(rawReference)) {
          continue;
        }
        const canonicalReference =
          canonicalTaskIds.get(rawReference) ?? canonicalTaskIdsByTitle.get(rawReference);
        if (!canonicalReference) {
          unsupported.push(`edges[${edgeIndex}].${field} used unsupported task reference "${rawReference}"`);
          continue;
        }
        edge[field] = canonicalReference;
        repairs.push({
          kind: 'canonicalize_task_reference_id',
          target: `edge-${edgeIndex + 1}:${field}:${rawReference}`,
          field: `edges[].${field}`,
          rationale: 'Task-graph edges must reference canonical UUID taskIds before apply.',
          before: rawReference,
          after: canonicalReference,
        });
      }
    });

    if (repairs.length === 0 || unsupported.length > 0) {
      return {
        classification: 'fatal',
        reasonCode:
          unsupported.length > 0 ? 'TASK_GRAPH_SCHEMA_FATAL' : 'UNSUPPORTED_PLANNING_APPLY_ERROR',
        reasonMessage:
          unsupported.length > 0
            ? `Task-graph apply failed with unsupported schema violations: ${unsupported.join('; ')}`
            : 'Task-graph apply failed without a registered deterministic remediation path.',
        repairs,
        ...(repairs.length > 0
          ? {
              followUpPrompt:
                'Repair only the flagged schema-invalid task-graph fields and preserve the rest of the task graph verbatim.',
            }
          : {}),
      };
    }

    return {
      classification: 'repairable',
      reasonCode: 'TASK_GRAPH_SCHEMA_REPAIRABLE',
      reasonMessage:
        'Task-graph apply failed with repairable schema violations; verificationMethod aliases and task reference ids can be canonicalized deterministically.',
      followUpPrompt: [
        'Repair only the schema-invalid parts of the task-graph payload before apply.',
        'Canonicalize acceptanceCriteria.verificationMethod values to automated_test, review, manual, or artifact only.',
        'Canonicalize task ids, dependency references, and edge references to stable UUIDs only.',
        'Do not change task titles, objectives, file scopes, dependencies, or task ordering semantics.',
      ].join(' '),
      repairs,
      repairedPayload: payload,
    };
  }

  private toPlanningApplyErrorDetails(error: unknown): PlanningApplyErrorDetails {
    if (error instanceof ZodError) {
      return {
        name: error.name,
        message: error.message,
        details: error.flatten(),
      };
    }
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
      };
    }
    return {
      message: String(error),
    };
  }

  private buildRequest(input: {
    run: RunRecord;
    phase: PlanningPhase;
    prompt?: string | undefined;
    requestedBy: string;
    sourcePrompt?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): PlanningRequest {
    const prompt = input.prompt ?? input.run.summary ?? input.run.title;
    return {
      planningId: randomUUID(),
      runId: input.run.runId,
      phase: input.phase,
      prompt,
      requestedBy: input.requestedBy,
      ...(input.sourcePrompt ? { sourcePrompt: input.sourcePrompt } : {}),
      metadata: input.metadata ?? {},
      createdAt: new Date().toISOString(),
    };
  }

  private async extractStructuredOutput(input: {
    request: PlanningRequest;
    requestRuntimeState: PlanningRuntimeState;
    previous: PlanningRuntimeState;
    remediationPrompt: string;
    attempt: number;
    finalizeJobId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<
    | PlanningFinalizePending
    | {
        finalizeRuntimeState: PlanningRuntimeState;
        structuredResult: {
          artifactPath: string;
          manifestPath: string;
          payload: Record<string, unknown>;
        };
      }
  > {
    const conversationId = input.requestRuntimeState.conversationId;
    if (!conversationId) {
      return this.returnPending({
        request: input.request,
        requestRuntimeState: input.requestRuntimeState,
        previous: input.previous,
        status: 'planning_materializing',
        attempt: input.attempt,
        finalizeJobId: input.finalizeJobId,
        metadata: input.metadata,
        error: {
          code: 'PLANNING_MATERIALIZATION_PENDING',
          message: 'Planning conversation is missing while extracting structured output.',
        },
      });
    }

    try {
      const structuredResult = await this.bridgeClient.extractStructuredReview(conversationId, {
        fileName: `${input.request.phase}-${input.request.planningId}.json`,
      });
      return {
        finalizeRuntimeState: input.previous,
        structuredResult,
      };
    } catch (error) {
      const bridgeError = this.toBridgeError(error);
      if (bridgeError?.code === 'STRUCTURED_OUTPUT_NOT_FOUND') {
        if (input.previous.remediationAttempted) {
          return this.returnPending({
            request: input.request,
            requestRuntimeState: input.requestRuntimeState,
            previous: input.previous,
            status: 'planning_materializing',
            attempt: input.attempt,
            finalizeJobId: input.finalizeJobId,
            metadata: input.metadata,
            error: {
              code: 'PLANNING_MATERIALIZATION_PENDING',
              message:
                'Planning output still has no structured JSON block after remediation. Retry finalization from the existing conversation.',
              details: bridgeError.details,
            },
          });
        }

        const remediationState = await this.persistFinalizeRuntimeState({
          request: input.request,
          previous: input.previous,
          status: 'planning_materializing',
          attempt: input.attempt,
          finalizeJobId: input.finalizeJobId,
          metadata: input.metadata,
          remediationAttempted: true,
          clearLastError: true,
        });

        try {
          await this.bridgeClient.sendMessage(conversationId, {
            message: input.remediationPrompt,
            inputFiles: readAnalysisBundleInputFiles(input.request.metadata),
          });
          const waitingState = await this.persistFinalizeRuntimeState({
            request: input.request,
            previous: remediationState,
            status: 'planning_waiting',
            attempt: input.attempt,
            finalizeJobId: input.finalizeJobId,
            metadata: input.metadata,
            clearLastError: true,
          });
          const waitResult = await this.waitForConversationCompletion({
            request: input.request,
            requestRuntimeState: input.requestRuntimeState,
            previous: waitingState,
            attempt: input.attempt,
            finalizeJobId: input.finalizeJobId,
            metadata: input.metadata,
          });
          if ('status' in waitResult && waitResult.status === 'pending') {
            return waitResult;
          }
          return this.extractStructuredOutput({
            ...input,
            previous: waitResult.finalizeRuntimeState,
          });
        } catch (remediationError) {
          return this.returnPending({
            request: input.request,
            requestRuntimeState: input.requestRuntimeState,
            previous: remediationState,
            status: 'planning_materializing',
            attempt: input.attempt,
            finalizeJobId: input.finalizeJobId,
            metadata: input.metadata,
            error: {
              code: 'PLANNING_MATERIALIZATION_PENDING',
              message:
                'Structured planning extraction required remediation, but the follow-up bridge call failed. Retry finalization from the existing conversation.',
              details: this.toBridgeError(remediationError) ?? remediationError,
            },
          });
        }
      }

      return this.returnPending({
        request: input.request,
        requestRuntimeState: input.requestRuntimeState,
        previous: input.previous,
        status: 'planning_materializing',
        attempt: input.attempt,
        finalizeJobId: input.finalizeJobId,
        metadata: input.metadata,
        error: {
          code: 'PLANNING_MATERIALIZATION_PENDING',
          message:
            'Planning conversation completed, but structured output extraction failed. Retry finalization from the existing conversation.',
          details: bridgeError ?? error,
        },
      });
    }
  }

  private async waitForConversationCompletion(input: {
    request: PlanningRequest;
    requestRuntimeState: PlanningRuntimeState;
    previous: PlanningRuntimeState;
    attempt: number;
    finalizeJobId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<{ finalizeRuntimeState: PlanningRuntimeState } | PlanningFinalizePending> {
    const conversationId = input.requestRuntimeState.conversationId;
    if (!conversationId) {
      return this.returnPending({
        request: input.request,
        requestRuntimeState: input.requestRuntimeState,
        previous: input.previous,
        status: 'planning_waiting',
        attempt: input.attempt,
        finalizeJobId: input.finalizeJobId,
        metadata: input.metadata,
        error: {
          code: 'PLANNING_FINALIZE_RETRYABLE',
          message: 'Planning conversation is missing from request runtime state.',
        },
      });
    }

    const routingDecision = await this.planningRepository.getModelRoutingDecision(
      input.request.runId,
      input.request.phase,
    );
    try {
      const snapshot = await this.bridgeClient.waitForCompletion(conversationId, {
        maxWaitMs: routingDecision?.maxWaitMs,
        pollIntervalMs: routingDecision?.pollIntervalMs,
        stablePolls: routingDecision?.stablePolls,
      });
      return {
        finalizeRuntimeState: await this.persistFinalizeRuntimeState({
          request: input.request,
          previous: input.previous,
          status: 'planning_materializing',
          attempt: input.attempt,
          finalizeJobId: input.finalizeJobId,
          sessionId: snapshot.sessionId,
          conversationId: input.requestRuntimeState.conversationId,
          conversationUrl: snapshot.pageUrl ?? input.requestRuntimeState.conversationUrl,
          metadata: input.metadata,
          clearLastError: true,
        }),
      };
    } catch (error) {
      if (input.previous.recoveryAttempted) {
        return this.returnPending({
          request: input.request,
          requestRuntimeState: input.requestRuntimeState,
          previous: input.previous,
          status: 'planning_waiting',
          attempt: input.attempt,
          finalizeJobId: input.finalizeJobId,
          metadata: input.metadata,
          error: {
            code: 'PLANNING_FINALIZE_RETRYABLE',
            message:
              'Planning conversation exists, but completion could not be confirmed yet. Retry finalization from the persisted conversation.',
            details: this.toBridgeError(error) ?? error,
          },
        });
      }

      try {
        const recovered = await this.bridgeClient.recoverConversation(conversationId, {
          sessionId: input.requestRuntimeState.sessionId,
          browserUrl: input.requestRuntimeState.browserUrl,
          pageUrl: input.requestRuntimeState.conversationUrl,
          projectName: input.requestRuntimeState.projectName,
          model: input.requestRuntimeState.model,
          inputFiles: readAnalysisBundleInputFiles(input.request.metadata),
        });
        if (recovered.snapshot.status === 'completed') {
          return {
            finalizeRuntimeState: await this.persistFinalizeRuntimeState({
              request: input.request,
              previous: input.previous,
              status: 'planning_materializing',
              attempt: input.attempt,
              finalizeJobId: input.finalizeJobId,
              sessionId: recovered.snapshot.sessionId,
              conversationId,
              conversationUrl:
                recovered.snapshot.pageUrl ?? input.requestRuntimeState.conversationUrl,
              metadata: {
                ...(input.metadata ?? {}),
                recoveryOutcome: 'PLANNING_RECOVERED_FROM_CONVERSATION',
              },
              recoveryAttempted: true,
              clearLastError: true,
            }),
          };
        }

        return this.returnPending({
          request: input.request,
          requestRuntimeState: input.requestRuntimeState,
          previous: input.previous,
          status: 'planning_waiting',
          attempt: input.attempt,
          finalizeJobId: input.finalizeJobId,
          metadata: {
            ...(input.metadata ?? {}),
            recoveryOutcome: 'PLANNING_RECOVERED_FROM_CONVERSATION',
          },
          recoveryAttempted: true,
          error: {
            code: 'PLANNING_FINALIZE_RETRYABLE',
            message:
              'Conversation recovery succeeded, but the planning response is still running. Retry finalization from the same conversation.',
            details: {
              recoveryStatus: recovered.snapshot.status,
            },
          },
        });
      } catch (recoveryError) {
        return this.returnPending({
          request: input.request,
          requestRuntimeState: input.requestRuntimeState,
          previous: input.previous,
          status: 'planning_waiting',
          attempt: input.attempt,
          finalizeJobId: input.finalizeJobId,
          metadata: input.metadata,
          error: {
            code: 'PLANNING_FINALIZE_RETRYABLE',
            message:
              'Planning conversation exists, but completion could not be confirmed yet. Retry finalization from the persisted conversation.',
            details: {
              waitError: this.toBridgeError(error) ?? error,
              recoveryError: this.toBridgeError(recoveryError) ?? recoveryError,
            },
          },
        });
      }
    }
  }

  private normalizePhaseResult(input: {
    phase: PlanningPhase;
    request: PlanningRequest;
    payload: Record<string, unknown>;
    appliedBy: string;
    normalization?: Record<string, unknown> | undefined;
  }): RequirementFreeze | ArchitectureFreeze | TaskGraph {
    switch (input.phase) {
      case 'requirement_freeze':
        return RequirementFreezeSchema.parse({
          runId: input.request.runId,
          title: readString(input.payload.title, 'Planning requirement freeze'),
          summary: readString(input.payload.summary, 'Materialized requirement freeze.'),
          objectives: readStringArray(input.payload.objectives),
          nonGoals: readStringArray(input.payload.nonGoals),
          constraints: normalizeRequirementConstraints(input.payload.constraints),
          risks: normalizeRequirementRisks(input.payload.risks),
          acceptanceCriteria: normalizeAcceptanceCriteria(input.payload.acceptanceCriteria),
          frozenAt: new Date().toISOString(),
          frozenBy: input.appliedBy,
        });
      case 'architecture_freeze':
        return ArchitectureFreezeSchema.parse({
          runId: input.request.runId,
          summary: readString(input.payload.summary, 'Materialized architecture freeze.'),
          moduleDefinitions: normalizeModuleDefinitions(input.payload.moduleDefinitions),
          dependencyRules: normalizeDependencyRules(input.payload.dependencyRules),
          invariants: readStringArray(input.payload.invariants),
          frozenAt: new Date().toISOString(),
          frozenBy: input.appliedBy,
        });
      case 'task_graph_generation':
        return normalizeTaskGraph({
          runId: input.request.runId,
          payload: input.payload,
          normalization: input.normalization,
        });
    }
  }

  private createFinalizeStateFromRequest(
    request: PlanningRequest,
    requestRuntimeState: PlanningRuntimeState,
  ): PlanningRuntimeState {
    return PlanningRuntimeStateSchema.parse({
      ...requestRuntimeState,
      status:
        requestRuntimeState.status === 'planning_requested'
          ? 'planning_requested'
          : requestRuntimeState.status === 'planning_waiting'
            ? 'planning_waiting'
            : 'planning_materializing',
      attempt: requestRuntimeState.attempt,
      requestJobId: requestRuntimeState.requestJobId,
      finalizeJobId: undefined,
      remediationAttempted: false,
      recoveryAttempted: false,
      createdAt: requestRuntimeState.createdAt,
      updatedAt: new Date().toISOString(),
    });
  }

  private async requireRequest(runId: string, phase: PlanningPhase): Promise<PlanningRequest> {
    const request = await this.planningRepository.getRequest(runId, phase);
    if (!request) {
      throw new OrchestratorError(
        'PLANNING_REQUEST_NOT_FOUND',
        `Planning request for ${phase} was not found`,
        { runId, phase },
      );
    }
    return request;
  }

  private async requireRequestRuntimeState(
    request: PlanningRequest,
  ): Promise<PlanningRuntimeState> {
    const runtimeState = await this.planningRepository.getRequestRuntimeState(
      request.runId,
      request.phase,
    );
    if (!runtimeState) {
      throw new OrchestratorError(
        'PLANNING_RUNTIME_STATE_NOT_FOUND',
        `Planning runtime state for ${request.phase} was not found`,
        {
          runId: request.runId,
          phase: request.phase,
        },
      );
    }
    return runtimeState;
  }

  private async requireFinalizeRuntimeState(
    request: PlanningRequest,
  ): Promise<PlanningRuntimeState> {
    const runtimeState = await this.planningRepository.getFinalizeRuntimeState(
      request.runId,
      request.phase,
    );
    if (!runtimeState) {
      throw new OrchestratorError(
        'PLANNING_FINALIZE_STATE_NOT_FOUND',
        `Planning finalize runtime state for ${request.phase} was not found`,
        {
          runId: request.runId,
          phase: request.phase,
        },
      );
    }
    return runtimeState;
  }

  private async requireMaterializedResult(
    request: PlanningRequest,
  ): Promise<PlanningMaterializedResult> {
    const result = await this.planningRepository.getMaterializedResult(
      request.runId,
      request.phase,
    );
    if (!result) {
      throw new OrchestratorError(
        'PLANNING_MATERIALIZED_RESULT_NOT_FOUND',
        `Planning materialized result for ${request.phase} was not found`,
        {
          runId: request.runId,
          phase: request.phase,
        },
      );
    }
    return result;
  }

  private async returnPending(input: {
    request: PlanningRequest;
    requestRuntimeState: PlanningRuntimeState;
    previous: PlanningRuntimeState;
    status?: PlanningRuntimeState['status'] | undefined;
    attempt: number;
    finalizeJobId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
    recoveryAttempted?: boolean | undefined;
    error: PlanningFinalizePending['error'];
  }): Promise<PlanningFinalizePending> {
    const finalizeRuntimeState = await this.persistFinalizeRuntimeState({
      request: input.request,
      previous: input.previous,
      status: input.status ?? input.previous.status,
      attempt: input.attempt,
      finalizeJobId: input.finalizeJobId,
      metadata: input.metadata,
      recoveryAttempted: input.recoveryAttempted,
      lastError: {
        code: input.error.code,
        message: input.error.message,
        details: input.error.details,
      },
    });

    return {
      status: 'pending',
      planningDir: getPlanningDir(
        this.planningRepository.getArtifactDir(),
        input.request.runId,
        input.request.phase,
      ),
      request: input.request,
      requestRuntimeState: input.requestRuntimeState,
      finalizeRuntimeState,
      error: input.error,
    };
  }

  private async persistRequestRuntimeState(input: {
    request: PlanningRequest;
    previous?: PlanningRuntimeState | null | undefined;
    status: PlanningRuntimeState['status'];
    attempt: number;
    sessionId?: string | undefined;
    conversationId?: string | undefined;
    conversationUrl?: string | undefined;
    browserUrl?: string | undefined;
    projectName?: string | undefined;
    model?: string | undefined;
    requestJobId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
    remediationAttempted?: boolean | undefined;
    recoveryAttempted?: boolean | undefined;
    lastError?: BridgeErrorShape | undefined;
    clearLastError?: boolean | undefined;
    completedAt?: string | undefined;
  }): Promise<PlanningRuntimeState> {
    return this.persistRuntimeState({
      ...input,
      finalizeJobId: undefined,
      persist: (state) => this.planningRepository.saveRequestRuntimeState(state),
    });
  }

  private async persistFinalizeRuntimeState(input: {
    request: PlanningRequest;
    previous?: PlanningRuntimeState | null | undefined;
    status: PlanningRuntimeState['status'];
    attempt: number;
    sessionId?: string | undefined;
    conversationId?: string | undefined;
    conversationUrl?: string | undefined;
    browserUrl?: string | undefined;
    projectName?: string | undefined;
    model?: string | undefined;
    requestJobId?: string | undefined;
    finalizeJobId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
    remediationAttempted?: boolean | undefined;
    recoveryAttempted?: boolean | undefined;
    lastError?: BridgeErrorShape | undefined;
    clearLastError?: boolean | undefined;
    completedAt?: string | undefined;
  }): Promise<PlanningRuntimeState> {
    return this.persistRuntimeState({
      ...input,
      persist: (state) => this.planningRepository.saveFinalizeRuntimeState(state),
    });
  }

  private async persistRuntimeState(input: {
    request: PlanningRequest;
    previous?: PlanningRuntimeState | null | undefined;
    status: PlanningRuntimeState['status'];
    attempt: number;
    sessionId?: string | undefined;
    conversationId?: string | undefined;
    conversationUrl?: string | undefined;
    browserUrl?: string | undefined;
    projectName?: string | undefined;
    model?: string | undefined;
    requestJobId?: string | undefined;
    finalizeJobId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
    remediationAttempted?: boolean | undefined;
    recoveryAttempted?: boolean | undefined;
    lastError?: BridgeErrorShape | undefined;
    clearLastError?: boolean | undefined;
    completedAt?: string | undefined;
    persist: (state: PlanningRuntimeState) => Promise<string>;
  }): Promise<PlanningRuntimeState> {
    const previous = input.previous ?? null;
    const state = PlanningRuntimeStateSchema.parse({
      planningId: input.request.planningId,
      runId: input.request.runId,
      phase: input.request.phase,
      status: input.status,
      attempt: input.attempt,
      sessionId: input.sessionId ?? previous?.sessionId,
      conversationId: input.conversationId ?? previous?.conversationId,
      conversationUrl: input.conversationUrl ?? previous?.conversationUrl,
      browserUrl: input.browserUrl ?? previous?.browserUrl ?? this.config.browserUrl,
      projectName: input.projectName ?? previous?.projectName ?? this.config.projectName,
      model: input.model ?? previous?.model,
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
    await input.persist(state);
    return state;
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

function getPlanningDir(artifactDir: string, runId: string, phase: PlanningPhase): string {
  return getPlanningRequestFile(artifactDir, runId, phase).replace(/\/request\.json$/, '');
}

function cloneJsonRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizeRequirementConstraints(value: unknown): RequirementFreeze['constraints'] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter(
      (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object',
    )
    .map((entry, index) => ({
      id: readString(entry.id, `constraint-${index + 1}`),
      title: readString(entry.title, `Constraint ${index + 1}`),
      description: readString(entry.description, 'Constraint description missing.'),
      severity: entry.severity === 'hard' || entry.severity === 'soft' ? entry.severity : 'hard',
      ...(typeof entry.rationale === 'string' && entry.rationale.trim().length > 0
        ? { rationale: entry.rationale }
        : {}),
    }));
}

function normalizeRequirementRisks(value: unknown): RequirementFreeze['risks'] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter(
      (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object',
    )
    .map((entry, index) => ({
      id: readString(entry.id, `risk-${index + 1}`),
      title: readString(entry.title, `Risk ${index + 1}`),
      description: readString(entry.description, 'Risk description missing.'),
      severity:
        entry.severity === 'high' || entry.severity === 'medium' || entry.severity === 'low'
          ? entry.severity
          : 'medium',
      ...(typeof entry.mitigation === 'string' && entry.mitigation.trim().length > 0
        ? { mitigation: entry.mitigation }
        : {}),
    }));
}

function normalizeAcceptanceCriteria(value: unknown): RequirementFreeze['acceptanceCriteria'] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter(
      (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object',
    )
    .map((entry, index) => ({
      id: readString(entry.id, `ac-${index + 1}`),
      description: readString(entry.description, 'Acceptance criterion description missing.'),
      verificationMethod:
        entry.verificationMethod === 'review' ||
        entry.verificationMethod === 'manual' ||
        entry.verificationMethod === 'artifact'
          ? entry.verificationMethod
          : 'automated_test',
      ...(typeof entry.measurableOutcome === 'string' && entry.measurableOutcome.trim().length > 0
        ? { measurableOutcome: entry.measurableOutcome }
        : {}),
      requiredEvidenceKinds: readStringArray(entry.requiredEvidenceKinds),
    }));
}

function normalizeModuleDefinitions(value: unknown): ArchitectureFreeze['moduleDefinitions'] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter(
      (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object',
    )
    .map((entry, index) => ({
      moduleId: readString(entry.moduleId, `module-${index + 1}`),
      name: readString(entry.name, `Module ${index + 1}`),
      responsibility: readString(entry.responsibility, 'Module responsibility missing.'),
      ownedPaths: readStringArray(entry.ownedPaths),
      publicInterfaces: readStringArray(entry.publicInterfaces),
      allowedDependencies: readStringArray(entry.allowedDependencies),
    }));
}

function normalizeDependencyRules(value: unknown): ArchitectureFreeze['dependencyRules'] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter(
      (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object',
    )
    .map((entry, index) => {
      const rawRule = readString(entry.rule, '');
      const rule =
        rawRule === 'allow' || rawRule === 'deny'
          ? rawRule
          : (rawRule as unknown as ArchitectureFreeze['dependencyRules'][number]['rule']);
      return {
        fromModuleId: readString(entry.fromModuleId, `module-${index + 1}`),
        toModuleId: readString(entry.toModuleId, `module-${index + 2}`),
        rule,
        rationale: readString(entry.rationale, 'Dependency rationale missing.'),
      };
    });
}

function normalizeTaskGraph(input: {
  runId: string;
  payload: Record<string, unknown>;
  normalization?: Record<string, unknown> | undefined;
}): TaskGraph {
  const output = PlanningTaskGraphOutputSchema.parse({
    tasks: Array.isArray(input.payload.tasks) ? input.payload.tasks : [],
    edges: Array.isArray(input.payload.edges) ? input.payload.edges : [],
  });
  const defaults = (input.normalization ?? {}) as {
    defaultExecutorType?: TaskGraph['tasks'][number]['executorType'];
    defaultAllowedFiles?: unknown;
    defaultDisallowedFiles?: unknown;
    defaultOutOfScope?: unknown;
    commandByTitle?: Record<string, unknown>;
    commandByIndex?: unknown[];
    sequentialDependencies?: boolean;
  };
  const now = new Date().toISOString();
  const rawIdToResolvedId = new Map<string, string>();
  const titleToResolvedId = new Map<string, string>();
  const tasks = output.tasks.map((task, index) => {
    const resolvedTaskId =
      typeof task.taskId === 'string' && task.taskId.trim().length > 0 ? task.taskId : randomUUID();
    if (typeof task.taskId === 'string' && task.taskId.trim().length > 0) {
      rawIdToResolvedId.set(task.taskId, resolvedTaskId);
    }
    titleToResolvedId.set(task.title, resolvedTaskId);
    const allowedFiles =
      task.allowedFiles.length > 0
        ? task.allowedFiles
        : readStringArray(defaults.defaultAllowedFiles);
    const outOfScope = task.scope?.outOfScope ?? readStringArray(defaults.defaultOutOfScope);
    return {
      taskId: resolvedTaskId,
      runId: input.runId,
      title: task.title,
      objective: task.objective,
      executorType: task.executorType ?? defaults.defaultExecutorType,
      scope: {
        inScope: task.scope?.inScope ?? allowedFiles,
        outOfScope,
      },
      allowedFiles,
      disallowedFiles:
        task.disallowedFiles.length > 0
          ? task.disallowedFiles
          : readStringArray(defaults.defaultDisallowedFiles),
      dependencies: [...task.dependencies],
      acceptanceCriteria: task.acceptanceCriteria.map((criterion, index) => ({
        id: criterion.id ?? `${resolvedTaskId}-ac-${index + 1}`,
        description: criterion.description,
        verificationMethod: criterion.verificationMethod ?? 'automated_test',
        ...(criterion.measurableOutcome ? { measurableOutcome: criterion.measurableOutcome } : {}),
        requiredEvidenceKinds: criterion.requiredEvidenceKinds,
      })),
      testPlan: task.testPlan.map((item, index) =>
        normalizeTestPlanItem(resolvedTaskId, item, index),
      ),
      implementationNotes: task.implementationNotes,
      evidenceIds: [],
      metadata: {
        ...(task.metadata ?? {}),
        ...(Array.isArray(defaults.commandByIndex) &&
        defaults.commandByIndex[index] &&
        typeof defaults.commandByIndex[index] === 'object'
          ? (defaults.commandByIndex[index] as Record<string, unknown>)
          : {}),
        ...(defaults.commandByTitle?.[task.title] &&
        typeof defaults.commandByTitle[task.title] === 'object'
          ? (defaults.commandByTitle[task.title] as Record<string, unknown>)
          : {}),
      },
      status: 'drafted' as const,
      createdAt: now,
      updatedAt: now,
    };
  });

  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index]!;
    const resolvedDependencies = task.dependencies
      .map(
        (dependency) =>
          rawIdToResolvedId.get(dependency) ?? titleToResolvedId.get(dependency) ?? dependency,
      )
      .filter((dependency) => dependency !== task.taskId);
    if (resolvedDependencies.length > 0) {
      task.dependencies = [...new Set(resolvedDependencies)];
      continue;
    }
    if (defaults.sequentialDependencies === true && index > 0) {
      task.dependencies = [tasks[index - 1]!.taskId];
    } else {
      task.dependencies = [];
    }
  }

  const edges: TaskGraphEdge[] = [];
  const pushEdge = (fromTaskId: string, toTaskId: string, kind: TaskGraphEdge['kind']): void => {
    if (fromTaskId === toTaskId) {
      return;
    }
    if (
      edges.some(
        (edge) =>
          edge.fromTaskId === fromTaskId && edge.toTaskId === toTaskId && edge.kind === kind,
      )
    ) {
      return;
    }
    edges.push({ fromTaskId, toTaskId, kind });
  };

  for (const edge of output.edges) {
    const fromTaskId =
      rawIdToResolvedId.get(edge.fromTaskId) ?? titleToResolvedId.get(edge.fromTaskId);
    const toTaskId = rawIdToResolvedId.get(edge.toTaskId) ?? titleToResolvedId.get(edge.toTaskId);
    if (fromTaskId && toTaskId) {
      pushEdge(fromTaskId, toTaskId, edge.kind);
    }
  }

  for (const task of tasks) {
    for (const dependency of task.dependencies) {
      pushEdge(dependency, task.taskId, 'blocks');
    }
  }

  return TaskGraphSchema.parse({
    runId: input.runId,
    tasks,
    edges,
    registeredAt: now,
  });
}

function normalizeTestPlanItem(
  taskId: string,
  item: {
    id?: string | undefined;
    description: string;
    verificationCommand?: string | undefined;
    expectedRedSignal: string;
    expectedGreenSignal: string;
  },
  index: number,
): TaskTestPlanItem {
  return {
    id: item.id ?? `${taskId}-tp-${index + 1}`,
    description: item.description,
    ...(item.verificationCommand ? { verificationCommand: item.verificationCommand } : {}),
    expectedRedSignal: item.expectedRedSignal,
    expectedGreenSignal: item.expectedGreenSignal,
  };
}

function isPlanningPending<T>(
  value: T | PlanningFinalizePending,
): value is PlanningFinalizePending {
  return (
    typeof value === 'object' && value !== null && 'status' in value && value.status === 'pending'
  );
}

function isUuidString(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function deterministicTaskGraphUuid(
  runId: string,
  rawTaskId: string,
  title: string,
  taskIndex: number,
): string {
  const digest = createHash('sha1')
    .update(`${runId}:${taskIndex}:${rawTaskId}:${title}`)
    .digest('hex');
  const part4 = ((parseInt(digest[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `5${digest.slice(13, 16)}`,
    `${part4}${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join('-');
}
