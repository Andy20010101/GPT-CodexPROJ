# Task Loop

The task loop is the control-plane contract for how a task moves from draft to acceptance.

## State Flow

The current task loop states are:

- `drafted`
- `tests_planned`
- `tests_red`
- `implementation_in_progress`
- `tests_green`
- `refactor_in_progress`
- `review_pending`
- `accepted`
- `rejected`

## Why `tests_red` Comes Before Implementation

The system is explicitly TDD-first. A task may not enter `implementation_in_progress` until:

- it has a test plan
- it has reached `tests_red`
- the `red_test_gate` has passed

That requirement forces the missing behavior to be named and observed before implementation starts. It is not enough to say that tests should be written eventually.

## Review Gate vs Acceptance Gate

The `review_gate` answers:

- is this task ready for review?
- does the task have review evidence?
- may the task move from `review_pending` to `accepted`?

The `acceptance_gate` answers:

- does the accepted task still have enough supporting evidence?
- if acceptance fails, should the task roll back out of `accepted`?
- for a full run, are all tasks accepted so the run can move from `release_review` to `accepted`?

## Current Enforced Rules

The code currently enforces:

- no requirement freeze, no architecture freeze
- no architecture gate, no task execution
- no `tests_red`, no implementation
- no passing `red_test_gate`, no implementation
- no passing `review_gate`, no task acceptance
- failing `acceptance_gate` rolls a task back to `rejected`
