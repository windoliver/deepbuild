# Twins for the 3334 tests

No implementation existed when these tests were drafted, so no twin folder is here yet. Each twin is to be the merged
implementation's file with exactly one rule broken as below, and nothing else changed: same flags, same lines, same
record fields, same exit statuses. A twin replaces one file of the product (`scripts/throttle.mjs` or
`scripts/lane-remote.mjs`), never a file under `tests/`. Each was checked against a throwaway implementation with that
fault, in this job's scratch folder, and failed the test named, at its assertion (`../BASE-FAILURE.txt`).

| Criterion | Twin | Replaces | The one rule it breaks | Test it fails, and where |
|---|---|---|---|---|
| `#3334.6c8b5837` | `fixed-wait` | `scripts/throttle.mjs` | `--stall <min>` is taken and read as `--wait <min>`: a fixed deadline `<min>` minutes after the request joins the line, whether or not grants change hands meanwhile. On that deadline it leaves the line as a timed-out wait does (`INCONCLUSIVE no grant`, exit 3). Everything else, `--wait` and `acquire(class, { wait })` among it, is unchanged | `stall.test.mjs`, the `#3334.6c8b5837` test: the request behind the moving line exits 3 after about 3 s, not 0 |
| `#3334.e38df940` | `far-fixed-wait` | `scripts/lane-remote.mjs` | The far end asks for its install and build grants with `--wait <bound>` in place of `--stall <bound>`, the bound still being `DEEP_LANE_REMOTE_STALL_MIN` (30 when unset). How it reads a missing grant is the merged one's | `far-moving.test.mjs`: npm ci's request times out after 3 s behind the moving queue, so the near end reads `INCONCLUSIVE` (or `BLOCKED`), not `PASS unit on <host>` |
| `#3334.f5046205` | `far-blocked` | `scripts/lane-remote.mjs` | The far end waits on `--stall` as merged, but reads a missing grant as the base does: `BLOCKED lane-remote: npm ci got no build grant or failed…`, exit 3, and no record and no `RECORD` line | `far-stalled.test.mjs`: the near end prints no `INCONCLUSIVE unit on <host>`; it reads `BLOCKED lane-remote` and exits 3 |
| `#3334.5d28f79a` | `far-swallows-failure` | `scripts/lane-remote.mjs` | The far end reads every failed install or build through the throttle as no grant: a failed `npm ci` (the throttle exiting with the command's status) writes the `INCONCLUSIVE` record, with one `INCONCLUSIVE` finding, and the near end reads `INCONCLUSIVE <lane> on <host>`, exit 2 | `far-failed.test.mjs`: no line starts `BLOCKED lane-remote`, the near end prints `INCONCLUSIVE unit on <host>` and exits 2, not 3 |

`#3334.ed504fe3` has no twin: its test fails on the merge base at its assertion, where `--stall` is an unknown flag
(`BLOCKED throttle: usage: …`, exit 2). `fixed-wait` happens to fail it too (its line reads `no build grant came within
0.05 min` and names no build holder), but the before lane doesn't need that.

`#3334.e38df940` and `#3334.5d28f79a` pass on the merge base, whose far end waits 30 minutes, far past the fixture's
moving queue, and reads a failed `npm ci` as `BLOCKED lane-remote`. Their twins are their only proof of failing first.
`#3334.6c8b5837` and `#3334.f5046205` fail on the merge base too, but the issue asks for each planted wrong program shown
failing first, so they keep their twins.
