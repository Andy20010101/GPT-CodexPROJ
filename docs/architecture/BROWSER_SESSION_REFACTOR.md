# Browser Session Refactor

## Why this exists

The current browser-driving stack mixes several responsibilities that should not fail as one unit:

- browser process / CDP endpoint reachability
- ChatGPT page binding and attach recovery
- project/model/conversation session control
- orchestrator run-driver timing, retry, and resume behavior

In practice this makes many unrelated failures look like "startup/CDP" problems, even when the root cause is:

- stale page selection
- model switching drift
- session ownership confusion
- long UI RPCs wrapped in one HTTP request
- bootstrap health checks depending on bridge-private DOM semantics

## Current structural problems

### 1. Browser authority is not singular

Multiple layers can independently infer browser state or endpoint:

- bootstrap script
- bridge runtime config
- orchestrator env
- manual operator overrides

That makes endpoint drift (`9668`, `9224`, old bridge URLs) recur as operational bugs.

### 2. Bootstrap depends on bridge internals

`scripts/self-improvement-env.ts` currently needs ChatGPT readiness semantics, but it was implemented by directly importing low-level bridge internals such as page binding and selectors. That creates a hidden coupling:

- bootstrap is supposed to be a consumer of browser/session readiness
- instead it partially reimplements bridge behavior

### 3. Page binding and chat-session semantics are mixed

`PageFactory` and `BrowserManager` currently blur these concerns:

- finding/attaching an existing ChatGPT page
- creating or recovering a fresh page
- deciding whether a page is good enough for a live session

That makes session creation failures look like generic attach failures.

### 4. Long UI workflows are exposed as synchronous RPCs

Operations like:

- `openSession`
- `selectProject`
- `startConversation`
- `wait`

contain variable-latency browser/UI behavior but are still exposed as single request/response operations. This creates timeout ambiguity between:

- bridge client timeout
- browser attach latency
- page materialization delay
- model/project selection drift
- driver exit during long waits

## Target layering

### Layer 1: Browser Authority

Owns:

- chosen browser endpoint
- health/readiness probe
- login/composer readiness
- stable env-state export

Does not own:

- project/model selection
- conversation lifecycle

### Layer 2: Page Binding

Owns:

- attach to an existing ChatGPT page
- create a fresh ChatGPT page
- recover page to startup URL

Does not own:

- project selection
- model switching
- run-driver timing

### Layer 3: Chat Session Control

Owns:

- current project selection
- current model selection
- conversation start
- conversation wait and snapshot

Does not own:

- browser endpoint discovery
- bootstrap/operator health policy

### Layer 4: Run Driver

Owns:

- orchestration sequencing
- retry/resume policy
- timeout budgets
- durable finalize / execution watch behavior

Does not own:

- browser page attach heuristics
- DOM selectors

## First implementation step

The first refactor step should be intentionally narrow:

1. Move ChatGPT browser readiness probing behind a bridge-side service boundary.
2. Make bootstrap consume that service instead of directly importing page-binding/selectors internals.

This does not fully solve browser authority drift, but it creates a stable seam:

- bootstrap becomes a consumer of a probe service
- bridge internals remain private behind one readiness interface

## Follow-up migration order

1. Introduce a singular browser authority source for bootstrap, bridge, and orchestrator.
2. Separate page binding concerns from chat-session concerns in `BrowserManager` and `PageFactory`.
3. Convert long browser/UI request flows into resumable step/poll flows instead of monolithic synchronous RPCs.
4. Move run-driver timeout and resume policy out of browser-attach code paths.

## Implemented slices

### Slice 1: bridge-side readiness probe

Implemented:

- `BrowserReadinessProbeService`
- bootstrap now consumes the probe instead of importing `PageFactory` and `ChatGPTSelectors` directly

Result:

- bootstrap no longer reaches into bridge-private page-binding internals
- readiness semantics now have a bridge-owned service boundary

### Slice 2: single browser authority first cut

Implemented:

- orchestrator prefers `SELF_IMPROVEMENT_ENV_STATE_PATH` browser authority over stale `BRIDGE_BROWSER_URL`
- bridge endpoint discovery also prefers `SELF_IMPROVEMENT_ENV_STATE_PATH`
- bridge now has `BrowserAuthorityService`
- preflight and `ConversationService.openSession()` fallback both use `BrowserAuthorityService`

Result:

- explicit request input, env-state authority, and env fallback are resolved in one place
- discovery, preflight, and open-session fallback no longer each parse authority independently
- env-state authority remains authoritative without silently bypassing attach diagnostics

### Slice 3: session page lifecycle split from attach binding

Implemented:

- `SessionPageBootstrapper`
- `BrowserManager` now stores a `sessionPage` explicitly instead of a mixed `page + ownsPage` session record
- fresh conversation preparation now always rotates the session-owned page, rather than branching on attach ownership

Result:

- attach binding and session page ownership are no longer represented by the same field
- the bridge session lifecycle now talks about a dedicated session page explicitly
- debugging attach failures vs session-page rotation no longer depends on interpreting `ownsPage`

### Slice 4: chat-session control split from adapter glue

Implemented:

- `ChatSessionController`
- project selection and model switching moved out of `PuppeteerChatGPTAdapter`
- adapter now keeps preflight, page access, file upload, send, and snapshot orchestration only

Result:

- project/model semantics no longer live inside the same class that owns browser/page glue
- browser/page binding and ChatGPT session semantics now have a clearer seam
- future model/project drift work can target the session controller without rewriting adapter/session-open code

### Slice 5: lightweight conversation status split from full snapshot

Implemented:

- `ConversationStatusReader`
- a first-class `ConversationStatus` shared contract
- `/api/conversations/:id/status` now returns lightweight live status instead of a full snapshot
- `/api/conversations/:id/snapshot` remains the full-materialization path

Result:

- bridge now distinguishes "is the assistant still running / has the conversation stabilized?" from "materialize the whole conversation transcript"
- lightweight polling no longer needs to masquerade as snapshot export
- the next step/poll/resume refactor for `wait` can build on a status contract instead of reaching for full snapshot reads

### Slice 6: `wait` no longer holds a long session lease black box

Implemented:

- `ConversationService.waitForConversation()` now polls lightweight status via short lease-scoped reads
- full snapshot materialization now happens only once, after stable completion is detected
- the external `/api/conversations/:id/wait` API is unchanged for now

Result:

- bridge no longer treats an entire long conversation wait as one monolithic leased action
- session ownership is released between polls, which reduces the coupling between long assistant latency and session lease contention
- the next external step/poll/resume migration can reuse the same internal status-polling model instead of undoing a long synchronous wait implementation

### Slice 7: orchestrator no longer depends on a bridge-side long `/wait` request

Implemented:

- `HttpBridgeClient.waitForCompletion()` now polls `/api/conversations/:id/status`
- once completion is stable, orchestrator materializes the final conversation via `/api/conversations/:id/snapshot`
- the old `/wait` route remains as a compatibility fallback, but it is no longer the primary path

Result:

- long planning/review/release-review waits are no longer represented as one client-to-bridge HTTP request
- headers timeout and client disconnect risk are reduced because orchestrator owns the polling loop
- the remaining migration path to explicit start/poll/resume is now incremental rather than a full rewrite

### Slice 8: `startConversation` no longer materializes a full transcript on the start path

Implemented:

- `PuppeteerChatGPTAdapter.startConversation()` now returns a lightweight running seed snapshot after prompt submission
- full transcript materialization is deferred to `/status`, `/snapshot`, or the wait path

Result:

- conversation start no longer depends on an immediate full-page transcript read
- prompt submission and transcript materialization now have separate failure boundaries
- the bridge start path is closer to a true "start" step, instead of bundling start + initial snapshot materialization into one synchronous operation

### Slice 9: `sendMessage` no longer materializes a full transcript on the send path

Implemented:

- `PuppeteerChatGPTAdapter.sendMessage()` now returns a lightweight running seed snapshot after prompt submission
- remediation/follow-up sends now defer transcript materialization to `/status`, `/snapshot`, or wait

Result:

- message send and transcript materialization now have separate failure boundaries, just like conversation start
- structured-output remediation no longer depends on an immediate full-page transcript read at send time
- the bridge now treats both start and send as "submit work first, materialize later" operations

### Slice 10: `selectProject` has a minimal idempotent short-circuit

Implemented:

- `ChatSessionController.selectProject()` now skips sidebar project clicks when:
  - the requested project matches the session’s currently bound project name
  - and the current page URL still matches the session’s project page URL

Result:

- repeated project selection no longer always replays a sidebar click against a page that is already on the target project
- project selection drift and model selection remain separate boundaries
- this is intentionally narrow: it removes the common "already there" case without trying to infer sidebar selection state from unstable UI markup

## Success criteria

- bootstrap no longer imports bridge-private page binding and selector internals directly
- browser readiness probing has one service boundary
- future browser/session refactors can update probe behavior without changing bootstrap logic
