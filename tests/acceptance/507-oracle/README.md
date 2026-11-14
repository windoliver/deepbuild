# Oracle lane for #507: the pinned looping playback test's rule, run on our held loop

Written first, blind, from issue #507, its Oracle page (`doneright/oracles/issues/507.md` on branch `doneright` of
DeepBuildAI/deepbuild, as given to this job), the one upstream file it pins, `AGENTS.md`, the design and base commit
`53c0e72a3`, by the job that wrote `tests/acceptance/507/` and never saw an implementation; none existed. #136's rule
applies: a linked test counts only when run against our output, so every case here is a frame `deep-show` shows in a
present-mode session. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind
redraft (design: Dogfooding).

The page links an upstream test to 1 of the 8 criteria, criterion 5 (`#507.44897258`), with the use "port". Criteria 1,
2, 3, 4, 6, 7 and 8 have none and stay with `tests/acceptance/507/`, as does the rest of criterion 5 (the advance, the
blank and the stage-number keys).

**Not run against a binary**, for the reason `../507/README.md` gives; `BASE-FAILURE.txt` says what the test meets first
at the base. The type-check passes.

## Source

| Criterion | Upstream, pinned | Use | Here |
|---|---|---|---|
| 5 | the upstream engine's pinned looping playback test, commit `396c9f059903aed5fec78ecd3d437a40c6415368`, SHA-256 `67f85901edc781946b60d044904d202106b2976b34c3e248c6264524e80f9242` (39,323 bytes), in `pin.json` | port | its looping cases' rule: a time t on a loop of length L reads t mod L into it, over a range whose end is excluded |

What it asserts, in our words: a 10 s sequence at 30 fps (60,000 ticks a second) plays on a loop; after each update to a
clock time, the range evaluated ends at that time mod 10 s, and the loops completed count the boundaries crossed. Its
first looping case, forward and with no dissection, updates to 5 s, 12 s and 23 s and reads 5 s, 2 s and 3 s into the
sequence. Its playback range is discrete, [0, 10 s), its last valid tick one before the end, so a time on a loop
boundary reads the start. The other looping cases split the range evaluated into contexts at each boundary
(dissection) and end where the first does.

Nothing of the upstream file is copied into this folder. The lane finds it by its SHA-256 in the commit's vendored folder,
checks that it holds the three update times it ports, and writes the cases in `loop.test.ts` beside the rule they port.
The file keeps its own notice in its vendored copy. No name or path of it is written here, since the public text lane
refuses studied names; `pin.json` holds only the commit and the hash.

## Where the lane reads the file, and how a fresh checkout gets it

`<oracles>/vendor/<a folder whose name ends -396c9f0599>/…`, the file whose SHA-256 is the pin's, where `<oracles>` is
`$DEEP_ORACLES` when set, else `../deep-oracles/doneright/oracles` beside this checkout. Without it the test fails:

```
BLOCKED: the pinned looping playback test (commit …, sha256 …) is not under <oracles>/vendor/*-396c9f0599/. Unblock: check out branch doneright of DeepBuildAI/deepbuild as a worktree (git fetch origin doneright && git worktree add ../deep-oracles origin/doneright) or set DEEP_ORACLES to the folder that holds vendor/, then rerun.
```

It never passes and is never skipped. The lane makes no network call.

## Run

```sh
npm ci                                   # once, if node_modules is missing
DEEP_ORACLES=<path> node node_modules/vitest/vitest.mjs run --root tests/acceptance/507-oracle --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/507-oracle/tsconfig.json
```

Run alone (`alone.push('tests/acceptance/507/', 'tests/acceptance/507-oracle/')`, `../507/README.md`): the file builds
`deep-show`. It imports `../507/helpers.ts` by path.

## The surface under test

`../507/README.md`'s: the loop film (`loopFilm`) presented, popped out full screen onto display A with your click's
serial (present mode), → at 1 s, → again 7 s into the hold at s2, and `determinism {doc, display_hz: 30, at_times}` on
the session, whose sides carry the new `position` beside `pixel_hash`.

## Criteria to tests

| ID | File (tests) | What it asserts |
|---|---|---|
| AC5 `#507.44897258` | `loop.test.ts` (1) | Our span is [4 s, 6 s), L = 2 s. The upstream shares 0.5, 1.2 and 2.3 of a loop are clock offsets 1.0, 2.4 and 4.6 s into the hold, reading 0.5, 0.2 and 0.3 of the span: the timeline at 5.0, 4.4 and 4.6 s; whole loops 1, 2 and 3 (offsets 2, 4, 6 s) read the span's start, 4 s, never the stage's 6 s. At each, played and sought, the position is that one and the frame equals the frame the timeline showed at that position on its way to the stage (at the advance's stamp plus the position) |

Wrong programs the assertions fail: a loop that holds a still frame, that runs on the timeline instead of the clock, that
reads t mod L from the wrong origin or over a closed range (showing the stage's own frame at a whole loop), or whose seek
lands elsewhere than its play.

## Not ported

The loops completed (our design has no such reading), the finite loop counts and the stop at the end of the last loop,
playing backwards and ping-pong, the start and end offsets, the custom end time, and the dissected contexts (our frame is
one evaluation at one time; there is no range evaluated to split).
