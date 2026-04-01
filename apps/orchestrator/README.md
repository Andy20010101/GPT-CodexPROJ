# Orchestrator Control Plane

This package hosts the first control-plane skeleton for `review-then-codex-system`.

Current scope:

- requirement freeze and architecture freeze contracts
- task graph and task envelope persistence
- task-loop state rules with gate-aware transitions
- evidence ledger and gate result recording
- a typed bridge client boundary for `chatgpt-web-bridge`
- integration coverage for the control-plane happy path and failure rules

The orchestrator does not drive a full agent runtime yet. It persists run state to files and exposes service boundaries that can later back an API or a workflow runtime.

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
