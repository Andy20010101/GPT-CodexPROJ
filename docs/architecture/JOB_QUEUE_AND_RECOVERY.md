# Job Queue And Recovery

The orchestrator runtime uses persisted job records plus a file-backed queue view so work can be resumed after process interruption.

## Job Record Model

Each runtime job is stored as a `JobRecord`. The current model includes:

- `jobId`
- `runId`
- optional `taskId`
- `kind`: `task_execution`, `task_review_request`, `task_review_finalize`, `task_review`, or `release_review`
- `status`: `queued`, `running`, `succeeded`, `failed`, `retriable`, `blocked`, `cancelled`, or `manual_attention_required`
- `attempt`
- `maxAttempts`
- `priority`
- `createdAt`
- `startedAt`
- `finishedAt`
- `availableAt`
- `lastError`
- `relatedEvidenceIds`
- `metadata`

The durable job file lives at:

```text
apps/orchestrator/artifacts/runs/<runId>/jobs/<jobId>.json
```

## Queue State

The queue is not just in memory. The runtime also persists queue membership so it can rebuild the runnable view after restart.

Queue state lives at:

```text
apps/orchestrator/artifacts/runs/<runId>/queue/queue-state.json
```

Each queue item records:

- `jobId`
- `runId`
- optional `taskId`
- `kind`
- `queuedAt`
- `availableAt`
- queue metadata

This split keeps the queue light while preserving richer job history in the job record.

## Retry Policy

`RetryPolicy` currently supports:

- `maxAttempts`
- `backoffStrategy`: `fixed` or `exponential`
- `baseDelayMs`

`RetryService` owns retry eligibility and backoff math. It prevents infinite retry loops by comparing the current attempt count against `maxAttempts`.

The service distinguishes between:

- jobs that can be requeued immediately
- jobs that need a delayed retry window
- jobs that have exhausted retry budget and must become `failed`

Retry decisions are themselves written to the evidence ledger as `retry_decision`.

## Recovery

`RecoveryService` runs at startup and scans persisted runs plus their jobs.

The current recovery rules are:

- `running` jobs without `finishedAt` are treated as interrupted work
- interrupted process handles are reconciled before the job is retried or failed
- interrupted worker leases are released before the job is retried or failed
- interrupted jobs are requeued if retry policy allows
- interrupted jobs become `failed` if retry budget is exhausted
- `queued` and `retriable` jobs are restored into queue state if the process-local queue was lost

Each recovery pass writes a per-run recovery summary artifact and corresponding ledger evidence.

## Resumability Model

The current resumability guarantee is pragmatic:

- run contracts stay on disk
- job state stays on disk
- queue view can be rebuilt
- workers can continue from the last durable job state

It does not yet provide exactly-once delivery. A recovered job may be retried after partial external side effects. That is acceptable for the current single-process phase because the runtime is explicit about retries and keeps execution/review evidence for audit.

## Current Limitations

The queue and recovery layer still needs:

- stronger idempotency around external executors
- exactly-once delivery under arbitrary restarts
- stronger cross-daemon ownership guarantees than single-process file-backed leases
- richer retry policies by job kind or error class
- dead-letter handling beyond simple `failed`

Cancellation requests, worker leases, and stale-job reclaim now exist as dedicated layers around the queue. The remaining gaps are about stronger delivery guarantees and multi-daemon coordination, not the absence of those primitives.
