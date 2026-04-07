# Project Todo

Updated: 2026-04-07

## Current Baseline

- The latest formal real E2E run reached final acceptance:
  `/home/administrator/code/review-then-codex-system/tmp/orchestrator-validation-4/artifacts/runs/7c50c8e0-b083-47a2-a785-1bf6da8a9f7e/run.json`
- That run proved the end-to-end chain:
  `requirement freeze -> architecture freeze -> task graph -> task execution -> task review -> rework -> accepted -> release review -> run acceptance`
- The validation harness no longer loops forever on the same patch. The stage renderer was updated in:
  `/home/administrator/code/review-then-codex-system/tmp/orchestrator-validation-1/scripts/render-user-api-validation.mjs`
- A reusable local watcher now exists:
  `/home/administrator/code/review-then-codex-system/scripts/watch-run-until-terminal.mjs`

## Next Priority

- [ ] Add a first-class real self-improvement entrypoint.
  Goal: create one script that starts a bounded self-improvement run against this repository, instead of reusing the validation harness manually.
  Suggested target: `/home/administrator/code/review-then-codex-system/scripts/run-real-self-improvement.ts`
  It should:
  - create a run with a narrow objective
  - attach a watcher output path from the start
  - keep allowed scope explicit
  - fail closed if bridge/login/browser prerequisites are not ready

- [ ] Define the first safe self-improvement scope.
  Goal: make the first autonomous improvement intentionally narrow.
  Recommended scope for the first real run:
  - docs and scripts only
  - or bridge/orchestrator low-risk reliability surfaces already allowed by self-repair policy
  Keep out of scope:
  - gate semantics
  - acceptance rules
  - task graph core semantics

- [ ] Add a convergence guard against repeated identical rework patches.
  Goal: stop a run when the executor keeps producing the same patch N times in a row.
  Reason: this was the real cause of the earlier endless loop before the stage renderer fix.
  Minimum output:
  - repeated-patch detection in execution/review loop
  - manual-attention escalation with patch hash evidence

## Reliability And Operator Workflow

- [ ] Write one operator playbook for real runs on Windows + WSL.
  Goal: document the exact bring-up sequence that was proven to work.
  Include:
  - Chrome for Testing launch
  - WSL-visible DevTools endpoint
  - bridge start
  - orchestrator/daemon start
  - watcher command
  - retry/recovery commands

- [ ] Promote the watcher into the documented standard workflow.
  Goal: make `watch-run-until-terminal.mjs` the default way to observe long runs so progress does not depend on the current chat thread.
  Missing today:
  - README usage example
  - artifact output convention
  - guidance on how to resume monitoring an existing run

- [ ] Improve run interruption and resume ergonomics.
  Goal: make it obvious how to continue after login loss, browser replacement, or a new terminal session.
  Minimum output:
  - one documented resume path for an existing run
  - one documented retry path for a failed `task_review_request`

## Artifact Hygiene

- [ ] Stop tracking transient diagnostics and validation debris in the main worktree.
  Current issue:
  - `git status` is dominated by generated diagnostics, manifests, runtime heartbeats, and validation outputs.
  Goal:
  - move ephemeral outputs under clearly ignored paths
  - keep only intentional fixtures and durable docs in git diff

- [ ] Expand `.gitignore` or relocate generated validation outputs.
  Good candidates:
  - `services/chatgpt-web-bridge/src/artifacts/diagnostics/**`
  - temporary validation folders under `/home/administrator/code/review-then-codex-system/tmp/`
  - runtime heartbeats, leases, and GC records not meant as fixtures

## Documentation Gaps

- [ ] Update the README with the accepted formal E2E proof.
  Goal: replace the old “current boundary” wording with the stronger current status:
  - real formal E2E has reached final accepted
  - review/rework loop has been proven with real evidence
  - watcher-based monitoring exists

- [ ] Add a dedicated doc for real self-improvement runs.
  Goal: document how to start one bounded self-improvement run safely, what success looks like, and when to stop.
  Suggested location:
  `/home/administrator/code/review-then-codex-system/docs/architecture/REAL_SELF_IMPROVEMENT.md`

## Suggested Order

- [ ] 1. Implement `run-real-self-improvement.ts`
- [ ] 2. Add repeated-patch convergence guard
- [ ] 3. Document the Windows + WSL operator flow
- [ ] 4. Clean artifact hygiene and `.gitignore`
- [ ] 5. Update README and add `REAL_SELF_IMPROVEMENT.md`
