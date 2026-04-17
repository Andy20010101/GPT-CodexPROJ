# Repository Boundaries

This repository is the platform monorepo for `GPT-CodexPROJ`. It is not the place to vendor every downstream project, nested repo, or ad hoc import.

## In Scope

- `apps/`, `services/`, `packages/`, and `scripts/`
- platform-facing docs under `docs/architecture/`
- workflow assets such as preparation packets and downstream planning examples under `docs/`
- curated legacy references under `references/legacy/` when keeping them in-tree is intentional and documented

## Out Of Scope

- nested Git repositories inside the monorepo worktree
- customer/domain repos under `repos/`
- Finder/zip extraction garbage such as `__MACOSX`
- temporary file drops or legacy imports under `files/`

## Current Local Convention

- `1688-platform-skill` is treated as an external sibling repository, not a vendored directory in this monorepo
- a local checkout path such as `../1688-platform-skill` is acceptable for operator work
- the corresponding preparation packet may remain under `docs/project-preparation/1688-platform-skill/` as a platform-side archive until that packet is migrated with the external repo

## Legacy References

- imported historical material that still helps explain design choices belongs under `references/legacy/`
- the old ChatGPT CLI snapshot now lives at `references/legacy/ChatGPTCLI/`
- legacy references are read-only context, not active runtime dependencies

## Guardrails

- `repos/` and `files/` are ignored at the root to prevent accidental reintroduction
- if a project needs its own `.git`, publish it as its own repository instead of nesting it here
- if imported material is worth preserving, move it into a named, documented `references/legacy/` location instead of leaving it as an opaque dump
