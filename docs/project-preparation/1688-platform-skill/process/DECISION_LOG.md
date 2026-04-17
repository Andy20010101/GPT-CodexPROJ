# Decision Log

## Proposed Decisions

- none

## Approved Decisions

### d_004 Freeze success around a runnable skill bundle plus happy-path and failure-path evidence
- Stage: success_evidence_freeze
- Status: approved
- Decision:
  - Success requires an OpenClaw-compatible skill directory with valid SKILL.md frontmatter and supporting docs
  - Success requires the skill instructions to define input format execution steps rubric output format and fallback behavior
  - Success requires at least one happy-path example showing a real supplier research run is achievable from the operator's access path
  - Success requires at least one failure-path example covering no results structure breakage or login-captcha restriction with explicit downgrade behavior
  - Success requires at least one operator-readable sample report preserving facts heuristics unknowns and source links
- Rationale:
  - This keeps success tied to evidence and usability rather than just having packet prose
  - This matches the documented validation expectations in SUCCESS_CRITERIA
  - This forces the first implementation to prove graceful degradation under real 1688 constraints
  - Success criteria are now formally frozen on the process side.
- Linked Questions:
  - none
- Linked Tradeoffs:
  - none
- Affects Packet Files:
  - SUCCESS_CRITERIA.md
  - RISKS_AND_ASSUMPTIONS.md
  - INITIAL_WORKSTREAMS.md
- Approved By: human
- Approved At: 2026-04-16T02:45:11.275Z
- Rejection Reason: null
- Checkpoint Id: c_004

### d_003 Freeze boundary around skill-bundle artifacts and host-provided browser capabilities
- Stage: boundary_freeze
- Status: approved
- Decision:
  - Owned write surface is limited to skills/1688_supplier_discovery/** and docs/project-preparation/1688-platform-skill/**
  - Allowed dependencies are the host skill layout and existing browser/page/file tools
  - Required external prerequisite is an operator-provided lawful 1688 access path or session when needed
  - Forbidden: orchestrator bridge runtime-state-machine changes
  - Forbidden: new backend services databases queues proxy pools or site-wide capture infrastructure
  - Forbidden: captcha bypass access-limit circumvention or platform-protection evasion
- Rationale:
  - This matches ARCHITECTURE_BOUNDARY and RISKS_AND_ASSUMPTIONS
  - This keeps implementation pressure on the skill bundle instead of repo-wide runtime changes
  - This makes host capability and 1688 access blockers explicit rather than hiding them in later implementation
  - Boundary is formally frozen to match the owned write surface and forbidden areas in the packet.
- Linked Questions:
  - none
- Linked Tradeoffs:
  - none
- Affects Packet Files:
  - ARCHITECTURE_BOUNDARY.md
  - RISKS_AND_ASSUMPTIONS.md
- Approved By: human
- Approved At: 2026-04-16T02:44:55.828Z
- Rejection Reason: null
- Checkpoint Id: c_003

### d_002 Freeze MVP scope around one end-to-end 1688 supplier research flow
- Stage: scope_freeze
- Status: approved
- Decision:
  - In scope: an OpenClaw workspace skill directory with SKILL.md and supporting references
  - In scope: one end-to-end flow from research brief to browsing candidate pages to supplier-first Markdown output
  - In scope: a fixed Markdown contract covering research target candidate suppliers representative products visible signals unknowns and links
  - Out of scope: bulk category crawling scheduled monitoring or cross-marketplace expansion
  - Out of scope: login automation captcha bypass proxy rotation hidden API reverse engineering or new backend infrastructure
- Rationale:
  - This preserves the MVP boundary documented in MVP_SCOPE and NON_GOALS
  - This keeps the first version small enough to validate as a reusable skill bundle
  - This avoids silently converting a research assistant into a scraping platform
  - Scope is formally frozen to match MVP_SCOPE and NON_GOALS.
- Linked Questions:
  - none
- Linked Tradeoffs:
  - none
- Affects Packet Files:
  - MVP_SCOPE.md
  - NON_GOALS.md
  - PROJECT_BRIEF.md
- Approved By: human
- Approved At: 2026-04-16T02:44:36.188Z
- Rejection Reason: null
- Checkpoint Id: c_002

### d_001 Adopt a browser-first OpenClaw skill for single-topic 1688 supplier discovery
- Stage: direction_decision
- Status: approved
- Decision:
  - v1 is an OpenClaw-compatible skill bundle rather than a new service
  - v1 is focused on single-topic 1688 supplier discovery with supplier-first output
  - browser-first operator-in-the-loop research on visible pages is the default operating model
  - representative products are supporting evidence rather than the primary project target
  - outputs must separate page-visible facts heuristic judgments and explicit unknowns
- Rationale:
  - This keeps the project singular and reviewable
  - This matches the documented first usable outcome in PROJECT_BRIEF
  - This preserves a low-frequency compliant posture instead of drifting into crawler infrastructure
  - This keeps the first version centered on reusable research method rather than platform expansion
  - Direction is now formally frozen on the process side to match the packet brief and boundary.
- Linked Questions:
  - none
- Linked Tradeoffs:
  - none
- Affects Packet Files:
  - PROJECT_BRIEF.md
  - RISKS_AND_ASSUMPTIONS.md
  - ARCHITECTURE_BOUNDARY.md
- Approved By: human
- Approved At: 2026-04-16T02:44:14.061Z
- Rejection Reason: null
- Checkpoint Id: c_001

## Rejected Decisions

- none

## Superseded Decisions

- none

