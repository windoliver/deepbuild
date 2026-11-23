# #2173 evidence: deep-app's accesskit_macos has its reason, and an unlisted dependency still fails

All runs are on the owner's Mac (Node 24.22.2, cargo 1.99.1), 2026-11-23, with `/opt/homebrew/opt/rustup/bin` first on PATH so the physics-build lane finds cargo.

The row was already on main: #2178's `b21ce5537` added it to `scripts/repo-rules.json` with #1462's reason from the manifest's comment. The closed-issue sweep (#2047) reopened #2173 because no test on main named its criterion IDs. This change adds three things and changes no checker, manifest or rules file:
- the blind redraft `tests/acceptance/2173-redraft-2047/`;
- its `alone` entry in `scripts/lanes.mjs`;
- these captures.

## Requirement → change → proof

| Criterion | Change | Proof |
|---|---|---|
| AC1 `#2173.222063e6`: `node scripts/repo-rules.mjs` exits 0 on main | None here. The row is #2178's | `rules-before.txt`: the blind base `a3db8f131` (main `c52dc3e73` without the row) exits 1, and its one FAIL line outside `tests/acceptance/` is the issue's `FAIL deps: crates/deep-app/Cargo.toml … accesskit_macos ^0.26 …`. `rules-after.txt`: the merged head prints no FAIL line naming `accesskit_macos` and none outside `tests/acceptance/`. The blind test passes there (`suite-head.txt`). It fails at its assertion on the base and on the twin `no-reasons` (`tests/acceptance/2173-redraft-2047/BASE-FAILURE.txt`) |
| AC2 `#2173.2db46adb`: a dependency a manifest names with no entry still fails the lane, naming the manifest and the dependency | None | The blind tests plant three dependencies with no entry in a scratch copy: the issue's own `accesskit_macos` with its row taken out, a crate in deep-app's macOS table, and a `package.json`. The run fails, and a deps line names each manifest and dependency. All three pass at the merged head (`suite-head.txt`). They fail at their assertions on the twins `hollow` (a checker that passes every dependency) and `unnamed` (one that fails without naming them), per the blind job's runs in `BASE-FAILURE.txt` |

## What still fails, and whose it is

The checker still exits 1 at the merged head (`rules-after.txt`). All 146 FAIL lines are under `tests/acceptance/`:
- home paths in other suites' base-failure records;
- key-shaped strings;
- twins' own `package.json` and `Cargo.toml` dependencies.

#3139 held them. #3138 (PR #3153, merged) cleared every finding outside that folder. The blind job read AC1 as "exits 0, or exits 1 with every failing line under `tests/acceptance/`" and recorded that reading as its choice in its README.

## After #3139: a literal exit 0

#3139's change then landed on main, and main `2a5bd60fd` printed no line under `tests/acceptance/`. It printed one new line outside it: `FAIL deps: crates/deep-codecs/Cargo.toml dependencies png ^0.18 is not in scripts/repo-rules.json`. #1488 (PR #3148) added that dependency with its reason as a manifest comment but no row. This change adds that row, with the comment's reason.

With it, at the merge `ed824b3f7` plus the row:
- `node scripts/repo-rules.mjs` exits 0 with no FAIL, INVALID or BLOCKED line (`rules-after-3139.txt`).
- The blind AC1 test passes with no line set apart (`ac1-after-3139.txt`).

## The captures

- `rules-before.txt`: the checker on the blind base. The base is this worktree at `c52dc3e73` with `scripts/repo-rules.json` from `a3db8f131`, put back afterwards.
- `rules-after.txt`: the checker at the merged head `823ddf1d7` (main `28bfe9a9b`).
- `suite-head.txt`: the blind suite once at the merged head: 4 of 4 pass, in 40.7 s.
- `rules-after-3139.txt` and `ac1-after-3139.txt`: the checker, and the AC1 test, after #3139 and with the `png` row.
- At the merge `ed824b3f7` without the row, AC2's three tests passed and AC1 failed on the `png` line alone.

Home folders read `~`.
