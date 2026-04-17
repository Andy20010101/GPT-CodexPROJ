# q_008 Required ERP API Inputs

## Purpose
This document lists the minimum real ERP API evidence now needed to turn Task 1 from `tests_red` to `tests_green`.

Field candidates are no longer completely unknown. Lingxing documentation already provides a strong candidate field set. The remaining blocker is a real same-SKU cross-interface payload comparison that proves which field or field mapping can safely join the v1 interfaces.

This is not only a field checklist. The real validation target is whether ERP APIs can support the missing SKU-level sales-statistics chain:

```text
same SKU identity
  -> sales quantity
  -> inventory / warehouse quantity
  -> business date or collection date
  -> stable time-window aggregation
```

Task 1 only turns green when the same logical SKU can be traced across the relevant interfaces. A sales or inventory field alone is not enough.

## What To Provide Next
Provide a same-SKU payload crosswalk for one representative SKU across the following 4 required interface categories, plus the FBA/source report side if it is part of the actual evidence path.

Sensitive values may be masked, but the same logical value must stay consistent across samples. Example: if a SKU is masked as `SKU_A` in one payload, use `SKU_A` everywhere it is the same value.

## 1. Product Performance / SKU Reference Candidate

Endpoint:

```text
/bd/productPerformance/openApi/asinList
```

Provide one sample object or row containing:

```json
{
  "local_sku": "LOCAL_SKU_A",
  "seller_sku": "SELLER_SKU_A",
  "asin": "ASIN_A",
  "parent_asin": "PARENT_ASIN_A",
  "sid": "SELLER_SCOPE_A",
  "local_name": "MASKED_PRODUCT_NAME"
}
```

Need to prove:

- whether `local_sku` maps one-to-one to `seller_sku`
- whether `asin` is child-level or parent-level in this payload
- whether `sid` is required to scope `seller_sku` or `asin`

## 2. Sales Statistics

Endpoints:

```text
/erp/sc/data/sales_report/sales
/erp/sc/data/sales_report/asinDailyLists
```

Provide one sample object or row containing:

```json
{
  "seller_sku": "SELLER_SKU_A",
  "asin": "ASIN_A",
  "r_date": "2026-04-14",
  "volume": 10,
  "order_items": 8,
  "amount": 1234.56
}
```

Need to prove:

- whether `seller_sku` matches the product-performance `seller_sku`
- whether `asin` matches the product-performance `asin`
- whether `volume` or `order_items` is the correct quantity field for later sales derivation
- whether the sales record is scoped by seller/account even if `sid` is not present in the row
- whether `r_date` is the business date that can be used for 30/60/90-day windows

## 3. Platform Statistics

Endpoint:

```text
/basicOpen/platformStatisticsV2/saleStat/pageList
```

Provide one sample object or row containing:

```json
{
  "sku": "SKU_A",
  "msku": "SELLER_SKU_A",
  "mskuId": "MSKU_ID_A",
  "spu": "SPU_A",
  "parentAsin": "PARENT_ASIN_A",
  "sid": "SELLER_SCOPE_A",
  "date_collect": "2026-04-14",
  "volumeTotal": 10
}
```

Need to prove:

- whether `msku` equals or maps to sales `seller_sku`
- whether `sku` equals or maps to product `local_sku` or warehouse `sku`
- whether `mskuId` is a stable internal listing identifier
- whether `sid` must be part of the join key for `msku` or `sku`
- whether `parentAsin` maps to `parent_asin`
- whether `date_collect` and `volumeTotal` can be reconciled with sales-report date and quantity fields

## 4. Local Product / Inventory Identity

### 4.1 Local product list

Endpoint:

```text
/erp/sc/routing/data/local_inventory/productList
```

User-provided screenshot evidence shows this endpoint accepts:

- `sku_list`
- `sku_identifier_list`

This means there is already a queryable local-product identity surface in the ERP, but the exact semantic relation between `sku`, `sku_identifier_list`, and sales-side `seller_sku` / `msku` is still not proven.

Need to prove:

- whether `sku_identifier_list` is the stable local-product identity used across downstream surfaces
- whether `sku_list` is simply a filter alias over the same identity
- whether these fields map to sales `seller_sku` / `msku` or only to local product management data

### 4.2 Local product classification

User-provided screenshot evidence also shows:

- `is_combo`: `0 = 否, 1 = 是`

This is strong evidence for combo-vs-single product classification. It should be treated as a product attribute, not a canonical SKU key.

Need to prove:

- whether `is_combo` is available on the same record as the local product identity fields
- whether `is_combo` should be carried into the normalized record as classification metadata
- whether any combo-product mapping needs to be stored separately from the canonical SKU key

### 4.3 Local warehouse inventory detail

Endpoint:

```text
/inventory/center/openapi/storageReport/local/detail/page
```

Provide one sample object or row containing:

```json
{
  "sku": "SKU_A",
  "fnsku": "FNSKU_A",
  "spu": "SPU_A",
  "spu_name": "MASKED_PRODUCT_NAME",
  "seller_name": "MASKED_SELLER_NAME",
  "sys_wid": "LOCAL_WID_A"
}
```

Need to prove:

- whether warehouse `sku` equals platform `sku`, product `local_sku`, or another mapped value
- whether `fnsku` maps to ASIN/SKU or is only warehouse/FBA provenance
- whether `spu` matches platform `spu`
- whether `sys_wid` is needed only for warehouse scoping, not SKU identity
- whether `day_end_count` or another quantity field is the candidate warehouse inventory quantity for the same logical SKU

## 5. FBA / Source Report Side If Used

Endpoint:

```text
exact endpoint(s) TBD by the ERP evidence path
```

Provide one sample object or row containing the fields available from that report:

```json
{
  "local_sku": "LOCAL_SKU_A",
  "seller_sku_or_msku": "SELLER_SKU_A",
  "sku": "SKU_A",
  "asin": "ASIN_A",
  "fnsku": "FNSKU_A",
  "seller_id_or_sid": "SELLER_SCOPE_A",
  "wid": "WID_A"
}
```

Need to prove:

- whether this side provides a bridge from `local_sku` to `seller_sku`/`msku`
- whether it bridges `fnsku` to `asin` or `sku`
- whether `seller_id` / `sid` / `wid` are required scoping fields

## Cross-Interface Payload Comparison Table
Fill this table for the same SKU.

| Interface | Endpoint | local_sku | seller_sku / msku | sku | mskuId | asin | fnsku | spu | sid / seller_id | sys_wid / wid | date field | quantity field | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Product performance | `/bd/productPerformance/openApi/asinList` |  |  |  | n/a |  | n/a | n/a |  | n/a | n/a | n/a |  |
| Sales statistics | `/erp/sc/data/sales_report/sales` or `/erp/sc/data/sales_report/asinDailyLists` | n/a |  | n/a | n/a |  | n/a | n/a |  | n/a | `r_date` | `volume` / `order_items` / `amount` |  |
| Platform statistics | `/basicOpen/platformStatisticsV2/saleStat/pageList` | n/a | `msku` | `sku` |  | n/a or parent only | n/a |  |  | n/a | `date_collect` | `volumeTotal` |  |
| Local product list | `/erp/sc/routing/data/local_inventory/productList` | n/a or local product id | n/a | `sku` / `sku_identifier_list` | n/a | n/a | n/a |  |  |  | n/a | n/a | candidate local identity surface |
| Local product classification | same local product record or detail payload |  |  |  |  |  |  |  |  |  | n/a | n/a | `is_combo` is classification metadata, not identity |
| Local warehouse inventory | `/inventory/center/openapi/storageReport/local/detail/page` | n/a | n/a |  | n/a | n/a |  |  | seller name or scope if present |  | n/a | inventory qty if present |  |
| FBA/source report | TBD |  |  |  | n/a |  |  |  |  |  |  |  | optional |

## Chain Viability Checks
After filling the table, answer these questions:

| Check | Required Answer |
| --- | --- |
| Can one logical SKU be traced across product performance, sales statistics, platform statistics, and local warehouse inventory? | yes/no |
| Which field or mapping is the strongest same-SKU chain? | e.g. `local_sku -> seller_sku/msku -> sku` |
| Does `sid` or `seller_id` need to be part of the join key? | yes/no/unknown |
| Does `sys_wid` or `wid` scope only warehouse quantity, or also affect SKU identity? | warehouse only / affects identity / unknown |
| Which sales quantity field should feed SKU sales statistics? | `volume` / `order_items` / `volumeTotal` / other |
| Which date field should define sales windows? | `r_date` / `date_collect` / other |
| Which warehouse quantity field should feed local inventory quantity? | `day_end_count` / `quantity` / other |
| Are any fields only raw refs, not keys? | list `asin`, `fnsku`, `spu`, parent ASIN, etc. |

## Task 1 Green Review Rule
Task 1 can move from `tests_red` to `tests_green` only when:

- the same logical SKU is shown across the relevant 4-5 interface categories,
- the comparison proves whether the safest canonical key is `local_sku`, `sku`, `seller_sku`/`msku`, or a mapping through `mskuId`,
- scoping fields such as `sid` / `seller_id` / `sys_wid` / `wid` are identified where required,
- the payloads include enough quantity and date context to show the API chain is viable for the later q_016 sales-window derivation,
- false-key risks are documented for `asin`, `fnsku`, `spu`, and parent ASIN fields,
- conflicts are resolved or explicitly carried as implementation risks.
