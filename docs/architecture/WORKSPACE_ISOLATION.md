# Workspace Isolation

Execution should not run directly in the main repository checkout. The orchestrator therefore models workspace preparation as a separate runtime concern.

## Why Isolation Exists

Without workspace isolation, execution attempts would:

- pollute the primary working tree
- make retries harder to compare
- blur the difference between user edits and agent edits
- make patch capture and rollback policy harder to reason about

The runtime shell exists so the control plane can say exactly where execution happened.

## Current Components

The current workspace boundary is split into two services:

- `WorkspaceRuntimeService`: creates and persists workspace runtime records
- `WorktreeService`: prepares and describes the actual isolated workspace

The orchestrator never asks an executor to mutate the main checkout implicitly. It either:

- receives an explicit `workspacePath`, or
- resolves a prepared `workspaceId` through `WorkspaceRuntimeService`

## Current Implementation Level

The production implementation path is `git_worktree`:

- `WorktreeService.prepareWorkspace()` uses `git worktree add --detach`
- `describeWorkspace()` reads workspace metadata from git
- `cleanupWorkspace()` removes the detached worktree

Tests frequently inject a fake `WorktreeService` so integration coverage can stay fast and deterministic without mutating the repository that hosts the tests.

## Metadata and Ledger Records

Workspace runtime metadata is written in two places:

1. the workspace record:

```text
apps/orchestrator/artifacts/runs/<runId>/workspaces/<workspaceId>.json
```

2. the evidence ledger:

- `workspace_runtime`

The record contains:

- `runId`
- `taskId`
- optional `executionId`
- `executorType`
- `baseRepoPath`
- `workspacePath`
- `mode`
- `baseCommit`
- lifecycle status such as `prepared` or `cleaned`

The prepared workspace directory is rooted under:

```text
apps/orchestrator/artifacts/workspace-runtime/<runId>/<taskId>/<workspaceId>/
```

unless `WORKSPACE_RUNTIME_BASE_DIR` overrides it.

## Current Limitations

The current runtime shell is intentionally minimal. It does not yet include:

- automatic cleanup policy
- workspace branch naming policy
- patch rollback orchestration
- snapshot deduplication
- per-task dependency caches

Those additions belong in the runtime shell layer, not in executors or gate logic.
