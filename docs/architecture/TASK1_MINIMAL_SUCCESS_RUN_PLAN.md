# Task 1 Minimal Success Run Plan

## Purpose

This document narrows the current self-improvement effort to one concrete goal:

- prove the first real self-improvement loop can complete
  `Task 1 execution -> review -> rework -> accepted`

This plan is intentionally narrower than full run acceptance.

## Success Definition

This iteration is successful only if all of the following become true:

1. `Task 1` completes a first execution attempt.
2. The first review runs successfully.
3. That review returns `changes_requested`.
4. The system moves `Task 1` back into implementation / rework.
5. `Task 1` completes a second execution attempt.
6. The second review runs successfully.
7. `Task 1` reaches `accepted`.

## Explicit Non-Goals

The following do not define success for this iteration:

- planning-only completion
- `Task 2` or `Task 3`
- `release_review`
- full run-level `accepted`
- daemon long-run stability
- multi-run fairness / priority correctness
- runtime cancellation completeness
- stale reclaim / recovery completeness
- self-repair / remediation completeness

## Current Diagnosis

The repository currently mixes three concerns:

1. proving the first real self-improvement chain
2. building a general workflow runtime
3. hardening dynamic browser automation

That mix is causing the loop:

- run a little
- hit a runtime or browser issue
- patch the system
- continue
- drift farther from the minimum success path

The main rule for the next pass is:

- do not use the real run as the debugger for unrelated runtime features

## Operating Principle

For this iteration, prefer a stable happy path over dynamic recovery.

That means:

- keep using DevTools / CDP browser automation
- do not try to make login / CDP / project recovery fully dynamic inside the run
- split environment preparation from task execution

Use this model:

1. `doctor / ensure` phase
   - ensure browser is reachable
   - ensure browser is already logged in
   - ensure ChatGPT opens correctly
   - ensure target project can be entered
   - ensure model switching and composer visibility work
2. `run` phase
   - open session
   - select project
   - start / continue conversation
   - send message and attachments
   - wait for completion
   - snapshot
   - extract structured review

If environment readiness fails during `doctor / ensure`, fail closed and stop.
Do not auto-heal environment state inside the real Task 1 run.

## Scope Reduction

### Keep

Keep the code paths required for the Task 1 golden path:

- bridge connection to a fixed browser endpoint
- project selection
- model selection
- message send
- attachment upload
- wait for completion
- conversation snapshot
- structured review extraction
- workspace preparation
- task execution
- review request / finalize flow
- task state transitions into rework and accepted

### Freeze

Treat these as out of scope for this iteration unless they directly block Task 1:

- dynamic endpoint discovery
- WSL / Windows attach topology discovery
- session resume / recover automation
- drift incident governance
- runtime diagnostics APIs
- multi-task scheduling improvements
- priority / quota correctness
- drain semantics
- long-run daemon hardening
- running-job cancellation semantics
- stale job reclaim
- release review
- run acceptance
- rollback / remediation / self-repair

## Files To Focus On

### Bridge Happy Path

Primary bridge files for this iteration:

- `services/chatgpt-web-bridge/src/adapters/chatgpt-adapter.ts`
- `services/chatgpt-web-bridge/src/services/conversation-service.ts`
- `services/chatgpt-web-bridge/src/exporters/structured-output-extractor.ts`
- `services/chatgpt-web-bridge/src/api/routes/bridge-routes.ts`
- `services/chatgpt-web-bridge/src/browser/browser-manager.ts`
- `services/chatgpt-web-bridge/src/browser/page-factory.ts`
- `services/chatgpt-web-bridge/src/dom/selectors.ts`

Reference implementation to compare against:

- `references/legacy/ChatGPTCLI/browser.js`
- `references/legacy/ChatGPTCLI/client.js`
- `references/legacy/ChatGPTCLI/adapter.js`
- `references/legacy/ChatGPTCLI/selectors.js`
- `references/legacy/ChatGPTCLI/wait-conversation.js`

### Orchestrator Golden Path

Primary orchestrator files for this iteration:

- `apps/orchestrator/src/services/worker-service.ts`
- `apps/orchestrator/src/services/review-service.ts`
- `apps/orchestrator/src/services/bridge-client.ts`
- `apps/orchestrator/src/services/codex-cli-runner.ts`
- `apps/orchestrator/src/application/orchestrator-service.ts`
- `apps/orchestrator/src/services/workspace-runtime-service.ts`
- `apps/orchestrator/src/services/worktree-service.ts`

## Files To Ignore For Now

Do not spend time here unless a failure in these files directly blocks Task 1:

- `apps/orchestrator/src/services/worker-pool-service.ts`
- `apps/orchestrator/src/services/daemon-runtime-service.ts`
- `apps/orchestrator/src/services/priority-queue-service.ts`
- `apps/orchestrator/src/services/quota-control-service.ts`
- `apps/orchestrator/src/services/stale-job-reclaim-service.ts`
- `apps/orchestrator/src/services/cancellation-service.ts`
- `apps/orchestrator/src/services/rollback-service.ts`
- `apps/orchestrator/src/services/remediation-service.ts`
- `apps/orchestrator/src/services/self-repair-policy-service.ts`

These are known unstable or non-essential for the current goal:

- `apps/orchestrator/tests/integration/concurrency-and-drain.test.ts`
- `apps/orchestrator/tests/integration/priority-and-quota-scheduling.test.ts`
- `apps/orchestrator/tests/integration/stale-recovery-and-cancel.test.ts`
- `apps/orchestrator/tests/integration/subprocess-cancel-and-reclaim.test.ts`
- `apps/orchestrator/tests/integration/daemon-long-run-smoke.test.ts`

## Evidence To Watch

Ignore broad runtime status unless it directly explains a Task 1 failure.

Use these artifacts as the source of truth:

- `runs/<runId>/run.json`
- `runs/<runId>/tasks/<taskId>.json`
- `runs/<runId>/executions/<executionId>/result.json`
- `runs/<runId>/reviews/<reviewId>/result.json`
- `runs/<runId>/reviews/<reviewId>/structured-review.json`

The specific passing evidence for this plan is:

- first review structured output is `changes_requested`
- task state returns to implementation / rework
- second execution result exists
- second review result is passing
- `Task 1` ends as `accepted`

## Continuous Execution Plan

This plan does not require stopping all progress and switching to a calendar-based sequence.
It can be executed while the project continues to run, but the scope must stay narrow.

### Rule 1: Do Not Use the Real Run as a General Runtime Debugger

If the current real execution is healthy, let it continue.

If it reaches a terminal state, inspect the exact blocking point and only fix code that is on the
Task 1 golden path.

If a failure is unrelated to:

- Task 1 execution
- Task 1 review dispatch
- Task 1 review finalization
- Task 1 rework transition
- Task 1 accepted transition

then record it and defer it.

### Rule 2: Stabilize the Bridge Happy Path In Place

While continuing the run, keep shrinking the bridge path toward the `ChatGPTCLI` model:

1. fixed browser URL
2. already logged-in browser
3. fixed project
4. fixed model path
5. send / wait / snapshot / extract

Do not widen diagnostics or recovery during this iteration.

Definition of done:

- the review bridge path behaves like a stable adapter, not an auto-recovery platform

### Rule 3: Stabilize the Task 1 Golden Path In Place

While continuing the run, keep orchestrator work limited to:

1. execution
2. review request
3. review finalize
4. rework transition
5. accepted transition

Keep runtime behavior effectively:

- single run
- single task focus
- single worker where possible
- serial where possible

Definition of done:

- the system can run Task 1 through execution, review, rework, and accepted without depending on unrelated runtime features

### Rule 4: Pause Only On Real Golden-Path Blockers

Pause the live run only if one of these is true:

1. Task 1 execution is clearly hung or cannot produce a terminal result.
2. The browser environment is no longer usable for the happy path.
3. Review cannot be dispatched or finalized on the fixed happy path.
4. The task cannot move back into rework or forward into accepted.

If none of those are true, keep running.

## Allowed Validation

Prefer validation that is close to the golden path:

- `apps/orchestrator/tests/integration/codex-review-loop.test.ts`
- `apps/orchestrator/tests/integration/execution-flow.test.ts`
- `apps/orchestrator/tests/unit/review-service.test.ts`
- `services/chatgpt-web-bridge/tests/unit/conversation-service.test.ts`
- `services/chatgpt-web-bridge/tests/integration/server.test.ts`

Avoid using the full monorepo test run as a progress indicator for this iteration.

## Forbidden Moves During This Iteration

Do not do these unless absolutely necessary for the Task 1 path:

- do not chase full orchestrator suite green
- do not expand daemon semantics
- do not improve multi-task scheduling
- do not widen self-repair scope
- do not broaden bridge diagnostics
- do not redesign the whole repository
- do not redefine success upward to full run acceptance

## Final Go / No-Go Gate

Restart the next real self-improvement attempt only when all of the following are true:

1. bridge happy path is fixed to a stable environment contract
2. Task 1 golden path is the only target
3. non-essential runtime failures are explicitly ignored
4. validation for the golden path passes locally

If those conditions are not met, do not start a new real run.

## One-Sentence Summary

For this iteration, use CDP as a stable happy-path driver, not as a dynamic self-healing browser platform, and use the orchestrator only to prove `Task 1 execution -> review -> rework -> accepted`.
