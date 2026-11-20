# Acceptance test for #1810's first criterion, the app's part: `deep` and the app's list say 1

Written blind, as a redraft job (design: Dogfooding, "Tests written first"), at base commit `c740dede7`, from issue #1810,
the design and the base, before any implementation. The implementing agent does not edit these files (AGENTS.md, Proof).
There is no taste criterion, so no `TASTE.json`.

The criterion, `#1810.eebcb4a2`: "With two asks answered and one open, 'anything for me?' answers 'needs you: 1', and `deep`
and the app's list say 1 at the same log position." This suite covers its app's part only: `deep` and the app's list say 1
at the same log position, the app's list holding the open ask's row. The chat's "needs you: 1", and "on the merge base the
answer says 3", are another test's.

## What was read

- Issue #1810 (problem, Scope, three acceptance criteria, Proof).
- `docs/technical-design.md`: An ask, and your answer getting back; States people see; The verdict in the chat; Dogfooding;
  Tests written first. `AGENTS.md`.
- At the base: `tests/acceptance/1463/` (README, `helpers.ts`, `list.test.ts`, `inbox.test.ts`, `deep.test.ts`,
  `judges.test.ts`), the exports of `tests/acceptance/16/helpers.ts` and `26/helpers.ts`, `packages/hub/src/list.ts`
  (`asksNeedYou`, `deep`'s text), `packages/hub/src/inbox.ts` (`deep inbox answer`'s arguments),
  `crates/deep-replica/src/drive/mod.rs` (`see` answers `rows` and `log_pos`), `scripts/proof-change.mjs` (`criterionId`).

## How to run (macOS)

With Node 24.22 first on `PATH` and cargo on `PATH`, from the repo root:

```sh
npm ci --ignore-scripts
npm run build --workspaces                 # the CLI at packages/cli/dist/main.js
cargo build --locked -p deep-hook          # target/debug/deep-hook, which #1463's needBuilds looks for
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1810/redraft-replica --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1810/redraft-replica/tsconfig.json
rm -rf tests/acceptance/1810/redraft-replica/node_modules   # vitest's --root cache, before committing
```

The test builds `deep-drive` itself through #1463's `driveBinaries` (`cargo build -p deep-replica --bin deep-drive`, with
`--features env-plants` and then plain, `CARGO_INCREMENTAL=0`, `CARGO_PROFILE_DEV_DEBUG=0`, copied to
`$TMPDIR/dh1463-bin-<uid>`; `CARGO_TARGET_DIR` is honored). The first run takes minutes. `judges.test.ts` runs anywhere.
`scripts/lanes.mjs` needs this folder in a macOS lane (the replica draws on macOS only); the implementer makes that edit.

## The fixture and the readers

- **The world** is #1463's `makeWorld` on one session (`Cart totals` in a git repo `shop`): a real hub (`deep hub run` in a
  temp HOME) takes its hooks over its socket; with that hub stopped, the record and asks core raise its three asks, each due
  three days out, so none defaults during the run; a real hub starts on that record again, the OS confirmation stubbed
  `confirmed` (#24's `DEEP_HUB_TEST_CONFIRM`).
- **Two answers** through the real CLI: `deep inbox answer <handle> <option>` for "Ship the cart page today?" and "Keep the
  changelog as a list or as prose?", each with the option that isn't its default. The record must then hold each answered
  once with that option, and "Which header colour on the login page?" with no closing event.
- **One log position.** After the hub's log is quiet for 5 s: `deep status --json`, then `deep` (no arguments), then the
  app's list (the real `deep-drive` launched with `launch.from: "record_copy"` in the same HOME, its `see`), then
  `deep status --json` again. `deep`'s position is the bracket's, when both `deep status --json` reads agree.
- **The readers' "1".** The app's: the count sentences its window draws (`views::asks_need_you`, "1 ask needs you", read from
  the snapshot's node names). `deep`'s: the count sentences it prints. A sentence of another number, or none, fails.

## What it proves, and how it fails

It passes only if all of these hold: every reader read at one log position (the app's `log_pos`, and both
`deep status --json` reads, are equal); the app's window and `deep` each print a count sentence and every one says 1; the app's
list and both `deep status --json` reads hold one ask row, the open ask's (`ask:<ULID>`), and neither answered ask's; the
window draws that row by its id with its title and word; and `deep` prints a line with that row's title and word. Each failure
names the reader and the count or ask (`deep counts 3 (says "3 asks need you"), not 1 …`, `the app's list still lists the
answered ask ask:…`, `the readers read at different log positions: …`). `judges.test.ts` holds the judge to the right reading
and to the wrong ones: a count of 3, 0, two counts, no count, two log positions, none, an answered ask kept, the open one
dropped, one added or doubled.

Not proven here: the chat's "needs you: 1", and whether this test fails on the merge base. At `c740dede7` the readers
read here already filter to open asks (#1463), so this part may pass there; the issue names the chat's answer as what says 3.

Off macOS the replica can't draw, so the test throws `BLOCKED: the replica draws on macOS only; this is <platform>` before any
hub starts, never a pass. A failed build or a replica that won't start is BLOCKED too (#1463's helpers).

## Safety

Every process runs with a temp HOME under `/tmp`; a process is stopped only by the PID it was started with; nothing touches
the real `~/.deepbuild`, `~/.claude` or `~/Library/LaunchAgents`; no network, no model.
