# Open Questions

## Open
| ID | Stage | Question | Category | Impact | Owner | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| q_001 | clarification | What source surfaces will v1 ingest from Changxiang and VMS first: API, database export, Excel/CSV export, or a hybrid handoff? | source_access | blocking | human | The initial app skeleton will stay file-based, but the authoritative v1 ingestion surface still needs to be frozen. |
| q_002 | clarification | What is the authoritative calculation grain for month-end balances in v1: SKU only, SKU plus warehouse, or SKU plus warehouse plus organization/company? | calculation_grain | blocking | human | The code skeleton defaults to SKU plus warehouse and leaves organization optional until this is confirmed. |
| q_003 | clarification | Which source records or document types must affect inventory quantity and amount in v1, and what sign rule should apply to each inbound, outbound, transfer, and adjustment movement? | movement_rules | blocking | human | Without a frozen sign map, any month-end calculation would remain provisional. |
| q_004 | clarification | What should be treated as the opening balance baseline for each month in v1: prior month-end snapshot, periodic stock statement, reconstructed running ledger, or a mixed rule by source availability? | opening_balance | blocking | human | The current engine supports snapshot plus movement calculation, but the business rule for the authoritative baseline still needs confirmation. |
| q_005 | clarification | When Changxiang and VMS disagree on SKU, warehouse, quantity, or amount, which system should be treated as authoritative for v1, and where should reconciliation exceptions be surfaced? | reconciliation_policy | blocking | human | The initial project assumes both systems may contribute data, but it does not freeze precedence without an explicit policy. |
| q_006 | clarification | How should inventory amount be defined in v1: source snapshot amount, movement document amount, moving-average inventory value, or another accounting rule? | valuation_rule | blocking | human | Quantity change is straightforward, but amount change needs an explicit valuation rule to avoid false precision. |
| q_007 | clarification | What will be the first downstream delivery surface after the core calculation layer is trusted: internal API, export table, BI dataset, or a lightweight reconciliation page? | delivery_surface | non_blocking | human | The current implementation focuses on the underlying calculation layer and keeps downstream delivery shape open. |

## Deferred
| ID | Stage | Question | Category | Impact | Owner | Why Deferred | Revisit At |
| --- | --- | --- | --- | --- | --- | --- | --- |

## Resolved
| ID | Stage | Question | Category | Impact | Owner | Resolution Summary | Resolved At |
| --- | --- | --- | --- | --- | --- | --- | --- |

