# Worker Lease And Heartbeat

The daemon runtime uses two related mechanisms to protect running work:

- a lease says which worker currently owns a job
- a heartbeat proves that the worker is still alive enough to be trusted

## Lease Model

Each running job gets a `WorkerLease` that records:

- `leaseId`
- `workerId`
- `jobId`
- `acquiredAt`
- `expiresAt`
- `heartbeatIntervalMs`
- metadata such as renewal and release timestamps

Leases are persisted under the runtime artifact view, which lets the daemon recover state after restart.

## Heartbeat Model

Heartbeats are append-only runtime records that capture:

- daemon id
- worker id
- optional job id
- timestamp
- whether the beat reflects worker or job activity

The worker pool writes an initial heartbeat when it starts a job and then renews both heartbeat and lease on a timer while the job promise is still active.

## How Stale Is Decided

A job is considered stale when at least one of these becomes true:

- the job lease has expired
- the latest job heartbeat is older than the stale threshold
- no heartbeat was ever written and the running timestamp is already stale

`StaleJobReclaimService` uses those signals to decide whether the job should become retriable or failed.

## Reclaim Strategy

The current reclaim strategy is intentionally simple:

- release the stale lease
- mark the worker record as stopped for that stale assignment
- retry the job if retry budget remains
- otherwise fail the job
- emit `stale_job_reclaim` evidence

That gives the daemon a safe single-process recovery path without pretending to solve every split-brain problem.

## Why There Is No Strong Cross-Process Guarantee

The repository still runs one daemon process. File-backed leases improve safety and restart recovery, but they are not a substitute for a real distributed lock or consensus system.

So the current contract is:

- safe enough for one daemon instance
- durable enough to inspect and recover
- explicit enough to support later extension

It is not a claim of cross-machine or cross-process strong consistency.
