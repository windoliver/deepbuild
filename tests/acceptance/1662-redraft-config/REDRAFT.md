# #1662 AC1 blind redraft (config): the merge base's manifests resolve with the merge base's own cargo config

#1662's AC1 wrong-program test runs the issue's `cargo tree --locked --workspace -e normal,build,features -i deep-app`
(`--offline`) on the pinned merge base `c950fe14` (`../1662/helpers.ts`, `BASE`), whose `crates/deep-replica/Cargo.toml`
turns on `deep-app/plant-row` under `[dependencies]`. The frozen `baseManifests()` lays that commit's `Cargo.toml`,
`Cargo.lock`, `rust-toolchain.toml`, `.cargo`, `crates` and `vendor` out with `git archive` into
`<checkout>/target/acceptance-1662/base/c950fe146768`, inside the checkout. Cargo reads `.cargo/config.toml` from the
current directory and every parent directory and merges them (its documented config discovery), so there it reads the
pinned workspace's config and also the checkout's. When the suite was written the two files matched. At the base
commit `0beb4a141` the checkout's config has gained `[patch]` entries the pinned lock doesn't know, among them
`[patch."https://github.com/awslabs/llrt"] llrt_crypto = { path = "vendor/llrt_crypto" }` (#2359), whose path is
relative to the checkout, plus `citationberg`, `accesskit_macos`, `gpui-pre-macos`, `symphonia-codec-vorbis` and the
`mitex` patches. Cargo then routes the pinned lock's `llrt_crypto` to the checkout's `vendor/llrt_crypto`, which needs
`crypto-bigint ^0.7.11` where the pinned lock holds 0.7.5, and resolution fails before any tree is printed: `BLOCKED:
… failed (exit 101)`. The judge never sees the merge base's tree, so it can't fail naming `plant-row`. The redraft
keeps the test's scenario, judge, assertions and messages, and lays the same pinned files out where no parent
directory holds a cargo config.

## Inputs, exactly

- Issue #1662, read live with `gh issue view 1662 --repo windoliver/deepbuild`: statement, Scope, the three criteria,
  Proof, Not in scope (no comments or linked pull requests read).
- `AGENTS.md`.
- `docs/technical-design.md`, found by a search for `1662|wrong program|proven on the base|dogfooding|ratchet`: the
  Wrong programs bullet, Proven on the base, the Dogfooding paragraph and the Repo guards bullet (the comment
  ratchet). The design names #1662 nowhere, so no section it links was read.
- The frozen `tests/acceptance/1662/`: `README.md`, `BASE-FAILURE.txt`, `helpers.ts`, `ac1-tree.test.ts` and
  `tsconfig.json` in full. `ac2-symbols.test.ts` and `ac3-planted.test.ts` were not opened.
- At the pinned `c950fe1467688d3f94a10ed6deca8d145f92484e`, with `git show`: `Cargo.toml`, `.cargo/config.toml`,
  `Cargo.lock` (saved aside and scanned for its packages and sources, not read line by line), and `git ls-tree` of
  `.cargo/` and `vendor/`.
- At the base commit `0beb4a141`: `.cargo/config.toml`.
- For form: `tests/acceptance/1097-redraft-defaults/` `REDRAFT.md`, `base-defaults.ts`, `tsconfig.json`.
- On this machine: `os.tmpdir()` and whether it or a parent holds a `.cargo` directory (none does), the cargo home's
  `config.toml` (an empty `[build]` table), and which of the pinned lock's registry packages have an archive in the
  cargo cache (RUNS.txt).

No `crates/` source, diff, branch, pull request, other worktree or git log of this branch was read.

## What reached this job beyond its inputs

The base run's failure, in the instructions: `tests/acceptance/1662/ac1-tree.test.ts`, the wrong-program test,
line 16, `expected 'BLOCKED: cargo tree --locked --worksp…' to match /turns on deep-app's "plant-row"/`, with cargo's
`failed to select a version for crypto-bigint` and its chain through `llrt_crypto v0.9.0-beta
(<clone>/vendor/llrt_crypto)` to `deep-gpu-layer (<clone>/target/acceptance-1662/base/c950fe146768/crates/deep-gpu-layer)`,
on a fresh clone of main `0beb4a141`, macOS, 2026-11-27, the other two tests filtered out. That is the failing file,
line and message Proven on the base sends back, and the cause it names (the checkout's `vendor/` reached from a
layout under the checkout) is what this job checked against the two configs.

## What changed since the suite was written

| Original (path › describe title › it title) | Criterion | Why the old expectation no longer holds | Replaced by |
|---|---|---|---|
| `tests/acceptance/1662/ac1-tree.test.ts` › #1662.0b9026c1 cargo tree --locked --workspace -e normal,build,features -i deep-app lists no plant-* feature › #1662.0b9026c1 (wrong program) the merge base's manifests, where deep-replica's dependency turns plant-row on, fail the judge naming plant-row | #1662 AC1 (`#1662.0b9026c1`) | `baseManifests()` lays the pinned files out under the checkout's `target/`, so cargo merges the checkout's `.cargo/config.toml` into the pinned one. Since #2359 that config patches `llrt_crypto` to the checkout's `vendor/llrt_crypto`, which the pinned `Cargo.lock` can't resolve (`crypto-bigint` 0.7.5 locked, `^0.7.11` needed), so `featureTree` throws BLOCKED and the judge never reads a tree. Reproduced by hand on this machine (RUNS.txt, 4) | `tests/acceptance/1662-redraft-config/ac1-tree.test.ts` › the same describe › the same title with ` (redraft config)`; its one changed call is `baseManifestsApart()` (`base-apart.ts`) in place of `baseManifests()` |

### The layout choice

`baseManifestsApart()` (`base-apart.ts`, the redraft's one local addition) does what `baseManifests()` does, the same
`git archive` of `BASE` with the same six paths, extracted the same way and reused when its `Cargo.lock` is there, but
into `<os.tmpdir()>/deepbuild-acceptance-1662/c950fe146768` instead of under the checkout. Before that it walks every
directory above the layout to the root, and if any holds `.cargo/config.toml` or `.cargo/config` (the cargo home's own
excepted) it throws `BLOCKED: cargo would merge … into the pinned workspace's own .cargo/config.toml`, naming them. So:

- **Cargo reads only the pinned config.** Discovery starts at the layout (cargo runs there, `featureTree(cwd)`), finds
  the pinned `.cargo/config.toml`, and finds no other on the way up, or the test stops BLOCKED before running cargo.
  Every `path` patch in the pinned config (`gpui-pre`, `gpui-pre-apple`, `quickjs-jit-runtime`) resolves against the
  layout, so to the pinned `vendor/`. The one other file cargo always reads, `$CARGO_HOME/config.toml`, is read
  wherever the workspace sits, so the original read it too; on this machine it is an empty `[build]` table.
- **Not a filtered or rewritten config.** Dropping the checkout's newer patches by a rule of the test's own, or
  passing `--config` overrides, would make the test decide which of today's settings the merge base "should" see, and
  would change as the checkout's config changes. The pinned commit's own files, read alone, never move.
- **Why the system temp dir.** It is outside the checkout, so it has no checkout config above it, and the instructions
  allow leaving files only there or under `target/`; `target/` sits inside the checkout, which is the fault. The
  layout is kept between runs, as the original's was.

### The wrong program still fails for the criterion's reason

The pinned `crates/deep-replica/Cargo.toml` turns on `deep-app/plant-row` under `[dependencies]` (the original
README, Wrong programs; the issue's statement). With cargo reading the pinned workspace alone, the merge base's tree
is the one the original's base run printed at the base (BASE-FAILURE.txt: `deep-app feature "plant-row"` with
`deep-replica` on the line under it), so `judgeTree` throws `the workspace's feature tree turns on deep-app's
"plant-row": … <- … deep-replica v0.0.0 (…/crates/deep-replica)`, which both assertions match, unchanged. Nothing in
the change touches the manifests, the lock, the judge or the command; only the directory cargo is run in moves.

**Seen after one cache fetch.** The first run here (RUNS.txt, 3) got past the resolution the base run failed at, then
stopped BLOCKED: cargo `--offline` needs each package's `.crate` archive, and this Mac's cargo cache lacks 32 of the
pinned lock's (`accesskit_macos-0.26.3` first; their unpacked sources are there, which `--offline` doesn't use). That
is the machine's cache, not the test: the frozen `featureTree` keeps `--offline` and reports a tree it can't read as
BLOCKED, never a pass, and this job made no network fetch. After one `cargo fetch --locked` in the layout, the
run reached the judge and the test passed, catching the message above (RUNS.txt, 5).

## Kept as they are

- **This file runs in its original's place.** `tests/acceptance/1662/ac1-tree.test.ts` then runs by hand only, so
  this folder's `ac1-tree.test.ts` holds all three tests of its `describe`: the right-program test (this checkout's
  tree) and the judge-on-written-trees test copied exactly in code, titles unchanged, and the redrafted wrong-program
  test. Their bodies, judges, timeouts, assertions and messages are the original's; the only lines that differ are
  the import of `baseManifestsApart` (and `baseManifests` no longer imported), its call, and the title suffix.
- Everything else comes from `../1662/helpers.ts`, imported unchanged: `AC1`, `TREE_ARGS`, `featureTree`, `featuresOf`,
  `judgeTree`, `failureOf`, and in `base-apart.ts` `BASE`, `REPO` and `redact`.
- Not redrafted: `ac2-symbols.test.ts` and `ac3-planted.test.ts`, which don't lay out the merge base.
- The new `.ts` files carry no comments (the comment ratchet starts a not-yet-landed blind suite's files at 0); all
  explanation is here.

## Run

```sh
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1662-redraft-config --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1662-redraft-config/tsconfig.json
```

The wrong-program test needs the pinned `Cargo.lock`'s crate archives in the cargo cache, since the command runs
`--offline`; where they're missing it reports BLOCKED naming the first one. To warm the cache once, outside the test
and with network, a person can run `cargo fetch --locked` in `<os.tmpdir()>/deepbuild-acceptance-1662/c950fe146768`
after a first run has laid it out.
On this Mac that was needed once (2026-11-28, RUNS.txt 5): after one `cargo fetch --locked` in that layout the suite
passed 3 of 3, the wrong-program test catching `turns on deep-app's "plant-row": … <- … deep-replica`.
The right-program test needs this checkout's cargo cache as the original did.
RUNS.txt holds this job's runs: tsc clean, no comment-ratchet line for 1662, vitest 2 passed, 1 failed BLOCKED on
the missing archives before the fetch, and 3 passed after it.
