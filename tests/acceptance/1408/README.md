# Acceptance tests for #1408: plants read from the environment in shipped binaries

Written first, blind, from issue #1408 (its statement, Scope, the 3 checkbox criteria, Proof and Not in scope), the
design's Dogfooding and Wrong programs bullets, and base commit `2bba2a50` (origin/main), by a job that never saw an
implementation of #1408. Base code read: the plant reads (`crates/deep-hook/src/main.rs` ~1182, ~1691, ~1712 and
`heavy.rs` ~283; `crates/deep-app/src/states.rs` ~426; `crates/deep-replica/src/deep_drive.rs` ~33 and
`drive/plant.rs`), the three `Cargo.toml`s, `plant-walks-events` in `crates/deep-app/src/record.rs`, and the suites
that set these plants (below). The implementing agent does not edit these files (AGENTS.md, Proof).

| Criterion | Tag | Test |
| --- | --- | --- |
| AC1 A release build of `deep-hook`, `deep-app` and `deep-replica` holds neither `DEEP_HUB_PLANT` nor `DEEP_DRIVE_PLANT` | `#1408.fc1e2a9c` | `release.test.ts`: `cargo build --locked --release -p <crate>` for each crate, then a byte search of each of its 6 bins (`deep-hook`; `deep-app`; `deep-replica`, `deep-replica-canvas`, `deep-drive`, `deep-live`) for both strings, failing naming the binary and string; a bin that isn't there is BLOCKED |
| AC2 A release build with the plant feature on fails to compile, naming the feature | `#1408.028b0245` | `release.test.ts`: `cargo build --locked --release --features env-plants -p <crate>` for each crate exits non-zero with an `error:` line naming `env-plants` and cargo's `could not compile`; cargo's own "does not contain this feature" is not that refusal |
| AC3 Every test that sets a plant still fails on its planted program, built with the feature | `#1408.894e1c69` | the planted suites below are the proof; `planted.test.ts` adds deep-hook built with `--features env-plants` (debug) selecting `DEEP_HUB_PLANT=leases-every-cargo` |

IDs: `#1408.` and the first 8 hex of the SHA-256 of the criterion's text, trimmed, whitespace collapsed.

## The feature (invented here; the implementer adds it)

The issue names no feature. This suite uses **`env-plants`**: one feature of that name in each of `deep-hook`,
`deep-app` and `deep-replica`, with `deep-replica`'s turning on `deep-app/env-plants`. Built with it, a test build
reads `DEEP_HUB_PLANT` and `DEEP_DRIVE_PLANT` as the base does; built without it, nothing reads them. A release build
with it on stops on a `compile_error!` (or any compile error) whose message names `env-plants`; the wording is free.

## How to run

```sh
npm ci                                   # once, if node_modules is missing
npx vitest run --root tests/acceptance/1408 --no-file-parallelism
npx vitest run --root tests/acceptance/1408 --no-file-parallelism -t deep-hook   # the cheap part: deep-hook only
node node_modules/typescript/bin/tsc -p tests/acceptance/1408/tsconfig.json
```

- Builds go to folders of this suite's own: `target/acceptance-1408/release` (AC1, and AC3's wrong program),
  `target/acceptance-1408/refused` (AC2), `target/acceptance-1408/env-plants` (AC3), and the merge base's deep-hook
  under `target/acceptance-1408/base/<sha>/` (`git archive` of `crates/deep-hook` and `crates/deep-contracts`, built
  `--offline`). Cargo is `~/.cargo/bin/cargo` when it exists, else `cargo` on `PATH`.
- deep-app and deep-replica are gpui builds: each release build takes tens of minutes, and AC2's refused builds compile
  every dependency before they stop. Each test allows 3 hours; a build that times out is INCONCLUSIVE, never a pass.
- deep-hook runs with `HOME` a temp folder under `/tmp/dh1408-*` and `PATH=/usr/bin:/bin`, with no hub: it spools
  the PreToolUse request, which carries a `heavy` field when it would lease the call (#1015). Nothing touches the real
  `~/.deepbuild` or `~/.claude`; no process is stopped but by its own PID.

## Criterion 3: the planted suites

Each sets a plant a Rust binary of these crates reads, and must still fail on its planted program once the binary is
built with `env-plants`. Their helpers build without the feature at the base, so each needs `--features env-plants`
added to its build; the issue's Not in scope says such a change to a tagged test lands by a signed tag.

| Plant | Read by | Suite and test | Run |
| --- | --- | --- | --- |
| `DEEP_HUB_PLANT=leases-every-cargo` | deep-hook `heavy.rs` | `tests/acceptance/1015/focused.test.ts`, AC3 wrong program | `npx vitest run --root tests/acceptance/1015 --no-file-parallelism focused.test.ts` |
| `DEEP_HUB_PLANT=waiter-keeps-transcript` | deep-hook waiter | `tests/acceptance/824/sessions/planted.test.ts` | `npx vitest run --root tests/acceptance/824/sessions --no-file-parallelism planted.test.ts` |
| `DEEP_HUB_PLANT=waiter-outlives-session` | deep-hook waiter (and the hub) | `tests/acceptance/25/routes/session-end.test.ts`, AC3 wrong program; `25/twins.json` and `27/twins.json` by hand | `npx vitest run --root tests/acceptance/25/routes --no-file-parallelism session-end.test.ts` |
| `DEEP_HUB_PLANT=waiting-as-working` | deep-app `states.rs` | `tests/acceptance/992/agree.test.ts` AC3, through `cargo test --locked -p deep-replica --test acceptance_992_app` (`992/app.rs`; macOS only) | `npx vitest run --root tests/acceptance/992 --no-file-parallelism agree.test.ts` |
| `DEEP_DRIVE_PLANT=answers-your-record`, `writes-clipboard`, `moves-focus`, `starts-sound` | deep-drive | `tests/acceptance/124/ac2-isolation.test.ts` | `npx vitest run --root tests/acceptance/124 --no-file-parallelism ac2-isolation.test.ts` |
| `DEEP_DRIVE_PLANT=page-drops-param` | deep-drive | `tests/acceptance/366/ac3-page.test.ts` | `npx vitest run --root tests/acceptance/366 --no-file-parallelism ac3-page.test.ts` |
| `DEEP_DRIVE_PLANT=ranks-by-live-recency` | deep-drive | `tests/acceptance/366/ac6-rank.test.ts` | `npx vitest run --root tests/acceptance/366 --no-file-parallelism ac6-rank.test.ts` |

Every other `DEEP_HUB_PLANT` value in the repo is the hub's (`packages/hub/src/plant.ts`, TypeScript) or
`scripts/lease`'s (shell), not a Rust binary's, and so outside this issue.

`planted.test.ts` reads the one hook plant observable without a hub: built with `env-plants` and run with
`DEEP_HUB_PLANT=leases-every-cargo`, deep-hook spools `cargo test -p x` with `"heavy":{"name":"cargo",…,"form":"deep
lease -- cargo test -p x"}`; run with no plant, it spools no `heavy` field (base reading, both ways).

## Wrong programs

- AC1: the pinned merge base's release deep-hook holds `DEEP_HUB_PLANT`; the byte search must fail naming it. On the
  checkout at the base, every AC1 test of a binary that carries a string fails too. `deep-drive` reads
  `DEEP_DRIVE_PLANT` only under `cfg(target_os = "macos")`, so on Linux its base binary may not carry that string; it
  is searched all the same.
- AC2: the merge base's deep-hook has no `env-plants`, so cargo stops with "does not contain this feature"; the judge
  must fail on it rather than take it for the refusal.
- AC3: the release deep-hook, a build that dropped every plant, must fail the planted judge. At the base it doesn't
  (it still reads the plant), so this wrong-program test fails there, as AC1 does.
