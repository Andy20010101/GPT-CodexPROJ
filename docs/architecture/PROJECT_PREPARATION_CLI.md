# Project Preparation CLI

This document defines the current implemented command surface for the preparation workflow in
[scripts/project-preparation.ts](/home/administrator/code/GPT-CodexPROJ/scripts/project-preparation.ts:1).

It describes command groups and state effects. It does not freeze long-term shell UX details beyond
the commands that already exist in the repository.

Use this document together with:
- [PROJECT_PREPARATION_WORKFLOW.md](/home/administrator/code/GPT-CodexPROJ/docs/architecture/PROJECT_PREPARATION_WORKFLOW.md)
- [PROJECT_PREPARATION_TEMPLATES.md](/home/administrator/code/GPT-CodexPROJ/docs/architecture/PROJECT_PREPARATION_TEMPLATES.md)
- [PROJECT_PREPARATION_SOP.md](/home/administrator/code/GPT-CodexPROJ/docs/architecture/PROJECT_PREPARATION_SOP.md)

## CLI Scope

The implemented CLI supports:
- preparation workspace creation and structural assessment
- stage progression through a single `advance` surface
- process-ledger maintenance for questions, tradeoffs, options, and decisions
- formal checkpoint management
- convergence gate execution
- packet export publication and refresh
- export-bound handoff generation, refresh, display, and consumption
- audit, history, diff, and resume surfaces

It does not:
- replace downstream planning
- execute runtime task loops
- become a second orchestrator

## Command Source of Truth

The current source of truth for command names is:
- `node --import tsx scripts/project-preparation.ts --help`

This document should stay aligned with that implemented surface.

## 1. Workspace and Stage Commands

These commands create or move a preparation through its bounded workflow.

### `init`

Purpose:
- create a new preparation workspace for one project slug

Expected effects:
- create the preparation root
- initialize `process/`, `packet/`, `exports/`, `handoffs/`, and `history/`
- write initial process state and packet scaffolds

### `status`

Purpose:
- show the current preparation structure and readiness

Expected output:
- layout kind
- readiness summary
- missing or degraded surfaces
- next action hint

This command is read-only.

### `check`

Purpose:
- validate readiness and exit non-zero when refinement is still required

Expected effects:
- no mutations
- command exit status reflects whether the preparation is currently downstream-ready

### `advance`

Purpose:
- move one stage to a new explicit status

Expected effects:
- update `PREPARATION_STATE.json`
- append stage transition history
- refuse stage completion when an approved mandatory checkpoint is missing

This is the implemented stage-control surface in the current repository. Separate
`stage enter/complete/rollback` commands are not implemented.

### `timeline`

Purpose:
- print the preparation timeline

### `history`

Purpose:
- print timeline plus stage transition history

## 2. Ledger Commands

These commands maintain process-side ledgers.

### Question Commands

Implemented commands:
- `question add`
- `question list`
- `question resolve`
- `question defer`
- `question reopen`

Expected effects:
- update `OPEN_QUESTIONS.md`
- update blocking question state in `PREPARATION_STATE.json`
- invalidate convergence/export readiness when blocking questions reopen

### Tradeoff Commands

Implemented commands:
- `tradeoff add`
- `tradeoff list`
- `tradeoff converge`
- `tradeoff supersede`

Expected effects:
- update `TRADEOFF_LEDGER.md`
- preserve brainstorm tradeoff history as process-side state

### Option Commands

Implemented commands:
- `option add`
- `option list`
- `option select`
- `option reject`

Expected effects:
- update `OPTION_SET.md`
- support direction shaping when materially distinct options exist

### Decision Commands

Implemented commands:
- `decision propose`
- `decision list`
- `decision approve`
- `decision reject`
- `decision supersede`

Expected effects:
- update `DECISION_LOG.md`
- keep approved decisions bound to approved checkpoints

## 3. Checkpoint Commands

These commands manage formal human review actions.

Implemented commands:
- `checkpoint list`
- `checkpoint open`
- `checkpoint approve`
- `checkpoint approve-with-correction`
- `checkpoint reject`

Expected effects:
- update checkpoint state in `PREPARATION_STATE.json`
- regenerate `CHECKPOINTS.md`
- drive stage completion, rollback, and readiness changes

Key rule:
- mandatory checkpoints must not be bypassed by stage progression

## 4. Convergence Command

### `check convergence`

Purpose:
- run the convergence gate

Expected output:
- pass or fail result
- fallback stage on failure
- failed checklist items when not ready

Expected effects:
- write or refresh `CONVERGENCE_REPORT.md`
- update readiness flags in `PREPARATION_STATE.json`
- move the workflow into `convergence_gate`

The current implementation does not provide separate `check readiness` or `validation summary`
commands. `status`, `check`, and `audit *` cover those surfaces today.

## 5. Packet Commands

These commands manage canonical packet publication and freshness.

### `export packet`

Purpose:
- publish canonical packet from approved frozen content

Preconditions:
- valid convergence pass
- approved packet export checkpoint

Expected effects:
- write the current canonical `packet/`
- create a new `exports/export-XXX/` snapshot
- update `PACKET_EXPORT_STATUS.json`
- update `PREPARATION_STATE.json`
- stale the latest handoff when a new export supersedes the prior export context

### `packet status`

Purpose:
- show current packet freshness, source convergence report, and latest handoff linkage

### `packet refresh`

Purpose:
- publish a new export version after frozen content changed

Expected effects:
- create a new export version instead of silently overwriting history
- update packet freshness metadata
- stale the currently latest handoff until it is refreshed

## 6. Handoff Commands

These commands manage export-bound downstream entry points.

### `handoff`

Purpose:
- generate the current canonical handoff prompt and a historical snapshot

Expected effects:
- refresh `packet/NEW_CHAT_HANDOFF_PROMPT.md`
- create `handoffs/handoff-XXX.md` and matching metadata
- bind the handoff to the latest export

### `handoff refresh`

Purpose:
- regenerate the latest handoff against the current export

Expected effects:
- supersede the previous latest handoff snapshot
- publish a new latest handoff snapshot

### `handoff show`

Purpose:
- print the current canonical handoff prompt

### `handoff consume`

Purpose:
- record that downstream planning or a fresh chat has used the current handoff

Expected effects:
- mark handoff metadata `consumed`
- append audit history

## 7. Audit, Diff, and Resume Commands

### `audit summary`

Purpose:
- show the overall health of the preparation

Expected output:
- workflow status
- current stage
- readiness
- open questions
- active checkpoints
- latest convergence/export/handoff references

### `audit blockers`

Purpose:
- print only blockers preventing progression or export

### `diff exported-packet`

Purpose:
- compare the current packet with a previous export snapshot

Expected output:
- per-file same/changed/missing status against a chosen export id

### `resume from-state`

Purpose:
- print concrete resume information from current process-side state

### `resume from-handoff`

Purpose:
- print the current canonical handoff path and resume source

## State Impact Rules

The CLI must preserve the workflow rules defined in the workflow spec.

In particular:
- mandatory checkpoints must not be bypassed
- gate pass must not coexist with blocking open questions that could change frozen outcomes
- export refresh must create a new export version rather than silently overwrite history
- handoff freshness must follow export freshness
- approved decisions must remain checkpoint-bound
- rollback and rejection must preserve audit history

## Read-Only vs Mutating Operations

Read-only operations:
- `status`
- `check`
- `question list`
- `tradeoff list`
- `option list`
- `decision list`
- `checkpoint list`
- `packet status`
- `handoff show`
- `audit summary`
- `audit blockers`
- `timeline`
- `history`
- `diff exported-packet`
- `resume from-state`
- `resume from-handoff`

Mutating operations:
- `init`
- `advance`
- `question add`
- `question resolve`
- `question defer`
- `question reopen`
- `tradeoff add`
- `tradeoff converge`
- `tradeoff supersede`
- `option add`
- `option select`
- `option reject`
- `decision propose`
- `decision approve`
- `decision reject`
- `decision supersede`
- `checkpoint open`
- `checkpoint approve`
- `checkpoint approve-with-correction`
- `checkpoint reject`
- `check convergence`
- `export packet`
- `packet refresh`
- `handoff`
- `handoff refresh`
- `handoff consume`

## Implementation Note

This file now describes the implemented CLI surface rather than a hypothetical superset.

If the CLI grows later, new commands should extend this document without weakening the underlying
workflow semantics:
- process-first preparation
- checkpoint-bound freezing
- convergence-gated export
- export-bound handoff
