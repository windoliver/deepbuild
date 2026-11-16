# Checks

## What it is for

First-party check plug-ins that the hub loads as release packages, each registering a check kind through `deep.registerCheck`, so the core knows nothing of them and a requirement naming one is BLOCKED, naming the plug-in, while it is off. `playtest` (#184) is the check that requires live play: bots, a scripted input policy or a logic program, play seeded runs of a piece headless in replicas through `deep.canvas.play`; a run that gets stuck, misses a goal, traps or passes its step ceiling fails with its code, and every run's track replays without its bot to the same full-state hashes.

## Where new code goes

- `<name>/index.ts`: the plug-in, registering its kind; `<name>/deepbuild.json`: the manifest, whose `digest` is the folder's `packageDigest` and changes with every byte of the folder.
- `playtest/run.ts` plays and replays the runs; `judge.ts` judges a run from what it recorded; `bots.ts` is the first-party bot slot, where later bots are added as files; `codes.ts` the codes with their meaning and fix; `kit.ts` its check.kind@1 kit, on the mazes in `fixtures/` (built by `DEEP_184_WRITE=1 cargo test -p deep-logic --test play_184 fixtures`).
- Tests: `test/`, outside each plug-in's folder so they stay out of its digest; `tests/acceptance/184` is never edited.

## What it may import

A plug-in folder is copied alone at install: at run time it imports only `node:` built-ins and its own files; types from `@deepbuild/conformance`. `kit.ts` imports the conformance runner's findings, and runs only from the tests and the preflight.

## Deviations

- The `.wasm` fixtures are built files in the tree, since the plug-in's digest covers every file its kit plays.
- No `package.json`: these are DeepBuild packages, not npm workspaces.
