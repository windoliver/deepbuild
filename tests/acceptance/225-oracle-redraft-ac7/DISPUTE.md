# Dispute: the first draft's Oracle port for criterion 7

Criterion 7 (#225.57b5ccba): "A flow of a unit square along the vector field (−y, x) for time π/2 ends rotated 90°
within 0.5 px, at 24 and 60 fps alike".

## The disputed test

`tests/acceptance/225-oracle/ac7-flow-field.test.ts`, its second test, "the same check fails on the group written
without its flow, naming the mark". Its first test (the mark flowed along (−y, x) and 0.5 p for 2π at 10 and 60 fps)
passes on the work and stands.

## Why it can't pass on any program

The twin is the same film with no `flow` on the group, so the mark stays at its start, (1, 0.5) in the plane. The judge
compares it with the exact flow of (−y, x) for time f32(2π) = 6.2831854820…, which is a full turn: the start turned by
1.7e-7 rad, 1.9e-7 from (1, 0.5). The unmoved mark is within the judge's 1e-4, so the judge passes the twin, and
`failsNaming` (which needs the twin to fail) fails on every program, right or wrong.

The failing output on the work (deep-show full build, this branch):

```
× AC7 #225.57b5ccba the same check fails on the group written without its flow, naming the mark
AssertionError: the group without flow: the wrong program passes the check it must fail: expected 0 to be greater than 0
 ❯ failsNaming ../225/helpers.ts:76:87
 ❯ ac7-flow-field.test.ts:52:5
```

## The redraft

A fresh run of the blind job, with the issue, the design, the Oracle page and the base, asked for criterion 7's Oracle
port only, wrote this folder (commit 2d3d8fd7d). On the work: 3 of 3 pass.

```
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

It reads "at 24 and 60 fps alike" as the flow played over the film (the group's flow `time` keyed from 0 to π/2 over
1 s), and its twins are a square that never moves, a flow stepped by Euler once per frame (11.78 u off at 24 fps,
4.64 u at 60 fps) and the field written clockwise.

The brief to the redraft named no dispute, no work and no diff; it carried one general line asking that each twin be
checked by hand so it can actually fail.

## What is asked

One ruling: the redraft runs in the first draft's place for criterion 7's Oracle lane, and the first draft's second test
is kept by hand (`scripts/lanes.mjs`: the redraft folder in `alone`, the first draft's file in `byHand`), as #226's and
#466's disputes were settled.
