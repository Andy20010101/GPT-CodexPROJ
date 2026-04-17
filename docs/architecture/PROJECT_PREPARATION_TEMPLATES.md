# Project Preparation Templates

This document defines the canonical template shapes for the process side and packet side of project preparation.

Use this document together with:
- [PROJECT_PREPARATION_WORKFLOW.md](/home/administrator/code/GPT-CodexPROJ/docs/architecture/PROJECT_PREPARATION_WORKFLOW.md)
- [PROJECT_PREPARATION_CLI.md](/home/administrator/code/GPT-CodexPROJ/docs/architecture/PROJECT_PREPARATION_CLI.md)
- [PROJECT_PREPARATION_SOP.md](/home/administrator/code/GPT-CodexPROJ/docs/architecture/PROJECT_PREPARATION_SOP.md)

This document defines template shapes. It does not redefine workflow rules.

## Template Rules

- process-side files record how convergence happens
- packet-side files record frozen downstream-consumable outcomes
- unresolved blocking questions, raw brainstorm notes, and unapproved decisions must remain on the process side
- canonical packet must always resolve to the same eight packet files
- current packet files live under `packet/`
- historical exports and handoffs live under `exports/` and `handoffs/`

## Preparation Root

Each preparation lives under:

`docs/project-preparation/<project-slug>/`

Recommended top-level layout:

```text
docs/project-preparation/<project-slug>/
  README.md
  process/
  packet/
  exports/
  handoffs/
  history/
```

## Process-Side Templates

### `process/PREPARATION_STATE.json`

Purpose:
- track the current workflow state, stage state, and top-level readiness

Template:

```json
{
  "preparationId": "prep_example",
  "projectSlug": "example-project",
  "title": "Example Project",
  "status": "active",
  "currentStageId": "clarification",
  "nextStageId": "brainstorm",
  "readyForConvergenceGate": false,
  "readyForPacketExport": false,
  "activeCheckpointIds": [],
  "latestConvergenceReportId": null,
  "latestPacketExportId": null,
  "latestHandoffId": null,
  "createdAt": "2026-04-14T00:00:00Z",
  "updatedAt": "2026-04-14T00:00:00Z",
  "stages": [
    {
      "stageId": "intake",
      "status": "completed",
      "enteredAt": "2026-04-14T00:00:00Z",
      "completedAt": "2026-04-14T00:05:00Z",
      "requiredCheckpointIds": [],
      "blockingQuestionIds": [],
      "producedDecisionIds": [],
      "notes": "Confirmed this is a standalone preparation."
    }
  ]
}
```

Notes:
- `stages` is the source of truth for stage state
- rollback must preserve history rather than erase it
- the exact ID scheme is not frozen here

### `process/OPEN_QUESTIONS.md`

Purpose:
- record unresolved, deferred, and resolved questions

Template:

```md
# Open Questions

## Open
| ID | Stage | Question | Category | Impact | Owner | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| q_001 | clarification | Example blocking question | flow | blocking | human | Affects primary flow |

## Deferred
| ID | Stage | Question | Why Deferred | Revisit At |
| --- | --- | --- | --- | --- |

## Resolved
| ID | Stage | Question | Resolution Summary | Resolved At |
| --- | --- | --- | --- | --- |
```

Notes:
- `Impact` must distinguish `blocking` from `non_blocking`
- “discussed in chat” is not enough to mark a question resolved

### `process/TRADEOFF_LEDGER.md`

Purpose:
- capture brainstorm pressure questions and convergence tradeoffs

Template:

```md
# Tradeoff Ledger

## Active Tradeoffs

### t_001 Core Value Pressure
- Stage: brainstorm
- Pressure Question: If the first version can preserve only one core value, what must it preserve?
- Must Keep:
  - ...
- Can Drop:
  - ...
- Not Now:
  - ...
- Boundary Implication:
  - ...
- Failure Implication:
  - ...
- Current Leaning:
  - ...
- Still Unresolved:
  - ...
- Linked Decisions:
  - d_001
```

Notes:
- this is the primary brainstorm surface
- every entry should be driven by a pressure question, not a feature wishlist

### `process/OPTION_SET.md`

Purpose:
- record materially distinct directions when they actually exist

Template:

```md
# Option Set

## Active Options

### o_001 Example Direction
- Stage: brainstorm
- Summary: ...
- Advantages:
  - ...
- Tradeoffs:
  - ...
- Risks:
  - ...
- Fit Summary:
  - ...
- Status: active
- Selection Reason:
  - ...
- Rejection Reason:
  - ...
```

Notes:
- optional and secondary
- do not force option enumeration when brainstorm is already converging through tradeoffs

### `process/DECISION_LOG.md`

Purpose:
- record proposed, approved, rejected, and superseded decisions

Template:

```md
# Decision Log

## Decisions

### d_001 Example Decision
- Stage: direction_decision
- Status: proposed
- Decision:
  - ...
- Rationale:
  - ...
- Linked Questions:
  - q_001
- Linked Tradeoffs:
  - t_001
- Affects Packet Files:
  - PROJECT_BRIEF.md
- Approved By:
  - null
- Approved At:
  - null
```

Notes:
- approved decisions must remain traceable to the checkpoint that authorized them

### `process/CHECKPOINTS.md`

Purpose:
- record active and historical human checkpoints

Template:

```md
# Checkpoints

## Active

### c_001 Scope Freeze Checkpoint
- Stage: scope_freeze
- Type: scope
- Status: pending_human
- What Is Being Decided:
  - ...
- Proposed Frozen Content:
  - ...
- Not Frozen Yet:
  - ...
- Why Ready:
  - ...
- Rollback If Rejected:
  - brainstorm
- Linked Decisions:
  - d_002

## History

### c_000 Direction Checkpoint
- Stage: direction_decision
- Type: direction
- Status: approved
- Approval Summary:
  - ...
- Approved By:
  - human
- Approved At:
  - 2026-04-14T00:00:00Z
```

Notes:
- checkpoints are workflow actions, not loose comments

### `process/CONVERGENCE_REPORT.md`

Purpose:
- record the latest structured gate judgment

Template:

```md
# Convergence Report

- Report ID: cr_001
- Result: fail
- Confirmed By Human: false
- Generated At: 2026-04-14T00:00:00Z

## Checklist
- Project goal is singular: pass
- Primary flow is clear: pass
- Direction is approved: pass
- Scope is frozen: fail
- Boundary is frozen: fail
- Success / evidence is frozen: fail
- Workstreams are shaped: fail
- No blocking open question remains: fail
- Packet export would not mislead: fail

## Frozen Summary
- Direction: ...
- Scope: ...
- Boundary: ...
- Success / evidence: ...
- Workstreams: ...

## Blocking Questions
- q_010

## Carryable Risks
- ...

## Failed Conditions
- ...

## Fallback Stage
- scope_freeze

## Next Action
- ...
```

Notes:
- checklist entries must be explicit
- fail must always point to a concrete fallback stage

### `process/PACKET_EXPORT_STATUS.json`

Purpose:
- record export freshness and linkage to source decisions and convergence state

Template:

```json
{
  "latestExportId": null,
  "status": "not_ready",
  "exported": false,
  "exportedAt": null,
  "requiresRefresh": false,
  "refreshReason": null,
  "sourceConvergenceReportId": null,
  "sourceDecisionIds": [],
  "packetFiles": [
    "PROJECT_BRIEF.md",
    "MVP_SCOPE.md",
    "NON_GOALS.md",
    "SUCCESS_CRITERIA.md",
    "ARCHITECTURE_BOUNDARY.md",
    "INITIAL_WORKSTREAMS.md",
    "RISKS_AND_ASSUMPTIONS.md",
    "NEW_CHAT_HANDOFF_PROMPT.md"
  ],
  "supersededByExportId": null
}
```

## Packet-Side Templates

The canonical packet always consists of the same eight files.

Current on-disk packet-side templates already live under:

`docs/project-preparation/templates/`

Those files should align with the shapes defined below.

### `packet/PROJECT_BRIEF.md`

```md
# Project Brief

## One-Sentence Definition
...

## Primary Actor
...

## Core Problem
...

## Primary Flow
...

## Why This Matters Now
...
```

### `packet/MVP_SCOPE.md`

```md
# MVP Scope

## Core Deliverable
...

## In Scope
- ...

## Scope Notes
...

## Why This Scope Is Enough
...
```

### `packet/NON_GOALS.md`

```md
# Non-Goals

## Explicitly Out of Scope
- ...

## Not Now
- ...

## Why These Are Deferred
...
```

### `packet/SUCCESS_CRITERIA.md`

```md
# Success Criteria

## Success Definition
...

## Required Evidence
- ...

## Failure Conditions
- ...

## Notes
...
```

### `packet/ARCHITECTURE_BOUNDARY.md`

```md
# Architecture Boundary

## Allowed Surfaces
- ...

## Protected Surfaces
- ...

## Danger Zones
- ...

## Boundary Rationale
...
```

### `packet/INITIAL_WORKSTREAMS.md`

```md
# Initial Workstreams

## Workstream 1
- Goal:
- Boundary:
- Dependencies:
- Why It Exists:

## Workstream 2
- Goal:
- Boundary:
- Dependencies:
- Why It Exists:
```

### `packet/RISKS_AND_ASSUMPTIONS.md`

```md
# Risks And Assumptions

## Risks
- ...

## Assumptions
- ...

## Non-Blocking Unknowns
- ...
```

### `packet/NEW_CHAT_HANDOFF_PROMPT.md`

```md
# New Chat Handoff Prompt

You are working in `<repo-path>`.

## Current State
- ...

## Frozen Content
- ...

## Not Frozen
- ...

## Next Objective
- ...

## Do Not Reopen
- ...

## Priority Read Files
- ...

## Constraints
- ...
```

## Current vs Historical Views

- `packet/` holds the current canonical packet
- `exports/` holds historical packet snapshots
- `packet/NEW_CHAT_HANDOFF_PROMPT.md` holds the current handoff entry point
- `handoffs/` holds historical handoff snapshots

## Notes for Future Scaffolding

Current on-disk packet templates exist today.

Process-side ledgers may initially be created manually or by partial tooling, but future scaffolding should materialize the same process-side file shapes defined here instead of inventing a different format.
