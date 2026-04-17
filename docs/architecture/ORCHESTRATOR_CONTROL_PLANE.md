# Orchestrator Control Plane

The orchestrator is the Control Plane for `GPT-CodexPROJ`. Its job is to freeze intent, freeze architecture, sequence task loops, track evidence, and evaluate gates. It is deliberately not the place where code is directly written.

## Responsibility Boundary

The orchestrator owns:

- `run` lifecycle state
- requirement freeze and architecture freeze persistence
- task graph registration
- task-level loop transitions
- execution request construction and executor dispatch through replaceable adapters
- evidence ledger writes and summaries
- gate evaluation
- typed calls into `chatgpt-web-bridge`

The orchestrator does not own:

- browser automation details
- raw DOM selectors
- direct code mutation logic inside the control-plane services
- pretending that a real Codex cloud runtime already exists when only a local stub is configured

## Why It Does Not Write Code

If the control plane also wrote code, it would collapse planning, review transport, and implementation into one runtime. That weakens freeze boundaries and makes it harder to prove which stage produced which artifact.

The control plane should instead:

1. Freeze the contract.
2. Produce or collect evidence.
3. Route review work to the Review Plane.
4. Route execution work to the Execution Plane.
5. Evaluate whether gates passed.

## Core Objects

### Run

A run is the top-level container for one frozen delivery effort. It tracks the current stage, timestamps, and the artifact paths for requirement freeze, architecture freeze, and task graph state.

### Task

A task is a bounded implementation unit with:

- allowed and disallowed file ranges
- acceptance criteria
- a test plan
- dependency edges
- explicit task-loop state

### Gate

A gate is an evaluation checkpoint. The current skeleton supports:

- `requirement_gate`
- `architecture_gate`
- `red_test_gate`
- `review_gate`
- `acceptance_gate`

### Evidence

Evidence is a ledger entry that points at artifacts instead of embedding large blobs. The ledger tracks what was produced, by whom, at which stage, and for which run or task.

Execution attempts now add:

- `execution_request`
- `execution_result`
- `patch`
- `command_log`
- `build_log`
- `review_input`
- `review_output`

## Collaboration With `chatgpt-web-bridge`

The orchestrator calls the bridge through a typed HTTP client. It does not import bridge internals or browser code. This separation keeps the control plane transport-agnostic and makes it possible to mock bridge behavior during tests.

The expected sequence is:

1. Open or bind a bridge session.
2. Select the target project.
3. Start or continue a conversation.
4. Wait for completion.
5. Export markdown and structured review.
6. Record the returned artifact paths as evidence.

## Collaboration With The Execution Plane

The orchestrator now also routes tasks into an execution adapter boundary:

1. validate that the task has reached `tests_red` and passed the `red_test_gate`
2. construct an `ExecutionRequest` from the `TaskEnvelope`
3. resolve an executor through `ExecutorRegistry`
4. persist the `ExecutionResult` and materialized artifacts into the evidence ledger
5. decide whether the task may move to `tests_green`, stay in implementation, or be rejected

This keeps execution pluggable. `CodexExecutor` and `CommandExecutor` can evolve independently without collapsing back into the control plane.
