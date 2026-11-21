# Acceptance tests for #3025: material operators that cut coverage are refused (the operator shadow pipeline reads the light group)

Written first, from issue #3025 (its cause, its fix, its two acceptance criteria and its proof line), the design sections
it links, and the base commit `b6b99ad8c` ("Merge pull request #3003 …"), by a job that never saw an implementation; none
existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this
job (design: Dogfooding). Lean, as #446's suite: one file per criterion, at most two tests each. The issue is a fix, so
the wrong program is the merge base (AGENTS.md, Proof); no planted program is added.

## What was read

- Issue #3025 (no comments).
- `docs/technical-design.md`: GPU operator; Light without history. `docs/canvas-primitives.md`: Light and the light
  policy.
- At the base: `crates/deep-scene3d-render/src/op.rs` (`compile`: the shadow pipeline built when an operator writes
  `alpha` or has a `discard_if@1` step, its layout `[frame, None, None, inputs]`, the error scope that refuses the whole
  operator), `op.wgsl` (`run_op`'s `planted(P_BUMP_HAND)`, `op_shadow_fs`'s alpha cutoff), `scene3d.wgsl` (`planted()`
  reads `lights.count.z`, group 1), `mesh.rs` (the box's and the cylinder's uv0), `lib.rs` (`shadow_pipeline` culls no
  face; `material_op` logs a refused operator; `shadow_cut`); `crates/deep-gpu-layer/src/view3d.rs` (a frame whose
  operator is refused is itself refused, `operator_compile`); `crates/deep-canvas-scene3d/src/scene.rs` and `light.rs`
  (`mark.cylinder@1`'s size, `alpha_mode`, `shadow`); `crates/deep-canvas/src/steps.rs` (`uv0@1`, `split@1`, `lt@1`,
  `discard_if@1`); `scripts/proof-change.mjs` (`criterionId`), `scripts/lanes.mjs` and `scripts/proof-guard.mjs` (the
  suite's own `lane.json`); and the suites `tests/acceptance/446/` (its helpers, which this suite imports, its README and
  `caster-t.test.ts`) and `tests/acceptance/486/` (its README, the uv0 split operator).

## What the base does

A material operator that cuts its coverage gets a shadow pipeline (#446) whose fragment entry calls `run_op`, which
since #486 calls `planted(P_BUMP_HAND)`, which reads group 1; the shadow layout has no group 1, the device rejects the
pipeline, and the error scope refuses the whole operator. The renderer then draws the part with its material's own
values (`lib.rs`, `material_op`), so the solid would cast its whole shadow, but `view3d` refuses that frame with
`operator_compile` (`view3d.rs`: "A material operator that can't draw refuses the frame, never drawn without it"), so
through this surface the base draws no frame for either solid. Each test therefore also draws the whole shadow as its
control, the same disc with no operator, so the run shows what the fallback would cast. Operators that don't cut build
no shadow pipeline and compile at the base. `BASE-FAILURE.txt` records the suite's run there: both tests fail on the
refusal, after the fixture's own checks held in the same process.

## Run them

They build `deep-gpu` with cargo through #446's helpers, so they run one file at a time; `lane.json` puts the folder in
`scripts/lanes.mjs`'s `alone` list (#1327). On this machine cargo needs the pinned toolchain's `bin` on PATH:

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease nice -n 10 \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/3025 --no-file-parallelism --testTimeout=600000 holes.test.ts
node node_modules/typescript/bin/tsc -p tests/acceptance/3025/tsconfig.json
```

AC2 is #446's own test, run on the change from #446's folder, never copied or edited here:

```sh
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease nice -n 10 \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/446 --no-file-parallelism --testTimeout=600000 caster-t.test.ts
git diff --exit-code b6b99ad8c -- tests/acceptance/446/   # "unchanged": no file of #446's suite differs from the base
```

Every test draws on macOS's Metal device; off macOS it fails with a message starting `INCONCLUSIVE:`, never passes. No
criterion names a budget, so nothing reads a wall clock or needs a reference Mac. Each test writes into its own temporary
folder and deletes it. A run with `--root` may leave Vitest's cache in `tests/acceptance/3025/node_modules/.vite`; delete
it.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, the leading `- [ ] `
dropped (`scripts/proof-change.mjs: criterionId`). Each test's name starts with `AC<n> #3025.<id>`; the file's header
gives its fixture, numbers and wrong programs in full.

| ID | File (tests) | What it asserts |
|---|---|---|
| AC1 `#3025.f34de22c` | `holes.test.ts` (2) | A 1 m disc 2.5 m up, half way under one shadowed spot 5 m over a lit plate, seen in plan; each frame judged pixel by pixel against the plate alone. 1: under an operator that discards where uv0.u < 0.5 the frame is drawn, not refused; the ring behind the kept half (24,642 px) is under 5% of the lit plate on average and 15% at most; the ring behind the discarded half (24,642 px) and the plate seen through it (6,886 px) read the plate alone within 2% on average and at least 90% each. 2: under an operator that writes alpha 0 everywhere the frame is drawn, and the whole ring its shadow would darken (56,536 px) reads the plate alone, the same way. In both, the fixture: the plate alone reads at least 0.5 on every judged pixel, and the disc with no operator darkens the ring (mean under 5%) |
| AC2 `#3025.1a4324ec` | none here | `tests/acceptance/446/caster-t.test.ts` (AC6 `#446.3834c570`) run on the change with the commands above, passing, with #446's folder unchanged from the base |

The proof line's other items are the implementer's and need no file here: #486's `relief.test.ts`, run as #486's README
says, passes unchanged (`bump_ignores_handedness` still reaches the color entry); and frames with no cutting operator are
byte-identical to the merge base (pixel hashes or target files of the base's binary and the change's, on one machine).

## Readings where the issue leaves a choice

- **"A solid whose operator discards where uv0.u < 0.5"** is a thin disc, `mark.cylinder@1` turned to face the spot,
  not a box. A shadow pass culls no face (`shadow_pipeline`), so both large faces cast. The base's cylinder caps both
  carry u = 0.5 + x, so u < 0.5 is the same half on both. The box's top face runs u along x and its bottom along y, so
  its kept parts would shade three quarters of its square, and "its kept half only" couldn't hold for any program.
- **"Its kept half"** is the disc's x ≥ 0 half; its shadow is the half disc of radius 1 m at x ≥ 0 (the spot doubles it).
  The judged rings stay 0.15 m from the half shadow's straight edge and 0.1 m from its round one, where the side wall's
  sliver lies, so neither the penumbra nor the wall decides a pixel.
- **"Throws a shadow"** and **"throws none"** are read on the plate outside the disc's footprint in the view, against
  the same document without the disc: dark under 5% of it on average, lit within 2% on average. **"Its holes let light
  through"** is also read straight through the hole: the plate seen through the discarded half reads as the plate alone,
  which needs the operator's color pass to cut as well.
- **"Compiles"** is the frame drawn: a reply with a refusal `code` fails, naming it. At the base this is the failure.
- **"A solid whose operator writes alpha 0"** keeps its material's default `alpha_mode` (opaque), as the base's
  `op_shadow_fs` lets light through where a written alpha is under the cutoff, whatever the mode. How the solid itself
  draws in the view isn't judged.
- **"Under one shadowed spot"**: each document holds one spot, `shadowed: {spots: 1}`, PCF, as #446's AC6 drew its spots.
- **AC2's "unchanged"** is #446's folder equal to the base, since the test imports its helpers.

Not tested, because no criterion asks: a cutting operator under the sun's cascades or a point light's map; an alpha
between 0 and the cutoff; a cutting operator over t (#446's AC6 holds it).
