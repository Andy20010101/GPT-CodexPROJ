# Risks And Assumptions

## Risks
- ERP API linkage for time-dimension metrics may be awkward and require non-trivial multi-API alignment logic.
- The local-warehouse business concept may require explicit `default_local_wid` or mapping configuration where multiple local warehouses exist.
- The first concrete API consumer is not yet fixed, which may later shape contract details or the need for the optional extra consumer-side interface.
- Scope pressure may reappear if export fallback or extra-interface needs are treated as default v1 work instead of later validated expansions.

## Assumptions
- ERP APIs are sufficient as the core source boundary for v1 and can support the required contract directly or through explicit derived calculations.
- SKU remains the stable business grain for the first version.
- Day-level refresh is acceptable for the first version.
- Leadership remains a secondary consumer of the resulting metrics rather than a separate first-version product surface.

## Non-Blocking Unknowns
- The exact ERP field or identifier that should be treated as the canonical SKU key across all relevant APIs.
- The exact default-local-warehouse mapping rule or configured `default_local_wid` when multiple local warehouses exist.
- Which internal frontend or system will become the first concrete API consumer.
- Whether the optional extra consumer-side interface is actually needed in v1 and, if so, for what exact use case.
