import type {
  EvidenceKind,
  EvidenceManifest,
  ExecutionArtifact,
  ExecutionRequest,
  ExecutionResult,
  RunStage,
} from '../contracts';
import { EvidenceLedgerService } from './evidence-ledger-service';
import { FileExecutionRepository } from '../storage/file-execution-repository';

export class ExecutionEvidenceService {
  public constructor(
    private readonly executionRepository: FileExecutionRepository,
    private readonly evidenceLedgerService: EvidenceLedgerService,
  ) {}

  public async recordExecutionResult(input: {
    request: ExecutionRequest;
    result: ExecutionResult;
    producer: string;
    stage: RunStage;
  }): Promise<{
    evidence: EvidenceManifest[];
    executionDir: string;
    requestPath: string;
    result: ExecutionResult;
    resultPath: string;
  }> {
    const { executionDir, requestPath } = await this.executionRepository.saveRequest(input.request);
    const persistedResult = await this.executionRepository.saveResult(input.result);
    const evidence: EvidenceManifest[] = [];

    evidence.push(
      await this.evidenceLedgerService.appendEvidence({
        runId: input.request.runId,
        taskId: input.request.taskId,
        stage: input.stage,
        kind: 'execution_request',
        timestamp: input.request.requestedAt,
        producer: input.producer,
        artifactPaths: [requestPath],
        summary: `Execution request prepared for ${input.request.executorType}`,
        metadata: {
          executionId: input.request.executionId,
          executorType: input.request.executorType,
        },
      }),
    );

    evidence.push(
      await this.evidenceLedgerService.appendEvidence({
        runId: input.result.runId,
        taskId: input.result.taskId,
        stage: input.stage,
        kind: 'execution_result',
        timestamp: input.result.finishedAt,
        producer: input.producer,
        artifactPaths: [persistedResult.resultPath],
        summary: input.result.summary,
        metadata: {
          executionId: input.result.executionId,
          status: input.result.status,
          exitCode: input.result.exitCode,
        },
      }),
    );

    for (const artifact of persistedResult.result.artifacts) {
      const evidenceKind = mapArtifactKindToEvidenceKind(artifact.kind);
      if (!evidenceKind || !artifact.path) {
        continue;
      }

      evidence.push(
        await this.evidenceLedgerService.appendEvidence({
          runId: input.result.runId,
          taskId: input.result.taskId,
          stage: input.stage,
          kind: evidenceKind,
          timestamp: input.result.finishedAt,
          producer: input.producer,
          artifactPaths: [artifact.path],
          summary: buildArtifactSummary(artifact, input.result.status),
          metadata: {
            executionId: input.result.executionId,
            artifactId: artifact.artifactId,
            artifactKind: artifact.kind,
          },
        }),
      );
    }

    return {
      evidence,
      executionDir,
      requestPath,
      result: persistedResult.result,
      resultPath: persistedResult.resultPath,
    };
  }

  public async summarizeExecutionForTask(
    runId: string,
    taskId: string,
  ): Promise<{
    totalExecutions: number;
    byStatus: Record<ExecutionResult['status'], number>;
    artifactCount: number;
    latestExecutionId: string | null;
  }> {
    const results = await this.executionRepository.listResultsForTask(runId, taskId);

    return {
      totalExecutions: results.length,
      byStatus: results.reduce<Record<ExecutionResult['status'], number>>(
        (accumulator, result) => {
          accumulator[result.status] += 1;
          return accumulator;
        },
        {
          succeeded: 0,
          failed: 0,
          partial: 0,
        },
      ),
      artifactCount: results.reduce((count, result) => count + result.artifacts.length, 0),
      latestExecutionId:
        results.sort((left, right) => left.finishedAt.localeCompare(right.finishedAt)).at(-1)
          ?.executionId ?? null,
    };
  }

  public async collectExecutionArtifacts(
    runId: string,
    taskId: string,
  ): Promise<ExecutionArtifact[]> {
    const results = await this.executionRepository.listResultsForTask(runId, taskId);
    return results.flatMap((result) => result.artifacts);
  }
}

function mapArtifactKindToEvidenceKind(
  artifactKind: ExecutionArtifact['kind'],
): EvidenceKind | null {
  switch (artifactKind) {
    case 'patch':
      return 'patch';
    case 'test-log':
      return 'test_report';
    case 'command-log':
      return 'command_log';
    case 'build-log':
      return 'build_log';
    case 'review-input':
      return 'review_input';
    case 'review-output':
      return 'review_output';
    default:
      return null;
  }
}

function buildArtifactSummary(
  artifact: ExecutionArtifact,
  status: ExecutionResult['status'],
): string {
  return `${artifact.kind} captured for ${status} execution (${artifact.label})`;
}
