# Real Self-Improvement

## Goal

The first real self-improvement loop is intentionally narrow:

- Use the existing orchestrator, bridge, and watcher stack.
- Introduce an environment bootstrap module that can doctor, ensure, and persist the live environment state.
- Build a local analysis bundle and upload it as real ChatGPT attachments.
- Let ChatGPT produce structured planning and review outputs from those attachments.
- Keep the first autonomous change set low-risk and operator-auditable.

This is not "ChatGPT web and Codex sharing one live workspace." The orchestrator remains the control point that packages local evidence, sends it to the bridge, receives structured outputs, and drives local execution.

## Scope Guard

The first real loop must stay inside these boundaries unless an operator explicitly widens them:

- Preferred write scope: `docs/**`, `scripts/**`
- First recommended deliverable: [`docs/architecture/REAL_SELF_IMPROVEMENT.md`](/home/administrator/code/review-then-codex-system/docs/architecture/REAL_SELF_IMPROVEMENT.md)
- Allowed low-risk fallback: bridge/orchestrator reliability surfaces that only improve attachment flow, operator ergonomics, or recoverability

The first real loop must not change:

- gate semantics
- acceptance rules
- task graph core semantics

## Required Preflight

Before starting a real run:

1. Orchestrator API must be reachable on `http://127.0.0.1:3200/health`.
2. Bridge health must report `ready` on the live bridge endpoint.
3. The orchestrator process must be running with `CODEX_RUNNER_MODE=cli` so task execution is real, not stubbed.
4. ChatGPT must already be logged in on the attached browser session.

If any preflight fails, stop and fix the operator path first. Do not silently downgrade to prompt-only planning.

In the supported local self-improvement mode, do not rely on zero-argument defaults for bridge or browser discovery. `scripts/self-improvement-env.ts` can reuse the live orchestrator environment, but its generic fallback defaults are still broader than the currently supported operator path. Use the explicit endpoint commands from [`REAL_SELF_IMPROVEMENT_SOP.md`](/home/administrator/code/review-then-codex-system/docs/architecture/REAL_SELF_IMPROVEMENT_SOP.md) unless `--prepare-only` has already proved the live authoritative values you intend to reuse.

## Environment Bootstrap Module

Use [`scripts/self-improvement-env.ts`](/home/administrator/code/review-then-codex-system/scripts/self-improvement-env.ts) as the formal preflight layer.

It exposes two operator-facing modes:

- `doctor`
  - detect the live orchestrator, bridge, browser/CDP, ChatGPT login state, and artifact-root writeability
  - persist a structured env-state file without starting a run
- `ensure`
  - reuse the live stack when it is already healthy
  - attempt the minimum local recovery for bridge/orchestrator when they are down
  - stop watchers that are still writing outside the authoritative artifact root

The stable env-state path is:

`<authoritative-artifact-root>/runtime/self-improvement-env/env-state.json`

## Entry Script

Use:

```bash
node --import tsx scripts/self-improvement-env.ts doctor \
  --orchestrator-base-url http://127.0.0.1:3200 \
  --bridge-base-url http://127.0.0.1:3115 \
  --browser-endpoint http://172.18.144.1:9224 \
  --startup-url https://chatgpt.com/
node --import tsx scripts/self-improvement-env.ts ensure \
  --orchestrator-base-url http://127.0.0.1:3200 \
  --bridge-base-url http://127.0.0.1:3115 \
  --browser-endpoint http://172.18.144.1:9224 \
  --startup-url https://chatgpt.com/
CODEX_RUNNER_MODE=cli node --import tsx scripts/run-real-self-improvement.ts \
  --orchestrator-base-url http://127.0.0.1:3200 \
  --bridge-base-url http://127.0.0.1:3115 \
  --browser-endpoint http://172.18.144.1:9224 \
  --startup-url https://chatgpt.com/ \
  --planning-model ChatGPT
```

Before starting a new run, operators can validate the authoritative artifact root and env-state without creating any run artifacts:

```bash
node --import tsx scripts/run-real-self-improvement.ts \
  --orchestrator-base-url http://127.0.0.1:3200 \
  --bridge-base-url http://127.0.0.1:3115 \
  --browser-endpoint http://172.18.144.1:9224 \
  --startup-url https://chatgpt.com/ \
  --planning-model ChatGPT \
  --prepare-only
```

To resume the bounded entrypoint for an existing run, use the same explicit endpoint set plus `--run-id`:

```bash
CODEX_RUNNER_MODE=cli node --import tsx scripts/run-real-self-improvement.ts \
  --orchestrator-base-url http://127.0.0.1:3200 \
  --bridge-base-url http://127.0.0.1:3115 \
  --browser-endpoint http://172.18.144.1:9224 \
  --startup-url https://chatgpt.com/ \
  --planning-model ChatGPT \
  --run-id <run-id>
```

Only omit `--bridge-base-url` or `--browser-endpoint` when the live orchestrator already exports the correct values and `--prepare-only` has confirmed the same authoritative bridge/browser endpoints you expect to reuse.

To let one foreground process govern bounded between-run continuation as well, add the governor flags explicitly:

```bash
CODEX_RUNNER_MODE=cli node --import tsx scripts/run-real-self-improvement.ts \
  --orchestrator-base-url http://127.0.0.1:3200 \
  --bridge-base-url http://127.0.0.1:3115 \
  --browser-endpoint http://172.18.144.1:9224 \
  --startup-url https://chatgpt.com/ \
  --planning-model ChatGPT \
  --govern-between-runs \
  --campaign-id bounded-self-improvement \
  --iteration-cap 1
```

The entry script now does five things:

1. Calls the bootstrap module first and consumes the resulting env-state file.
2. Creates a bounded run through the orchestrator API.
3. Starts [`scripts/watch-run-until-terminal.mjs`](/home/administrator/code/review-then-codex-system/scripts/watch-run-until-terminal.mjs) immediately so monitoring is not tied to the current chat thread.
4. Builds an analysis bundle under the run artifact root.
5. Sends requirement, architecture, and task-graph planning requests that attach the analysis bundle through real `inputFiles`.

## One Goal Per Run

The supported self-improvement entrypoint now selects exactly one bounded todo goal per fresh run.

Rules:

- selection comes from the first unchecked item in `todolist.md` under `Ordered Execution Queue`
- the selected goal is persisted at `<authoritative-artifact-root>/runs/<run-id>/self-improvement-goal.json`
- a resumed `--run-id <run-id>` reuses the persisted run goal instead of re-selecting from `todolist.md`
- if there is no unchecked ordered goal, or if the next goal has no registered bounded profile, the entrypoint stops fail-closed

This keeps each run narrow. One run gets one goal, not a changing campaign backlog.

## Automatic Inside One Run Vs Between Runs

Treat these as two different layers:

- automatic inside one run:
  - bootstrap, watcher startup, analysis-bundle creation, planning sequencing, and the normal task execution/review/rework loop
- automatic between runs:
  - only enabled when `--govern-between-runs` is passed
  - records campaign state at `<authoritative-artifact-root>/runtime/self-improvement-governor/campaigns/<campaign-id>.json`
  - only continues after a real terminal accepted run
  - selects at most one next goal for the next fresh run
  - stops at the explicit `--iteration-cap`, when no ordered goal remains, or when the next goal is not auto-runnable

The current supported governor is intentionally bounded. It is not permission for open-ended autonomy.

## Terminal-State Detector

The bounded governor and watcher now use one shared detector:

- terminal accepted:
  - `run.json.stage = "accepted"` and `run-acceptance.json` exists
- terminal manual attention:
  - no queued, running, retriable, or runnable work remains
  - but blocked/failed execution state or another non-accepted stop condition remains
- non-terminal:
  - planning is still incomplete
  - or the run still has runnable, queued, running, or release-pending work

This detector is fail-closed on final acceptance. `runtimeState.status = "accepted"` alone is not enough when final snapshots are lagging.

## Analysis Bundle

The authoritative artifact root is the one used by the running orchestrator process, not whatever default the current shell would pick. The entry script must resolve that live root first and then place all derived operator files under:

`<authoritative-artifact-root>/runs/<run-id>/`

The first bundle is text-first, zip-second. It should always contain:

- `repo-summary.md`
- `critical-files.md`
- `latest.patch`
- `environment-state.json`

It may also contain:

- `source.zip`

The text files are the primary planning context. The zip is only supplemental. A run should not depend on zip alone.

## Watcher Workflow

The watcher script is the standard operator surface for long runs:

```bash
node scripts/watch-run-until-terminal.mjs \
  --artifact-dir <authoritative-artifact-root> \
  --base-url http://127.0.0.1:3200 \
  --run-id <run-id> \
  --output-json <authoritative-artifact-root>/runs/<run-id>/watcher/latest.json \
  --output-md <authoritative-artifact-root>/runs/<run-id>/watcher/latest.md
```

The self-improvement entry script starts the watcher automatically and writes:

- a console log stream
- a latest JSON snapshot
- a latest Markdown snapshot
- a watcher PID record for recovery

Those files live under:

- `<authoritative-artifact-root>/runs/<run-id>/watcher/latest.json`
- `<authoritative-artifact-root>/runs/<run-id>/watcher/latest.md`
- `<authoritative-artifact-root>/runs/<run-id>/watcher/watcher.log`
- `<authoritative-artifact-root>/runs/<run-id>/watcher/watcher.pid`

Treat those watcher files plus `<authoritative-artifact-root>/runtime/self-improvement-env/env-state.json`
as the authoritative operator-observation surface. Ad hoc probe or recovery scratch outputs under
repo-local `tmp/` directories are useful for one-off diagnostics, but they are not the canonical
resume or retention path for supported local self-improvement runs.

Use those files when the chat thread changes, the browser is replaced, or the operator needs to resume from another terminal.

When the watcher knows `--artifact-dir`, its snapshots also include the shared terminal-state classification used by the between-run governor.
The same watcher snapshots now also include an operator surface for recovery:

- canonical artifact paths for `env-state.json`, `run.json`, watcher files, jobs, and reviews
- one `--prepare-only --run-id <run-id>` command for re-establishing the authoritative endpoint set
- one existing-run `--run-id <run-id>` command for bounded entrypoint resume when planning is still incomplete
- one watcher restart command and one watcher `--once` command
- one daemon status/resume path
- the newest retryable or manual-attention `task_review_request` / `task_review_finalize` jobs with exact inspect and retry commands

## Operator Resume Surface

The supported resume model is narrow:

- use `watcher/latest.md` or `watcher/latest.json` first to recover the exact artifact paths and current recommended commands
- use `--prepare-only` to re-read the authoritative artifact root and shared env-state without mutating the run
- use `--run-id <run-id>` to resume the self-improvement entrypoint when the previous foreground driver stopped before planning fully advanced
- use watcher snapshots plus on-disk run artifacts to resume understanding of a run that is already in task execution or review

This is not a promise of arbitrary process resurrection. The current supported mode is artifact-driven run/context resume plus controlled retry, not general automatic continuation of any dead runner process.

## Expected First Loop

The minimum viable first loop is:

1. Bootstrap writes a fresh env-state file and proves the live stack is reusable.
2. Planning uses the attached bundle plus env-state to freeze an environment-bootstrap requirement.
3. Planning generates a bounded task graph that stays within the bootstrap surface.
4. Local Codex execution edits only the bootstrap module and its operator documentation.
5. Task review and release review use the same bundle attachments before final acceptance.

## Success Signal

Treat the first loop as successful when all of the following are true:

- a real run was created and moved beyond intake
- the env-state file was written and reused by the run entrypoint
- the analysis bundle files were attached to ChatGPT conversations, not just mentioned in prompt text
- at least one planning or review markdown export shows `Attached files: ...`
- the run stayed within the narrow low-risk scope
- the resulting workflow can be rerun without reusing ad hoc validation scripts
