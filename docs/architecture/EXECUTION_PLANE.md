# Execution Plane

The execution plane is the implementation-facing half of `review-then-codex-system`. It accepts frozen task envelopes from the control plane and returns structured execution results plus artifact references.

## Responsibility Boundary

The execution plane is responsible for:

- receiving a bounded `ExecutionRequest`
- respecting allowed and disallowed file ranges
- returning structured patch/test/log outputs
- persisting request/result artifacts under the run execution directory
- writing execution evidence back to the orchestrator ledger

The execution plane is not responsible for:

- freezing requirements
- freezing architecture
- evaluating review or acceptance gates
- automating ChatGPT browser sessions

## Why Executors Are Replaceable

The orchestrator should not hard-code one execution transport. The same task envelope may eventually target:

- a local command runner for smoke tests
- a local Codex CLI harness
- a remote Codex API or cloud runtime
- another execution backend entirely

`ExecutorRegistry` keeps that decision at the adapter layer. The control plane asks for an executor by explicit type or task metadata and receives a stable interface in return.

## Current Executors

### `CodexExecutor`

`CodexExecutor` is the forward-looking adapter for real coding-agent execution. Today it does three concrete things:

- builds a structured Codex execution payload from `TaskEnvelope` data
- calls a mockable `CodexRunner`
- normalizes the runner output into `ExecutionResult`

It does not claim that a remote Codex runtime is already connected.

### `CommandExecutor`

`CommandExecutor` is the practical local runtime for smoke execution and integration tests. It runs a shell command, captures `stdout`/`stderr`/`exitCode`, and converts test-purpose commands into coarse `TestResult` records.

### `NoopExecutor`

`NoopExecutor` is for dry runs and placeholder flows. It produces a structured `partial` execution result without mutating code.

## How Results Flow Back

`ExecutionService` owns the orchestration path:

1. build `ExecutionRequest`
2. resolve executor through `ExecutorRegistry`
3. run the executor
4. hand the result to `ExecutionEvidenceService`
5. return a disposition recommendation to the task loop

The task loop still owns state transitions. Execution may recommend `tests_green`, staying in implementation, or rejection, but it does not directly force acceptance.
