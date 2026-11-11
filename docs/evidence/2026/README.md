# #2026 proof

These are the blind suites' outputs: `tests/acceptance/2026/` (the first draft, written from the issue, the design and
base `6e55e5841`) and `tests/acceptance/2026-redraft-ac3/` (AC3's blind redraft, written from the same inputs and the
dispute below). Each file ran one at a time with `--no-file-parallelism`, on macOS 27.2 arm64 with Node 24.22.2, on a
shared Mac. Every hub and `deep` command ran under a temporary `HOME`. Paths in the files are redacted to `<repo>` and
`<tmp>`. Each suite's `BASE-FAILURE.txt` holds its failing run at the base.

Two implementation commits: `19a06fd34` (the change) and `8badcd657` (the views redraw once the history folds, so the
first screen's rows carry each ask's kind and deadline as the base's do). The final code is `8badcd657`.

| Criterion | File | Commit | Reading |
|---|---|---|---|
| AC1: Needs you loads in under 1 s with 30 days of history | `ac1-load.txt` | `8badcd657` | **Passed** at load ~60: five launches over #26's heavy month (about 12,000 events), each first frame within 1000 ms of spawn with Needs you read (its count and rows among the record's open asks). The passing reporter printed no per-launch times. |
| AC1, under load | `ac1-load-loaded.txt` | `19a06fd34` | INCONCLUSIVE at load ~500 (thermal state not nominal): 7884, 6869, 7552, 7008, 5794 ms. Before the first-paint change the same first screen took 11.0 to 17.1 s at load ~250; at the base, 4.3 to 19.3 s (`BASE-FAILURE.txt`). |
| AC2: the count always matches the record's open asks | `ac2-count.txt` | `8badcd657` | 1 of 1 passed |
| AC3: a spooled-then-replayed permission request shows within 1 s of its replay, after 20 newer events; a reader keeping its place by event ID fails | `ac3-redraft.txt` | `19a06fd34` | 3 of 3 passed: the ask showed within 1 s of the replay, and both planted readers (`replay-keeps-place-by-id`, `asks-keep-place-by-id`) failed naming the spooled request |
| AC3 on the final code | `ac3-redraft-final-blocked.txt` | `8badcd657` | **BLOCKED**: the screen locked at 18:32, so `deep-live --watch` wrote no ready line. Owed. |
| AC3, first draft (kept by hand) | `ac3-first-draft.txt` | before `19a06fd34` | Fails: its home declares no ask deadline, so a correct hub refuses the ask (`BLOCKED: no deadline for authority asks …`); its planted app reader can't fail under the design (below) |
| AC4: one number on the menu bar, Home and `deep inbox`; the rows add up; the plants fail | `ac4-one-number.txt` | `8badcd657` | 3 of 3 passed: the fixture, `home-skips-decision-close` and `menu-bar-counts-sessions` |
| AC5: within 2 s every surface says the hub isn't answering and since when; on reconnect the record shows at the new `log_pos`; the plants fail | `ac5-outage.txt` | `19a06fd34` | 3 of 3 passed: the clean run, `hub-down-nothing-needs-you` and `hub-down-keeps-count` |
| AC5 on the final code | `ac5-final-blocked.txt` | `8badcd657` | **BLOCKED**: screen locked, as AC3's. Owed. |
| AC5, first run | `ac5-first-run.txt` | before `19a06fd34` | Failed before the heading fix: Home's heading said only "Pop out Needs you" while the hub was down. Its "once it's back" lines came from a window that drew no frame after the restart (Notes). |
| AC6 | — | — | Proven by #1455 |

`8badcd657` changes only what the views draw after the fold: the list's rows and count come from the same rows before
and after it. So AC3's and AC5's judgments (the ask's row, the counts, the hub-down words, the `log_pos`) don't move
between the two commits; their reruns on `8badcd657` are owed once a display is unlocked.

## The AC3 dispute

The first draft's wrong program is the app's record reader keeping its place by event ID. Under the design that
reader can't fail. A replayed request "still becomes an ask you see" (design, the hook protocol), and the asks core
lives in the hub, so the ask is a new `ask.created` with a new ID and a new `log_pos`. An app that skips older IDs
skips only the replayed `permission.request` frame, which the list doesn't draw. The redraft moves the wrong program
to the hub's readers that meet the replayed request: the spool replay and what raises the ask. It also gives its home
the ask settings `deep setup` drafts (`draftAskSettings`), without which a correct hub refuses the ask as BLOCKED.
`scripts/lanes.mjs` runs the redraft in the first draft's place and keeps the first draft's AC3 file by hand.

## Notes

- **Reconnect frames.** `deep-live --watch` writes a line per drawn frame, and GPUI stops drawing a covered,
  minimized or off-Space window, or one on a locked or sleeping display (`window_did_change_occlusion_state`). In the
  first AC5 run and in one of seven scratch restarts on this shared Mac, the window drew nothing after the restart and
  wrote nothing to stderr. The other six scratch restarts drew the new record, the five timed ones 1.8 to 1.9 s after
  the restart, and the AC5 run after the fix passed. I didn't catch a stalled instance to prove it was covered.
- **Shared binaries.** Both suites copy their app builds into `$TMPDIR/da2026-bin-<uid>/`, in place. macOS kills a
  binary overwritten after it ran, and two checkouts running the suite share that folder. The redraft deletes the
  copies before building; the first draft doesn't, so a second run of its app files needs them deleted first.
