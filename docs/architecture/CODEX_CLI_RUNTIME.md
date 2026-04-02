# Codex CLI Runtime

The first real execution runtime in this repository targets the local Codex CLI. It is intentionally a local adapter, not a claim that a cloud Codex runtime is already wired in.

## Current Shape

The stack is:

- `CodexExecutor`: orchestrator-facing executor adapter
- `CodexExecutionPayloadBuilder`: converts `TaskEnvelope` into structured execution payload
- `CodexRunner`: runtime interface
- `CodexCliRunner`: real local CLI implementation
- `StubCodexRunner`: fallback when no real runner is configured

The control plane only knows about `ExecutionRequest` and `ExecutionResult`. It never shells out directly.

## How the CLI Is Invoked

`CodexCliCommandBuilder` owns command construction. The current runtime uses `codex exec` in non-interactive mode and supplies:

- `--cd <workspacePath>` to bind execution to the isolated workspace
- `--output-schema <schema.json>` so the final message matches a machine-readable contract
- `--output-last-message <output.json>` so the runtime can parse the final structured payload
- `--full-auto` to avoid interactive prompts
- `-` so the execution prompt is sent over stdin

The prompt includes:

- task title and objective
- scope and file boundaries
- acceptance criteria
- test plan
- implementation notes
- architecture constraints
- explicit output requirements for status, summary, test results, and errors

## Configuration

The orchestrator reads these runtime settings from environment variables:

- `CODEX_RUNNER_MODE=stub|cli`
- `CODEX_CLI_BIN=codex`
- `CODEX_CLI_ARGS=...`
- `CODEX_CLI_TIMEOUT_MS=600000`
- `REVIEW_MODEL_HINT=<optional-model-name>`

If `CODEX_RUNNER_MODE` is not `cli`, the service falls back to `StubCodexRunner`.

## Error Handling

`CodexCliRunner` handles the common local failure modes explicitly:

- missing binary: `CODEX_CLI_NOT_FOUND`
- timeout: `CODEX_CLI_TIMEOUT`
- malformed or missing structured response: execution still returns a structured failure or partial result

`CodexExecutor` catches runner exceptions and converts them into durable `ExecutionResult` objects, so failed CLI attempts still land in the evidence ledger.

## Patch and Test Data

The CLI runtime does not trust free-form prose alone. It collects:

- structured output from the CLI response file
- `stdout`, `stderr`, and `exitCode`
- a patch snapshot from `git diff --no-ext-diff --binary` inside the workspace, when available

This data is then normalized into `ExecutionResult`, `PatchSummary`, `TestResult[]`, and execution artifacts.

## What Is Not Implemented Yet

The current runtime does not yet provide:

- remote Codex API execution
- cloud sandbox provisioning
- patch apply/rollback policy
- multi-task scheduling or queueing
- resumable execution sessions

Those extensions should replace or augment `CodexRunner`, not bypass `ExecutionService`.
