# Orchestrator Control Plane

This package hosts the first control-plane skeleton for `review-then-codex-system`.

Current scope:

- requirement freeze and architecture freeze contracts
- task graph and task envelope persistence
- task-loop state rules with gate-aware transitions
- evidence ledger and gate result recording
- a typed bridge client boundary for `chatgpt-web-bridge`
- a replaceable execution layer with `CodexExecutor`, `CommandExecutor`, and `NoopExecutor`
- execution request/result persistence under per-run execution directories
- a review loop that turns bridge structured output into `review_result` evidence and `review_gate`
- a workspace runtime shell that prepares isolated execution context records
- a Fastify API layer for run, task, job, and release operations
- a workflow runtime layer with queueing, worker processing, retry, recovery, dependency unlock, release review, and run acceptance
- a daemon runtime layer with worker leases, heartbeats, concurrency control, drain/shutdown control, cancellation requests, and status summaries
- integration coverage for the control-plane happy path and failure rules

The orchestrator now exposes both service boundaries and a first runtime shell, but it is still intentionally single-process and file-backed. It persists state to files, dispatches typed execution requests through adapters, and does not claim to be a production distributed scheduler.

## Local Usage

Run orchestrator tests:

```bash
npm test --workspace @review-then-codex/orchestrator
```

Run type checks:

```bash
npm run typecheck --workspace @review-then-codex/orchestrator
```

Start the API:

```bash
npm run dev --workspace @review-then-codex/orchestrator
```

Artifacts are written under `apps/orchestrator/artifacts/runs/<runId>/`.

Execution attempt artifacts are written under `apps/orchestrator/artifacts/runs/<runId>/executions/<executionId>/`.

Review artifacts are written under `apps/orchestrator/artifacts/runs/<runId>/reviews/<reviewId>/`.

Workspace runtime records are written under `apps/orchestrator/artifacts/runs/<runId>/workspaces/<workspaceId>.json`.

Job records are written under `apps/orchestrator/artifacts/runs/<runId>/jobs/<jobId>.json`.

Queue state is written under `apps/orchestrator/artifacts/runs/<runId>/queue/queue-state.json`.

Release review artifacts are written under `apps/orchestrator/artifacts/runs/<runId>/releases/<releaseReviewId>/`.

Daemon state is written under `apps/orchestrator/artifacts/runtime/daemon-state.json`.

Worker, lease, heartbeat, and cancellation artifacts are written under `apps/orchestrator/artifacts/runtime/` and mirrored into run-level directories where applicable.
