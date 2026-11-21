# Acceptance tests for #2371: physics inputs past #522: set, activate, deactivate and blast, a poke's address, and force fields read from a channel or an input

Written first, blind, from issue #2371 as saved for this job on November 19, 2026 (its opening paragraph, Scope, three
acceptance criteria, Proof line and dependency; it has no comments and no Oracle line), the design's physics sections
and base commit `85203f458` ("Merge pull request #2852 …"), by a job that never saw an implementation or a diff of
one; no other worktree, branch, pull request or issue was read. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test per clause that
needs its own run, and one for the planted wrong program the first criterion names.

## Files, one per criterion

| File | Criterion | Tests |
|---|---|---|
| `ac1-track-replay-seek.test.ts` | `#2371.7fae183d`: a world with one input of each of `set`, `activate`, `deactivate` and `blast`, played from a track, gives the same step hashes on a replay and after a seek from a checkpoint; a second `set` on one step replaces the first; the planted `set` that applies both fails, naming the step | 3 |
| `ac2-poke-address-and-blast.test.ts` | `#2371.825e2c1b`: a poke by `address` gives the step hashes of a poke at that anchor's point; a blast with radius 1 m moves a body 0.9 m away and leaves one 1.1 m away at rest | 2 |
| `ac3-forces-channel-and-input.test.ts` | `#2371.aabc7fe9`: a drag whose medium reads a channel, a spring whose point reads a channel and a force whose strength an input sets each change the world at the step the channel or the input says; a seek from a checkpoint gives the straight run's step hashes | 2 |
| `helpers.ts` | the worlds, the runner and the judges, over `../1918/helpers.ts` (imported read only) | |
| `twins.json` | the first criterion's ID to its planted program | |
| `BASE-FAILURE.txt` | each file run once at the base | |

## What was read

- The issue as saved for the job (title, state and body), and its body alone for the criterion IDs, each worked as
  `scripts/proof-change.mjs`'s `criterionId` works it and found equal to the ID its tests carry. The job had no access
  to the issue tracker, so the epic #310 and the issues #97, #522, #164, #182 and #251 were not read; #522 is known
  here through its suite, its code at the base and its design sections.
- `docs/canvas-primitives.md`: Time and the flick; Units and axes; The path grammar; Channel and key; Input track; A
  timeline as data over a pinned backend; World and backend `physics.world@1` (its step order); Body `body@1`
  (`active`, `anchors`); Force; Input track entries; Occurrence list; Physics output; Checkpoint ring; Bake; Golden.
  `docs/technical-design.md`: The physics module (World; Joint and force; Soft body and checkpoint ring; Input,
  occurrence, output; Bake and golden); What done means, fixed at the start (Who drafts it; Proven on the base);
  Criteria to tests; Wrong programs; Dogfooding; Tests written first. AGENTS.md and CONTRIBUTING.md.
- At the base, for surfaces only: the suites `522/` (README, `helpers.ts`, `twins.json`, `BASE-FAILURE.txt`, ac1, ac4
  and ac5), `1918/` (README, `helpers.ts`, ac1 and its fixture), `2010/` and `2009/` (`helpers.ts`), `191/`
  (`helpers.ts`, and the kit's sensor fixture's `deactivate` in `crates/deep-canvas-physics/src/kit/sensors.rs`),
  `540/` (its README's lab world and `twins.json`), `2241/` (README, `helpers.ts`, `BASE-FAILURE.txt`, ac5) and
  `2239/` (README's sections, `twins.json`); `crates/deep-canvas-physics` (`doc/inputs.rs`, `doc.rs`'s force, body and joint-end readers,
  `track.rs`, its README's list of refusals); `crates/deep-physics-rapier` (`main.rs`, `planted.rs`, `runner.rs`,
  `runner/timeline.rs`, `scene.rs`, `channels.rs`, `inputs.rs`, `lib.rs`'s forces and step); `scripts/proof-change.mjs`
  (criterion IDs), `scripts/proof-runs.mjs` (`twins.json`), `scripts/lanes.mjs` (its `alone` list).
- The pinned backend's source in cargo's registry (rapier3d 0.36.1, the version `Cargo.lock` pins), only to see what
  the base's poke asks of it: an impulse at a point of the world, turned about the body's centre of mass; and how a
  body it disables and enables again is taken up by a step.

What the base already does, which these tests don't credit: `deep-physics` checks and bakes a world, alone or inside
a scene, on an input track (`track`), keeps a bake in a store, seeks over it from its ring's checkpoint, and takes
`--planted <name>`. Its reader takes a body's `active` and `anchors`, the forces `uniform`, `drag` and
`spring_to_point` with numbers (a `medium`, a `point`, a `strength`), and the inputs #522, #191, #182 and #251
brought; `deactivate` is one of them (#191), so the base already disables a body and its colliders on that input. A
poke at a `point`, or with none at the body's centre, runs (#522). The base refuses, each with `physics.unsupported`
naming #2371: the input kinds `set`, `activate` and `blast` (`inputs/<ID>/kind`), a poke's `address`, `radius` and
`falloff` (at the entry's field, `track/<i>/address`), a drag `medium` and a `spring_to_point` `point` that are
strings (`forces/<ID>/kind/medium`, `forces/<ID>/kind/point`), and a `strength` that isn't a number
(`forces/<ID>/strength`). It knows no planted program of this suite's name.

## Run them

```sh
npm ci                          # once, if node_modules is missing
# the build first, through the one build slot:
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node scripts/throttle.mjs build --wait 600 -- nice -n 10 sh scripts/lease cargo build --locked -j 6 --bin deep-physics
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node scripts/throttle.mjs test --wait 120 -- node node_modules/vitest/vitest.mjs run --root tests/acceptance/2371 \
  --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2371/tsconfig.json     # type-check
rm -rf tests/acceptance/2371/node_modules                                       # vitest's cache
```

Each file builds `deep-physics` once, in `beforeAll` (#2009's `prebuild`: `cargo build --locked --bin deep-physics`,
honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set, Homebrew's rustup
put on PATH when present), and copies the binary into a temporary folder; with the build already in the target folder
that call only brings it up to date. The planted program runs on the same binary. Every test passes #2009's 60-minute
timeout, and the build hook the same. Node built-ins and vitest only, no network. No process is started but `cargo`
and `deep-physics`, each waited for; none is stopped by name or port. No cargo on the machine fails the test with
`BLOCKED:` (#2009's helper), a `deep-physics` that can't be started with `BLOCKED:`, one that doesn't finish in 55
minutes with `INCONCLUSIVE:`; nothing unrun passes. The stores of the two seek tests and the copied binary are
temporary and removed when each test or file ends. No test times anything, so none depends on the machine or its
load.

## The surface under test

The issue names the input kinds and their fields, a poke's `address`, the three force fields, step hashes, a replay, a
seek from a checkpoint and one planted wrong program. It names no call and no flag, and the design gives several of
the fields no type. These tests drive `deep-physics` as #522's and #1918's suites left it: one JSON object per stdin
line, one reply line each. **Bold** marks what this job chose, the least the criteria need; the implementer builds
exactly these, or a dispute goes to a blind redraft. Everything else is the base's and must stay as it is.

### The world document (`physics.world@1`, as the base's reader takes it)

| Field, as the tests write it | Whose word | Example |
|---|---|---|
| `bodies.<ID>.active: false` | the design's (Body `body@1`); the base reads it | `"sleeper": {"kind": "dynamic", …, "active": false}` |
| `bodies.<ID>.anchors: {name → local point, m}` | the design's; the base reads it | `"anchors": {"rim": [0.25, 0, 0]}` |
| `forces.<ID>.kind.drag.medium`: **a channel path, a string** | the design's `medium: m/s \| channel`; the path form is #1918's (`follow`, a motor's `target`) | `"breeze": {"kind": {"drag": {"linear": 2, "medium": "items/wind/at/pos"}}, "applies_to": ["leaf"]}` |
| `forces.<ID>.kind.spring_to_point.point`: **a channel path, a string** | the design's `point \| channel`; the same path form | `"tether": {"kind": {"spring_to_point": {"point": "items/anchor/at/pos", "hz": 1, "damping_ratio": 1}}, "applies_to": ["bob"]}` |
| `forces.<ID>.strength`: **the ID of a `set` input the world declares, a string** | the design's `strength: number \| input`; that the input is named by its ID is this job's | `"push": {"kind": {"uniform": {"accel": [2, 0, 0]}}, "applies_to": ["puck"], "strength": "throttle"}` |
| `inputs.<ID>`, kind `set` | the kind and its fields `path` and `value` are the design's (`set {path, value}`); **its target a force's ID, its `path` the word `strength`, its `value` a number** are this job's | `"throttle": {"kind": "set", "targets": ["push"], "path": "strength", "value": 0}` |
| `inputs.<ID>`, kind `activate` | the design's | `"wake": {"kind": "activate", "targets": ["sleeper"]}` |
| `inputs.<ID>`, kind `deactivate` | the design's; the base runs it | `"halt": {"kind": "deactivate", "targets": ["faller"]}` |
| `inputs.<ID>`, kind `blast` | the kind and its fields `at`, `radius` and `impulse_per_length` are the design's; **`at` a point of the world `[x, y, z]` in m, `radius` in m, `impulse_per_length` a number, `falloff` left out** are this job's | `"boom": {"kind": "blast", "targets": ["far", "near"], "at": [0, 0, 0], "radius": 1, "impulse_per_length": 1}` |
| `inputs.<ID>`, kind `poke` | the base's | `"poke": {"kind": "poke", "targets": ["crate"]}` |

A declared input holds its kind's defaults as fields beside `kind` and `targets`, as the base's inputs do (#522's lab
declares its grab's `point` and `plane` so); an entry's `data` goes over them.

### Track entries (`track: [Entry]`, #522's; Input track entries: `{step, kind, target, data}`)

| Entry, as the tests write it | Whose word |
|---|---|
| `{"step": 80, "kind": "set", "target": "push", "data": {"value": 3}}` | the design's kind and `value`; **the target is the force's ID**, and `path` comes from the declared input |
| `{"step": 70, "kind": "activate", "target": "sleeper"}` | the design's |
| `{"step": 90, "kind": "deactivate", "target": "faller"}` | the design's; the base's (#191) |
| `{"step": 100, "kind": "blast", "target": "chip"}` | the design's kind; **a blast entry names a target, a body its input lists**, as every entry does |
| `{"step": 10, "kind": "poke", "target": "crate", "data": {"address": "crate#rim", "impulse": [0, 1, 0]}}` | the issue's `address`, "a body ID#anchor in place of a point"; **written `<body ID>#<anchor name>`, in the entry's `data`**, as a joint's end names an anchor at the base |
| `{"step": 10, "kind": "poke", "target": "crate", "data": {"point": [0.25, 0, 0], "impulse": [0, 1, 0]}}`, and the same with no `point` | the base's (#522) |

An entry stamped `step: k` applies at the start of the step from the state after k steps to the state after k + 1
(#522's step convention), so `step_hashes[k + 1]` is the first it can change. The tests never write two entries of
one step whose order matters, but for the two `set`s of the second and third tests.

### The scene (criterion 3; #1918's "a scene's world")

A scene document as #1918's fixture writes one: `format`, `profile: "scene"`, `title`, `description`, `size`, `camera`,
`transport: {span: "2s", frame_rate: [60, 1]}`, `requires`, `items`, `channels` and `worlds: {"field": World}`.

- Two marker items, `wind` and `anchor` (`mark.box@1` with `at.pos`), and a camera.
- Two keyed channels of type `vec3`, each key `{"t": "<seconds>s", "value": [x, y, z], "interp": "hold"}`:
  `{"target": "items/wind/at/pos", "type": "vec3", "keys": {"k0": {"t": "0s", "value": [0, 0, 0], "interp": "hold"}, "k1":
  {"t": "0.275s", "value": [3, 0, 0], "interp": "hold"}, "k2": {"t": "1.275s", "value": [0, 0, -2], "interp": "hold"}}}`, and
  the same for `items/anchor/at/pos`.
- **A drag's `medium` and a spring's `point` name such a path, `items/<ID>/at/pos`, three numbers**: the medium's
  velocity in m/s, the point in m. The step that ends in the state after k steps reads them at k ÷ 120 s, as #1918's
  `follow` and motor targets are read.

### Calls and reply fields (all the base's)

| Call, as the tests write it | Reply fields the tests read |
|---|---|
| `{"call": "bake", "world": World, "track": [Entry], "steps": 240, "read"?: [], "store"?: dir}` | `{"ok": true, "step_hashes": [string × 241], "bodies": {ID: [State × 241]}}`; `State` is `{"pos": [3], "rot": [4], "linear": [3], "angular": [3]}`, index k the state after k steps, index 0 the built one; `read: []` answers no body. A refused world or track answers `{"ok": false, "issues": [{"code", "path", "what", …}]}`, read only for the failure's message |
| `{"call": "bake", "scene": Scene, "world": "field", "track": [Entry], "steps": 240, …}` | the same |
| `{"call": "seek", "world": World, "track": [Entry], "steps": 240, "store": dir, "to": 130, "play": 110, "read": []}`, and the same with `"scene": Scene, "world": "field"` | `{"ok": true, "from": step, "step_hashes": [string]}`, one hash for each step from `from` to 240 |

Flag, as at the base: `deep-physics --planted <name>`. With a name it knows the process exits 0 and answers every
call; the base answers `{"ok":false,"code":"bad_input"}` and exits 2 to one it doesn't.

### What the new fields do, as far as the tests hold them

- **`activate`** (Scope: "wake … and enable … a body and its colliders"): a body built `active: false` isn't stepped
  until its entry; from then on it is, so the track without the entry gives other step hashes after the entry's step.
- **`deactivate`**: the body isn't stepped from its entry's step on, as at the base.
- **`set`**: from the start of its step the force its target names has the strength `value`. **Two `set` entries of
  one target and path stamped one step: only the one written second on the track applies**, whichever way round the
  track's own order would apply them.
- **`blast`**: a body whose entry it is gets an impulse when it is within `radius` of `at`, and none when it is
  farther. With `falloff` unwritten a body 0.9 m from `at` under a radius of 1 m, and one 1.1 m from it under a radius
  of 1.2 m, each get an impulse that moves them.
- **A poke's `address`**: the poke is applied at that anchor of that body, where a `point` would put it.
- **A drag's `medium` and a spring's `point` from a channel**: the value the path holds at the step's time, used as
  the number in its place would be.
- **A `strength` that names a `set` input**: the force's strength is what that input's entries set. What it is before
  the first entry isn't read by any test, except that it isn't the 3 the first entry sets (the declared `value: 0` and
  a force's own default 1 both pass).

### The planted wrong program

`deep-physics --planted <name>` on the same binary (the base's way of starting a wrong program), changing nothing but
what its row says. Its process must exit 0 and answer; the judge that passes the real program must fail on it.

| Name | Criterion | The wrong program | What the test holds it to |
|---|---|---|---|
| **`set_applies_both`** | 1 | two `set` entries of one target and path stamped one step are both applied, none replaced, in the order the base's track applies a step's entries: (kind, target ID), then the declared input's ID, then the entry's data as canonical JSON, never the order they were written in. So of a set to 9 and a set to 2, the set to 9 is applied last and holds, whichever was written second | it plays the four tracks of the second test; the same judge finds a failure that begins `the two sets stamped step 40` and names `the step hash at step 41`, the first that differs from the second set alone |

`twins.json` maps the first criterion's ID to it. The other two criteria name no planted program: their wrong program
is the base.

## The worlds

All on `physics.world@1`, 3 dimensions, 120 Hz, 4 substeps, gravity (0, −9.81, 0), seed 2371, mode `dynamic`, backend
`rapier3d` `=0.36.1`, capacity 8 bodies, 8 shapes, 0 joints, 16 contacts, a checkpoint every 60 steps, one contact
material `m` (`{friction: 0.5, restitution: 0, density: 1000}`), every solver and combine field unwritten. Every body is
`dynamic` with `mass: 1` and one shape use. No world holds a floor, and no two bodies of one world ever touch: each is
moved by gravity, by one force or by one input alone. A body that "floats" is written `gravity_scale: 0, sleep: false`,
so it stays exactly as built until a force or an input moves it.

| World | Bodies | Forces and inputs | Track |
|---|---|---|---|
| **the yard** (ac1) | `sleeper`, a ball of radius 0.25 m at (−4, 0, 0), `active: false`; `faller`, the same at (−2, 0, 0); `puck`, the same at the origin, floating; `chip`, a bead of radius 0.05 m at (0.9, 0, 4), floating | `push`: uniform 2 m/s² along +x on `puck`, `strength: "throttle"`. Inputs `throttle` (set, targets `push`, `path: "strength"`, `value: 0`), `wake` (activate, `sleeper`), `halt` (deactivate, `faller`), `boom` (blast, `chip`, `at: [0, 0, 4]`, `radius: 1`, `impulse_per_length: 1`) | first test: activate `sleeper` at step 70, set `push` to 3 at step 80, deactivate `faller` at step 90, blast `chip` at step 100; 240 steps. Second and third: two sets of `push` stamped step 40, to 9 and to 2; 120 steps |
| **the crate** (ac2) | `crate`, a box of half 0.25 m at the origin, unturned, floating, `anchors: {rim: [0.25, 0, 0]}` | input `poke` (poke, `crate`) | one poke at step 10 of impulse (0, 1, 0) N·s: by `address: "crate#rim"`, at `point: [0.25, 0, 0]`, at the centre, or none; 120 steps |
| **the beads** (ac2) | `near`, a bead of radius 0.05 m at (0.9, 0, 0), and `far`, the same at (0, 0, 1.1), both floating | input `boom` (blast, targets `far` and `near`, `at: [0, 0, 0]`, `impulse_per_length: 1`, `radius: 1`, and once `radius: 1.2`) | a blast entry for `near` and one for `far`, both stamped step 10; 60 steps |
| **the field** (ac3), `worlds.field` of the scene | `leaf`, a ball of radius 0.25 m at the origin; `bob`, the same at (0, 2, 3); `puck`, the same at (0, 0, −3); all floating | `breeze`: drag, `linear: 2`, `medium: "items/wind/at/pos"`, on `leaf`. `tether`: spring_to_point, `point: "items/anchor/at/pos"`, `hz: 1`, `damping_ratio: 1`, on `bob`. `push` and `throttle` as in the yard | set `push` to 3 at step 40 and to 1 at step 190; 240 steps |

The field's channels hold each value to the next key. The wind: (0, 0, 0) m/s, then (3, 0, 0) from 0.275 s (step 33),
then (0, 0, −2) from 1.275 s (step 153). The anchor: (0, 2, 3) m, where `bob` is built, then (0.5, 2, 3) from 0.375 s
(step 45), then (0.5, 2.5, 3) from 1.375 s (step 165). Each key sits on an odd step's time, between two 60 fps
frames, so a world that reads its channels per frame lands off it. `BASE-FAILURE.txt` lists how the base runs these
worlds with the new fields taken out.

## Criteria to tests, and the wrong program each fails on

- **ac1, `#2371.7fae183d`.**
  1. The yard played 240 steps from its track of four entries, into a store. Each entry is seen to change the world:
     the track without it gives the same step hashes through the entry's step and another after it. A second process
     plays the same world and track again: all 241 step hashes are the first run's. A seek to step 65 restores the
     checkpoint at step 60, before all four entries, and a seek to step 130 the one at step 120, after them; each,
     played on to step 240, gives the straight run's step hashes. Fails on the base, which refuses the world; a
     program that ignores an entry fails the first leg, one whose seek drops an entry or whose checkpoint leaves out
     the set strength or the body's activation fails the last.
  2. Two sets of `push`'s strength stamped step 40: the set to 9 then the set to 2 gives the step hashes of the set
     to 2 alone, and the set to 2 then the set to 9 those of the set to 9 alone. The two alone first differ at step
     41, so which holds is visible. Fails on the base, which refuses the world; a program that applies both, or keeps
     the first, fails one of the two orders.
  3. Under `set_applies_both` the same four tracks are played and the same judge fails, naming the two sets' step 40
     and step 41. The wrong program is the planted one; the base doesn't know the name.
- **ac2, `#2371.825e2c1b`.**
  1. The crate poked by `address: "crate#rim"` gives all 121 step hashes of the crate poked at `point: [0.25, 0, 0]`.
     Not vacuous: they aren't the hashes of the crate left alone (they differ after step 10), nor of the same impulse
     at the crate's centre, which doesn't turn it. Fails on the base, which refuses the entry's `address`; a program
     that takes the address and pokes the centre fails the last leg.
  2. The beads with the blast of radius 1 m: `near` is exactly as built and at rest through step 10 and somewhere
     else at step 60; every one of `far`'s 61 states is its built pose with zero velocities. With `radius: 1.2` the
     same entry moves `far` too. Fails on the base, which refuses the blast; a blast that ignores its radius fails on
     `far`, one that reaches nothing on `near`, one that only ever reaches its first body on the last leg.
- **ac3, `#2371.aabc7fe9`.**
  1. The field played 240 steps in its scene, and six more times with one key or one entry left out. Against each,
     the step hashes are the same before the step that key or entry says and differ at it, and at it the body that
     force applies to is the one that differs: steps 33 and 153 (`leaf`, the wind's keys), 45 and 165 (`bob`, the
     anchor's keys), 41 and 191 (`puck`, the entries stamped 40 and 190). Fails on the base, which refuses the three
     fields; a program that reads a channel once, per frame or at a step's start, or applies a `set` a step late,
     fails on the step.
  2. The field baked into a store and sought to step 130: the seek restores the checkpoint at step 120, after each
     force's first change and before its second, and gives the straight run's step hashes to step 240. Not vacuous:
     with the channels' first keys and the track left out the state after 120 steps is another, and the first test
     shows the later key and entry of each force change the steps the seek plays. Fails on the base; a seek that
     reads a channel from its own start, or a checkpoint without the set strength, fails it.

Test count: 3 + 2 + 2 = 7.

## Readings, where the issue and the design leave a choice

1. **The surface.** `deep-physics`, the physics module's runner, with #522's `track` and `seek` and #1918's scene, as
   the base's suites drive it. "Played from a track" is a `bake` with `track`; "a replay" is the same `bake` in a
   second process; "a seek from a checkpoint" is #522's `seek` over the bake kept in a store, held to restoring the
   nearest checkpoint at or before its step (Checkpoint ring), never the world as built.
2. **"One input of each."** The world declares one input of each of the four kinds and its track holds one entry of
   each. The other tests of the first criterion play the same world from tracks of `set` entries alone.
3. **What a `set` sets.** The design gives `set {path, value}` no list of paths and marks one field settable, a
   force's `strength` (`strength: number | input`), which is also the third criterion's "strength an input sets". So
   the one `set` these tests write targets a force and sets its strength, and the force names that input by its ID.
   Nothing else is set.
4. **"A second `set` on one step replaces the first."** Second is the one written later on the track (in a call, the
   later element of `track`), for two sets of one target and path. The base applies a step's entries in (kind, target
   ID) order and breaks ties by the declared input and the entry's data, never by the order written; under that order
   alone a set that "applies both" and one that "replaces" could not be told apart, so the criterion's planted program
   implies the written order decides. Both orders of writing are played, so a program that keeps a fixed one of the
   two fails.
5. **"A planted `set` that applies both fails, naming the step."** Applying both in the order written would give the
   second's value, as replacing does. The planted program therefore applies both in the base's own order of a step's
   entries, where the set to 9 comes after the set to 2. "Naming the step": the judge's failure names the two sets'
   step, 40, and the first step whose hash differs, 41.
6. **A blast's entry.** Every entry has a target (Input track entries), and Scope says "every body within `radius` of
   `at`". The tests write one blast entry for each body they read, all on one step, with the input listing those
   bodies, and hold only what both readings give: a body with an entry is moved when it is inside the radius and left
   alone when it is outside. Whether one entry also reaches other bodies isn't asserted.
7. **"0.9 m away", "1.1 m away".** The bead's centre is that far from `at`; with a radius of 0.05 m its nearest point
   is 0.85 m and 1.05 m away, so a distance read to the centre or to the surface gives the same answer. "Moves": at
   rest as built through the blast's step, and at another position at the end of the run; neither a direction nor a
   size is given, so none is asserted. "At rest": every state is the built pose with zero velocities, exactly.
8. **`falloff` and `impulse_per_length`.** The design gives `falloff` no type, unit or default, and no criterion
   reaches it, so no test writes it: a blast without it must be admitted and must still move a body inside its
   radius. `impulse_per_length` is written 1; which length it multiplies isn't asserted.
9. **"A poke at that anchor's point."** The crate is at the origin and unturned when the poke applies, so the
   anchor's local point (0.25, 0, 0) is also where it is in the world. The base applies a poke's `point` as a point of
   the world, and the design says of it only that a grab's is local; these tests don't decide it.
10. **"At the step the channel … says."** #1918's step time, the base's: the step that ends in the state after k
    steps reads its channels at k ÷ 120 s. A key at step K's time is first read by that step, so the state after K
    steps is the first that differs from the run without the key, and the test holds it to exactly K.
11. **"At the step … the input says."** #522's stamp: an entry stamped k applies at the start of the next step and
    the force is computed in that step, so the state after k + 1 steps is the first that differs, exactly.
12. **What a `medium` and a `point` read.** An item's `at/pos`, three numbers, as #1918's `follow` does: the design
    says only "channel". The medium's are a velocity in m/s, the point's a position in m.
13. **Per-entry change in the first criterion.** "Changes the world" is held to "the same through the entry's step,
    another after it", not to the very next step: the criterion states the step only for the third criterion's
    forces.

## Found in the inputs, and not settled here

- The issue's first paragraph lists `deactivate` among the kinds the world reader refuses naming this issue. The base
  runs `deactivate` since #191 and refuses `set`, `activate` and `blast`. The tests take the base as it is: the
  `deactivate` clause already holds there, inside a world the base refuses for its other inputs.
- `docs/technical-design.md` (Input, occurrence, output) lists the inputs without `deactivate` and `blast`;
  `docs/canvas-primitives.md` (Input track entries) lists both. The tests follow the issue and the latter.
- The design's step order adds forces "from the state at t(k)" and reads a kinematic body's channel at t(k+1). It
  doesn't say at which of the two a force's own channel is read; reading 10 takes the base's one step time for every
  channel a step reads.
- Nothing in the three criteria proved impossible to test. The Proof line's "each kind replayed and seeked" is the
  first test of the first criterion.

## What isn't asserted, because no criterion says so

- A poke's `radius` and `falloff`, and a blast's `falloff`: Scope lists them and no criterion reaches them.
- The size and direction of a blast's impulse, what `impulse_per_length` multiplies, and whether a blast wakes a
  sleeping body.
- Whether a poke's `point` is local or a point of the world, and a poke by the `address` of a body that has moved or
  turned.
- An `address` naming another body than the entry's target, a soft body's particle or an anchor that doesn't exist.
- Any `set` but a force's strength; a `set` on two targets or two paths of one step; a `strength` naming an input
  that isn't a `set` or doesn't target the force; the strength before its first entry.
- Whether `activate` and `deactivate` wake a body or put it to sleep, what a deactivated body's velocities read, and
  a sensor or a contact of a body activated mid-run.
- The sizes of the drag, the spring and the uniform force (the base's, for forces with numbers), a `quadratic` drag,
  a spring's `max_force`, a `region`, and a channel that isn't a hold.
- A drag or a spring reading a driver, a channel that depends on a physics pose (#1918's cycle refusal), and the
  bake key's cover of the channels a force reads.
- Derived inputs (`on`), an input's `data` expressions, `jump`, `drive`, `steer`, `brake`, `launch.from` and
  `grab.plane`: Scope leaves them to their own issues.
- Any refusal's code or sentence, any occurrence a new input writes, goldens, a live view, timing and cost.

## What the implementer adds outside this folder

- `scripts/lanes.mjs` needs this line (the files build `deep-physics`); this README is the instruction, the
  implementer makes the edit:

  ```js
  // #2371's files build deep-physics.
  alone.push('tests/acceptance/2371/');
  ```

`BASE-FAILURE.txt` is each file's run at the base, with each test's result and failing assertion.
