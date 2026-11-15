# Acceptance tests for #466, AC3 (blind redraft): a boil that cycles, held to time by the flicker check

A fresh run of the blind acceptance-test job, redrafting one criterion of issue #466 ("Films in time: operator
transitions, boil cycles, tempo motifs, reveal sounds and captions the look designs"):

> AC3 `#466.4f5a25b8`: A boil with cycle 3 at 12 Hz repeats its drawing exactly every 0.25 s, and the flicker check
> passes it while still failing a seed that follows playback

Written from the issue, the design sections below, the Oracle page and base commit `27a7c0706` ("Merge
remote-tracking branch 'origin/worktree-github-issue-1938-282ccb' into worktree-github-issue-466-dee1e1"), by a job
that never saw an implementation, the first draft (`tests/acceptance/466/`), or any other worktree, branch, PR or stash.
The implementing agent doesn't edit these files (AGENTS.md, Proof).

## What was read

- The issue, live (`gh issue view 466 --repo windoliver/deepbuild`): its Scope ("Boil as a cycle of N drawings, with
  the seed ⌊t × hz⌋ mod N") and AC3.
- Its Oracle page, `doneright/oracles/issues/466.md` on branch `doneright` of `DeepBuildAI/deepbuild`: no upstream test
  for criterion 3 ("boil cycles … are our evaluation rules"), so nothing is ported.
- `docs/canvas-primitives.md`: Look `look@1` (its `time` field: `boil {hz, amount_px, scope, while, cycle: u8 = 0,
  seed}`, "with `cycle: n`, the boil's seed is ⌊t × hz⌋ mod n, so n drawings repeat"; "the boil is defined here only,
  as a function of time and IDs, never of playback"); Look `look@1`: samples; Paint (a stroke's `line`, "hand-drawn
  lines come from the look, seeded by the document seed and the item's ID"); Flicker check (its `reseed` field: "a
  fill, paper or boil seed may change only with quantized time (⌊t × hz⌋, or a cycle of n drawings) and IDs, never
  with playback"; "flags … any hatch, paper or boil whose seed follows playback instead of time and IDs").
- `docs/technical-design.md`: Films and figures on the canvas (looks: "a gentle boil for picture books, which may
  cycle through a few drawings"); Dogfooding.
- At the base: AGENTS.md; `crates/deep-show` (`main.rs`'s scenario `planted`, `film_audit.rs`'s flicker check,
  `frames.rs`'s `eval`, `hub.rs`'s looks by asset); `crates/deep-canvas-drawn/src/spec.rs` (a look's lines);
  `crates/deep-canvas-marks/src/drawn.rs` (a stroke's named line); sibling suites `tests/acceptance/493`, `501`, `407`,
  `419`, `464` for conventions only.

## Run

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/466-redraft-ac3 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/466-redraft-ac3/tsconfig.json   # type-check (exits 0)
```

`cargo` must be on PATH. The file builds `deep-show` once in `beforeAll` (`cargo build --locked --bin deep-show
--no-default-features --features full`, 2 h timeout) and copies it out; every `it` passes `TIMEOUT` (30 min). The folder
builds a cargo binary, so `scripts/lanes.mjs` needs `'tests/acceptance/466-redraft-ac3/'` in its `alone` list (the
implementer makes that edit). Node built-ins and vitest only.

## The surface under test

No new binary or call: `deep-show run` (one JSON scenario per stdin line, one answer line `{"ok": true, "replies":
[…]}`), its `deep show`, #387's `eval` with `pixels`, #403's `claims` and `verdict` with #407's `{kind:
"film.flicker"}`, and the scenario's `planted` field. **Every name below that the issue or the design doesn't give is
this job's choice**; the implementer builds exactly these, or a dispute goes to a blind redraft.

| Surface | Request fields | Reply fields read | New or existing |
|---|---|---|---|
| scenario | `evidence`, `sessions`, `processes`, `panels`, `docs`, `claims`, `planted`?, `calls` | `ok`, `replies` | existing |
| `deep show` | `peer`, `doc`, `document` (no `layers`, no item `layer`), `include: ["issues"]` | (none read) | existing |
| `eval` | `doc`, `t` (flicks), `pixels: true` | `outcome: "evaluated"`, `snapshots[0].sha256` (a PNG in the evidence store) | existing; the boil drawing in it is new |
| `verdict` | `claim` | `requirements[]` row with the requirement's `id`: `result`, `issues[]: {code, severity, …}` | existing (#403, #407) |
| look@1 `time.boil` | `{hz: 12, amount_px: 2, scope: "lines", while: "always", cycle: 3, seed: "item"}` | — | the design's fields; `scope: "lines"` and `seed: "item"` are *(chosen)* values |
| look@1 `lines.pencil` | `{kind: "wobble", width: 3, wobble_px: 2, segment_px: 8}` | — | the design's fields |
| path@1 stroke | `paint.stroke: {role: "ink", width: 3, line: "pencil"}` | — | existing (Paint: `line`) |
| flicker issue | — | an error with `code: "film.reseed"` on the film.flicker row | *(chosen code)*, from the check's `reseed` field |

### The fixture

`helpers.ts` builds every document and look; nothing is on disk. The boil look is a look@1 on a drawing basis with flat
roles (white ground, graphite ink `#1b1d22`), the line `pencil` and the boil above on its `time` (and the base's
`time.state`). The boil film (`boilFilm`): 640 × 360 u at 24 fps, 2 s, `reduced_motion: "hold"`, two path@1 zigzags
(`scribble`, `scrawl`) stroked in `pencil` and the ink role on the look's ground, and nothing else, so only the boil
changes the drawing. At the base it draws the two zigzags (checked by `eval` with `pixels`) and the flicker check
PASSes it; the base has no boil, so its drawings at 0 s and 1/12 s are the same picture.

### Planted programs

| Name | Where | Criterion | The wrong program |
|---|---|---|---|
| `boil_seed_follows_playback` | the scenario's `planted` | AC3 | the boil's seed taken from the frames the session has played (a count that advances with each frame drawn), not from ⌊t × 12⌋ mod 3 and IDs |

The plant goes through the judge the clean film passes (`flickerFailures`: the film.flicker row PASSes with no error
or warning) and must fail it, a failure naming `film.reseed`.

## Criteria to tests

The test names start with `AC3 #466.4f5a25b8` (`scripts/proof-change.mjs`: the first eight hex digits of the SHA-256
of the criterion's text).

| Criterion | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| AC3 `#466.4f5a25b8` | `boil.test.ts` (3) | (1) the step starts k/12 s, k = 0..5, draw d0 d1 d2 d0 d1 d2 with d0, d1, d2 pairwise different and inked; at 16 seeded whole-flick times t in [0, 1.5) s, t, t + 0.25 s and t + 0.5 s are one SHA-256 and equal the step start ⌊12t⌋/12's; every time a separate `eval`, in a seeded order. Fails a boil that doesn't draw, ignores `cycle`, runs at another rate or moves within a step. (2) the flicker check PASSes the boil with nothing raised. (3) under `boil_seed_follows_playback` the same judge fails, naming `film.reseed` |

## Choices where the issue is open

1. **"Its drawing"** is the `eval` snapshot of the whole frame (`pixels: true`), compared by SHA-256 for "exactly" and
   by decoded pixels for "different".
2. **The boil's fields** take the values above; `scope: "lines"` (what the boil moves) and `seed: "item"` (seeded from
   the item's ID) are this job's values for fields the design names without values. `while: "always"` because nothing
   in the film moves or draws on.
3. **The flicker check's finding** for a seed that follows playback is an error on the film.flicker row with the code
   `film.reseed`. The criterion names no subject, so the test requires only the code.
4. **The planted program's door** is the scenario's `planted` field, as #407's flicker plants are.
5. **Times** are whole flicks: 1/12 s is 58,800,000 and 0.25 s 176,400,000, so the steps are exact.

## Criteria out of reach

None: the criterion's observations (repetition, the check's PASS, the plant's FAIL) are all read.

## What the base already does and these tests don't credit

The base draws a path's stroke in a look's named line (#149's line profiles) and runs the flicker check on a film's
frames in both renditions (#407, #1399). It reads no `time.boil`, so it draws one picture at every time, and it knows no
`film.reseed` and no `boil_seed_follows_playback` (a scenario naming it is refused). So at the base test (1)
fails (steps 0, 1 and 2 draw the same picture) and test (3) fails (the scenario is refused); test (2) passes, as the
issue asks to keep a film that only boils passing. These tests were not run on the base; the fixture was, through
`eval` and `verdict`, to check it draws and passes as described.

## Scope not under a criterion

The other criteria of #466 (transitions, iris, motifs, reveals, captions, quantized blur, the dip and the taste call)
are not redrafted here; boils under reduced motion, `while: drawing | moving`, and hatch or paper reseeding are follow-ups.
