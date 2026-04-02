# Daemon Runtime

The daemon runtime is the first long-lived shell around the existing workflow runtime. It is responsible for keeping workers alive, polling the queue, and exposing control and status operations for a single orchestrator process.

## Why A Daemon Layer Exists

The earlier workflow runtime could already queue jobs and process them, but it behaved like an on-demand service call. That was enough for single test runs, not enough for a long-running development pipeline.

The daemon layer exists so the orchestrator can:

- keep polling without an external supervisor loop in user code
- maintain worker state over time
- renew job leases and write heartbeats while work is running
- pause, resume, drain, and shut down without losing the control-plane model
- expose metrics-like runtime status through the API

## Responsibility Boundary

The current runtime is split into three levels:

- `WorkflowRuntimeService`: run-aware orchestration such as queueing runnable tasks, draining a run, and computing `RunRuntimeState`
- `WorkerPoolService`: worker-slot management, job pickup, lease acquisition, heartbeat renewal, and worker record persistence
- `DaemonRuntimeService`: daemon lifecycle, polling, status refresh, drain/shutdown semantics, and stale-job reclaim coordination

This keeps queue mechanics, job execution, and daemon control from collapsing into one service.

## Current Execution Model

The daemon remains intentionally conservative:

- single process
- single daemon instance
- file-backed persistence
- in-memory worker handles inside that process

That means it is suitable for a formal local runtime shell, not for HA scheduling.

## Polling Loop

At a high level the daemon loop does:

1. read the current daemon state
2. reclaim stale jobs if leases or heartbeats have expired
3. auto-queue runnable tasks when the daemon is in `running`
4. let the worker pool pick jobs subject to concurrency policy
5. refresh runtime metrics and persist them
6. if draining and no work remains, emit a drain summary and optionally stop

## API Relationship

The daemon layer is surfaced through:

- `GET /api/daemon/status`
- `POST /api/daemon/pause`
- `POST /api/daemon/resume`
- `POST /api/daemon/drain`
- `POST /api/daemon/shutdown`
- `GET /api/workers`
- `POST /api/jobs/:jobId/cancel`

These routes do not embed queue logic. They delegate to daemon and cancellation services.

## Current Limits

The daemon runtime does not claim:

- distributed workers
- strong cross-process lease guarantees
- external leader election
- exactly-once execution
- production-grade job supervision

Those capabilities can be layered on later, but the single-process daemon now provides a concrete shell that is observable, controllable, and recoverable.
