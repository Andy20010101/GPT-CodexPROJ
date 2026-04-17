# Initial Workstreams

## Workstream 1
- Goal: Establish the ERP-source data mapping needed to produce the required SKU-level contract, including current inventory, default-local-warehouse quantity, outbound, and sales inputs.
- Boundary: Stay inside ERP APIs and the allowed local-warehouse mapping/configuration surface; do not widen into WMS, other source systems, or default non-API ingestion.
- Dependencies: ERP API access, SKU identifier alignment, and clarification of `default_local_wid` or equivalent local-warehouse mapping when needed.
- Why It Exists: The service cannot produce a correct contract until the required ERP-source fields and local-warehouse semantics are concretely mapped.

## Workstream 2
- Goal: Implement and validate the metric-derivation path for 30-day outbound, turnover days, and 30/60/90-day sales volume across multiple ERP APIs.
- Boundary: Allow explicit multi-API alignment and derived calculations, but do not hide fallback behavior or silently widen the source boundary if linkage proves awkward.
- Dependencies: Workstream 1 source mapping, agreed metric definitions, and representative validation samples for comparing derived results against business expectations.
- Why It Exists: Time-dimension metrics are required for success and are also the highest-risk part of the approved v1 contract.

## Workstream 3
- Goal: Shape the outward API contract and consumer integration path for the approved v1 service, including the optional single external interface if it is actually needed.
- Boundary: Keep the main deliverable API-first, avoid turning consumer needs into broad presentation work, and treat export only as a later validated fallback rather than a default delivery mode.
- Dependencies: Workstream 1 source mapping, Workstream 2 derived metric readiness, and clarification of the first concrete consumer plus any need for the optional extra interface.
- Why It Exists: The project succeeds only if the required metrics are delivered through a usable API contract that stays aligned with the approved direction, scope, and boundary.

## Additional Workstreams
- none
