# review-then-codex-system

`review-then-codex-system` is a monorepo for an architecture-first delivery model that separates review-quality thinking from code execution.

The system is intentionally split into three planes:

1. Control Plane: the orchestrator that freezes requirements, freezes architecture, manages task state, aggregates evidence, and runs the current file-backed workflow runtime.
2. Review Plane: the `chatgpt-web-bridge` service, which connects to an already logged-in ChatGPT web session and turns the browser workflow into a typed service boundary.
3. Execution Plane: a replaceable executor layer that receives reviewed tasks and implements them under gates. The current repository ships a local execution skeleton with `CodexExecutor`, `CommandExecutor`, and `NoopExecutor`.

The Review Plane is not the orchestrator. It does not own task state, acceptance gates, or repository mutation policy. Its job is narrower: enter the right ChatGPT project, switch model context, upload task files, send prompts, wait for completion, capture results, and export structured outputs for higher layers.

The repository also ships a root [SKILL.md](/home/administrator/code/review-then-codex-system/SKILL.md) and [agents/openai.yaml](/home/administrator/code/review-then-codex-system/agents/openai.yaml) so agentic tooling can treat the repo itself as a reusable skill instead of relying on thread-local memory.

## Quick Start

```bash
npm install
npm run ci
cp .env.example .env.local
npm run dev --workspace @review-then-codex/chatgpt-web-bridge
npm run dev --workspace @review-then-codex/orchestrator
```

Use `.env.example` as the baseline local configuration surface. Only enable the real browser-backed or Codex-backed paths when you intentionally have the required local stack available.

## Repository Guides

- [CONTRIBUTING.md](/home/administrator/code/review-then-codex-system/CONTRIBUTING.md) for development workflow and validation expectations
- [RELEASING.md](/home/administrator/code/review-then-codex-system/RELEASING.md) for versioning, tags, and GitHub release procedure
- [SECURITY.md](/home/administrator/code/review-then-codex-system/SECURITY.md) for disclosure and sensitive-surface handling
- [PROJECT_PURPOSE_AND_CAPABILITIES.md](/home/administrator/code/review-then-codex-system/docs/architecture/PROJECT_PURPOSE_AND_CAPABILITIES.md) for the shortest project explanation
- [SYSTEM_OVERVIEW.md](/home/administrator/code/review-then-codex-system/docs/architecture/SYSTEM_OVERVIEW.md) for the plane model and lifecycle
- [REPOSITORY_BOUNDARIES.md](/home/administrator/code/review-then-codex-system/docs/architecture/REPOSITORY_BOUNDARIES.md) for what belongs in the monorepo versus what must live outside it
- [PROJECT_PREPARATION_WORKFLOW.md](/home/administrator/code/review-then-codex-system/docs/architecture/PROJECT_PREPARATION_WORKFLOW.md) for the upstream preparation layer
- [REAL_SELF_IMPROVEMENT.md](/home/administrator/code/review-then-codex-system/docs/architecture/REAL_SELF_IMPROVEMENT.md) for the bounded live operator path

## Current Scope

This repository currently provides:

- A monorepo skeleton with durable boundaries between apps, services, and shared contracts.
- Architecture documentation and ADRs for the three-plane system.
- A human-oriented overview of project purpose and current capabilities in [PROJECT_PURPOSE_AND_CAPABILITIES.md](/home/administrator/code/review-then-codex-system/docs/architecture/PROJECT_PURPOSE_AND_CAPABILITIES.md).
- A concrete operating plan for running external delivery and platform self-improvement in parallel in [PARALLEL_DELIVERY_AND_SELF_IMPROVEMENT.md](/home/administrator/code/review-then-codex-system/docs/architecture/PARALLEL_DELIVERY_AND_SELF_IMPROVEMENT.md).
- A working `chatgpt-web-bridge` service with typed Fastify routes, in-memory session/conversation state, artifact export, DOM drift checks, and mockable browser boundaries.
- A first browser-attach hardening layer for the bridge with endpoint discovery, DevTools probing, structured diagnostics, and `openSession` preflight gating for WSL-to-Windows host attach scenarios.
- A control-plane orchestrator skeleton with requirement freeze, architecture freeze, task graph registration, gate-aware task loop transitions, evidence ledger persistence, a typed bridge client, and execution-plane dispatch through replaceable executors.
- A first end-to-end single-task loop that can prepare an isolated workspace, execute through a local Codex CLI adapter, route structured review back through the bridge, and translate that review into `review_gate`.
- A first multi-task runtime shell with a Fastify API, file-backed job queue, worker loop, retry/recovery handling, dependency-based task unlocking, release review, and run acceptance.
- A first daemon-grade runtime shell with worker leases, heartbeats, stale-job reclaim, concurrency control, pause/resume/drain/shutdown controls, cancellation requests, and daemon status APIs.
- A first runtime-hardening layer with subprocess lifecycle control, workspace retention and GC, priority-aware scheduling, quota-aware dequeue rules, failure taxonomy, and machine-readable job disposition.
- A first real validation and stability-governance layer with:
  - mock-assisted and opt-in real end-to-end validation runs
  - bridge health, drift incident, session resume, and conversation recovery boundaries
  - rollback planning, retained workspace reuse, and debug snapshot capture
  - remediation playbooks, failure-to-task proposals, and self-repair policy decisions
- A bounded real self-improvement operator surface with:
  - `scripts/self-improvement-env.ts` for `doctor` / `ensure` bootstrap and persisted env-state
  - `scripts/run-real-self-improvement.ts` for analysis-bundle creation, watcher startup, planning sequencing, and `--run-id` resume
  - dedicated operator docs for the supported local mode and artifact-driven monitoring

## Layout

```text
apps/
  orchestrator/
docs/
  architecture/
packages/
  shared-contracts/
references/
  legacy/
services/
  chatgpt-web-bridge/
```

## Repository Boundaries

- The monorepo owns the platform code and its operating docs: `apps/`, `services/`, `packages/`, `scripts/`, `docs/architecture/`, and preparation/workflow material under `docs/`.
- External delivery repos or domain-specific skills do not belong inside this worktree as nested repositories. The local `1688-platform-skill` checkout is now expected as a sibling repo at `../1688-platform-skill`, not under this repository.
- Historical imported reference material, when it must be kept, lives under `references/legacy/`. The legacy ChatGPT CLI snapshot now lives at `references/legacy/ChatGPTCLI`.
- Scratch import zones such as `repos/` and `files/` are intentionally ignored so Finder dumps, nested `.git` directories, and ad hoc drops do not leak into the main repo again.

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
- a runtime-hardening layer with:
  - `ProcessControlService` and `RunnerLifecycleService` for subprocess tracking, timeout handling, graceful terminate, and force kill
  - `WorkspaceCleanupService` and `WorkspaceGcService` for cleanup, retain, TTL, and garbage collection policies
  - `PriorityQueueService`, `QuotaControlService`, and `SchedulingPolicyService` for non-preemptive priority and quota-aware scheduling
  - `FailureClassificationService` and `JobDispositionService` for machine-readable error taxonomy and retry/manual-attention routing
- a stability and controlled-remediation layer with:
  - `E2eValidationService` for bounded end-to-end validation runs
  - `RollbackService`, `DebugSnapshotService`, and `RetainedWorkspaceService` for failure capture and controlled rollback planning
  - `StabilityGovernanceService` for recurring-incident summaries
  - `RemediationPlaybookService`, `FailureToTaskService`, `SelfRepairPolicyService`, and `RemediationService` for low-risk remediation prerequisites
- a bounded real self-improvement surface with:
  - `scripts/self-improvement-env.ts` for environment doctor/ensure and authoritative env-state output
  - `scripts/run-real-self-improvement.ts` for bounded run creation, analysis-bundle attach, planning-sequence driving, watcher startup, and persisted resume
  - accepted-run-oriented operator docs in `docs/architecture/REAL_SELF_IMPROVEMENT*.md`
- shared bridge contracts reused across planes

The orchestrator is intentionally not a production workflow engine yet. It models the control-plane lifecycle, enforces state and gate rules, persists runtime/job/release evidence, and now exposes an API plus a daemon shell, but it does not pretend to be a distributed scheduler or that a remote Codex cloud runtime is already present.

## Implemented Bridge API

The bridge service currently exposes these routes:

- `GET /health`
- `GET /api/health/bridge`
- `POST /api/sessions/open`
- `POST /api/sessions/:sessionId/resume`
- `POST /api/projects/select`
- `POST /api/conversations/start`
- `POST /api/conversations/:id/message`
- `POST /api/conversations/:id/wait`
- `GET /api/conversations/:id/snapshot`
- `POST /api/conversations/:id/recover`
- `POST /api/conversations/:id/export/markdown`
- `POST /api/conversations/:id/extract/structured-review`
- `GET /api/drift/incidents`
- `GET /api/diagnostics/browser-endpoints`
- `GET /api/diagnostics/browser-attach`
- `POST /api/diagnostics/browser-attach/run`
- `GET /api/diagnostics/browser-attach/latest`

## Development

Install dependencies from the repository root:

```bash
npm install
```

Copy the example environment file if you want a single place to edit local values:

```bash
cp .env.example .env.local
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

Run the browser attach diagnostics against a running bridge:

```bash
npm run check:browser-attach --workspace @review-then-codex/chatgpt-web-bridge
```

If your WSL-visible CDP endpoint is a bridged host port such as `172.18.144.1:9225`, probe it explicitly:

```bash
TMPDIR=/tmp npx tsx scripts/check-browser-attach.ts --browser-url http://172.18.144.1:9225
```

If Windows `portproxy` is already configured, the diagnostics route can also discover the WSL-visible listen port automatically and does not need that port copied into every request.

Run orchestrator tests only:

```bash
npm test --workspace @review-then-codex/orchestrator
```

Start the orchestrator API:

```bash
npm run dev --workspace @review-then-codex/orchestrator
```

Run the real validation harness only when the local bridge and Codex CLI are intentionally configured:

```bash
ENABLE_REAL_E2E_VALIDATION=true npx tsx scripts/run-real-e2e-validation.ts
```

Run the bounded real self-improvement entrypoint only when the same local bridge/browser/orchestrator stack is intentionally configured:

```bash
CODEX_RUNNER_MODE=cli node --import tsx scripts/run-real-self-improvement.ts
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
BRIDGE_BROWSER_URL_CANDIDATES=http://127.0.0.1:9222,http://172.22.224.1:9223
BRIDGE_BROWSER_PORTS=9222,9223
BRIDGE_BROWSER_CONNECT_URL=http://127.0.0.1:9222
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
DAEMON_GC_INTERVAL_MS=10000
WORKSPACE_TTL_MS=3600000
WORKSPACE_CLEANUP_MODE=delayed
WORKSPACE_RETAIN_ON_FAILURE=true
WORKSPACE_RETAIN_ON_REJECTED_REVIEW=true
WORKSPACE_RETAIN_ON_DEBUG=true
WORKSPACE_MAX_RETAINED_PER_RUN=5
SCHEDULER_MAX_TASK_EXECUTION=2
SCHEDULER_MAX_TASK_REVIEW=1
SCHEDULER_MAX_RELEASE_REVIEW=1
SCHEDULER_FAIRNESS_WINDOW_MS=20000
SCHEDULER_RELEASE_BOOST_MS=10000
RUNNER_TERMINATE_GRACE_MS=2000
RUNNER_KILL_SIGNAL=SIGKILL
RUNNER_FORCE_KILL_AFTER_MS=4000
```

This is still a local runtime adapter. The repository does not claim that a production Codex API or cloud sandbox is already connected.

## Real Self-Improvement

The repository now includes a bounded real self-improvement workflow for the currently supported local mode.

Use these commands:

```bash
node --import tsx scripts/self-improvement-env.ts doctor
node --import tsx scripts/self-improvement-env.ts ensure
node --import tsx scripts/run-real-self-improvement.ts --prepare-only
CODEX_RUNNER_MODE=cli node --import tsx scripts/run-real-self-improvement.ts
```

Primary docs:

- [REAL_SELF_IMPROVEMENT.md](/home/administrator/code/review-then-codex-system/docs/architecture/REAL_SELF_IMPROVEMENT.md)
- [REAL_SELF_IMPROVEMENT_SOP.md](/home/administrator/code/review-then-codex-system/docs/architecture/REAL_SELF_IMPROVEMENT_SOP.md)
- [REAL_SELF_IMPROVEMENT_STATUS_AND_BOUNDARY.md](/home/administrator/code/review-then-codex-system/docs/architecture/REAL_SELF_IMPROVEMENT_STATUS_AND_BOUNDARY.md)
- [PARALLEL_DELIVERY_AND_SELF_IMPROVEMENT.md](/home/administrator/code/review-then-codex-system/docs/architecture/PARALLEL_DELIVERY_AND_SELF_IMPROVEMENT.md)

For real planning proof and real review attach, the bridge also needs a Windows-side browser with remote debugging enabled and a DevTools endpoint that is reachable from WSL. Start by running the browser attach diagnostics and see:

- [BROWSER_ATTACH_DIAGNOSTICS.md](/home/administrator/code/review-then-codex-system/docs/architecture/BROWSER_ATTACH_DIAGNOSTICS.md)
- [WSL_HOST_BROWSER_ATTACH.md](/home/administrator/code/review-then-codex-system/docs/architecture/WSL_HOST_BROWSER_ATTACH.md)

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
apps/orchestrator/artifacts/runs/<runId>/workspaces/<workspaceId>.json
apps/orchestrator/artifacts/runs/<runId>/workspace-runtime/<workspaceId>.json
apps/orchestrator/artifacts/runs/<runId>/releases/<releaseReviewId>/
  request.json
  result.json
  review.md
  structured-review.json
apps/orchestrator/artifacts/runs/<runId>/run-acceptance.json
apps/orchestrator/artifacts/runtime/
  daemon-state.json
  metrics-summary.json
  scheduling/scheduling-state.json
  failures/
  cleanup/
  gc/
  processes/
  workers/
  leases/
  heartbeats/
  remediation/
  rollbacks/
  snapshots/
  stability/
  resume/
```

## Phase 8 Reliability Boundary

The repository now has a first real collaboration-validation and self-repair prerequisite layer, but it is still deliberately bounded.

Low-risk automatic remediation is currently limited to:

- bridge selector and preflight hardening
- prompt and structured-output template repair
- evidence-gap repair
- workspace and runtime cleanup repair

High-risk automatic modification is still intentionally blocked for:

- orchestrator state-machine rules
- gate semantics
- acceptance rules
- task graph dependency semantics
- primary ledger schema structure

The current next step is not “more autonomy by default”. The next step is stronger production-grade reliability around process trees, retained workspace hygiene, bridge drift handling, and human-reviewed remediation loops.

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
- `GET /api/daemon/metrics`
- `GET /api/workers`
- `POST /api/jobs/:jobId/cancel`
- `GET /api/jobs/:jobId/failure`
- `GET /api/jobs/:jobId/process`
- `GET /api/jobs/:jobId/cancellation`
- `GET /api/runtime/scheduling`
- `GET /api/runtime/workspaces`
- `POST /api/runtime/workspaces/gc`

The worker/runtime layer is still single-process and file-backed. That is deliberate. It gives the project resumability, leases, heartbeats, and auditable queue state without adding a database, Redis, or a distributed queue too early.

Start the long-running daemon shell locally with:

```bash
npm run daemon --workspace @review-then-codex/orchestrator
```

## Daemon Runtime Boundary

The repository now includes a daemon-grade worker shell, but its boundary is explicit:

- one daemon instance
- one process-local worker pool
- file-backed leases and heartbeats
- cooperative cancellation
- subprocess-level terminate and force-kill for local runners
- graceful drain and shutdown
- workspace retention, TTL-based GC, and failure-aware cleanup
- priority and quota-aware dequeue decisions
- machine-readable failure taxonomy and job disposition

It does not yet provide HA failover, distributed leases, cross-process consensus, or strong idempotency guarantees under arbitrary restarts.

## Connecting a Real Execution Agent Next

The most useful next steps from here are:

1. strengthen patch lifecycle and workspace rollback so retries and manual recovery can safely reuse retained workspaces
2. stabilize real bridge sessions for longer review chains, including better drift handling and richer release-level review prompts
3. extend the daemon shell with stronger observability, richer fairness controls, and eventual multi-instance coordination without pretending it already exists
