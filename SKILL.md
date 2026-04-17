---
name: gpt-codexproj
description: Use when working inside the GPT-CodexPROJ repository to preserve the three-plane architecture, choose the right docs and tests for orchestrator or bridge changes, follow the preparation workflow, and keep self-improvement changes inside the repository's bounded safety rules.
---

# GPT-CodexPROJ

Use this skill when the task touches this repository's code, docs, preparation workflow, or operator runbooks.

## Core Model

- `apps/orchestrator` is the Control Plane. It owns run state, freezes, gates, evidence, jobs, runtime control, and acceptance.
- `services/chatgpt-web-bridge` is the Review Plane. It owns browser-backed ChatGPT session operations, export, diagnostics, and recovery surfaces.
- The Execution Plane is a replaceable executor layer inside the orchestrator. Current concrete paths are `CodexExecutor`, `CommandExecutor`, and `NoopExecutor`.

The bridge is not the orchestrator, and preparation is not runtime planning.

## Preserve These Boundaries

- Do not move run-state or gate semantics into the bridge.
- Do not treat `docs/project-preparation/*` as runtime task plans. Preparation is upstream convergence before requirement freeze.
- Keep self-improvement changes bounded. Avoid widening gate semantics, acceptance rules, or task-graph core behavior unless the task explicitly requires it.
- Treat `apps/orchestrator/artifacts/`, `services/chatgpt-web-bridge/src/artifacts/`, and `tmp/` as generated or operator-facing surfaces, not normal source directories.

## Read The Right Docs First

- Whole-system orientation:
  - `README.md`
  - `docs/architecture/PROJECT_PURPOSE_AND_CAPABILITIES.md`
  - `docs/architecture/SYSTEM_OVERVIEW.md`
- Orchestrator or execution changes:
  - `docs/architecture/ORCHESTRATOR_CONTROL_PLANE.md`
  - `docs/architecture/WORKFLOW_RUNTIME.md`
  - `docs/architecture/CODEX_EXECUTION.md`
  - `docs/architecture/CODEX_CLI_RUNTIME.md`
- Bridge changes:
  - `docs/architecture/CHATGPT_WEB_BRIDGE.md`
  - `docs/architecture/BROWSER_ATTACH_DIAGNOSTICS.md`
  - `docs/architecture/WSL_HOST_BROWSER_ATTACH.md`
- Preparation-layer changes:
  - `docs/architecture/PROJECT_PREPARATION_WORKFLOW.md`
  - `docs/architecture/PROJECT_PREPARATION_CLI.md`
  - `docs/architecture/PROJECT_PREPARATION_SOP.md`
- Self-improvement or operator flow changes:
  - `docs/architecture/PARALLEL_DELIVERY_AND_SELF_IMPROVEMENT.md`
  - `docs/architecture/REAL_SELF_IMPROVEMENT.md`
  - `docs/architecture/REAL_SELF_IMPROVEMENT_SOP.md`

## Validate With The Smallest Relevant Surface

- Repo-wide guardrails:
  - `npm run lint`
  - `npm run typecheck`
- Orchestrator:
  - `npm test --workspace @gpt-codexproj/orchestrator`
- Bridge:
  - `npm test --workspace @gpt-codexproj/chatgpt-web-bridge`
- Full local guardrail:
  - `npm run ci`

If a task only changes repo metadata or Markdown docs, prefer targeted validation and explain what you did not run.
