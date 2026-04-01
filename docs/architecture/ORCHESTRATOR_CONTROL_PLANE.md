# Orchestrator Control Plane

The orchestrator is the Control Plane for `review-then-codex-system`. Its job is to freeze intent, freeze architecture, sequence task loops, track evidence, and evaluate gates. It is deliberately not the place where code is directly written.

## Responsibility Boundary

The orchestrator owns:

- `run` lifecycle state
- requirement freeze and architecture freeze persistence
- task graph registration
- task-level loop transitions
- evidence ledger writes and summaries
- gate evaluation
- typed calls into `chatgpt-web-bridge`

The orchestrator does not own:

- browser automation details
- raw DOM selectors
- direct code mutation against the target repository
- pretending that an execution agent already exists

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

## Collaboration With `chatgpt-web-bridge`

The orchestrator calls the bridge through a typed HTTP client. It does not import bridge internals or browser code. This separation keeps the control plane transport-agnostic and makes it possible to mock bridge behavior during tests.

The expected sequence is:

1. Open or bind a bridge session.
2. Select the target project.
3. Start or continue a conversation.
4. Wait for completion.
5. Export markdown and structured review.
6. Record the returned artifact paths as evidence.
