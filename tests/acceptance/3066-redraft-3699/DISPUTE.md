# Dispute: `#3066.4268aebb`'s second test (#3699)

## What the first draft forbids

`tests/acceptance/3066/same-failures.test.mjs`, its second test ("every test file of the merge base still runs where
it ran", line 27 on), places every test file of the merge base twice with `affected.mjs`'s `plan()`: by the merge
base's `scripts/`, and by this checkout's. The one move it allows is between the `alone` and `parallel` blocks. Any
other move fails the test, and it asserts that list of moves is empty.

## Why that fails every dispute that sends an original to by hand

A dispute keeps a first draft as written, runs it by hand, and runs its blind redraft in its place, with `redrafted`
in `scripts/lanes-lists.mjs` (exported by `scripts/lanes.mjs`) mapping the original to the redraft. That moves the
original from its block to `skipped/by hand`, which the first draft counts as a test leaving its lane. So every such
dispute fails `#3066.4268aebb`, however correct. #3699 quotes the first, PR #3384 (#3243), on main b48a47db7 with its
diff:

```
AssertionError [ERR_ASSERTION]: 2 test files of the merge base no longer run where they ran
+ 'tests/acceptance/25/routes/held.test.ts: alone/vitest -> skipped/by hand'
+ 'tests/acceptance/25/routes/one-route.test.ts: alone/vitest -> skipped/by hand'
```

This redraft hits the same: its own change sends `tests/acceptance/3066/same-failures.test.mjs` to by hand, so the
first draft would fail on the very change that replaces it.

## What this redraft allows instead

`#3699`'s rule. A test file of the merge base passes when it stays where it ran, moves between `alone` and `parallel`,
or moves to by hand while `redrafted` maps it (an entry for the file, or for a folder ending in `/` that holds it) to a
path inside the checkout that is neither the original nor a folder holding it, exists, and holds a test file that
doesn't itself run by hand: the path is a test file as `isTestFile` reads one, or a folder with one somewhere under it. A move to
by hand with no `redrafted` entry fails, naming the file; so does one whose entry names a path outside the checkout,
the original or a folder holding it, a missing path, a path holding no test file, or one whose test files all run by
hand. A test file of the merge base the checkout no longer holds fails, naming the file (README: "A criterion-level
rule names the deletion"). Every other move fails as before. Moves to `timed` or `slow` stay failures, out of #3699's
scope; a file the merge base's own lane files already name timed or slow stays where it was, since the merge base's
side is read with those files on disk.

The first test (`scripts/known-failures.json` names the same failures as on the merge base) is carried over as it is.
