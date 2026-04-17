# Project Purpose And Capabilities

This document is the shortest human-oriented explanation of what this repository is for and what it can currently do.

Use it when you need to orient a new operator, explain the system boundary, or quickly answer "what is already implemented here?"

## Purpose

`review-then-codex-system` exists to separate review-quality thinking from code execution while keeping both sides inside an auditable workflow.

The project is designed to:

- freeze requirements before implementation starts
- freeze architecture before code generation starts
- decompose work into bounded tasks with explicit scope and acceptance criteria
- send curated planning or review context through a typed ChatGPT Web bridge
- execute approved tasks through replaceable local executors
- persist artifacts, runtime state, and evidence so runs can be inspected and resumed
- support bounded local self-improvement without pretending the system is already fully autonomous

The core idea is not "one agent does everything." The core idea is "each stage produces typed outputs and evidence before the next stage is allowed to proceed."

## System Shape

The repository is split into three planes:

### Control Plane

Implemented in `apps/orchestrator`.

Purpose:

- own run state, task state, gates, and evidence
- keep planning and execution inside explicit boundaries
- coordinate execution, review, retry, recovery, and acceptance

### Review Plane

Implemented in `services/chatgpt-web-bridge`.

Purpose:

- treat a logged-in ChatGPT Web session as a typed service boundary
- open sessions, select projects, send prompts, wait for completion, and export artifacts
- isolate browser-specific concerns away from orchestrator logic

### Execution Plane

Implemented through replaceable executors in `apps/orchestrator`.

Purpose:

- consume bounded execution requests
- make code changes inside isolated workspaces
- return structured execution results, patch data, logs, and test evidence

## Current End-To-End Flow

The implemented flow is:

1. create a run
2. freeze requirements
3. freeze architecture
4. generate a task graph
5. execute one or more bounded tasks inside isolated workspaces
6. send execution evidence to the review plane
7. convert structured review into task gates
8. rework tasks when review requests changes
9. run release review after all required tasks are accepted
10. record run acceptance

This flow is already exercised by the repository's formal validation harness and accepted real runs.

## Current Capabilities

### 1. Planning And Control

The control plane currently supports:

- run creation and run summaries
- requirement freeze request, finalize, and apply flow
- architecture freeze request, finalize, and apply flow
- task graph generation, normalization, and apply flow
- task lifecycle transitions across drafted, tests, implementation, review, accepted, rejected, and related loop states
- gate evaluation for requirement, architecture, red-test, review, release, and acceptance decisions
- evidence ledger persistence for planning, execution, review, runtime, remediation, and acceptance artifacts

### 2. Review Plane And Bridge

The bridge currently supports:

- browser session open and resume
- project selection and model selection
- conversation start, message send, completion wait, and snapshot capture
- markdown export and structured review extraction
- health routes and bridge diagnostics
- browser endpoint discovery for WSL-to-Windows attach scenarios
- preflight checks for login, composer readiness, and project/page readiness
- DOM drift detection and bounded drift recovery support surfaces
- bridge health summaries and drift incident recording

### 3. Execution Plane

The execution layer currently supports:

- `CodexExecutor` for structured coding-agent execution requests
- `CodexCliRunner` for real local `codex exec` integration
- `CommandExecutor` for local smoke execution and integration-oriented commands
- `NoopExecutor` for dry runs and placeholder execution
- structured execution payload construction from task envelopes
- structured execution results with status, summary, artifacts, patch summary, test results, stdout, and stderr
- isolated workspace/worktree preparation before execution

### 4. Task Review Loop

The task review path currently supports:

- creation of review requests from execution artifacts
- patch-evidence normalization before review dispatch
- fail-closed review rejection when patch evidence is incomplete in known unsafe ways
- bridge dispatch for task review
- review markdown and structured review persistence
- translation of structured review results into `review_gate`
- task reopening for rework when review returns `changes_requested`

### 5. Workflow Runtime

The workflow runtime currently supports:

- runnable-task calculation
- persisted job and queue state
- task execution jobs
- task review request/finalize/review jobs
- release review jobs
- automatic unlocking of dependency-satisfied tasks
- run draining and runtime summaries
- retry with fixed or exponential backoff
- recovery of interrupted jobs from durable state

### 6. Daemon Runtime

The daemon layer currently supports:

- a long-running worker loop
- worker pool management
- daemon pause, resume, drain, and shutdown controls
- daemon status and metrics views
- file-backed worker leases
- file-backed heartbeats
- stale-job reclaim
- concurrency and quota control
- job cancellation requests and subprocess cancellation propagation

### 7. Reliability, Recovery, And Diagnostics

The runtime-hardening and remediation layers currently support:

- subprocess lifecycle tracking
- timeout handling
- graceful terminate and force-kill paths
- process-handle persistence
- retained workspaces
- workspace cleanup and TTL-based garbage collection
- rollback planning
- debug snapshot capture
- failure classification and machine-readable job disposition
- remediation playbooks
- failure-to-task proposals
- self-repair policy decisions for low-risk surfaces

### 8. Real Validation And Real Self-Improvement

The repository also includes bounded operator workflows for live runs:

- opt-in real end-to-end validation harnesses
- environment bootstrap through `scripts/self-improvement-env.ts`
- `doctor` mode for environment inspection and env-state output
- `ensure` mode for bounded local recovery and authoritative artifact-root reuse
- bounded self-improvement entry through `scripts/run-real-self-improvement.ts`
- watcher startup and persisted watcher outputs
- analysis-bundle creation for planning/review attachment flows
- `--run-id` resume for the bounded self-improvement entrypoint
- operator SOPs for supported local mode, artifact-driven monitoring, and WSL browser attach

## What The Project Is Good For Right Now

The current repository is well-suited for:

- architecture-first task delivery with review before acceptance
- local, evidence-rich execution and review loops
- experimentation on workflow orchestration without committing to distributed infrastructure
- validating browser-backed ChatGPT review workflows behind a typed service layer
- bounded real self-improvement runs on a known-good local operator stack

## Explicit Current Limits

The repository is intentionally not claiming these capabilities yet:

- remote Codex API execution
- cloud sandbox provisioning
- distributed scheduling or HA failover
- cross-process consensus or strong distributed lease guarantees
- exactly-once delivery under arbitrary restarts
- browser login automation
- cross-host session continuation
- fully autonomous drift repair
- unrestricted self-modifying autonomy across high-risk orchestrator semantics

## Where To Read Next

For more detail:

- `README.md` for current scope, maturity, APIs, and entrypoints
- `docs/architecture/SYSTEM_OVERVIEW.md` for the architectural shape
- `docs/architecture/WORKFLOW_RUNTIME.md` for runtime flow
- `docs/architecture/CHATGPT_WEB_BRIDGE.md` for review-plane behavior
- `docs/architecture/CODEX_EXECUTION.md` and `docs/architecture/CODEX_CLI_RUNTIME.md` for executor/runtime boundaries
- `docs/architecture/REAL_SELF_IMPROVEMENT.md` and `docs/architecture/REAL_SELF_IMPROVEMENT_SOP.md` for the bounded live operator path
