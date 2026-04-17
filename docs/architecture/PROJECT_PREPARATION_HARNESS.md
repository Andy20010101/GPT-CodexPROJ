# Project Preparation Harness

This document explains the role of the preparation harness in the overall system.

It is a supporting document. The authoritative workflow rules live in:
- [PROJECT_PREPARATION_WORKFLOW.md](/home/administrator/code/GPT-CodexPROJ/docs/architecture/PROJECT_PREPARATION_WORKFLOW.md)

The operator runbook lives in:
- [PROJECT_PREPARATION_SOP.md](/home/administrator/code/GPT-CodexPROJ/docs/architecture/PROJECT_PREPARATION_SOP.md)

Template and command-surface definitions live in:
- [PROJECT_PREPARATION_TEMPLATES.md](/home/administrator/code/GPT-CodexPROJ/docs/architecture/PROJECT_PREPARATION_TEMPLATES.md)
- [PROJECT_PREPARATION_CLI.md](/home/administrator/code/GPT-CodexPROJ/docs/architecture/PROJECT_PREPARATION_CLI.md)

## Harness Purpose

The preparation harness exists to improve the quality of the input that reaches downstream planning and execution.

It should convert:
- a vague project idea
- a broad initiative
- an under-bounded external request

into:
- a converged preparation state
- a canonical exported packet
- a downstream handoff

It should not replace:
- requirement freeze
- architecture freeze
- task-graph planning
- runtime execution
- review or release review

## Harness Position in the System

The intended split is:

- preparation harness: project shaping and convergence
- downstream planning/runtime: bounded planning, execution, review, rework, and release review

In lifecycle form:

`idea -> preparation harness -> exported packet -> downstream planning -> runtime execution`

The harness is upstream infrastructure for project definition quality. It is not a second orchestrator.

## Harness Model

The harness should be understood as:
- process-first
- packet-export-second
- human-in-the-loop
- file-backed and auditable

That means:
- the workflow is primary
- packet is the frozen export of that workflow
- process-side ledgers capture how convergence happened
- packet-side files capture only frozen downstream-consumable results

## What the Harness Supports

The harness should support these surfaces:

### 1. Workflow Surface

Stages from:
- `intake`
through
- `handoff`

The harness should preserve stage order, rollback, and checkpoint discipline defined by the workflow spec.

### 2. Process-Ledger Surface

The harness should make these process-side ledgers maintainable:
- `PREPARATION_STATE`
- `OPEN_QUESTIONS`
- `TRADEOFF_LEDGER`
- `OPTION_SET`
- `DECISION_LOG`
- `CHECKPOINTS`
- `CONVERGENCE_REPORT`
- `PACKET_EXPORT_STATUS`

### 3. Packet Surface

The harness should maintain the canonical packet under:

`docs/project-preparation/<project-slug>/packet/`

using the standard eight packet files.

### 4. Export Surface

The harness should preserve:
- current canonical packet view
- historical export snapshots
- current canonical handoff
- historical handoff snapshots

### 5. Audit and Recovery Surface

The harness should support:
- pause and resume
- rollback with history preservation
- export freshness tracking
- handoff freshness and consumption tracking

## Current Repository State

The repository already contains:
- packet-side template files under `docs/project-preparation/templates/`
- preparation docs under `docs/architecture/`

The repository does not yet need the full harness automation to benefit from the model. The workflow can be operated manually in-repo as long as the same state surfaces and rules are respected.

## Why the Harness Stops Before Task-Graph Detail

The downstream system already owns:
- requirement freeze
- architecture freeze
- task-graph generation

So the preparation harness should stop at:
- frozen direction
- frozen scope
- frozen boundary
- frozen success/evidence expectations
- medium-grained workstreams
- canonical packet export
- downstream handoff

It should not compete with execution-grade planning.

## Relationship to Brainstorm

The harness should preserve the corrected brainstorm model:

- brainstorm is not primarily option enumeration
- brainstorm is primarily pressure-question-driven convergence
- `TRADEOFF_LEDGER` is the primary brainstorm surface
- `OPTION_SET` is optional and secondary

This is a harness concern because helper tooling must not reintroduce the wrong mental model through its UX.

## Relationship to Existing and Future Tooling

Current tooling may be partial.

Future tooling may materialize:
- process-side scaffolding
- workflow commands
- checkpoint commands
- convergence checks
- export and handoff publication helpers

Whatever tooling exists, it should implement the workflow semantics already frozen in the workflow spec rather than invent a narrower or conflicting preparation model.

## Recommended Evolution Path

The recommended order remains:

1. workflow spec
2. templates spec
3. CLI spec
4. SOP alignment
5. harness alignment
6. example flow
7. implementation and scaffolding

Do not start by coupling preparation automation directly into orchestrator internals.

## Short Summary

The preparation harness is the support layer that makes process-first preparation workable in practice.

It should:
- improve project input quality
- preserve convergence history
- publish clean packet exports
- publish clean downstream handoffs

It should not:
- replace downstream planning
- replace runtime execution
- become a second runtime of its own
