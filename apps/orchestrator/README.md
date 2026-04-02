# Orchestrator Control Plane

This package hosts the first control-plane skeleton for `review-then-codex-system`.

Current scope:

- requirement freeze and architecture freeze contracts
- task graph and task envelope persistence
- task-loop state rules with gate-aware transitions
- evidence ledger and gate result recording
- a typed bridge client boundary for `chatgpt-web-bridge`
- a replaceable execution layer with `CodexExecutor`, `CommandExecutor`, and `NoopExecutor`
- execution request/result persistence under per-run execution directories
- a review loop that turns bridge structured output into `review_result` evidence and `review_gate`
- a workspace runtime shell that prepares isolated execution context records
- integration coverage for the control-plane happy path and failure rules

The orchestrator does not drive a full agent runtime yet. It persists run state to files, dispatches typed execution requests through adapters, and exposes service boundaries that can later back an API or a workflow runtime.

## Local Usage

Run orchestrator tests:

```bash
npm test --workspace @review-then-codex/orchestrator
```

Run type checks:

```bash
npm run typecheck --workspace @review-then-codex/orchestrator
```

Artifacts are written under `apps/orchestrator/artifacts/runs/<runId>/`.

Execution attempt artifacts are written under `apps/orchestrator/artifacts/runs/<runId>/executions/<executionId>/`.

Review artifacts are written under `apps/orchestrator/artifacts/runs/<runId>/reviews/<reviewId>/`.

Workspace runtime records are written under `apps/orchestrator/artifacts/runs/<runId>/workspaces/<workspaceId>.json`.
