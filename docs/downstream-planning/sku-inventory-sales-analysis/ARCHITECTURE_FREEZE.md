# Architecture Freeze

## Summary
The v1 architecture is frozen as a layered ERP-only SKU analysis service. The main runtime path is:

`consumer -> API Surface -> Analysis Application -> ERP Source Gateway -> Source Normalization -> Canonical Mapping -> Metric Derivation -> assembled API response`

Validation and evidence are a sidecar path that can inspect raw, normalized, derived, and assembled outputs without becoming a second production data path.

## Module Boundaries
- `API Surface`
  Owns the outward v1 contract, request validation, and response serialization.
- `Analysis Application`
  Orchestrates query flow, refresh cadence, and response assembly.
- `ERP Source Gateway`
  Owns all ERP API transport, auth, pagination, and raw endpoint models.
- `Source Normalization`
  Converts raw ERP payloads into normalized internal records with provenance.
- `Canonical Mapping`
  Resolves canonical SKU identity and default local-warehouse semantics.
- `Metric Derivation`
  Builds daily facts and required business metrics from normalized records plus mapping decisions.
- `Validation And Evidence`
  Runs representative-SKU validation, emits derivation traces, discrepancy reports, and source-boundary review evidence.

## Interface Layering
1. `Consumer-facing layer`
   `API Surface` is the only layer exposed to consumers.
2. `Use-case layer`
   `Analysis Application` is the only layer that coordinates end-to-end analysis flow.
3. `Source access layer`
   `ERP Source Gateway` is the only layer allowed to talk to ERP APIs.
4. `Semantic shaping layer`
   `Source Normalization` and `Canonical Mapping` convert raw ERP transport data into business-usable records and decisions.
5. `Business metric layer`
   `Metric Derivation` computes 30-day outbound, 30/60/90-day sales, and turnover days.
6. `Validation sidecar layer`
   `Validation And Evidence` inspects the same pipeline for proof, but does not add a second source path.

## Data Flow

## Runtime Query Flow
1. Consumer sends a SKU analysis request to `API Surface`.
2. `API Surface` validates request shape and forwards it to `Analysis Application`.
3. `Analysis Application` requests raw SKU, inventory, movement, and sales data through `ERP Source Gateway`.
4. `Source Normalization` converts ERP payloads into normalized records with explicit timestamps, quantities, and identifiers.
5. `Canonical Mapping` resolves the canonical SKU key and the default local warehouse semantics.
6. `Metric Derivation` builds daily facts and computes required windows and turnover days.
7. `Analysis Application` assembles the final response.
8. `API Surface` serializes the approved contract back to the consumer.

## Refresh Flow
1. `Analysis Application` triggers a day-level refresh workflow.
2. The same ERP-only retrieval, normalization, mapping, and derivation pipeline runs.
3. Refreshed facts or response-ready aggregates become the day-level basis for consumer queries.

## Validation Flow
1. `Validation And Evidence` selects representative SKUs.
2. It retrieves raw ERP payloads through `ERP Source Gateway`.
3. It replays normalization, mapping, and derivation.
4. It compares raw payloads, normalized records, derived metrics, and final assembled responses.
5. It emits derivation traces, discrepancy reports, and boundary review evidence.

## Key Validation Points
- `q_008`: canonical SKU key
  Validation point sits between `ERP Source Gateway` and `Canonical Mapping`. No stable cross-endpoint join should be trusted until this is resolved.
- `q_014`: default local warehouse identifier
  Validation point sits inside `Canonical Mapping`. Default-local-warehouse quantity is not trustworthy until the business concept maps to a concrete ERP warehouse identifier.
- `q_016`: ERP API linkage for time-dimension metrics
  Validation point sits between `Source Normalization` and `Metric Derivation`. Required outbound and sales windows must be derivable from normalized ERP records with traceable lineage.
- `q_018`: exact `default_local_wid` or explicit mapping rule
  Validation point sits after `q_014`. It becomes a configuration freeze only if the ERP actually exposes multiple relevant local warehouses.

## Architecture Invariants
- Only `ERP Source Gateway` may call ERP APIs.
- `API Surface` cannot compute business metrics or direct ERP joins.
- `Metric Derivation` cannot read raw ERP transport models directly.
- Canonical SKU identity must be resolved before cross-endpoint aggregation.
- Default local-warehouse selection must be explicit before warehouse quantity reaches the outward API.
- Validation remains a sidecar concern, not an alternate runtime source path.
- Export and non-API fallback are not part of default v1 architecture.
- No dashboard or broad data-platform layer exists in this architecture freeze.

## Primary Dependency Intent
- `API Surface -> Analysis Application`: allowed
- `Analysis Application -> ERP Source Gateway / Source Normalization / Canonical Mapping / Metric Derivation`: allowed
- `Source Normalization -> ERP Source Gateway`: allowed
- `Metric Derivation -> Canonical Mapping`: allowed
- `API Surface -> ERP Source Gateway`: denied
- `API Surface -> Metric Derivation`: denied
- `Metric Derivation -> ERP Source Gateway`: denied
- `Validation And Evidence -> Analysis Application / ERP Source Gateway / Source Normalization / Canonical Mapping / Metric Derivation`: allowed

## Supporting Files
- [ARCHITECTURE_FREEZE.json](/home/administrator/code/review-then-codex-system/docs/downstream-planning/sku-inventory-sales-analysis/ARCHITECTURE_FREEZE.json)
- [REQUIREMENT_FREEZE.json](/home/administrator/code/review-then-codex-system/docs/downstream-planning/sku-inventory-sales-analysis/REQUIREMENT_FREEZE.json)
- [REQUIREMENT_FREEZE_ENGINEERING_PLAN.md](/home/administrator/code/review-then-codex-system/docs/downstream-planning/sku-inventory-sales-analysis/REQUIREMENT_FREEZE_ENGINEERING_PLAN.md)
