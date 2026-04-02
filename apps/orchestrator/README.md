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
- a runtime-hardening layer with subprocess lifecycle management, workspace cleanup/retention/GC, priority-aware scheduling, quota control, failure taxonomy, and job disposition
- a phase-8 stability layer with:
  - end-to-end validation reports
  - rollback planning and debug snapshots
  - retained workspace reuse and runner resume decisions
  - remediation playbooks and self-repair policy decisions
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

Start the daemon shell:

```bash
npm run daemon --workspace @review-then-codex/orchestrator
```

Artifacts are written under `apps/orchestrator/artifacts/runs/<runId>/`.

Execution attempt artifacts are written under `apps/orchestrator/artifacts/runs/<runId>/executions/<executionId>/`.

Review artifacts are written under `apps/orchestrator/artifacts/runs/<runId>/reviews/<reviewId>/`.

Workspace lifecycle records are written under `apps/orchestrator/artifacts/runs/<runId>/workspaces/<workspaceId>.json`.

Workspace runtime descriptors are written under `apps/orchestrator/artifacts/runs/<runId>/workspace-runtime/<workspaceId>.json`.

Job records are written under `apps/orchestrator/artifacts/runs/<runId>/jobs/<jobId>.json`.

Queue state is written under `apps/orchestrator/artifacts/runs/<runId>/queue/queue-state.json`.

Release review artifacts are written under `apps/orchestrator/artifacts/runs/<runId>/releases/<releaseReviewId>/`.

Daemon state is written under `apps/orchestrator/artifacts/runtime/daemon-state.json`.

Worker, lease, heartbeat, and cancellation artifacts are written under `apps/orchestrator/artifacts/runtime/` and mirrored into run-level directories where applicable.

Runtime-hardening artifacts are also written under:

- `apps/orchestrator/artifacts/runtime/scheduling/scheduling-state.json`
- `apps/orchestrator/artifacts/runtime/failures/<failureId>.json`
- `apps/orchestrator/artifacts/runtime/cleanup/<cleanupId>.json`
- `apps/orchestrator/artifacts/runtime/gc/<gcRunId>.json`
- `apps/orchestrator/artifacts/runtime/processes/<processHandleId>.json`
- `apps/orchestrator/artifacts/runtime/remediation/<remediationId>.json`
- `apps/orchestrator/artifacts/runtime/rollbacks/<rollbackId>.json`
- `apps/orchestrator/artifacts/runtime/snapshots/<snapshotId>.json`
- `apps/orchestrator/artifacts/runtime/stability/stability-report.json`
- `apps/orchestrator/artifacts/runtime/resume/<resumeStateId>.json`

Validation artifacts are written under:

- `apps/orchestrator/artifacts/runs/<runId>/validation/validation-report.json`

Run the opt-in real validation harness only when the bridge and Codex CLI are configured intentionally:

```bash
ENABLE_REAL_E2E_VALIDATION=true npx tsx scripts/run-real-e2e-validation.ts
```

The current runtime is still intentionally:

- single instance
- single process
- file backed
- non-preemptive

It is suitable as a local daemon baseline or a future `systemd`/`pm2`/container entrypoint, but it is not a distributed scheduler.
