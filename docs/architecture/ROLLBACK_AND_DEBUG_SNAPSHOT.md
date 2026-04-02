# Rollback And Debug Snapshot

Phase 8 formalizes the first patch-lifecycle safety layer for the runtime.

## Why This Layer Exists

Execution and review failures should not end as raw logs only. The runtime now captures:

- what changed
- where the task ran
- whether the workspace should be retained
- what rollback plan is available
- what debug snapshot should be preserved for follow-up

## Patch Lifecycle Boundary

The current system does not perform complex git history surgery. It instead records bounded rollback intent around isolated workspaces.

Current supported rollback shapes:

- worktree or directory cleanup
- patch revert planning
- retained workspace fallback for manual or controlled follow-up

This keeps rollback explicit without pretending the system can safely rewrite project history on its own.

## Rollback Service

`RollbackService` generates a `RollbackRecord` when:

- execution fails
- review is rejected or requests changes
- a manual remediation path needs an explicit rollback plan

Each rollback record contains:

- strategy
- reason
- plan steps
- optional patch summary
- workspace and execution references when available

Artifacts are written under:

```text
apps/orchestrator/artifacts/runtime/rollbacks/<rollbackId>.json
apps/orchestrator/artifacts/runs/<runId>/rollbacks/<rollbackId>.json
```

## Retained Workspace

The workspace layer now distinguishes cleanup from retention.

A workspace may be retained when:

- execution fails
- review rejects or requests changes
- debug retention is enabled
- cleanup fails

Retention is not implicit reuse. Reuse is guarded by `RetainedWorkspaceService` and `RunnerResumeService`.

## Debug Snapshot

`DebugSnapshotService` captures a bounded snapshot at important failure edges.

A snapshot includes:

- run, task, execution, and workspace references
- diff summary
- test summary
- relevant log paths
- failure classification
- retention expiry timestamp

Artifacts are written under:

```text
apps/orchestrator/artifacts/runtime/snapshots/<snapshotId>.json
apps/orchestrator/artifacts/runs/<runId>/snapshots/<snapshotId>.json
```

## Retention Policy

Snapshots and retained workspaces both follow explicit retention policy rather than ad hoc cleanup.

The current model supports:

- TTL-based expiry
- retain-on-failure
- retain-on-rejected-review
- retain-on-debug
- bounded retained workspace count per run

This is the prerequisite for future rollback and self-repair work because it keeps failure context queryable instead of ephemeral.
