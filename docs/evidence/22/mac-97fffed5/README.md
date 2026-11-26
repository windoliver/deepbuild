# Mac round 22w at 97fffed5 (Mac15,12, M3, macOS 27.2.1)

Copied from the Mac runner and redacted (scan: no home path, user name or email). `exits.txt` has each part's power
source, load, thermal state and free disk.

- Part 3, the app by hand (`e2e/`), on AC: PASS, 3 PNGs.
- Part 4, the sign-in by hand (`signin/`), on AC: PASS, 1 PNG.
- Part 5, window suites (1459/identifier, 1459/panel, 1172/rows, 1172/panel, 1460/cli), on AC: all exit 0.
- Part 6, on battery from 18:44:
  - 1345: PASS.
  - 83/redraft-319: PASS.
  - 319/budgets: both tests skipped on battery. Unrun, not a pass.
  - 1349: exit 1, 12 failures. AC1/AC6 clean-account are INCONCLUSIVE by design. The journey and plants cases are
    BLOCKED: release-pack found no zig on the Mac to link deep-hook for linux-x64. Main's run on the same Mac is due
    in round 22x.
- Part 7, the judge: BLOCKED, on battery at its start; not run.
- Part 8: two independent checks. SCREENSHOT-CHECK.md (an agent on the Spark) and SCREENSHOT-CHECK-mac.md (an agent on the Mac, which also covers 22v's two pictures). Both find every picture MATCHes its log.

Still open, for round 22x on AC: 1349 at main side by side, 319 budgets, and the judge.

## The judge rerun on AC (`judge-rerun/`)

- On AC at start and end, thermal 0, wall 384 s, exit 1.
- FAIL on #22.48b6696b (#318.af2a2599); PASS on #22.1f14a778, #22.f57a814c and #22.3d85284a. Nothing reopened.
- Cause: main's `work.call` fixture, not #22's code (`../fix-318/README.md`).

## Round 22x (`../mac-22x/`), on AC

- A: 1349 at main b1fc9abb fails the same 12 of 15 as 22w at #22's head: clean account INCONCLUSIVE by design, the
  journey and plants cases BLOCKED on no zig.
- B: 319 budgets at 97fffed5 pass 2 of 2. Create or answer took 5279 ms; the inbox with 10,000 asks took 1386 ms.
