# Review Loop

The review loop connects the execution plane back into the review plane and then into the control-plane gate model.

## Purpose

Execution alone is not enough. A task needs review evidence that answers:

- what changed
- which files were touched
- whether tests ran and what they reported
- whether the change respects the frozen architecture
- whether the task should proceed, rework, or stop

The orchestrator therefore does not treat review as a free-form note. It builds a structured `ReviewRequest`, sends it through `chatgpt-web-bridge`, and expects a structured `ReviewResult` back.

## Flow

The task-level loop is:

1. a task reaches `tests_red`
2. an executor runs inside an isolated workspace and produces `ExecutionResult`
3. the orchestrator persists execution evidence under the run ledger
4. `ReviewService` builds a `ReviewRequest` from task, execution, and architecture context
5. `ReviewService` calls the bridge client:
   - `openSession`
   - `selectProject`
   - `startConversation`
   - `waitForCompletion`
   - `exportMarkdown`
   - `extractStructuredReview`
6. the bridge markdown and structured JSON are written under `apps/orchestrator/artifacts/runs/<runId>/reviews/<reviewId>/`
7. `ReviewGateService` converts `ReviewResult` into `review_gate`
8. the task loop decides whether the task stays in review, returns to implementation, or becomes rejectable/acceptable

## Why Review Must Use Patch, Tests, and Evidence

The review prompt is built from durable execution facts, not only from a prose summary. The payload includes:

- task title and objective
- scope, allowed files, and disallowed files
- acceptance criteria
- patch summary and changed file list
- test results
- execution summary
- architecture constraints

This keeps the review plane grounded in the same task contract the control plane uses. It also makes later replay or audit possible because the review request is stored as an artifact, not reconstructed from memory.

## Structured Review and Gate Semantics

`ReviewResult.status` is the primary input to `review_gate`. The mapping is explicit:

- `approved`: `review_gate` passes
- `changes_requested`: `review_gate` fails and the task reopens to `implementation_in_progress`
- `rejected`: `review_gate` fails and the task becomes `rejected`
- `incomplete`: `review_gate` fails but keeps a retry path open

`acceptTask()` does not trust a plain passing gate result. It requires a `review_gate` written by `ReviewGateService`, which means the gate must have come from structured review flow rather than an ad hoc evaluator call.

## Missing Structured Output

The bridge review contract requires a machine-readable JSON block. If the first bridge response is missing it:

1. `ReviewService` sends one remediation message asking for the required block
2. it waits again and retries structured extraction
3. if extraction still fails, the review is persisted as `incomplete`

This still writes review evidence. Missing structure is a first-class failure mode, not a silent success.

## Artifact and Evidence Outputs

A successful review usually produces:

- `review_request` evidence
- `review_result` evidence
- `bridge_markdown` evidence
- `bridge_structured_review` evidence
- `gate_result` evidence for `review_gate`

A failed or incomplete review still writes at least:

- `review_request`
- `review_result`
- whatever bridge artifacts were available before failure

This guarantees that the control plane can explain why a task did not advance.
