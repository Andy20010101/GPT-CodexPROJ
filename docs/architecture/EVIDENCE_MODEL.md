# Evidence Model

The evidence ledger is the persistent trace of what happened during a run.

## Layout

Each run gets a dedicated directory:

```text
apps/orchestrator/artifacts/runs/<runId>/
  run.json
  requirement-freeze.json
  architecture-freeze.json
  task-graph.json
  tasks/
  evidence/
  gate-results/
  executions/
    <executionId>/
      request.json
      result.json
      stdout.log
      stderr.log
      test-results.json
```

## Evidence Manifest

Each evidence entry records:

- `evidenceId`
- `runId`
- optional `taskId`
- `stage`
- `kind`
- `timestamp`
- `producer`
- `artifactPaths`
- `summary`
- `metadata`

Execution-related evidence kinds include:

- `execution_request`
- `execution_result`
- `patch`
- `command_log`
- `build_log`
- `review_input`
- `review_output`
- `test_report`

## Artifact Reference Strategy

The ledger stores paths to artifacts instead of embedding large content directly in manifest JSON. That keeps evidence entries:

- small and indexable
- stable across repeated reads
- safe to summarize without duplicating large review outputs

## Why Bridge Outputs Are Referenced, Not Inlined

Bridge outputs can be large markdown transcripts or structured review JSON. Inlining them into every run summary would make the ledger noisy and harder to diff.

By storing references instead:

- the orchestrator can keep a compact index
- downstream tools can fetch the full artifact only when needed
- evidence remains auditable without bloating state files

The same rule now applies to execution artifacts. Command output, test logs, and payloads are stored once under the execution directory and referenced from evidence manifests.
