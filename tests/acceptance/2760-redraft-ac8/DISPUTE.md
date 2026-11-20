# Dispute: the first draft's warm-up asks for a changed picture from the one view in which a ring changes none

This redraft exists because of this dispute. The first draft is the second test of `tests/acceptance/2760/budgets.test.ts`
("#2760.6dfadd78 64 live rings on a pond that fills half a 1080p frame add under 0.3 ms of GPU, in five runs"). This
file is the work's, not the blind job's: the job wrote the other five files of this folder and never saw this one.

## What fails

#2760's criterion 8: "Budget, on the reference Mac in the local preflight, compared with the merge base: 64 live rings on
a pond that fills half a 1080p frame add under 0.3 ms of GPU". Before it times anything, the first draft draws its pond
with rings and without, from straight above over an even day sky, and asserts on its line 94 that the two final
pictures differ:

```ts
expect(fa.pixel_hash, 'the two sides draw different pixels, so the measure sees what it times').not.toBe(fb.pixel_hash);
```

The run, on the work, on a reference Mac at rest:

```
FAIL  budgets.test.ts > #2760.6dfadd78 the rings' budget > #2760.6dfadd78 64 live rings on a pond that fills half a 1080p
      frame add under 0.3 ms of GPU, in five runs
AssertionError: the two sides draw different pixels, so the measure sees what it times: expected 'd6a49dacd9e116853d26eda80fd51dd0ace81…'
not to be 'd6a49dacd9e116853d26eda80fd51dd0ace81…' // Object.is equality
```

Every earlier run stopped before that line: the machine was loaded, and the test fails `INCONCLUSIVE:` at its gate.

The rings are there. On the first draft's two documents at its frame 15, the work lists 64 rings with them and none
without. The `normal` target differs in 175,744 of its 6,220,800 floats, by up to 0.128, and `pre_tone` in 3,568 of
8,294,400, by up to 0.00012. The final 8-bit picture differs in no pixel.

That is what the issue and the design say a ring does. A ring is "the rain's: a crest at radius speed × age that bends
the normal", it moves no vertex and has no color of its own, and "the mirror's lookup moves along the bent normal, as it
does for ripples and rain". Seen from straight above the Fresnel share is flat near the normal, and over an even sky
the mirror's lookup a few pixels away finds the same sky. So the bend changes the picture by less than one 8-bit step.
The criterion names no view. The first draft's README says a ring reaches the picture only through the mirror's lookup
and its Fresnel share, and sees its other ponds low and oblique for that reason; its probe of the rain's rings at the
base was on those. The budget's pond alone is seen straight down, and the README lists no probe of a ring on it.

## How the redraft was made

The timing test went to a fresh run of the suite's blind job with the same inputs: issue #2760, the design, base
`9550dc0f0` and the names of the surface the suite already asks for. It never saw the work, the first draft or this
dispute. It was told to redraft the test that draws the pond with 64 live rings and the same pond without and judges
what the rings add, to show before timing that what is timed is what the criterion names, and to check at the base how
a ring reaches the final picture. It was not told why a redraft was asked for.

The job ran three times. The first wrote nothing in eight hours and was dropped. The second was cut off 35 minutes in,
when the app hosting it restarted. The third was told that the second's partial files were blind material it could
keep, change or replace, and finished from them. Its closing report was lost to a connection error; `README.md` is
what it delivered.

It measured the rain's rings at the base: from straight above, 36 rings changed 73 pixels between them; from 30° above
the horizon the same 36 changed 3,890. So its pond is seen from 30° above the horizon, 64 rings are alive at every
timed instant, one in each cell of an 8 × 8 grid, and before the machine is read it holds that each of the 64 changes
at least 8 pixels of the final picture in its own patch and that the pond is 49% to 51% of the frame.

On the work, merged with main at `871100dc7`, those checks pass: 64 rings are listed in each of the four frames read,
each ring changes 217 to 1,118 pixels in its own patch, and the pond is 49.75% of the frame. Its timing counts only on
a reference Mac at rest, as the first draft's does; the pull request carries each run.

## What is decided, and what is yours

The first draft is kept by hand in `scripts/lanes.mjs`; the redraft runs in its place. The lanes list files, so the
first draft's other test, which reads the `benchmarks/budgets.json` task and passes, runs by hand with it. This is the
one dispute that comes to you (design: Dogfooding): take the redraft's reading, that the budget is timed on a pond seen
from where each ring changes the picture; or hold the first draft's line, which asks a ring to change the picture seen
from straight above over an even sky. The rain's ring changes two pixels a ring there at the base, so that reading
asks more of a touch's ring than "the rain's" gives it.
