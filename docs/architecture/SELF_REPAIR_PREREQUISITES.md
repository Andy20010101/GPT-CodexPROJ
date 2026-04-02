# Self-Repair Prerequisites

Phase 8 does not open unrestricted self-modification. It builds the policy and evidence prerequisites for low-risk remediation only.

## Why A Prerequisite Layer

The runtime already knows when something failed. That is not enough to let it repair itself safely.

Before any automated remediation is allowed, the system needs:

- structured failure taxonomy
- recurring incident tracking
- deterministic playbook matching
- task-shaped remediation proposals
- explicit policy decisions
- evidence for every remediation attempt

This phase adds those prerequisites.

## Remediation Playbooks

The current playbook categories are:

- `bridge_drift_recovery`
- `runner_timeout_recovery`
- `workspace_cleanup_repair`
- `evidence_gap_repair`
- `prompt_template_repair`
- `selector_update_review`
- `retry_policy_tuning`
- `manual_attention`

Each playbook carries:

- risk level
- default allowed file scope
- required evidence kinds
- whether the category is even eligible for low-risk automation

## Failure-To-Task Mapping

`FailureToTaskService` converts failures or incidents into structured follow-up proposals.

A proposal includes:

- suggested task title
- objective
- risk level
- allowed files
- required evidence
- recommended playbook

The important boundary is that this proposal does not silently enter the main task graph.

## Self-Repair Policy

`SelfRepairPolicyService` decides one of:

- `auto_allowed`
- `review_required`
- `manual_only`

### Current Auto-Allowed White List

Only low-risk categories are auto-allowed by default:

- bridge selector or preflight hardening
- prompt and structured-output template repair
- evidence-gap repair
- workspace cleanup and runtime cleanup repair

### Explicitly Protected Areas

Automatic remediation is blocked from core rule surfaces such as:

- orchestrator state transitions
- gate evaluation rules
- final acceptance rules
- task graph semantics
- primary ledger schema boundaries

## Remediation Execution

`RemediationService` can:

- propose remediation
- persist the policy decision
- execute only bounded low-risk actions
- leave medium- and high-risk actions in review-required or manual-only state

This means the system can prepare and sometimes execute controlled repair work, but it still does not have permission to rewrite its own core governance model.

## Stability Governance Input

`StabilityGovernanceService` aggregates:

- recurring incidents
- rollback count
- retained workspace count
- unresolved drift incidents
- manual-attention backlog

Those summaries are the intended upstream signal for future, more capable remediation routing.
