# Evidence: deep-drive's panics on main (#1546 AC1, #1427 AC7)

`mac-8e653d798/` (MacBook Pro Mac18,1, 2026-11-21, screen unlocked throughout; `exits.txt` has each step's load and exit code):

- **Base, main 7a256fd4b:** #1546 AC1 fails 5 of 6: the three seeds and the planted-view seed die on a `resize`, `cannot update deep_app::views::Shell while it is already being updated`. #1427 AC7 fails 4 of 4 on `motion_check`: `used a entity with the wrong context`, from `deep_app::card::tick` (`card.rs:336`), reached through `views::tick` and the drive's `tick_by`.
- **Head 8e653d798** (the deferred pointer replay, and a shell reset since removed): #1546's seeds 1546, 7 and 2026 pass with no panic, 4 of 6. #1427 AC7 still fails 4 of 4 in `card::tick`: the reset it had was of the wrong thread-local.
- **Still failing at this head in #1546:** the planted `record-in-thread-local` test and `seed 1546 with the planted view`. Both want a finding that names a `needs-you` view; since #1461 the Needs you section is drawn inside the sidebar's view, so the findings name `deepbuild/sidebar`.

`mac-ca8c6312f/` (same Mac, 2026-11-21, unlocked): the head with the card's thread-locals cleared when an app starts.

- **No panic in either suite.** #1546 AC1 is 4 of 6 as above.
- **#1427 AC7 still fails 4 of 4, on assertions the panic hid:** no element of the needs-you recording holds a session's ID; that recording's hash differs between processes; the session and project journeys end INCONCLUSIVE, under the planted jump too; so `scripts/motion.mjs` exits 1. By reading, the shipped journeys in `crates/deep-replica/src/drive/motion.rs` are as #1427 left them and the app moved under them: one list with asks first (#1461) and only rows in view drawn (#1808) put the session rows they hover below the window's fold, and the row's tooltip (#1458) fades on the real clock. Not fixed here.
