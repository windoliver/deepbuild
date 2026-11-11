# #1118 on the Mac: proof runs of one fixed input in bays, and main's proof code on the same input

Reported by the Mac's Remote Control session. The 2026-11-04 runs are committed unchanged, apart from this note; their
logs were on the Mac under /tmp/db1118-logs and were lost when that folder was emptied, so their numbers survive only
as this reported text. The 2026-11-09 "before" run's files are committed under mac-before/, and the 2026-11-11 rerun
of the bays code, which replaces the lost "after" logs, under mac-after/ (section at the end).

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
| main's proof.mjs (`fde376f0`), 2026-11-09, below | 1065 s | 2: the first checkout, then the modules folder | 2 | 761 / 761 | 771 / 771 | n/a (temporary copies) |

- **AC1.** run2-same runs npm ci 0 times. With the change's lock edited (run3-lock), it runs once, in the change
  bay: installed:true on the change claim only. `npm run build` runs once in each bay on every run; that is the bay's
  build step, not an install.
- **AC3.** run2-same, a second proof of the same tree with origin/main pinned, compiles 0 crates in both bays (1035
  artifacts, all fresh). This input has no twin and runs no crash lane.
- **AC4.** Each change-bay claim names `"untrackedFiles":["tests/acceptance/1118-e2e/cargo.test.mjs"]`, and the probe
  ran in ~/deepbuild-bays/1/change (its log line's cwd).
- **AC5, a reading.** proof: wall time 1171.9 s cold, then 154.8 s and 155.3 s warm. Main's code on the same commit
  and input took 1065.0 s (below).
- **The seal.** The cold claims say `"seal":"none","cold":true`, with 6281 files written (base) and 6303 (change). The
  warm claims say `"seal":"intact","cold":false`. The BAY release lines report targetBytes 23,157,850,050 (base) and
  23,158,355,989 (change), about 23.2 GB each.
- **Verdicts.** All three runs give the same before-lane verdicts: 8 PASS for the 1118 acceptance tests, which fail on
  the merge base, and 1 FAIL for the probe test ("passed on the merge base"), as on the Spark. Each run therefore
  exits 1.
- package-lock.json was restored after run3-lock. The worktree's only change is the untracked probe test.

## The "before" reading: main's proof code on the same commit (2026-11-09)

Run by the Mac's Remote Control session; its files are in [mac-before/](mac-before/) (`runA.log` and `npm.log` saved as `.txt`, since the repository ignores `*.log`), with the macOS temporary
folder written `$TMPDIR` and home paths `~`. Same machine (Mac15,12, M3, 8 cores, macOS 14.7.7, Node 24.22.0), on AC
power. The Mac session reports that it ran alone, with the next timed job waiting for it.

- **Input, the same as run1..run3.** The bays' isolated HOME and the /tmp worktree from 2026-11-04 were gone, and
  f17ae5c1 is now an ancestor of origin/main, so the real repository would have compared f17ae5c1 with itself. So a
  local clone, `~/h1118a/repo`, detached at `f17ae5c1`, with `refs/remotes/origin/main` set to `fde376f0` in the
  clone only (`git merge-base HEAD origin/main` = `fde376f0`, as when run1..run3 ran after a real fetch on
  2026-11-04). `npm ci` in the clone, untimed. The only change in its tree: the untracked
  `tests/acceptance/1118-e2e/cargo.test.mjs`, the Spark's `cargo.test.mjs.txt` with no exclusion list. The npm shim
  as before, first on PATH.
- **Main's proof code from outside the tree,** so the change under proof is the #1118 branch plus the probe, as in
  run1..run3: `git archive fde376f0 scripts` unpacked to `~/h1118a/mainproof/scripts`, its `node_modules` linked to
  the clone's.
- **Command,** in `~/h1118a/repo` (from [runA-meta.txt](mac-before/runA-meta.txt)):
  `/usr/bin/time -l node ~/h1118a/mainproof/scripts/proof.mjs before`, with `HOME=~/h1118a/home`
  `RUSTUP_HOME=~/.rustup CARGO_HOME=~/.cargo npm_config_cache=~/.npm GH_CONFIG_DIR=~/.config/gh`
  `GIT_CONFIG_GLOBAL=~/.gitconfig PATH=~/h1118a/shim:… NPM_LOG=… E2E_LOG=…`. fde376f0's proof prints no wall-time
  line, so the wall time is `/usr/bin/time`'s.
- **When and load.** 09:14:52 to 09:32:52 UTC. It started once the 1-minute load fell under 8: the gate's last wait
  ([gate.txt](mac-before/gate.txt), local time 03:13:52, which is 09:13:52 UTC) read 9.54. At start the load averages
  were 5.32 / 8.59 / 7.53, at the end 17.80 / 26.74 / 23.95; the Mac session reports that its own cold builds were the
  load, and that run1..run3 used the same gate.
- **Disk** (`df -k /`, 1 KiB blocks): 71.7 GiB free at start, lowest 60-second sample 34.2 GiB (09:31:52), 70.7 GiB
  at the end, so the temporary copies were removed.

| | Wall | npm ci | npm run build | Crates compiled per copy | Compiling lines per copy | Verdicts |
|---|---|---|---|---|---|---|
| main's code (`fde376f0`) | **1065.0 s** (6020 s user, 522 s sys) | 2: the first checkout, then the modules folder | 2 | 761 / 761 (1035 artifacts each) | 771 / 771 | 8 PASS, the probe's FAIL |
| this branch, cold (run1) | 1171.9 s | 2: one per bay | 2 | 761 / 761 | 771 / 771 | the same |
| this branch, warm (run2, run3) | 154.8 s, 155.3 s | 0, then 1 with the lock edited | 2 | 0 / 0 | 0 / 0 | the same |

- **AC5 `#1118.e7117f8d`, a reading:** on the same commit and input, main's proof code took 1065 s; this branch took
  1172 s cold and 155 s warm. The before is `/usr/bin/time`'s real time and the after the proof's own `proof: wall
  time` line, a few seconds apart at most. The two were run five days apart from different isolated HOMEs at a
  1-minute load under 8, so the cold pair's 107 s gap is not read as a difference either way. The warm runs are what
  the bays change: 155 s against 1065 s.
- The verdicts are the same 8 PASS and 1 FAIL as run1..run3 ([runA.txt](mac-before/runA.txt)), so both readings did
  the same work. Each copy compiled the whole workspace ([e2e.jsonl](mac-before/e2e.jsonl)), as run1-cold's bays did.

## The "after" reading with its logs: the bays code on the same input (2026-11-11)

The 2026-11-04 "after" logs were lost, so the bays code was run again, cold then warm, on Run A's input. Its files are
in [mac-after/](mac-after/) (`runC1.log`, `runC2.log` and `npm.log` saved as `.txt`), with home paths written `~`.
Same Mac, on AC power, run by the Mac's Remote Control session.

- **Input and code.** The same clone as the "before" run, `~/h1118a/repo` at `f17ae5c1` with `origin/main` pinned to
  `fde376f0` and the untracked probe its only change ([runC-meta.txt](mac-after/runC-meta.txt)). The proof code is the
  clone's own `scripts/` at `f17ae5c1`, the #1118 bays code.
- **Command,** in `~/h1118a/repo`: `/usr/bin/time -l node scripts/proof.mjs before`, twice, with a new empty
  `HOME=~/h1118c/home` so the bays start cold; `RUSTUP_HOME`, `CARGO_HOME`, `npm_config_cache`, `GH_CONFIG_DIR` and
  `GIT_CONFIG_GLOBAL` as in the "before" run, the npm shim first on PATH, `CARGO_TARGET_DIR` unset.
- **When and load.** C1 04:54:16 to 05:12:17 UTC, C2 05:13:17 to 05:15:17 UTC. Each waited for a 1-minute load under
  8 ([gate.txt](mac-after/gate.txt) holds the waits, the last ones reading 12.63 for C1 and 15.15 for C2), and
  started at 6.36 and 7.02 ([runC-meta.txt](mac-after/runC-meta.txt)). Load averages: C1 6.36 / 7.60 / 5.24 at
  start, 15.15 / 21.05 / 17.08 at the end; C2 7.02 / 17.62 / 16.07 at start (its 5-minute load was still C1's),
  4.04 / 12.98 / 14.42 at the end. The gate read 19.31 two minutes before C1, so the Mac wasn't idle just before it.
- **Disk** (`df -k /`): 103.5 GiB free at C1's start, lowest sample 64.1 GiB; the bays (44 GiB) were deleted after C2.

| | Wall (`proof: wall time`) | `/usr/bin/time` real / user / sys | npm ci | npm run build | Crates compiled, base / change | Compiling lines | Seal, cold | Verdicts |
|---|---|---|---|---|---|---|---|---|
| C1 cold | **1039.0 s** | 1040.00 / 6146.88 / 516.37 s | 2: base bay 1, change bay 1 | 2 | 761 / 761 (1035 artifacts each) | 771 / 771 | none, cold (both) | 8 PASS, the probe's FAIL |
| C2 warm | **117.1 s** | 117.31 / 214.88 / 44.47 s | **0** | 2 | **0 / 0** (1035 artifacts each, none compiled) | **0 / 0** | intact, warm (both) | the same |

From [runC1.txt](mac-after/runC1.txt), [runC2.txt](mac-after/runC2.txt), [npm.txt](mac-after/npm.txt) and
[e2e.jsonl](mac-after/e2e.jsonl):
- **AC1.** C2, a second proof of the same tree with no lock change, runs `npm ci` 0 times: both claims say
  `"installed":false`, and the shim logged only one `run build` per bay.
- **AC3.** C2 compiles 0 crates in both bays: each bay's probe build reports 1035 artifacts with none in its
  `compiled` list (the compiler-artifact messages with `fresh:false`) and no `Compiling` line; both claims list
  `"crates":[]`.
- **AC4.** Both change-bay claims name `"untrackedFiles":["tests/acceptance/1118-e2e/cargo.test.mjs"]`, and the probe's
  build ran in `~/h1118c/home/deepbuild-bays/1/change` (its `cwd` in e2e.jsonl).
- **AC5 `#1118.e7117f8d`, a reading, now with logs on both sides:** on the same commit and input, main's proof code
  took 1065.0 s (2026-11-09); the bays code took 1039.0 s cold and 117.1 s warm (2026-11-11). Measured the same way,
  by `/usr/bin/time`'s real time (main's code prints no wall-time line), that is 1064.98 s against 1040.00 s and
  117.31 s. The cold runs are within 3% of each other, read as no difference: both build two full copies. The gain is the warm run, which keeps the bays'
  builds and packages: 117 s against 1065 s. All three are readings, not budgets: each 1-minute load rose above the
  Mac's 8 cores during the cold builds.
- **The seal.** C1's claims say `"seal":"none","cold":true` (6281 files written in base, 6303 in change); C2's say
  `"seal":"intact","cold":false`. The release lines report targetBytes 23,160,143,046 (base) and 23,160,658,345
  (change).

## Not run here

Nothing for the criteria. Main's proof code, open on 2026-11-04 for want of disk, ran on 2026-11-09, and the bays code
was rerun with its logs kept on 2026-11-11 (above).
