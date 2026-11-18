# Criterion 1 redrafted on the owner's ruling about `brief.uncited`

The repo owner ruled: "`brief.uncited` is a recorded event kind." The frozen criterion 1 proof listed it as a name that
is no event kind, so under the ruling that list hid real drift. This redraft was written blind, as before, from issue
#2063, the design docs, the base commit `fcd8c3852` and this folder's own files. Every existing file here stays as
committed, under the proof guard; retiring the frozen ones is the owner's to approve.

## What it supersedes

| New file | Supersedes |
|---|---|
| `ac1-recorded-tracker-ruled.test.mjs` | `ac1-recorded-tracker.test.mjs` |
| `fixtures/not-event-kinds-2026-11-14-ruled.txt` | `fixtures/not-event-kinds-2026-11-14.txt` |
| `README-ruling.md` | `README.md`'s criterion 1 row, and its paragraph on the recorded list as far as `brief.uncited` goes |
| `BASE-FAILURE-ruling.txt` | `BASE-FAILURE.txt`'s criterion 1 entry |

Both criterion 1 tests carry `#2063.1fc4ef66`. The frozen one still passes on a lane that reads the list correctly,
because it plants its own list with `brief.uncited` in it. That is the reading the ruling overturns, so it proves
nothing more.

## The recorded list

`fixtures/not-event-kinds-2026-11-14-ruled.txt` is the frozen list without `brief.uncited #1193`. It has 12 entries:
`layer.puffs #2142`, `job.status #2136`, `lease.gpu #2133`, `user.pan #2056`, `archive.scene #2036`,
`plan.overlay #1260`, `plan.sheet #1260`, `process.conserve #980`, `process.busy #980`, `process.little #980`,
`stack.slot #335`, `move.feel #274`. Each is beside a recorded issue that names it in backticks.

## The test

`#2063.1fc4ef66` runs over the recorded tracker (`fixtures/open-issues-2026-11-14.json`) and the planted docs, as the
frozen test does.

- **Before**, with an empty list: `FAIL`, non-zero, and a line each for the five names the issue gives with their
  issues (`plan.overlay` 1260, `move.feel` 274, `process.conserve` 980, `archive.scene` 2036, `stack.slot` 335).
- **The list's shape**: every entry is `<name> #<issue>` beside a recorded issue whose body holds the name in
  backticks. It holds the five beside those issues and does not hold `brief.uncited`.
- **After**, with the list planted as the copy's `scripts/not-event-kinds.txt`, no output line names any listed name.
  Then the verdict follows the catalogue, which the test reads from the checkout's `packages/contracts/dist`:
  - if the catalogue holds `brief.uncited`: `PASS` and 0;
  - if not: `FAIL`, non-zero, and a line names `brief.uncited` and 1193.

## Readings

- **The verdict follows the catalogue.** The criterion says "passes"; the ruling says `brief.uncited` is an event kind.
  Both hold only if the change catalogues `brief.uncited`. A change that leaves it uncatalogued correctly fails the
  lane, naming it. The test accepts either, and refuses only a list or lane that hides it.
- **"Recorded"** is read as "an event kind the hub records", not as "already in the catalogue". At `fcd8c3852` the
  catalogue lacks `brief.uncited`, and so does the worktree's build at the time of this redraft, so the lane fails
  there naming it alone.
- **Docs stay planted.** The base's `docs/technical-design.md:537` also names `brief.uncited`. That drift is the live
  lane's to report, not this record's.

## Wrong programs checked

These ran in scratch copies of `fcd8c3852` (`BASE-FAILURE-ruling.txt`):

- **The base's lane** fails at "with the day's list the lane still names layer.puffs …".
- **The frozen list** (with `brief.uncited`) fails at "the recorded list holds brief.uncited …".
- **`twins/passes-any-name-once-listed`** fails at "brief.uncited is an event kind the catalogue lacks, so … FAIL".
- **The blind job's throwaway fix** passes.
