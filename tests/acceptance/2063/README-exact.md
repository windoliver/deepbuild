# Criterion 1 tightened: the exact set of names the lane reports

A review of `ac1-recorded-tracker-ruled.test.mjs` found that its FAIL branch checks only the verdict and that some line
names `brief.uncited` and 1193, so a lane that reports `brief.uncited` and more passes it. The owner approved
tightening it. This redraft was written blind, as before, from issue #2063, the design docs, the base commit
`fcd8c3852`, this folder's own files, the owner's ruling that `brief.uncited` is a recorded event kind and the
decision "Accept redraft reading". Every existing file here stays as committed.

## What it supersedes

| New file | Supersedes |
|---|---|
| `ac1-recorded-tracker-exact.test.mjs` | `ac1-recorded-tracker-ruled.test.mjs` (which itself superseded `ac1-recorded-tracker.test.mjs`) |
| `README-exact.md` | `README-ruling.md`'s description of the test and its wrong programs |
| `BASE-FAILURE-exact.txt` | `BASE-FAILURE-ruling.txt` |
| `twins/reports-every-family/` | none; a new twin (below) |

It reads the same `fixtures/open-issues-2026-11-14.json` and `fixtures/not-event-kinds-2026-11-14-ruled.txt`. All
three criterion 1 tests carry `#2063.1fc4ef66` and run under the suite's glob until the owner retires the old two.

## The test

It has the ruled test's before half and list checks unchanged. The after half, with the ruled list planted, is new:

- **The exact set.** The candidates are every backticked `<family>.<name>` in the record's bodies that the catalogue
  (the checkout's `packages/contracts/dist`) lacks: 59 names today. Listed names, names in catalogued families and
  names in no catalogued family (`memory.ts`, `scene.water` …) all count. None but `brief.uncited` may appear in
  any output line. A name counts as a whole token, so `scripts/lanes.mjs` doesn't read as `lanes.mjs`.
- **If the catalogue holds `brief.uncited`:** `PASS` and 0.
- **If it doesn't:** `FAIL`, non-zero, and a line names `brief.uncited` and 1193. Every issue number given with `#` on
  a line naming `brief.uncited` must be among its record sources. The test first asserts those sources are #1193
  alone; the docs are planted.

## Readings

- **"The names it reports" is the record's names found in its output.** The issue fixes no output format, so the test
  doesn't parse one. It looks for each name the lane could report. A lane that reports a name the record doesn't
  hold in backticks can't be caught this way, and reporting such a name would be a different bug.
- **A count isn't asserted.** The base's lane prints "N event kinds", but the issue doesn't name a count.

## The twin, and why it isn't in twins.json

`twins/reports-every-family/scripts/catalogue-drift.mjs` is the blind job's throwaway fix with one fault: it
over-reports. It reads every backticked `<family>.<name>` in an issue that the catalogue lacks and the list doesn't
hold as an event kind, whatever its family. It passes the ruled test and fails this one.

`scripts/proof-runs.mjs` reads one twins file per acceptance folder, `tests/acceptance/<issue>/twins.json`. A second
file isn't read, and `twins.json` is committed and guarded, so the twin isn't entered. Entering it takes this line
in `twins.json`, under the owner's approval:

```json
"#2063.1fc4ef66": ["reports-every-family"]
```

Without that line, the test proves the criterion through its failure on the merge base at its own assertion
(`BASE-FAILURE-exact.txt`).
