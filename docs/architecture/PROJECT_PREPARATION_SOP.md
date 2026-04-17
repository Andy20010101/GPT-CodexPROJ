# Project Preparation SOP

This SOP defines how an operator should actually run the preparation workflow for a new project or new initiative.

This document is operational. It does not redefine workflow semantics. The authoritative rules live in:
- [PROJECT_PREPARATION_WORKFLOW.md](/home/administrator/code/review-then-codex-system/docs/architecture/PROJECT_PREPARATION_WORKFLOW.md)
- [PROJECT_PREPARATION_TEMPLATES.md](/home/administrator/code/review-then-codex-system/docs/architecture/PROJECT_PREPARATION_TEMPLATES.md)
- [PROJECT_PREPARATION_CLI.md](/home/administrator/code/review-then-codex-system/docs/architecture/PROJECT_PREPARATION_CLI.md)

Supporting context:
- [PROJECT_PREPARATION_HARNESS.md](/home/administrator/code/review-then-codex-system/docs/architecture/PROJECT_PREPARATION_HARNESS.md)
- [PROJECT_PREPARATION_EXAMPLE.md](/home/administrator/code/review-then-codex-system/docs/architecture/PROJECT_PREPARATION_EXAMPLE.md)
- [PROJECT_PREPARATION_TRIAL_RUNBOOK.md](/home/administrator/code/review-then-codex-system/docs/architecture/PROJECT_PREPARATION_TRIAL_RUNBOOK.md)
- [PROJECT_PREPARATION_NEW_TRIAL_PROMPT.md](/home/administrator/code/review-then-codex-system/docs/architecture/PROJECT_PREPARATION_NEW_TRIAL_PROMPT.md)

For downstream run behavior after preparation is complete, see:
- [REAL_SELF_IMPROVEMENT.md](/home/administrator/code/review-then-codex-system/docs/architecture/REAL_SELF_IMPROVEMENT.md)
- [REAL_SELF_IMPROVEMENT_SOP.md](/home/administrator/code/review-then-codex-system/docs/architecture/REAL_SELF_IMPROVEMENT_SOP.md)

## When To Use This SOP

Use this SOP when the input is still:
- a project idea
- a broad initiative
- a rough desired outcome
- an under-bounded external project ask

Do not use this SOP when the work is already a bounded task inside an active run.

## Operator Goal

The operator goal is to move from:

`idea -> converged preparation -> exported canonical packet -> downstream handoff`

The operator is not trying to:
- execute the project
- replace requirement/architecture/task-graph planning
- write a task-graph by hand during preparation

## Preparation Workspace

Each preparation should live under:

`docs/project-preparation/<project-slug>/`

Recommended layout:

```text
docs/project-preparation/<project-slug>/
  README.md
  process/
  packet/
  exports/
  handoffs/
  history/
```

Current packet-side template files already exist under:

`docs/project-preparation/templates/`

Process-side ledgers should follow the shapes defined in:

[PROJECT_PREPARATION_TEMPLATES.md](/home/administrator/code/review-then-codex-system/docs/architecture/PROJECT_PREPARATION_TEMPLATES.md)

## Start Checklist

Before beginning:

- [ ] Confirm this is a new project or a meaningfully new initiative
- [ ] Confirm this is not just the next task inside an active run
- [ ] Choose a stable `<project-slug>`
- [ ] Create `docs/project-preparation/<project-slug>/`
- [ ] Initialize `process/`, `packet/`, `exports/`, `handoffs/`, and `history/`
- [ ] Copy the current packet-side template files into `packet/`
- [ ] Create the process-side ledgers defined in the templates spec
- [ ] Keep the first version narrow

## Standard Operating Sequence

### 1. Intake

Goal:
- confirm this deserves a standalone preparation

Operator actions:
- capture the rough idea
- verify it is not a subtask or bug masquerading as a project
- write the initial candidate project definition

Move on only when one coherent project candidate exists.

### 2. Clarification

Goal:
- clarify facts, actors, flows, current pain, constraints, and known unknowns

Operator actions:
- ask fact-finding questions
- record unresolved questions in `OPEN_QUESTIONS`
- avoid forcing decisions too early

Move on only when:
- the primary actor is clear
- the core problem is clear
- the primary flow is clear
- major constraints are clear enough to support tradeoff work

### 3. Brainstorm

Goal:
- force priorities, boundaries, non-goals, and tradeoffs into the open

Operator actions:
- ask pressure questions
- record must-keep / can-drop / not-now pressure in `TRADEOFF_LEDGER`
- use `OPTION_SET` only when materially distinct directions genuinely exist

Do not treat brainstorm as a default option menu exercise.

Move on only when the project shape is constrained enough to support direction choice.

### 4. Direction Decision

Goal:
- formally choose the project direction

Operator actions:
- turn the converged shape into a direction proposal
- open a direction checkpoint
- require human approval before treating direction as frozen

If rejected, roll back to `brainstorm` or `clarification` as appropriate.

### 5. Scope Freeze

Goal:
- define what the MVP includes and excludes

Operator actions:
- propose `in-scope` and `out-of-scope`
- write or update `MVP_SCOPE.md` and `NON_GOALS.md`
- open a scope checkpoint

Move on only after human checkpoint approval.

### 6. Boundary Freeze

Goal:
- define allowed, protected, and dangerous surfaces

Operator actions:
- write or update `ARCHITECTURE_BOUNDARY.md`
- identify current danger zones
- open a boundary checkpoint

Move on only after human checkpoint approval.

### 7. Success / Evidence Freeze

Goal:
- define what success means and what evidence later review should expect

Operator actions:
- write or update `SUCCESS_CRITERIA.md`
- make failure conditions explicit
- open a success/evidence checkpoint

Move on only after human checkpoint approval.

### 8. Workstream Shaping

Goal:
- shape medium-grained workstreams for downstream planning

Operator actions:
- write or update `INITIAL_WORKSTREAMS.md`
- keep workstreams between slogan-level and task-graph-level detail

Do not decompose to execution-grade tasks here.

### 9. Convergence Gate

Goal:
- decide whether the preparation is sufficiently converged to freeze

Operator actions:
- run the convergence gate
- produce `CONVERGENCE_REPORT`
- identify blockers, carryable risks, fallback stage, and next action
- require human approval of the gate result

If the gate fails, roll back to the concrete fallback stage instead of forcing export.

### 10. Packet Export

Goal:
- formally publish canonical packet from approved frozen content

Operator actions:
- prepare export proposal
- confirm source decisions and source convergence report
- ensure unresolved content remains on the process side
- require human approval before publishing
- on approval:
  - refresh `packet/`
  - write a new `exports/` snapshot
  - update `PACKET_EXPORT_STATUS`

### 11. Handoff

Goal:
- publish a downstream entry point bound to the current export

Operator actions:
- prepare handoff proposal
- bind it to the current export
- explicitly separate frozen content from unresolved but non-blocking items
- require human approval
- on approval:
  - update `packet/NEW_CHAT_HANDOFF_PROMPT.md`
  - write a new `handoffs/` snapshot

## Pause, Resume, and Rollback

### Pause

Pause when:
- waiting on human input
- waiting on external constraints
- waiting on a blocking answer that cannot be guessed safely

### Resume

Resume by reading:
- current `process/PREPARATION_STATE.json`
- active `CHECKPOINTS`
- latest `CONVERGENCE_REPORT`
- current `packet/`
- latest handoff if one exists

### Rollback

Rollback when:
- clarification was not actually complete
- brainstorm did not pressure-test the real boundaries
- direction remains unstable
- scope, boundary, or success/evidence changed materially
- convergence gate fails
- export proposal misrepresents frozen content

Rollback must preserve history. Do not delete prior state to simulate a clean slate.

## Operator Quality Rules

- do not treat packet authoring as the whole workflow
- do not let unresolved blocking questions leak into packet as frozen truth
- do not let brainstorm collapse into feature-listing
- do not skip mandatory checkpoints
- do not export packet just because the documents “look mostly filled in”
- do not let workstreams become a pseudo task graph

## Current Tooling Note

The workflow is fully specified, but helper automation may lag behind the full command surface.

Until all commands exist, the operator should preserve the same workflow semantics manually in-repo:
- keep process-side ledgers current
- keep checkpoint decisions explicit
- keep export history versioned
- keep handoff bound to the latest valid export

## Downstream Handoff

When preparation is complete, the next thread or next run should receive:
- the repo path
- [PROJECT_PREPARATION_WORKFLOW.md](/home/administrator/code/review-then-codex-system/docs/architecture/PROJECT_PREPARATION_WORKFLOW.md)
- [PROJECT_PREPARATION_TEMPLATES.md](/home/administrator/code/review-then-codex-system/docs/architecture/PROJECT_PREPARATION_TEMPLATES.md)
- [PROJECT_PREPARATION_CLI.md](/home/administrator/code/review-then-codex-system/docs/architecture/PROJECT_PREPARATION_CLI.md)
- this SOP
- the prepared packet directory
- the exact next objective

If the next phase is runtime execution rather than continued preparation, include the relevant real self-improvement run docs as well.
