# Real Self-Improvement Status And Boundary

## Purpose

This document captures the current judgment after the first real self-improvement run reached acceptance for Task 1, Task 2, and Task 3.

It is not a redesign proposal. It defines:

- what has already been proven to work
- what the system currently supports
- what the system does not yet support
- whether the project needs an immediate refactor
- what order future work should follow

For the repeatable fresh-conversation operator procedure, see [`REAL_SELF_IMPROVEMENT_SOP.md`](/home/administrator/code/review-then-codex-system/docs/architecture/REAL_SELF_IMPROVEMENT_SOP.md).

## Current Status

As of `2026-04-10`, the current real self-improvement run has already demonstrated a complete accepted loop across the first three tasks:

- Task 1: accepted
- Task 2: accepted
- Task 3: accepted

Representative evidence lives under:

- `tmp/real-self-improvement/artifacts/runs/c27a123f-6255-490a-b0b3-b2c6079d983a/tasks/eefe62db-0b39-549a-80a8-50cbc2b8a0fa.json`
- `tmp/real-self-improvement/artifacts/runs/c27a123f-6255-490a-b0b3-b2c6079d983a/tasks/8990a8d9-069b-5a09-8ba4-187c18e812a8.json`
- `tmp/real-self-improvement/artifacts/runs/c27a123f-6255-490a-b0b3-b2c6079d983a/tasks/edff6c9a-2bea-50e1-ad88-552620d3abb9.json`

This matters because it rules out the strongest failure hypothesis: the project is not fundamentally unable to run end to end.

## What Has Been Proven

The following statements are now supported by real run evidence rather than by design intent alone.

### 1. The core task loop works

The system can complete:

- `execution`
- `review`
- `rework`
- `accepted`

This is no longer just a planning-only path and no longer just a one-off manual success.

### 2. Real review attachments can work

The review path no longer depends on prompt-only references. The bridge now supports a working library-backed attachment flow in the supported environment, and structured review extraction can succeed from the resulting assistant output.

### 3. Execution terminalization can work

The system can reach:

- runner process exit
- execution artifact finalization
- review request enqueue
- review finalize
- accepted task state

This means the execution plane is not permanently stuck at the handoff between local runner completion and review dispatch.

### 4. The system already has a usable supported mode

The project is not operating as an undefined pile of experimental scripts anymore. It already has a real, bounded operator mode that can carry tasks to acceptance when the environment stays inside that boundary.

## What The Real Problem Is

The main problem is not that the desired product behavior is simple while the codebase is automatically too large.

The real problem is that the system currently behaves as if it supports more runtime modes than it has actually hardened.

The project is simultaneously trying to do several hard things:

- drive a real logged-in browser
- upload and attach evidence files to ChatGPT
- parse structured planning and review outputs
- manage task, job, gate, review, and execution state transitions
- preserve audit artifacts that let the operator inspect and resume work

That combination is already more demanding than a normal "DevTools agent clicks around in a browser" workflow.

The instability came less from having too many modules and more from having blurry support boundaries.

## Where Overdesign Exists

Overdesign exists, but not in the sense that the whole architecture is unnecessary.

### Not overdesigned

These parts are justified by the actual product goal:

- orchestrator-managed task lifecycle
- bridge-driven browser interaction
- persisted execution and review artifacts
- structured planning and structured review outputs
- evidence-first operator workflow

If the goal includes auditability, bounded task execution, and task-level acceptance, these are not optional extras.

### Overdesigned or over-promised

The system has behaved as though it might support all of the following at once:

- automatic login recovery
- restoring and continuing old conversations
- automatic recovery from arbitrary dirty page state
- attaching to arbitrary browser/project state without operator preparation
- robust long-run recovery across all partial runtime states

That is where the excess complexity shows up.

The problem is not "too many components." The problem is "too many implied support promises."

## Current Supported Mode

The project should now explicitly define its supported mode as follows.

### Environment

- fixed logged-in browser at `http://172.18.144.1:9224`
- fixed bridge at `http://127.0.0.1:3115`
- orchestrator and artifact root already live and writable

### Conversation and review behavior

- fresh conversation
- fresh review
- review attachments must use the currently validated library-backed attachment flow

### Artifact and evidence behavior

- all task, job, gate, review, execution, and runtime artifacts must be written to disk
- operator recovery should rely on those artifacts rather than on hidden in-memory state

### Operator assumptions

- browser login state is operator-maintained
- if the environment is outside the supported mode, the run should stop early with explicit diagnostics
- PTY/non-PTY interchangeability is not part of the current support promise; follow the conservative runner discipline in [`REAL_SELF_IMPROVEMENT_SOP.md`](/home/administrator/code/review-then-codex-system/docs/architecture/REAL_SELF_IMPROVEMENT_SOP.md), which defaults to the last explicitly validated mode and prefers the known-good non-PTY path when PTY has not been revalidated

This is the current minimum complete product mode.

It is not just a demo path because it includes:

- real task execution
- real review
- real rework
- accepted state transitions
- persisted evidence

## Current Non-Supported Mode

The following capabilities should not be treated as supported yet:

- automatic login
- old conversation recovery as a normal workflow
- automatic healing of arbitrary browser page state
- arbitrary environment attach and self-correction
- guaranteed success across all partial runtime states
- "one click, works anywhere" startup

These are valid future goals, but they should be marked as unsupported rather than silently left as random runtime failures.

## What To Do With Unsupported Cases

Unsupported cases should not be ignored.

But they also should not force an immediate platform expansion.

The correct behavior is:

- inside the supported boundary: run must be reliable and complete
- outside the supported boundary: fail fast, emit clear evidence, and stop

This is the key policy shift that reduces chaos without forcing a large rewrite.

## Does The Project Need An Immediate Refactor

No large refactor is justified right now.

The reason is simple:

- the core loop has already succeeded across three tasks
- repeated blockers were narrowed to specific surfaces and resolved locally
- the project has not yet shown that the architecture itself prevents progress

A large refactor would be premature because it would trade a now-proven working path for a wider theoretical design before the supported boundary has even been fully formalized.

## What Should Happen Instead Of A Big Refactor

The next move should be boundary hardening, not architecture replacement.

### 1. Freeze the supported mode

Document exactly what environment and operator assumptions are required.

### 2. Turn doctor and preflight into hard gates

If the live browser, bridge, login state, artifact root, or review preconditions are not valid, stop before task execution starts.

### 3. Fail fast outside the boundary

Do not let unsupported situations degrade into vague mid-run failures.

### 4. Continue future tasks inside the same mode

Use the current supported environment for the next tasks rather than reopening support-scope questions every time.

## When A Local Platform Convergence Is Justified

A local platform convergence is justified only when all of the following are true:

1. the same class of blocker repeats across multiple tasks or runs
2. the blocker is clearly outside task content
3. the blocker prevents reaching review or acceptance inside the supported mode
4. the fix can be kept narrow and directly tied to the repeated state transition failure

This means the project should prefer:

- narrow recovery or execution-plane fixes

and avoid:

- broad cleanup campaigns
- architecture rewrites
- scope-expanding reliability work that is not yet required by current supported mode

## Recommended Order For Future Work

The recommended sequence is:

1. stop the just-completed run work once the current task is accepted
2. record the supported mode and unsupported mode in documentation
3. make doctor and preflight reject unsupported runtime states early
4. continue the next task using the same supported environment
5. only pause for a narrow platform fix if the same blocker repeats two to three times
6. only discuss a larger refactor if repeated narrow fixes stop working

## Practical Decision

The practical decision is:

- do not shrink the project just to make it look simpler
- do not keep patching random runtime issues without naming support boundaries
- do keep the existing architecture
- do define and enforce a supported mode
- do continue future work inside that supported mode

## Short Summary

The project is not "only minimally working" anymore, and it is not "forced into refactor now."

The correct current position is:

- a bounded real mode already works
- that mode should now be treated as the official supported path
- unsupported cases should fail early and explicitly
- future progress should continue inside the supported boundary until repeated evidence proves a larger restructuring is necessary
