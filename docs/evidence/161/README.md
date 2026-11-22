# #161 evidence

Runs of `tests/acceptance/161` (written blind, commit 58cc83969) on a Mac17,10, macOS 27.2, debug builds. Paths in the
logs are shortened to `<repo>`, `<base checkout>` and `<tmp>`.

## The base fails every test

`base-run.txt`: the whole suite at the merge base 7a256fd4b, on the base's own `deep-gpu` and `deep-show`.
15 files failed of 15, 26 tests failed of 26, each for the reason the suite's `BASE-FAILURE.txt` gives: the pack
lacks 53 of the 70, the seven `--planted` names are unknown, `fx.invert@1` leaves (0.7993, 1, 1, 0.251), a 2D view
draws at scale 1 whatever its surface says, a pack operator named `blur@1` is admitted, and there is no task.

## This branch

`acceptance.txt`: each file once at d85bd5262 (the branch merged with main b6b99ad8c), clean tree.

| Criterion | File | Result |
|---|---|---|
| 1 `#161.66726728` | `ac1-reference` | 2 passed |
| 2 `#161.2bd9eeb2` | `ac2-spline-homography` | 1 passed |
| 3 `#161.3c68daec` | `ac3-pack-check` | 2 passed |
| 4 `#161.f2821130` | `ac4-cost` | 2 passed |
| 4, measured | `ac4-measured` | INCONCLUSIVE, with readings that would fail (below) |
| 5 `#161.8352d648` | `ac5-status-guard` | 1 passed |
| 6 `#161.729a03cd` | `ac6-budgets` | 3 passed |
| 6, timed | `ac6-timed` | INCONCLUSIVE: nothing was timed |
| 7 `#161.01550f9e` | `ac7-slice-shift` | 2 passed |
| 8 `#161.6de2bd55` | `ac8-invert-premultiplied` | 2 passed |
| 9 `#161.99d85364` | `ac9-alpha-guard` | 2 passed |
| 10 `#161.1392976e` | `ac10-moved-group` | 2 passed |
| 11 `#161.8ed2354e` | `ac11-internal-scale` | 2 passed |
| 12 `#161.6c7f6fc1` | `ac12-linear-color-key` | 2 passed |
| 13 `#161.2dcc0047` | `ac13-taste` | INCONCLUSIVE: no taste call is recorded |

## The head, after two more merges of main

`acceptance-head.txt`: the thirteen untimed files once more at bbe9ee3a8 (main 89df55943 merged in), on binaries built
from it. The same 12 files and 23 tests pass; `ac13-taste` is INCONCLUSIVE, and the fifteen files it kept have the
SHA-256s of those in `shown/`.

## The pack as it ships: ten operators reworked, costs from readings

`acceptance-rework.txt`: the thirteen untimed files once more, on binaries built from 26ed84911 with the pack of this
commit. All thirteen pass, 24 tests, `ac13-taste` among them: `TASTE.json` is the owner's call on the fifteen files
now in `shown/`. Ten operators take fewer taps or one noise in place of three, so the operator check's estimate of
each falls toward what it measures; four sheets changed with them (blur, distort, generate, stylize) and the owner
looked at those four again.

`costs-readings.txt`: where each declared cost comes from. Two readings of `calibrate` at a load of 48 and 38, so
they are not a result: the measured half of criterion 4 is still unproven, and so is the timed half of criterion 6.

## The timed files

`timed.txt`: the two timed files once more inside a timed grant of the throttle, started at a one-minute load of 13.05.
The load was 25.9 by the end of the calibration run, above the 18 cores, so both read INCONCLUSIVE.

`ac4-measured` printed its readings, and they are far from the declarations, which are the operator check's
estimates: most operators measure 0.04 to 0.08 ns a pixel whatever they declare (0.008 to 0.03 for the cheap ones),
`fx.cell_pattern@1` 2.35 against 0.0477, `fx.compound_blur@1` 0.96 against 0.1895, `fx.minimax@1` 0.97 against 0.1744,
`fx.directional_blur@1` 0.085 against 0.165. They are readings under load, not a result, but two earlier readings of
`calibrate` showed the same picture. The check refuses a declaration under its estimate ÷ 1.25, so an operator whose
estimate is more than 1.67 times its measured cost can't declare a cost that the check accepts and the criterion holds.
Criterion 4's measured half is open.

`calibrate-readings.txt`: two readings of `calibrate` on a quiet machine (load 5.9 and 7.1, thermal state nominal) that
was on battery, so they count for no test. As declared, 1 of the 70 is within 25%. Most operators read about 0.065 ns
a pixel whatever they estimate, and 11 of main's own shipped and fixture graphs read outside #429's bound in the same
readings (`pixel_hash@1` 0.047 against an estimate of 0.0046, `fixture.fbm8@1` 3.09 against 0.29).

`ac6-timed` stopped before timing anything.

## Shown

`shown/`: the fifteen files `ac13-taste` kept from the run in `acceptance-rework.txt`, each named with its SHA-256: a sheet
per effect category, `levels`, `curves`, `corner_pin`, the slice_shift title (frame 7) and its recording (frames 0
to 41 at 50 frames a second, an animated PNG). The taste call is a person's: a file named by `DEEPBUILD_TASTE_161`,
`{"criterion": "#161.2dcc0047", "by": "you", "screenshots": [the fifteen SHA-256s], "call": "looks_right" | "looks_wrong"}`.
