# Project Preparation Workflow Phase 1 Prompt

Use this prompt for the first implementation round of the process-first preparation workflow.

```text
You are working in `/home/administrator/code/GPT-CodexPROJ`.

This thread is only for preparation-layer design and documentation. Do not change runtime semantics.

Read first:

- `/home/administrator/code/GPT-CodexPROJ/docs/architecture/PROJECT_PREPARATION_WORKFLOW.md`
- `/home/administrator/code/GPT-CodexPROJ/docs/architecture/PROJECT_PREPARATION_SOP.md`
- `/home/administrator/code/GPT-CodexPROJ/docs/architecture/PROJECT_PREPARATION_HARNESS.md`
- `/home/administrator/code/GPT-CodexPROJ/docs/architecture/PARALLEL_DELIVERY_AND_SELF_IMPROVEMENT.md`
- `/home/administrator/code/GPT-CodexPROJ/docs/architecture/PROJECT_PURPOSE_AND_CAPABILITIES.md`

Current objective:

- land Phase 1 of the process-first preparation workflow

Phase 1 scope:

- keep preparation process-first and packet-export-second
- define the workflow stages clearly
- define stop conditions for each stage
- define the convergence gate
- define how packet export relates to the workflow

Do not:

- modify gate semantics
- modify acceptance rules
- modify task graph core semantics
- turn preparation into a code-execution flow
- implement heavy new automation beyond what Phase 1 docs require

Minimum expected output:

- the workflow stages are explicit and readable
- human checkpoints are explicit
- packet export is clearly described as a downstream freeze artifact
- the relationship between `PROJECT_PREPARATION_SOP.md`, `PROJECT_PREPARATION_HARNESS.md`, and `PROJECT_PREPARATION_WORKFLOW.md` is coherent

Likely files to edit:

- `/home/administrator/code/GPT-CodexPROJ/docs/architecture/PROJECT_PREPARATION_WORKFLOW.md`
- `/home/administrator/code/GPT-CodexPROJ/docs/architecture/PROJECT_PREPARATION_SOP.md`
- `/home/administrator/code/GPT-CodexPROJ/docs/architecture/PROJECT_PREPARATION_HARNESS.md`

Working rules:

- keep the patch narrow and documentation-focused
- do not add implementation work for later phases unless required to keep the docs coherent
- if a new file is introduced, link it from the existing preparation docs
- before stopping, verify that the three docs agree on the workflow and boundaries
```
