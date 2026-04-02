# Execution Evidence

Execution evidence is the durable trail left by each implementation attempt.

## Directory Layout

Each execution is materialized under:

```text
apps/orchestrator/artifacts/runs/<runId>/executions/<executionId>/
  request.json
  result.json
  stdout.log
  stderr.log
  test-results.json
  01-command-log-*.log
  02-test-log-*.log
  ...
```

The exact extra files depend on which artifacts an executor returned.

## What Gets Recorded

For every execution attempt, the orchestrator writes at least:

- one `execution_request` evidence entry
- one `execution_result` evidence entry

Additional evidence kinds are derived from artifact paths:

- `patch`
- `test_report`
- `command_log`
- `build_log`
- `review_input`
- `review_output`

## Why Artifact Paths Are Referenced

Execution artifacts can be large and noisy:

- command output
- test logs
- generated patches
- prompt payloads

Embedding them directly into every ledger entry would make the run state hard to diff and hard to summarize. The ledger therefore stores references, while the artifact directory stores the full payload.

## Failed Executions Must Still Write Evidence

Failure is evidence. A failed execution attempt still tells the control plane:

- which request was sent
- which executor handled it
- what command or runner failed
- what logs and exit code were produced
- whether any tests ran

If failed runs were dropped on the floor, the orchestrator would lose the ability to reason about retries, regressions, or gate failures. That is why `ExecutionEvidenceService` always records execution evidence, even for `failed` results.
