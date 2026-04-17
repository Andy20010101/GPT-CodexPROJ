# Handoff

## Purpose

This handoff is for opening the next chat thread for platform self-improvement work on this repository.

Do not use this handoff for general external project delivery.

The operating model is now:

- `stable lane`: external project work on the known-good baseline
- `improvement lane`: self-improving this repository in bounded low-risk batches

Read first:

- [PARALLEL_DELIVERY_AND_SELF_IMPROVEMENT.md](/home/administrator/code/GPT-CodexPROJ/docs/architecture/PARALLEL_DELIVERY_AND_SELF_IMPROVEMENT.md)
- [PROJECT_PURPOSE_AND_CAPABILITIES.md](/home/administrator/code/GPT-CodexPROJ/docs/architecture/PROJECT_PURPOSE_AND_CAPABILITIES.md)
- [REAL_SELF_IMPROVEMENT.md](/home/administrator/code/GPT-CodexPROJ/docs/architecture/REAL_SELF_IMPROVEMENT.md)
- [REAL_SELF_IMPROVEMENT_SOP.md](/home/administrator/code/GPT-CodexPROJ/docs/architecture/REAL_SELF_IMPROVEMENT_SOP.md)
- [REVIEW_LOOP.md](/home/administrator/code/GPT-CodexPROJ/docs/architecture/REVIEW_LOOP.md)
- [todolist.md](/home/administrator/code/GPT-CodexPROJ/todolist.md)

## Current Direction

- Lane: `improvement lane`
- Goal: continue bounded platform self-improvement
- Ordered Execution Queue: no unchecked item remains after `11. Add a run-to-run governor for bounded self-improvement campaigns`
- Latest completed bounded item: `Artifact Hygiene backlog cleanup`
- Do not widen scope into:
  - gate semantics
  - acceptance rules
  - task graph core semantics
- Do not use `scripts/run-real-self-improvement.ts` as the entrypoint for general external project delivery

## First Task In The Next Chat

Treat the run-to-run governor as complete for the current supported local mode. Do not reopen it unless a concrete script/doc mismatch or a real bug is found.

The next chat should:

- confirm that `Ordered Execution Queue` is exhausted and that between-run governor now stops fail-closed there
- choose one remaining bounded item explicitly before editing code
- do not reopen `Improve run interruption and resume ergonomics` unless a concrete watcher/doc/runtime mismatch or a real bug is found
- stay out of gate semantics, acceptance rules, and task graph core semantics

Already implemented and should not be redone blindly:

- review-dispatch fail-closed checks for empty `changedFiles`, missing patch artifacts, and empty `testResults`
- test evidence grading into `placeholder` / `compile-check` / `unit` / `integration`
- fail-closed handling for truncated diffs and degraded review evidence
- repeated-patch convergence guard and manual-attention escalation
- operator workflow documentation and artifact hygiene for the supported local mode
- run-scoped goal persistence, campaign-scoped governor state, and shared terminal-state detection
- patch-summary vs patch-diff cross-check
- planning apply remediation for repairable schema failures
- self-improvement `doctor` / `ensure` bootstrap
- self-improvement driver sequencing across requirement, architecture, and task graph
- watcher-driven operator recovery surface for existing-run resume, daemon resume, and review-job retry
- wildcard ignore coverage for generated validation outputs under `tmp/orchestrator-validation-*/`
- top-level `tmp/` probe helpers are treated as transient diagnostics, while durable validation harness scripts stay tracked

## Likely Files To Inspect First

- [handoff.md](/home/administrator/code/GPT-CodexPROJ/handoff.md)
- [docs/architecture/SELF_IMPROVEMENT_NEW_CHAT_PROMPT.md](/home/administrator/code/GPT-CodexPROJ/docs/architecture/SELF_IMPROVEMENT_NEW_CHAT_PROMPT.md)
- [todolist.md](/home/administrator/code/GPT-CodexPROJ/todolist.md)
- [scripts/run-real-self-improvement.ts](/home/administrator/code/GPT-CodexPROJ/scripts/run-real-self-improvement.ts)
- [apps/orchestrator/src/services/run-acceptance-service.ts](/home/administrator/code/GPT-CodexPROJ/apps/orchestrator/src/services/run-acceptance-service.ts)
- [apps/orchestrator/src/services/orchestrator-summary.ts](/home/administrator/code/GPT-CodexPROJ/apps/orchestrator/src/services/orchestrator-summary.ts)
- [docs/architecture/PARALLEL_DELIVERY_AND_SELF_IMPROVEMENT.md](/home/administrator/code/GPT-CodexPROJ/docs/architecture/PARALLEL_DELIVERY_AND_SELF_IMPROVEMENT.md)
- [docs/architecture/REAL_SELF_IMPROVEMENT.md](/home/administrator/code/GPT-CodexPROJ/docs/architecture/REAL_SELF_IMPROVEMENT.md)

## Working Rules

- Prefer the improvement lane only; do not mix this task with external project packet work.
- The worktree is dirty. Do not revert unrelated user or historical changes.
- Pick one bounded next item explicitly before editing code.
- Keep the patch narrowly scoped to that selected item.
- If the selected item needs a small contract or persisted-state update, keep it minimal and local to that flow.
- Validate the selected path before stopping.

## Expected Validation

At minimum, run the most relevant targeted tests or command checks for the selected bounded item and summarize the result.

## New Chat Prompt

Use the ready-to-paste prompt in:

- [SELF_IMPROVEMENT_NEW_CHAT_PROMPT.md](/home/administrator/code/GPT-CodexPROJ/docs/architecture/SELF_IMPROVEMENT_NEW_CHAT_PROMPT.md)
