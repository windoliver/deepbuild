# Blind redraft of #432's acceptance tests: dispute D1 (controls without a role)

Written by a fresh blind run of the acceptance-test job (design: Dogfooding, "Who drafts it", "Disputes"), from issue
#432, its Oracle page, the design and base commit `0c3b9d48`, and the original suite committed at `e479895f`
(`tests/acceptance/432/`). It never saw an implementation. The implementing agent doesn't edit these files.

## What was read

- Issue #432 (Scope, Fields, six acceptance criteria, Proof) and its Oracle page (`doneright/oracles/issues/432.md`).
- `docs/canvas-primitives.md`: Control (its Fields: `label`; `role` (an ARIA role)), Control: kinds as a registry (each
  `control@1` entry carries `role: ARIA role`; the kit's keyboard part checks "it has a role"), Variant, and GPU operators,
  as data (Compile, validate and cache; pass fusion), as the original read them. `docs/technical-design.md`: Dogfooding.
- At the base: `crates/deep-canvas/src/document/check.rs` (`check_controls`: a control without a `role` is refused with
  `out_of_range` at `controls/<id>/role`, "required, and absent"); `crates/deep-canvas-input/src/kit.rs` (`role`: the
  ARIA role the input module's `control@1` entries give each kind: a toggle `switch`, a choice `radiogroup`).
- The original suite at `e479895f`: `README.md`, `helpers.ts`, `depth-equal.test.ts`, `product.test.ts`,
  `finish.test.ts`.

## The dispute and the answer

**D1.** The original's fixtures give their controls no `role`. The design's Control lists `role` (an ARIA role) among a
control's fields, and the base's core check refuses a control without one. So every fixture with controls is refused at
check by any correct program: AC4's product figure in both channel forms (`productDoc`), AC4's cap figure (`capDoc`, both
the 22-set figure that must be admitted and the 44-set one, whose refusal would then also carry `out_of_range`), and AC5's
finish figure with two and three variant sets and in both edit orders (`finishDoc`, `finishExtra`). Those tests fail on
every program and prove nothing.

**The answer: each control gets its ARIA role, and nothing else changes.** The criteria say nothing about roles; the
design requires one; so the plainest correct fixture adds it. The values:

| Control | Kind | Role | Why |
|---|---|---|---|
| `glass_toggle`, `shade_toggle` | toggle | `switch` | ARIA's role for an on/off control; the base's `control@1` kit gives the toggle kind this role |
| `skin_choice`, `time_choice`, `medium_choice`, `look_choice` | choice | `radiogroup` | ARIA's role for picking one of a set of options, each a radio; the base's kit gives the choice kind this role |

A test-side choice among other roles a screen reader would accept (`checkbox` for a toggle, `listbox` for a choice)
wouldn't change any assertion: the base's check accepts any non-empty string. The kit's roles were taken so the fixtures
say what the input module itself says those kinds are.

Everything else is the original's: its surface (its README's "The surface under test": the `input` event, `created`,
`operator_pipelines`, pass `key` and `operators`, `calibration`, the three planted names, `fuse`, `parts`), its readings
of the criteria, its fixtures' numbers and its assertions. That README stays the reference for all of them.

## What it replaces

| Original (`tests/acceptance/432/`) | Test | Redraft |
|---|---|---|
| `depth-equal.test.ts` | `AC1 #432.e6a02864 the first frame of every fixture document compiles no pipeline, on the noop lane and on Metal` | `redraft/depth-equal.test.ts`, same name |
| `product.test.ts` | `AC4 #432.b131b5d1 0 to 6 s with the sheen keyed at 2.9 s and both toggles at 4 s, and a sheen moved 0.3 → 0.6: …` | `redraft/product.test.ts`, same name |
| `product.test.ts` | `AC4 #432.b131b5d1 a planted warm-up of the feature sets in use at t = 0 (--planted warms_in_use_at_t0) …` | `redraft/product.test.ts`, same name |
| `finish.test.ts` | `AC5 #432.5c39ff99 four states, and 36 with nine grades: …` | `redraft/finish.test.ts`, same name |
| `finish.test.ts` | `AC5 #432.5c39ff99 a planted warm-up that fuses only the default options (--planted fuses_default_options) …` | `redraft/finish.test.ts`, same name |

Not replaced, and still the original's: `depth-equal.test.ts`'s pixel test (`AC1 … a fade of a ball that fills the
frame …`; its ball documents have no controls), and all of `fusion.test.ts`, `blur-split.test.ts` and
`shadows.test.ts`.

## Changes from the original, line by line

- `helpers.ts`: `REPO` is one folder further up (`join(HERE, '..', '..', '..', '..')`); two constants, `TOGGLE_ROLE =
  'switch'` and `CHOICE_ROLE = 'radiogroup'`; `role:` added to the six controls in `productDoc`, `capDoc` and
  `finishExtra`; a header note. Nothing else.
- `depth-equal.test.ts`: the first-frame test only, its body unchanged; the pixel test, its helper `pixelProblems` and
  the imports only it used are dropped; the header says so.
- `product.test.ts`, `finish.test.ts`: a header note only; the tests are the original's, byte for byte.
- `tsconfig.json`: paths one folder further up.

## Run them

As the original's README says (each file builds `deep-gpu` once and draws on the noop lane and on Metal; one file at a
time; the `'tests/acceptance/432/'` entry the original asks for in `scripts/lanes.mjs`'s `alone` list covers this folder
too, since the lanes exclude and run it as `tests/acceptance/432/**`):

```sh
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/432/redraft --no-file-parallelism depth-equal.test.ts
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/432/redraft --no-file-parallelism product.test.ts
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/432/redraft --no-file-parallelism finish.test.ts
npx tsc -p tests/acceptance/432/redraft/tsconfig.json   # type-check
```

Delete Vitest's cache in `tests/acceptance/432/redraft/node_modules/.vite` after a run. Only the type-check was run for
this redraft (it passes); no cargo build and no GPU test was run.
