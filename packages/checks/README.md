# Checks

## What it is for

First-party check plug-ins that the hub loads as release packages, each registering a check kind through `deep.registerCheck`, so the core knows nothing of them and a requirement naming one is BLOCKED, naming the plug-in, while it is off. `playtest` (#184) is the check that requires live play: bots, a scripted input policy or a logic program, play seeded runs of a piece headless in replicas through `deep.canvas.play`; a run that gets stuck, misses a goal, traps or passes its step ceiling fails with its code, and every run's track replays without its bot to the same full-state hashes. With a play interface `game.play@1` (#555), locked in the brief, its first-party bots (legal, explorer, descender) play a generated grid game through listed rows only, goals are expressions over the interface's names, each bot's `share` bands and `expect: miss` hold over its runs, a declared name the piece doesn't publish fails `play.missing` before any run, and a value outside its name's range fails `play.out_of_range`. #1048 adds two kinds beside it, `rules.legal` (each listed row is taken and each unlisted entry turned down, tested in throwaway copies of the states the named playtest's runs reached) and `logic.edges` (each listed control put at its kind's `control@1` edge values), a playtest's `soak`, a model bot whose runs count only through replay, and grids with layers and links. #556 adds `grid.reach`: its own breadth-first search, with key-and-door closure, over every floor the named playtest's runs generated (each run its own floors under `piece_seed: run`), a depth no run generated BLOCKED, and its flow form, which checks that a flow field leads every spawn down in cost to its target.

## Where new code goes

- `<name>/index.ts`: the plug-in, registering its kind; `<name>/deepbuild.json`: the manifest, whose `digest` is the folder's `packageDigest` and changes with every byte of the folder.
- `playtest/run.ts` plays and replays the runs (`model.ts` grows a model bot's replies, `soak.ts` reads a soak's windows); `legal.ts` is rules.legal and `edges.ts` logic.edges, each testing entries through a play's `probe` (`crates/deep-logic/src/probe.rs`); `reach.ts` is grid.reach, reading the grid only at the steps a play records it changing (`changes`); `judge.ts` judges a run from what it recorded; `bots.ts` takes or refuses each bot before any run (the first-party bots themselves run in the replica's play mode, `crates/deep-logic/src/grid_bot.rs`, so their search costs the piece no fuel and a run stays one play); `iface.ts` reads the play interface: its names, the lock's unit rule, ranges and goal expressions; `codes.ts` the codes with their meaning and fix; `kit.ts` its check.kind@1 kit, on the mazes in `fixtures/` (built by `DEEP_184_WRITE=1 cargo test -p deep-logic --test play_184 fixtures`).
- Tests: `test/`, outside each plug-in's folder so they stay out of its digest; `tests/acceptance/184` is never edited.

## What it may import

A plug-in folder is copied alone at install: at run time it imports only `node:` built-ins and its own files; types from `@deepbuild/conformance`. `kit.ts` imports the conformance runner's findings, and runs only from the tests and the preflight.

## Deviations

- The `.wasm` fixtures are built files in the tree, since the plug-in's digest covers every file its kit plays.
- No `package.json`: these are DeepBuild packages, not npm workspaces.
