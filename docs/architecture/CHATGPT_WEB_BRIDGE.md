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

## HTTP API

All routes return a uniform envelope:

- success: `{ ok: true, data: ... }`
- failure: `{ ok: false, error: { code, message, details? } }`

The implemented routes are:

- `GET /health`
- `POST /api/sessions/open`
- `POST /api/projects/select`
- `POST /api/conversations/start`
- `POST /api/conversations/:id/message`
- `POST /api/conversations/:id/wait`
- `GET /api/conversations/:id/snapshot`
- `POST /api/conversations/:id/export/markdown`
- `POST /api/conversations/:id/extract/structured-review`

The request and response schemas live in `packages/shared-contracts/chatgpt`, then get parsed again at the route layer before service execution.

## Artifacts

Artifacts are written under `services/chatgpt-web-bridge/artifacts/`. The initial implementation records:

- markdown exports
- structured review JSON exports
- manifest JSON describing the run context

Each manifest records:

- timestamp
- sessionId
- conversationId
- projectName
- model
- input files
- exported artifact paths

## Session Lease

Each live session can be leased by only one job at a time. This prevents two upstream callers from interleaving DOM actions against the same page.

The lease is enforced in the service layer around project selection, conversation start, message send, wait, and snapshot operations.

## DOM Drift Handling

ChatGPT Web is not a stable API surface. The bridge therefore treats selector presence as a preflight concern and raises structured drift errors when key elements disappear instead of failing silently.

Current drift handling is intentionally minimal but explicit:

- selectors are centralized in `src/dom/selectors.ts`
- required page probes are checked by `PreflightGuard`
- missing critical selectors raise `DOM_DRIFT_DETECTED`
- visible login prompts or auth redirects raise `CHATGPT_NOT_READY`

## Current Limits

The service is designed for extension, but the current scope is deliberately conservative:

- session and conversation registries are in memory only
- browser integration targets a logged-in ChatGPT page and does not use an official API
- route-level tests use a mock adapter instead of opening a real browser
- the orchestrator is implemented only as a first control-plane skeleton, not yet as a full workflow runtime

## Opt-In Real Smoke Harness

For manual bridge validation, the repository now includes `services/chatgpt-web-bridge/tests/real/bridge-smoke.ts`.

Characteristics:

- it is not part of the default `npm test` path
- it is intended for local manual runs only
- it requires `ENABLE_REAL_CHATGPT_TESTS=true`
- it also requires a reachable logged-in browser debug endpoint through `CHATGPT_BROWSER_URL`

The harness currently checks:

- `GET /health`
- session open plus preflight behavior
- optional project selection when `CHATGPT_PROJECT_NAME` is supplied
