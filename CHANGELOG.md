# Changelog

All notable changes to this project should be documented in this file.

The format is based on Keep a Changelog, and this repository currently tracks changes under a pre-`1.0.0` versioning model.

## [Unreleased]

### Changed

- Project naming standardized as `GPT-CodexPROJ`
- Root package naming standardized as `gpt-codexproj`
- Workspace scope standardized as `@gpt-codexproj/*`

## [0.1.0] - 2026-04-17

### Added

- Root repository skill entrypoint in `SKILL.md` and `agents/openai.yaml`
- Standard repository metadata and contributor guidance in `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, and `.env.example`
- A documented release workflow in `RELEASING.md` plus a first GitHub release-note draft in `docs/releases/v0.1.0.md`
- Preparation workflow specifications, templates, CLI docs, sample packets, and downstream planning examples
- Bounded self-improvement scripts and operator documentation for the supported local mode
- Additional orchestrator and bridge runtime contracts, services, hardening layers, and automated test coverage

### Changed

- Repository boundaries were tightened by externalizing nested project repos and moving retained imports under `references/legacy/`
- The root README now acts as a public-facing repository entrypoint with explicit boundary and guide links
- Root CI now runs `lint`, `typecheck`, and `test`
- The monorepo baseline now reflects a validated first public release state rather than an internal skeleton only
