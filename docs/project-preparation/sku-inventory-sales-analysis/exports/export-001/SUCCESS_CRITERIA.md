# Success Criteria

## Success Definition
The project counts as successful when v1 delivers a usable API-first SKU analysis service whose core source boundary remains ERP APIs, whose required metric contract is complete, and whose time-dimension metrics can be shown to come from explicit multi-API alignment and derivation rather than hidden fallback or scope expansion.

## Required Evidence
- API-contract evidence showing SKU, current inventory, default-local-warehouse quantity, 30-day outbound, turnover days, and 30/60/90-day sales volume in the v1 response shape.
- Validation evidence on representative SKUs showing that 30-day outbound and 30/60/90-day sales metrics match the agreed business definitions when derived from ERP APIs.
- Configuration evidence showing how `default_local_wid` or explicit local-warehouse mapping is supplied when multiple local warehouses exist.
- Review evidence that source-side integration remains bounded to ERP APIs and that any allowed extra interface is consumer-side only.
- Operator-visible evidence that the service is designed for day-level refresh rather than real-time delivery.

## Failure Conditions
- Shipping a service that omits any required metric from the agreed v1 contract.
- Producing time-dimension metrics without clear evidence of how they were derived from ERP APIs.
- Relying on hidden non-API ingestion, silent source-side system expansion, or an unapproved fallback to make the service appear complete.
- Leaving default-local-warehouse selection ambiguous when multiple local warehouses exist.
- Delivering only presentation or export artifacts while the approved API contract remains incomplete.

## Notes
An optional extra consumer-side interface is not required for success. Export is not part of the default success definition, but it may later become an explicit fallback only after a separate validated decision if ERP API derivation proves insufficient.
