# Workspaces

## What it is for

A home for work that isn't code (#67): a git repo holding its definitions, scripts and notes, and naming what it touches. This package holds the parts with no hub in them: the four state sources DeepBuild ships (`git`, `host`, `api`, `document`), each with the fixture `state-source@1`'s kit drives, a reading's digest, the plan of a change through a source, and a workspace's own git work. The hub's side, which keeps them in the record, pins readings and re-runs what drifted, is `packages/hub/src/workspaces.ts`.

## Where new code goes

- `src/index.ts`: everything here: the shipped state sources (`sourceOf`, `shippedSources`) with their fixtures, a reading's digest and diff (`reading`, `diffOf`), the plan of a change through a source (`changePlan`), and a workspace's git work (`makeWorkspace`, `keepWork`, `revertCommit`, `renamedSince`).
- Anything that writes to the record, pins readings or re-runs drifted checks goes in `packages/hub/src/workspaces.ts`, not here.
- The acceptance suite is `tests/acceptance/67`, never edited.

## What it may import

Extension layer, with no hub in it: only `@deepbuild/contracts` (canonical JSON and SHA-256), `@deepbuild/conformance` (the `state-source@1` types alone) and `node:` built-ins, through their public entries. It never imports the record, the hub, the CLI or the app; the hub imports it.

## Deviations

None.
