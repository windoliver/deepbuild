# Evidence for #1556: the Set up button no longer freezes the window

The owner's Mac (Mac15,12, MacBook Air 13" M3, macOS 14.7.7, node 24.22.0, cargo 1.99.1) ran these at 94075d37 on
2026-11-07, against the merge base c12a65bb. The Linux box (spark-c89f) ran the lint half. Load on the Mac was 13–90
throughout (other jobs were building), and nothing here is a timing budget: the click test's 100 ms frame judge passed
under that load.

## The acceptance tests (`tests/acceptance/1556`)

| Criterion | Test | 94075d37, on the Mac | Merge base c12a65bb |
|---|---|---|---|
| `#1556.784e6b2f` slow `deep`: a frame within 100 ms of the click showing it's working | `click.test.ts` | pass | fail: `deep-replica: unknown argument --click` |
| `#1556.ff055ca3` failing `deep`: its one-line error | `click.test.ts` | pass | fail, the same |
| `#1556.3f28018e` planted `Command::output` fails the lint lane naming the line | `lint.test.ts` | pass (also on Linux) | fail: no lint command names `views.rs:<line>` (Linux, BASE-FAILURE.txt) |

The twins and controls in `twins.test.ts` pass, 13 of 13, on the Mac and on Linux. With the slow `deep`, the replica's
frames after the click start at 2 ms, every one shows "Setting up…" until the one line at 3,480 ms, and no two are more
than 26 ms apart (176 frames). With the failing `deep`, 32 frames, the first at 1 ms, end on the error at 668 ms. The base
cannot be clicked through the replica; what it does instead is the `blocking` twin, which draws nothing for 3 s.

## The real app, by hand

`target/debug/deep-app` with a temporary HOME and a planted `deep` first on PATH (slow: sleeps 3 s and exits 0; failing:
sleeps 0.5 s, writes `deep setup: the planted failure of #1556, on purpose` and exits 1), Set up clicked for real, the app
stopped by PID. Screenshots are computer-use captures (`screencapture` has no screen-recording grant on that Mac), cropped
to the window. The window was not at the reference size.

- `head-slow-working.png`: right after the click, the button is gone and the window reads "Setting up…".
- `head-slow-done.png`: about 4 s after the click, the one line.
- `head-failing-error.png`: about 1 s after the click, the one-line error.
- `base-slow-frozen-0s.png` and `base-slow-frozen.png`: the merge base's build, right after the click and about 1 s
  after: the Set up button is still drawn and nothing says it's working; the line appeared about 5 s after the click.

Not shown: dragging the window during setup (the computer-use drag did not move it on this branch's run and was refused
on the base's), and the base's beachball (the captures leave out the cursor). The replica's frames are the evidence that
the window keeps drawing.

## Linux: `node scripts/affected.mjs` at 94075d37

On spark-c89f, with a HOME of its own so it had its own throttle table (the shared one was jammed). It selected 1,989
results: 1,058 passed, 190 already failing on main, 147 inconclusive or blocked, and 594 it called new. None of the 594 is
this change's:

- 416 are rustfmt diffs in files this change doesn't touch (this box's rustfmt 1.99.1 formats long chains unlike
  main's), 22 are `secrets: home path` in other issues' fixtures, and the rest of the lint lines (canvas-lint, slots,
  guide, clippy in deep-canvas) are in crates this change doesn't touch.
- The tests it called new were run again on a scratch worktree of the merge base c12a65bb and on this branch, in the
  same environment: 380/lines and 684/lanes (2 fail of 7 on both), 246/lanes, 246/repo-rules, 879/checkout, 879/lane,
  1114/timed-list, 882/replica and preflight.test.mjs (the same 21 fail of 58 on both), and deep-app's acceptance_1141
  (the same 2 fail on both). The others are this box's environment: no reference Mac (568, 594, perf), no GPU (377), no
  wasm32 target (140), no signed-in agent CLIs (48), the replica's and app's headless tests that draw on macOS only.
- WIDE: the change touches `scripts/lanes.mjs`, so the selection took every suite that reads the lanes.
- INCONCLUSIVE: 15 timed files not run (they need `--timed` on the reference Mac), and 147 results inconclusive or
  blocked off macOS, including this suite's two click tests, which passed on the Mac above.

The new `tests/blocking-call-guard.test.mjs` passes, and the lint lane's guard line reads `PASS blocking call`.
