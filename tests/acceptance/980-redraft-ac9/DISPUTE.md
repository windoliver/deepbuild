# Dispute: the first draft lays its budget scene out on a probe with one page of memory

This redraft exists because of this dispute. The first draft is `tests/acceptance/980/ac09-budget.test.ts`, two tests
("#980.238de3e1 the budget model has 40 queues, 30 resources and 10 conveyors, keeps 2,000 entities live and holds
process.conserve and process.busy" and "#980.238de3e1 a model of 2,000 live entities, 40 queues, 30 resources and 10
conveyors steps in under 0.3 ms a step"). This file is the work's, not the blind job's: the job wrote the other five
files of this folder and never saw this one.

## What fails

#980's criterion 9: "Budget, a proposal until measured on the reference Mac in the local preflight: a model of 2,000
live entities, 40 queues, 30 resources and 10 conveyors steps in under 0.3 ms a step."

Before either test reaches process@1, it builds its piece, and the suite's `layout()` (`../980/helpers.ts`) asks the
core where the item's arrays sit by checking #416's layout probe with the scene's writes. That probe is a program with
one page of memory, 65,536 bytes. The budget scene's write region is 88,624 bytes, so the core's region rule refuses
the probe, and both tests stop in the helper. The run, on the work:

```
 × #980.238de3e1 the budget model has 40 queues, 30 resources and 10 conveyors, keeps 2,000 entities live and holds process.conserve and process.busy
 × #980.238de3e1 a model of 2,000 live entities, 40 queues, 30 resources and 10 conveyors steps in under 0.3 ms a step

AssertionError: check of the layout probe admits it: {"ok":false,"code":"logic_refused","item":"probe","refusals":[{"rule":"region","what":"the write region, 88624 bytes at 4096, passes the end of memory at 65536","region":"writes"}]}: expected false to be true
 ❯ layoutFor ../190/helpers.ts:444:79
 ❯ layout helpers.ts:81:13
 ❯ budgetPiece ac09-budget.test.ts:34:3
```

No step of the model runs and no time is read. The probe and the rule are the base's own: `layoutProbe` is #416's, and
the base's `deep-logic` holds the same region rule. A base run can't show it, though: each test asks for process@1's
pack first, so at the base both stop one line earlier, on "a first-party pack declares process@1". That is how they
read at `3f02bf52b` with the suite as its job wrote it, run for this dispute; the suite's own `BASE-FAILURE.txt` says
it was not run there. Only the work reaches the probe. The suite's other nine files pass.

The work can't make this test pass: the refusal is of the probe, a program the suite supplies, with no process@1 in
it, and the implementing agent doesn't edit the suite.

## How the redraft was made

Criterion 9 went to a fresh run of the suite's blind job with the same inputs: issue #980, the design and the first
suite's base, `3f02bf52b`, which holds no process@1. Its checkout held the suite's shared harness (`README.md`,
`helpers.ts`, `programs.ts`, `scenes.ts`, `fixtures.ts`, `tsconfig.json`) and no test file. It never saw the work, the
first draft's test or this dispute. It was given the criterion's line and told to write its test fresh, with the
design's rule that a test fails at the base at an assertion of its own, every call that needs no process@1 having run
cleanly there. It was not told why a redraft was asked for.

The job ran twice. The first wrote the test, its model and the README, proved the rest of its text on a stand-in of
its own, which it removed, and left its base run unrecorded. The base run of its files was made once,
by the brief's command, under the grant that built the base's `deep-logic`. The second run of the job was given the
first's files and that run's log, was told to change no test file, and wrote `BASE-FAILURE.txt` and the README's
"Checked at the base". `ac9-budget.test.ts`, `model.ts` and `tsconfig.json` have the same SHA-256 in the base run, in
the runs on the work and in this folder.

It never calls `layout()`. Its idle item is a program of its own with the model's memory, it reads each step's arrays
from the frame that ran it, and its model is its own: ten lines of 200 cases, each line four queues, three resources
of 12, 6 and 4 units and a 10 m conveyor, with every queue, resource and conveyor holding work at every timed step.
At the base it fails at its own line 107, "one first-party pack declares process@1", after the idle item's 600 frames
ran there.

On the work, merged with main at `2ab3993b9`, it passes. Under the throttle's timed grant on a reference Mac
(Mac17,10) at a one-minute load of 5.6, mains power and a nominal thermal state, a step read 81.7, 79.7, 84.7, 81.0
and 81.0 µs against 300 µs: PASS. It ran twice there and passed both times; the first run's reporter printed no
readings, so the second was for them.

## What is decided, and what is yours

The first draft's file is kept by hand in `scripts/lanes.mjs`; the redraft runs in its place. This is the one dispute
that comes to you (design: Dogfooding): take the redraft's reading of criterion 9; or hold the first draft, which
needs a layout probe with memory for its scene, a change to the suite's harness that only a blind job may make.

One difference between the two is yours to weigh. The first draft's first test also held `process.conserve` and
`process.busy` on its budget model over 420 steps. The redraft holds each timed step to the criterion's counts from
the step's own arrays and leaves the kind rules to their own criteria, 3 to 6, whose tests pass.
