# Acceptance test for #142, criterion 9 redrafted: a longer cue re-times the later `after` cues

A blind redraft (design: Dogfooding) of criterion 9's test, `AC9 #142.30bc3e5b`:

> An explain.dark_math example whose cues are a `cues@1` list, with cue 3's span lengthened by 1 s, starts every later
> `after` cue 1 s later with no edit to them and keeps an `at` cue where it was; a planted recipe that reads each cue's
> start as an absolute time leaves cue 4 where it was and fails, naming the cue

Written at `1b93a9eb2`: base `64c9be338` ("Merge #223's branch (PR #2505, group warps) as #142's base") plus the first
draft of this suite, `tests/acceptance/142/`, read as data. Written by a job that saw no implementation of #142 and no
other worktree, branch, PR, stash or session. The implementing agent doesn't edit these files (AGENTS.md, Proof).

**It supersedes** `tests/acceptance/142/ac9-timing.test.ts` (both of its `it`s). The suite's other files stand.

## What was read

- Issue #142, live (`gh issue view 142 --repo windoliver/deepbuild`): its Scope, its Fields and criterion 9.
- `docs/canvas-primitives.md`: Pack: explain@1 film recipes; Recipe; Pack: kind rules and the kind kit; Pack: kinds in
  any pack; Pack: dependencies; Cue list `cues@1` (`after` starts at the previous cue's end plus `gap`, `with` at its
  start, `at` at a time or a marker; each cue writes the marker `cues.<id>`); Honest numbers (both sections).
- `docs/technical-design.md`: Films and figures on the canvas ("one edit re-times what follows"); Dogfooding.
- The first draft: `README.md`, `helpers.ts`, `ac9-timing.test.ts`, `BASE-FAILURE.txt`, `tsconfig.json`.
- At the base, for surfaces and facts only: `crates/deep-canvas/src/document/rules.rs` (the Honest numbers check:
  a text@1 whose text shows a digit or a number word, `NUMBER_WORDS`, is refused with `number_unsourced`);
  `crates/deep-canvas-motion/src/cues.rs` (cue timing: the list's times are document times, `at` is absolute, the
  marker `cues.<id>` is `{kind, t, span}`) and `curve.rs` (a channel holds its first key before it);
  `packs/verbs-1.0.0/` (`fade_in`, class `enter`: opacity from 0); `crates/deep-show/src/frames.rs` and
  `film_audit.rs` (`eval`'s `texts`: each drawn text at an opacity above 0), `packs.rs` (the `expansions` rows),
  `main.rs` (the scenario's `planted`; an unknown name refuses the scenario), `hub.rs` (a scenario's pack folder is
  installed before the first call).

## Run it

```sh
export PATH="/opt/homebrew/opt/rustup/bin:$PATH"   # cargo, where it isn't on PATH
npm ci                                             # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/142-redraft-ac9 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/142-redraft-ac9/tsconfig.json   # type-check (exits 0)
rm -rf tests/acceptance/142-redraft-ac9/node_modules/.vite
```

The file builds `deep-show` once, in `beforeAll` (`cargo build --locked --bin deep-show --no-default-features
--features full`, `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0` unless set, honoring `CARGO_TARGET_DIR`), copies the
binary out, and fails every test if the build failed. Every `it` passes a 60 min timeout. Node built-ins and vitest
only; temporary folders are deleted. Nothing here judges a timing, so no test is INCONCLUSIVE; a test that couldn't
decide would fail, never pass. The folder builds a cargo binary, so `scripts/lanes.mjs` needs
`'tests/acceptance/142-redraft-ac9/'` in its `alone` list (the implementer makes that edit).

## The surface under test

`deep-show run` as the first draft reads it: one scenario line in, one answer line out; the scenario's `packs: [{id,
dir}]` and `planted`; `deep show` of a whole document from your shell; `eval {doc, t, texts}`. **Every name below that
neither the issue nor the design gives is a choice, marked *(chosen)*; each is the first draft's**, kept as it wrote
it:

- The explain pack is `deepbuild/explain` 1.0.0 in `packs/explain-1.0.0/` *(chosen)*, offered by each scenario with the
  first-party verbs: `packs: [{id: "deepbuild/explain", dir: <checkout>/packs/explain-1.0.0}, {id: "deepbuild/verbs",
  dir: <checkout>/packs/verbs-1.0.0}]`. A film names it `deepbuild/explain@1.0.0`.
- The recipe's kind is `explain.dark_math@1`; **every input but `cues` has a default** *(chosen)*, so the fixture sets
  only `cues` and `stage: "2d"`.
- **A cue's kind is any `cue.kind@1` entry**, so the first-party `fade_in` (class `enter`) plays in a film recipe's
  list; each cue's `text` is drawn as a text whose shown string is that text *(chosen)*.
- **The expansion's rows**: the `deep show` reply's `expansions` holds a row for the instance `film`, and one for every
  instance it derives (`film.…`); **rows list the `markers` a film recipe writes, each cue's `cues.<id>` as `{t, span}`
  with every time resolved** *(chosen)*, in whole flicks or `"<decimal>s"`. The test reads the rows together.
- **The planted program** *(chosen)*: scenario `planted: "film_cue_starts_absolute"`: every film recipe starts each cue
  at an absolute time read from its place in the list, k seconds for the k-th cue (from 0), an `at` cue at its time,
  whatever spans and gaps come before it; all else as shipped. Reachable only through the scenario's `planted`.

## The fixture

Written in `helpers.ts` and the test file; nothing on disk. A film of 640 × 360 u, 7 s at the default 60 fps, the
tempo map `{segments: [{at: "0s", bpm: 120, meter: [4, 4], span: 64}]}` (a beat every 0.5 s), naming
`deepbuild/explain@1.0.0` and `deepbuild/verbs@1.0.0`, holding one instance `film` of `explain.dark_math@1` with:

| Cue | Kind and word | `when` | Span | Original film | Longer film | Under the plant |
|---|---|---|---|---|---|---|
| cue_one | `fade_in` MAKE | (first) | 0.5 s | 0–0.5 s | 0–0.5 s | 0 s |
| cue_two | `fade_in` LOUD | after | 0.5 s | 0.5–1 s | 0.5–1 s | 1 s |
| cue_three | a wait | (after) | **0.5 s / 1.5 s** | 1–1.5 s | 1–2 s | 2 s |
| cue_four | `fade_in` NORTH | after | 0.5 s | 1.5–2 s | **2–2.5 s** | 3 s, both films |
| cue_five | `fade_in` BRIGHT | after | 0.5 s | 2–2.5 s | **2.5–3 s** | 4 s, both films |
| cue_six | `fade_in` CALM | `{at: "5s"}` | 0.5 s | 5–5.5 s | 5–5.5 s | 5 s |

The two films are the same document but for cue_three's span (the test checks it). Every landing is on a beat in both
films and under the plant, nothing exits, no entrances overlap, no word has a sub-line, and the list spans 5.5 s, so the
fixture breaks none of the six grammar rules the issue names in either film or under the plant. **Every word shows no
number**: the base's Honest numbers check refuses a text@1 that shows a digit or a number word, so a film whose cues
carry ONE or FOUR is never presented.

## What the test asserts

The judge is one function, run on the shipped program and under the plant; each failure starts with the cue it names.

| # | Assertion | The wrong program it fails on |
|---|---|---|
| 1 | Both films are presented with no error | the base (no explain pack, no dark_math recipe) |
| 2 | Each cue's marker `cues.<id>`: cue_four and cue_five start exactly 1 s (705,600,000 flicks) later in the longer film; cue_one, cue_two, cue_three and cue_six start at the same flick | the planted recipe (cue_four and cue_five don't move); an `at` cue that moves with the list; a re-timing of the earlier cues |
| 3 | In each film, each later cue's word (NORTH, BRIGHT, CALM) isn't shown a frame before its marker's start and is shown at the cue's landing, its marker's start plus its span (`eval` with `texts`, read in a second process at the times the first process's markers give) | markers that move while the words stay; words that play at absolute times while the markers follow the list |

Test 1 runs the judge on the shipped program and requires no failure. Test 2 runs it under
`planted: "film_cue_starts_absolute"` and requires a failure naming cue_four.

## Readings where the issue leaves a choice

1. **"An explain.dark_math example"** is an instance of the recipe in a film this test writes, so its cue list can have
   a cue 3 whose lengthening moves `after` cues and leaves an `at` cue; the shipped example's own cue list isn't read.
2. **"Cue 3"** and **"cue 4"** are the third and fourth cues of the list in order. Cue 3 is a wait, so lengthening it
   moves what follows and breaks no grammar rule.
3. **"Starts … 1 s later"** is read on each cue's marker `cues.<id>`, which `cues@1` writes at the cue's start, compared
   between the two films to the flick, so a recipe that places the whole list later (a lead-in) still passes. The words
   are probed where each film's own markers put them, for the same reason.
4. **A word shown** is a drawn text whose shown string is the cue's word at an opacity above 0. An entrance by `fade_in`
   starts its word at opacity 0 and ends it fully drawn (the cue kit), so the word is hidden a frame before its start
   and shown at its landing.
5. **"Fails, naming the cue"** is the judge's failure list holding one that starts with `cue_four:`.

## Differences from the first draft

Same criterion, same surfaces, same plant, same reading of "starts" on the markers; the fixture and the word probes
change:

- The words are letters only with no number word (MAKE, LOUD, NORTH, BRIGHT, CALM, not ONE, TWO, FOUR, FIVE, SIX),
  since the base's Honest numbers check refuses a shown number word with `number_unsourced`.
- The film also names `deepbuild/verbs@1.0.0`, whose `fade_in` its cues play, so the verb resolves whether or not the
  explain pack requires the verbs.
- The `after` cues write `when: "after"` explicitly.
- The words are probed a frame before each marker's start and at the cue's landing, at times read from the markers,
  not a frame either side of times computed from the cue list.

## At the base

Not run (no `deep-show` build). Read from the base's code: both tests build the binary and then fail. Test 1 fails at
"the films are not both presented with no error" (`packs/explain-1.0.0/` is missing, so `deepbuild/explain@1.0.0` is
missing and the film is refused); test 2 fails at "deep-show run refused the scenario" (`film_cue_starts_absolute` is no
plant of the base). The type-check exits 0.
