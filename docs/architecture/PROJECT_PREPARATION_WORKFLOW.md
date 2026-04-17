# Project Preparation Workflow

This document is the authoritative specification for project preparation in this repository.

Preparation is a process-first, packet-export-second workflow. It exists to help a human and an AI converge a vague project idea into a bounded, reviewable, downstream-consumable definition. The canonical packet is the exported frozen outcome of that workflow. It is not the workflow itself.

This document defines workflow semantics. It intentionally does not define full file templates, CLI syntax, or operator step-by-step procedure.

Supporting documents:
- [PROJECT_PREPARATION_TEMPLATES.md](/home/administrator/code/review-then-codex-system/docs/architecture/PROJECT_PREPARATION_TEMPLATES.md)
- [PROJECT_PREPARATION_CLI.md](/home/administrator/code/review-then-codex-system/docs/architecture/PROJECT_PREPARATION_CLI.md)
- [PROJECT_PREPARATION_SOP.md](/home/administrator/code/review-then-codex-system/docs/architecture/PROJECT_PREPARATION_SOP.md)
- [PROJECT_PREPARATION_HARNESS.md](/home/administrator/code/review-then-codex-system/docs/architecture/PROJECT_PREPARATION_HARNESS.md)
- [PROJECT_PREPARATION_EXAMPLE.md](/home/administrator/code/review-then-codex-system/docs/architecture/PROJECT_PREPARATION_EXAMPLE.md)

## 1. Purpose and Positioning

### What Preparation Is

Preparation is a bounded convergence workflow that sits between a raw project idea and downstream planning.

Preparation must:
- treat requirement convergence as an explicit human-plus-AI process
- separate frozen conclusions from unresolved discussion
- produce a canonical packet only after convergence is good enough
- hand off into downstream planning rather than bypass it

### What Preparation Is Not

Preparation must not be treated as:
- a packet-filling exercise whose primary goal is to produce Markdown files
- a replacement for requirement freeze, architecture freeze, or task-graph planning
- an execution runtime
- a hidden-chat-memory workflow that only makes sense if the original thread is still open

### Where Preparation Sits in the Delivery Lifecycle

The intended lifecycle is:

`idea -> preparation -> requirement freeze -> architecture freeze -> task graph -> execution/review/rework -> release review -> run acceptance`

Preparation must remain upstream from the run system. It should narrow and freeze project intent, not replace runtime planning and execution.

### Entry and Exit

Preparation enters when a human has a plausible project or initiative worth converging. Preparation exits when:
- convergence gate has passed
- canonical packet has been formally exported
- a downstream handoff has been generated

## 2. Core Principles

### Human in the Loop

Mandatory checkpoints must remain human-approved. AI may propose and organize frozen content, but human approval remains the authority for critical decisions.

### Process First

Preparation must be treated as a convergence workflow first and an artifact-export pipeline second.

### Frozen vs Unresolved Separation

Unresolved blocking questions must not appear in canonical packet as frozen conclusions. Exploratory tradeoffs, open questions, and unapproved decisions must remain on the process side.

### Auditability

Preparation history must remain auditable across rollback, refresh, export, and handoff. Rollback must preserve history rather than erase it.

### Bounded Progression

Preparation should progress only when stage stop conditions are satisfied. It should converge to a bounded handoff, not expand indefinitely.

### No Hidden Chat-Memory Dependency

A fresh chat must be able to continue from packet plus handoff without relying on hidden prior context.

## 3. Workflow Overview

The preparation workflow proceeds through this stage sequence unless an explicit rollback occurs:

`intake -> clarification -> brainstorm -> direction decision -> scope freeze -> boundary freeze -> success/evidence freeze -> workstream shaping -> convergence gate -> packet export -> handoff`

### Stage Quick Definitions

- `intake`: confirm the idea is a valid preparation candidate
- `clarification`: clarify known facts, actors, flows, and constraints
- `brainstorm`: pressure-test priorities, boundaries, and tradeoffs through questions
- `direction decision`: formally choose the project direction
- `scope freeze`: define MVP in-scope and out-of-scope
- `boundary freeze`: define allowed, protected, and dangerous surfaces
- `success/evidence freeze`: define success and required evidence
- `workstream shaping`: shape medium-grained workstreams for downstream planning
- `convergence gate`: decide whether the project is safe to freeze
- `packet export`: publish frozen outcomes as canonical packet
- `handoff`: produce a downstream entry point bound to the export

Packet export must not occur before convergence gate pass and packet export approval.

## 4. Stage Boundary Model

### Clarification vs Brainstorm

`clarification` must focus on facts, actors, flows, current reality, constraints, and known unknowns.

`brainstorm` must focus on pressure questions and tradeoff convergence. It should force the human to think through:
- what must be kept
- what can be dropped
- what is explicitly not now
- which boundaries must be drawn early
- which outcomes would still count as failure

Brainstorm must not default to option enumeration as its primary mode.

### Brainstorm vs Direction Decision

`brainstorm` is an exploratory convergence stage. Its purpose is to pressure-test priorities and shape the project through questions.

`direction decision` is a formalization stage. Its purpose is to take the shape produced by clarification plus brainstorm and turn it into an approved direction.

`direction decision` must not continue open-ended exploration.

### Freeze Stages vs Workstream Shaping

`scope freeze`, `boundary freeze`, and `success/evidence freeze` each freeze a different dimension of the project:
- what the MVP includes and excludes
- what surfaces may be touched
- what success means and what evidence will support it

`workstream shaping` must remain above execution-grade task decomposition. It is not a substitute for task-graph planning.

### Gate, Export, and Handoff Boundaries

`convergence gate` is not a design stage. It judges whether the current preparation state is sufficiently converged to freeze.

`packet export` is not a discussion stage. It publishes approved frozen outcomes.

`handoff` is not a history dump. It is the export-bound downstream entry point.

### Brainstorm Working Surface

`TRADEOFF_LEDGER` must be treated as the primary brainstorm surface.

`OPTION_SET` may be used when materially distinct directions exist, but it remains optional and secondary.

## 5. Human and AI Responsibilities

### Global Responsibility Split

AI must primarily:
- ask clarifying and pressure questions
- synthesize evolving understanding
- expose contradictions and scope creep
- propose bounded frozen content
- maintain process-side ledgers

Human must primarily:
- provide real constraints and context
- correct AI misunderstandings
- make key tradeoffs
- approve or reject checkpoints
- decide whether the workflow should progress, pause, or roll back

### Stage-Specific Responsibility Pattern

Across stages, AI should:
- clarify in `clarification`
- pressure-test in `brainstorm`
- propose decisions in freeze stages
- evaluate structured readiness in `convergence gate`
- prepare publication proposals in `packet export` and `handoff`

Across stages, human should:
- answer high-leverage questions
- choose among tradeoffs
- freeze direction, scope, boundary, and success criteria
- approve or reject convergence and export readiness

### Non-Delegable Human Decisions

Human approval authority must remain with:
- direction selection
- MVP scope freeze
- architecture boundary freeze
- success/evidence freeze
- convergence gate result
- packet export

AI must not silently convert unresolved discussion into approved frozen content.

## 6. Mandatory Human Checkpoints

### Required Checkpoint Types

The mandatory freeze checkpoints are:
- `direction decision`
- `scope freeze`
- `boundary freeze`
- `success / evidence freeze`
- `convergence gate`
- `packet export`

Handoff is a reviewable publication step, but it is not one of the six mandatory freeze checkpoints above.

### Allowed Human Responses

The allowed response types are:
- `approve`
- `approve with correction`
- `reject`

`approve with correction` means the proposal is acceptable only after the explicitly recorded correction has been incorporated into the frozen result.

### Checkpoint Effects

A stage requiring checkpoint approval must not be treated as completed before that checkpoint is resolved.

Approved decisions must remain traceable to the checkpoint that authorized them.

Checkpoint rejection must record:
- a reason
- what remains wrong or unresolved
- a rollback target stage

### Checkpoint Invalidations

An approved checkpoint may become `expired` or `superseded` when upstream frozen outcomes materially change. Invalidated checkpoints must not continue to authorize current frozen state.

## 7. Stop Conditions and Rollback Rules

### Stop Condition Principle

A stage must not advance until its stop condition is satisfied. Stop conditions are defined per stage and restated in the stage protocol section.

### Rollback Principles

Rollback must:
- preserve audit history rather than delete prior state
- target the earliest stage that actually needs reconsideration
- invalidate downstream readiness where applicable

Rollback should not indiscriminately reset the whole workflow.

### Typical Rollback Mappings

- unclear actor, flow, or core problem -> `clarification`
- insufficiently surfaced tradeoffs or boundaries -> `brainstorm`
- unstable project direction -> `direction decision`
- unstable MVP inclusion or exclusion -> `scope freeze`
- unstable allowed or protected surfaces -> `boundary freeze`
- unstable success definition or evidence set -> `success / evidence freeze`
- unusable workstream granularity -> `workstream shaping`
- failed freeze readiness -> `convergence gate` fallback to the most relevant earlier stage
- export proposal mismatch -> `packet export` or the earlier freeze stage that produced the mismatch

### Rollback History Preservation

Rollback must supersede, expire, or mark stale prior workflow objects rather than erase them.

Blocking questions reopened after freeze may invalidate downstream readiness and trigger rollback.

## 8. Process Ledgers

### Ledger Inventory

The process side consists of these formal ledgers:
- `PREPARATION_STATE`
- `OPEN_QUESTIONS`
- `TRADEOFF_LEDGER`
- `OPTION_SET`
- `DECISION_LOG`
- `CHECKPOINTS`
- `CONVERGENCE_REPORT`
- `PACKET_EXPORT_STATUS`

Stage-specific notes may exist under stage-note surfaces, but they are supporting notes rather than primary ledgers.

### Core vs Secondary Ledgers

Core ledgers:
- `PREPARATION_STATE`
- `OPEN_QUESTIONS`
- `TRADEOFF_LEDGER`
- `DECISION_LOG`
- `CHECKPOINTS`
- `CONVERGENCE_REPORT`
- `PACKET_EXPORT_STATUS`

Secondary ledgers:
- `OPTION_SET`
- optional stage notes

`TRADEOFF_LEDGER` must be treated as the primary brainstorm surface.

`OPTION_SET` may be used when materially distinct directions exist, but it must remain secondary to tradeoff convergence.

### Ledger Responsibilities

- `PREPARATION_STATE`: current workflow state, stage status, and top-level readiness
- `OPEN_QUESTIONS`: unresolved, deferred, and resolved questions
- `TRADEOFF_LEDGER`: pressure questions and convergence tradeoffs
- `OPTION_SET`: bounded alternative directions when they materially exist
- `DECISION_LOG`: proposed, approved, rejected, and superseded decisions
- `CHECKPOINTS`: human review actions and outcomes
- `CONVERGENCE_REPORT`: pass/fail readiness judgment and fallback
- `PACKET_EXPORT_STATUS`: export freshness and source-of-truth linkage

### Ledger vs Packet Separation

Process ledgers must record convergence process state rather than replace canonical packet outputs.

Process-side unresolved or exploratory content must not be promoted into packet-side frozen conclusions without checkpoint approval.

## 9. Object Model

### Core Objects

- `Preparation`: the top-level container for one preparation workflow
- `Stage`: one stage instance within that workflow
- `Question`: an unresolved, deferred, or resolved question
- `Tradeoff`: a brainstorm pressure surface that captures must-keep, can-drop, and not-now pressure
- `Option`: a materially distinct direction when option comparison is actually needed
- `Decision`: a proposed or approved frozen conclusion
- `Checkpoint`: a formal human review event tied to one or more decisions
- `ConvergenceReport`: a structured readiness judgment
- `PacketExport`: one formal export version of canonical packet
- `Handoff`: one formal downstream entry point bound to an export

### Object Relationship Rules

- every preparation owns multiple stages and may own multiple questions, tradeoffs, options, decisions, checkpoints, convergence reports, exports, and handoffs
- every approved frozen outcome must remain traceable to a decision and its authorizing checkpoint
- questions may drive tradeoffs and decisions
- options may support direction choice, but they do not replace tradeoffs
- convergence reports gate exports
- packet exports gate formal handoffs

### Object Semantics

Tradeoff must be treated as a first-class object in brainstorm, not collapsed into option enumeration.

PacketExport and Handoff must remain distinct objects with separate lifecycles.

Question, Tradeoff, Decision, and Checkpoint must remain auditable across rollback and refresh.

## 10. State Transitions and Freshness

### Preparation State

Preparation may move across:
- `active`
- `paused`
- `blocked`
- `converged`
- `exported`
- `superseded`
- `archived`

### Stage State

Stages may move across:
- `not_started`
- `in_progress`
- `human_review_required`
- `completed`
- `rolled_back`
- `blocked`
- `skipped`

### Supporting Object States

- `Question`: `open`, `deferred`, `resolved`, `superseded`
- `Tradeoff`: `open`, `discussed`, `converged`, `superseded`
- `Option`: `active`, `selected`, `rejected`, `superseded`
- `Decision`: `proposed`, `approved`, `rejected`, `superseded`
- `Checkpoint`: `open`, `pending_human`, `approved`, `rejected`, `superseded`, `expired`
- `ConvergenceReport`: `pass`, `fail`
- `PacketExport`: `not_ready`, `ready`, `exported`, `stale`, `superseded`
- `Handoff`: `generated`, `stale`, `superseded`, `consumed`

### Freshness Semantics

- `stale`: no longer current, but not yet formally replaced
- `superseded`: formally replaced by a newer version
- `expired`: no longer valid because upstream authorization changed
- `consumed`: formally used by downstream work

### Cross-Object Invalidation

Frozen outcome changes must invalidate downstream readiness, export freshness, and handoff freshness where applicable.

Examples of invalidating changes include:
- selected direction changes
- scope changes
- boundary changes
- success/evidence changes
- workstream changes
- blocking questions reopen in a way that could alter frozen outcomes

A stale export must not be treated as current canonical packet.

A handoff bound to a stale or superseded export must not be treated as current.

## 11. Directory Layout and Sources of Truth

### Preparation Root

Each preparation lives under:

`docs/project-preparation/<project-slug>/`

### Top-Level Layout

```text
docs/project-preparation/<project-slug>/
  README.md
  process/
  packet/
  exports/
  handoffs/
  history/
```

### Current Views

- `process/`: current workflow state and current process ledgers
- `packet/`: current canonical packet and current canonical handoff prompt

### Historical Views

- `exports/`: historical packet export snapshots
- `handoffs/`: historical handoff snapshots
- `history/`: timeline and event history

### Sources of Truth

Current process state must live under `process/`. Current frozen outputs must live under `packet/`.

Historical exports must not replace the current canonical packet view.

Historical handoffs must remain separate from the current handoff entry point.

Current and historical views must remain explicitly separated in the directory layout.

## 12. Stage Protocols

### Intake

**Goal**
- confirm the idea is a valid preparation candidate

**AI Responsibilities**
- restate the raw idea as a candidate project definition
- distinguish standalone preparation from a subtask, bug, or active-run follow-up

**Human Responsibilities**
- confirm whether this should enter preparation
- correct obvious misunderstanding

**Primary Outputs**
- candidate project statement
- initial open questions

**Stop Condition**
- one preparation-worthy project candidate is clearly identified

**Common Failure Modes**
- treating a small implementation task as a standalone project
- allowing several unrelated ideas to enter as one project

### Clarification

**Goal**
- clarify facts, actors, flows, current reality, and constraints

**AI Responsibilities**
- ask fact-finding questions about actors, flows, current pain, constraints, and known unknowns
- separate stable facts from unresolved questions

**Human Responsibilities**
- answer high-leverage factual questions
- correct bad assumptions and provide real constraints

**Primary Outputs**
- clarified facts
- updated open questions
- ready-for-brainstorm summary

**Stop Condition**
- actor, core problem, primary flow, and major constraints are clear enough to support tradeoff work

**Common Failure Modes**
- sliding into solution selection too early
- keeping multiple competing primary flows unresolved

### Brainstorm

**Goal**
- force boundaries, priorities, non-goals, and key tradeoffs into the open

**AI Responsibilities**
- ask pressure questions that force must-keep, can-drop, and not-now decisions
- capture tradeoffs in `TRADEOFF_LEDGER`
- use `OPTION_SET` only when materially distinct directions genuinely exist

**Human Responsibilities**
- make real tradeoff calls
- distinguish must-haves from nice-to-haves
- state what should not be done now

**Primary Outputs**
- tradeoff ledger
- candidate decisions
- prioritized must-keep, can-drop, and not-now positions

**Stop Condition**
- the project shape is constrained enough to support formal direction choice and downstream freeze stages

**Common Failure Modes**
- turning brainstorm into a feature wishlist
- defaulting to option menus instead of pressure questions
- slipping into architecture design prematurely

### Direction Decision

**Goal**
- formally choose the project direction

**AI Responsibilities**
- propose the direction that best reflects clarification plus brainstorm
- document what is being chosen and what is not being chosen

**Human Responsibilities**
- approve, correct, or reject the proposed direction

**Primary Outputs**
- selected direction
- approved or rejected direction decision

**Stop Condition**
- one direction is explicitly approved by human

**Common Failure Modes**
- pretending a direction is frozen when it is still tentative
- using direction decision to continue open-ended exploration

### Scope Freeze

**Goal**
- define MVP in-scope and out-of-scope

**AI Responsibilities**
- propose the narrowest viable scope
- surface scope creep explicitly

**Human Responsibilities**
- approve what the first version will and will not include

**Primary Outputs**
- in-scope set
- out-of-scope set
- scope decision

**Stop Condition**
- MVP inclusion and exclusion boundaries are explicit and stable enough to proceed

**Common Failure Modes**
- including long-term aspirations in MVP
- leaving out-of-scope implicit

### Boundary Freeze

**Goal**
- define allowed, protected, and dangerous surfaces

**AI Responsibilities**
- propose what may be touched, what should remain protected, and what areas are dangerous

**Human Responsibilities**
- confirm that the boundary reflects real technical and organizational constraints

**Primary Outputs**
- boundary definition
- boundary decision

**Stop Condition**
- allowed and protected surfaces are explicit enough to constrain downstream planning

**Common Failure Modes**
- allowing vague “maybe later” areas to remain in current boundary
- failing to identify danger zones

### Success / Evidence Freeze

**Goal**
- define what success means and what evidence later review should expect

**AI Responsibilities**
- propose concrete success criteria and required evidence classes
- define what would still count as failure

**Human Responsibilities**
- approve whether those criteria truly represent “done”

**Primary Outputs**
- success criteria
- failure conditions
- required evidence set

**Stop Condition**
- downstream review and acceptance would have concrete evidence expectations

**Common Failure Modes**
- relying on “looks done” instead of concrete success
- specifying evidence that is too weak or too vague

### Workstream Shaping

**Goal**
- shape medium-grained workstreams for downstream planning

**AI Responsibilities**
- propose coherent workstreams with goals, boundaries, and dependencies
- avoid execution-grade pseudo-tasking

**Human Responsibilities**
- reject workstreams that are too broad or too microscopic

**Primary Outputs**
- initial workstreams

**Stop Condition**
- workstreams are detailed enough to guide downstream planning but not detailed enough to replace it

**Common Failure Modes**
- creating slogan-level workstreams
- creating file-level task lists

### Convergence Gate

**Goal**
- determine whether the project is sufficiently converged to freeze

**AI Responsibilities**
- evaluate the gate checklist and recommend pass or fail
- identify blockers, carryable risks, fallback stage, and next action

**Human Responsibilities**
- accept or reject the gate judgment

**Primary Outputs**
- convergence report

**Stop Condition**
- human has accepted a gate pass or gate fail judgment

**Common Failure Modes**
- treating “good enough feeling” as structured readiness
- allowing blocking open questions to survive a pass

### Packet Export

**Goal**
- publish approved frozen outcomes as canonical packet

**AI Responsibilities**
- prepare an export proposal from approved frozen content
- distinguish what will be exported from what remains process-only

**Human Responsibilities**
- approve, correct, or reject the export proposal

**Primary Outputs**
- current canonical packet
- export snapshot
- updated export status

**Stop Condition**
- export has either been formally published or formally rejected

**Common Failure Modes**
- silently overwriting current packet
- exporting unresolved or unapproved content

### Handoff

**Goal**
- publish a downstream entry point bound to the current export

**AI Responsibilities**
- prepare a handoff that states the target phase, frozen summary, unresolved non-blocking items, next objective, and guardrails

**Human Responsibilities**
- approve, correct, or reject the handoff

**Primary Outputs**
- current handoff prompt
- historical handoff snapshot

**Stop Condition**
- handoff has been formally published or formally rejected

**Common Failure Modes**
- writing a history summary instead of an actionable handoff
- omitting “do not reopen” boundaries

## 13. Checkpoint Protocol

### Purpose

Checkpoint turns a proposed frozen result into a formal human-reviewed workflow action.

### When Checkpoints Are Required

A mandatory checkpoint must not be bypassed by stage progression.

Mandatory checkpoints apply to the six freeze points defined in Section 6.

### AI Submission Requirements

Checkpoint submission must include:
- checkpoint type
- what is being decided
- proposed frozen content
- explicitly unresolved content
- why the proposal is ready for review
- rollback target if rejected

### Allowed Human Responses

- `approve`
- `approve with correction`
- `reject`

### State Effects

- unresolved checkpoint -> stage cannot complete
- approved checkpoint -> bound decisions may become approved
- rejected checkpoint -> bound stage must remain incomplete and record rollback target

### Invalidation and Revalidation

Checkpoint approval may become expired or superseded when upstream frozen outcomes change. Revalidation is required before current state may rely on that checkpoint again.

### Audit Requirements

Checkpoint records must capture:
- stage
- linked decisions
- human response
- response rationale
- timestamp

## 14. Convergence Gate Protocol

### Purpose

Convergence gate decides whether preparation is sufficiently converged to freeze into packet. It judges readiness, not perfection.

### Prerequisites

Convergence gate should only run when the workflow has meaningfully completed:
- `direction decision`
- `scope freeze`
- `boundary freeze`
- `success / evidence freeze`
- `workstream shaping`

### Gate Checklist

The gate must check whether:
- the project goal is singular
- the primary flow is clear
- the direction is approved
- scope is frozen
- boundary is frozen
- success/evidence is frozen
- workstreams are shaped at the right granularity
- no blocking open question remains that could change frozen outcomes
- packet export would not mislead a fresh downstream consumer

### AI Gate Submission Requirements

Gate submission must include:
- `pass` or `fail` recommendation
- checklist evaluation
- frozen summary
- blocking questions
- carryable risks
- fallback stage
- next action

### Allowed Human Responses

- `approve pass`
- `approve fail`
- `reject gate judgment`

### Pass Effects

When pass is approved:
- preparation may move to `converged`
- readiness for packet export becomes true
- export may be proposed

Gate pass does not mean export has already occurred.

### Fail Effects and Fallback

Gate failure must identify concrete failed conditions, blockers, and one fallback stage.

Gate failure must not reset the workflow indiscriminately.

### Gate Revalidation Rules

A prior gate pass must be invalidated when frozen outcomes materially change.

## 15. Packet Export Protocol

### Purpose

Packet export is a reviewed publication action that turns approved frozen outcomes into the current canonical packet.

### Export Preconditions

Canonical packet must be published only from:
- approved frozen outcomes
- a valid gate pass
- approved packet export review

### AI Export Proposal Requirements

Export proposal must include:
- source convergence report
- source decisions
- frozen summary
- packet file plan
- explicitly non-exported process-side content
- delta from previous export when applicable
- carried risks
- rollback target if rejected

### Allowed Human Responses

- `approve`
- `approve with correction`
- `reject`

### Publish Effects

Approved export must:
- publish current canonical packet under `packet/`
- create a new snapshot under `exports/`
- update export status
- update preparation state
- update audit history
- trigger handoff refresh or mark current handoff stale

### Refresh and Supersession

A refresh export must create a new export version rather than silently overwrite historical state.

When a newer export formally replaces an older export:
- older export becomes `superseded`
- current packet view reflects only the newest export

### Invalid and Forbidden Cases

Packet export must not:
- publish unresolved blocking content as frozen fact
- bypass review
- treat stale export as current
- silently overwrite history

## 16. Handoff Protocol

### Purpose

Handoff is the export-bound downstream entry point for a fresh chat or fresh run.

### Handoff Preconditions

A formal handoff must be bound to a specific packet export.

Formal handoff should not be published from a stale or superseded export.

### AI Handoff Proposal Requirements

Handoff proposal must include:
- target phase
- source export
- frozen summary
- unresolved but non-blocking items
- next objective
- do-not-reopen boundaries
- priority read files
- constraints and guardrails

### Allowed Human Responses

- `approve`
- `approve with correction`
- `reject`

### Publish Effects

Approved handoff must:
- update the current handoff prompt under `packet/`
- create a historical handoff snapshot
- update preparation state
- update audit history

### Freshness and Consumption

- `stale`: no longer current enough to trust
- `superseded`: formally replaced by a newer handoff
- `consumed`: formally used by downstream work

Consumption of a handoff must remain auditable.

### Invalid and Forbidden Cases

Handoff must not:
- masquerade as process history
- omit next objective or guardrails
- be treated as current when stale or superseded

## 17. Relationship to Canonical Packet

### Process Side vs Packet Side

Process side records how convergence happened.

Packet side records frozen downstream-consumable outcomes.

### What Canonical Packet Must Contain

Canonical packet consists of these eight files:
- `PROJECT_BRIEF.md`
- `MVP_SCOPE.md`
- `NON_GOALS.md`
- `SUCCESS_CRITERIA.md`
- `ARCHITECTURE_BOUNDARY.md`
- `INITIAL_WORKSTREAMS.md`
- `RISKS_AND_ASSUMPTIONS.md`
- `NEW_CHAT_HANDOFF_PROMPT.md`

Canonical packet must contain only frozen downstream-consumable outcomes.

### What Canonical Packet Must Never Contain

Process-side unresolved or exploratory content must remain outside canonical packet, including:
- blocking open questions
- brainstorm raw discussion
- raw tradeoff notes
- unapproved decisions
- process-only commentary

### Current Packet vs Historical Exports

The current packet view must remain distinct from historical exports.

- `packet/` is the current canonical view
- `exports/` are historical packet versions

### Handoff as Export-Bound Entry Point

Handoff must serve as the export-bound downstream entry point rather than as a process history dump.

## Appendix A: Stage List Quick Reference

- `intake`
- `clarification`
- `brainstorm`
- `direction decision`
- `scope freeze`
- `boundary freeze`
- `success / evidence freeze`
- `workstream shaping`
- `convergence gate`
- `packet export`
- `handoff`

## Appendix B: Required Artifacts Quick Reference

### Process Side

- `PREPARATION_STATE`
- `OPEN_QUESTIONS`
- `TRADEOFF_LEDGER`
- `OPTION_SET`
- `DECISION_LOG`
- `CHECKPOINTS`
- `CONVERGENCE_REPORT`
- `PACKET_EXPORT_STATUS`

### Packet Side

- `PROJECT_BRIEF.md`
- `MVP_SCOPE.md`
- `NON_GOALS.md`
- `SUCCESS_CRITERIA.md`
- `ARCHITECTURE_BOUNDARY.md`
- `INITIAL_WORKSTREAMS.md`
- `RISKS_AND_ASSUMPTIONS.md`
- `NEW_CHAT_HANDOFF_PROMPT.md`
