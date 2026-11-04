# #1118 on the Spark: two proof runs of one fixed input in bays

A manual end-to-end run on the Spark (Linux aarch64, 20 cores) on 2026-11-04, of the real repository, with the proof
code of this branch at `92fea79a` (the branch with origin/main merged in). The machine-wide throttle table was jammed
by a stale pending timed request, so every run used an isolated HOME (`~/bay-e2e-home`) with `RUSTUP_HOME`,
`CARGO_HOME`, `npm_config_cache` and `GH_CONFIG_DIR` pointing at the real ones; bays are under
`~/bay-e2e-home/deepbuild-bays/`. Home paths are written `~`.

## The input

A worktree of the machine's repository, `~/deepbuild/.claude/worktrees/e2e-1118`, at `92fea79a`, with one untracked
tagged test, `tests/acceptance/1118-e2e/cargo.test.mjs` (kept here as `cargo.test.mjs.txt`). It runs
`cargo build --workspace --all-targets --message-format=json` in its cwd, excluding deep-app and its six dependents,
which don't build on Linux until T8 (#1121), and logs every `compiler-artifact` message with `fresh: false` and every
`Compiling` line. Because the before lane runs it in both bays, it shows what cargo compiles in each.

`npm` is counted by a shim first on `PATH` (`npm-shim.sh`), which logs `pwd -P` and the arguments, then runs the real
npm. Each run is `node scripts/proof.mjs before`, issue #1118 (from gh), with `origin/main` pinned for the whole set.
The lane runs the 1118 acceptance tests and the probe test on the base and the change.

## Runs, in order

| Run | Proof code | Wall time | `npm ci` | Crates compiled, base / change | `Compiling` lines, base / change |
|---|---|---|---|---|---|
| `fbefore` | origin/main's (temporary copies) | 1174 s | 2 (both temporary copies) | 599 / 599 | 629 / 629 |
| `final1` | this branch, bays warm from earlier runs, tree just merged with main | 297 s | 2: base bay 1, change bay 1 (main's merge brought a new lock to both the merge base and the change) | 10 / 10 (deep-relay, deep-contracts, deep-hook and the tests the merge touched) | 3 / 3 |
| `final2` | this branch, same tree | 299 s | **0** | **0 / 0** | **0 / 0** |
| `final3` | this branch, one newline appended to `package-lock.json` | 356 s | **1, in the change bay** | 0 / 0 | 0 / 0 |

- **AC1.** `final2` runs `npm ci` 0 times. With the change's lock edited (`final3`) it runs once, in the change bay.
  In `final1` the merge base had moved past a lock change, and the base bay installed once.
- **AC3.** `final2`, a second proof of the same tree with `origin/main` pinned, compiles 0 crates in both bays. This
  input has no twin and runs no crash lane, so the twin and crash parts of AC3 are proven by the acceptance tests only.
- **AC4.** Each change-bay claim names `"untrackedFiles":["tests/acceptance/1118-e2e/cargo.test.mjs"]`, and that
  test ran in the change bay (its log line's `cwd` is `~/bay-e2e-home/deepbuild-bays/1/change`).
- **AC5, a reading.** Each run prints `proof: wall time … s`. Main's code took 1174 s on this commit, and the warm
  bays took 297–356 s. The load was 15–28 from other sessions throughout, so these numbers are readings, not a speed-up
  claim.
- **The seal.** Every claim says `"seal":"intact","cold":false`, and both bays' `BAY release` lines carry their
  `targetBytes` (about 16.7 GB base, 18.7 GB change).
- **Verdicts.** All four runs give the same before-lane verdicts: 8 PASS lines for the 1118 acceptance tests, which
  fail on the merge base. They also give one FAIL for the scratch probe test, which passes on the merge base as
  intended, because it is a probe, not a proof. Each run therefore exits 1.

An earlier set of runs on the pre-review code (`5da1b690`) read the same way: 0 crates and 0 `npm ci` on the second
run, and 1 `npm ci` in the change bay after a lock edit.

## Files

- `<run>.record.txt`: the run's `BAY claim` and `BAY release` lines, its wall time and its exit.
- `<run>.cargo.jsonl`: the probe's line per bay.
- `<run>.npm.log`: the shim's log.
- `cargo.test.mjs.txt`, `npm-shim.sh`: the probe test and the shim.

## Not run here

The Mac half (`Runs on: Spark + Mac`) was not run: the Mac's Remote Control dispatcher was unreachable from this
session. It stays open.
