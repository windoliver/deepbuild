# #1345 AC8 on main: an ask row's time slot drawn at zero width

On main since 0f34aacbe..d4cef00fb, `tests/acceptance/1345/batch.test.ts` AC8 fails on the reference Mac. The five calls' card rows and the Needs you count are right, but the list has no `ask:<id>:time` node, so the judge can't read when each call's recommended answer applies (Mac rounds 22ab and 22ac, `docs/evidence/22/mac-22ac-1345/` on PR #2097: it fails on main f17fa347c).

Cause, from reading the code, since the app draws headless only on macOS:
1. #1482 (d3d5143af) laid each row out as a cached root with no width, so a long title pushed the word and time past the list's clipped edge. Main has already fixed this, in 8a7b527e4 (`.w_full()`).
2. #1808 (f7e09b2f2) gives a row's time to its title when 12 characters of title don't fit beside the word and time, and draws the time slot at width 0. At the list's default 260 width, every taste ask row ("How it looks" plus a time like "tomorrow 10:00") falls under that rule. The deep-replica snapshot keeps only visible elements (`from_observed`), so the slot leaves the tree.

Fix: `keeps_time` in `crates/deep-app/src/views.rs`. An ask row keeps its time, the moment its recommended answer applies (#1458, #1345), and its title takes what's left. A session row gives its time to 12 characters of title, as before. #1808's rule names state words, and its criterion reads a row showing INCONCLUSIVE.

- `failing-first.txt`: the new unit test fails at 8005f72fb on its ask assertion, before the fix.
- `passing.txt`: deep-app's unit tests 110/110 after the fix, rustfmt clean. Clippy's one deep-app warning (views.rs:836, `Iterator::last`) is in main's code.
- `mac-1345a/`, the Mac at the fix cba9ad36f: 1345 batch 3/3 pass, AC8 included. #1808 failed the same 4 tests at the fix and at main 8005f72fb (window-server drags, the taste call). #1458 failed 6 at the fix, and round 1345b (`mac-1345b/`) failed the same 6 at main 8005f72fb, so those are main's too. Read the raw files: `exits.txt`'s AC lines say "not found" because colour codes were left in.

## At the final code head f26c9f847 (main 703ea8e49 merged in)

- `f26c9f847/` on the Spark: `guard.txt` (`proof.mjs guard` PASS), `fix-reverted.txt` (with `keeps_time` back to `room >= least`, the unit test fails on its ask assertion), `unit.txt` (deep-app's unit tests 112/112), `fmt.txt` (rustfmt's diffs are in `list.rs`, `record.rs` and `states.rs`, none this change touches).
- `mac-1345c/`, the MacBook Pro. `rerun2/f26c9f847/1345-batch.txt`: the 1345 batch passes 3 of 3 at the head (the file holds three tests, AC3, AC7 and AC8; the default reporter names only the slow two). `rerun3/703ea8e49/1345-batch.txt`: at main AC3 and AC7 pass and AC8 `#1345.69fa185d` fails on its own assertion, no time on the five rows. `rerun4/`: #1808 fails the same 4 tests at the head and at main (13 pass), #1458 the same 5 (8 pass), and deep-app's unit tests pass 112/112 at the head.
- Void and kept: `stopped-first-exits.txt` and `rerun2/703ea8e49/` stopped or failed on the Mac's full disk (ENOSPC), so they read nothing.
