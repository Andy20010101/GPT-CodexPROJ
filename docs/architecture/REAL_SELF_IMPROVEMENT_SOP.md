# Real Self-Improvement SOP

## Purpose

This SOP defines the repeatable operator procedure for the currently supported real self-improvement mode.

Use it when a run has finished, a new chat thread is being opened, and the next run must start from a fresh conversation and a fresh review flow.

This is a runbook, not a redesign proposal. It is grounded in the accepted runs `c27a123f-6255-490a-b0b3-b2c6079d983a`, `0f55cde7-1053-4ca3-aeb3-21fe002d1383`, and `206eab47-6f19-4899-88ed-77ee50261012`.

For preparing a brand-new project packet before the run starts, see [`PROJECT_PREPARATION_SOP.md`](/home/administrator/code/review-then-codex-system/docs/architecture/PROJECT_PREPARATION_SOP.md).

## Supported Mode

The supported mode is intentionally narrow. Stay inside it.

- Validated browser endpoint baseline: `http://172.18.144.1:9224`
- Fixed bridge endpoint: `http://127.0.0.1:3115`
- Local orchestrator API: `http://127.0.0.1:3200`
- Fresh planning conversation
- Fresh task review / fresh release review
- Review attachments use the currently validated library-backed attachment flow
- Planning entry uses the working model override `ChatGPT`
- Architecture prompt is already tightened so `dependencyRules[].rule` can only be `"allow"` or `"deny"`
- Task-graph prompt is already tightened so `acceptanceCriteria[].verificationMethod` and `edges[].kind` must stay inside the current valid enums
- All task, job, gate, review, execution, runtime-state, and evidence artifacts must be written to disk under the authoritative artifact root
- Default run policy is to keep the fresh run moving until it reaches a terminal state unless there is a real blocker
- PTY execution is not a default promised capability in the current supported local mode
- Unless PTY has been explicitly revalidated for the live local stack, operator discipline is to prefer the known-good non-PTY continuous-run surface before starting a fresh run

## Prerequisites

- The attached browser is already logged in to ChatGPT and reaches a composer-ready page at `https://chatgpt.com/`
- Browser CDP is reachable at the selected WSL-visible endpoint for the run, with `http://172.18.144.1:9224` as the current validated baseline
- Bridge health is ready at `http://127.0.0.1:3115`
- Orchestrator health is ready at `http://127.0.0.1:3200/health`
- The orchestrator process runs with `CODEX_RUNNER_MODE=cli`
- The operator knows whether the live orchestrator is currently running in PTY or non-PTY mode and that the selected mode is currently known-good for the supported local stack
- The authoritative artifact root is writable and is the root used by the live orchestrator process
- `node` and repo dependencies are already installed so `node --import tsx ...` works
- Planning/review/release-review continue to use the model recorded as `ChatGPT` in `*/model-routing-decision.json` and `*/request-runtime-state.json`

## Windows + WSL Bring-Up

Freeze the endpoint set before the fresh run starts. The supported baseline is:

- browser endpoint: `http://172.18.144.1:9224`
- bridge endpoint: `http://127.0.0.1:3115`
- orchestrator endpoint: `http://127.0.0.1:3200`

If attach diagnostics prove that the real WSL-visible browser endpoint is a different port such as `http://172.18.144.1:9225`, update the explicit command set before the fresh run and keep that endpoint fixed for the whole run. Do not switch browser endpoints mid-run.

### 1. Start Or Verify The Windows Browser

From Windows PowerShell:

```powershell
Start-Process 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' `
  -ArgumentList '--remote-debugging-port=9224','--remote-debugging-address=0.0.0.0'
```

Then verify on Windows:

```powershell
Invoke-WebRequest http://127.0.0.1:9224/json/version
Invoke-WebRequest http://127.0.0.1:9224/json/list
```

### 2. Confirm The WSL-Visible Browser Endpoint

From WSL, use the bridge diagnostics against the supported bridge endpoint:

```bash
TMPDIR=/tmp npx tsx scripts/check-browser-attach.ts \
  --base-url http://127.0.0.1:3115 \
  --browser-endpoint http://172.18.144.1:9224 \
  --startup-url https://chatgpt.com/
```

If the reachable WSL-visible path is a portproxy endpoint instead, rerun with that endpoint explicitly:

```bash
TMPDIR=/tmp npx tsx scripts/check-browser-attach.ts \
  --base-url http://127.0.0.1:3115 \
  --browser-endpoint http://172.18.144.1:9225 \
  --startup-url https://chatgpt.com/
```

Use the `Selected candidate` and `BRIDGE_BROWSER_URL=...` output as the authority for the fresh run. The exact same endpoint must then be passed to `doctor`, `ensure`, `--prepare-only`, and `--run-id` resume commands.

### 3. Let Bootstrap Reuse Or Start Local Services

`ensure` can reuse or start the local bridge/orchestrator only when their base URLs are loopback endpoints. It can also stop watcher processes that are still writing outside the authoritative artifact root.

`ensure` does not:

- log in to ChatGPT
- restore arbitrary dirty page state
- make mid-run endpoint switching safe

## Start Checklist

Run this checklist at the start of every new chat thread before starting the next real self-improvement run.

- [ ] Work from `/home/administrator/code/review-then-codex-system`
- [ ] Confirm the previous run is already terminal and will not be mutated further
- [ ] Confirm the next run will be a fresh run; do not plan to reuse an old conversation or old review thread
- [ ] Confirm the selected WSL-visible browser endpoint for this fresh run, using `http://172.18.144.1:9224` as the validated baseline unless diagnostics prove another endpoint
- [ ] Confirm the fixed bridge endpoint is still `http://127.0.0.1:3115`
- [ ] Confirm the orchestrator API is still `http://127.0.0.1:3200`
- [ ] Confirm the browser session is already logged in and composer-ready
- [ ] Confirm you are not relying on unsupported recovery behavior such as auto-login, old-conversation restore, or arbitrary page-state healing
- [ ] Confirm the live orchestrator runner surface is in a known-good PTY/non-PTY configuration before opening the fresh run
- [ ] If PTY has not been explicitly revalidated for the current local stack, keep the fresh run on the known-good non-PTY path
- [ ] Run `doctor`, then `ensure`, then `--prepare-only` before starting the fresh run
- [ ] Record the reported `envStatePath` and authoritative artifact root before proceeding

## Run Commands

Use the standard commands below. Do not improvise endpoints. Do not pass an old `--run-id` for a fresh run.

### 1. Doctor

```bash
node --import tsx scripts/self-improvement-env.ts doctor \
  --orchestrator-base-url http://127.0.0.1:3200 \
  --bridge-base-url http://127.0.0.1:3115 \
  --browser-endpoint http://172.18.144.1:9224 \
  --startup-url https://chatgpt.com/
```

Expected result:

- Structured env-state JSON is printed
- `status` / `overallStatus` is `ready`
- The shared env-state file is written at `<artifact-root>/runtime/self-improvement-env/env-state.json`

### 2. Ensure

```bash
node --import tsx scripts/self-improvement-env.ts ensure \
  --orchestrator-base-url http://127.0.0.1:3200 \
  --bridge-base-url http://127.0.0.1:3115 \
  --browser-endpoint http://172.18.144.1:9224 \
  --startup-url https://chatgpt.com/
```

Expected result:

- The same env-state surface is rewritten with the latest ensure result
- Minimal local recovery is attempted only for the supported local stack
- Any watcher writing outside the authoritative artifact root is stopped

### 3. Prepare Only

```bash
node --import tsx scripts/run-real-self-improvement.ts \
  --orchestrator-base-url http://127.0.0.1:3200 \
  --bridge-base-url http://127.0.0.1:3115 \
  --browser-endpoint http://172.18.144.1:9224 \
  --startup-url https://chatgpt.com/ \
  --planning-model ChatGPT \
  --prepare-only
```

Use this output to confirm:

- `BOOTSTRAP_ENV_STATE_PATH`
- `BOOTSTRAP_ARTIFACT_DIR`
- `authoritativeArtifactDir`
- `watcherCleanup`
- the live bridge and browser endpoints actually in use

### 4. Start The Fresh Run

```bash
CODEX_RUNNER_MODE=cli node --import tsx scripts/run-real-self-improvement.ts \
  --orchestrator-base-url http://127.0.0.1:3200 \
  --bridge-base-url http://127.0.0.1:3115 \
  --browser-endpoint http://172.18.144.1:9224 \
  --startup-url https://chatgpt.com/ \
  --planning-model ChatGPT
```

Expected result:

- A new `runId` is created
- The watcher starts immediately
- The analysis bundle is created under `<artifact-root>/runs/<run-id>/analysis-bundle/`
- Requirement, architecture, and task-graph planning start in order

Operator rule:

- In supported local mode, let the scripts discover the authoritative artifact root from the live orchestrator
- Only pass `--artifact-dir` when the exact live artifact root is already known and validated
- Do not rely on generic bridge/browser defaults when running the supported local mode; keep the fresh run commands explicit so the fixed operator path cannot silently fall back to `3100` or another discovered endpoint
- Do not treat PTY and non-PTY as interchangeable in current supported mode; use the last explicitly validated runner surface for the live orchestrator
- If PTY has not been freshly revalidated, start the fresh run from the known-good non-PTY surface rather than assuming PTY parity

### 5. Resume The Same Run

Use this when the foreground self-improvement driver exited before planning fully advanced, or when you need the entrypoint to rehydrate watcher/bundle paths for an existing run.

```bash
CODEX_RUNNER_MODE=cli node --import tsx scripts/run-real-self-improvement.ts \
  --orchestrator-base-url http://127.0.0.1:3200 \
  --bridge-base-url http://127.0.0.1:3115 \
  --browser-endpoint http://172.18.144.1:9224 \
  --startup-url https://chatgpt.com/ \
  --planning-model ChatGPT \
  --run-id <run-id>
```

Operator rules:

- `--run-id` is for resuming the bounded entrypoint, not for creating a fresh run
- the same explicit endpoint set must be reused for the resumed run
- the driver reuses existing planning artifacts when a phase is already applied
- if the run is already in task execution or review, use watcher plus artifacts first; do not create a second run just to understand state

## Monitoring

Use artifacts, not chat memory, to understand the live run.

### Primary files

- `<artifact-root>/runtime/self-improvement-env/env-state.json`
  - latest shared bootstrap state from `doctor`, `ensure`, or `--prepare-only`
- `<artifact-root>/runs/<run-id>/run.json`
  - authoritative run metadata and current run `stage`
- `<artifact-root>/runs/<run-id>/watcher/latest.json`
  - main machine-readable run summary
- `<artifact-root>/runs/<run-id>/watcher/latest.md`
  - main human-readable snapshot for a new chat thread
- `<artifact-root>/runs/<run-id>/watcher/watcher.log`
  - append-only watcher trace
- `<artifact-root>/runs/<run-id>/watcher/watcher.pid`
  - watcher pid/output-path record used for watcher reuse or restart
- `<artifact-root>/runs/<run-id>/run-acceptance.json`
  - final acceptance proof for an accepted run

### Planning-phase files

For each of `requirement/`, `architecture/`, and `task-graph/`, inspect:

- `request.json`
- `request-runtime-state.json`
- `model-routing-decision.json`
- `materialized-result.json`
- `finalize-runtime-state.json`
- `conversation-link.json`

Use them to confirm:

- the phase has started
- the phase has finalized
- the model is `ChatGPT`
- the phase used fresh conversation state
- the attached analysis bundle files were recorded in metadata

### Execution and review files

- `tasks/*.json`
  - per-task status and accepted task set
- `executions/<execution-id>/`
  - execution request/result artifacts
- `reviews/<review-id>/request.json`
  - task review request
- `reviews/<review-id>/result.json`
  - task review outcome such as `approved` or `changes_requested`
- `releases/<release-review-id>/request.json`
  - release review request
- `releases/<release-review-id>/result.json`
  - release review result
- `gate-results/*.json`
  - gate pass/fail results
- `evidence/*.json`
  - event-level audit trail

### Interpreting state

- Planning not started yet:
  - only bootstrap artifacts exist
- Planning in progress:
  - one of `requirement`, `architecture`, or `task-graph` has `request-runtime-state.json` with `status: "planning_waiting"` or similar
- Tasks in progress:
  - `tasks/*.json` exist and not all task statuses are `accepted`
- Release review:
  - release review artifacts exist and `run.json` stage is `release_review`
- Terminal accepted:
  - `run-acceptance.json` exists and `run.json` stage is `accepted`
- Terminal manual attention:
  - no queued, running, retriable, or runnable work remains
  - but blocked/failed execution state or another non-accepted stop condition remains

Important monitoring nuance from the accepted evidence:

- `watcher/latest.json` can lag one stage behind `run.json` on the final snapshot
- If `watcher/latest.json` shows `runtimeState.status: "accepted"` while `run.stage` still says `release_review`, check `run.json` and `run-acceptance.json`
- Treat `run-acceptance.json` plus `run.json.stage = "accepted"` as the terminal source of truth

## Watcher Operations

The self-improvement entrypoint starts the watcher automatically and writes:

- `watcher/latest.json`
- `watcher/latest.md`
- `watcher/watcher.log`
- `watcher/watcher.pid`

If the current terminal or chat thread changes, restart observation from any shell with:

```bash
node scripts/watch-run-until-terminal.mjs \
  --artifact-dir <artifact-root> \
  --base-url http://127.0.0.1:3200 \
  --run-id <run-id> \
  --output-json <artifact-root>/runs/<run-id>/watcher/latest.json \
  --output-md <artifact-root>/runs/<run-id>/watcher/latest.md
```

For a one-time snapshot without a continuous loop:

```bash
node scripts/watch-run-until-terminal.mjs \
  --artifact-dir <artifact-root> \
  --base-url http://127.0.0.1:3200 \
  --run-id <run-id> \
  --once
```

Watcher rules:

- if `watcher.pid` points at a live process, the self-improvement driver reuses it
- if `watcher.pid` is stale or missing, the driver starts a new watcher
- if a watcher is writing outside the authoritative artifact root, `ensure` stops it; starting a new watcher after that is expected and correct
- pass `--artifact-dir <artifact-root>` when you want the watcher to use the shared terminal-state detector instead of API-only stage/runtime hints
- when `--artifact-dir <artifact-root>` is present, `watcher/latest.json` and `watcher/latest.md` also render the current operator surface:
  - authoritative artifact paths
  - exact `--prepare-only --run-id <run-id>` and existing-run `--run-id <run-id>` commands
  - exact daemon status/resume commands
  - the newest retryable or manual-attention review jobs with inspect/retry commands

## Recovery Surface Roles

Use the surfaces this way:

- `watcher/latest.md` or `watcher/latest.json`
  - first place to recover current stage, artifact paths, watcher restart commands, existing-run resume commands, daemon commands, and review retry candidates
- `scripts/run-real-self-improvement.ts --run-id <run-id>`
  - only for bounded entrypoint resume when planning is not yet complete
- `/api/jobs/<job-id>/retry`
  - for retrying one failed or retriable execution/review job after inspecting its persisted failure/process/runtime-state evidence
- `/api/daemon/resume`
  - only when queued or retriable work is waiting behind a paused or stopped daemon
- on-disk artifacts under `<artifact-root>/runs/<run-id>/`
  - source of truth for what already happened; do not infer state from chat memory alone

## Between-Run Governor

Between-run automation is opt-in and narrow.

Use it only when you intentionally want one foreground process to decide whether to open a next fresh run:

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

Governor rules:

- automatic inside one run and automatic between runs are different layers; do not confuse them
- the governor only selects from unchecked `Ordered Execution Queue` items in `todolist.md`
- the governor excludes todo ids already used earlier in the same campaign
- the governor continues only after terminal accepted
- `--iteration-cap` is the hard stop; `1` is the fail-closed default
- if no ordered goal remains, or the next goal is not auto-runnable, the governor stops instead of inventing a new scope

### Detecting PTY Silent Stall

In the current supported local mode, PTY silent stall is a real blocker pattern rather than ordinary slow task work.

Treat the situation as a PTY silent stall when the evidence simultaneously shows:

- the task is still in progress and the job is still `running`
- the process handle for that job is still `running`
- repeated monitoring snapshots show session activity and/or structured output not advancing
- output presence stays absent or unchanged across repeated polls
- no execution handoff or review artifacts appear even though the runner process remains alive

The accepted evidence for run `2d3f43b9-ed59-4884-a78e-4bedaea84d36` showed exactly this shape: the task stayed `implementation_in_progress`, the job and process handle both remained `running`, and the monitor tail repeated `output=absent` for an extended period before the operator applied the minimal blocker response.

## Normal Flow

The supported normal flow is:

1. `doctor`
2. `ensure`
3. `--prepare-only`
4. fresh run creation
5. requirement freeze
6. architecture freeze
7. task graph generation
8. task execution
9. task review
10. rework when needed
11. accepted tasks
12. release review
13. terminal run outcome

What is normal:

- Requirement, architecture, and task-graph planning happen in that order
- Each planning phase writes request, runtime-state, routing, materialized-result, and conversation-link artifacts
- Each task may go through `execution -> review -> changes_requested -> rework -> review -> accepted`
- The accepted evidence already includes this pattern: in run `c27a123f-6255-490a-b0b3-b2c6079d983a`, Task 1 review `f714a515-9e78-4867-9a82-2e73567e01c0` returned `changes_requested` before later review `2d866167-ded5-4e42-a723-1dab747847b0` approved the rework and the task still ended `accepted`
- `changes_requested` is normal review output, not a platform failure
- Rework is normal task flow, not a reason to stop the whole run
- A run should continue after normal review feedback until it reaches a real blocker or a terminal run state

What is not normal:

- missing planning artifacts for a phase that supposedly completed
- prompt-only references when the supported mode requires attached files
- missing disk evidence for task, review, execution, gate, or runtime-state transitions
- mid-run endpoint switching

## Stop Conditions

### Continue Running

Continue the run when all of the following are true:

- the environment is still inside the supported mode
- the watcher/runtime artifacts are still updating normally
- review feedback is ordinary `changes_requested` work
- the run still has runnable tasks, queued jobs, or an unfinished release review

### Stop For A Blocker

Stop and handle a blocker when any of the following happens:

- `doctor` or `ensure` cannot reach `ready`
- browser login or composer readiness is gone
- the bridge or orchestrator is unreachable
- the authoritative artifact root is not writable or cannot be resolved
- planning or review artifacts fail to materialize on disk
- attached-file evidence is missing where the supported flow requires it
- the current run hits PTY silent stall: the job is still `running`, the process handle is still `running`, but session activity and/or structured output stop advancing
- the run requires old-conversation restore or arbitrary browser-state takeover to continue
- the run leaves the supported mode and cannot fail closed with explicit diagnostics

When PTY silent stall is the blocker:

- preserve the live hang evidence on disk before changing the runtime surface
- apply only the minimum blocker response needed for the current run
- either make a narrow blocker fix or switch the live orchestrator to an already validated non-PTY runner surface
- do not widen the work into general platform redesign during the run

### Open A New Conversation

Open a new chat thread when:

- a run reaches terminal accepted
- or the shared terminal-state detector reaches terminal manual attention and the governor is not continuing automatically
- the next action is a new fresh run rather than more work on the old run

When opening the new thread:

- keep the previous run artifacts as historical evidence
- do not continue by editing old run-state files
- restart from the Start Checklist in this SOP

## Resume, Retry, And Failure-Specific Recovery

### Resume From A New Terminal Or A New Chat Thread

Resume in this order:

1. Read `<artifact-root>/runtime/self-improvement-env/env-state.json` or rerun `--prepare-only` to confirm the authoritative artifact root and live endpoints.
2. Read `<artifact-root>/runs/<run-id>/watcher/latest.md` plus `run.json` to re-establish current stage and pick up the current operator commands.
3. Inspect the phase/task-specific runtime-state files before taking action.
4. Only then decide whether the correct move is watcher restart, daemon resume, job retry, or `--run-id` entrypoint resume.

Use `--prepare-only --run-id <run-id>` when you need the current authoritative artifact root and env-state without mutating the run:

```bash
node --import tsx scripts/run-real-self-improvement.ts \
  --orchestrator-base-url http://127.0.0.1:3200 \
  --bridge-base-url http://127.0.0.1:3115 \
  --browser-endpoint http://172.18.144.1:9224 \
  --startup-url https://chatgpt.com/ \
  --planning-model ChatGPT \
  --run-id <run-id> \
  --prepare-only
```

### Manual Retry Surfaces

`watcher/latest.md` and `watcher/latest.json` are now allowed to be the first lookup surface for retry candidates. When a review retry candidate is present there, use the exact inspect and retry commands shown in the snapshot, then verify that the matching `reviews/<review-id>/runtime-state.json` agrees with the same diagnosis.

Inspect a job before retrying it:

```bash
curl -sS http://127.0.0.1:3200/api/jobs/<job-id>
curl -sS http://127.0.0.1:3200/api/jobs/<job-id>/failure
curl -sS http://127.0.0.1:3200/api/jobs/<job-id>/process
```

Retry a failed or retriable job and immediately drain the run worker:

```bash
curl -sS -X POST http://127.0.0.1:3200/api/jobs/<job-id>/retry \
  -H 'content-type: application/json' \
  -d '{"immediate":true,"runWorker":true}'
```

Check daemon state, then resume it when queued/retriable jobs are waiting behind a paused or stopped daemon:

```bash
curl -sS http://127.0.0.1:3200/api/daemon/status
curl -sS -X POST http://127.0.0.1:3200/api/daemon/resume \
  -H 'content-type: application/json' \
  -d '{"requestedBy":"operator"}'
```

### Failure-Specific Recovery

- Browser/login drift before a fresh run: restore the logged-in composer-ready browser first, rerun attach diagnostics if needed, then rerun `doctor`, `ensure`, and `--prepare-only`. Do not start or resume a fresh run until bootstrap reports `ready`.
- Browser/login drift during planning or review: inspect the relevant `request-runtime-state.json`, `finalize-runtime-state.json`, or `reviews/<review-id>/runtime-state.json`. If the error is retryable materialization/finalize state, retry the existing finalize surface first. For planning, rerun the self-improvement entrypoint with `--run-id <run-id>`. For review jobs, retry the existing review job. Only fall back to a fresh conversation when the persisted error explicitly says the old conversation must be re-dispatched.
- Bridge or orchestrator unreachable on loopback endpoints: rerun `ensure` with the same explicit endpoint set. It can start the local service and clean mismatched watchers, but it will not repair browser login for you.
- Watcher lost after terminal change: rerun the watcher command manually. Do not create a fresh run just because the old watcher process is gone.
- Foreground self-improvement driver exited during planning: rerun `CODEX_RUNNER_MODE=cli node --import tsx scripts/run-real-self-improvement.ts ... --run-id <run-id>`. The driver reuses already-applied planning phases and persists the same artifact layout.
- `task_review_request` or `task_review_finalize` is `retriable` or `failed`: inspect the job JSON under `jobs/`, the job failure/process API output, and the corresponding review runtime-state before retrying. `watcher/latest.md` and `watcher/latest.json` should already surface the newest retryable review jobs with exact inspect and retry commands. If the failure is transient and still inside the supported mode, retry the same job through `/api/jobs/<job-id>/retry`.
- Review dispatch is `manual_attention_required`: stop and inspect the fail-closed evidence. Do not blindly retry degraded review evidence, truncated diff evidence, or repeated-patch convergence failures. Fix the upstream evidence problem first or leave the run stopped for operator decision.
- Daemon stopped or paused with queued work remaining: resume the daemon through `/api/daemon/resume`, then verify that watcher snapshots or `run.json` start advancing again. The watcher operator surface should explicitly call this out whenever queued or retriable work exists behind a non-running daemon.
- Interrupted task execution after process loss: inspect `runtime/resume/*.json` and the latest `runner_resume_state` evidence. `decision: "can_resume"` means a retained workspace exists for controlled retry or inspection. `decision: "requires_manual_attention"` means a runner existed but automatic resume is not supported. `decision: "resume_not_supported"` means start a fresh execution attempt if policy allows. This is an evidence surface for controlled retry, not a promise of arbitrary runner resurrection.
- PTY silent stall: preserve the hanging job/process/watcher evidence first, then apply the minimum blocker response. If the only validated fix is to move the live orchestrator back to a known-good non-PTY runner surface, do exactly that and no more.
- Repeated-patch convergence: inspect `executions/<execution-id>/patch-convergence.json` and stop blind retries. This is an explicit manual-attention stop, not ordinary rework.

## Known Unsupported Cases

The following are explicitly not supported by this SOP:

- automatic login
- old conversation recovery as a routine workflow
- automatic healing of arbitrary dirty page state
- arbitrary browser-state takeover
- arbitrary external environment bring-up
- one-click startup for unknown environments
- broad platform generalization work that is unrelated to the current supported mode

## Evidence Checklist

Treat a run as successfully evidenced only when the following files exist and are coherent.

- [ ] `<artifact-root>/runs/<run-id>/run.json`
- [ ] `<artifact-root>/runs/<run-id>/run-acceptance.json` for accepted runs
- [ ] `<artifact-root>/runs/<run-id>/watcher/latest.json`
- [ ] `<artifact-root>/runs/<run-id>/watcher/latest.md`
- [ ] `<artifact-root>/runs/<run-id>/analysis-bundle/manifest.json`
- [ ] `<artifact-root>/runs/<run-id>/analysis-bundle/repo-summary.md`
- [ ] `<artifact-root>/runs/<run-id>/analysis-bundle/critical-files.md`
- [ ] `<artifact-root>/runs/<run-id>/analysis-bundle/latest.patch`
- [ ] `<artifact-root>/runs/<run-id>/analysis-bundle/environment-state.json`
- [ ] `<artifact-root>/runs/<run-id>/analysis-bundle/source.zip` when zip bundling is enabled
- [ ] `<artifact-root>/runs/<run-id>/requirement-freeze.json`
- [ ] `<artifact-root>/runs/<run-id>/architecture-freeze.json`
- [ ] `<artifact-root>/runs/<run-id>/task-graph.json`
- [ ] planning directories contain `request.json`, `request-runtime-state.json`, `model-routing-decision.json`, `materialized-result.json`, `finalize-runtime-state.json`, and `conversation-link.json`
- [ ] `tasks/*.json` exist for every planned task
- [ ] execution directories contain request/result artifacts
- [ ] review directories contain request/result/runtime-state/structured-review artifacts
- [ ] release review directories contain request/result artifacts
- [ ] `jobs/*.json`, `gate-results/*.json`, and `evidence/*.json` exist on disk
- [ ] at least one planning or review markdown export shows `Attached files: ...`
- [ ] planning runtime-state or model-routing artifacts show `model: "ChatGPT"`
- [ ] final task set is accepted and the release review completed
- [ ] for any PTY/non-PTY blocker, the live hanging `job` record is preserved on disk
- [ ] for any PTY/non-PTY blocker, the live hanging `process-handle` record is preserved on disk
- [ ] for any PTY/non-PTY blocker, a monitor tail is preserved that shows repeated `running` state with no session/output advance
- [ ] for any PTY/non-PTY blocker, a `ps` snapshot of the hanging runner stack is preserved on disk
- [ ] for any PTY/non-PTY blocker, any targeted verification used to justify the minimal fix or non-PTY fallback is preserved on disk

## Operator Notes

- Every run completion ends that operator thread. Start the next run from a new chat thread and rerun this SOP from the top.
- Do not hand-edit old `run.json`, `task-graph.json`, task status files, review results, gate results, or runtime-state artifacts.
- Do not treat `changes_requested` or rework as evidence that the platform is broken.
- Do not default to platform convergence after a single failed review or a single rework loop.
- Do not widen the supported mode during ordinary run operation.
- Do not swap browser endpoints, bridge endpoints, or model overrides mid-run.
- Do not switch PTY/non-PTY inside an active run as routine tuning.
- Only change PTY/non-PTY during an active run when the evidence clearly shows PTY silent stall and the minimum blocker response is to move to a known-good non-PTY surface.
- Do not claim PTY is ready for continuous local runs unless that PTY surface has been explicitly revalidated.
- Do not bypass the validated attachment flow with prompt-only references.
- Use the watcher and artifact files to resume understanding; do not rely on hidden browser state or the memory of an old chat thread.

## Escalation Rule

Open a narrow platform convergence effort only when all of the following are true:

1. The same blocker repeats across multiple tasks or across two to three fresh runs inside the supported mode.
2. The blocker is clearly platform/runtime behavior rather than normal review feedback or task-content work.
3. The blocker prevents the run from reaching review or acceptance while browser endpoint, bridge endpoint, login state, artifact root, and model override are all already correct.
4. The fix can stay narrow and can be tied directly to the repeated failing transition or evidence surface.

Do not escalate for:

- ordinary `changes_requested`
- ordinary task rework
- unsupported recovery requests
- one-off environment drift outside the supported mode
- broad cleanup or refactor impulses
