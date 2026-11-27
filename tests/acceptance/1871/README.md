# Acceptance tests for #1871: an image tooth under a drawn look is drawn in `view3d`

Written first, from issue #1871 (its summary, scope, four acceptance criteria and proof line), the design section it
links (`docs/canvas-primitives.md`, Look `look@1`: paper) and `docs/technical-design.md` (Dogfooding; the taste call),
at base commit `1b4929ae7` ("Merge pull request #3436 …"), by a job that never saw an implementation; none existed. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding). Lean: one test per criterion, two files, one planted twin.

What was read:

- The issue; AGENTS.md; `node scripts/design-section.mjs --issue 1871` (Look `look@1`: paper); `docs/technical-design.md`
  for Dogfooding and the taste call.
- #149's suite, `tests/acceptance/149/`: README, `helpers.ts`, `paper.test.ts`, `pressure.test.ts` (whose gray PNG tooth
  and look these tests reuse), `taste.test.ts`, `TASTE.json`, `BASE-FAILURE.txt`, `fixtures/`.
- At the base, only for how surfaces work: `crates/deep-gpu-layer/src/{main,view3d,marks2d,film}.rs`,
  `crates/deep-gpu-layer/src/view3d/parse.rs` (the call's `assets`), `crates/deep-groups-render/src/drawn.rs` (where a
  tooth image is read and its refusal's shape), `scripts/lanes.mjs` and `scripts/proof-runs.mjs` (how a failure message's
  state, twins and `lines.json` are read).
- The oracle page wasn't read; the issue says no upstream test checks these criteria.

What the base already does and these tests don't credit: #149's look@1 paper with `tooth.from`, read from the call's
`assets` in 2D (`layers`, `film2d`), and `view3d` drawing a `basis: drawing` look. Under a drawn look `view3d` hands the
look an empty asset map, so any `tooth.from` is refused `asset_unreadable` with reason `ground/params/tooth/from: <sha>`,
in the image's presence or absence. So AC3's refusal already holds at the base.

## Run them

They build `deep-gpu` and draw on the Metal GPU through `deep-gpu run`, so they run with `--no-file-parallelism`, and
`lane.json` runs this folder alone.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/1871 --no-file-parallelism
npx tsc --noEmit -p tests/acceptance/1871    # type-check
```

Each file builds `deep-gpu` once (`cargo build --locked --bin deep-gpu`, through #149's `useGpu`), copies it to a
temporary folder and fails each test if the build failed. #149's `helpers.ts` sets Vitest's timeouts. Each test writes
into its own temporary folder and deletes it; `taste.test.ts` also writes `docs/evidence/1871/`.

- Every test draws on Metal: off macOS it fails `INCONCLUSIVE:`, never passing (#149's `requireMetal`).
- No test takes an outside input but the taste call, so none reads `BLOCKED`.
- `BASE-FAILURE.txt` holds the suite's run at the base: AC1, AC2 and AC4 fail at their assertions, refused; AC3 passes.

## The surface under test

**No new binary, call or field.** #377's `deep-gpu run` and #378's `view3d`, driven exactly as #149's suite drives them
(`tests/acceptance/149/helpers.ts`: `useGpu`, `runGpu`, `rows`, `pngOf`), with the call's `assets` (`{sha256: path}`),
which `view3d` already takes for mesh, map and dirt files. `scene.ts` holds:

- **#149's gray PNG tooth**: `pressure.test.ts`'s image, 256 × 128 px of 8 × 8 px patches of 256 gray levels in
  bit-reversed order, named by its SHA-256.
- **The same drawn look**: `pressure.test.ts`'s look, #149's base look with a paper ground whose `tooth` is
  `{kind: cold_press, from: <sha>, scale: 1, depth: 1, seed: 1}`, anchored to the world, and its two named lines.
- **The other gray PNG** (AC2): the same image inverted, `255 − v`, so every patch's level changes.
- **The one-box 3D scene**: 480 × 270, a perspective `camera@1` and one 1 u `mark.box@1` filled with the look's
  named fill in `indigo`, so most of the frame is paper.
- **#149's 2D page** (AC4): `pressure.test.ts`'s figure, one wide light stroke across the tooth, drawn by `film2d` with
  the same `assets`.

A refused call's reply is `{code, reason}`; the tests print the whole reply in every message, so a refusal names its
path.

## Criteria to tests

| ID | Criterion | Test | At the base |
|---|---|---|---|
| `#1871.9a827581` | AC1: #149's gray PNG tooth, in the call's `assets`, under the same drawn look on a one-box scene through `view3d`, is drawn, not refused | `tooth3d.test.ts`, "AC1 … is drawn on the one-box 3D scene, not refused": the reply has no `code`, frame 0 has a pixel hash and a captured 480 × 270 PNG | fails at its assertion, the reply refused `asset_unreadable`, `ground/params/tooth/from: <sha>` |
| `#1871.7550b5c1` | AC2: the same scene with a different gray PNG as its tooth gives a different pixel hash | `tooth3d.test.ts`, "AC2 …": one run of three calls, #149's tooth twice and the other PNG once; the first two hashes match (so a difference is the image's, not a frame that varies) and the third differs | fails at its assertion, refused as AC1 |
| `#1871.fbe6ad2a` | AC3: with the PNG missing from `assets`, `view3d` still refuses `asset_unreadable` at `ground/params/tooth/from` | `tooth3d.test.ts`, "AC3 …": the look names #149's tooth, `assets` holds only the other PNG (a map that isn't empty but lacks it); the reply's `code` is `asset_unreadable` and its `reason` contains `ground/params/tooth/from` | passes, as the base refuses every tooth image in 3D; fails on the twin `tooth-missing-unrefused` |
| `#1871.f656387e` | AC4: screenshots of the 3D scene on the image tooth beside #149's 2D page, from `deep-gpu run`, one taste call recorded | `taste.test.ts` (The taste call) | fails at its assertion before any screenshot, the 3D scene refused; once drawn, `INCONCLUSIVE:` until `TASTE.json` is recorded |

The tests name each criterion's ID literally, as the lanes know them: the first 8 hex digits of SHA-256 of the
criterion's text, whitespace folded (`scripts/proof-change.mjs`).

## Planted twins

The before lane needs every tagged test to fail at its assertion on the merge base or on a twin of its tag. AC1, AC2
and AC4 fail on the base. AC3 passes there, so `twins.json` names one twin for it:

- **`tooth-missing-unrefused`** (`#1871.fbe6ad2a`): `twins/tooth-missing-unrefused/lines.json`, one edit to
  `crates/deep-groups-render/src/drawn.rs`, where the drawn look reads a tooth image: an image missing from the assets is
  dropped and the paper draws its kind's own tooth, with no refusal. AC3 fails there at its `code` assertion. It's a
  `lines.json` edit, not a whole copy, so it lays over whatever the implementation changes in `view3d.rs`; it stops
  laying only if the implementation rewrites those lines of `drawn.rs`, which the issue's scope doesn't touch. Checked at the base: with the edit laid
  on a copy, AC3 fails at its `code` assertion, the scene drawn (pixel hash `eb4652c8…`) instead of refused.

## The taste call

`taste.test.ts` draws, in one `deep-gpu run`, the 3D scene on #149's image tooth (the same `view3d` call as AC1, frame 0)
and #149's 2D page on the same tooth under the same look (`film2d`, frame 0), and writes the renderer's PNGs byte for
byte to `docs/evidence/1871/tooth-3d.png` and `docs/evidence/1871/tooth-2d.png`, printing each SHA-256. Show both to the
owner, side by side, attach them to the PR, and record the one call in `tests/acceptance/1871/TASTE.json`:

```json
{"issue": 1871, "criterion": "#1871.f656387e", "verdict": "looks_right" | "looks_wrong", "who": "…", "when": "<ISO 8601>",
 "screenshots": {"tooth-3d.png": "<sha256>", "tooth-2d.png": "<sha256>"}, "note": "…"}
```

No file, or one made on other pictures, fails `INCONCLUSIVE:` (#149's `inconclusive`, which the lanes read as
INCONCLUSIVE, never PASS); `looks_wrong` fails; `looks_right` on exactly these hashes passes. This job didn't write
`TASTE.json`. No other test reads these pictures or the call.

## Readings where the issue and design leave a choice

- **"The same drawn look"** is #149's look for its gray PNG tooth, in `pressure.test.ts`, unchanged.
- **"A one-box 3D scene"** is a camera and one box; the camera is an item, not a box.
- **"Missing from `assets`"** is a call whose `assets` holds another PNG and not this one, which also covers an empty map
  at no cost.
- **"A different pixel hash"** is held against the same tooth drawn twice in the run, which must match, so a view3d that
  draws differently each time can't pass AC2.

## Not asserted, because no criterion says so

What the image tooth looks like in 3D beyond its pixel hash changing with the image (that's the taste call's); 3D marks
reading the tooth; a dolly or zoom in 3D; budgets.
