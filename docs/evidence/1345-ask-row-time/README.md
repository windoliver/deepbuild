# #1345 AC8 on main: an ask row's time slot drawn at zero width

On main since 0f34aacbe..d4cef00fb, `tests/acceptance/1345/batch.test.ts` AC8 fails on the reference Mac. The five calls' card rows and the Needs you count are right, but the list has no `ask:<id>:time` node, so the judge can't read when each call's recommended answer applies (Mac rounds 22ab and 22ac, `docs/evidence/22/mac-22ac-1345/` on PR #2097: it fails on main f17fa347c).

Cause, from reading the code, since the app draws headless only on macOS:
1. #1482 (d3d5143af) laid each row out as a cached root with no width, so a long title pushed the word and time past the list's clipped edge. Main has already fixed this, in 8a7b527e4 (`.w_full()`).
2. #1808 (f7e09b2f2) gives a row's time to its title when 12 characters of title don't fit beside the word and time, and draws the time slot at width 0. At the list's default 260 width, every taste ask row ("How it looks" plus a time like "tomorrow 10:00") falls under that rule. The deep-replica snapshot keeps only visible elements (`from_observed`), so the slot leaves the tree.

Fix: `keeps_time` in `crates/deep-app/src/views.rs`. An ask row keeps its time, the moment its recommended answer applies (#1458, #1345), and its title takes what's left. A session row gives its time to 12 characters of title, as before. #1808's rule names state words, and its criterion reads a row showing INCONCLUSIVE.

- `failing-first.txt`: the new unit test fails at 8005f72fb on its ask assertion, before the fix.
- `passing.txt`: deep-app's unit tests 110/110 after the fix, rustfmt clean. Clippy's one deep-app warning (views.rs:836, `Iterator::last`) is in main's code.
- AC8 itself, and #1808's window suite, run only on the Mac. See the PR for that round.
