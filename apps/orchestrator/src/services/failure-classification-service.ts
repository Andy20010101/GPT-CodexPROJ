import { randomUUID } from 'node:crypto';

import { FailureRecordSchema, type FailureRecord, type FailureTaxonomy } from '../contracts';
import { FileFailureRepository } from '../storage/file-failure-repository';
import { FileRunRepository } from '../storage/file-run-repository';
import { normalizeUnknownError } from '../utils/error-normalizer';
import { EvidenceLedgerService } from './evidence-ledger-service';

export class FailureClassificationService {
  public constructor(
    private readonly runRepository: FileRunRepository,
    private readonly failureRepository: FileFailureRepository,
    private readonly evidenceLedgerService: EvidenceLedgerService,
  ) {}

  public classify(input: {
    runId: string;
    taskId?: string | undefined;
    jobId?: string | undefined;
    source: string;
    error: unknown;
    metadata?: Record<string, unknown> | undefined;
  }): FailureRecord {
    const normalized = normalizeUnknownError(input.error);
    const taxonomy = classifyTaxonomy(normalized.code, normalized.message);

    return FailureRecordSchema.parse({
      failureId: randomUUID(),
      runId: input.runId,
      ...(input.taskId ? { taskId: input.taskId } : {}),
      ...(input.jobId ? { jobId: input.jobId } : {}),
      source: input.source,
      taxonomy,
      code: normalized.code,
      message: normalized.message,
      retriable: isRetriableTaxonomy(taxonomy, normalized.code),
      timestamp: new Date().toISOString(),
      ...(normalized.details !== undefined ? { details: normalized.details } : {}),
      metadata: input.metadata ?? {},
    });
  }

  public async recordFailure(input: {
    runId: string;
    taskId?: string | undefined;
    jobId?: string | undefined;
    source: string;
    error: unknown;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<FailureRecord> {
    const record = this.classify(input);
    const paths = await this.failureRepository.saveFailure(record);
    const run = await this.runRepository.getRun(record.runId);
    await this.evidenceLedgerService.appendEvidence({
      runId: record.runId,
      ...(record.taskId ? { taskId: record.taskId } : {}),
      stage: run.stage,
      kind: 'failure_record',
      timestamp: record.timestamp,
      producer: input.source,
      artifactPaths: [paths.globalPath, paths.runPath],
      summary: `${record.code}: ${record.message}`,
      metadata: {
        failureId: record.failureId,
        taxonomy: record.taxonomy,
        retriable: record.retriable,
        ...(record.jobId ? { jobId: record.jobId } : {}),
      },
    });
    return record;
  }

  public async getLatestFailureForJob(jobId: string): Promise<FailureRecord | null> {
    return this.failureRepository.findLatestForJob(jobId);
  }
}

function classifyTaxonomy(code: string, message: string): FailureTaxonomy {
  if (code === 'JOB_CANCELLED' || code === 'RUNNER_CANCELLED') {
    return 'cancellation';
  }
  if (code.includes('TIMEOUT')) {
    return 'timeout';
  }
  if (code.includes('DRIFT')) {
    return 'drift';
  }
  if (code.includes('DEPENDENC')) {
    return 'dependency';
  }
  if (
    code.includes('POLICY') ||
    code === 'RETRY_LIMIT_EXCEEDED' ||
    code === 'RED_TEST_GATE_REQUIRED'
  ) {
    return 'policy';
  }
  if (code.includes('WORKSPACE') || code.includes('ENV') || code === 'CODEX_CLI_NOT_FOUND') {
    return 'environment';
  }
  if (code.includes('RUNNER') || code.includes('PROCESS') || code.includes('CLI')) {
    return 'runner';
  }
  if (code.includes('REVIEW') || code.includes('STRUCTURED_OUTPUT')) {
    return 'review';
  }
  if (code.includes('EXECUTION')) {
    return 'execution';
  }
  if (/network|temporary|transient/i.test(message)) {
    return 'transient';
  }
  return 'unknown';
}

function isRetriableTaxonomy(taxonomy: FailureTaxonomy, code: string): boolean {
  if (code === 'CODEX_CLI_NOT_FOUND') {
    return false;
  }
  return taxonomy === 'transient' || taxonomy === 'timeout' || taxonomy === 'drift';
}
