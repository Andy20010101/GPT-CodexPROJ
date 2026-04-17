# Project Preparation Trial Runbook

This runbook defines how to run the first real preparation trial against a new project idea without
reusing legacy preparation directories.

It is intentionally bounded:
- one new project slug
- one preparation workflow
- one canonical packet export
- one downstream handoff

Use this together with:
- [PROJECT_PREPARATION_WORKFLOW.md](/home/administrator/code/review-then-codex-system/docs/architecture/PROJECT_PREPARATION_WORKFLOW.md)
- [PROJECT_PREPARATION_CLI.md](/home/administrator/code/review-then-codex-system/docs/architecture/PROJECT_PREPARATION_CLI.md)
- [PROJECT_PREPARATION_SOP.md](/home/administrator/code/review-then-codex-system/docs/architecture/PROJECT_PREPARATION_SOP.md)
- [PROJECT_PREPARATION_NEW_TRIAL_PROMPT.md](/home/administrator/code/review-then-codex-system/docs/architecture/PROJECT_PREPARATION_NEW_TRIAL_PROMPT.md)

## Trial Goal

The first real trial is successful if it proves this complete bounded path on a new project:

`idea -> preparation workspace -> clarification -> brainstorm -> freeze checkpoints -> convergence pass -> packet export -> handoff`

This runbook does not include downstream execution. It stops when a real exported packet and handoff
exist for the new project.

## Trial Candidate Rules

Choose a project idea that is:
- a real new project or initiative
- small enough to freeze in one preparation pass
- large enough to need actual clarification and tradeoff work
- not already living inside an active run

Do not choose:
- a bugfix
- the next task in an existing run
- a project that already has a legacy preparation directory you intend to reuse
- something so large that the first preparation would obviously fail to converge

## Trial Setup

Pick a fresh slug:

```bash
node --import tsx scripts/project-preparation.ts init --slug <project-slug>
```

Immediately confirm the workspace shape:

```bash
node --import tsx scripts/project-preparation.ts status --slug <project-slug>
node --import tsx scripts/project-preparation.ts check --slug <project-slug>
```

Expected early state:
- layout is canonical
- readiness is still `needs_refinement`
- packet and process scaffolds exist

## Trial Operating Sequence

### 1. Start the preparation conversation

Use the new-chat prompt in:
- [PROJECT_PREPARATION_NEW_TRIAL_PROMPT.md](/home/administrator/code/review-then-codex-system/docs/architecture/PROJECT_PREPARATION_NEW_TRIAL_PROMPT.md)

The first conversation goal is not export. It is to establish:
- whether this is a valid standalone preparation
- the primary actor
- the primary flow
- the first blocking open questions

### 2. Record clarification state

As clarification progresses, update the process side through the CLI:

```bash
node --import tsx scripts/project-preparation.ts question add --slug <project-slug> --stage clarification --question "<question>" --category user --impact blocking --owner human --note "<why it matters>"
node --import tsx scripts/project-preparation.ts question resolve --slug <project-slug> --id q_001 --note "<resolution>"
```

Move stage state explicitly when needed:

```bash
node --import tsx scripts/project-preparation.ts advance --slug <project-slug> --stage intake --status completed --note "<why intake is done>"
node --import tsx scripts/project-preparation.ts advance --slug <project-slug> --stage clarification --status in_progress --note "<what is being clarified>"
```

### 3. Pressure-test the shape in brainstorm

Record brainstorm output as tradeoffs first, not option menus by default:

```bash
node --import tsx scripts/project-preparation.ts tradeoff add --slug <project-slug> --title "<tradeoff-title>" --stage brainstorm --pressure-question "<pressure question>" --must-keep "<a,b>" --can-drop "<a,b>" --not-now "<a,b>"
node --import tsx scripts/project-preparation.ts tradeoff converge --slug <project-slug> --id t_001 --note "<converged result>"
```

Only use `option *` if materially distinct directions exist:

```bash
node --import tsx scripts/project-preparation.ts option add --slug <project-slug> --title "<option>" --stage brainstorm --summary "<summary>"
node --import tsx scripts/project-preparation.ts option select --slug <project-slug> --id o_001 --note "<why selected>"
```

### 4. Freeze the project through formal checkpoints

For each freeze stage:
- propose one or more decisions
- open the matching checkpoint
- approve or reject it explicitly

Example pattern:

```bash
node --import tsx scripts/project-preparation.ts decision propose --slug <project-slug> --stage direction_decision --title "<decision-title>" --decision-lines "<a,b>" --rationale-lines "<a,b>" --packet-files "PROJECT_BRIEF.md"
node --import tsx scripts/project-preparation.ts checkpoint open --slug <project-slug> --stage direction_decision --type direction --summary "<what is being frozen>" --decisions d_001
node --import tsx scripts/project-preparation.ts checkpoint approve --slug <project-slug> --id c_001 --note "<approval note>"
node --import tsx scripts/project-preparation.ts decision approve --slug <project-slug> --id d_001 --checkpoint-id c_001
```

Repeat this pattern for:
- `direction_decision`
- `scope_freeze`
- `boundary_freeze`
- `success_evidence_freeze`

When workstreams are ready:

```bash
node --import tsx scripts/project-preparation.ts advance --slug <project-slug> --stage workstream_shaping --status completed --note "<why workstreams are ready>"
```

### 5. Run convergence

```bash
node --import tsx scripts/project-preparation.ts check convergence --slug <project-slug>
```

If the gate fails:
- do not force export
- use the fallback stage from `CONVERGENCE_REPORT.md`
- resolve blockers
- rerun convergence

If the gate passes:
- open and approve the convergence checkpoint
- then open and approve the packet export checkpoint

### 6. Publish the canonical packet

```bash
node --import tsx scripts/project-preparation.ts export packet --slug <project-slug> --note "<why this export is valid>"
node --import tsx scripts/project-preparation.ts packet status --slug <project-slug>
```

Success means:
- `packet/` is current
- `exports/export-001/` exists
- `PACKET_EXPORT_STATUS.json` points at the new export

### 7. Publish and consume the handoff

```bash
node --import tsx scripts/project-preparation.ts handoff --slug <project-slug>
node --import tsx scripts/project-preparation.ts handoff show --slug <project-slug>
```

When the handoff is actually used by the downstream planning thread:

```bash
node --import tsx scripts/project-preparation.ts handoff consume --slug <project-slug> --note "consumed by downstream planning"
```

## Trial Validation Checklist

The first real preparation trial should end with all of these true:
- `status` shows a canonical layout
- `check` passes
- `audit summary` shows the latest convergence report, export, and handoff
- `packet/NEW_CHAT_HANDOFF_PROMPT.md` exists
- `exports/export-001/` exists
- `handoffs/handoff-001.md` and `handoffs/handoff-001.json` exist
- timeline/history clearly show the freeze, export, and handoff events

Recommended verification:

```bash
node --import tsx scripts/project-preparation.ts status --slug <project-slug>
node --import tsx scripts/project-preparation.ts check --slug <project-slug>
node --import tsx scripts/project-preparation.ts audit summary --slug <project-slug>
node --import tsx scripts/project-preparation.ts history --slug <project-slug>
```

## Failure Handling During The Trial

If the trial stalls:
- use `audit blockers`
- inspect `OPEN_QUESTIONS.md`
- inspect `CHECKPOINTS.md`
- inspect `CONVERGENCE_REPORT.md`
- move back to the concrete fallback stage instead of forcing the next freeze

If packet content changes after export:

```bash
node --import tsx scripts/project-preparation.ts packet refresh --slug <project-slug> --note "<refresh reason>"
node --import tsx scripts/project-preparation.ts handoff refresh --slug <project-slug>
```

## What To Review After The Trial

After the first real trial, review only these three questions:
- which commands were still too manual or awkward
- which process ledgers were useful versus noisy
- whether the exported packet and handoff were enough for a fresh downstream thread

Do not immediately expand the workflow surface during review. First capture what the trial actually
proved and where the operator had to work around the tool.
