# #1117 bays on the Spark, by hand, on the real repository (2026-11-03)

Readings, not budgets: the Spark at a 1-minute load of 5 to 20 from other sessions' work.

- **Machine:** the Spark (Linux aarch64, 20 cores).
- **Tree:** this branch's worktree, a worktree of the Spark's repository. Runs 1 to 7 used `b86f9dd6`, run 8 `8303bf96`.
- **Command:** `node scripts/bays.mjs change -- sh -c 'cargo build --workspace --all-targets --locked <excludes>'`. The excludes are deep-app and its six dependents (deep-panel-host, deep-gpu-layer, deep-replica, deep-show, deep-text-render, deep-marks-render), which don't build on Linux until T8.
- **HOME:** `~/bay-e2e-home`. On that day the machine's real throttle table granted nothing new. Two other sessions' long `test` grants were held while their preflight and perf `timed` requests drained the table, so every new grant waited. So the bays and the throttle table lay under that HOME. cargo, rustup and npm used the real homes and caches.
- **The repository:** runs 1 to 7 reached it through `~/bay-e2e-home/deepbuild`, a link to `~/deepbuild`. Run 8 ran after the rule changed to "a worktree of the repository holding bays.mjs" (the Mac keeps its repository at `~/private/deepbuild-core`), with that link removed.

Hashes and the home path are shortened (`…`, `~`) below.

| Run | What was done first | Claim record | cargo |
|---|---|---|---|
| 1 | nothing: first use, with `CARGO_TARGET_DIR` set in the parent | `seal:none cold:true installed:true written:5894` | 629 `Compiling` lines, 78 s |
| 2 | nothing: the same tree, `CARGO_TARGET_DIR` set again | `seal:intact cold:false installed:false written:0` | **0 `Compiling` lines**, 1 s (AC1) |
| 3 | an uncommitted line appended to `crates/deep-hook/src/main.rs` | `seal:intact written:1` | deep-hook only |
| 4 | that edit undone | `seal:intact written:1` | deep-hook only |
| 5 | a `libdeep_contracts-*.rlib` byte rewritten in place with `dd conv=notrunc`, its mtime put back with `touch -r` (same size and inode) | **`seal:broken cold:true`** (AC4) | 629 `Compiling` lines, a cold build |
| 6 → 7 | a run of `sleep 600` whose bays.mjs was killed alone with SIGKILL, leaving its `sleep` running in the bay | **`seal:none cold:true stopped:true`** (AC5, and the orphan stopped) | 629 `Compiling` lines; the orphaned `sleep` was gone after the claim |
| 8 | three commits later (the scripts changed), the repository reached without any `~/deepbuild` under HOME | `seal:intact cold:false written:5` | 0 `Compiling` lines |

- **AC7:** after runs 1 and 2, the parent's `CARGO_TARGET_DIR` folder held 0 entries. Every build wrote `~/bay-e2e-home/deepbuild-bays/1/change/target`.
- **AC8:** every release record carries `targetBytes`: 15977928521 after run 1, 15987355834 after run 3.

```
BAY claim {"index":1,"role":"change","bay":"~/bay-e2e-home/deepbuild-bays/1/change","tree":"b86f9dd6…","seal":"none","cold":true,"stopped":false,"installed":true,"written":5894,"deleted":0}
BAY release {"index":1,"role":"change","bay":"~/bay-e2e-home/deepbuild-bays/1/change","status":0,"targetBytes":15977928521,"touched":0}
BAY claim {"index":1,"role":"change","bay":"~/bay-e2e-home/deepbuild-bays/1/change","tree":"b86f9dd6…","sealedTree":{…},"seal":"intact","cold":false,"stopped":false,"installed":false,"written":0,"deleted":0}
BAY claim {… run 5 …,"seal":"broken","cold":true,"stopped":false,"installed":true,"written":0,"deleted":0}
BAY claim {… run 7 …,"seal":"none","cold":true,"stopped":true,"installed":true,"written":0,"deleted":0}
```

Not run here: anything on the Mac (macOS, APFS, the Mac's single pair), and the real throttle table under the real HOME.
