# Acceptance tests for #492: clips and placements: slots, mix and add placements, quantize and time remaps

Written first, from issue #492 (its Scope, its Fields, its 16 acceptance criteria and its Proof line: "Mix-order, additive
and remap fixtures against their closed forms, and the long-span placement read bit for bit"), the design sections it names
and those they lean on, its Oracle page, and base commit `c12a65bb` ("Merge pull request #1281 …", origin/main), by a job that
never saw an implementation; none existed, and no other worktree or branch was read. The implementing agent doesn't edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue, read live with `gh issue view 492 --repo windoliver/deepbuild`. It has 16 criteria: 15 functional and the "Shown
  to you" taste call, so the taste call is AC16 here, as on the Oracle page.
- Its Oracle page, `doneright/oracles/issues/492.md` on branch `doneright` of `DeepBuildAI/deepbuild`, reachable with `gh api`,
  and the vendored files it links for criteria 2, 4, 5, 6 and 13 (Upstream tests, below).
- `docs/canvas-primitives.md` at the base: Time and the flick; Transport; Clip; Placement; Placement: order-free mix; Placement:
  only; The order of one evaluation; Channel and key; Channel and key: quantize jump; Driver; Constraint; Control; Time remap;
  `start_on` and `switch`; Look `look@1` (`time`); Writer layer; Status binding; Migration; Document envelope; Path and handle;
  ID and sub-address; World and backend `physics.world@1`.
- `docs/technical-design.md`: Dogfooding; Tests written first.
- At the base: AGENTS.md; `crates/deep-motion/src/main.rs` (the CLI: `eval`, its answer, `planted`, `input`, `look`, `bounds`);
  `crates/deep-canvas-motion` (`src/doc.rs`: placements, clips, `time_remaps`, channel targets and types, `frame_rate_of`;
  `src/eval.rs`; `src/program.rs`; `src/constraint.rs`'s look_at); `crates/deep-show/src/kit/migration.rs` (`corpus_record`); the
  merged blind suites `tests/acceptance/489/`, `491/`, `391/`, `430/` and `446/`, whose layout and conventions this one follows;
  `scripts/proof-change.mjs` (how a criterion's ID is computed).

## Run

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/492 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/492/tsconfig.json   # type-check (exits 0)
```

`cargo` must be on PATH. `--root` keeps the repo's `vitest.config.ts` out; a root with no config of its own uses Vitest's
defaults. It leaves Vitest's cache in `tests/acceptance/492/node_modules/.vite`; delete it, it is not part of the suite.

Each file builds `deep-motion` once, in `beforeAll` (`cargo build --locked --bin deep-motion`, honoring `CARGO_TARGET_DIR`), and
copies it out under its own name; every test of a file fails when its build fails. The files build a cargo binary, so they run
one at a time: `scripts/lanes.mjs` needs `'tests/acceptance/492/'` added to its `alone` list (this job writes only this folder;
the implementer makes that edit). Every `it` passes `TIMEOUT` (30 min). The issue states no timings, so nothing is timed. Node
built-ins and vitest only.

## The surface under test

The issue names fields, a notice code and observations but no code API, so these tests extend the surface #391, #417, #489, #490
and #491 left (`deep-motion eval`), add no binary and no subcommand, and read nothing else. **Every name below that the issue or
design doesn't give is this job's choice** (each is listed again under Choices), the smallest surface consistent with the design
and the base; the implementer builds exactly these, or a dispute goes to a blind redraft. The tests judge values: an item's x, a
quaternion, a rate, a refusal's IDs, never how they were reached.

### `deep-motion eval` (#391's JSON-lines convention, unchanged)

Input `{"doc": Document, "times": [flick], "planted"?: name, "input"?: [entry], "look"?: look@1}`. Output `{"ok": true, "frames":
[Frame], "markers": {…}, "hash": …, "notices"?: […]}`, or a refusal `{"ok": false, "code": string, "path": string, …}`, whose whole
JSON the tests search for the IDs it must name; no code is pinned. New:

- `planted`: the names under Planted programs; any other value stays `bad_input`.
- `look.time.quantize_hz`: the look's stepped time (Look `look@1`: `time`), on the eval line's existing `look`.
- In a frame, `placements.<id>.rates.<clip channel ID>`: that clip channel's `.rate`, per second of document time, for the
  placement's first target: the segment derivative times the placement rate times the remap's derivative.
- In a frame, `frame`: the frame index at the document's `frame_rate`, ⌊(t − start) ÷ Δ⌋ in integer arithmetic.
- `notices` as #491 left it, now also `{code: "look_at_degenerate", …}`, naming the constraint.

### Documents

#391's envelope (`{format: 1, id, profile: "film", title, description, size, layers, transport, items, …}`) with:

| Field | As the tests write it |
|---|---|
| Clip | `clips: {ID → {span?, channels: {ID → {target: "slot:<slot>/<path>", type, keys}}}}`, as at the base |
| Placement | `placements: {ID → {clip, slots: {slot → ID \| [ID]}, start \| after + offset, in, span, rate, repeat: {count, mode}, hold_at, quantize, extend: {before, after}, blend, influence, add_from, fade_in, fade_out, stagger: {lag, order}}}`: the issue's fields, flicks as time text (`"1.5s"`, `"3f"`, `"-0.5s"`), as the base writes `offset` |
| Placement order and writer | `order: "a0"` (a fractional key) and `layer: <layer ID>` on a placement: "the other blends follow writer layer then order"; a layer's `writer` is its writer, as on an item |
| Rational | text `"p/q"` (`rate: "1/2"`, `to: "1/4"`), the form `transport.frame_rate` takes |
| Placement quantize | `quantize: "8/1"`, a frame rate in that form |
| Quaternion channel | `type: "quat"`, a key's value `[x, y, z, w]`, on `items/<id>/params/quat` or `slot:<slot>/params/quat`, `interp: "linear"` the shorter-arc slerp; the frame reads `items.<id>.params.quat` |
| Angle channel | `type: "angle", space: "shortest"`, degrees |
| Quantize key | `interp: {quantize: {n, jump}}` |
| Quantize modifier | `modifiers: [{quantize: {hz, jump}}]`, as the base writes `wave` |
| Time remap | the base's `time_remaps: {ID → {target: <placement ID>, map}}`, `map` one of: `"reverse"`; a channel `{keys: {…}}`, `t` parent time, `value` child time in flicks; `{ramp: {from, to, at, over}}` (`ease` left out, in_out_quad); `{hold_at: {at, for}}`; `{replay: {on: {list: "markers.cue"}, before, after, rate}}`; `{hitstop: {at: [time], hold, then}}` |
| Reading `.active` | a driver var `"<remap ID>.active"` (Time remap: "Drivers read `<remap ID>.active`") |
| Switch | on each placement of a choice's case, `switch: {control, case, span, ease}`: the design's fields plus which control and which of its values the placement plays; `ease` a name; `controls.<id>: {kind: "choice", class: "document", label, options, default}`; entries as #489's, `value` the option |
| Status binding | `status_bindings: {ID → {target: "items/<id>/params/paint/<slot>", source}}`, as other suites write it |
| look_at | `constraints: {ID → {owner, kind: "look_at", target, axis, up}}`, `up` the design's field |

### Planted programs

Each is an eval `planted` name; each goes through the same check the real program passes.

| Name | Criterion | The wrong program |
|---|---|---|
| `placement_f32_seconds` | 10 | a placement turns t into f32 seconds, then flicks, before the repeat wraps it: at 86,400 s + 1/60 s it reads 0.015625 |
| `replay_at_rate_1` | 11 | a replay ignores its rate and runs at 1 |
| `blend_per_component` | 12 | rotations blend per component (then normalize), with no sign alignment |
| `slerp_long_arc` | 12 | rotations slerp with no sign alignment, so q to −q goes the long way |
| `unkeyed_resets_to_base` | 13 | a replace placement resets every channel its clip doesn't key to the base |
| `ramp_sums_per_frame` | 14 | a ramp's child time is the left Riemann sum from 0, Σ rate(kΔ) × Δ, for k < t ÷ Δ, with Δ the document's frame; it reads the issue's 3.5367 s at 24 fps and 3.5275 s at 60 fps at 1.5 s |
| `hitstop_matches_parent_time` | 15 | a hitstop's matches are read in parent time: under lag the second hold runs from t = 2.0 s at child 1.860 s |

## Criteria to tests

Each test's name starts with the criterion's ID (`AC<n> #492.<sha8>`, as `scripts/proof-change.mjs` computes it).

| Criterion | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| AC1 `#492.7cd93cd7` | `mix.test.ts` (1) | `parity/animation/mix-order-free.film`, weights 0.8 and 0.7: at 60 seeded times x, y and a rotation against base + Σ wᵢ (vᵢ − base) and the normalized aligned sum (fails normalized weights, a missing channel read as 0, an unaligned sum); the fixture with its `order`, writers and file order swapped reads the same items bit for bit (fails order dependence) |
| AC2 `#492.f372ab7a` | `quantize-rate.test.ts` (4) | each jump mode, n = 3 and 11: WPT's table and each step's first flick and the flick before, at 24, 30 and 60 fps (fails a step on a frame, or on f32 progress); the modifier at 12 Hz, start and end; `.rate` under a placement rate, a ramp and a doubling map at chosen flicks and against a central difference at seeded ones; exactly 0 inside a remap's hold, past a placement's hold_at and in an extend hold |
| AC3 `#492.5d279164` | `switch-look-at.test.ts` (2) | four cases' weights after three changes in one span against the newest-first closed form, on 24 and 60 fps frames, backward and by seek (fails a restart, an oldest-first stack, a mix that integrates); a zero and an up-parallel aim: finite, the notice naming the constraint, one basis at two aims, seek equals play, no notice on an ordinary aim |
| AC4 `#492.f704c8e6` | `reference-values.test.ts` (2) | one document at 300 seeded times: OKLab per component, angle the short way (with Godot's cases), right-continuous jump, hold_at remap, stagger of lag 0.5; seek equals play at 80 of them |
| AC5 `#492.77bbe5c2` | `clip-mapping.test.ts` (5) | 12 placements against the same keys as a document channel at the mapped time, bit for bit; Unreal's frame 13 → 20 and 21 → 6; a replace and two adds of distinct contributions; 40 frame rates round-trip, kΔ reading k and kΔ − 1 reading k − 1; the answer's hash the same for 0, 40 and 40 reversed frames, and different for an edited document |
| AC6 `#492.853d06ee` | `nesting.test.ts` (3) | look then placement: 0.125 s at 0.2 s, and 0 at 0.13 s (fails the reverse order, and a dropped look); remap then repeat: 0.2 s at local 0.6 s among four reads; Unreal's frame 21 → 6 through a remap |
| AC7 `#492.5ffc89bd` | `refusals.test.ts` (1) | reverse over a driver reading a control refused, naming `rv` and `knob`; the half-rate twin accepted and reading half time; the same reverse with no read accepted. The world clause is out of reach (below) |
| AC8 `#492.7d21a76a` | `refusals.test.ts` (4) | channel + placement, two drivers, and channel + status binding each refused naming both, each with an accepted twin; two writers' mix placements read their closed form |
| AC9 `#492.181f2b27` | `add-placement.test.ts` (3) | 200 seeded times within 1e-6 of walk · nod_ref⁻¹ · nod(τ), a first key that isn't the identity (fails a skipped reference); bit for bit the walk alone while the nod sits at its first key; half the nod's angle within 0.01° at influence 0.5 |
| AC10 `#492.102b52ef` | `long-span.test.ts` (2) | 60 reads a day in, bit for bit; the plant reads exactly 0.015625 at k = 1 and the check names `tile` and k |
| AC11 `#492.2a883e4b` | `replay.test.ts` (2) | child time and `.active` at 11 times, through both occurrences; the plant reads 4 at 5 s and 5.5 at 5.5 s and fails |
| AC12 `#492.0458de19` | `shorter-arc.test.ts` (3) | bound and end of a fade over an exact negation and over a near negation; the midpoint at influence 0.5; keys q, −q; each plant fails naming `arm` and 1 s |
| AC13 `#492.4cc26973` | `replace-keeps.test.ts` (3) | fixture `parity/animation/replace-keeps-unkeyed.film`: x and `visible` keep A's end values bit for bit under B, B writes y; the plant reads 100 and fails naming both paths; Blender's strip cases. Corpus clause out of reach (below) |
| AC14 `#492.9a173ea6` | `ramp-hold.test.ts` (3) | the four child times, three rates, equal at 24, 60 fps and by seek; the plant at both rates, naming `slow`; hold_at's child and rate |
| AC15 `#492.4f0f9de3` | `hitstop.test.ts` (3) | each `then`: the issue's reads, equal at 24, 60 fps and by seek, `.active` inside and outside each hold; the plant holds 1.860 s and fails naming `stop` and 2.14 s |
| AC16 `#492.f894a6dc` | `taste.test.ts` (1) | reads the record only; no pictures or no call is INCONCLUSIVE, never PASS (The taste call) |

## Choices where the issue is open

1. **Surface.** Everything is read through `deep-motion eval`. No new binary or subcommand; the new outputs are the two frame
   fields above, chosen beside `placements.<id>` and `t`, which the base already reports.
2. **Child time** is read as a value: `RULER` is a clip whose x equals its own time, so an item's x is the child time and its
   `.rate` the child's rate. No test reads `placements.<id>.local`, whose meaning under a remap the design doesn't fix.
3. **The bone.** No crate reaches a skinned bone through `deep-motion`, and the base's `at.rot` is three Euler angles, so a
   rotation under test is a `quat` channel on an item's `params/quat`, whose authored value is the base ("the item's authored
   param"). Item `arm`, or `head`, stands for the bone the criteria name; the math is the same, and the plants name it.
4. **Placement `hold_at`.** The design gives only the field, `hold_at: flick | none`. Read one way it freezes the clip at that
   local time throughout, another way it runs up to it and holds; the two agree once local time has reached it, so AC2 and AC5
   read only there.
5. **`reverse` on a placement** reverses over the placement's span, the clip's 4 s here (the base's reverse, on a recipe
   instance, uses the document's span, the one span it has).
6. **The ramp's rate before `at`** is `from`, and it is what gives the issue's 2.88 s at 1.2 s (2.4 × 1.2).
7. **`switch`.** The design's `switch: {span, ease | spring, sync}` names no control and no cases, so the tests write it on each
   case's placement with `control` and `case`. "Weigh newest first" is read as: with mᵢ = ease((t − tᵢ) ÷ span), the newest takes
   m₃, then (1 − m₃)·m₂, then (1 − m₃)(1 − m₂)·m₁, and the first choice what is left. The four cases mix over a base of 0, so each
   of four paths reads one weight.
8. **"Fixed fallback basis".** Neither the issue nor the design gives the basis, so its values aren't pinned: finite, no earlier
   frame read, and the same bits at two up-parallel aims of different lengths. A zero aim and an up-parallel aim may differ.
9. **`look_at_degenerate`** is read in the answer's `notices`; the design doesn't name the notice. A test twin shows an ordinary
   aim raises none.
10. **"Its target's driver"** (AC7): a placement has no driver of its own, so it is a driver on the item the placement binds.
11. **A second writer's refusal** pins no code, and names IDs: `chan-x` and `place-x`, `drive-a` and `drive-b`, `tint-fill` and
    `dot-state`. A placement and one driver on a path stay accepted ("then at most one driver").
12. **AC12's exact negation.** q and −q are one rotation, so the angle between them is 0 and the shorter-arc midpoint is q. Taken
    alone, such a fixture has a per-component blend read (2w − 1)·q, the same rotation at every weight but 0.5. So the tests also
    run a base that is the negation of a rotation 60° from the clip's, which is what the bound and the midpoint can fail on.
13. **The fade's shape.** `fade_in` is a flick and nothing states its curve, so only the bound, a move under way at mid-fade and
    the end are read; the midpoint reads `influence: 0.5`.
14. **`in`, `rate` and span.** `span: auto` under `in` or a rate isn't defined, so those cases write `span`.
15. **The modifier's jump.** "Steps time on its hz grid by the same rule": none and both need a segment of n steps, and an open grid
    has none, so the modifier is read at start and end only. All four are read through the key form.
16. **Blender's end flick.** Its strip end is inclusive, Placement's span is [start, start + span), so `4.0 → 4` on a lone strip isn't
    ported.
17. **`.active` at a hold's end flick** isn't settled by "inside the holds", so `.active` is read inside and outside, not on it.
18. **"Same at 24 and 60 fps"** is the same flicks evaluated in documents at those `frame_rate`s, compared bit for bit.

## Criteria out of reach

- **AC7's "its target reads a world that takes inputs".** No crate at the base builds a `physics.world@1`, and #492 depends on no
  physics issue. A test needs a document form for a world with inputs, and a read of it from a placement's item, in `deep-motion`'s
  check. `refusals.test.ts` tests the control clause; the world clause stays open, and the PR should say `Part of #492` for it unless
  it is reached otherwise.
- **AC13's "the fixture joins the migration corpus".** `deep-show` has `corpus_record` and a kit `corpus` argument, but the repo commits
  no corpus folder for a test to look in. `fixtures/parity/animation/replace-keeps-unkeyed.film` is the fixture to record; a test needs
  the folder's path.
- **AC16's "taken by the check run from the canvas's own frames" and "attached to the PR and shown to you".** `taste.test.ts` reads
  what is recorded and can't see how a picture was made or where it was shown. The test holds INCONCLUSIVE until the record exists.

## The taste call

The check run writes eight files to `docs/evidence/492/`: `mix-placement`, `add-placement`, `quantized-channel` and `time-remap`, each
as `.png` (a screenshot) and `.apng` (a recording). The owner's one call goes in `tests/acceptance/492/TASTE.json`, as in #430 and #446:

```json
{ "issue": 492, "criterion": "#492.f894a6dc", "verdict": "looks_right", "who": "…", "when": "2026-11-06T09:00:00Z",
  "screenshots": { "mix-placement.png": "<sha256>", "…": "…" }, "note": "…" }
```

`verdict` is `looks_right` or `looks_wrong`, `screenshots` names all eight with their SHA-256. How the frames are drawn is the
implementer's: `deep-motion` draws nothing. No test judges a picture.

## What the base already does and these tests don't credit

`deep-motion eval` places clips through slots with `start`, `after`, `repeat` in wrap mode, `extend` and `stagger`, runs
replace placements, reverses a recipe instance, reads occurrence lists, and reports a document's hash. It ignores a placement's `in`,
`span`, `rate`, `hold_at`, `quantize`, `blend`, `influence`, `fade_in`, `layer`, `order` and `switch`, and the look's
`quantize_hz`. It refuses `ping_pong`, `quat` and `angle` channels, a quantize key or modifier, every remap but `reverse`, and
`<remap ID>.active`. It raises no second-writer or status-binding refusal, no `look_at_degenerate`, and reports no `.rate` under a
placement and no `frame`.

So 38 of 42 tests fail at the base, on their assertions (`BASE-FAILURE.txt`). 4 pass, because the issue also
asks to keep what the base has right: AC5's unchanged hash (an edited document changes it), AC10's read a day in and AC13's held values
(each with a planted twin that must fail the same check), and Blender's strips.

## Scope not under a criterion

The issue's Scope and Fields also name: times written relative to a marker, a spoken word or a record event; the one transition
primitive, mattes and the text animator; `start_on`; stagger `reverse`, `seeded` and `reverse_on_close`; `add_from: bind` and `t`;
`multiply`; `fade_out`; the ramp's other eases; hitstop's `on:` and a match during a rejoin; two matches on one flick; `switch`'s `spring`
and `sync`; a refused `n`; replay on `document`, `.progress`, `scrub` and `clamp`. No criterion states an observation for them, so these
tests don't check them; they are follow-ups for the implementer's own tests.

## Upstream tests (the Oracle lane)

The page maps upstream tests to criteria 2, 4, 5, 6 and 13 and says none runs as it is on our output, so each is restated here against
`deep-motion` (#136: a linked test counts only when run against our output).

| Criterion | Upstream, pinned | Use here |
|---|---|---|
| 2 | WPT `2f57f45d21` `css/css-easing/step-jump-{start,end,none,both}.html` | ported: steps(3, jump-*) over 3 s at 0, 0.9, 1.0, 1.9, 2.0, 2.9 s as progress; its 3.0 s row reads the element's base width once the animation has ended, which has no counterpart |
| 2 | Bevy `12a94e0cd6` `crates/bevy_curve/src/easing.rs` | formula: the same four step rules; its ease identities are #490's, not read here |
| 4 | Godot `ed1daf0bf0` `tests/core/math/test_math_funcs.cpp` | ported: four `lerp_angle` cases; two ties on half a turn and one extrapolation left out |
| 4 | color `38280797d1` `color/src/dynamic.rs` | formula: OKLab mixes per component |
| 5 | Flicks `6d6362fb77` `flicks_test.cpp` | ported: the whole-flick rule, Δ × p = 705,600,000 × q, over the design's valid rates |
| 5, 6 | Unreal `396c9f0599` `MovieSceneTransformTests.cpp` | ported: "Sub-sequence at 3, playing at x2" with a 0 to 30 loop, frames 13 → 20 and 21 → 6, by a placement rate and by a remap |
| 13 | Blender `0a18557098` `tests/python/bl_animation_nla_strip.py` | ported by value, needing no Blender: `test_extrapolation_nothing` and `test_second_above_first`, but for the end flick (Choices 16) |

`BASE-FAILURE.txt` is the run at the base.
