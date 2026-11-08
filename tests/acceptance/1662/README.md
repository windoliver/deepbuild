# Acceptance tests for #1662: a workspace build ships deep-app's plant-row plant

Written first, blind, from issue #1662 (its statement, Scope, the 3 checkbox criteria, Proof and Not in scope), the
design's Dogfooding and Wrong programs bullets, and base commit `c950fe14` (origin/main), by a job that never saw an
implementation of #1662. Base code read: `crates/deep-replica/Cargo.toml` (`deep-app = { …, features = ["plant-row"] }`
under `[dependencies]`, `env-plants = ["deep-app/env-plants"]`), `crates/deep-app/Cargo.toml` (`plant-row`, `env-plants`),
`crates/deep-app/src/views.rs` (`RowPlant`, `ROW_PLANT`, `plant_row`, all `cfg(feature = "plant-row")`),
`crates/deep-replica/src/drive/mod.rs` (the `plant_row` call) and `drive/plant.rs`, and `tests/acceptance/124`
(`ac7-ui-check.test.ts`, `helpers.ts`, `ui-helpers.ts`). The implementing agent does not edit these files (AGENTS.md, Proof).

| Criterion | Tag | Test |
| --- | --- | --- |
| AC1 `cargo tree --workspace -e normal,build,features -i deep-app` lists no `plant-*` feature | `#1662.0b9026c1` | `ac1-tree.test.ts`: that command (with `--locked`) in this checkout; every `deep-app feature "<name>"` line is read and any `plant-*` name fails, naming it and the line under it (who turns it on). Wrong program: the merge base's manifests, `git archive` of `BASE` into `target/acceptance-1662/base/<sha>/`, `cargo tree --offline`, which must fail naming `plant-row` from `deep-replica` |
| AC2 A release `deep-app` built with `--workspace` holds no `ROW_PLANT`, `RowPlant` or `plant_row` symbol, the same as one built with `-p deep-app` | `#1662.2fa0bd8c` | `ac2-symbols.test.ts`: `cargo build --locked --release -p deep-app --bin deep-app` and `cargo build --locked --release --workspace --bin deep-app`, each binary copied to `target/acceptance-1662/<alone|workspace>/deep-app` and byte-searched for the three strings; the workspace one must hold none and the same set as the alone one. Wrong program: `… -p deep-app --bin deep-app --features plant-row`, whose binary must fail the search naming `ROW_PLANT` |
| AC3 #124's UI check still fails on both planted rows (`RowLabelPastFrame`, `RowBranchCutOff`) when built with the plant feature | `#1662.9ac71651` | #124's own tests (below) are the proof; `ac3-planted.test.ts` runs the two of them on macOS and reads vitest's JSON report; off macOS it is skipped as INCONCLUSIVE |

IDs: `#1662.` and the first 8 hex of the SHA-256 of the criterion's text as the issue writes it (backticks included),
trimmed, whitespace collapsed.

## How to run

```sh
npm ci                                   # once, if node_modules is missing
npx vitest run --root tests/acceptance/1662 --no-file-parallelism
npx vitest run --root tests/acceptance/1662 --no-file-parallelism ac1-tree.test.ts   # the cheap part: seconds
node node_modules/typescript/bin/tsc -p tests/acceptance/1662/tsconfig.json
```

- AC2's three builds go to this checkout's own `target/` (the default), on purpose: a release deep-app is a gpui build,
  cold it is 20+ minutes each under this machine's load, warm it is one to two minutes (`--workspace` recompiles the
  crates whose features the workspace's resolution changes, about 130 of them, in about 1½ minutes the first time; once
  both feature sets' artifacts sit in `target/release/deps`, each build is a relink of seconds, and the whole suite ran
  in 11 s on the base). A `--target-dir` of the suite's own would rebuild gpui from scratch three times. The environment is
  passed to cargo as is, since a changed `CARGO_*` variable changes cargo's fingerprints and makes the warm build cold.
  Every build writes `target/release/deep-app`, so the builds run one at a time and each result is copied to
  `target/acceptance-1662/<alone|workspace|planted>/deep-app` before the next starts; after the run, `target/release/deep-app`
  is whichever was built last. Each build may take an hour; one that doesn't finish is INCONCLUSIVE, never a pass.
- `cargo build --locked --release --workspace --bin deep-app` is the workspace build of the criterion: `--workspace`
  selects every member, so cargo resolves features over all of them (resolver 2, once per command), and `--bin deep-app`
  builds that one target. Checked on the base: it links only deep-app (the other release binaries keep their dates), and
  its binary holds `ROW_PLANT` while the `-p deep-app` one doesn't, as the issue's full `--workspace` build does.
- The byte search reads the whole file for the three strings (`Buffer.includes`). `RowPlant` and `plant_row` leave no
  string in a release binary on the base (the enum has no runtime name, the function is inlined); `ROW_PLANT` does, as
  the thread-local's symbol (`nm target/release/deep-app | grep ROW_PLANT` is the hand check:
  `_RNv…8deep_app5views9ROW_PLANT…`). All three are searched, as the issue names them.
- Cargo is `~/.cargo/bin/cargo` when it exists, else `cargo` on `PATH`. Nothing here touches `~/.deepbuild` or
  `~/.claude`, starts a hub or a model, or stops a process but by its own PID.

## Criterion 3: #124's planted drive suite

The plant exists only in a deep-drive built with the plant feature. At the base that is `--features env-plants`
(deep-replica's; `tests/acceptance/124/helpers.ts`, `buildDrive`, builds `cargo build --locked -p deep-replica --bin
deep-drive --features env-plants`), which makes deep-drive read `DEEP_DRIVE_PLANT`, while `plant-row` reaches deep-app
from deep-replica's plain `[dependencies]`. After #1662, `plant-row` must come through that same plant feature (the
Scope: "through deep-replica's plant feature (`env-plants` once #1408 lands)"), so #124's build command needs no change
and its two planted tests stay the proof:

| Plant | `DEEP_DRIVE_PLANT` | Test in `tests/acceptance/124/ac7-ui-check.test.ts` |
| --- | --- | --- |
| `RowLabelPastFrame` | `row-label-past-frame` | "a planted label drawn past its frame fails, naming the label's row in each of the four" |
| `RowBranchCutOff` | `row-branch-cut-off` | "a planted cut-off branch name whose accessibility name lacks the full name fails, naming it in each of the four" |

Run, on the Mac (the replica renders with GPUI's offscreen Metal renderer, macOS only):

```sh
npx vitest run --root tests/acceptance/124 --no-file-parallelism ac7-ui-check.test.ts -t planted
```

Both tests must pass there: each expects the UI check's claim `FAIL` with one finding naming the planted row in each of
the four renders, checked against the render's own snapshot and PNG. `ac3-planted.test.ts` runs exactly that command
(with `--reporter=json`) and requires both tests present and `passed`, quoting their failure messages otherwise; off macOS
it calls `ctx.skip` with an INCONCLUSIVE note, so a Linux run reports it skipped, not passed. #124's `requireMacos` makes
the two tests themselves INCONCLUSIVE off macOS the same way.

The wrong program for this criterion is a deep-drive whose plant feature doesn't turn `plant-row` on: with it, the
"plant really draws past the row's frame" and "the plant's row has lost the full name" assertions of those two tests fail
(the row is drawn right, so the check finds nothing). After #1662 that build is `cargo build --locked -p deep-replica
--bin deep-drive` with no `--features` (a hand check on the Mac: `plant_row` must not compile into it; the issue's own
Scope puts the plant behind the feature, so that build has no plant to turn on). At the base the plant is always on, so
AC3 passes at the base: it is a "still" criterion, and AC1 and AC2 are the ones that fail there.

## Wrong programs

- AC1: the pinned merge base's manifests (`BASE`, `helpers.ts`), where `crates/deep-replica/Cargo.toml` turns on
  `deep-app/plant-row` under `[dependencies]`: `cargo tree --offline` on them lists `deep-app feature "plant-row"` under
  `deep-replica`, and the judge must fail naming both. A third, cheap test runs the judge on written trees (a plant feature
  fails named; `default` and `env-plants` alone hold). At the base the checkout's own tree fails the same way.
- AC2: a release deep-app built with `--features plant-row` (`target/acceptance-1662/planted/deep-app`) holds the
  thread-local's symbol; the byte search must fail on it naming `ROW_PLANT`, or it reads nothing. At the base the
  `--workspace` binary fails it the same way (BASE-FAILURE.txt), and the `-p deep-app` one holds none, as the issue says.
- AC3: a deep-drive built without the plant (above), on the Mac, by hand.

## Decided here, where the issue left it open

- The issue's "built with `--workspace`" is read as `cargo build --locked --release --workspace --bin deep-app`, not a
  full `--workspace` release build of 35 crates: the feature resolution is the same (checked at the base, above) and the
  build is minutes, not an hour.
- "The same as one built with `-p deep-app`" is read as: the set of the three strings the two binaries hold is equal, and
  empty. Sizes aren't compared (two builds of the same code may differ in bytes for reasons that aren't the plant).
- AC3 has no new test of the plant's behavior; #124's own tests are reused, as AGENTS.md asks, and tagged here through
  the test that runs them. Off macOS the tag's test is skipped, so a Linux run of this suite proves AC3 nothing.
