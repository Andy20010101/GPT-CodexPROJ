# Codex Execution

`CodexExecutor` is the current adapter boundary between the orchestrator and a future real Codex runtime.

## Input Shape

The executor consumes a typed `ExecutionRequest`, which includes:

- task title and objective
- scope boundaries
- allowed and disallowed files
- acceptance criteria
- test plan
- implementation notes
- architecture constraints
- related evidence ids

## Payload Builder

`CodexExecutionPayloadBuilder` turns that request into a reusable payload with two parts:

1. structured sections that preserve the original task boundaries
2. a prompt body that a future CLI or API runner can forward as-is

The builder centralizes payload construction so prompt shape is not scattered across executor code.

## Current Implementation Level

The current implementation is intentionally honest about its scope:

- `CodexExecutor` is real code
- `CodexExecutionPayloadBuilder` is reusable
- `CodexRunner` is a mockable interface
- `StubCodexRunner` is the default local fallback

What is not implemented yet:

- a real Codex CLI adapter
- a remote Codex API adapter
- cloud workspace provisioning
- streaming token or patch events

## How To Replace The Stub Runner

The next step is to implement a concrete `CodexRunner` that:

1. accepts the builder payload
2. invokes the chosen Codex runtime
3. returns `status`, `summary`, `patch`, `testResults`, `stdout`, `stderr`, and metadata

That concrete runner can then be injected into `CodexExecutor` without changing `ExecutionService` or `OrchestratorService`.
