# Changelog

All notable changes to this project should be documented in this file.

The format is based on Keep a Changelog, and this repository currently tracks changes under a pre-`1.0.0` versioning model.

## [Unreleased]

### Added

- Root repository skill entrypoint in `SKILL.md` and `agents/openai.yaml`
- Standard repository metadata and contributor guidance
- Example environment file for local setup

### Changed

- CI now runs `lint`, `typecheck`, and `test`
- README now exposes a quicker public-facing project and setup entrypoint

## [0.1.0]

### Added

- Monorepo skeleton for orchestrator, bridge, and shared contracts
- Architecture docs for the three-plane model
- File-backed orchestrator runtime and bridge service
- Preparation workflow, bounded self-improvement entrypoints, and operator docs
