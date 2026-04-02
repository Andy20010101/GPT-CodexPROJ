import type { CleanupPolicy, WorkspaceLifecycle } from '../contracts';

export function shouldRetainWorkspace(input: {
  policy: CleanupPolicy;
  outcome: 'succeeded' | 'failed' | 'cancelled' | 'changes_requested' | 'rejected' | 'debug';
}): {
  retain: boolean;
  reason: string;
} {
  if (input.outcome === 'debug' && input.policy.retainOnDebug) {
    return { retain: true, reason: 'debug' };
  }
  if (
    (input.outcome === 'failed' || input.outcome === 'cancelled') &&
    input.policy.retainOnFailure
  ) {
    return { retain: true, reason: input.outcome };
  }
  if (
    (input.outcome === 'changes_requested' || input.outcome === 'rejected') &&
    input.policy.retainOnRejectedReview
  ) {
    return { retain: true, reason: input.outcome };
  }
  return {
    retain: false,
    reason: 'cleanup',
  };
}

export function isWorkspaceExpired(
  workspace: Pick<WorkspaceLifecycle, 'lastUsedAt' | 'cleanupPolicySnapshot' | 'status'>,
  now: Date,
): boolean {
  if (workspace.status === 'cleaned') {
    return false;
  }
  const ttlMs = workspace.cleanupPolicySnapshot.ttlMs;
  if (ttlMs <= 0) {
    return workspace.status === 'cleanup_pending';
  }
  return now.getTime() - new Date(workspace.lastUsedAt).getTime() >= ttlMs;
}
