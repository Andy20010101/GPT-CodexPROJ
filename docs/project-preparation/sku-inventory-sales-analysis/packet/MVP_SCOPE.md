# MVP Scope

## Core Deliverable
An API-first SKU analysis service that uses ERP APIs as the core source boundary and returns current inventory, default-local-warehouse quantity, 30-day outbound, turnover days, and 30/60/90-day sales volume for v1 consumers.

## In Scope
- ERP APIs as the primary source boundary for required v1 data.
- SKU as the analysis grain for all v1 responses.
- Current inventory in the response contract.
- Default warehouse quantity in the response contract, treated as the local-warehouse business concept. If multiple local warehouses exist, `default_local_wid` or an explicit mapping must be configured; v1 must not assume a naturally unique local warehouse.
- 30-day outbound and turnover-days calculation in the response contract.
- 30/60/90-day sales-volume metrics in the response contract.
- Time-dimension metric derivation by aligning multiple ERP APIs when a single direct linkage does not exist.
- Day-level refresh expectations rather than real-time delivery.

## Scope Notes
This scope is intentionally narrow: the first version is a data service contract, not a user-facing dashboard or generalized analytics platform. The service should stay centered on ERP APIs as the source boundary even when time-dimension metrics require derived calculations across multiple ERP API surfaces. Consumer-interface constraints belong to boundary shaping rather than the core business scope.

## Why This Scope Is Enough
This MVP is enough because it delivers the missing SKU-level business metrics through one bounded API surface, which is the immediate capability gap, while deferring adjacent presentation, platform, and multi-system concerns that would slow convergence.
