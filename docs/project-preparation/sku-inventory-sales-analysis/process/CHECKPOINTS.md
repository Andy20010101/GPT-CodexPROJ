# Checkpoints

## Active

- none

## History

### c_001 direction
- Stage: direction_decision
- Type: direction
- Status: approved
- What Is Being Decided: Freeze v1 direction as a lightweight ERP-only API-first SKU inventory and sales analysis service. The core contract includes SKU current inventory default-warehouse quantity 30-day outbound turnover days and 30-60-90-day sales volume. Time-dimension metrics may be derived across multiple ERP APIs, and non-API fallback is not accepted by default.
- Approval Summary: Direction approved with correction: V1 remains SKU-centric, API-first, and ERP-only; default warehouse should be treated as the local warehouse business concept, and time-dimension metrics may be derived by aligning multiple ERP APIs without defaulting to non-API fallback.
- Correction Summary: Direction approved with correction: V1 remains SKU-centric, API-first, and ERP-only; default warehouse should be treated as the local warehouse business concept, and time-dimension metrics may be derived by aligning multiple ERP APIs without defaulting to non-API fallback.
- Rejection Reason: null
- Rollback Target: brainstorm
- Linked Decisions: d_001
- Decided By: human
- Decided At: 2026-04-15T02:55:56.719Z

### c_002 scope
- Stage: scope_freeze
- Type: scope
- Status: approved
- What Is Being Decided: Freeze v1 scope as an ERP-only API contract at SKU grain with current inventory local-warehouse quantity 30-day outbound turnover days and 30-60-90-day sales volume in scope. Keep dashboard delivery export workflows WMS/internal-system integration and default non-API fallback out of scope for v1.
- Approval Summary: Scope approved with correction: v1 remains ERP-only with no other system integrations. At most one additional API endpoint may be included only if it stays inside the ERP-only boundary and exists solely to reduce friction for a later v2 iteration.
- Correction Summary: Scope approved with correction: v1 remains ERP-only with no other system integrations. At most one additional API endpoint may be included only if it stays inside the ERP-only boundary and exists solely to reduce friction for a later v2 iteration.
- Rejection Reason: null
- Rollback Target: brainstorm
- Linked Decisions: d_002
- Decided By: human
- Decided At: 2026-04-15T02:59:10.036Z

### c_003 boundary
- Stage: boundary_freeze
- Type: boundary
- Status: rejected
- What Is Being Decided: Freeze v1 boundary as ERP API-only, allow multi-API derived calculations for time-dimension metrics, keep WMS/other-system integration and default non-API fallback outside the boundary, and treat any later need for fallback as a new decision rather than an implicit expansion.
- Approval Summary: null
- Correction Summary: null
- Rejection Reason: Rejected because the proposed boundary was too strict. The corrected rule is: v1 does not integrate other systems as sources, but may expose at most one interface for another system; if a fallback is later needed, the preferred fallback form is export rather than default non-API ingestion.
- Rollback Target: brainstorm
- Linked Decisions: d_003
- Decided By: human
- Decided At: 2026-04-15T03:06:24.070Z

### c_004 direction
- Stage: direction_decision
- Type: direction
- Status: approved
- What Is Being Decided: Freeze corrected v1 direction as an API-first SKU analysis service sourced from ERP APIs, with at most one optional interface for another system, no default source-side integration beyond ERP, and export as the preferred fallback only if later validation proves it necessary.
- Approval Summary: Approved corrected direction: ERP APIs remain the core source boundary, v1 may expose at most one interface for another system, and export is the preferred fallback only if later validation proves it necessary.
- Correction Summary: null
- Rejection Reason: null
- Rollback Target: brainstorm
- Linked Decisions: d_004
- Decided By: human
- Decided At: 2026-04-15T03:10:51.376Z

### c_005 scope
- Stage: scope_freeze
- Type: scope
- Status: approved
- What Is Being Decided: Freeze corrected v1 scope around an ERP-sourced API contract at SKU grain, including one optional interface for another system, while keeping dashboard delivery and broad system integration out of scope and treating export only as a possible later validated fallback.
- Approval Summary: Scope approved with correction: default warehouse quantity must be treated as the local-warehouse business concept; if multiple local warehouses exist, v1 must use configured default_local_wid or explicit mapping rather than assuming a naturally unique local warehouse. Also, the one-other-system interface is a boundary/consumer constraint rather than core business scope. Time-dimension metrics remain required and may be derived across multiple ERP APIs.
- Correction Summary: Scope approved with correction: default warehouse quantity must be treated as the local-warehouse business concept; if multiple local warehouses exist, v1 must use configured default_local_wid or explicit mapping rather than assuming a naturally unique local warehouse. Also, the one-other-system interface is a boundary/consumer constraint rather than core business scope. Time-dimension metrics remain required and may be derived across multiple ERP APIs.
- Rejection Reason: null
- Rollback Target: brainstorm
- Linked Decisions: d_005
- Decided By: human
- Decided At: 2026-04-15T03:15:51.104Z

### c_006 boundary
- Stage: boundary_freeze
- Type: boundary
- Status: approved
- What Is Being Decided: Freeze corrected boundary so that ERP APIs remain the only source-side integration boundary, default_local_wid or explicit local-warehouse mapping is allowed, at most one interface for another system is allowed only as a consumer-side constraint, and export is not a default v1 delivery mode but may become a later validated fallback.
- Approval Summary: Approved corrected boundary: ERP APIs remain the only source-side integration boundary; one external interface is allowed only as a consumer-side constraint; export is only a later validated fallback, not a default v1 mode.
- Correction Summary: null
- Rejection Reason: null
- Rollback Target: brainstorm
- Linked Decisions: d_006
- Decided By: human
- Decided At: 2026-04-15T03:25:24.275Z

### c_007 success_evidence
- Stage: success_evidence_freeze
- Type: success_evidence
- Status: approved
- What Is Being Decided: Freeze success so that v1 only counts as successful if the full required API contract is present, time-dimension metrics are validated as ERP-derived, local-warehouse mapping is explicit when needed, and no hidden source-side boundary expansion is used to make the service appear complete.
- Approval Summary: Approved success/evidence definition: v1 only counts as successful if the full required API contract is present, time-dimension metrics are validated as ERP-derived, local-warehouse mapping is explicit when needed, and no hidden source-side boundary expansion is used.
- Correction Summary: null
- Rejection Reason: null
- Rollback Target: brainstorm
- Linked Decisions: d_007
- Decided By: human
- Decided At: 2026-04-15T03:30:28.274Z

### c_008 convergence
- Stage: convergence_gate
- Type: convergence
- Status: approved
- What Is Being Decided: Convergence gate passed: project goal is singular, primary flow is clear, corrected direction/scope/boundary/success are approved, workstreams are shaped, no blocking open question remains, and packet export would not mislead. Carryable risks remain in ERP API linkage validation, local-warehouse mapping configuration, and optional extra consumer-interface need, but they do not currently block freeze.
- Approval Summary: Approved convergence gate: remaining unfrozen items stay process-side and do not block packet export or handoff.
- Correction Summary: null
- Rejection Reason: null
- Rollback Target: packet_export
- Linked Decisions: d_004, d_005, d_006, d_007
- Decided By: human
- Decided At: 2026-04-15T03:36:27.502Z

### c_009 packet_export
- Stage: packet_export
- Type: packet_export
- Status: approved
- What Is Being Decided: Publish packet export from approved corrected direction d_004, scope d_005, boundary d_006, and success/evidence d_007 using convergence report cr_001. Export the current packet files as the frozen downstream packet, while keeping non-blocking unresolved items such as SKU-field mapping, default_local_wid/local-warehouse mapping details, first concrete API consumer, optional extra interface need, and detailed ERP API linkage validation on the process side.
- Approval Summary: Approved packet export: remaining non-blocking unresolved items stay process-side and do not block publishing the corrected frozen packet or generating the downstream handoff.
- Correction Summary: null
- Rejection Reason: null
- Rollback Target: packet_export
- Linked Decisions: d_004, d_005, d_006, d_007
- Decided By: human
- Decided At: 2026-04-15T03:36:40.394Z

