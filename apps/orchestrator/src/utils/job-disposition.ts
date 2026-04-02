import type { ExecutionResult, JobRecord, ReleaseReviewResult, ReviewResult } from '../contracts';

export type JobFailureDisposition = 'retry' | 'block' | 'fail';

export function getExecutionJobFailureDisposition(
  job: Pick<JobRecord, 'attempt' | 'maxAttempts'>,
  result: Pick<ExecutionResult, 'status' | 'metadata'>,
): JobFailureDisposition {
  const errorCode = readErrorCode(result.metadata);
  if (errorCode === 'CODEX_CLI_NOT_FOUND') {
    return 'fail';
  }
  if (errorCode === 'CODEX_CLI_TIMEOUT' && job.attempt < job.maxAttempts) {
    return 'retry';
  }
  if (result.status === 'partial') {
    return 'block';
  }
  return job.attempt < job.maxAttempts ? 'retry' : 'fail';
}

export function getReviewJobFailureDisposition(
  job: Pick<JobRecord, 'attempt' | 'maxAttempts'>,
  result: Pick<ReviewResult, 'status' | 'metadata'>,
): JobFailureDisposition {
  switch (result.status) {
    case 'approved':
      return 'fail';
    case 'changes_requested':
      return 'block';
    case 'rejected':
      return 'fail';
    case 'incomplete':
    default:
      return job.attempt < job.maxAttempts ? 'retry' : 'fail';
  }
}

export function getReleaseJobFailureDisposition(
  job: Pick<JobRecord, 'attempt' | 'maxAttempts'>,
  result: Pick<ReleaseReviewResult, 'status'>,
): JobFailureDisposition {
  switch (result.status) {
    case 'approved':
      return 'fail';
    case 'changes_requested':
      return 'block';
    case 'rejected':
      return 'fail';
    case 'incomplete':
    default:
      return job.attempt < job.maxAttempts ? 'retry' : 'fail';
  }
}

function readErrorCode(metadata: Record<string, unknown>): string | undefined {
  const value = metadata.errorCode;
  return typeof value === 'string' ? value : undefined;
}
