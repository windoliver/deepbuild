# Acceptance tests for #495: time offsets and held drawings: echo, lag and smooth, flips and luma mattes

Written first, from issue #495 (its Scope, Fields, five acceptance criteria and Proof line: "Echo, lag, flip and matte fixtures
seeked in random order against played frames"), the design sections it names and those they lean on, its Oracle page, and base
commit `a4d2c5d4e` ("Merge pull request #1610 …"), by a job that never saw an implementation; none existed, and no other worktree
or branch was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this
job (design: Dogfooding).

## What was read

- The issue, live with `gh issue view 495 --repo windoliver/deepbuild`: five criteria, the fifth the "Shown to you" taste call.
- Its Oracle page, `doneright/oracles/issues/495.md` (`DeepBuildAI/deepbuild`, branch `doneright`): upstream tests for criteria 3
  (Godot's color test: sRGB 0.5 is linear 0.214041) and 4 (Blender's Grease Pencil flip) only, none runnable on our output, so
  both are restated here against our binaries (#136). Criteria 1, 2 and 5 have none.
- `docs/canvas-primitives.md`: The order of one evaluation; Driver; Driver: time offsets; Frame and group; Frame and group: flip,
  echo; Mask; Matte; Time remap; Transport; Marker lists as `492`/`491` use them.
- `docs/technical-design.md`: Dogfooding; Tests written first. AGENTS.md. `tests/acceptance/492/` (layout), `430/` (the GPU
  layer's `layers` and `film2d` calls), `489/`, `491/` (document forms). At the base: `crates/deep-motion/src/main.rs`,
  `crates/deep-gpu-layer/src/{film,marks2d,main}.rs`, the expression error text the base gives.

## Run

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/495 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/495/tsconfig.json   # type-check (exits 0)
```

Each file builds its binary once (`cargo build --locked --bin deep-motion`, or `deep-gpu`) and copies it out; every test of a
file fails when the build fails. The suite builds cargo binaries, so `scripts/lanes.mjs` needs `'tests/acceptance/495/'` in its
`alone` list (this job writes only this folder; the implementer makes that edit). The pixel tests draw on Metal: off macOS they
fail `INCONCLUSIVE`, never pass. Every `it` passes `TIMEOUT`. Delete Vitest's cache `tests/acceptance/495/node_modules/.vite` after a run.

## The surface under test

No new binary or subcommand. The tests extend what the base already has; the implementer builds exactly this.

### `deep-motion eval` (AC2), unchanged protocol

Input `{"doc", "times": [flick]}`; output `{"ok": true, "frames": [{"t", "items": {id: {"at": {"pos": [x, y, z]}}}}]}` or a refusal
`{"ok": false, "code", "path", …}` (no code pinned; the tests read the whole refusal for the IDs it must name). New:
the driver expression grammar gains `lag(var, "<time>")` and `smooth(var, "<time>", samples)`, the time a string literal in the
time grammar (`"0.5s"`, `"-0.5s"`), as the issue writes `lag(x, "0.5s")`. At the base a string literal is `bad_doc` ("unexpected `\"`").

### `deep-gpu run` (AC1, AC3, AC4), unchanged protocol: `{"out", "calls": [...]}` to `{"ok": true, "replies": [...]}`

- `{"call": "layers", "doc", "look", "t", "by": ["gpu_layer"]}`: reply `layers[0].drawn.gpu_layer.png` is the SHA-256 of
  `<out>/<sha>.png`, 8-bit straight alpha; the base has it.
- `{"call": "film2d", "doc", "look": "clean", "from", "frames", "hash": true}`: reply `frames[i] = {frame, pixel_hash, …}`; the base
  has it (`from` opens the film at that frame with nothing drawn before it: a seek).
- New document fields only (all in `params`): `group@1.echo`, `group@1.flip`, and an item kind `matte@1`.

### Documents

Envelope as #391 and `492`: `{format: 1, id, profile: "film", size, layers, transport: {span, frame_rate: [60, 1]}, items, channels?,
drivers?, controls?, markers?}`; items `{id, kind, layer, name, order, params, parent?, visible?}`.

| Field | As the tests write it |
|---|---|
| Echo | `group@1` `params.echo: {copies: 8, lag: "2f", decay: 0.5, mode: "over", newest: "top"}` (the design's fields; `2f` is two frames at the document's 60 fps) |
| Flip, keys | `params.flip: {keys: [{t: "0.5s", show: "c2"}, {t: "1s", show: "none"}]}` |
| Flip, occurrences | `params.flip: {from: {list: "markers.cue"}, map: {A: "c0", B: "c1"}}` over `markers: {id: {kind: "cue", t: "0.2s", payload: {value: "B"}}}` |
| Matte | `{kind: "matte@1", params: {source: <item ID>, mode: "luma", luma?: "linear" \| "encoded", applies_to: <item ID>}}`; the source an item with `visible: false` |
| Look | `layers` takes a palette `{light: {role: [r, g, b]}}`; `film2d` the shipped look `clean` (roles `accent`, `ink`) |

## Criteria to tests

IDs as `scripts/proof-change.mjs` computes them (first 8 hex digits of the SHA-256 of the criterion's text).

| ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| AC1 `#495.2cde4005` | `echo.test.ts` (2) | a 4 px bar at 8 px per frame, echo 8 copies at 2f, decay 0.5: at frame 30 alpha 255, 128, … 1 at 16 k px left for k = 0 to 8, and 0 at k = 9 (fails no echo, 7 or 9 copies, linear decay, a wrong lag); 1,000 seeded random frames of 48 drawn alone with `from` hash as the in-order play does, the echo changes at least 40 of frames 2 to 47 against no echo, and the played frames differ (fails a history buffer or reused trail, and an echo that draws nothing) |
| AC2 `#495.268c5ad9` | `lag-smooth.test.ts` (3) | at 1,000 random times in random order over [0, 11 s) lag(x, "0.5s") and lag(x, "-0.5s") equal x at t -+ 0.5 s within 1e-9 on a kinked channel (fails x(t), a flipped sign, f32 time); smooth(x, "0.4s", 5) equals the mean of x at t + 0.2, 0.1, 0, -0.1, -0.2 and equals five lags written by hand, within 1e-9 (fails a one-sided window, 4 or 6 samples); a dt from a var, "10.5s", "-10.5s", a look-ahead of a control, and 17 samples are refused naming the driver and the offender, while "10s", "-10s" and a look-back of the same control are accepted (fails accept-all and refuse-all) |
| AC3 `#495.a46e8949` | `matte.test.ts` (2) | sRGB 0.5 grey covers 0.214 (unset and `linear`) and 0.5 (`encoded`) within 1/255, each also from the exact formula, and (200, 100, 50) covers by Rec. 709 weights in each space (fails luma in one space for both, a mean, Rec. 601); the hidden source leaves the target white (fails a drawn source); a sliding source drawn 30 frames in order and each alone in random order hashes alike in both modes and the modes differ (fails a coverage cache) |
| AC4 `#495.ece8b00e` | `flip.test.ts` (2) | exactly the child the last key at or before t names, `none` shown as no child, at every key's flick, one flick before it and 150 seeded times; the occurrence form shows the child the last cue's value maps to (fails no flip, two children, early or late swaps, nearest key) |
| AC5 `#495.984de463` | `taste.test.ts` (1) | reads the record only; no pictures or no call is INCONCLUSIVE, never PASS |

## Choices where the issue is open

1. **Surface.** AC2 through `deep-motion eval` (where drivers live), the rest through `deep-gpu`'s existing `layers` and `film2d`
   calls, the only calls that return pixels; coverage is read as the target's straight alpha, so it is the same in a 2D layer's
   encoded space and in linear light.
2. **smooth's samples** are endpoint-inclusive: n samples at t + w/2, then every w/(n-1) down to t - w/2 (5 samples over 0.4 s:
   +0.2, +0.1, 0, -0.1, -0.2). The design says only "evenly spaced across a window of width centered on t". Width is a time string.
3. **Occurrence flip.** The design's `from: occurrence list` has no value field; the value is the occurrence's `payload.value`
   and a list is `{list: "markers.cue"}`. Before the first occurrence no child shows; the tests read only after it.
4. **Matte item.** The design gives fields, not an item form; it is kind `matte@1` with them in `params`, as `mask@1` has.
5. **Echo copies.** `copies: 8` is copy 0 (the group) plus eight at k = 1 to 8, each at decay^k of opacity.
6. **Not pinned.** Refusal codes and texts (only the IDs and the offender are read); which copy composites on top.

## Criteria out of reach

- **AC4's logic-array form** (`flip: {array: <logic>.<name>[index], map}`). It needs a logic item running a WebAssembly program that
  writes an i32 array, and no surface at the base builds one from a test without a compiled program; the keys and occurrence forms
  and `none` are covered. The PR should say `Part of #495` unless a blind redraft adds it.
- **AC2's "bound value refused by lag" and "cycle across times"** are in the design, not in the criterion; not tested.
- **AC1's "on one machine"** is what the equality of two draws in one process shows; no cross-machine check is possible here.

## The taste call

The check run writes six files to `docs/evidence/495/`: `echo-8-copies.png` and `.apng`, `matte-linear.png`, `matte-encoded.png`,
`flip-group.png` and `.apng`. The owner's one call goes in `tests/acceptance/495/TASTE.json` (this job does not write it; none
exists, so `taste.test.ts` holds INCONCLUSIVE, as in #430 and #492):

```json
{ "issue": 495, "criterion": "#495.984de463", "verdict": "looks_right", "who": "…", "when": "2026-11-07T09:00:00Z",
  "screenshots": { "echo-8-copies.png": "<sha256>", "…": "…" }, "note": "…" }
```

## What the base already does and these tests don't credit

`deep-gpu` draws groups, rects and 2D films with pixel hashes; `deep-motion eval` runs channels and drivers. It ignores `echo` and
`flip`, answers `module_missing` for `matte@1`, and cannot parse `lag(…, "…s")`. So 10 of 10 tests fail at the base on their
assertions (`BASE-FAILURE.txt`).
