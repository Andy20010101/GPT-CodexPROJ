# q_008 Canonical SKU Key Evidence

## Status
- Evidence ID: `c5113b1c-b641-437d-b419-0678cf3f70af`
- Supersedes evidence ID: `1f82f673-703a-4eb3-9f45-c8075a5a7e56`
- Task ID: `8f4373c0-bf76-4ba6-aaab-616ba48e2d33`
- Question: `q_008`
- Execution status: `tests_red`
- Result: strong candidate key fields are now available from Lingxing ERP API documentation, but Task 1 still cannot turn green until the same SKU is proven across the relevant interfaces with real sample payload crosswalk evidence.
- Updated at: `2026-04-15T06:49:35.000Z`

## Evidence Reviewed
- Repository search found no checked-in real ERP payloads or endpoint field crosswalks.
- User provided Lingxing ERP documentation fields and screenshots for the relevant API surfaces.
- Frozen downstream inputs remain:
  - `REQUIREMENT_FREEZE.json`
  - `ARCHITECTURE_FREEZE.json`
  - `TASK_GRAPH.json`

## Corrected Finding
The issue is not "all field lists are missing."

The corrected Task 1 finding is:

```text
There is now a strong candidate key field set from Lingxing API documentation, but there is not yet real same-SKU payload evidence proving which candidate key joins all required interfaces correctly.
```

## New User-Provided Evidence
The user-provided screenshots add two important facts:

1. The local product interface exposes query fields `sku_list` and `sku_identifier_list` on `/erp/sc/routing/data/local_inventory/productList`.
2. A product field screenshot explicitly defines `is_combo` as `0 = 否, 1 = 是`, meaning it is a product-classification field for combo products, not a canonical identity field by itself.
3. The sales statistics screenshot shows `/erp/sc/data/sales_report/asinDailyLists` supports `asin_type = 2` for `msku`, and the response exposes `seller_sku` as `MSKU`.

These findings strengthen the candidate bridge between local-product identity, sales-side `seller_sku` / `msku`, and product-classification metadata.

4. The FBA inventory report detail screenshot exposes explicit `inventory_turnover_rate` and `inventory_turnover_days` fields, plus supporting inventory-flow cost fields such as `shipments_total_amount`, `whse_transfers_total_amount`, `disposed_total_amount`, and `found_total_amount`. This is strong evidence that at least part of the turnover metric may already be directly exposed by the ERP, rather than requiring fully derived reconstruction from sales-only facts.

## Chain-Level Validation Position
Task 1 is not a field-existence check. It is the first gate in a larger API-chain viability decision:

```text
same single item identity
  -> sales quantity by business date
  -> inventory / warehouse quantity by same item
  -> stable time-window aggregation
  -> usable SKU-level sales statistics
```

The business question is whether ERP APIs can support SKU-level sales statistics that the existing ERP page does not provide directly. Therefore, a field such as `volume`, `day_end_count`, `seller_sku`, or `sku` is useful only if it participates in a stable cross-interface chain for the same logical single item.

Task 1 only answers the identity part of that chain:

- Which field or mapping can represent the same logical SKU across product, sales, platform, warehouse, and optional FBA/source report interfaces?
- Which fields are scope or provenance fields rather than canonical identity?
- Which identity assumptions must be proven before q_016 time-window derivation can be trusted?

If Task 1 cannot establish a stable same-SKU join, then the API path is not yet safe for v1 statistics, even if individual APIs expose sales or inventory fields.

## Available ERP API Field Evidence

| Interface category | Endpoint | Available fields from documentation | q_008 relevance |
| --- | --- | --- | --- |
| Product performance / SKU reference candidate | `/bd/productPerformance/openApi/asinList` | `local_sku`, `seller_sku`, `asin`, `parent_asin`, `sid`, `local_name` | Strong bridge between local SKU, seller SKU, ASIN, and seller/account scope. |
| Sales statistics | `/erp/sc/data/sales_report/sales` and `/erp/sc/data/sales_report/asinDailyLists` | `seller_sku`, `asin`, `r_date`, `volume`, `order_items`, `amount` | Sales windows can likely join by `seller_sku` and/or `asin` with date. |
| Platform statistics | `/basicOpen/platformStatisticsV2/saleStat/pageList` | `sku`, `msku`, `mskuId`, `spu`, `parentAsin`, `sid`, `date_collect`, `volumeTotal` | Strong candidate bridge between platform `sku`/`msku`, internal `mskuId`, product grouping, seller scope, and sales volume. |
| Local warehouse inventory detail | `/inventory/center/openapi/storageReport/local/detail/page` | `sku`, `fnsku`, `spu`, `spu_name`, `seller_name`, `sys_wid` | Inventory-side SKU evidence exists, but must be proven against product/sales SKU fields. |
| FBA / source report side | exact endpoint(s) TBD | `local_sku`, `seller_sku`/`msku`, `sku`, `asin`, `fnsku`, `seller_id`/`sid`/`wid` | Multiple bridge fields exist across source/report surfaces, but payload-level alignment is still required. |

## Strong Candidate Key Set

These fields now belong in the Task 1 evidence pool:

- `local_sku`
- `seller_sku`
- `msku`
- `mskuId`
- `sku`
- `asin`
- `sid` / `seller_id`
- `fnsku`
- `spu`
- `sys_wid` / `wid`

## Candidate Interpretation
- `local_sku` is a strong candidate for local/business SKU identity if it maps consistently to inventory-side `sku` and sales-side `seller_sku`/`msku`.
- `seller_sku` / `msku` are strong listing/SKU bridge candidates across product performance, sales statistics, and platform statistics.
- `mskuId` may be the strongest stable platform-statistics identifier if it can be mapped to `msku` and then to local SKU/inventory SKU.
- `sku` is overloaded across platform statistics and local warehouse inventory; it may be a strong candidate only if same-SKU payloads prove it refers to the same business object in both places.
- `asin` should be treated as a scoped platform/product reference, not sufficient as the only SKU-grain canonical key unless paired with seller/platform context and proven one-to-one for the v1 grain.
- `fnsku` is likely a fulfillment/inventory-side reference and should be preserved as raw provenance unless it maps cleanly to the canonical SKU candidate.
- `spu` / `parent_asin` / `parentAsin` are grouping references and should not be the SKU-grain canonical key.
- `sid`, `seller_id`, `sys_wid`, and `wid` are scope or warehouse/source identifiers, not SKU keys by themselves.

## Provisional Join Model

The strongest current join model is a candidate key graph, not a final canonical key:

```text
local_sku
  <-> seller_sku / msku
  <-> asin scoped by sid / seller_id
  <-> platform sku / mskuId
  <-> local warehouse sku / fnsku scoped by sys_wid or wid
```

This model is plausible based on available fields, but it is not green until one real SKU can be traced through the relevant payloads.

## Recommended Canonical Key Position
Do not freeze a single canonical key yet.

Recommended current position:

```text
canonical key candidate set = { local_sku, seller_sku/msku, mskuId, sku }
required scope refs = { sid/seller_id, sys_wid/wid where applicable }
raw provenance refs = { asin, parent_asin/parentAsin, fnsku, spu }
```

If same-SKU payload evidence shows `local_sku` is stable and maps cleanly to sales `seller_sku`/`msku` and inventory `sku`, prefer `local_sku` as the business canonical key.

If inventory and platform APIs use `sku` as the stable shared ERP key and `local_sku` is only a report alias, prefer `sku`.

If platform statistics require `mskuId` for stable identity, keep `mskuId` as a platform-side stable reference and map it to the chosen canonical key through `msku`/`seller_sku`.

## Current Conflicts / Unknowns
- It is not yet proven whether `local_sku`, `seller_sku`, `msku`, and `sku` are the same value, aliases, or different scoped identifiers.
- It is not yet proven whether `sku` in platform statistics and `sku` in local warehouse inventory are semantically identical.
- It is not yet proven whether `asin` is child ASIN, parent ASIN, or insufficiently granular for SKU-level joins in all cases.
- `sid` / `seller_id` may be required to disambiguate seller-scoped values.
- `fnsku` may be FBA/inventory-specific and may not join to sales statistics directly.
- `spu` and parent ASIN fields are grouping keys and may create false joins if used as SKU keys.

## Minimum Evidence Needed To Turn Green
Provide one same-SKU payload crosswalk across the 4-5 relevant interface categories:

1. `/bd/productPerformance/openApi/asinList`
2. `/erp/sc/data/sales_report/sales` or `/erp/sc/data/sales_report/asinDailyLists`
3. `/basicOpen/platformStatisticsV2/saleStat/pageList`
4. `/inventory/center/openapi/storageReport/local/detail/page`
5. FBA / source report payload, if it is part of the actual v1 evidence path

The crosswalk must show the same real SKU, with sensitive values masked but stable fake values preserved consistently.

The crosswalk must also show enough sales/inventory/time context to prove this is an API chain candidate, not just a field-name match:

- sales quantity candidate: for example `volume`, `order_items`, or `volumeTotal`
- inventory/warehouse quantity candidate: for example `day_end_count` or another quantity field
- business date/time candidate: for example `r_date` or `date_collect`
- scope identifiers where needed: for example `sid`, `seller_id`, `sys_wid`, or `wid`

## Required Crosswalk Columns

| Endpoint category | Required sample fields |
| --- | --- |
| Product performance | `local_sku`, `seller_sku`, `asin`, `parent_asin`, `sid`, `local_name` |
| Sales statistics | `seller_sku`, `asin`, `r_date`, `volume` or `order_items`, `amount` |
| Platform statistics | `sku`, `msku`, `mskuId`, `spu`, `parentAsin`, `sid`, `date_collect`, `volumeTotal` |
| Local warehouse inventory | `sku`, `fnsku`, `spu`, `spu_name`, `seller_name`, `sys_wid` |
| FBA / source report side | `local_sku`, `seller_sku`/`msku`, `sku`, `asin`, `fnsku`, `seller_id`/`sid`/`wid` |

## Current Task 1 Verdict
Task 1 remains `tests_red`, but the red reason is now narrower and more accurate:

```text
Strong candidate SKU key fields exist, but there is not yet same-SKU cross-interface payload evidence proving the canonical join rule.
```

Task 1 can turn green after a same-SKU payload crosswalk proves which field or field mapping reliably joins the required v1 interfaces. This does not by itself prove the full API statistics chain; it only unlocks q_016, where the time-window sales/inventory derivation chain must be validated.
