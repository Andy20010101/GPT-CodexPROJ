# System Overview

`review-then-codex-system` is designed around explicit freezes and typed handoffs rather than a single agent directly doing everything.

## Lifecycle

The intended end-to-end flow is:

1. Requirement freeze: capture the task definition, scope limits, evidence inputs, and acceptance gates.
2. Architecture freeze: define module boundaries, data contracts, and implementation constraints before code generation starts.
3. Task loop: decompose work into units that can be routed to review and execution planes.
4. Review: send curated context into ChatGPT Web through the bridge service and retrieve high-quality review or spec output.
5. Acceptance: validate implementation outputs against the frozen requirements, architecture, and evidence.

## Plane Responsibilities

### Control Plane

The future `apps/orchestrator` layer will own:

- task lifecycle and state transitions
- freeze gates
- evidence collection
- execution scheduling
- acceptance summaries

This repository only includes its initial shape and contract placeholders.

### Review Plane

The `services/chatgpt-web-bridge` layer owns browser-backed review operations:

- opening or binding an authenticated browser session
- selecting the target ChatGPT project
- switching model context when requested
- attaching files to a prompt flow
- starting or continuing conversations
- waiting for completion
- capturing snapshots
- exporting markdown and structured review outputs

### Execution Plane

The execution plane will be implemented later by coding agents. It should consume reviewed outputs, produce code changes, and return evidence back to the control plane.

## Orchestrator to Bridge Interaction

The future orchestrator should treat the bridge as a service boundary rather than a code library that reaches into browser internals. The interaction model is:

1. Open or reserve a browser session.
2. Select the target project and optional model.
3. Start or continue a conversation with curated inputs.
4. Wait for completion.
5. Export markdown and extract structured review JSON.
6. Record artifacts and attach them to the task evidence set.

## Current Implementation Boundary

Today the repository implements the Review Plane service and the shared contract surface around it:

- `packages/shared-contracts/chatgpt` defines the Zod-first request and response contracts.
- `services/chatgpt-web-bridge` implements the Fastify API, session lease, export pipeline, and mock-friendly adapter boundary.
- `apps/orchestrator` remains a skeleton so the control plane boundary is explicit but not faked.
