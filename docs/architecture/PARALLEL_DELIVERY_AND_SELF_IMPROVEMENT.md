# Parallel Delivery And Self-Improvement

This document defines the recommended way to use this repository for two goals at the same time:

1. run other real projects through the current validated system
2. continue improving the system itself through bounded self-improvement work

The short version is:

- use one stable lane to deliver project work
- use one improvement lane to evolve the platform
- do not mix those two responsibilities inside the same live run surface

## Why This Split Exists

If the same live platform surface is both:

- delivering project work
- and rewriting its own runtime behavior

then a failure becomes hard to explain.

You cannot quickly tell whether the problem came from:

- the external project content
- the platform's latest self-modification
- or an unsafe interaction between both

So the operating rule is:

- the stable lane is for delivery
- the improvement lane is for platform change

## The Two Lanes

### Stable Lane

Use the stable lane for:

- running project work that should rely on the known-good minimal implementation
- preparation packets for new projects
- bounded delivery runs that should not depend on unvalidated platform changes

The stable lane should:

- stay on a validated baseline
- avoid unreviewed platform-core edits
- prefer the currently supported local mode
- be the default lane for project work

### Improvement Lane

Use the improvement lane for:

- self-improving this repository
- low-risk reliability work on review evidence, retries, resume paths, watcher ergonomics, and artifact hygiene
- bounded platform hardening that can be validated before merge-back

The improvement lane should:

- live in a separate branch or separate worktree
- treat itself as experimental until validated
- avoid widening platform scope while safety gaps are still open

## Non-Negotiable Rules

1. Do not run project delivery from the self-improvement entry script.
   `scripts/run-real-self-improvement.ts` is for bounded platform-improvement runs, not for general external project delivery.

2. Do not let the stable lane depend on unvalidated improvement-lane changes.

3. Do not start with high-risk platform changes.
   Until operator-recovery controls are stronger, keep self-improvement away from:
   - gate semantics
   - acceptance rules
   - task graph core semantics

4. Do not treat one shared browser-backed review surface as safe for two simultaneous live runs by default.
   The current local mode is validated as a bounded operator path, not as a proven concurrent multi-session browser-review system.

5. Keep artifacts and monitoring separate by run.
   Every run must keep its own:
   - run id
   - watcher outputs
   - packet path
   - artifact references

## Recommended Operating Model

### Repository Layout

Use:

- one stable branch or worktree for delivery
- one improvement branch or worktree for platform self-improvement

Recommended mental model:

- `stable lane`: "ship project work"
- `improvement lane`: "improve the machine"

### Run Separation

For project work:

- create a preparation packet under `docs/project-preparation/<project-slug>/`
- use `scripts/project-preparation.ts` plus the preparation SOP
- start a fresh run only after the packet is ready

For platform self-improvement:

- use `scripts/self-improvement-env.ts`
- use `scripts/run-real-self-improvement.ts`
- keep scope bounded to the current supported low-risk surfaces

### Browser And Bridge Discipline

The current recommendation is conservative:

- do not assume two simultaneous live browser-backed planning/review runs are safe on the same attached local stack
- if project delivery is actively using the live bridge/browser path, treat self-improvement as a separate lane that should not compete for that same live operator surface unless you intentionally isolate the stack

In plain terms:

- parallel in repository strategy is good
- parallel live browser-backed runs on one shared local stack are not the default recommendation

## Immediate Plan

This is the recommended order for the next phase.

### Step 1. Freeze A Stable Delivery Baseline

Pick a validated baseline for the stable lane.

That baseline should:

- use the known-good local mode
- keep the current supported bridge/browser/orchestrator path
- avoid platform-core churn while project work is running

### Step 2. Start Project Work Through Preparation, Not Self-Improvement

For each external project:

1. choose a project slug
2. create a packet under `docs/project-preparation/<project-slug>/`
3. fill the packet using `PROJECT_PREPARATION_SOP.md`
4. validate that the packet is ready for a fresh run
5. only then hand it into the runtime flow

This keeps external project shaping separate from platform self-modification.

### Step 3. Keep Self-Improvement On A Separate Improvement Lane

The first improvement batches were:

1. harden review evidence before dispatch
2. grade test evidence strength and fail closed on degraded evidence
3. add repeated-patch convergence guard
4. improve resume/retry/operator ergonomics
5. clean artifact hygiene and ignored generated outputs
6. add a bounded run-to-run governor with explicit terminal detection and iteration caps

Do not jump from there into:

- broader autonomy
- automatic expansion beyond one selected next todo
- major refactors of core gate or task-graph semantics

### Step 4. Merge Back Only After Validation

An improvement-lane change should merge back into the stable lane only when:

- targeted tests pass
- the relevant runtime or review path is revalidated
- the change stays within the approved low-risk surface
- the change improves reliability more than it expands scope

## Practical Sequence To Follow Now

If you want to do both project delivery and self-improvement now, use this sequence:

1. keep one stable lane for external project runs
2. create the external project packet first
3. run the external project on the stable lane
4. keep self-improvement work on a separate lane
5. keep between-run automation bounded to one selected todo, explicit terminal detection, and explicit iteration caps
6. merge only validated improvement batches back into the stable lane

## What "Success" Looks Like

This parallel model is working when:

- project runs can continue without depending on experimental platform edits
- self-improvement can continue without breaking active delivery runs
- failures can be attributed clearly to either project content or platform change
- the stable lane becomes better only after improvement-lane validation

## Related Docs

- `docs/architecture/PROJECT_PREPARATION_SOP.md`
- `docs/architecture/REAL_SELF_IMPROVEMENT.md`
- `docs/architecture/REAL_SELF_IMPROVEMENT_SOP.md`
- `docs/architecture/PROJECT_PURPOSE_AND_CAPABILITIES.md`
- `todolist.md`
