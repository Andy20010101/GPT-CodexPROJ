# Releasing

This repository currently releases through GitHub Releases and annotated git tags.

It does not currently publish npm packages. The root package and all workspace packages are still marked `private: true`, so the package versions are internal repo version markers, not a public registry contract.

## Release Model

- Use one lockstep repository version across the root and all workspaces.
- Use SemVer while staying pre-`1.0.0`.
- Use annotated tags in the form `vMAJOR.MINOR.PATCH`.
- Use prerelease tags in the form `vMAJOR.MINOR.PATCH-rc.1` or `vMAJOR.MINOR.PATCH-beta.1`.
- Do not create per-workspace tags such as `orchestrator-v...` while the repo still ships as one private monorepo.

## Current Baseline

- First public baseline: `v0.1.0`
- Current policy: GitHub Release + annotated git tag
- Current release gate: `lint`, `typecheck`, `test`, clean worktree, updated changelog

## Versioning Rules

- `0.1.x`: doc fixes, repo hygiene, test-only fixes, and low-risk corrections
- `0.2.0`: materially new repo capabilities or operator-visible workflow additions
- future minor bumps: meaningful new bounded capabilities across preparation, review, or runtime layers
- `1.0.0`: only after the supported operating model, boundaries, and validation posture are stable enough to be treated as a durable baseline

When the release version changes, keep the root `package.json` and each workspace `package.json` on the same version.

## Release Gate

Before tagging a release, confirm all of the following:

- `git status --short` is empty
- `CHANGELOG.md` is updated for the target version
- the target release notes are drafted
- `npm run lint` passes
- `npm run typecheck` passes
- `npm test` passes

If a release intentionally skips any browser-backed or operator-backed validation beyond those commands, say so explicitly in the release notes.

## Release Steps

1. Choose the target version.
2. If the version is changing, update the root and workspace `package.json` files together.
3. Move the target changes from `Unreleased` into the target section of `CHANGELOG.md`.
4. Draft the GitHub release notes in `docs/releases/vX.Y.Z.md`.
5. Run:

```bash
git status --short
npm run lint
npm run typecheck
npm test
```

6. Create an annotated tag:

```bash
git tag -a vX.Y.Z -m "Release vX.Y.Z"
```

7. Push the branch and the tag:

```bash
git push origin main
git push origin vX.Y.Z
```

8. Create the GitHub Release for `vX.Y.Z` and paste in the release-note draft.
9. Re-open a fresh `Unreleased` section in `CHANGELOG.md` for the next cycle.

## Release Notes Shape

Keep release notes short and operationally useful. Use these sections:

- `Highlights`
- `Included Areas`
- `Validation`
- `Known Limits`
- `Upgrade Notes`

For this repository, `Known Limits` matters. Always restate the current operating boundary, for example:

- local-first runtime
- already-logged-in browser requirement for real bridge usage
- no distributed scheduler / HA control plane
- no npm package publishing yet

## First Public Release

The first public release should tag the current validated public baseline as:

```bash
git tag -a v0.1.0 -m "First public baseline release"
```

That release should be published from a clean `main` worktree after the release gate passes.
