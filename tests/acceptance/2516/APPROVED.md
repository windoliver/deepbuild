# #2516 — owner-approved corrections to the frozen acceptance checks

## The approval

- **Owner's message, verbatim** (from the issue-2516 working session, recorded 2026-11-15T07:41:02Z):

  > goea d do whatever you reockemnd to close the issue

- **What it approves:** the reconciliation proposal `reports/2516-approval-proposal.md` at PR commit
  `34f8f63216ea3ccefc496262d5c97f4ae7cfd403`. Its approved items, as `approval.json` records them:
  1. "Qualify the cube center-point and matching band-average references separately; retain every issue expected value and product tolerance"
  2. "Apply the proposed mechanical tuple-index typing correction without weakening compiler settings"
  3. "Correct only this issue's machine gate to the design's three reference Macs; keep no-GPU BLOCKED and other machines INCONCLUSIVE"
  4. "Use the original wall fixture at full resolution, both cameras and both sample counts, for the full-radius wrong-program wall demonstration only; keep all shipped wall/cube/slab settings and tolerances unchanged"
  5. "Retain the displayed default radius and strength on the exact four main/after images linked on PR #2578"
- **Not approved** (`approval.json`): inventing a test result or bypassing remaining required checks; any further change
  to product tolerance or acceptance scope beyond the proposal; treating a busy or unleased timing as qualified; blessing
  unrelated goldens or changing other sessions' work.

## Sources

- Base commit: `1c4d1f0e2aaad8c6a6573848823566d04ff73d17`.
- The checks before this approval: the original draft and the one blind redraft (`redraft-ac4/`) at commit
  **`3cd75b8aa`**. That commit is the historical copy; no second copy runs automatically.
- Applied mechanically by the acceptance-drafting job from the issue, the proposal, the approval, AGENTS.md and the
  design (Dogfooding; the CPU-reference rule; The reference Macs). No implementation, run output or other checkout was
  read.

## Requirement → edit

| Approved | File | Edit |
|---|---|---|
| A (item 1) — point and band qualified separately | `helpers.ts` | Added `cubePointReference(d)`: the same 4,096-ray cosine-weighted f64 reference at the one point d in front of the middle of the face. Added `cubeBandClosedForm(d)`: the redraft's f64 `cubeFaceClosed` (imported from `redraft-ac4/reference.ts`, not copied) averaged over the same 11 points as `cubeReference`. `cubeReference` itself, which the GPU is compared with, is unchanged. |
| A | `reference.test.ts` | The cube rows of the qualification test: the point value against the issue's 0.68 and 0.81 and against `cubeFaceClosed`, and the band average against `cubeBandClosedForm`, each within the unchanged 0.01; plus the redraft's precondition that every corner of the face lies within the radius of the band (`cubeFaceReach`). This replaces the one contradictory comparison (band average, ≈ 0.6922 at 5 cm by the proposal, against the issue's point value 0.68). Wall, slab, twin and camera-framing checks are unchanged. |
| A | `cube.test.ts` | Header comment only. The shipped test (both cameras, every setting, ±0.1 of `cubeReference`) is unchanged. |
| B (item 2) — tuple-index typing | `redraft-ac4/reference.ts` | `hits`: `for (let k = 0; k < 3; k++)` → `for (const k of [0, 1, 2] as const)`. No other change; no cast, no compiler setting. |
| C (item 3) — this issue's machine gate | `redraft-ac4/fixtures.ts` | No longer re-exports #379's `requireReferenceMac` (Mac15,7 and Mac15,12 only). Its own `requireReferenceMac` reads the real `sysctl -n hw.model` through #379's unedited `machineModel` and accepts exactly `Mac15,7`, `Mac15,12`, `Mac17,10`; anything else, or not macOS, is INCONCLUSIVE via #379's `inconclusive`. `gpuRun`'s BLOCKED on `no_device` is unchanged. #379's files are not edited. The original suite's gates (`requireGpu`; the perf lane's `judgeLimit`, which already lists the three) needed no change and are unchanged. |
| D (item 4) — full-radius wall witness | `cube.test.ts` | The `ao_full_radius` plant's wall part reads the original wall fixture (`WALL_BOXES`, cameras A and B) at `WITNESS_SETTINGS` = 8 and 16 samples at **full** resolution (asserted), in place of all four settings; bound still 0.05 of the closed form at 5–40 cm. The cube part is unchanged: every point from each camera > 0.99, and the check fails naming the camera. |
| D | `redraft-ac4/cube.test.ts` test 3 | The redraft's own wall fixture is no longer the witness. Test 3 now gates the machine, then reads the **original** wall fixture through `../helpers.ts` `measure` with the redraft's plant `ao_points_at_radius`, cameras A and B, 8 and 16 samples at full resolution (asserted; 24 readings), each within 0.05 of `wallClosed`. |
| D | `redraft-ac4/fixtures.ts` | Removed the redraft's `WALL_FIXTURE`/`WALL_DISTANCES`, now unused (the proposal rejects substituting them). |
| D | `helpers.ts` | `Plant` admits `ao_points_at_radius`, the redraft's name for the same wrong program, so the redraft can use the original `measure`. |
| E (item 5) — taste | none | Not recorded here. `TASTE.json` is written only by the implementing session, with the owner's exact message and the four images' hashes; `taste.test.ts` is unchanged. |
| — | `README.md`, `redraft-ac4/README.md` | Only to explain the differences above. |

Unchanged: `wall.test.ts`, `slab.test.ts`, `taste.test.ts`, `timing.test.ts`, `unedited-418.test.ts`, both
`tsconfig.json` files, `redraft-ac4/reference.test.ts`, and everything outside `tests/acceptance/2516/`.

## Expected values and bounds, all unchanged

- Wall (AC1): 0.564, 0.626, 0.688, 0.748, 0.858, 0.948 at 5–40 cm, ±0.05, shipped program at 8/16 samples × half/full × cameras A and B; main's loop planted fails naming the first point.
- Open floor (AC2): 1 ± 0.01 at 60 cm and 1 m; the strengthened main loop fails at 5 cm.
- Slab (AC3): 0.25 and 0.5625, ±0.05; main's loop > 0.8 and fails naming the height; the even-weighted loop reads 0.5 and fails.
- Cube (AC4): the issue's 0.68 and 0.81 (now held as point values); GPU readings within **0.1** of the band reference at every setting from both cameras; the full-radius plant > 0.99 at both points from each camera, failing naming the camera.
- The CPU qualification bound 0.01 and the closed forms' ±0.0005 against the issue's digits.
- The redraft's qualification rows and its band reference (≈ 0.691 / 0.816) are unchanged.

Known unchanged drafting choice, not altered here: the original band reference averages 11 points along x at exactly d,
while the GPU bin also spans ±0.5 cm across d.

## Limitation of the redraft's test 3 after D

It draws through the original `measure`, which has no BLOCKED word: on a reference Mac with no GPU, or a `deep-gpu`
without the plant, it **fails** with deep-gpu's reply instead of reading BLOCKED. Off the reference Macs it is
INCONCLUSIVE before drawing. It never passes in either case.

## Proof status

**Nothing here has been run** by this job: no type-check, no CPU test, no GPU test. The implementing session runs, unchanged:

- `npx tsc -p tests/acceptance/2516/tsconfig.json` and `npx tsc -p tests/acceptance/2516/redraft-ac4/tsconfig.json` (B: the ten TS2532 errors should be gone);
- `reference.test.ts` and `redraft-ac4/reference.test.ts` (CPU; A);
- `cube.test.ts` and `redraft-ac4/cube.test.ts` on the reference Mac under the GPU lease (C, D), with the rest of the suite as `README.md` says.

This approval is not a PASS for any criterion. AC4 still needs its GPU readings, and AC7 still needs the owner's taste call recorded in `TASTE.json`.
