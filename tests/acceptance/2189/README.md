# Acceptance tests for #2189: a full-screen showpiece view holds 2.6× the 256 MB its check admitted; count what the view allocates

Written first, from issue #2189 (its device breakdown table, Scope, three acceptance criteria, Proof line and its
dependency #1903), the design sections it links, and base commit `24c9efe45` ("docs(#1903): the envelope's run on a
Mac17,10, …", the tip of PR #2185), by a job that never saw an implementation; none existed. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- `docs/canvas-primitives.md`: GPU surface (slots, the copy path, transient MSAA, internal scale down to 0.5 and the
  history window down to 2 frames, "the check's memory estimate counts the slots, the HDR slots and frame history at the
  view's size, and refuses a document that can't fit at those floors, naming the size"); Meter and degrade ladder
  ("Per-writer memory caps are hard", a writer's count at each allocation's size as the device reports it); The cost
  model (GPU memory "estimated from formats"; the check "refuses a document over its class") and the budget class
  table (showpiece: 256 MB per window, with transient MSAA, render scale 0.5 while moving); Frame budget (the envelope).
- `docs/technical-design.md`: the Decided row "GPU memory for a full-screen 3D view" (256 MB stays; scale, then
  window; reopens if a view measured at both floors still passes 256 MB).
- Issues #2189 and #1903.
- At the base: AGENTS.md; `crates/deep-gpu-layer/src/envelope.rs` (the `envelope` call, `play`, `fixture_row`'s
  `gpu_memory` row, the refusal `{"code": "refused", "issues"}` when a fixture's check refuses it);
  `crates/deep-gpu-layer/src/live.rs` (`admit`: `meter::fit` at the class's base scale with the envelope's 0-frame
  window, and its `over_budget` issue `{path: "size", actual: {size, gpu_bytes, cap_bytes}}`); `crates/deep-gpu/src/meter.rs`
  (`estimate`, `fit`, the floors, `FIT_SHARE` 0.95); `crates/deep-gpu/src/memory.rs` (`allocated`: Metal's
  `currentAllocatedSize`); `crates/deep-gpu-layer/src/main.rs` (`deep-gpu run`, the start-up `no_device` line);
  `docs/evidence/1903/run.mts`, `README.md` and `envelope.json` (the every-pass scene, the full-screen run, the scene's
  peak 659,161,088 B and `separate-items`' 378,093,568 B on the Mac17,10); `tests/acceptance/1903/` (README, helpers:
  `separateItemsDoc`, `instancedTwinDoc`, `writeDoc`, `fixtures/look.json`; its conventions).

What the base already does and these tests don't credit: #1903's `envelope` plays each fixture on the device and
reports `gpu_memory: {limit_bytes, verdict, peak_bytes}` from the device's allocated size at its peak; `admit` refuses
a view whose estimate at the floors passes 95% of its class's cap with an `over_budget` issue naming its size, bytes and
cap. But the estimate counts only the slots, HDR slots, core targets, the upscale, frame history and test effects:
162,134,784 B for the every-pass scene at 3456 × 2234, so the scene is admitted and the device then holds 659 MB.
There is no `estimate_bytes` in the `gpu_memory` row.

## Run them

They build `deep-gpu` for release and draw on this Mac's Metal GPU, so they run with `--no-file-parallelism` (the two
files' device runs never share the GPU), and `scripts/lanes.mjs` needs this folder in its `alone` list. This README is
the instruction; the implementer makes that edit.

```sh
npm ci --no-audit --no-fund     # once, if node_modules is missing
npx vitest run --root tests/acceptance/2189 --no-file-parallelism
npx tsc -p tests/acceptance/2189/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Each file first builds `cargo build --locked --release --bin deep-gpu` once (cargo on `PATH`, the pinned 1.99.1
toolchain), copies the binary out of `target/release` (or `$CARGO_TARGET_DIR/release`) into a temporary folder, and fails
each test if the build failed. Each test writes into its own temporary folder and deletes it. Every test runs `deep-gpu
run` with no `--backend`, so on this Mac's GPU, with no stub. Off macOS, or where the binary answers `no_device` (no
Metal device), each test is skipped as `INCONCLUSIVE`, never passed; off macOS nothing is built. A run with `--root
tests/acceptance/2189` leaves Vitest's cache in `tests/acceptance/2189/node_modules/.vite`; delete it.
`BASE-FAILURE.txt` says what each test gets at the base.

## The surface under test

No new surface but one field. The tests drive #1903's `envelope` call as the base has it (`tests/acceptance/1903/README.md`:
The `envelope` call), one scenario `{"out": dir, "calls": [Call]}` on `deep-gpu run`'s stdin:

```json
{"call": "envelope", "look": look@1, "writer": "agent:alpha", "store": dir, "scene": path,
 "separate_items"?: {"doc": path, "instanced": path},
 "render": {"seconds": 1, "pixels": [w, h]}, "first_frame_wait": false}
```

and read, from its reply, either the refusal at check

```json
{"code": "refused", "issues": [{"code": "over_budget", "path": "size",
                                "actual": {"size": [w, h], "gpu_bytes": bytes, "cap_bytes": bytes}, …}]}
```

or each fixture row's `gpu_memory`, which gains the issue's `estimate_bytes`, the check's estimate for the fixture's view:

```json
{"fixture": "scene" | "separate-items", "why": null | "not_run", …,
 "gpu_memory": null | {"limit_bytes", "verdict", "peak_bytes": bytes | null, "estimate_bytes": bytes}}
```

## Fixtures

- `fixtures/every-pass.json`: #1903's every-pass scene, the `scene` of `docs/evidence/1903/envelope.json` at the base
  (made by `docs/evidence/1903/run.mts`), copied unchanged: a showpiece whose orbit camera turns once over 60 s, with a
  sky, a shadowed sun and lamp, a mirror floor, a patterned material, a 400-element instancer and a lens flare.
- `separate-items` and its instanced twin: `separateItemsDoc()` and `instancedTwinDoc()` from
  `tests/acceptance/1903/helpers.ts`, as the evidence run made them; the look is that suite's `fixtures/look.json`.
- The device figure: 659,161,088 B, the scene row's `gpu_memory.peak_bytes` in `docs/evidence/1903/envelope.json` at the
  base, held as a constant in `helpers.ts`.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace collapsed and the leading
`- [ ] ` dropped, computed with #607's command (as #305's README gives it) with the issue's three criterion lines on
stdin. Each test's name starts with its criterion's ID.

| ID | Criterion (the issue's text) | Tests and what each asserts |
|---|---|---|
| `#2189.41928b7b` | On Metal, an `envelope` call (`deep-gpu run`) with #1903's every-pass scene at 3456 × 2234 (the scene in `docs/evidence/1903/run.mts`: showpiece, moving camera) is refused at check: the reply's `code` is `refused`, with an `over_budget` issue whose `actual` names the size `[3456, 2234]`, its `gpu_bytes` over 256,000,000 and `cap_bytes` 256,000,000; or it plays and every fixture's `gpu_memory.peak_bytes` is at most 256,000,000. On #2185's tip the scene is admitted and peaks at 659 MB, which fails. | `full-screen.test.ts`: one `envelope` call of the every-pass scene at 3456 × 2234 on Metal. Refused: its `code` is `refused` and some `over_budget` issue's `actual` has `size` `[3456, 2234]`, `gpu_bytes` over 256,000,000 and `cap_bytes` 256,000,000. Answered: the `scene` row was played, and every played row's `gpu_memory.peak_bytes` is a number at most 256,000,000. Any other reply fails. |
| `#2189.39fdadfa` | On Metal, the same scene and `separate-items` (with its instanced twin), each played by an `envelope` call at 1280 × 800, report `gpu_memory.estimate_bytes` within 10% of `gpu_memory.peak_bytes`. On #2185's tip the every-pass scene's estimate is about a tenth of its peak, which fails. | `estimate.test.ts`: one `envelope` call at 1280 × 800 on Metal with the every-pass scene and `separate-items` with its instanced twin: answered, not refused; the `scene` and `separate-items` rows each played, with `gpu_memory.peak_bytes` a reading above 0 and `gpu_memory.estimate_bytes` a number, \|estimate − peak\| ≤ 10% of peak. |
| `#2189.9104323e` | The bytes an `over_budget` refusal names for the every-pass scene at 3456 × 2234 are within 10% of the 659 MB the device held for it at the floors on the Mac17,10. | `full-screen.test.ts`, the same call's reply: `code` `refused`, at least one `over_budget` issue naming `[3456, 2234]`, and each such issue's `actual.gpu_bytes` within 10% of 659,161,088 (593,244,980 to 725,077,196). |

## Readings where the issue and design leave a choice

- **"On Metal"** is this Mac's own GPU through `deep-gpu run` with no `--backend noop` and no stub meter, as #1903's
  evidence ran. The tests don't gate on a reference Mac in its conditions: the criteria name Metal, not the reference
  Mac, and they read bytes the device allocates, not a timing. The design's rule that a memory budget counts only on a
  reference Mac is the envelope's `gpu_memory.verdict`, which no test reads. Criterion 3 doesn't say Metal; it shares
  criterion 1's run, since the issue's 659 MB is a Metal figure.
- **"Every fixture's `gpu_memory.peak_bytes`"** is every row the call played (each row but one marked `why: "not_run"`).
  The call carries the scene alone, since the criterion names only the scene, so the `separate-items` row is `not_run`.
  A null peak (the device couldn't say) is not "at most".
- **"An `over_budget` issue whose `actual` names …"** is at least one such issue holding all three values.
- **"The bytes an `over_budget` refusal names"** is `actual.gpu_bytes` of each `over_budget` issue naming
  `[3456, 2234]`. "Within 10% of the 659 MB" is \|bytes − 659,161,088\| ≤ 10% of 659,161,088, the evidence's figure
  for the device at the floors (internal scale 0.5, a 0-frame window). The figure is a constant here, not read from
  the evidence file at run time, so a later evidence run doesn't move it. Criterion 3 holds only with a refusal, so it
  fails if criterion 1 is met by playing under the cap instead.
- **"Each played by an `envelope` call at 1280 × 800"** is one call carrying the scene and `separate_items`: the call
  needs a scene to play `separate-items` at all, and one call plays each. The instanced twin has no row of its own
  (#1903), so the rows read are `scene` and `separate-items`. "Within 10% of `peak_bytes`" is relative to the peak; a
  peak of 0 is no reading.
- **Run length.** No criterion names one, and what a view allocates is made when it opens (the issue's table: slots,
  read-back buffers, targets, cull, atlas, cascades, the mirror's renderer, the upscale). So each fixture plays
  `render.seconds` 1 (#1903's default 60 warm-up frames, then five timed runs of 60 frames at 60 Hz), with no first
  frame wait, so each Metal run is short.
- **The scene's size.** The scene keeps its own `size` field (3456 × 2234) in both calls; the call's `render.pixels`
  sizes the view, as #1903's envelope does for every fixture.

Not tested, because no criterion asks or the surface can't reach it: the breakdown table measured again (the PR's
Proof), the estimate's parts, that `estimate_bytes` is the same number the check admits by (beyond the refusal at full
screen), HDR slots and frame history (the envelope opens with a 0-frame window), the local light's shadow map and env
cubes (which hold nothing in this scene), the instanced twin's own estimate, and raising the 256 MB cap (out of scope).
