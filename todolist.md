# Project Todo

Updated: 2026-04-14

## Current Baseline

- The latest formal real E2E run reached final acceptance:
  `/home/administrator/code/GPT-CodexPROJ/tmp/orchestrator-validation-4/artifacts/runs/7c50c8e0-b083-47a2-a785-1bf6da8a9f7e/run.json`
- That run proved the end-to-end chain:
  `requirement freeze -> architecture freeze -> task graph -> task execution -> task review -> rework -> accepted -> release review -> run acceptance`
- The validation harness no longer loops forever on the same patch. The stage renderer was updated in:
  `/home/administrator/code/GPT-CodexPROJ/tmp/orchestrator-validation-1/scripts/render-user-api-validation.mjs`
- A reusable local watcher now exists:
  `/home/administrator/code/GPT-CodexPROJ/scripts/watch-run-until-terminal.mjs`

## Operating Policy

- Use a stable lane to run external project work on the known-good baseline.
- Use a separate improvement lane to continue self-improving this repository.
- Do not use `scripts/run-real-self-improvement.ts` as the entrypoint for general external project delivery.
- Before merging improvement-lane changes back into the stable lane, validate the affected runtime/review path.
- Until operator recovery workflow is stronger, keep self-improvement away from gate semantics, acceptance rules, and task graph core semantics.

## Ordered Execution Queue

- [x] 0. Add a first-class real self-improvement entrypoint.
  Status:
  - `scripts/run-real-self-improvement.ts` now exists
  - the first bounded self-improvement runs have already been created through this entrypoint

- [x] 1. Define the first safe self-improvement scope.
  Status:
  - the current bounded target has already been frozen to low-risk bootstrap / scripts / docs work
  - high-risk core semantics remain out of scope

- [x] 2. Formalize environment bootstrap as a reusable module.
  Status:
  - bootstrap now exists as `scripts/self-improvement-env.ts`
  - `run-real-self-improvement.ts` calls bootstrap first
  - `env-state.json` and authoritative artifact-root checks are part of the flow

- [x] 3. Make the self-improvement run driver durable across planning phases.
  Status:
  - `scripts/run-real-self-improvement.ts` now drives `requirement -> architecture -> task-graph` in one flow
  - the same entrypoint can resume from persisted run state with `--run-id <run-id>`
  - success is no longer limited to requirement materialization
  Why next:
  - the latest bounded run proved bootstrap works, but the sequential driver stopped after requirement materialized
  - watcher is only an observer; it does not continue architecture/task-graph automatically
  Minimum output:
  - requirement -> architecture -> task-graph sequencing must survive beyond the first phase
  - if the foreground driver exits, the run must be resumable from persisted planning/runtime state
  - success is not “requirement materialized”; success is “the driver continued or resumed into the next phase”

- [x] 4. Auto-repair invalid planning payloads instead of stopping at apply-time schema errors.
  Status:
  - planning apply now classifies schema failures as repairable vs fatal
  - repairable payload errors write remediation evidence, persist repaired payloads, and retry apply normalization automatically
  Why next:
  - the current bounded run reached a real non-timeout blocker: `architecture apply` failed because the GPT-materialized payload violated schema (`moduleDefinitions[*].ownedPaths` empty for boundary modules)
  - continuing to blindly resume the same run will only re-hit the same validation failure
  - Codex should not stop at this point; the planning loop should either repair the payload deterministically when safe or issue a targeted repair/follow-up prompt and continue
  Minimum output:
  - requirement/architecture/task-graph apply must detect schema violations and classify them as repairable vs fatal
  - repairable planning payload errors must trigger an automatic remediation/resume path instead of abandoning the run
  - architecture apply must not silently coerce unsafe semantics; every repair must be explicit, evidenced, and persisted
  - success is not “schema error logged”; success is “the run moved past the invalid planning artifact and continued into the next phase”

- [x] 5. Harden review evidence before dispatching review requests.
  Status:
  - review dispatch now fails closed when `changedFiles` is empty before request materialization
  - review dispatch now fails closed when declared changes are missing the required patch artifact
  - review dispatch now fails closed when `testResults` is empty
  - fail-closed review-evidence errors now carry explicit manual-attention metadata
  Why next:
  - once self-improvement can run, the next biggest correctness risk is weak review evidence reaching GPT

- [x] 6. Cross-check patch summary against the actual patch diff.
  Status:
  - review dispatch now derives changed files from the patch artifact itself
  - review dispatch fails closed when the patch artifact does not cover the changed files described by execution output
  Why after 5:
  - evidence completeness should be enforced before evidence consistency is trusted

- [x] 7. Grade test evidence strength before review.
  Status:
  - test evidence is now classified into `placeholder`, `compile-check`, `unit`, and `integration`
  - `unit` and `integration` are surfaced as strong evidence; `placeholder` and `compile-check` remain weak
  - review requests and review-request evidence metadata now carry `testEvidence` grading
  - the review prompt now tells GPT how to interpret strong vs weak test evidence
  Why after 6:
  - once evidence is present and consistent, the next step is making its strength explicit

- [x] 8. Strengthen fail-closed review rules for truncated or degraded evidence.
  Status:
  - review dispatch now fails closed when diff evidence is structurally truncated
  - review dispatch now fails closed when patch artifact metadata marks the diff as truncated
  - review dispatch now fails closed when only degraded review evidence remains, including weak test evidence
  Why after 7:
  - fail-closed policy should be based on explicit evidence completeness + evidence grading

- [x] 9. Add repeated-patch convergence guard.
  Status:
  - review dispatch now fingerprints patch artifacts with raw and semantic hashes
  - repeated identical and effectively identical patches now stop the loop before another review dispatch
  - convergence evidence now persists as `patch-convergence.json`
  - worker handling now escalates convergence failures to manual attention
  Why after 8:
  - once review evidence is trustworthy, repeated bad loops can be stopped with confidence

- [x] 10. Write and finish the operator workflow documentation.
  Status:
  - `REAL_SELF_IMPROVEMENT.md`, `REAL_SELF_IMPROVEMENT_SOP.md`, and `WSL_HOST_BROWSER_ATTACH.md` now document the supported local operator path
  - Windows + WSL bring-up, watcher usage, `--run-id` resume, job retry, daemon resume, and failure-specific recovery are now documented against the current supported local mode
  Scope:
  - Windows + WSL playbook
  - watcher usage
  - resume / retry workflow

- [x] 11. Add a run-to-run governor for bounded self-improvement campaigns.
  Why next:
  - single-run reliability, evidence quality, operator workflow, and artifact hygiene are now strong enough to bound the next layer of automation
  Status:
  - `scripts/run-real-self-improvement.ts` now persists one run-scoped goal and one campaign-scoped governor state
  - `scripts/watch-run-until-terminal.mjs` and the run driver now share one explicit terminal-state detector
  - next-goal selection now chooses exactly one unchecked item from `Ordered Execution Queue` and excludes already-used todo ids
  - between-run automation is now opt-in and capped by `--iteration-cap`, and it stops fail-closed when no ordered auto-runnable goal remains

- [x] 12. Clean artifact hygiene and `.gitignore`.
  Status:
  - `.gitignore` now isolates bridge drift artifacts and current scratch `tmp/` probe/recovery outputs from the normal worktree view
  - supported operator docs now treat `<artifact-root>/runtime/self-improvement-env/env-state.json` and `<artifact-root>/runs/<run-id>/watcher/*` as the authoritative observation surface
  - transient generated artifact entries were dropped from the git index so ignore rules can own future noise
  Why here:
  - this landed before the run-to-run governor so the operator surface stays observable and bounded

- [x] 13. Update README and finalize self-improvement docs.
  Status:
  - README now reflects the accepted E2E/runtime boundary and links the self-improvement operator docs
  - `docs/architecture/REAL_SELF_IMPROVEMENT.md` remains the dedicated run guide
  Scope:
  - README status update
  - `REAL_SELF_IMPROVEMENT.md` completion

## Next Priority

- [x] Add a first-class real self-improvement entrypoint.
  Goal: create one script that starts a bounded self-improvement run against this repository, instead of reusing the validation harness manually.
  Suggested target: `/home/administrator/code/GPT-CodexPROJ/scripts/run-real-self-improvement.ts`
  It should:
  - create a run with a narrow objective
  - attach a watcher output path from the start
  - keep allowed scope explicit
  - fail closed if bridge/login/browser prerequisites are not ready

- [x] Define the first safe self-improvement scope.
  Goal: make the first autonomous improvement intentionally narrow.
  Recommended scope for the first real run:
  - docs and scripts only
  - or bridge/orchestrator low-risk reliability surfaces already allowed by self-repair policy
  Keep out of scope:
  - gate semantics
  - acceptance rules
  - task graph core semantics

- [x] Add a convergence guard against repeated identical rework patches.
  Goal: stop a run when the executor keeps producing the same patch N times in a row.
  Reason: this was the real cause of the earlier endless loop before the stage renderer fix.
  Minimum output:
  - repeated-patch detection in execution/review loop
  - manual-attention escalation with patch hash evidence

- [x] Formalize environment bootstrap as a reusable module.
  Goal: stop treating browser/CDP/bridge/orchestrator bring-up as chat-thread memory.
  Minimum output:
  - one `doctor` path that checks browser/CDP, login, bridge, orchestrator, and artifact-root health
  - one `ensure` path that performs the minimum recovery/startup work
  - one stable `env-state.json` that later runs can consume directly
  - `run-real-self-improvement.ts` and future real-run entrypoints must use this module first

- [x] Harden review evidence before dispatching review requests.
  Goal: stop sending weak or incomplete execution evidence to GPT and forcing it to guess.
  Minimum output:
  - fail review dispatch if `changedFiles` is empty
  - fail review dispatch if `patchArtifactContent` is missing
  - fail review dispatch if `testResults` is empty
  - emit a clear fail-closed/manual-attention error instead of continuing with weak evidence

- [x] Cross-check patch summary against the actual patch diff.
  Goal: ensure `patchSummary.changedFiles` matches the real file set present in the diff.
  Minimum output:
  - derive file paths from the diff itself
  - compare them with `patchSummary.changedFiles`
  - fail closed or escalate when they differ

- [x] Grade test evidence strength before review.
  Goal: distinguish placeholder evidence from meaningful validation.
  Minimum output:
  - classify test evidence into at least: placeholder, unit, integration, compile-check
  - prevent the system from treating all `testResults` as equally strong evidence
  - surface the test evidence grade in review payloads and/or gating metadata

- [x] Strengthen fail-closed review rules for truncated or degraded evidence.
  Goal: reject unsafe review dispatches when the diff or logs are too incomplete to support a trustworthy review.
  Minimum output:
  - detect when diff content is truncated beyond an acceptable threshold
  - detect when only degraded evidence is available
  - refuse to dispatch review and require re-materialization or operator attention

- [x] Add a run-to-run governor for bounded self-improvement campaigns.
  Goal: avoid requiring a human to manually start every later round once a bounded plan is already frozen.
  Minimum output:
  - one clear terminal-state detector for a finished run
  - one next-goal selector that can choose exactly one todo item for the next bounded run
  - one stop policy / iteration cap so the system does not expand without bounds
  - one documented distinction between “automatic inside one run” and “automatic between runs”

## Reliability And Operator Workflow

- [x] Write one operator playbook for real runs on Windows + WSL.
  Goal: document the exact bring-up sequence that was proven to work.
  Include:
  - Chrome for Testing launch
  - WSL-visible DevTools endpoint
  - bridge start
  - orchestrator/daemon start
  - watcher command
  - retry/recovery commands

- [x] Promote the watcher into the documented standard workflow.
  Goal: make `watch-run-until-terminal.mjs` the default way to observe long runs so progress does not depend on the current chat thread.
  Missing today:
  - README usage example
  - artifact output convention
  - guidance on how to resume monitoring an existing run

- [x] Improve run interruption and resume ergonomics.
  Goal: make it obvious how to continue after login loss, browser replacement, or a new terminal session.
  Minimum output:
  - one documented resume path for an existing run
  - one documented retry path for a failed `task_review_request`
  Status:
  - `scripts/watch-run-until-terminal.mjs` now writes an operator surface into `watcher/latest.json` and `watcher/latest.md`
  - watcher snapshots now surface authoritative artifact paths, `--prepare-only --run-id`, existing-run `--run-id`, daemon status/resume commands, and the newest retryable/manual-attention review jobs
  - `REAL_SELF_IMPROVEMENT.md` and `REAL_SELF_IMPROVEMENT_SOP.md` now treat watcher output as the first recovery surface for existing-run resume and failed review-job retry

## Artifact Hygiene

- [x] Stop tracking transient diagnostics and validation debris in the main worktree.
  Status:
  - top-level `tmp/*.mjs` probe helpers and `tmp/*.codex` scratch operator config are now treated as transient diagnostics instead of durable repo content
  - durable validation harness helpers under `tmp/orchestrator-validation-1/scripts/` remain intentionally visible/tracked

- [x] Expand `.gitignore` or relocate generated validation outputs.
  Status:
  - `.gitignore` now uses wildcard rules for `tmp/orchestrator-validation-*/artifacts/` and `tmp/orchestrator-validation-*/planning/` instead of enumerating a few numbered runs
  - generated bridge/orchestrator runtime output remains ignored, while durable docs, fixtures, and harness helpers stay outside these ignore rules

## Documentation Gaps

- [x] Update the README with the accepted formal E2E proof.
  Goal: replace the old “current boundary” wording with the stronger current status:
  - real formal E2E has reached final accepted
  - review/rework loop has been proven with real evidence
  - watcher-based monitoring exists

- [x] Add a dedicated doc for real self-improvement runs.
  Goal: document how to start one bounded self-improvement run safely, what success looks like, and when to stop.
  Suggested location:
  `/home/administrator/code/GPT-CodexPROJ/docs/architecture/REAL_SELF_IMPROVEMENT.md`

## Suggested Order

- [ ] Follow `Ordered Execution Queue` from the first unchecked item downward.
- [x] `11. Add a run-to-run governor for bounded self-improvement campaigns` is complete.
- [ ] `Ordered Execution Queue` currently has no remaining unchecked item; choose the next bounded item explicitly from the remaining sections.
