# Planning Proof And Sufficiency Gate

This round adds a formal planning lane for:

- `requirement_freeze`
- `architecture_freeze`
- `task_graph_generation`

All three phases now share the same `request -> finalize -> apply` semantics used by the review lane.

## Request-Only Planning

The request phase is intentionally short-lived:

- build a planning prompt from the raw source prompt plus prior freezes
- route the phase through the planning model policy
- open a bridge conversation
- persist `conversationId` and `conversationUrl` immediately
- return without waiting for the assistant to finish

Artifacts written during request:

- `conversation-link.json`
- `request-runtime-state.json`
- `request.json`
- `model-routing-decision.json`

This preserves the fact that the planning request succeeded even if final materialization fails later.

## Finalize And Recovery

Finalize now:

- waits with the planning profile
- exports markdown
- extracts structured output
- retries extraction remediation on the same conversation when needed
- records `planning_finalize_attempt` and `planning_materialized_result`

The sweeper scans these pending states:

- `requirement_materialization_pending`
- `architecture_materialization_pending`
- `task_graph_materialization_pending`
- `*_finalize_retryable`

Recovery is conversation-stable:

- no new planning conversation is opened
- recovery metadata records `recoveredFromConversationId`
- per-run recovery output is written to `planning-recovery-summary.json`

## Pro Long-Think Defaults

Planning routing defaults:

- model: `pro`
- max wait: `3_000_000ms`
- poll interval: `5000ms`
- stable polls: `3`

These defaults are configurable through:

- `PLANNING_MODEL_HINT`
- `PLANNING_MAX_WAIT_MS`
- `PLANNING_POLL_INTERVAL_MS`
- `PLANNING_STABLE_POLLS`

## Planning Sufficiency Gate

Task graph registration is blocked until planning passes a dedicated sufficiency gate.

Requirement freeze must include:

- at least one objective
- non-goals
- constraints
- testable acceptance criteria

Architecture freeze must include:

- module boundaries
- dependency direction rules
- interface or data-flow boundaries

Task graph must include:

- task objective
- acceptance criteria
- test plan
- dependency data when applicable
- scope or allowed files when available

Gate outcomes:

- `passed`
- `planning_incomplete`
- `planning_invalid`
- `planning_requires_manual_review`

## Validation Commands

Targeted planning verification:

```bash
TMPDIR=/tmp npx vitest run \
  tests/unit/planning-model-routing-service.test.ts \
  tests/unit/planning-sufficiency-gate-service.test.ts \
  tests/unit/planning-service.test.ts \
  tests/unit/failure-classification-service.test.ts \
  --config vitest.config.ts \
  --testTimeout 20000
```

Targeted integration and regression verification:

```bash
TMPDIR=/tmp npx vitest run \
  tests/integration/planning-live-generation.test.ts \
  tests/integration/execution-flow.test.ts \
  tests/integration/codex-review-loop.test.ts \
  tests/integration/recovery-and-retry.test.ts \
  tests/unit/daemon-runtime-service.test.ts \
  --config vitest.config.ts \
  --testTimeout 20000
```

Proof entrypoint:

```bash
PLANNING_PROOF_MODE=mock_assisted TMPDIR=/tmp npx tsx scripts/run-fresh-planning-proof.ts
```

Opt-in real proof:

```bash
PLANNING_PROOF_MODE=real \
ENABLE_REAL_E2E_VALIDATION=true \
ENABLE_REAL_PLANNING_PROOF=true \
BRIDGE_BASE_URL=http://127.0.0.1:3100 \
BRIDGE_BROWSER_URL=http://127.0.0.1:9222 \
TMPDIR=/tmp \
npx tsx scripts/run-fresh-planning-proof.ts
```

## Current Real-Proof Prerequisites

The real proof depends on environment prerequisites outside the planning lane itself:

- a live `chatgpt-web-bridge` service
- a browser with an exposed DevTools endpoint
- a logged-in ChatGPT session in that browser
- a browser debugging endpoint reachable from the process that runs the bridge

If those prerequisites are missing, the planning lane still remains testable through the mock-assisted proof path while preserving the same request/finalize/apply orchestration shape.
