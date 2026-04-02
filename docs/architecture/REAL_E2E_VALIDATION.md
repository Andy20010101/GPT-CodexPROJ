# Real E2E Validation

Phase 8 adds a formal validation layer so the system can prove one complete collaboration loop instead of only passing mock-isolated unit flows.

## Why This Exists

The orchestrator, bridge, runner, review gate, release review, and acceptance rules were already individually testable. That was not enough to show that the full pipeline could coordinate under the same run.

`E2eValidationService` exists to answer one narrower question:

- Can one run travel from requirement freeze to final acceptance through the real orchestrator runtime boundary?

## Validation Run Contents

A validation run drives the same first-class objects that production-oriented runs use:

1. create a run
2. persist requirement freeze
3. persist architecture freeze
4. register a task graph
5. queue and execute task work
6. capture execution evidence
7. dispatch task review through the bridge client
8. evaluate the review gate
9. trigger release review when all required tasks are accepted
10. evaluate the release gate
11. finalize run acceptance

The output is a structured `ValidationReport` with:

- `runId`
- `tasksExecuted`
- `executionResults`
- `reviewResults`
- `releaseResult`
- `incidents`
- `retainedWorkspaces`
- `rollbackEvents`
- `unresolvedIssues`
- `verdict`

## Modes

Two modes are intentionally separated.

### `mock_assisted`

This is the default test mode.

- Bridge calls can use the mock bridge client.
- Codex execution can use a controlled runner double.
- The run still uses the real orchestrator runtime, queue, worker, review gate, release gate, and evidence ledger.

This is the mode used by default CI-style integration coverage.

### `real`

This is the opt-in human validation mode.

- Requires a real bridge endpoint.
- Requires a configured local Codex CLI runner or equivalent local execution runtime.
- Is not executed by default in `npm test`.

Enable it with:

```bash
ENABLE_REAL_E2E_VALIDATION=true npx tsx scripts/run-real-e2e-validation.ts
```

## Artifacts

Validation artifacts are written to:

```text
apps/orchestrator/artifacts/runs/<runId>/validation/validation-report.json
```

The evidence ledger stores only the artifact path reference plus summary metadata, not the full report body inline.

## Current Boundary

The validation layer is deliberately conservative.

- It validates one bounded run.
- It does not introduce a second scheduling system.
- It does not bypass the existing task, review, release, or acceptance rules.
- It does not claim that bridge drift recovery or Codex resume is fully autonomous.

The purpose is proof of coordinated behavior, not a second runtime.
