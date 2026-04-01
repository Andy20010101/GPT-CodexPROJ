# review-then-codex-system

`review-then-codex-system` is a monorepo for an architecture-first delivery model that separates review-quality thinking from code execution.

The system is intentionally split into three planes:

1. Control Plane: a future orchestrator that freezes requirements, freezes architecture, manages task state, and aggregates evidence.
2. Review Plane: the `chatgpt-web-bridge` service, which connects to an already logged-in ChatGPT web session and turns the browser workflow into a typed service boundary.
3. Execution Plane: a future coding-agent layer, such as Codex, that receives reviewed tasks and implements them under gates.

The Review Plane is not the orchestrator. It does not own task state, acceptance gates, or repository mutation policy. Its job is narrower: enter the right ChatGPT project, switch model context, upload task files, send prompts, wait for completion, capture results, and export structured outputs for higher layers.

## Current Scope

This repository currently provides:

- A monorepo skeleton with durable boundaries between apps, services, and shared contracts.
- Architecture documentation and ADRs for the three-plane system.
- A dedicated `chatgpt-web-bridge` service package that will expose a typed HTTP API for browser-backed review automation.
- A placeholder `orchestrator` app with contracts and examples, but not a full task loop implementation.

## Layout

```text
apps/
  orchestrator/
docs/
  architecture/
packages/
  shared-contracts/
services/
  chatgpt-web-bridge/
```

## Planned Bridge API

The bridge service is designed around these routes:

- `GET /health`
- `POST /api/sessions/open`
- `POST /api/projects/select`
- `POST /api/conversations/start`
- `POST /api/conversations/:id/message`
- `POST /api/conversations/:id/wait`
- `GET /api/conversations/:id/snapshot`
- `POST /api/conversations/:id/export/markdown`
- `POST /api/conversations/:id/extract/structured-review`

## Development

Install dependencies from the repository root:

```bash
npm install
```

Run the bridge tests:

```bash
npm test --workspace @review-then-codex/chatgpt-web-bridge
```

Start the bridge service:

```bash
npm run dev --workspace @review-then-codex/chatgpt-web-bridge
```
