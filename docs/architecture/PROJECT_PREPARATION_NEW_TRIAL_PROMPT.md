# Project Preparation New Trial Prompt

Use this prompt to open a fresh thread for a new real preparation trial.

Replace:
- `<project-slug>`
- `<project-idea>`
- `<repo-path>`

before using it.

```text
You are working in `<repo-path>`.

This thread is only for a new project-preparation trial. Do not reuse legacy preparation directories
or legacy packet layouts.

First read and follow these documents:
- `<repo-path>/docs/architecture/PROJECT_PREPARATION_WORKFLOW.md`
- `<repo-path>/docs/architecture/PROJECT_PREPARATION_CLI.md`
- `<repo-path>/docs/architecture/PROJECT_PREPARATION_SOP.md`
- `<repo-path>/docs/architecture/PROJECT_PREPARATION_TRIAL_RUNBOOK.md`
- `<repo-path>/docs/architecture/PROJECT_PREPARATION_TEMPLATES.md`

The project slug for this trial is:
- `<project-slug>`

The initial project idea is:
- `<project-idea>`

Boundaries for this thread:
- stay inside preparation workflow only
- do not start downstream execution
- do not change orchestrator runtime semantics
- do not expand into gate semantics, acceptance rules, or task-graph core semantics

Your goals in this thread:
1. confirm whether this is a valid standalone preparation candidate
2. run clarification and brainstorm as a process-first workflow
3. record process-side state through the preparation CLI where appropriate
4. freeze direction, scope, boundary, and success/evidence through explicit checkpoints
5. reach convergence only if the trial is genuinely ready
6. export the canonical packet and generate the handoff only if the required approvals exist

Important workflow rules:
- clarification is for facts, actors, flows, and constraints
- brainstorm is for pressure questions, boundaries, and tradeoffs
- brainstorm is not a default option menu exercise
- TRADEOFF_LEDGER is the primary brainstorm surface
- unresolved blocking questions must not be smuggled into packet-side frozen content

Required operating style:
- keep the project bounded
- state explicitly what is frozen and what is not frozen
- if convergence fails, use the fallback stage instead of forcing export
- if a checkpoint should be opened, explain why it is ready
- if the project is not ready to freeze, stop and say so clearly

Concrete output expected from this thread:
- one canonical preparation workspace at `docs/project-preparation/<project-slug>/`
- process-side ledgers updated through the current CLI
- packet-side files updated only when content is genuinely frozen
- one convergence result
- if approved, one packet export and one handoff

Before doing substantial edits, inspect:
- `<repo-path>/scripts/project-preparation.ts`
- `<repo-path>/docs/project-preparation/templates/`

At the end, summarize:
- what the preparation trial proved
- what remains unresolved
- whether downstream planning can safely start from the exported packet and handoff
```
