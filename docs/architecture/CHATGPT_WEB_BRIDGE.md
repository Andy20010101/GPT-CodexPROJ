# ChatGPT Web Bridge

`chatgpt-web-bridge` is the Review Plane service. It exists to turn an already logged-in ChatGPT Web session into a typed, testable integration surface.

## Responsibilities

- session opening and session registry
- project selection
- model selection
- conversation start and continuation
- completion waiting
- snapshot retrieval
- markdown export
- structured review extraction
- artifact manifest recording
- preflight checks against page readiness and selector drift

## Design Constraints

- The bridge is not the control plane.
- The bridge does not directly write project code.
- The route layer never touches Puppeteer `Page`.
- DOM selectors are centralized.
- lease conflicts are explicit errors, not implicit race conditions

## Service Shape

The service package is divided into:

- `api/`: Fastify routes and request/response schemas
- `browser/`: browser lifecycle, session lease, page creation
- `dom/`: selector catalog and drift detection
- `domain/`: project and conversation abstractions
- `adapters/`: ChatGPT-specific browser operations
- `services/`: orchestration of adapter calls, export workflow, and registry state
- `exporters/`: markdown export and structured extraction
- `guards/`: preflight validation and artifact manifest persistence

## Artifacts

Artifacts are written under `services/chatgpt-web-bridge/artifacts/`. The initial implementation records:

- markdown exports
- structured review JSON exports
- manifest JSON describing the run context

## Session Lease

Each live session can be leased by only one job at a time. This prevents two upstream callers from interleaving DOM actions against the same page.

## DOM Drift Handling

ChatGPT Web is not a stable API surface. The bridge therefore treats selector presence as a preflight concern and raises structured drift errors when key elements disappear instead of failing silently.
