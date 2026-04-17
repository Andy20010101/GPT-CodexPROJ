# Project Preparation Example

This document is an illustrative example of the preparation workflow.

It is intentionally synthetic. It demonstrates the workflow shape and artifact flow without freezing a mandatory real-project choice.

Read it together with:
- [PROJECT_PREPARATION_WORKFLOW.md](/home/administrator/code/review-then-codex-system/docs/architecture/PROJECT_PREPARATION_WORKFLOW.md)
- [PROJECT_PREPARATION_SOP.md](/home/administrator/code/review-then-codex-system/docs/architecture/PROJECT_PREPARATION_SOP.md)
- [PROJECT_PREPARATION_TEMPLATES.md](/home/administrator/code/review-then-codex-system/docs/architecture/PROJECT_PREPARATION_TEMPLATES.md)

## Example Project

- `project-slug`: `operator-run-digest`
- one-sentence idea:
  - create a small internal operator-facing summary surface that shows the current state of a run, the latest review status, and the most likely recovery action

The point of the example is not whether this exact project should be built. The point is to show how the workflow converges it.

## 1. Intake

Initial rough idea:
- “I want a way to quickly see whether a run is healthy and what to do next.”

Intake result:
- this is a standalone preparation candidate
- it is not just the next task inside an active run

Initial open questions:
- who is the primary operator
- is the first version read-only or interactive
- does the first version need to aggregate multiple runs

## 2. Clarification

Typical clarification questions:
- Who is the primary actor?
- What is the first usable outcome?
- What is the primary flow?
- What current pain are we removing?
- What constraints already exist?

Clarified facts:
- primary actor: local operator working from the repo and artifact root
- first usable outcome: one screen or one summary document that tells the operator current run state and likely next action
- primary flow: open current run summary, inspect blockers, choose resume/retry/manual action
- current pain: operator must inspect several artifact surfaces manually
- known constraints:
  - use existing artifact roots
  - do not rewrite orchestrator runtime semantics
  - do not assume distributed or multi-host support

Still-open questions:
- should the first version be a rendered file, a CLI summary, or both
- should manual-attention guidance be embedded or linked

## 3. Brainstorm

Pressure questions:
- If the first version can preserve only one core value, what must it preserve?
- If we cut 50 percent of the scope, what disappears first?
- What should explicitly not be done now?
- Which boundary, if not set now, would cause this project to sprawl?
- What would count as failure even if “something was shipped”?

Tradeoff results:

### Must Keep
- one clear operator-facing summary of current run state
- explicit next-action guidance
- use of existing authoritative artifact surfaces

### Can Drop
- polished multi-run navigation
- rich filtering
- historical analytics

### Not Now
- multi-host aggregation
- dashboard-grade UI
- automatic remediation

### Boundary Pressure
- do not change runtime task semantics
- do not invent new authoritative state outside current artifact roots without necessity
- keep the first version read-only

### Failure Pressure
- if the operator still has to manually inspect several places to know what to do next, the first version failed

Candidate decision pressure:
- direction is converging toward “read-only operator digest over existing authoritative artifacts”

## 4. Direction Decision

Direction proposal:
- first version will be a read-only operator digest that derives run state, review state, and likely recovery action from existing authoritative artifacts and APIs

Why this direction:
- preserves the core operator value
- avoids inventing a new runtime
- keeps the boundary tight

What this direction is not:
- not a full dashboard platform
- not a distributed control plane
- not a replacement for watcher, retry, or daemon APIs

Human checkpoint result:
- approved

## 5. Scope Freeze

In scope:
- summarize one current run
- show current terminal/non-terminal state
- show latest review/manual-attention state
- show likely next action such as resume, retry, or inspect handoff

Out of scope:
- editing runtime state directly
- multi-run fleet view
- historical trends
- automated recovery actions

Human checkpoint result:
- approved

## 6. Boundary Freeze

Allowed surfaces:
- current run artifacts
- existing watcher output
- existing retry/resume/manual-attention surfaces

Protected surfaces:
- task graph core semantics
- acceptance rules
- gate semantics
- worker execution semantics

Danger zones:
- adding a second authoritative state source
- making the digest interactive before the read-only path is stable

Human checkpoint result:
- approved

## 7. Success / Evidence Freeze

Success criteria:
- operator can determine current run state from one digest surface
- operator can identify the next likely recovery action without inspecting multiple raw artifacts
- digest reflects existing authoritative data rather than private inferred state

Required evidence:
- example digest over a real or recorded run
- verification that the digest only uses authoritative artifact sources
- operator-facing walkthrough of the primary flow

Failure conditions:
- digest contradicts canonical artifact state
- digest omits the next-action path
- digest introduces a new hidden state source

Human checkpoint result:
- approved

## 8. Workstream Shaping

Example workstreams:

### Workstream 1: Source Mapping
- goal: map authoritative sources for run state, review state, and recovery signals
- boundary: no new runtime semantics

### Workstream 2: Digest Shape
- goal: define the operator-facing summary structure
- boundary: read-only output only

### Workstream 3: Recovery Guidance
- goal: map artifact and API state into explicit next-action guidance
- boundary: no automated execution of recovery actions

### Workstream 4: Validation
- goal: verify the digest against a real or recorded run
- boundary: evidence only, not runtime modification

## 9. Convergence Gate

Checklist summary:
- singular goal: pass
- primary flow clear: pass
- direction approved: pass
- scope frozen: pass
- boundary frozen: pass
- success/evidence frozen: pass
- workstreams shaped: pass
- blocking open questions that could change frozen outcome: fail initially

Example blocker:
- whether the first version is CLI-only or also writes a file

Fallback:
- `brainstorm`

After resolving that the first version should generate a file plus optional CLI summary, the gate is rerun and passes.

## 10. Packet Export

Packet export freezes:
- project brief
- MVP scope
- non-goals
- success criteria
- architecture boundary
- initial workstreams
- risks and assumptions
- handoff prompt

What remains process-side:
- raw brainstorm discussion
- alternative future UI ideas
- superseded tradeoffs
- historical checkpoint notes

## 11. Handoff

Example next objective:
- continue into downstream planning for requirement freeze and architecture freeze of the read-only operator digest

Example do-not-reopen list:
- do not reopen multi-run dashboard ambitions
- do not reopen write-capable recovery actions
- do not expand into runtime semantic changes

Example priority read files:
- `packet/PROJECT_BRIEF.md`
- `packet/MVP_SCOPE.md`
- `packet/ARCHITECTURE_BOUNDARY.md`
- `packet/SUCCESS_CRITERIA.md`
- `packet/INITIAL_WORKSTREAMS.md`

## Why This Example Matters

This example shows the intended behavior:
- clarification asks for facts
- brainstorm pressures tradeoffs
- direction decision freezes the path
- freeze stages narrow the project
- convergence gate blocks premature export
- export produces packet
- handoff produces the downstream entry point

That is the pattern the preparation workflow should follow even when the actual project domain changes.
