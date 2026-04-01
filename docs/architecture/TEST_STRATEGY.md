# Test Strategy

This repository uses an architecture-first + TDD approach because browser automation and multi-plane orchestration become brittle quickly when boundaries are implicit.

## Why Architecture-First

The system has three long-lived concerns that should evolve independently:

- orchestration
- browser-backed review
- coding execution

Locking the boundaries first reduces later rewrites when the orchestrator and execution plane become real.

## Why TDD for the Bridge

The bridge combines unstable browser behavior with typed service contracts. The test strategy therefore focuses on:

- deterministic core modules
- explicit error paths
- route-level request and response behavior
- mocked browser and adapter integrations

## Test Boundaries

The initial implementation is expected to cover:

- session lease behavior
- structured output extraction
- artifact manifest persistence
- drift detection failures
- Fastify route behavior for happy path and key error path cases

## Current Automated Coverage

The implemented test suite covers:

- `SessionLease` acquire, release, and conflict handling
- `StructuredOutputExtractor` success and not-found failure cases
- `ArtifactManifestWriter` persistence behavior
- `DriftDetector` selector-missing failure behavior
- route-level health, session open, project select, conversation start, wait, snapshot, markdown export, and structured review extract flows

The integration tests mock the adapter boundary so the bridge HTTP layer, registry, exporters, and failure mapping can be verified without launching a real browser.

## Future Acceptance Tests

Once the orchestrator exists, task-level acceptance tests should verify the full chain:

1. frozen task input
2. bridge review output
3. execution result
4. evidence bundle
