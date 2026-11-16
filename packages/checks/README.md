# Checks

## What it is for

First-party check plug-ins that the hub loads as release packages, each registering a check kind through `deep.registerCheck`, so the core knows nothing of them and a requirement naming one is BLOCKED, naming the plug-in, while it is off. `playtest` (#184) is the check that requires live play: bots, a scripted input policy or a logic program, play seeded runs of a piece headless in replicas through `deep.canvas.play`; a run that gets stuck, misses a goal, traps or passes its step ceiling fails with its code, and every run's track replays without its bot to the same full-state hashes. With a play interface `game.play@1` (#555), locked in the brief, its first-party bots (legal, explorer, descender) play a generated grid game through listed rows only, goals are expressions over the interface's names, each bot's `share` bands and `expect: miss` hold over its runs, a declared name the piece doesn't publish fails `play.missing` before any run, and a value outside its name's range fails `play.out_of_range`.

## Where new code goes

- `<name>/index.ts`: the plug-in, registering its kind; `<name>/deepbuild.json`: the manifest, whose `digest` is the folder's `packageDigest` and changes with every byte of the folder.
- `playtest/run.ts` plays and replays the runs; `judge.ts` judges a run from what it recorded; `bots.ts` takes or refuses each bot before any run (the first-party bots themselves run in the replica's play mode, `crates/deep-logic/src/grid_bot.rs`, so their search costs the piece no fuel and a run stays one play); `iface.ts` reads the play interface: its names, the lock's unit rule, ranges and goal expressions; `codes.ts` the codes with their meaning and fix; `kit.ts` its check.kind@1 kit, on the mazes in `fixtures/` (built by `DEEP_184_WRITE=1 cargo test -p deep-logic --test play_184 fixtures`).
- Tests: `test/`, outside each plug-in's folder so they stay out of its digest; `tests/acceptance/184` is never edited.

## What it may import

A plug-in folder is copied alone at install: at run time it imports only `node:` built-ins and its own files; types from `@deepbuild/conformance`. `kit.ts` imports the conformance runner's findings, and runs only from the tests and the preflight.

## Deviations

- The `.wasm` fixtures are built files in the tree, since the plug-in's digest covers every file its kit plays.
- No `package.json`: these are DeepBuild packages, not npm workspaces.
