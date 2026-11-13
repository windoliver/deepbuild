# Blind redraft of #1116's tests that #1874's rule contradicts

#1874 changes when a window closes an issue: only when every unticked criterion it holds is named by a task that passed in the commit's record. At #1116 a pass closed an issue whose unticked criteria all matched `budget`, `reference Mac` or `in the local preflight`. The fixture task of `tests/acceptance/1116/helpers.mjs` names no criterion, so no window that meets #1874 closes a #1116 fixture issue, and five #1116 tests expect a close. This folder redrafts those five from #1116's criteria (as `tests/acceptance/1116/README.md` quotes them), #1874's text and the base `f28d8777`, drafted by #1874's blind acceptance job, with #1874's surface (`tests/acceptance/1874/README.md`): `criteria` on a task of `benchmarks/budgets.json`, a list of criterion IDs.

The originals are not edited or deleted; a person approves the swap. Run with:

```
node --test 'tests/acceptance/1116-redraft-1874/*.test.mjs'
```

They import `tests/acceptance/1116/helpers.mjs`, unchanged, and `tests/acceptance/1874/helpers.mjs`. `helpers.mjs` here holds what doesn't fit: the fixture commit after which the task names each fixture issue's budget criterion, and `oneMerged` on top of it.

## What each redraft replaces

One change serves all five: before the first window's mark, a commit gives the fixture task `criteria`, the ID of each fixture issue's budget criterion (`` `fixture-bench` stays within its budget on a reference Mac, in the local preflight ``). Test names, criterion IDs, assertions and expected values are the originals', line for line.

| Original (path › test) | Criterion | Why the old expectation no longer holds | Replaced by |
|---|---|---|---|
| `1116/window.test.mjs` › #1116.dead61b9 a planted 2× regression in one of three commits leaves only that issue open, naming that commit, with one budget follow-up | #1116.dead61b9 | It expects 9101 and 9103 CLOSED. Their budget criterion is named by no task, so under #1874 both stay open and "only that issue open" can't be read | `window.test.mjs` › same name. The scene is #1116's with the task naming the budget criteria of 9101 to 9105. `n0` (the naming commit) and `n1` stand where `r0` and `r1` stood: a forks from `n0`, before the mark, and b from `n1` |
| `1116/window.test.mjs` › #1116.5aa02a5a a commit merged during a window is measured in the next one, and till then its issue stays open | #1116.5aa02a5a | It expects the next window to close 9104, whose budget criterion no task names | `window.test.mjs` › same name, on the same scene |
| `1116/traps.test.mjs` › a window that gets no grant at a load above the cores measures nothing, reopens, and leaves its commit for the next | Scope: a commit not yet measured leaves its issue open | Its last line expects the next window to close 9202 | `traps.test.mjs` › same name, with this folder's `oneMerged`: the task names 9202's budget criterion, and x forks from the naming commit |
| `1116/traps.test.mjs` › a window killed mid-sample reopens, closes nothing, and leaves its commit for the next | Scope: the same line | Its last line expects the next window to close 9203 | `traps.test.mjs` › same name, the same way |
| `1116/traps.test.mjs` › budget-window.mjs run by hand, with a forged DEEP_THROTTLE, measures nothing and closes nothing | Scope: agents never run the window | Its last line expects the next window to close 9204 | `traps.test.mjs` › same name, the same way |

`window.test.mjs` here plays the whole scene for its two tests and shares nothing with the original file's other four: running both files means two scenes.

## Kept as they are

These hold under #1874's rule:

- `1116/window.test.mjs` › #1116.8a08ae16 (drain and reopen), › #1116.8e06730a (three records, merge bases, samples), › #1116.96a59f57 (the build within a minute): none reads an issue's state.
- `1116/window.test.mjs` › a pass leaves its issue open while another of its criteria isn't proven: it expects OPEN. On the original fixture no task names anything of 9105, so it now holds for a second reason too; in this folder's scene the task names 9105's budget criterion and the unticked other criterion alone keeps it open, but no test here reads it.
- `1116/traps.test.mjs` › a window off the reference Macs is a reading…; › a commit that raises its own margin…: both expect OPEN and a record that isn't PASS.
- `1116/guard.test.mjs`.
- `tests/budget-window.test.mjs` isn't an acceptance test; its two tests expect a build's start and an OPEN issue, and hold.

No twins here: `tests/acceptance/1116/twins.json` maps the originals' criteria, and the redrafts keep their IDs.

## On the base and on a window that meets #1874

Run on a Mac17,10, 18 cores, at a 1-minute load of 13 to 90, each file once per program, with the helpers' Mac15,7 stand-in and pinned load.

On the base `f28d8777` all five pass, since the base closes an issue whose unticked criteria all match its budget rule, whatever a task names:

```
$ node --test tests/acceptance/1116-redraft-1874/window.test.mjs
✔ #1116.dead61b9 a planted 2× regression in one of three commits leaves only that issue open, naming that commit, with one budget follow-up
✔ #1116.5aa02a5a a commit merged during a window is measured in the next one, and till then its issue stays open
ℹ tests 2  ℹ pass 2  ℹ fail 0
$ node --test tests/acceptance/1116-redraft-1874/traps.test.mjs
✔ a window that gets no grant at a load above the cores measures nothing, reopens, and leaves its commit for the next
✔ a window killed mid-sample reopens, closes nothing, and leaves its commit for the next
✔ budget-window.mjs run by hand, with a forged DEEP_THROTTLE, measures nothing and closes nothing
ℹ tests 3  ℹ pass 3  ℹ fail 0
```

On the blind job's throwaway window (the base's window plus about 20 lines that meet #1874, which passes `tests/acceptance/1874/` 4 of 4 and isn't kept), in a scratch copy of the base, the redraft gave the same five `✔` lines: `window.test.mjs` 2 of 2 and `traps.test.mjs` 3 of 3.

The originals on that throwaway, as the table says:

```
$ node --test tests/acceptance/1116/window.test.mjs
✔ #1116.8a08ae16 a window drains every slot before its first sample and reopens after its last
✔ #1116.8e06730a three commits merged between windows get three records, each against its own merge base, with 20 samples a side
✖ #1116.dead61b9 a planted 2× regression in one of three commits leaves only that issue open, naming that commit, with one budget follow-up
    the first commit's issue stayed open
✖ #1116.5aa02a5a a commit merged during a window is measured in the next one, and till then its issue stays open
    the next window's pass didn't close the issue
✔ a pass leaves its issue open while another of its criteria isn't proven
✔ #1116.96a59f57 an agent's build requested during a window starts within a minute of the window ending
ℹ tests 6  ℹ pass 4  ℹ fail 2
$ node --test tests/acceptance/1116/traps.test.mjs
✔ a window off the reference Macs is a reading: its record is INCONCLUSIVE and its issue stays open
✖ a window that gets no grant at a load above the cores measures nothing, reopens, and leaves its commit for the next
    the next window's pass didn't close #9202
✖ a window killed mid-sample reopens, closes nothing, and leaves its commit for the next
    the next window's pass didn't close #9203
✖ budget-window.mjs run by hand, with a forged DEEP_THROTTLE, measures nothing and closes nothing
    the next window's pass didn't close #9204
✔ a commit that raises its own margin to hide a 2× regression doesn't pass: budget numbers stay unchanged
ℹ tests 5  ℹ pass 2  ℹ fail 3
```

A redraft that passes on the base proves nothing new about #1116's criteria by itself: the wrong programs for them are #1116's twins, and the close these five wait for is #1874's AC4, which `tests/acceptance/1874/twins/never-closes` fails.
