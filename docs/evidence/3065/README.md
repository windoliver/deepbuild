# #3065 recorded reach: the reading, 2026-11-22

One recording on the reference Mac, then `compare` on #2673's three fixture changes and on `crates/deep-hook/src/main.rs`, the issue's motivating example.

- **What ran.** `node scripts/reach.mjs record <the 230 files of files.txt>` at commit f1872350f (tree 95c248e9b3aac3de7f08ae92f62e43a8627e7f42), one test grant, waiting 480 min for it. It started 19:57 PST 2026-11-21 at load 58, got its grant at 22:33 behind two other sessions' runs, and ended at 01:24 at load 58, exit 0: 19,604 s in all, 2 h 51 min of it running files. 149 of 230 files ran whole and passed and have a row, 81 have none (`record.txt`).
- **Why a subset.** The whole unit lane is 4,563 files; on this Mac, at a load of 58 to 155 on 12 cores, 230 took 2 h 51 min, so the lane would take about two days. They are a sample of the tests each change below selects (hub, deep-canvas, deep-hook helpers and the root `tests/` scripts), so most selected tests still have no row and `compare` counts them as reaching.
- **Why no row.** Of the 81: 42 FAIL, 16 BLOCKED, 4 INCONCLUSIVE, 3 with a skipped test, 1 ran past 60 min, mostly under that load (5 s first-test timeouts, perf grants that never came), and some fail on main without recording; 15 had a node process that left no coverage, killed or still running at the job's end (`record.txt`, the `left no coverage` lines).
- **Where.** In this worktree, with its warm `target/`, not a fresh GitHub clone.
- **The record's shape.** 676 KB; 149 rows, each with only `binaries`, `cargo` and `files`; 786 distinct strings, every one a checkout path or a workspace binary name. Kept out of the repository for its size.

| Change | Selected | No row (counts as reaching) | Recorded as reaching | Recorded as not reaching | Not reaching, of the selected | Not reaching, of those with a row |
|---|---:|---:|---:|---:|---:|---:|
| `packages/hub/src/index.ts` | 635 | 567 | 573 | 62 | 9.8% | 62 of 68, 91% |
| `crates/deep-canvas/src/lib.rs` | 63 | 25 | 60 | 3 | 4.8% | 3 of 38, 8% |
| `docs/technical-design.md` | 0 | 0 | 0 | 0 | — | — (no row can show a read of a doc) |
| `crates/deep-hook/src/main.rs` | 1,346 | 1,257 | 1,327 | 19 | 1.4% | 19 of 89, 21% |

Hand check of the hub figure: the hub tests start the hub through `packages/cli/dist/main.js`, which loads `@deepbuild/hub` (`src/index.ts`) only by `await import` in other commands, while `deep hub run` imports the `@deepbuild/hub/hub` subpath. So 43 of the 62 load no hub source at all, and 19 load from 7 to 148 of them (145 or more for 13) but not `index.ts`.

"Selected" is `select()`'s tests, as `affected.mjs --list` shows them: it includes its timed, slow and by-hand files, which this recording didn't run, so they have no row and count as reaching.

**Against the issue's one-third bar.** This reading can't settle it. By `compare`'s count, with every test that has no row counted as reaching, no change is near a third. Among the tests that have a row, the hub change is far past it (91%) on only 68 of 635 selected tests, and the crate changes are not (8%, 21%). Settling it needs a record of the whole lane.

`compare.txt` holds the four outputs, with each NOT REACHED test.
