# Requirement Freeze Engineering Plan

## Summary
V1 will be implemented as a narrow API-first SKU analysis service that stays source-bounded to ERP APIs and returns the full approved metric contract: current inventory, default-local-warehouse quantity, 30-day outbound, turnover days, and 30/60/90-day sales volume. The plan below is implementation-oriented and assumes the preparation packet is frozen input rather than something to reopen.

## Objectives
- Ship a usable v1 API contract for SKU-level inventory-cycle and sales analysis.
- Keep the source boundary on ERP APIs even when time-window metrics require multi-API alignment and derived computation.
- Resolve the minimum identifier and warehouse semantics needed to make the contract correct.
- Produce explicit validation evidence for time-dimension derivation before counting the service as complete.

## Non-Goals
- No WMS or other internal systems as source inputs in v1.
- No dashboard, reporting, or export flow as default v1 deliverables.
- No generic data-platform abstraction, cross-system sync program, or real-time pipeline.
- No assumption that time-window metrics come from one direct ERP endpoint.

## Hard Constraints
- ERP APIs are the only source-side integration boundary for v1.
- SKU remains the business grain for all responses.
- Default warehouse quantity must be treated as the local-warehouse business concept.
- If multiple local warehouses exist, `default_local_wid` or explicit mapping is required; uniqueness must not be assumed.
- Day-level refresh is sufficient for v1.
- Export is only a later validated fallback, not default delivery.

## Key Risks
- ERP API linkage for 30-day outbound and 30/60/90-day sales may require non-trivial cross-endpoint normalization.
- The canonical SKU key may differ across ERP API surfaces and break joins if not resolved first.
- The local-warehouse concept may be represented differently from the warehouse used in inventory or movement APIs.
- Consumer-specific pressure may try to widen the contract before the minimum metric pipeline is stable.

## Engineering Plan

## Phase 1: ERP API Source Mapping
- Build a source mapping matrix for every required contract field:
  - `sku_key`
  - `current_inventory_qty`
  - `default_local_warehouse_qty`
  - `outbound_event_qty`
  - `sales_event_qty`
  - `event_time`
  - `warehouse_id`
  - raw identifiers needed for traceability
- For each ERP API involved, record:
  - endpoint name
  - request shape
  - pagination/limit behavior
  - time filters
  - SKU identifier field
  - warehouse field
  - quantity field
  - update timestamp / business timestamp
- Introduce one normalized internal source model before business derivation:
  - `SkuMasterRecord`
  - `InventorySnapshotRecord`
  - `MovementEventRecord`
  - `SalesEventRecord`
- Keep raw ERP identifiers in normalized records until `q_008` is validated. Do not collapse to one canonical key too early.

## Phase 2: Time-Dimension Metric Derivation
- Derive time-window metrics from normalized ERP records rather than directly from endpoint responses.
- Recommended derived layers:
  - inventory snapshot layer for current inventory and local-warehouse quantity
  - daily movement layer for outbound aggregation
  - daily sales layer for 30/60/90 aggregation
- Working derivation path:
  - map raw ERP records to canonical SKU key
  - normalize event timestamps to one business date rule
  - classify outbound vs sales source events explicitly
  - aggregate daily per-SKU facts
  - roll up 30-day outbound and 30/60/90-day sales windows
  - compute `turnover_days = current_inventory_qty / max(outbound_30d_qty / 30, epsilon)`
- Do not freeze the exact event classification rule until `q_016` is validated against live ERP API behavior.
- If ERP APIs expose both order and movement concepts, prefer movement data for outbound and sales/order data for sales volume unless validation proves otherwise.

## Phase 3: V1 API Contract
- Start from one main query surface, not a broad endpoint set.
- Recommended v1 contract shape:

```json
{
  "skuKey": "string",
  "rawSkuRefs": {
    "erpSkuId": "string"
  },
  "asOfDate": "YYYY-MM-DD",
  "inventory": {
    "currentQty": 0,
    "defaultLocalWarehouseQty": 0,
    "defaultLocalWarehouseId": "string",
    "mappingMode": "configured_default_local_wid | explicit_mapping | single_local_warehouse"
  },
  "outbound": {
    "last30DaysQty": 0
  },
  "sales": {
    "last30DaysQty": 0,
    "last60DaysQty": 0,
    "last90DaysQty": 0
  },
  "turnoverDays": 0,
  "derivationMeta": {
    "inventorySnapshotAt": "ISO-8601",
    "salesWindowEndDate": "YYYY-MM-DD",
    "outboundWindowEndDate": "YYYY-MM-DD",
    "sourceMode": "erp_api_only"
  }
}
```

- Contract rules:
  - `skuKey` is the canonical API field, but raw ERP references stay present until identifier confidence is high.
  - `defaultLocalWarehouseId` is required in the response once `q_014` is resolved.
  - `mappingMode` must show how local-warehouse quantity was chosen when multiple local warehouses exist.
  - Time-window metrics must be returned together so consumer code does not need to stitch windows itself.
- Endpoint recommendation:
  - one batch query endpoint for v1 primary usage
  - one single-SKU detail endpoint only if the first consumer actually needs it
- Keep the optional extra interface outside the main plan until a concrete consumer need appears.

## Phase 4: Validation Plan
- Validation must run on representative SKUs, not synthetic-only data.
- Build a validation sample set with at least:
  - fast-moving SKU
  - slow-moving SKU
  - zero-sales SKU with inventory
  - SKU with recent outbound but no sales, if such a case exists
  - SKU spanning multiple local warehouses, if such a case exists
- For each sample SKU, compare:
  - raw ERP API payloads
  - normalized internal records
  - derived 30-day outbound
  - derived 30/60/90 sales
  - final API response
- Required validation artifacts:
  - source mapping matrix
  - derivation trace for sample SKUs
  - warehouse mapping/config evidence
  - API response fixtures
  - discrepancy log for any metric mismatch
- Fail closed on:
  - unresolved canonical SKU join
  - ambiguous local warehouse selection
  - untraceable time-window aggregation
  - silent dependence on non-API source data

## Validation Order For Unfrozen Questions
1. `q_008` canonical SKU key
   Reason: every API join and every derived metric depends on one stable cross-endpoint SKU identity.
2. `q_014` default local warehouse identifier in ERP API
   Reason: the required warehouse quantity field cannot be trusted until the business concept is attached to a concrete ERP warehouse identifier.
3. `q_016` time-dimension ERP API linkage
   Reason: this is the highest implementation-risk item and determines whether required outbound/sales windows are derivable inside the approved API-only boundary.
4. `q_018` exact `default_local_wid` / local-warehouse mapping rule
   Reason: this depends on what `q_014` reveals. If the ERP effectively has one local warehouse, this becomes trivial; if not, it becomes a configuration decision after the warehouse surface is known.

## Recommended Execution Sequence
1. Validate `q_008` and produce the SKU mapping matrix.
2. Validate `q_014` and identify whether a single local warehouse exists or multiple local warehouses require configuration.
3. Build normalized source records and a traceable derivation harness.
4. Validate `q_016` on real ERP APIs with representative SKUs.
5. Resolve `q_018` only if multiple local warehouses actually need explicit configuration.
6. Freeze the outward API contract on top of validated source and derivation semantics.
7. Implement API handlers, refresh job, and validation fixtures together.

## Acceptance Gates For Implementation Start
- Implementation may start once `q_008` and `q_014` are validated.
- Full metric delivery may not be declared complete until `q_016` is validated on representative SKUs.
- API contract may not be marked production-ready until `q_018` is either resolved or proven unnecessary by ERP warehouse reality.

## Immediate Next Actions
- Create the ERP API source mapping matrix and validation worksheet.
- Schedule live validation for `q_008` and `q_014` first.
- Prepare a derivation spike for `q_016` using a small SKU sample before building the final API surface.
