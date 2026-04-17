# Architecture Boundary

## Allowed Surfaces
- ERP API integration surfaces required to retrieve SKU, inventory, default-local-warehouse quantity, outbound, and sales data.
- A configuration surface for `default_local_wid` or explicit local-warehouse mapping when a naturally unique local warehouse does not exist.
- Service-side metric derivation logic that aligns and computes time-dimension metrics across multiple ERP APIs.
- The v1 API contract that exposes SKU-level inventory-cycle and sales-analysis results.
- At most one additional interface for another system if it directly supports later v2 iteration without expanding the source boundary beyond ERP APIs.

## Protected Surfaces
- Any integration with WMS, other internal systems, or multi-platform reconciliation flows.
- Non-API ingestion paths such as direct database-table ingestion or Excel/CSV ingestion as default v1 behavior.
- User-facing dashboard work as a required part of the first version.
- Export as a default first-version delivery mode.
- Generic data-platform abstractions or sync-governance work that is broader than the approved v1 service.

## Danger Zones
- Silently introducing non-API fallback just because time-dimension metrics are awkward to derive from ERP APIs.
- Freezing unvalidated ERP API linkage assumptions as if the time-dimension joins were already proven.
- Treating export as a routine parallel delivery surface instead of a later validated fallback choice.
- Expanding the service contract into a broad, presentation-heavy, or multi-system solution while trying to solve one missing metric.
- Treating the optional extra interface allowance as permission to widen the source boundary or integrate multiple other systems.

## Boundary Rationale
The boundary is drawn to keep v1 narrowly focused on one real business gap: SKU-level inventory-cycle and sales analysis sourced from ERP APIs. This preserves a small, reviewable service surface, allows multi-API derived calculations when needed, and prevents the project from drifting into broader system integration, fallback sprawl, or platformization before the core value is proven.
