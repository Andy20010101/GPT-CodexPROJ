# Requirement Freeze

## Title
SKU Inventory Sales Analysis V1 Requirement Freeze

## Summary
V1 is frozen as a narrow API-first SKU analysis service sourced from ERP APIs only. The required metric contract is complete only when the service can return current inventory, default-local-warehouse quantity, 30-day outbound, turnover days, and 30/60/90-day sales volume, with time-dimension metrics derived through explicit multi-API alignment rather than hidden fallback.

## Objectives
- Deliver a usable v1 API contract for SKU-level inventory-cycle and sales analysis.
- Keep the source boundary on ERP APIs while supporting multi-API derivation for time-dimension metrics.
- Resolve the minimum SKU-key and local-warehouse semantics needed to make the contract correct.
- Make validation evidence a first-class delivery requirement for outbound and sales windows.
- Carry unresolved process-side questions forward as validation work instead of freezing them as facts.

## Non-Goals
- No WMS or other internal systems as source inputs in v1.
- No dashboard, report, or export flow as default v1 deliverables.
- No broad data-platform, sync-governance, or reconciliation expansion.
- No assumption that time-window metrics come from one direct ERP endpoint.

## Constraint Summary
- ERP APIs are the only approved source-side integration boundary.
- SKU is the business grain for all v1 responses.
- The required contract includes current inventory, default-local-warehouse quantity, 30-day outbound, turnover days, and 30/60/90-day sales volume.
- Default warehouse means the local-warehouse business concept.
- If multiple local warehouses exist, `default_local_wid` or explicit mapping is required.
- Time-dimension metrics may be derived across multiple ERP APIs.
- No hidden non-API fallback and no default export mode.
- V1 is day-level refresh only.

## Priority Validation Order
1. `q_008`: validate the canonical SKU key across ERP APIs.
2. `q_014`: validate which ERP warehouse represents the default local warehouse.
3. `q_016`: validate the ERP API linkage and derivation path for 30-day outbound and 30/60/90-day sales.
4. `q_018`: finalize `default_local_wid` or explicit mapping only after the local-warehouse model is known.

## Acceptance Focus
- A source mapping matrix must cover every required contract field and explicitly identify the canonical SKU key plus default local warehouse representation.
- The outward API contract must include all approved metrics in one SKU-grain response.
- Time-window metrics must be traceable from raw ERP payloads through normalization and aggregation to final response values.
- Turnover days must follow the approved business definition tied to 30-day outbound.
- Multi-local-warehouse cases must be auditable through explicit mapping/configuration.
- Source-boundary integrity must show no hidden WMS, DB, Excel/CSV, or other-system sourcing in the v1 metric path.

## Supporting Files
- [REQUIREMENT_FREEZE.json](/home/administrator/code/GPT-CodexPROJ/docs/downstream-planning/sku-inventory-sales-analysis/REQUIREMENT_FREEZE.json)
- [REQUIREMENT_FREEZE_ENGINEERING_PLAN.md](/home/administrator/code/GPT-CodexPROJ/docs/downstream-planning/sku-inventory-sales-analysis/REQUIREMENT_FREEZE_ENGINEERING_PLAN.md)
