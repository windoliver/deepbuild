# Acceptance tests for #407, Oracle lane: the upstream flash-detection suite run against our flicker check

Written first, blind, from issue #407 ("The film audit: readable text, reading holds, flicker, captions and a brief's
checks"), its Oracle page, the design rows, and the base commit `04f44a4ba` by a job that never saw an implementation;
none exists at the base, and no other worktree, branch or PR was read. The Oracle page (`doneright/oracles/issues/407.md`
on branch `doneright` of DeepBuildAI/deepbuild) links one upstream suite, to criterion 3; the other 13 criteria have
none and stay with `tests/acceptance/407/`, as does criterion 10's counter-phase rule, which the page calls ours. #136's
rule applies: a linked test counts only when run against our output, so every upstream case here is a film judged by
`deep-show run` through a claim whose requirement is `{kind: "film.flicker"}`. The implementing agent doesn't edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

**Not run against a binary**, for the reason `../407/README.md` gives; `BASE-FAILURE.txt` says what each test meets
first at the base.

## What was read

- The Oracle page and the files it pins, from the vendored folder for commit `fd3e09e4e6` under
  `doneright/oracles/vendor/` on that branch: `test/<suite>.Tests/src/FlashDetectionTests.cpp`,
  `RelativeLuminanceTest.cpp`, `TransitionTrackerByFPSTests.cpp`, `VideoAnalysisTests.cpp`, `appsettings.json`, and
  `data/ExpectedVideoLogFiles/` (`2Hz_5s`, `2Hz_6s`, `3Hz_6s`, `gray`, `extendedFLONG` and `intermitentEF`, each
  `_RELATIVE.csv`). The test videos themselves aren't vendored.
- `../407/README.md`'s surface, and its `helpers.ts`, which this suite imports (the same job wrote both).

## Sources

| Upstream (commit `fd3e09e4e6`) | What it asserts | Use | Here |
|---|---|---|---|
| `RelativeLuminanceTest.cpp` (white 1, black 0, gray 0.216, blue 0.072) | relative luminance of sRGB in linear light | port | swings whose change is past 0.1 in linear light but not in encoded values (sRGB 220 and 240) fail, and the reverse (20 and 50) pass |
| `RelativeLuminanceTest.cpp` CheckTransition tests; `appsettings.json` `RelativeLuminanceFlashThreshold: 0.1` | a transition counts only past a 0.1 change | port | sRGB 124 and 147 (0.090) pass, 124 and 154 (0.122) fail, four times a second |
| `appsettings.json` `RelativeDarkLuminanceThreshold: 0.8`; the `gray` video | the darker frame must be under 0.8 | port | sRGB 230 and 255 (darker 0.791) fail, 232 and 255 (0.807) pass; the gray case passes |
| `appsettings.json` `FlashDetection.AreaProportion: 0.25`; the SafeArea tests | at least a quarter of the screen | port | black and white over 26.1% of the frame fail, over 23.9% pass |
| `appsettings.json` `TransitionTracker.MaxTransitions: 6`; `TransitionTrackerByFPSTests.cpp` EvaluateFrameMoment tests | more than six transitions (three flashes) in a second fails | port | six transitions 0.125 s apart pass, seven fail |
| `VideoAnalysisTests.cpp` with the six expected logs | per-frame results of the 2 Hz, 3 Hz, gray and extended-flash videos | port | `cases.json`: each video re-expressed as whole-frame luminance per frame from its log; a case fails ours exactly when its log marks a flash fail (result 3): 3Hz_6s, from frame 30 |

No upstream code or reference output is copied: `cases.json` re-expresses each log's luminance column as runs of frames
(every frame of these videos is wholly at one level, its flash area 100% or 0%), with the log's own counts beside it,
and each assertion is written in `flash.test.ts` beside the upstream line it ports. The upstream files carry their own
copyright notice in the vendored copy.

## Run them

As `../407/README.md` says (`alone.push('tests/acceptance/407/', 'tests/acceptance/407-oracle/')`):

```sh
node node_modules/vitest/vitest.mjs run --root tests/acceptance/407-oracle --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/407-oracle/tsconfig.json
```

## Criteria to tests

| ID | File (tests) | What it asserts |
|---|---|---|
| AC3 `#407.2d08dfcb` | `flash.test.ts` (2) | The ten ported rule cases above: each passing one PASSes with nothing raised, each failing one FAILs with film.flash at `t` 1 s (± a frame at 24 fps); the six video cases at their own frame rates (5 or 25 fps): five PASS, 3Hz_6s FAILs with film.flash at a frame in the second before its log's first flash fail, [0.16, 1.16] s |

## Readings

- **Flashes and transitions.** A flash is a pair of opposing transitions; seven transitions in a second hold more than
  three flashes, as the upstream six-transition limit reads, while six hold three.
- **The video cases' frames.** Frame k (from 1) of a case is at (k − 1) ÷ fps s; a run of high frames [a, b] is the
  upper gray shown from (a − 1) ÷ fps to b ÷ fps. The gray case's lower level, 0.83077, is sRGB 235.
- **Our frame for 3Hz_6s** may be the first flash of its first failing second (0.2 s) or the frame the seventh
  transition lands (1.16 s, the log's): any frame in [0.16, 1.16] s.

## Not ported

The upstream extended-fail rule (four to six transitions a second over four of five seconds: result 2 in `2Hz_6s` from
frame 114 and `3Hz_6s` from frame 120), which neither the issue nor the design holds, so `2Hz_6s` passes ours; the red
saturation and pattern checks; the CD luminance mode; the per-frame log columns (averages, flash areas, counts), which
our verdict doesn't report; the commented-out pattern videos.
