# #1118 on the Mac: three proof runs of one fixed input in bays

Reported by the Mac's Remote Control session and committed here unchanged, apart from this note. Its logs are on
the Mac under /tmp/db1118-logs and aren't committed.

A manual end-to-end run on the Mac (Mac15,12, 8 cores, macOS 14.7.7, Node 24.22.0, cargo 1.99.1) on 2026-11-04, of the
real repository. The proof code is claude/issue-1118-040190 at f17ae5c1, with origin/main at fde376f0 pinned for the
whole set. Every run used an isolated HOME, with RUSTUP_HOME, CARGO_HOME, npm_config_cache and GH_CONFIG_DIR
pointing at the real ones. Bays are under that HOME's ~/deepbuild-bays/, written ~ here. Each run held the machine's
Mac lock alone and started at a 1-minute load under 8, on AC power.

## The input

A detached worktree at f17ae5c1 with one untracked tagged test, tests/acceptance/1118-e2e/cargo.test.mjs.
- It is the Spark's `cargo.test.mjs.txt` without the exclusion list. On the Mac it runs
  `cargo build --workspace --all-targets --message-format=json` over every crate, and logs the compiler-artifact
  messages with fresh:false and the Compiling lines.
- npm is counted by a shim first on PATH, which logs `pwd -P` and the args, then runs the real npm.
- Each run is `node scripts/proof.mjs before`.

## Tests

`node --test tests/acceptance/1118/*.test.mjs tests/bays.test.mjs tests/acceptance/1117/*.test.mjs`: 38 tests, 38 pass,
0 fail, 0 skipped (06:02, load 2.15).

## Runs, in order

| Run | Wall time | npm ci | npm run build | Crates compiled, base / change | Compiling lines, base / change | Seal, cold |
|---|---|---|---|---|---|---|
| run1-cold | 1172 s | 2: base bay 1, change bay 1 | base 1, change 1 | 761 / 761 | 771 / 771 | none, cold (both) |
| run2-same | 155 s | **0** | base 1, change 1 | **0 / 0** | **0 / 0** | intact, warm (both) |
| run3-lock (one newline appended to package-lock.json) | 156 s | **1, in the change bay** | base 1, change 1 | 0 / 0 | 0 / 0 | intact, warm (both) |
| main's proof.mjs | not run | | | | | |

- **AC1.** run2-same runs npm ci 0 times. With the change's lock edited (run3-lock), it runs once, in the change
  bay: installed:true on the change claim only. `npm run build` runs once in each bay on every run; that is the bay's
  build step, not an install.
- **AC3.** run2-same, a second proof of the same tree with origin/main pinned, compiles 0 crates in both bays (1035
  artifacts, all fresh). This input has no twin and runs no crash lane.
- **AC4.** Each change-bay claim names `"untrackedFiles":["tests/acceptance/1118-e2e/cargo.test.mjs"]`, and the probe
  ran in ~/deepbuild-bays/1/change (its log line's cwd).
- **AC5, a reading.** proof: wall time 1171.9 s cold, then 154.8 s and 155.3 s warm. Main's code wasn't run on this
  commit, so there's no "before" reading from the Mac.
- **The seal.** The cold claims say `"seal":"none","cold":true`, with 6281 files written (base) and 6303 (change). The
  warm claims say `"seal":"intact","cold":false`. The BAY release lines report targetBytes 23,157,850,050 (base) and
  23,158,355,989 (change), about 23.2 GB each.
- **Verdicts.** All three runs give the same before-lane verdicts: 8 PASS for the 1118 acceptance tests, which fail on
  the merge base, and 1 FAIL for the probe test ("passed on the merge base"), as on the Spark. Each run therefore
  exits 1.
- package-lock.json was restored after run3-lock. The worktree's only change is the untracked probe test.

## Not run here

Main's proof.mjs (fde376f0), the wall-time "before" reading. It builds two temporary full copies, about 46 GB on this
Mac going by the bays' targetBytes. After the cold run, 11 to 12 GB was free with the bays kept. This stays open until
there is room.
