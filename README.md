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
- shared bridge contracts reused across planes

The orchestrator is intentionally not a full workflow engine yet. It models the control-plane lifecycle, enforces state and gate rules, and writes execution evidence, but it does not pretend that a real Codex cloud runtime is already present.

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

## Connecting a Real Execution Agent Next

The next major step is to plug an execution agent such as Codex into the orchestrator task loop. The missing pieces are:

1. harden the local Codex CLI adapter into a production runtime with better retries, richer parsing, and safer patch lifecycle handling
2. stabilize real bridge review sessions against live ChatGPT web drift and add release-level review flows on top of task review
3. add a higher-level runtime or API surface that sequences multiple tasks, manages queueing, and coordinates long-running workspaces
