# Dispute: the first draft's AC10 film prepares for about 1 s, so no export can hide a 2.0 s open in it

This redraft exists because of this dispute. The first draft is `tests/acceptance/518/open.test.ts`. The owner approved
the redraft in the session that opened PR #2730. This file is the implementing agent's; the redraft's own files
(`README.md`, `open.test.ts`, `tsconfig.json`) are the blind job's, unchanged.

## What fails

`open.test.ts`, "with a stub tool whose open takes 2.0 s the 60 s fixture film's wall time grows by at most 0.2 s over
a stub whose open takes 0 s, and the receipt times the open", exports the 60 s fixture film (1,440 frames of 160 × 90)
as H.264 with AAC through `test-open-2s@1.0.0` and `test-open-0s@1.0.0`, three pairs after a warm-up, and holds the
least wall time's growth to 0.2 s.

The export asks the tool to open before anything else it prepares: before the sound is rendered and before the first
frame is drawn (`crates/deep-show/src/export.rs`, "the encode job's session opens here"). Nothing waits for the open's
answer until the first frame is handed over. On this film that preparing lasts about 1 s, nearly all of it the 60 s
mix's loudness measure, and the frames can't run more than `frame_delay + 2` ahead of a tool that isn't open. So the
export waits out the rest of the open: 2.0 s less about 1 s.

```
AC10 #518.f259d9bf the 60 s fixture film: 16.41, 16.50, 16.61 s with the 2.0 s open, 15.41, 15.72, 15.51 s with the
0 s open; growth 1.00 s; the open timed at 2.15, 2.17, 2.14 s
AssertionError: INCONCLUSIVE: encoder open: the film's wall time grew by 1.00 s with a 2.0 s open, over 0.2 s (the
2.0 s stub: 16.41, 16.50, 16.61 s; the 0 s stub: 15.41, 15.72, 15.51 s); and the one-minute load is 30.6, above the 18
cores, so the clock readings don't count; this is not a pass
```

The test read INCONCLUSIVE only for the machine's load. The growth was the same in all three pairs, and it is what the
film's preparing leaves of the open, not noise. The first draft's README says as much under "Not settled": "AC10 holds
only if the fixture film's preparing lasts about as long as the open."

The same file's second test, the planted `export_opens_tool_after_first_frame`, passed: its growth was about 2 s and
the judge failed it naming the encoder open.

## The redraft

A fresh run of the blind job, with the issue's text, the design, the base `d8c46f0d5`, the first draft and this
criterion only, never the work, the diff or this dispute, wrote `open.test.ts` here. It was not told why a redraft was
asked for. It measures the same growth on a 2 s cut of the film, and also reads from outside the time the film takes
to reach its first frame. A growth over 0.2 s on a film that reaches its first frame in under the 2.0 s the open takes
reads INCONCLUSIVE, since no export can hide the whole open there; it is never a pass.

The first draft's file is kept as written and run by hand only (`scripts/lanes.mjs`); the redraft runs in its place.

## What the redraft does not settle

The criterion's number. On any film that prepares for less than about 1.8 s, a right export still grows by more than
0.2 s, and the redraft says so instead of failing or passing. Meeting the criterion as written needs a named film whose
preparing lasts as long as the open, or a shorter stub open. That is a change to the issue, which is the owner's.
