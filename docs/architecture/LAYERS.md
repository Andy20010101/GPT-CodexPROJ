# Layers

## Control Plane

The control plane is responsible for orchestration, not content generation. It decides when a task can move from freeze to review to execution.

Current status:

- repository skeleton only
- contracts and examples only
- no workflow runtime yet

## Review Plane

The review plane is implemented as a service layer instead of an ad hoc CLI. This allows:

- process isolation from the orchestrator
- typed HTTP contracts
- stable artifact emission
- testable browser abstractions
- controlled lease semantics over live browser sessions

## Execution Plane

The execution plane is not yet implemented in this repository. It will eventually consume reviewed specs and produce code changes while reporting evidence upward.

## Boundary Rules

- The orchestrator must not embed raw DOM selectors.
- The bridge must not own task planning or repo mutation policy.
- Browser objects must not leak through route handlers.
- Shared schemas should stay in `packages/shared-contracts` where practical.
