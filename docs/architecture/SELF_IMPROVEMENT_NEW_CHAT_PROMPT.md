# Self-Improvement New Chat Prompt

Use this when opening the next chat thread for platform self-improvement.

```text
You are working in `/home/administrator/code/GPT-CodexPROJ`.

This thread is for the improvement lane, not for general external project delivery.

First read and follow these docs:

- `/home/administrator/code/GPT-CodexPROJ/docs/architecture/PARALLEL_DELIVERY_AND_SELF_IMPROVEMENT.md`
- `/home/administrator/code/GPT-CodexPROJ/docs/architecture/PROJECT_PURPOSE_AND_CAPABILITIES.md`
- `/home/administrator/code/GPT-CodexPROJ/docs/architecture/REAL_SELF_IMPROVEMENT.md`
- `/home/administrator/code/GPT-CodexPROJ/docs/architecture/REAL_SELF_IMPROVEMENT_SOP.md`
- `/home/administrator/code/GPT-CodexPROJ/docs/architecture/REVIEW_LOOP.md`
- `/home/administrator/code/GPT-CodexPROJ/todolist.md`
- `/home/administrator/code/GPT-CodexPROJ/handoff.md`

Current direction:

- stay on the improvement lane
- do not widen scope into gate semantics, acceptance rules, or task graph core semantics
- `Ordered Execution Queue` currently has no unchecked item after the run-to-run governor landed
- pick one remaining bounded todo explicitly before editing code
- do not reopen `Improve run interruption and resume ergonomics` unless inspection finds a concrete watcher/doc/runtime mismatch or a real bug

Your first objective:

- choose the next bounded self-improvement item explicitly and keep the patch narrow

Minimum expected outcome:

- confirm whether the existing governor/terminal-state docs and scripts already cover the selected next item
- make the smallest bounded change needed for the newly selected item
- keep the distinction between “automatic inside one run” and “automatic between runs” intact

Important context:

- review-dispatch fail-closed checks for empty `changedFiles`, missing patch artifacts, and empty `testResults` are already implemented
- test evidence grading into `placeholder` / `compile-check` / `unit` / `integration` is already implemented
- fail-closed handling for truncated diffs and degraded review evidence is already implemented
- repeated-patch convergence guard and manual-attention escalation are already implemented
- operator workflow documentation is already complete for the current supported local mode
- run-scoped goal persistence, campaign-scoped governor state, and shared terminal-state detection are already implemented
- artifact hygiene and `.gitignore` cleanup for the supported local mode is already implemented
- patch-summary vs patch-diff cross-check is already implemented
- planning apply remediation is already implemented
- self-improvement bootstrap and planning-phase driver durability are already implemented
- do not redo those items unless inspection proves a bug

Inspect first:

- `/home/administrator/code/GPT-CodexPROJ/handoff.md`
- `/home/administrator/code/GPT-CodexPROJ/todolist.md`
- `/home/administrator/code/GPT-CodexPROJ/scripts/run-real-self-improvement.ts`
- `/home/administrator/code/GPT-CodexPROJ/docs/architecture/PARALLEL_DELIVERY_AND_SELF_IMPROVEMENT.md`
- `/home/administrator/code/GPT-CodexPROJ/docs/architecture/REAL_SELF_IMPROVEMENT.md`
- inspect additional files only after the next bounded item is chosen

Working rules:

- the worktree is dirty; do not revert unrelated changes
- choose one bounded next item explicitly before editing code
- keep the patch narrow and focused on that selected item
- if you need a small persisted state or contract surface for the selected item, keep it minimal and local to that flow
- verify the changed path before stopping
```
