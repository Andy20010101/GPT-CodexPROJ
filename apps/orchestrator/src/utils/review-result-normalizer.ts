import { ReviewResultSchema, type ReviewRequest, type ReviewResult } from '../contracts';

export function normalizeReviewResult(input: {
  request: ReviewRequest;
  payload?: Record<string, unknown> | null | undefined;
  bridgeArtifacts: ReviewResult['bridgeArtifacts'];
  metadata?: Record<string, unknown> | undefined;
  summaryFallback?: string | undefined;
  timestamp?: string | undefined;
}): ReviewResult {
  const payload = input.payload ?? null;
  const timestamp = input.timestamp ?? new Date().toISOString();
  const status = normalizeStatus(payload);
  const summary =
    readString(payload, ['summary', 'overallSummary']) ??
    input.summaryFallback ??
    'Structured review completed without a summary.';

  return ReviewResultSchema.parse({
    reviewId: input.request.reviewId,
    runId: input.request.runId,
    taskId: input.request.taskId,
    executionId: input.request.executionId,
    status,
    summary,
    findings: readStringArray(payload, ['findings', 'issues']),
    missingTests: readStringArray(payload, ['missingTests', 'testGaps']),
    architectureConcerns: readStringArray(payload, ['architectureConcerns', 'designConcerns']),
    recommendedActions: readStringArray(payload, ['recommendedActions', 'nextActions']),
    bridgeArtifacts: input.bridgeArtifacts,
    rawStructuredReview: payload,
    metadata: input.metadata ?? {},
    timestamp,
  });
}

function normalizeStatus(payload: Record<string, unknown> | null): ReviewResult['status'] {
  const value = readString(payload, ['status', 'decision', 'reviewStatus'])?.toLowerCase();

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

function readString(
  payload: Record<string, unknown> | null,
  keys: readonly string[],
): string | undefined {
  if (!payload) {
    return undefined;
  }

  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
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
    if (!Array.isArray(value)) {
      continue;
    }

    return value
      .map((item) => {
        if (typeof item === 'string') {
          return item.trim();
        }
        if (item && typeof item === 'object') {
          return JSON.stringify(item);
        }
        return '';
      })
      .filter((item) => item.length > 0);
  }

  return [];
}
