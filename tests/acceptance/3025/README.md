# Acceptance tests for #3025: material operators that cut coverage are refused, so their holes don't let light through

Written first, from issue #3025 (its cause, its two acceptance criteria and its proof line), the design sections it
links (GPU operator; Light without history; Light and the light policy) and the base commit `e9d73de96` ("Merge pull
request #2952 …"), by a job that never saw a fix. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test per criterion, and AC2 is an existing
test.

## What was read

- Issue #3025 and its three design sections.
- At the base: `crates/deep-scene3d-render/src/op.rs` (`compile`: the operator's pipelines under one error scope, the
  shadow pipeline for an operator with an `alpha` output or a `discard_if@1` step, its layout `[frame, None, None,
  inputs]`), `op.wgsl` (`run_op`'s `planted(P_BUMP_HAND)`, `op_shadow_fs`), `scene3d.wgsl` (`planted()` reads
  `lights.count.z`, group 1 binding 0; `shadow_fs` culls no faces), `lib.rs` (`material_op` files a refused operator
  under `counts.operators_refused`; `shadow_pipeline` has no cull mode), `mesh.rs` (the unit box's and cylinder's uv0);
  `crates/deep-gpu-layer/src/view3d.rs` (a refused operator refuses the frame, `operator_compile`; the `shadows`
  report); `crates/deep-canvas-scene3d/src/{scene.rs,sets.rs,light.rs}` (`mark.cylinder@1`'s size, `local_of`'s
  Rz·Ry·Rx, `light_policy.shadowed.spots` up to 8, material operators by `params.op`); `crates/deep-canvas/src/steps.rs`
  (`uv0@1`); and the suites `tests/acceptance/446/` (`helpers.ts`, `caster-t.test.ts`, its README) and `486/` (uv0 and
  operator steps).

## Run them

The test builds `deep-gpu` with cargo through `446/helpers.ts`'s `useGpu`, as 446's suite does (it honours
`CARGO_TARGET_DIR`), so it runs alone, one file at a time.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run tests/acceptance/3025/holes.test.ts --no-file-parallelism --testTimeout=600000
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run tests/acceptance/446/caster-t.test.ts --no-file-parallelism --testTimeout=600000   # AC2
node node_modules/typescript/bin/tsc -p tests/acceptance/3025/tsconfig.json
```

It draws on macOS's Metal device; off macOS it fails with a message starting `INCONCLUSIVE:`, never passes. Nothing
reads a wall clock.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, the leading `- [ ] `
dropped. The test's name starts with `AC1 #3025.<id>`; its file's header states the fixture, numbers and wrong programs.

| ID | Test | What it asserts |
|---|---|---|
| AC1 `#3025.f34de22c` | `holes.test.ts` (1) | Three disks over a lit plate, each under its own shadowed spot, one frame: `halved` (operator discards where uv0.u < 0.5) darkens the plate past its +x half (under 5% of the lit plate beside it) and not past its −x half (over 90%); `hollow` (operator writes alpha 0 everywhere) darkens neither; `plain` (no operator, the control) darkens both; each spot reports its local map. A refused frame fails naming `halved` and `hollow` |
| AC2 `#3025.1a4324ec` | `tests/acceptance/446/caster-t.test.ts`, run unchanged | Proven by running #446's AC6 test (`#446.3834c570`) unchanged on the change; this suite holds no copy of it |

The proof line's other items, #486's `relief.test.ts` passing unchanged and frames with no cutting operator byte-identical
to the merge base, are the change's own proof, not criteria; this suite adds nothing for them.

## Readings where the issue leaves a choice

- **The solids are disks, not boxes.** On the unit box (`mesh.rs`) the top face runs u along +x and the bottom face along
  +y, and the shadow passes cull no faces, so a box cut where uv0.u < 0.5 would still cover three quarters of its
  shadow. On the unit cylinder's two caps u is 0.5 + x, so a cylinder turned 90° about X, a disk 1 m across and 0.1 m
  thick, loses the same −x half on both caps: its kept half is +x.
- **"Under one shadowed spot"** is one spot for each solid, 6 m apart so no spot's cone reaches another solid or band;
  the policy shadows three spots (`shadowed: {spots: 3}`, the base allows up to 8).
- **"Throws a shadow from its kept half only" and "throws none"** are read on the plate past each half, on a ring 0.6 to
  0.95 m from the centre, which the whole disk's shadow covers (it reaches 1.22 m) and the disk doesn't hide in the view
  (0.5 m), against the plate 1.45 to 1.65 m out, lit in every program. The thin shadow of the side wall's kept arc lies
  between 1.22 and 1.28 m, outside both bands.
- **The control** proves the frame's spots cast over these bands; each spot's map in the `shadows` report keeps a dropped
  shadow from passing as a hole.
- **"Compiles"**: at the base view3d refuses the whole frame when an operator can't draw (`operator_compile`, naming the
  first refused operator), so no disk draws at all, rather than the solids drawing without their operators. The test
  reads a refused reply as both operator solids failing, each named, with the reply's reason.

Not tested, because the criterion doesn't ask: operators on see-through parts, on point or area lights' maps, or under a
sun's cascades; partial alpha; operators whose coverage moves with t (#446's AC6 holds that).
