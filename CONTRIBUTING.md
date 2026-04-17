# Contributing

## Scope

This repository is a monorepo for an architecture-first delivery system. Contributions should preserve the boundary between:

- `apps/orchestrator` as the Control Plane
- `services/chatgpt-web-bridge` as the Review Plane
- executor adapters as the Execution Plane
- `docs/project-preparation/*` as upstream preparation assets, not runtime task plans

## Local Setup

```bash
npm install
cp .env.example .env.local
```

Recommended runtime baseline:

- Node.js `20` via `.nvmrc`
- npm workspaces from the repository root

## Development Workflow

1. Make the smallest change that solves the problem.
2. Keep docs, contracts, and tests aligned with the behavior you changed.
3. Do not commit generated runtime artifacts from `tmp/`, `apps/orchestrator/artifacts/`, or `services/chatgpt-web-bridge/src/artifacts/`.
4. Prefer targeted tests first, then broader checks if the change crosses package boundaries.

## Validation

Common commands:

```bash
npm run lint
npm run typecheck
npm test --workspace @review-then-codex/orchestrator
npm test --workspace @review-then-codex/chatgpt-web-bridge
npm run ci
```

Minimum expectation:

- code changes should include the smallest relevant automated validation
- contract or runtime-boundary changes should include tests when practical
- doc-only changes should state that no runtime tests were needed

## Pull Requests

Keep pull requests narrow and explicit:

- explain the user-visible or operator-visible change
- call out any boundary or contract impact
- list the commands you ran
- mention any real-run or browser-backed validation you did not run

## High-Risk Areas

Treat these areas conservatively unless the task explicitly requires them:

- gate semantics
- acceptance rules
- task-graph core semantics
- browser session authority and recovery
- self-improvement automation scope
