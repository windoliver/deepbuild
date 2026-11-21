# Evidence: deep-drive's panics on main (#1546 AC1, #1427 AC7)

`mac-8e653d798/` (MacBook Pro Mac18,1, 2026-11-21, screen unlocked throughout; `exits.txt` has each step's load and exit code):

- **Base, main 7a256fd4b:** #1546 AC1 fails 5 of 6: the three seeds and the planted-view seed die on a `resize`, `cannot update deep_app::views::Shell while it is already being updated`. #1427 AC7 fails 4 of 4 on `motion_check`: `used a entity with the wrong context`, from `deep_app::card::tick` (`card.rs:336`), reached through `views::tick` and the drive's `tick_by`.
- **Head 8e653d798** (the deferred pointer replay, and a shell reset since removed): #1546's seeds 1546, 7 and 2026 pass with no panic, 4 of 6. #1427 AC7 still fails 4 of 4 in `card::tick`: the reset it had was of the wrong thread-local.
- **Still failing at this head in #1546:** the planted `record-in-thread-local` test and `seed 1546 with the planted view`. Both want a finding that names a `needs-you` view; since #1461 the Needs you section is drawn inside the sidebar's view, so the findings name `deepbuild/sidebar`.

`mac-ca8c6312f/` (same Mac, 2026-11-21, unlocked): the head with the card's thread-locals cleared when an app starts.

- **No panic in either suite.** #1546 AC1 is 4 of 6 as above.
- **#1427 AC7 still fails 4 of 4, on assertions the panic hid:** no element of the needs-you recording holds a session's ID; that recording's hash differs between processes; the session and project journeys end INCONCLUSIVE, under the planted jump too; so `scripts/motion.mjs` exits 1. By reading, the shipped journeys in `crates/deep-replica/src/drive/motion.rs` are as #1427 left them and the app moved under them: one list with asks first (#1461) and only rows in view drawn (#1808) put the session rows they hover below the window's fold, and the row's tooltip (#1458) fades on the real clock. Not fixed here.

`mac-856d10ed2/` (same Mac, 2026-11-21; the frontmost app's name in `exits.txt` is redacted, the login window's kept): #1427 AC7's fix, PR #3028's head 856d10ed2 against its base 5630469a7 (PR #3012's head).

- **Base:** `base-1427-ac7.txt`, 4 of 4 fail on the assertions above, no panic.
- **Head, screen unlocked:** `fix-1427-ac7-rerun.txt`, 4 of 4 pass in 91 s, the lock flag read unlocked at each of 5 samples; and again inside `fix-1427-all.txt` (4 of 4, 71 s). `scripts/motion.mjs` twice (`fix-motion-1.txt`, `fix-motion-2.txt`): exit 0, three PASS lines, the same three hashes, 361 steps each.
- **Head, first run, INCONCLUSIVE:** `fix-1427-ac7.txt`, 1 of 4 timed out at 1,800 s and 3 passed. The round's conditions broke during it: `exits.txt` has the screen unlocked and AC power at its start (11:24) and the screen locked and battery power at its end (12:26), with no sample between. Why it hung is not known, and a hang of the head's own is not excluded. Not counted as a pass or as a failure of the fix.
- **The probe** (`fix-probe.txt`, a diagnostic): at the reference window 1512×982 the session row `session:01MCBH57…` isn't drawn on any of the three centers; at 1512×2048 it is, at y 2,736 px of 4,096.
- **The suites the vendored animation change can reach fail the same tests at the base and at the head:** the rest of #1427's replica suites, 26 tests, all on the fixture panel's launch being refused (`main.js:23 imports "gpui-kit"`); #1458's replica suite, 3 of 8; #1482's counts AC13 and #1546 AC1's two planted tests, 3 of 29. None fails only at the head. Not fixed here.
