# Codex Execution

`CodexExecutor` is the current adapter boundary between the orchestrator, the local Codex CLI path, and any future Codex runtime.

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
- `CodexCliRunner` is the real local CLI adapter
- `StubCodexRunner` is the default local fallback

What is not implemented yet:

- a remote Codex API adapter
- cloud workspace provisioning
- streaming token or patch events

## How To Extend The Runner Boundary

The next step is to implement another concrete `CodexRunner` that:

1. accepts the builder payload
2. invokes the chosen Codex runtime
3. returns `status`, `summary`, `patch`, `testResults`, `stdout`, `stderr`, and metadata

That runner can then be injected into `CodexExecutor` without changing `ExecutionService` or `OrchestratorService`.
