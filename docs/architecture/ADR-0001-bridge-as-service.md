# ADR-0001: Bridge As Service

## Status

Accepted

## Context

The system needs to use ChatGPT Web as an upstream review surface, but the browser automation involved is stateful, failure-prone, and tightly coupled to DOM drift.

If this logic is embedded directly inside the future orchestrator, the orchestrator would inherit:

- Puppeteer lifecycle complexity
- selector drift churn
- live session contention
- transport-level concerns mixed with task-state concerns

## Decision

Implement ChatGPT Web automation as an independent service layer named `chatgpt-web-bridge`.

## Consequences

Positive:

- isolates browser volatility
- keeps orchestration logic pure
- allows typed HTTP contracts
- enables focused tests with mocked adapters
- makes artifact persistence a first-class service responsibility

Negative:

- introduces another deployable component
- requires session management and service health checks
- adds a network boundary between orchestrator and review plane

## Rejected Alternative

Embedding browser automation directly in the orchestrator was rejected because it collapses control responsibilities and review-transport responsibilities into the same runtime.
