# Blind redraft: #431.a1c2e028 (criterion 4), targets cost only when read

A fresh run of the acceptance-test job on one disputed test (design: Dogfooding), with the job's inputs and the
criterion, never an implementation; none was in this worktree. Nothing here has run: no build and no test. The
type-check (`npx tsc -p tests/acceptance/431/tsconfig.json`) was skipped because this worktree has no `node_modules`;
`node --experimental-strip-types --check` parses the file.

## Inputs used

- Issue #431's body (scope, the nine criteria, proof line) and criterion 4 verbatim: "Targets cost only when read: a
  figure whose effects and operators read neither velocity nor emission allocates neither, by the meter's GPU memory
  count, which matches the device's sizes; reading both at 1920 × 1080 adds 8,294,400 B and 16,588,800 B; and a planted
  core that builds both for every frame adds 24,883,200 B to the first figure and fails, naming the targets."
- Its Oracle page (`doneright/oracles/issues/431.md`): no upstream test for criterion 4.
- `docs/canvas-primitives.md`: GPU operators, as data (GPU operator; Step and the closed step list; Operator input,
  `texture: target {op: core, output: … | velocity | emission}`; Operator output; Place in the frame; Operator cost and
  limits; Determinism class); Effect and Effect and GPU operator: target inputs (velocity 4 B a pixel in rg16float,
  emission 8 B in rgba16float, "the core builds only the targets someone reads and counts their bytes"); Meter and
  degrade ladder (a writer's count holds every target its sessions allocate "at its allocation's size as the device
  reports it: every mip, array layer, cube face and sample, with padding … never a formula over its descriptor"; 30
  frames over before a step down); The cost model's budget class table (a figure's render scale while moving is 1);
  Operator budgets by class (a figure's passes run at half resolution); Look `look@1`: samples and frame history.
- `docs/technical-design.md`: GPU operator; Numbers version 0 has to hold; Dogfooding.
- At this worktree's HEAD (`c12a65bb`): AGENTS.md; `tests/acceptance/379/` (README's `live` call and its memory report:
  `writers[].count_bytes`, `device_bytes`, `device_before`; `helpers.ts`; `window-memory.test.ts` and
  `shared.test.ts` for how the device's allocated size is compared with a count, within 1 to 2 MiB);
  `tests/acceptance/429/` (README and `helpers.ts`: operators as `gpu.pass@1` and `gpu.material@1` items, a material
  attached by `material@1`, `check_operator`'s `estimate_ns`; `remap.test.ts`; the redraft of `budgets.test.ts`);
  `crates/deep-gpu/src/memory.rs` (on Metal a texture's size is its `allocatedSize`, the device's total its
  `currentAllocatedSize`); `crates/deep-gpu-layer/src/live.rs` and `liveview.rs` (the writer's count is the view's
  own allocations as the device reports them plus the results it reads); `allocations.rs` (the test writer's
  per-texture `device_bytes`, rgba8, bgra8, rgba16float and depth32float only, at other usages than a render target).

**Not available:** the original suite. This worktree's HEAD is `origin/main` (`c12a65bb`) and holds no
`tests/acceptance/431/` (no README, `helpers.ts`, `tsconfig.json` or `targets-memory.test.ts`), and other branches and
worktrees were off limits. So this redraft never saw the original test or the dispute, and imports nothing from
`../helpers.ts`. It reuses the merged suites' helpers instead: `../../379/helpers.ts` for the build, the process, the
`live` reply with its memory report and the Metal gate; `../../429/helpers.ts` for the look, operators as items, the
figure and `check_operator`'s reply. The planted name `builds_unread_targets` is the one the brief gave.

## How the criterion reads

**What the device's own size is.** On Metal the device reports an allocation's size as `allocatedSize`
(`memory.rs`), and the design makes that the meter's unit: "with padding … never a formula over its descriptor". An
Apple GPU lays a texture out in tiles and pages, so a 1920 × 1080 target's `allocatedSize` is expected to sit a little
above its texels × bytes: if rows round up to a 64-row tile, 1080 becomes 1088, which adds 61,440 B to velocity and
122,880 B to emission, and lossless compression may add some metadata. These figures weren't measured here (nothing
ran). So a count at the device's sizes can't be expected to add exactly 8,294,400 B and 16,588,800 B; those are the
targets' texels × bytes, which the device's size can only meet or exceed.

| The criterion says | The test judges |
|---|---|
| "a figure whose effects and operators read neither velocity nor emission" | The first figure: three boxes, one moving (b0) and one emissive (b2, a material operator emitting a linear [4, 0, 0]), and one pass operator in the effects chain whose inputs `src`, `a` and `b` all read the core's color. Neither operator reads velocity or emission, though the figure has motion and emission for them to hold. |
| "allocates neither, by the meter's GPU memory count" | The writer's `count_bytes` at frame 12 of `live` with `report: ["memory"]`. A target's cost is a figure's count less the first figure's, so the first figure "allocates neither" exactly when the figures that read a target count that target more. |
| "reading both at 1920 × 1080 adds 8,294,400 B and 16,588,800 B" | Three more figures, each the first with only `a` and `b` changed: velocity and color, color and emission, velocity and emission. Their counts exceed the first figure's by at least 8,294,400 B, 16,588,800 B and 24,883,200 B, and by at most 1 MiB more per target (the device's padding). Reading one target alone shows each is built only when read, and which amount is whose. |
| "which matches the device's sizes" | In each process, Metal's allocated size at frame 12 less its value before the call (`device_bytes − device_before`); the same difference against the first figure must equal the count's difference within 1 MiB per target, #379's tolerance for the device moving by a count. With the floor and the 1 MiB ceiling above, the count is the device's size of a full 1920 × 1080 target of the issue's format. |
| "a planted core that builds both for every frame adds 24,883,200 B to the first figure" | `deep-gpu run --planted builds_unread_targets` on the same four figures: its first figure counts at least 24,883,200 B, and at most 2 MiB more, above the shipped build's first figure. |
| "and fails, naming the targets" | The same check that passes the shipped build fails the planted one with a sentence starting `velocity:` and one starting `emission:` (each says the figure that reads neither already holds it). |

Readings where the criterion or design leaves a choice:

- **"A figure"** is a document of budget class figure at 1920 × 1080, whose render scale while moving is 1, so its
  targets are 1920 × 1080; the test requires internal scale 1 at frame 12. Frame history (work product and showpiece
  only) and motion blur (samples per frame) stay off, so nothing in the look reads velocity, and the #429 look has
  bloom off. 12 frames stay under the 30 a step down needs, so the ladder never moves.
- **"Effects and operators"** are the two operator kinds a figure can hold as items at this base: a pass in the
  `effects` chain and a material operator. The effects module registers no Effect item with `reads` here, so an
  effect's reads are written as a pass's target inputs, the form both share (Effect and GPU operator: target inputs).
- **The pass's resolution** is half, the figure class's; the core's targets are the frame's, at 1920 × 1080, whatever
  resolution reads them.
- **Declared costs** are 1.1 × the check's `estimate_ns` (the largest reader's for all four readers), so the check
  never finds a cost understated and no figure is refused for a cost this criterion doesn't ask about. The four
  readers must check: velocity and emission inputs are accepted.
- **Separate processes.** Each figure runs alone in a fresh `deep-gpu run`, so nothing one figure allocated is still
  held or freed while another is measured. Counts are sums of the sizes the device reports, so the same allocations
  count the same in each process; the device's total enters only as each process's own growth (after less before),
  and those growths are what the figures compare.
- **1 MiB per target** is far above tile and page rounding of a 1920 × 1080 target and far below the 8,294,400 B or more
  by which a wrong format, a second copy or a half-size target would miss.

## The surface used

No new call or field beyond what the issue, #379 and #429 name: #379's `live` call with `report: ["memory"]` (and its
`sessions`, `views[].internal_scale` and `drawn`), #429's `check_operator` with `estimate_ns`, operators as items in a
writer's payload, and #431's own `texture: target {op: core, output: velocity | emission}` inputs and
`--planted builds_unread_targets`.

## Wrong programs and what fails them

- Builds both targets for every frame (the planted core): every figure's count is the first figure's, so all three
  floors fail, naming velocity, emission and both; its first figure is 24,883,200 B (plus padding) above the shipped one.
- Builds a target when anything reads any target, or when something moves or emits: the first figure holds it, and
  its floor fails.
- A target in the wrong format (velocity in rgba16float, emission in rgba32float), twice, or with a depth of its own: over
  the ceiling. At half size or memoryless: under the floor.
- A count that misses a target the device holds, or holds one the device doesn't: the device comparison fails.
- Not separated here: a count that is texels × bytes where the device pads by less than 1 MiB. The per-allocation check
  of device sizes is #379's (`formula_count`).

## Run

```sh
npx vitest run --root tests/acceptance/431 redraft/targets-memory.test.ts --no-file-parallelism
```

It builds `deep-gpu` once (`cargo build --locked --bin deep-gpu`), runs on macOS's Metal device, and fails as
`INCONCLUSIVE:` off macOS or where Metal's allocated size isn't reported.
