# Task Graph

## Summary
This task graph is validation-first. It does not start implementation code. It sequences the unresolved validation questions before API contract finalization and implementation readiness.

## Frozen Inputs
- [REQUIREMENT_FREEZE.json](/home/administrator/code/review-then-codex-system/docs/downstream-planning/sku-inventory-sales-analysis/REQUIREMENT_FREEZE.json)
- [ARCHITECTURE_FREEZE.json](/home/administrator/code/review-then-codex-system/docs/downstream-planning/sku-inventory-sales-analysis/ARCHITECTURE_FREEZE.json)

## Priority Sequence
| Order | Task | Primary Question | Output |
| --- | --- | --- | --- |
| 1 | Validate canonical SKU key across ERP APIs | `q_008` | SKU identifier mapping evidence produced; status `tests_red` pending ERP API field inventories |
| 2 | Validate default local warehouse identifier | `q_014` | Default local warehouse evidence |
| 3 | Freeze ERP source mapping and normalized record contracts | `q_008`, `q_014` | Source mapping matrix and normalized record contracts |
| 4 | Validate time-dimension ERP API derivation path | `q_016` | Derivation trace evidence |
| 5 | Finalize default_local_wid or explicit local warehouse mapping rule | `q_018` | Local warehouse mapping rule decision |
| 6 | Freeze V1 API contract and response fixtures | all four | API contract and response fixtures |
| 7 | Assemble validation evidence plan and boundary review gate | all four | Evidence plan and boundary gate |
| 8 | Prepare implementation readiness handoff | all four | Go/no-go implementation readiness package |

## Task Details
| ID | Title | Inputs | Outputs | Depends On | Validation |
| --- | --- | --- | --- | --- | --- |
| `8f4373c0-bf76-4ba6-aaab-616ba48e2d33` | Validate canonical SKU key across ERP APIs | Requirement freeze, architecture freeze, ERP API field descriptions | `q_008` evidence, canonical SKU key candidate, raw SKU reference inventory | none | Artifact review of SKU mappings across required ERP API surfaces |
| `efd4174d-9a4a-4d83-b27e-da8b2013dd1c` | Validate default local warehouse identifier | `q_008` evidence, ERP warehouse/inventory API fields | `q_014` evidence, local warehouse candidate list, `q_018` required/not-required signal | `8f4373c0-bf76-4ba6-aaab-616ba48e2d33` | Artifact review against representative inventory records |
| `dd3ec2ba-dabf-4110-8e36-c7ed207acbd2` | Freeze ERP source mapping and normalized record contracts | `q_008` evidence, `q_014` evidence, frozen requirement and architecture | ERP source mapping matrix, normalized source record contract, provenance requirements | `8f4373c0-bf76-4ba6-aaab-616ba48e2d33`, `efd4174d-9a4a-4d83-b27e-da8b2013dd1c` | Contract completeness review against required metric inputs |
| `a89dc964-2495-45de-bbe6-664214a79fa2` | Validate time-dimension ERP API derivation path | Source mapping matrix, normalized record contract, representative SKU samples | `q_016` derivation evidence, metric trace contract, derivable/not-derivable decision | `dd3ec2ba-dabf-4110-8e36-c7ed207acbd2` | Representative SKU derivation trace review |
| `43c2d229-b70d-4a34-bc5e-19449cb99ba6` | Finalize default_local_wid or explicit local warehouse mapping rule | `q_014` evidence, `q_016` outcome, local warehouse candidates | `q_018` mapping rule, default_local_wid decision, mappingMode values | `a89dc964-2495-45de-bbe6-664214a79fa2` | Mapping rule review against single/multiple local warehouse scenarios |
| `ac5f6272-a29c-405e-b647-0edfd74e632a` | Freeze V1 API contract and response fixtures | `q_008`, `q_014`, `q_016`, `q_018` outputs and architecture freeze | V1 API contract, response fixtures, contract review checklist | `43c2d229-b70d-4a34-bc5e-19449cb99ba6` | Contract review for required metrics, mapping metadata, and derivation metadata |
| `462d201b-f1b4-46bd-8f43-2d6f72e98b83` | Assemble validation evidence plan and boundary review gate | API contract, source mapping, derivation trace, warehouse mapping, frozen artifacts | Validation evidence plan, boundary review gate, evidence manifest template | `ac5f6272-a29c-405e-b647-0edfd74e632a` | Evidence coverage review against all requirement acceptance criteria |
| `034e0a9f-164d-46f5-bcf9-fc0e003c0c71` | Prepare implementation readiness handoff | Validation evidence plan, API contract, source mapping, derivation evidence, warehouse mapping evidence | Implementation readiness package, go/no-go decision, implementation sequencing notes | `462d201b-f1b4-46bd-8f43-2d6f72e98b83` | Readiness gate review |

## Dependency Shape
`q_008 -> q_014 -> source mapping -> q_016 -> q_018 -> API contract -> validation gate -> implementation readiness`

## Task 1 Execution Result
- Status: `tests_red`
- Evidence ID: `c5113b1c-b641-437d-b419-0678cf3f70af`
- Evidence file: [q_008-canonical-sku-key-evidence.md](/home/administrator/code/review-then-codex-system/docs/downstream-planning/sku-inventory-sales-analysis/evidence/source-mapping/q_008-canonical-sku-key-evidence.md)
- Required ERP input checklist: [q_008-required-erp-api-inputs.md](/home/administrator/code/review-then-codex-system/docs/downstream-planning/sku-inventory-sales-analysis/evidence/source-mapping/q_008-required-erp-api-inputs.md)
- Reason: Lingxing documentation provides a strong candidate field set, but Task 1 still lacks same-SKU cross-interface payload evidence to prove the canonical join rule and API statistics chain entry point.

## Boundary Guardrails
- Do not modify `docs/project-preparation/**`.
- Do not start implementation under `services/sku-analysis-service/src/**` during this planning step.
- Do not add WMS, DB-table, Excel/CSV, or other-system source paths.
- Do not make export or dashboard work part of default v1.
- Do not claim implementation readiness while any required validation output is missing.

## Structured Artifact
- [TASK_GRAPH.json](/home/administrator/code/review-then-codex-system/docs/downstream-planning/sku-inventory-sales-analysis/TASK_GRAPH.json)
