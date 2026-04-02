# review-then-codex-system

`review-then-codex-system` is a monorepo for an architecture-first delivery model that separates review-quality thinking from code execution.

The system is intentionally split into three planes:

1. Control Plane: a future orchestrator that freezes requirements, freezes architecture, manages task state, and aggregates evidence.
2. Review Plane: the `chatgpt-web-bridge` service, which connects to an already logged-in ChatGPT web session and turns the browser workflow into a typed service boundary.
3. Execution Plane: a replaceable executor layer that receives reviewed tasks and implements them under gates. The current repository ships a local execution skeleton with `CodexExecutor`, `CommandExecutor`, and `NoopExecutor`.

The Review Plane is not the orchestrator. It does not own task state, acceptance gates, or repository mutation policy. Its job is narrower: enter the right ChatGPT project, switch model context, upload task files, send prompts, wait for completion, capture results, and export structured outputs for higher layers.

## Current Scope

This repository currently provides:

- A monorepo skeleton with durable boundaries between apps, services, and shared contracts.
- Architecture documentation and ADRs for the three-plane system.
- A working `chatgpt-web-bridge` service with typed Fastify routes, in-memory session/conversation state, artifact export, DOM drift checks, and mockable browser boundaries.
- A control-plane orchestrator skeleton with requirement freeze, architecture freeze, task graph registration, gate-aware task loop transitions, evidence ledger persistence, a typed bridge client, and execution-plane dispatch through replaceable executors.
- A first end-to-end single-task loop that can prepare an isolated workspace, execute through a local Codex CLI adapter, route structured review back through the bridge, and translate that review into `review_gate`.
- A first multi-task runtime shell with a Fastify API, file-backed job queue, worker loop, retry/recovery handling, dependency-based task unlocking, release review, and run acceptance.
- A first daemon-grade runtime shell with worker leases, heartbeats, stale-job reclaim, concurrency control, pause/resume/drain/shutdown controls, cancellation requests, and daemon status APIs.

## Layout

```text
apps/
  orchestrator/
docs/
  architecture/
packages/
  shared-contracts/
services/
  chatgpt-web-bridge/
```

## Current Maturity

The repository now has:

- a working Review Plane service
- a working Control Plane skeleton with file-backed persistence, execution dispatch, review-gate integration, and tests
- a working Execution Plane skeleton with:
  - `CodexExecutor` for structured prompt/payload generation against a mockable runner
  - `CodexCliRunner` for local `codex exec` integration when the CLI is available
  - `CommandExecutor` for local command-based smoke execution
  - `NoopExecutor` for dry runs and placeholder flows
- a task-level review loop with:
  - `ReviewService` for bridge dispatch
  - `ReviewGateService` for converting structured review into gate state
  - `WorkspaceRuntimeService` and `WorktreeService` for isolated execution context
- a workflow runtime layer with:
  - `TaskSchedulerService` for runnable-task calculation
  - `RunQueueService` for persisted job and queue state
  - `WorkerService` for task execution, task review, and release review jobs
  - `WorkflowRuntimeService` for queueing, draining, recovery, and runtime summaries
  - `ReleaseReviewService`, `ReleaseGateService`, and `RunAcceptanceService` for run-level closure
- a daemon runtime layer with:
  - `DaemonRuntimeService` for long-running polling and lifecycle control
  - `WorkerPoolService` for worker-slot management
  - `WorkerLeaseService` and `HeartbeatService` for running-job protection
  - `ConcurrencyControlService`, `CancellationService`, and `StaleJobReclaimService` for safe pickup and recovery
  - `DaemonStatusService` for metrics-like runtime summaries
- shared bridge contracts reused across planes

The orchestrator is intentionally not a production workflow engine yet. It models the control-plane lifecycle, enforces state and gate rules, persists runtime/job/release evidence, and now exposes an API plus a daemon shell, but it does not pretend to be a distributed scheduler or that a remote Codex cloud runtime is already present.

## Implemented Bridge API

The bridge service currently exposes these routes:

- `GET /health`
- `POST /api/sessions/open`
- `POST /api/projects/select`
- `POST /api/conversations/start`
- `POST /api/conversations/:id/message`
- `POST /api/conversations/:id/wait`
- `GET /api/conversations/:id/snapshot`
- `POST /api/conversations/:id/export/markdown`
- `POST /api/conversations/:id/extract/structured-review`

## Development

Install dependencies from the repository root:

```bash
npm install
```

Run the bridge tests:

```bash
npm test
```

Start the bridge service:

```bash
npm run dev --workspace @review-then-codex/chatgpt-web-bridge
```

The bridge listens on `127.0.0.1:3100` by default. Override with `HOST`, `PORT`, and `BRIDGE_ARTIFACT_DIR` as needed.

Run orchestrator tests only:

```bash
npm test --workspace @review-then-codex/orchestrator
```

Start the orchestrator API:

```bash
npm run dev --workspace @review-then-codex/orchestrator
```

Run type checks across the monorepo:

```bash
npm run typecheck
```

## Local Codex CLI and Review Loop

The repository can now run a first local execution + review loop, but it depends on local prerequisites:

- the `codex` CLI must be installed if `CODEX_RUNNER_MODE=cli`
- `chatgpt-web-bridge` must be running if you want real review dispatch
- the bridge must be able to attach to an already logged-in ChatGPT web session

Useful environment variables:

```bash
CODEX_RUNNER_MODE=cli
CODEX_CLI_BIN=codex
CODEX_CLI_TIMEOUT_MS=600000
BRIDGE_BASE_URL=http://127.0.0.1:3100
BRIDGE_BROWSER_URL=https://chatgpt.com/
BRIDGE_PROJECT_NAME=Default
REVIEW_MODEL_HINT=gpt-5.4
WORKSPACE_RUNTIME_BASE_DIR=/path/to/workspaces
ORCHESTRATOR_API_HOST=127.0.0.1
ORCHESTRATOR_API_PORT=3200
RUNTIME_MAX_ATTEMPTS=3
RUNTIME_BACKOFF_STRATEGY=exponential
RUNTIME_BASE_DELAY_MS=1000
DAEMON_POLL_INTERVAL_MS=250
DAEMON_WORKER_COUNT=2
DAEMON_HEARTBEAT_INTERVAL_MS=500
DAEMON_LEASE_TTL_MS=2000
DAEMON_STALE_THRESHOLD_MS=3000
DAEMON_MAX_CONCURRENT_JOBS=2
DAEMON_MAX_CONCURRENT_JOBS_PER_RUN=1
```

This is still a local runtime adapter. The repository does not claim that a production Codex API or cloud sandbox is already connected.

## Execution Plane Boundary

The execution plane is now wired into the orchestrator through `ExecutionService` and `ExecutorRegistry`, and the `CodexExecutor` can now target a real local CLI runner:

- it converts `TaskEnvelope` data into a reusable Codex execution payload
- it calls a replaceable runner adapter
- it returns structured `ExecutionResult` objects that are written into the evidence ledger
- it can use `CodexCliRunner` for local `codex exec`, or `StubCodexRunner` when no real runner is configured
- it still does not claim that a real remote Codex cloud runtime is already connected

Execution artifacts are persisted under:

```text
apps/orchestrator/artifacts/runs/<runId>/executions/<executionId>/
  request.json
  result.json
  stdout.log
  stderr.log
  test-results.json
  ...
```

Review artifacts are persisted under:

```text
apps/orchestrator/artifacts/runs/<runId>/reviews/<reviewId>/
  request.json
  result.json
  review.md
  structured-review.json
```

Runtime artifacts are persisted under:

```text
apps/orchestrator/artifacts/runs/<runId>/jobs/<jobId>.json
apps/orchestrator/artifacts/runs/<runId>/queue/queue-state.json
apps/orchestrator/artifacts/runs/<runId>/daemon/daemon-state.json
apps/orchestrator/artifacts/runs/<runId>/workers/<workerId>.json
apps/orchestrator/artifacts/runs/<runId>/heartbeats/<heartbeatId>.json
apps/orchestrator/artifacts/runs/<runId>/cancellations/<cancellationId>.json
apps/orchestrator/artifacts/runs/<runId>/releases/<releaseReviewId>/
  request.json
  result.json
  review.md
  structured-review.json
apps/orchestrator/artifacts/runs/<runId>/run-acceptance.json
apps/orchestrator/artifacts/runtime/
  daemon-state.json
  metrics-summary.json
  workers/
  leases/
  heartbeats/
```

## API And Runtime

The orchestrator now exposes a typed Fastify API for the current runtime boundary:

- `GET /health`
- `POST /api/runs`
- `GET /api/runs/:runId`
- `POST /api/runs/:runId/requirement-freeze`
- `POST /api/runs/:runId/architecture-freeze`
- `POST /api/runs/:runId/task-graph`
- `GET /api/runs/:runId/tasks`
- `POST /api/tasks/:taskId/queue`
- `GET /api/jobs/:jobId`
- `POST /api/jobs/:jobId/retry`
- `POST /api/runs/:runId/release-review`
- `POST /api/runs/:runId/accept`
- `GET /api/runs/:runId/summary`
- `GET /api/daemon/status`
- `POST /api/daemon/pause`
- `POST /api/daemon/resume`
- `POST /api/daemon/drain`
- `POST /api/daemon/shutdown`
- `GET /api/workers`
- `POST /api/jobs/:jobId/cancel`

The worker/runtime layer is still single-process and file-backed. That is deliberate. It gives the project resumability, leases, heartbeats, and auditable queue state without adding a database, Redis, or a distributed queue too early.

## Daemon Runtime Boundary

The repository now includes a daemon-grade worker shell, but its boundary is explicit:

- one daemon instance
- one process-local worker pool
- file-backed leases and heartbeats
- cooperative cancellation
- graceful drain and shutdown

It does not yet provide HA failover, distributed leases, cross-process consensus, or strong idempotency guarantees under arbitrary restarts.

## Connecting a Real Execution Agent Next

The most useful next steps from here are:

1. harden the local Codex CLI adapter into a safer execution runtime with better parsing, patch lifecycle control, and stronger idempotency under retry
2. stabilize real bridge sessions for longer review chains, including better drift handling and richer release-level review prompts
3. extend the daemon shell into a more production-grade runtime with stronger cancellation, cross-process safety, richer metrics, and multi-daemon coordination
