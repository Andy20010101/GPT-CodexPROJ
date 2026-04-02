# Workflow Runtime

The workflow runtime is the first formal execution shell for the orchestrator. It sits above control-plane contracts and below any future long-running scheduler or distributed runtime.

## Responsibility Boundary

The runtime layer is responsible for:

- turning runnable tasks into persisted jobs
- keeping an in-process queue view over file-backed job records
- driving a worker through execution, task review, release review, and run acceptance
- recalculating task graph readiness after each state change
- exposing runtime status through the orchestrator API

The runtime layer is not responsible for:

- defining requirement or architecture contracts
- performing browser automation directly
- deciding executor internals such as Codex CLI invocation details
- pretending to be a production distributed scheduler

## Main Components

The runtime is split into four main services:

- `TaskSchedulerService`: computes runnable tasks, blocked tasks, accepted tasks, and whether release review should be queued.
- `RunQueueService`: persists `JobRecord` and queue state, enqueues/dequeues jobs, and records queue evidence.
- `WorkerService`: processes one job at a time and routes it into task execution, task review, or release review logic.
- `WorkflowRuntimeService`: coordinates the other services and exposes higher-level runtime operations such as queueing a task, draining a run, recovering interrupted jobs, and returning `RunRuntimeState`.

## Runtime Flow

The minimal runtime loop is:

1. a run has a frozen requirement set, a frozen architecture, and a registered task graph
2. `TaskSchedulerService` computes which tasks are runnable based on accepted dependencies and active jobs
3. `RunQueueService` writes a `task_execution` job under the run artifact directory
4. `WorkerService` dequeues the job and drives:
   - workspace preparation
   - execution
   - execution evidence write-back
   - task review
   - review gate
   - task acceptance when review is approved
5. after each completed job, `WorkflowRuntimeService` recomputes the graph and queues newly unblocked tasks
6. once all required tasks are accepted, the runtime queues `release_review`
7. a successful release review produces `release_gate`, then `RunAcceptanceService` advances the run to `accepted`

## Why Single-Process and File-Backed

The current runtime is intentionally conservative:

- file persistence makes the run state inspectable without extra infrastructure
- a process-local queue keeps the first implementation simple and testable
- recovery logic can reconstruct queue state from durable job records after restart

This gives the repository a real runtime boundary without introducing Redis, a database, or a distributed work scheduler too early.

## API Relationship

The Fastify API is a thin surface over the runtime:

- `POST /api/tasks/:taskId/queue` queues a runnable task job
- `GET /api/jobs/:jobId` returns persisted job state
- `POST /api/jobs/:jobId/retry` requeues a retriable or queued job
- `POST /api/runs/:runId/release-review` queues a release-level review job
- `GET /api/runs/:runId/summary` returns run summary plus runtime state

The API does not implement queueing rules itself. It delegates to `WorkflowRuntimeService` and the underlying orchestrator services.

## Current Limitations

The runtime is a formal first version, not a production scheduler. It does not yet provide:

- multi-process worker coordination
- leader election or high availability
- distributed leases
- advanced concurrency control across many runs
- run-level pause, cancel, or priority orchestration

Those concerns should extend this runtime layer, not leak back into routes, bridge adapters, or executors.
