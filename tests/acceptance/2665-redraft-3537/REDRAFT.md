# Blind redraft of #2665's lowering scene under #3537

#3537 changes when a ceiling may be lowered. Its Scope says "A change may lower a ceiling only on a task that reports
`work`, and only when its five runs report what the merge base's runs report", and its third criterion says a
lowering on a task that reports no `work` "is refused, naming the task. With `work` reported and equal on both sides,
it passes as #2665's first criterion has it." `tests/acceptance/2665/lowering.test.mjs` plays one scene in which a
commit lowers the `peakBytes` ceilings of `held` and `tight`. Both run `/bin/sh` counting to 20,000, which prints
nothing, so neither reports `work`. Under #3537 a right program refuses both lowerings, and the file's first test,
which holds that the lowering of `held` passes and that the record names it, fails on a right program. This folder
redrafts that file from #2665's criteria, #3537 and the base `7997a6637`, which has no work on #3537. A report and
its `work` are as `tests/acceptance/3537/README.md`, surface 1, spells them: the command's last stdout line that is a
JSON object, holding `work`, an object of counts.

The original is not edited or deleted; a person approves the swap. Run with:

```
node --test tests/acceptance/2665-redraft-3537/lowering.test.mjs
```

It imports `tests/acceptance/2665/helpers.mjs` unchanged, what the original imports there and nothing more. There is
no `helpers.mjs` here: the one new command is two lines of the test file. `loop(20_000)` builds a command with no
report, so the lowered tasks' command is that command with one more builtin at its end:

```
/bin/sh -c 'i=0; while [ $i -lt 20000 ]; do i=$((i+1)); done; echo '\''{"work":{"rounds":20000}}'\'''
```

`echo` is a shell builtin, so the command still starts no child and its instructions retired are still counted. The
lowering commit changes only `benchmarks/budgets.json`, so both sides run this command and report the same `work`.

## What the redraft replaces

| Original (path › test) | Criterion | Why the old scene no longer holds | Replaced by |
|---|---|---|---|
| `2665/lowering.test.mjs` › #2665.54342405 a fixture change that lowers an established task's peakBytes limit, whose five runs are within the new limit, passes, and its window record names the old limit, the new one and the five readings | #2665.54342405 | `held` prints no report, so it reports no `work`. Under #3537 its lowering is refused, so the lowering doesn't pass and the record doesn't name it as taken | `lowering.test.mjs` › same name. `held` runs the command above, so its `work` is reported and the same on both sides, which is how #3537's third criterion reads #2665's first. The ceilings, the commits, the window, the assertions and the expected values are the original's, line for line |
| `2665/lowering.test.mjs` › #2665.9583c77c the commit that lowers a ceiling is judged against the old one, and the next commit against the new one | #2665.9583c77c | `tight` is lowered in the same commit and prints no report either, so the commit the test reads is one a right program refuses | `lowering.test.mjs` › same name. `tight` runs the command above. Nothing else of the test changes |

One reading differs with the commands. The original sets every ceiling from `peak`, the highest of five
`/usr/bin/time -l` peaks of `loop(20_000)`. Here `held` and `tight` run the reporting command and `roomy` still runs
`loop(20_000)`, so `peak` is the highest of five peaks of each, ten readings, of the commands as the scene runs them.

## Kept as they are

- Carried into `lowering.test.mjs` here, unchanged: `2665/lowering.test.mjs` › #2665.5222fad8 a count that can't be
  read is missing, never 0, and its ceiling reads INCONCLUSIVE, and › #2665.9afb008a a window's record lists each task
  with no ceiling by name with their count, and each task more than 20% under its ceiling with both numbers. Their
  tasks (`uncountable`, `open-a`, `open-b`, `roomy`) aren't lowered and keep their commands; their names, IDs,
  assertions and expected values are the original's, line for line. They are here because the swap is by file: once a
  redraft lands, its original file runs by hand only (`redrafted` and `byHand` in `scripts/lanes-lists.mjs`), so every
  test of the original file runs in the redraft file, or the swap would drop it from the lanes. The file holds the
  original's four tests in the original's order, on one scene played once, as there.
- Not carried: the original's comments. A new redraft folder's files start at zero in the comment ratchet
  (`docs/adr/0001`), so its header, its notes on each ceiling and the note above `verdict` are left in the original.
- Staying where they are: `2665/refusals.test.mjs`, `2665/counts.test.mjs`, `2665/helpers.mjs`, `2665/README.md`,
  and `2665/twins.json` with the twins. Neither of the two other test files lowers a ceiling; this redraft doesn't
  review them further and ran neither.

No twins here: `tests/acceptance/2665/twins.json` maps #2665.9583c77c, #2665.5222fad8 and #2665.9afb008a, and the
redraft keeps the IDs. No `lane.json`: the original folder has none, and the file took 40 to 46 s.

The swap itself is an entry for `tests/acceptance/2665/lowering.test.mjs` in `redrafted` in
`scripts/lanes-lists.mjs`, as `3567-redraft-3549` has one. It is not this job's to write.

## Runs

macOS, a Mac17,10 with 18 cores shared with other sessions, node 24.22.0. Each run went through the machine's
throttle with a 3-minute wait, and each got its test grant; none was run bare. Under `node --test` each window keeps
the sandbox's own table. The helpers stand in the machine and pin the load a sandbox reads, so the loads named are
this Mac's, from other sessions.

On the base `7997a6637` the redraft passes, 4 of 4 (46 s; 1-minute load 18.3 at its start and 23.2 at its end):

```
$ node scripts/throttle.mjs test --wait 3 -- node --test tests/acceptance/2665-redraft-3537/lowering.test.mjs
✔ #2665.54342405 a fixture change that lowers an established task's peakBytes limit, whose five runs are within the new limit, passes, and its window record names the old limit, the new one and the five readings (45021.00975ms)
✔ #2665.9583c77c the commit that lowers a ceiling is judged against the old one, and the next commit against the new one (2.635708ms)
✔ #2665.5222fad8 a count that can't be read is missing, never 0, and its ceiling reads INCONCLUSIVE (1.521041ms)
✔ #2665.9afb008a a window's record lists each task with no ceiling by name with their count, and each task more than 20% under its ceiling with both numbers (0.918125ms)
ℹ tests 4
ℹ pass 4
ℹ fail 0
```

On a throwaway guess at #3537's rule, kept in the inputs folder's `scratch/` and run through copies of the two
folders, `tests/fixtures/approver.mjs` and `scripts/`: the base, with each round's report read for `work`, and a
lowering on a task whose runs report no `work`, or other `work` than the merge base's, refused by a `BLOCKED`
`benchmarks/budgets.json` row and left out of `lowered`. Nothing else of #3537. The redraft passes, 4 of 4 (40 s;
load 22.5 to 22.7):

```
$ node scripts/throttle.mjs test --wait 3 -- node --test tests/acceptance/2665-redraft-3537/lowering.test.mjs
✔ #2665.54342405 a fixture change that lowers an established task's peakBytes limit, whose five runs are within the new limit, passes, and its window record names the old limit, the new one and the five readings (39720.0945ms)
✔ #2665.9583c77c the commit that lowers a ceiling is judged against the old one, and the next commit against the new one (2.233375ms)
✔ #2665.5222fad8 a count that can't be read is missing, never 0, and its ceiling reads INCONCLUSIVE (1.162167ms)
✔ #2665.9afb008a a window's record lists each task with no ceiling by name with their count, and each task more than 20% under its ceiling with both numbers (1.226875ms)
ℹ tests 4
ℹ pass 4
ℹ fail 0
```

On the same throwaway the original's first test fails, which is why it is redrafted (43 s; load 22.7 to 26.4):

```
$ node scripts/throttle.mjs test --wait 3 -- node --test --test-name-pattern=54342405 tests/acceptance/2665/lowering.test.mjs
✖ #2665.54342405 a fixture change that lowers an established task's peakBytes limit, whose five runs are within the new limit, passes, and its window record names the old limit, the new one and the five readings (42497.651917ms)
ℹ tests 1
ℹ pass 0
ℹ fail 1
  AssertionError [ERR_ASSERTION]: the record of b50e98ff716df39546e73477c23085acfd8fabba doesn't name held's lowered peakBytes limit once: []
```

It fails at its third assertion, on `lowered`, and not at "held didn't pass": this guess refuses with a row of the
manifest's and leaves `held`'s own row as it was. A program that refuses in `held`'s row fails the test one
assertion earlier. Either way the lowering of a task that reports no `work` isn't taken, and the test asks that it
is.

Not run: the original's other three tests on the throwaway, the original file on the base, and anything on the real
change. The throwaway and the script that laid it are deleted, and they prove nothing about the real change.
