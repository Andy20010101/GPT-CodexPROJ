# Bridge And Runner Stability

Phase 8 adds the first explicit stability-governance layer above the existing bridge and local runner adapters.

## Bridge Stability

The bridge now exposes health and drift-oriented runtime signals instead of treating DOM changes as opaque failures.

Key components:

- `SelectorFallbacks`: centralized fallback selector candidates
- `PageHealthCheck`: health classification for ready, degraded, reauth, drift, project, and conversation states
- `DriftRecoveryService`: bounded selector fallback and recovery attempts
- `BridgeHealthService`: persistence for bridge health summaries and drift incidents
- `SessionResumeGuard`: bounded session and conversation resume decisions

The bridge does not silently self-heal. Every recovery attempt or failure is expected to become an artifact and, when routed through orchestrator, an evidence reference.

### Bridge Status Model

The bridge health summary distinguishes:

- `ready`
- `degraded`
- `needs_reauth`
- `dom_drift_detected`
- `project_unavailable`
- `conversation_unavailable`

This prevents the control plane from treating every bridge problem as the same retry case.

## Runner Stability

The local Codex CLI path is still a local adapter, but it now has stronger lifecycle semantics.

Key components:

- `ProcessControlService`: tracks spawned runner processes and exit metadata
- `RunnerLifecycleService`: wraps command execution with timeout, cancellation, and evidence hooks
- `RunnerResumeService`: records whether a failed or interrupted task can resume, is unsupported, or requires manual attention

### Current Resume Boundary

The runtime records resume state, but does not fake remote session resume.

Current decisions:

- `can_resume`: a retained workspace is available for a controlled retry
- `resume_not_supported`: the runtime has no safe resume path
- `requires_manual_attention`: a process existed, but automatic resume is unsafe

## Process Tree Cleanup

The runtime hardening layer now treats child-process cleanup as a first-class responsibility.

- cooperative cancellation is attempted first
- graceful terminate follows
- force kill is used only after a bounded grace window
- exit code, signal, and lifecycle metadata are persisted

This is still local-process lifecycle management, not a distributed process supervisor.

## Current Limits

What is intentionally still out of scope:

- cross-host resume
- remote Codex session continuation
- fully automatic bridge selector rewrites
- browser re-auth automation
- fully autonomous drift repair

The current design is a stability baseline: classify, record, recover in bounded ways, and escalate clearly when the runtime should stop.
