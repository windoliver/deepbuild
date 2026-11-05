# Acceptance tests for #489: motion module motion@1, channels, keys, drivers, follow channels and constraints in closed form

Written first, from issue #489 (its Scope, its Fields, its twelve acceptance criteria and its Proof line: "Channel
and spring fixtures against their f64 references, the constraint kit with its planted kinds, and the timings"), its
Oracle page (`doneright/oracles/issues/489.md` in `DeepBuildAI/deepbuild`, branch `doneright`), the design sections
it names and those they lean on, and base commit `692cc5cd` ("Merge pull request #1132 …"), by a job that never saw
an implementation; none existed, and no other worktree or branch was read. The implementing agent doesn't edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue, read live with `gh issue view 489 --repo windoliver/deepbuild`, and its Oracle page (criterion 9 maps
  Unreal `396c9f0599`'s `Engine/Source/Runtime/AnimationCore/Private/TwoBoneIK.cpp`, "formula" use: an
  implementation, not a test; every other criterion has no upstream test).
- `docs/canvas-primitives.md` at the base: Time and the flick; Registry and seal, its registries subsection
  (1037–1100); Registries and closed lists (1244); The order of one evaluation (5079); Transport (5091: `loop`,
  `reduced_motion: hold | slow`, "Under reduced motion … with `hold`"); Channel and key (5261) and its quantize jump,
  auto tangents and cycle offset, and table eases subsections; Follow (5331); Driver (5347) with time offsets and
  tables; Constraint (5401) with bones, spring chain and rest_on; Control (5474: `kind`, `class`, `label`, `range`,
  `default`); Input track (5706: entries, "A seek or a scrub only moves the playhead … the track's hash is
  unchanged").
- `docs/technical-design.md`: Films and figures on the canvas; the canvas core and its module table (the motion and
  data rows); Dogfooding; Tests written first; the "Who drafts it" paragraph.
- At the base: AGENTS.md; `crates/deep-canvas-motion` (`src/main.rs`, the `deep-motion` CLI: `eval`, `insert`,
  `run`; `src/doc.rs`: documents, channels, keys, `drivers`, `constraints` with `limit`, `parent`; `src/eval.rs`,
  `src/program.rs`, `src/curve.rs`); `crates/deep-show` (`src/main.rs`: `run`, the calls, `start_args` and
  `planted_named` with #221's `relation_iterates_to_convergence`, the build sets and `test-*` features, the
  `seal_refused` line); `crates/deep-canvas/src/registry/core_lists.rs` (`constraint@1`, its five kit rules,
  `RELATION_CYCLE`), `registry/lists.rs` (the seal's `kit_admits_planted`, `entry_refused`);
  `crates/deep-canvas-marks/src/relations.rs` (how #221's relations fill `constraint@1`, with fixtures the kit reads);
  `packages/contracts/canvas-registries.json`; the earlier blind suites `tests/acceptance/488/`, `221/`, `391/`,
  `387/`, `411/` (drivers and limit constraints), `185/` (`schedule.interfaces`), `200/` (registries).
- Probes of the base build (`deep-show run` with `registries` and `schedule`; `deep-motion eval` on a parented
  channel document) to learn the shapes those calls already answer.

## Run

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/489 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/489/tsconfig.json   # type-check (exits 0)
```

`--root` keeps the repo's `vitest.config.ts` out (at the base it imports workspace packages that `npm ci` doesn't
build); a root with no config of its own uses Vitest's defaults. It leaves Vitest's cache in
`tests/acceptance/489/node_modules/.vite`; delete it, it is not part of the suite.

Each file builds what it drives once, in `beforeAll`, and copies it out under its own name: `cargo build --locked
--bin deep-motion` (every file), and `constraint-kinds.test.ts` also `cargo build --locked --bin deep-show
--no-default-features --features full` and `… --features full,test-leave-out-data`, honoring `CARGO_TARGET_DIR`.
Every test of a file fails when its build fails. The files build cargo binaries, so they run one at a time:
`scripts/lanes.mjs` needs `'tests/acceptance/489/'` added to its `alone` list (this job writes only this folder;
the implementer makes that edit). Every `it` passes `TIMEOUT` (30 min). Evidence folders go under the OS temp folder
and are deleted. Node built-ins and vitest only.

## The surface under test

The issue names motion's fields but no code API, so these tests extend the surfaces #391 (`deep-motion`), #200,
#185 and #221 (`deep-show run`) left, add no binary and no subcommand, and read nothing else. **Every name below that
the issue or design doesn't give is this job's choice** (each is listed again under Choices), the smallest surface
consistent with the design and the base; the implementer builds exactly these, or a dispute goes to a blind redraft.

### `deep-motion eval` (#391's JSON-lines convention, unchanged)

Input `{"doc": Document, "times": [flick], "planted"?: name, "view"?: {"reduced_motion": bool}, "input"?: [entry],
"unwrap"?: bool, "timing"?: bool}`. Output `{"ok": true, "order"?: [string], "frames": [Frame]}` or a refusal
`{"ok": false, "code": string, …}`, which may carry more fields (`path`, `ids`, a peak); the tests read a refusal's
`code` and search its whole JSON for the IDs and numbers it must name. New on the input line:

- `planted`: one of the planted programs below; any other value is `bad_input`, as at the base.
- `view.reduced_motion: true`: the viewer prefers reduced motion, so the document's `transport.reduced_motion`
  rendition applies (`hold` here).
- `input`: input-track entries `{t: flick, seq, control: ID, value, writer: "you"}` appended to the core's input
  track before the first frame (Input track: entries).
- `unwrap: true`: the times are timeline positions, read as given, the loop not applied (`doc_t = t`), so a channel
  can be read at the span's end "before the wrap" and past it.
- `timing: true`: each frame is `{t, eval_ms}` and nothing else, `eval_ms` the binary's own wall time for evaluating
  that frame (the document compiled before the first frame; JSON reading and writing outside it).

New in a frame (beside #391's `t`, `doc_t`, `items`, `channels`, `placements`, `valid_until`):

- `items.<id>.at.{pos, rot, scale}`: as at the base, the item's evaluated world transform (parents applied), now
  after its drivers and constraints; `rot` in degrees, as the base's `limit` bounds.
- `channels.<id>`: `{value, …}` as at the base, plus `rate` and `integral` for a follow channel that lists them in
  `outputs`, and for a follow channel on a control, `segments` (segments cached) and `solves` (segment solves so far
  in this eval line).
- `constraints.<id>`: `{ops: n, scale?: number}` for every constraint, `ops` the solve's op count at this frame;
  `scale` for reach2, the factor both bones were scaled by.
- `input`: `{hash: hex string, entries: n}`, the input track's hash and entry count at this frame, on a line with
  `input`.

New in the answer: `order`, the evaluated components in the order they run, each `<item>.<component>` with
component `channels`, `driver`, `transform` or `constraints` (others may appear; the tests filter to these).

### Documents

#391's envelope (`{format: 1, id, profile: "film", title, description, size, transport, items, channels}`, items
`{id, kind: "rect@1", name, order, params, at, parent?}`), with #411's `drivers` and `constraints` maps, and the
issue's fields as canvas-primitives spells them:

| Field | As the tests write it |
|---|---|
| Spring key | `{t, value, interp: {spring: {decay, omega}} \| {spring: {freq_hz, damping_ratio}}, velocity}` |
| Auto key | `{t, value, interp: {auto: {clamp: true}}}` |
| Hard range | channel `range: [min, max]` |
| Modifiers | channel `modifiers: [{wave: {amplitude, per_loop}} \| {noise: {amplitude, per_loop, seed}}]`; a wave reads amplitude·sin(2π·n·t ÷ span) |
| Follow channel | `{target, type: "f32", mode: "follow", follow: {source: {keys: {ID → {t, value, interp: "hold"}}} \| "controls/<id>/value", model, outputs?}}` |
| Follow models | `{spring: {freq_hz, damping_ratio}}`, `{first_order: {tau_up, tau_down}}`, `{rate_limit: {max}}`, `{transition: {span: 0.2, interp: {ease: {name: "out_cubic"}}}}` (seconds as numbers, as `tau: s`) |
| Control | `controls: {knob: {kind: "slider", class: "document", label, range, default}}` |
| Opacity | channel target `items/<id>/adjust/opacity` |
| Driver | `drivers: {ID → {target, expr, vars: {name → path}}}`; `items/<id>/world/pos/<k>` reads the item's evaluated world position after its constraints |
| Constraint | `constraints: {ID → {owner, kind, …the kind's fields}}`: `child_of {parent}`, `look_at {target, axis}`, `copy {what, target}`, `limit {what, bounds}`, `distance {target, min, max}`, `reach2 {chain: [upper, lower, end], target, bend, stretch: "cartoon"}` |
| Constraint target | an item ID reads that item's evaluated world pose (after its driver and constraints); the path `items/<id>/at/pos` reads its position as its channels write it |

### `deep-show run` (`constraint-kinds.test.ts` only)

- `{"call": "registries"}` (#200): the `constraint@1` row lists motion's ten kinds as entries `{name, module:
  "motion", origin: "first_party", since, digest, kit: {verdict: "PASS", rules: [one PASS per kit rule]}}`.
- `{"call": "schedule"}` (#185): `interfaces["motion@1"].digest`, equal in `full` and `full,test-leave-out-data`;
  `interfaces["data@1"]` present in the first and absent in the second.
- Startup `--planted constraint_iterates_to_convergence` and `--planted constraint_reads_previous_output`: motion's
  constraint entries solved by a planted program (one whose op count varies with its input as it iterates to
  convergence; one that reads its own output from the previous frame). The seal refuses each: exit 2, one line
  `{"ok": false, "code": "seal_refused", "reason", "registry": "constraint@1", "entries": [...], "modules": [...]}`
  whose `entries` name at least one of motion's ten kinds and whose line names the module `motion`.

### Planted programs

| Name | Where | Criterion | The wrong program |
|---|---|---|---|
| `constraint_iterates_to_convergence` | deep-show startup `--planted` | 1 | a constraint kind that iterates to convergence, its op count varying with its input |
| `constraint_reads_previous_output` | deep-show startup `--planted` | 1 | a constraint kind that reads its own output from the previous frame |
| `follow_steps_from_previous_frame` | eval `planted` | 6 | a follow channel stepping from the previous frame's value instead of its closed form |
| `schedules_whole_items` | eval `planted` | 7 | a scheduler that orders whole items, not components |
| `spring_drops_velocity` | eval `planted` | 10 | a spring key that ignores `velocity` |
| `per_loop_rounds_period_to_flick` | eval `planted` | 11 | per_loop with its period rounded to a whole flick first |
| `transition_restarts_from_old_target` | eval `planted` | 12 | a transition that restarts from the old target, not from where the value is |

### Test features of deep-show

`test-leave-out-data`: the full build set without the data module (as #388's `test-leave-out-look` and #403's
`test-leave-out-logic`), so motion's interface digest can be compared with and without it.

## Criteria to tests

Each test's name starts with `criterion <n>`.

| Criterion | File | What it asserts, and the wrong program each fails on |
|---|---|---|
| 1 | `constraint-kinds.test.ts` (5) | constraint@1 is the core's, filled by modules; motion's ten kinds are motion's first-party entries, each PASS on every kit rule, and motion fills no `follow_stream`. Both startup plants are refused at the seal naming constraint@1, motion and a motion kind (fails a kit that admits them, a plant motion never reaches). motion@1's digest equal with and without data (fails a digest that hashes the data module's kinds). On this suite's fixtures of child_of, look_at, copy, limit, reach2 and distance: 50 seeded times seeked equal played bit for bit, `ops` one value at every time, the owner's pose changes (fails a cache, a loop, a constraint that does nothing); two-item cycles through child_of, look_at, copy and distance refused with a code containing `cycle`, naming both items |
| 2 | `frame-rates.test.ts` (1) | a rig of Bézier, auto, spring-with-velocity keys, a follow spring, a transition, a driver, look_at and reach2, played on its own frames at 24 and 60 fps: at the 48 shared times every item's `at` and every channel equal, bit for bit (fails any per-frame step) |
| 3 | `follow-exact.test.ts` (2) | first_order (value, rate, integral), rate_limit and spring (value, rate) on a stepping source: 200 random times read the same along a straight play, a backward play, a shuffle, a scrub and cold seeks, bit for bit; and equal the closed forms computed here (RK4 for the spring) within 1e-9 relative (fails integration between frames, a cache keyed by frame) |
| 4 | `auto-tangents.test.ts` (2) | 10,000 random times stay within each span's key values (fails unclamped Catmull-Rom or cardinal handles: the 10 → 10.5 plateau overshoots); every key read exactly; the curve isn't linear; moving k5 changes spans k4 → k6 and leaves spans k0 → k3 and k7 → k9 bit for bit (fails a global spline) |
| 5 | `springs-rk4.test.ts` (3) | follow springs on a four-step source and spring keys from rest, ζ 0.3, 1 and 2.5, against RK4 at 1 µs within 1e-6 relative at 1,000 seeded times; the critically damped ones never pass their target at 1,000 seeded times and every 1/600 s, and nearly reach it |
| 6 | `input-track-scrub.test.ts` (3) | 12 appended entries, 50 scrub passes: every scrubbed frame reads the straight play's value bit for bit; the track's hash and 12 entries never change; the cached segments never drop, never re-solve and end equal to the straight play's; the planted stepper fails, naming `dial`, with a difference after the first backward pass |
| 7 | `evaluation-order.test.ts` (4) | the first pair is accepted, `order` filtered is exactly `knob.channels, gauge.transform, gauge.constraints, knob.driver, knob.transform`, A's driver writes 0.5 × B's x, B is turned toward A's channel-written position; seek equals play at 50 times; the second pair is refused `cycle` naming `knob` and `gauge`; `schedules_whole_items` refuses the first pair as `cycle` and fails the first check |
| 8 | `budgets.test.ts` (2) | the slowest of 10 cold seeks on a 600 s film (20 follow channels of 6,000 source steps, 20 keyed channels of 600 keys) under 50 ms; the median `eval_ms` of frames 10–69 of a 10,000-item play under 2 ms; five fresh processes each, judged; **INCONCLUSIVE off the reference Mac** |
| 9 | `reach2-stretch.test.ts` (3) | at 400 random times: `scale` = max(1, d ÷ 100) within 1e-12 relative, the tip on the goal and the bones s·60 and s·40 long within 1e-9, in and out of reach; one op count at every time (fails CCD, FABRIK); the elbow on one side of root → goal for bend 1 and the other for bend −1 at every time, across hold jumps that mirror the goal, and seek equals play (fails a side kept from the previous frame) |
| 10 | `spring-velocity.test.ts` (6) | the issue's three closed forms within 1e-12 at 1,000 seeded times; the peak 1.2808 at 0.1822 s; [0, 1.25] refused naming `grow` and 1.2808 while [0, 1.3] passes; 0.7374 and 0.9631 at 0.1 s; RK4 within 1e-6 relative under-, critically and over-damped with velocity; seek equals play; `spring_drops_velocity` reads 0.7374 and fails naming `grow` |
| 11 | `per-loop.test.ts` (4) | the four waves within 1e-12 of their sum of sines at 1,000 seeded times, and a loop later the same; noise at 4.7 s (unwrapped) within 1e-9 of its value at 0, its central-difference slope (h = 1 ms) within 1e-9 of the slope at 0; `per_loop_rounds_period_to_flick` is 7.4e-9 off the first wave at 4.7 s and fails naming `first`; per_loop on `loop: none` refused naming the channel (waves and noise) |
| 12 | `transition.test.ts` (5) | 17 at 1.0 s, 43.25 at 1.1 s, 47 from 1.2 s; with the second entry 43.25 at 1.1 s, 20.28125 at 1.2 s, 17 from 1.3 s; both at 1,000 seeded times against v0 + (v1 − v0)·out_cubic(u); seek equals play at those times; under reduced motion the knob 47 from 1.0 s, the opacity 0.875 at 1.1 s (and without it the knob plays); the planted restart reads 43.25 just before 1.1 s and 47 at it, failing naming `kx` and 776,160,000 |

## Choices where the issue is open

1. **Surfaces.** Channels, follow channels, drivers and constraints are read through `deep-motion eval` (#391's proof
   binary for motion), the registry, seal and interface digest through `deep-show run`. Neither new subcommand nor
   new binary.
2. **Spring key velocity** is a key field `velocity` beside `t`, `value` and `interp`, a number in value per second.
3. **Spring key segments** run to the next key, as at the base; the tests put the next key 2 s (criterion 10) or 3 s
   (criterion 5) later and sample inside the segment.
4. **The hard-range refusal**'s code is not read; it must be a refusal whose JSON names the key and a number within
   5e-5 of the peak.
5. **Wave**: amplitude·sin(2π·per_loop·t ÷ span), phase 0 and offset 0 by default, on a channel whose one hold key
   is 0, so the channel reads its modifiers' sum.
6. **"At 4.7 s, before the wrap"** is read with `unwrap: true`, the times as positions with no loop applied; the
   central-difference slope uses h = 1 ms on both sides of 4.7 s and of 0. The noise's own values are not pinned
   (lattice noise with that period and seed), only its seam and that it moves.
7. **"Naming the channel"** for per_loop on `loop: none` is the refusal's JSON holding the channel's ID.
8. **Follow channels** start at rest on their source's value at the document's start, their integral 0 there; a
   keyed source is `source: {keys}`, each key held; `tau_up` applies while the value rises toward the target and
   `tau_down` while it falls; `rate` is the derivative and `integral` the running integral from 0.
9. **Model parameters in seconds** are numbers (`tau_up: 0.2`, `span: 0.2`), as the Follow fields write `tau: s`.
10. **Criterion 12's opacity channel "on the same source"** follows the same toggle: its source changes from 0 to 1
    at the same flick, 1.0 s, with the same transition; so 0.875 = out_cubic(0.5).
11. **Reduced motion** is the eval line's `view: {reduced_motion: true}` (as deep-show's `eval` view input) with the
    document's `transport.reduced_motion: "hold"`.
12. **The input track** is the eval line's `input` (entries appended before the first frame, writer `you`), read
    back as `frame.input: {hash, entries}`; a follow channel's cache as `segments` and `solves`; "keeps its cached
    segments" is read as: the count never drops, no segment is solved twice in the line, and the scrub ends with the
    straight play's count.
13. **Criterion 7's paths**: A's driver reads `items/gauge/world/pos/0` (B's evaluated world position, after its
    constraints); "B's look_at targets A's transform" is `target: "items/knob/at/pos"` (A's position as its channels
    write it, which A's driver doesn't write); "B's constraint reads A's world pose" is `target: "knob"` (the item:
    its evaluated world pose). The order is the answer's `order`, filtered to the two items' channels, driver,
    transform and constraints. look_at's turn is checked by magnitude, |rot.z| = |atan2(dy, dx)| in degrees, so no
    sign convention is pinned.
14. **Criterion 1's cycle code** is any code containing `cycle` (the base's `relation_cycle` and `parent_cycle`, the
    issue's `cycle`), naming both items; criterion 7's is exactly `cycle`, as the issue writes.
15. **Criterion 1's fixtures** are this suite's for the six kinds whose fields the design gives in full (child_of,
    look_at, copy, limit, reach2, distance); follow_path, follow_tip, spring_chain and rest_on need paths, pens,
    bones and 3D shapes whose document forms are other issues', so those four are held by the registry listing's kit
    results alone (each entry's own fixture, as #221's relations).
16. **The planted kinds' names** (`constraint_iterates_to_convergence`, `constraint_reads_previous_output`) follow
    #221's startup names; which motion kinds the plants replace is the implementer's, as long as the refusal names
    one.
17. **reach2** is `{owner: "upper", chain: [upper, lower, end], target, bend: 1 | -1, stretch: "cartoon"}` on a 2D
    chain of parented items; the elbow is `lower`'s world position and the tip `end`'s; `constraints.<id>.scale` is
    the stretch factor; "exactly" is 1e-12 relative on the factor and 1e-9 on positions of order 100, since the
    positions go through trigonometry.
18. **Op counts** are `constraints.<id>.ops` per frame.
19. **Timing** (`timing: true`, `eval_ms`) is the binary's own measurement, as #387's `scheduler_ms`; a seek is a
    fresh eval line with one time.
20. **The reference-Mac gate** is #387's (Mac15,7 or Mac15,12, Low Power Mode off, no thermal warning) without its
    mains-power condition (the owner's standing rule never to wait for mains power).
21. **Relative tolerances** (1e-6 against RK4) are taken against |RK4|; the documents keep values above 9 or start
    the seeded times 1 ms after a segment starts, so no comparison is made near zero.

## Criterion 8: verdicts only in the local preflight

`budgets.test.ts` gives PASS or FAIL only on a reference Mac in a fit state, which is how the local preflight runs it;
anywhere else each test first reads the budget once (so a missing surface still fails on its assertion), then skips
with a message starting `INCONCLUSIVE`, never passing. "Compared with the merge base" is the preflight's perf lane:
at the merge base these documents are refused (no follow channels, auto keys or velocity), so there is no base
timing for this suite to read; the tests judge the issue's absolute budgets.

## What the base already does and these tests don't credit

`deep-motion eval` evaluates linear, hold, Bézier and spring-from-rest keys, `drivers` and `limit` constraints, and
`parent`; a spring key from rest toward the next key is the base's (#391), so `springs-rk4.test.ts`'s spring-key
test may pass at the base: it holds that behaviour under the new criterion's RK4 bound, and the follow-spring and
no-overshoot tests carry the criterion's new part. `deep-show` already lists `constraint@1` (#221's four relations
and the core's planted entries, which the base kit refuses) and publishes `schedule.interfaces["motion@1"]`. None of
motion's ten kinds is an entry, there is no follow channel, no velocity, no auto tangent, no per_loop, no transition,
no input track on `eval`, no `order`, no `constraints` report and none of the plants.

## Scope not under a criterion

The issue's Scope also names: motion@1's kit refusing a planted bit implementation one ulp off in in_out_cubic at
one sample, and a release build refusing it; skin's bone forms, marks2d's relations and the data module's
`follow_stream` as other modules' entries; text animators, counters and controls as other modules'; table eases;
quantize jumps; cycle_offset extrapolation; travel arcs and spirals; path keys and morphs; pulse modifiers; the extra
first-party eases; data-keyed channels; driver probes, time offsets and tables. No criterion states an observation
for them, so these tests don't check them; they are follow-ups for the implementer's own tests.

## Redrafts

- **Nov 2, `spring-velocity.test.ts`** (a dispute: its time literal was invalid). The first draft wrote the next
  key's time as `KEY_T + 2`, 2.2800000000000002 in f64, so `at(END_T)` gave `"2.2800000000000002s"`, which the time
  grammar refuses (at most five fraction digits: `bad_time` at `channels/sc/keys/rest/t`), and every test of the
  file would have stopped on that refusal. The redraft writes `END_T = 2.28`, the literal `"2.28s"`; its flicks
  (1,608,768,000) are what the first draft's rounded to, so the seeded times, every assertion and every expected
  value are unchanged. Re-run at the base in `BASE-FAILURE.txt` (its last section): all six tests still fail, on
  the refused `{decay, omega}` alias, and the base accepts `"2.28s"`. The redraft was written from the issue, the
  design and the base only, as the first draft was.

## Upstream tests (the Oracle lane)

The Oracle page maps one upstream file, for criterion 9: Unreal's `TwoBoneIK.cpp`, an implementation with no test.
Per #136 a linked test counts only by what it asserts on our output; it has no assertion, so its formula (law of
cosines, no iteration, both bones scaled by d ÷ (l1 + l2) past reach from a start ratio of 1) is what
`reach2-stretch.test.ts` asserts on our output. Nothing is ported for the other eleven criteria.

`BASE-FAILURE.txt` is the run at the base.
