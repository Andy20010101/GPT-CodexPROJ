# Release Review

Run acceptance is intentionally separate from task acceptance. A run can contain several accepted tasks and still fail the final release gate if the combined outcome is not ready.

## Why Release Review Exists

Task review answers whether one task is acceptable. Release review answers whether the whole run is acceptable.

The release-level check exists to catch issues that are easy to miss at task scope:

- gaps between accepted tasks
- unresolved limitations that are individually tolerable but collectively risky
- missing end-to-end coverage
- architecture drift across multiple patches

For that reason, run acceptance is not a manual status flip. It must consume structured release review output first.

## Release Review Inputs

`ReleaseReviewService` aggregates:

- the run summary
- accepted tasks
- latest execution summaries for those tasks
- task-review finding summaries already written to evidence
- outstanding limitations derived from task notes
- related evidence ids for later traceability

It converts that data into a `ReleaseReviewRequest`, sends it through the bridge client, and expects structured review output back.

## Bridge Flow

The release review path mirrors task review, but at run scope:

1. build `ReleaseReviewRequest`
2. write `request.json`
3. open bridge session and select project
4. start a release review conversation
5. wait for completion
6. export markdown
7. extract structured review JSON
8. persist `result.json`, `review.md`, and `structured-review.json`
9. map the structured result into `release_gate`

If structured output is missing, the release review still writes evidence and fails closed.

## Gate Mapping

`ReleaseGateService` maps structured status to `release_gate`:

- `approved`: pass
- `changes_requested`: fail
- `rejected`: fail
- `incomplete`: fail

Only a passing `release_gate` written by `ReleaseGateService` allows `RunAcceptanceService` to move the run to `accepted`.

## Run Acceptance

`RunAcceptanceService` checks:

- run stage is `release_review`
- all tasks are already `accepted`
- the latest `release_gate` passed and was produced by `release-gate-service`
- the final `acceptance_gate` also passes

If any of those checks fail, acceptance is blocked.

## Artifacts

Release review artifacts are stored at:

```text
apps/orchestrator/artifacts/runs/<runId>/releases/<releaseReviewId>/
  request.json
  result.json
  review.md
  structured-review.json
```

The evidence ledger references those files using:

- `release_review_request`
- `release_review_result`
- `release_markdown`
- `release_structured_review`
- `gate_result`
- `run_acceptance`

This keeps the main ledger structured and lightweight while leaving full review payloads on disk.
