# Concurrency And Drain

The daemon runtime now has a formal policy layer for deciding when work may start and how the daemon should stop taking new work.

## Concurrency Policy

`ConcurrencyPolicy` currently captures:

- `maxConcurrentJobs`
- `maxConcurrentJobsPerRun`
- `deferDelayMs`
- exclusive key switches for task and workspace protection

The policy is enforced by `ConcurrencyControlService` at job pickup time, not by route handlers.

## Exclusive Keys

The current exclusive-key model is intentionally lightweight:

- `task:<taskId>` prevents the same task from executing twice at once
- `workspace:<workspacePath|workspaceId>` prevents the same workspace from being used concurrently when workspace identity is available
- `release:<runId>` protects release review from being duplicated for one run

If a candidate conflicts, the daemon defers it by rescheduling the job instead of silently dropping it.

## Global And Per-Run Limits

There are two different limits because they solve different problems:

- global limit prevents one daemon from oversaturating itself
- per-run limit prevents one large run from starving every other run

Both limits are applied before a worker acquires a lease.

## Pause, Resume, Drain, Shutdown

The current daemon semantics are:

- `pause`: stop taking new work, let already running jobs finish
- `resume`: allow new work pickup again
- `drain`: do not start new jobs, but let running jobs finish and emit a drain summary
- `shutdown`: request drain plus final stop once running work reaches zero

This keeps shutdown graceful. Running jobs are not silently discarded.

## Cancellation

Cancellation is also intentionally conservative:

- queued jobs can be cancelled immediately
- running jobs receive a cancellation request
- workers observe that request at the next safe boundary and finalize cancellation

The current system does not force-kill child processes. It records intent, state, and outcome cleanly instead.

## Current Boundary

The daemon now has real control-plane semantics for concurrency and shutdown, but it still does not offer:

- preemptive interruption
- distributed rate limiting
- multi-daemon coordination
- sophisticated fairness scheduling

Those would extend the same policy and drain boundary rather than replacing it.
