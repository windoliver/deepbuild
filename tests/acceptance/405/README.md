# Acceptance tests for #405: geometry audit and control sweeps, every state a document can reach, and ranges bounded between samples

These tests were written before any implementation existed. The writer had issue #405 (its scope, its Geometry audit and
Control sweep fields, its four acceptance criteria and its proof line: "The broken fixture's planted faults by part ID,
the lid sweep failing between its samples, and the audit's budget run"). It also had the issue's Oracle page, the
design sections the issue names and the sections those lean on, and base commit `903a1c07` ("Merge pull request #2162
…"). The Oracle page says no upstream test checks any of the four criteria, so this suite ports nothing. No
implementation existed when this was written.

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job
(design: Dogfooding). The suite is lean: one file per criterion, plus the one planted wrong program that criterion 3
names.

**Not run against a binary.** The machine's load was 31 to 49 on 18 cores, so no Rust was built and the suite wasn't
run at the base. `BASE-FAILURE.txt` says why each test fails there, read from the base's code. The type-check passes. A
scratch vitest run of the generators (not kept) checked the fixtures' own numbers: the depths, the gaps, the bounds
trap, the lift at the samples, the stretch where the lid meets the shelf, and the nine planted pairs.

## What was read

- Issue #405, live with `gh issue view 405`, and its Oracle page (`doneright/oracles/issues/405.md`).
- `docs/canvas-primitives.md`:
  - What holds a document to its rules (8300): issues as data, `{check, code, severity, ids, path, actual, t, what,
    fix}`.
  - Check input (8304): one input shape, with `geometry.audit` among the core's kinds. "A check from a claim's
    definition never passes on it alone: a requirement that passes only because of it stays INCONCLUSIVE and asks
    whether to approve it."
  - Geometry audit (8840), Geometry audit: scenes (8858: `scope`, `overlap`, `support: {floating}`, "lower the vase
    0.2 m"), and Control sweep (8876).
  - The closed function list (6049): interval forms, and "refused, naming the item and the range".
  - Determinism (9020): "Hashing ≤ 5% of render time while checking".
  - Document envelope (292: `checks`, `audit`), Object (2817: `relations`), Assembly (2890), Driver (5428), Constraint:
    rest_on (5539), Control (5555), Tour (5825).
  - World and backend, Body and Physics output (6083, 6128, 6401).
- `docs/technical-design.md`: Document check (1566). Whose checks count (313: "A requirement covered only by the agent's
  own checks stays INCONCLUSIVE and asks whether to approve one of them"). Dogfooding, Criteria to tests both ways,
  Criteria in a checked shape, and Wrong programs (2628 to 2652).
- At the base:
  - `AGENTS.md`.
  - `crates/deep-show`: `run`, and the scenario's `claims`, `planted` and peers. `verdict.rs`'s `judge`, where
    `geometry.audit` is BLOCKED `not_run`, the #200 approval asks are `asks: [{kind: "approval", requirement, …}]`, the
    #464 `display_only` refusal is INVALID with the refusal in `blocked`, and the #408 `timing.check_ms` lives.
    `kit/goldens.rs`'s `decide`, which refuses `not_your_decision`. `shared.rs`'s `knows`.
  - `crates/deep-canvas`: `CORE_CHECK_KINDS`, the envelope's keys (`checks`, `audit`), and the item keys (`relations`).
    `document/rules.rs`, which reads a document's own `checks`. `expr.rs` and `interval.rs`, for `exp`, `pow` and their
    interval forms.
  - `crates/deep-canvas-motion`: drivers in `doc.rs`, with vars `controls/<id>/value` "swept over its declared range",
    and the scene audit in `arrange.rs` that reads `audit.support.floating`.
  - `crates/deep-canvas-scene3d`: the marks in `scene.rs`, `true_shape` in `builders.rs` (a tube@1 is capsules along
    its path), and `fixture.world@1`'s bake in `fixtures.rs`.
  - `crates/deep-canvas-physics`: `doc.rs`. An output reads only `{from, read: position}`, and its `to` waits for #1918.
    A body's `follow` and the world's `inputs` wait for #522.
  - `scripts/proof-change.mjs` (`criterionId`), `benchmark.mjs` (`judgeLimit`, `fingerprint`) and `lanes.mjs`.
  - The earlier blind suites `408/` (the model for layout), `1899/` (budgets), `1732/` (agent-form scenes and render-back's
    audit), `200/` (approval asks), `1897/` (determinism), `166/` and `419/` (`fixture.world@1` as the physics stand-in),
    and `490/` (bounds over a control's range).

Code was read only to learn the surface. Every expected value comes from the issue and the design.

## Run them

Every file builds `deep-show` with cargo, so they run one file at a time. The implementer adds these lines to
`scripts/lanes.mjs`. This README is the instruction; this job edits nothing outside the folder.

```js
// #405's files each build deep-show; budgets.test.ts also builds it in release and times the geometry audit and
// determinism hashing against the reference Mac's rule.
alone.push('tests/acceptance/405/');
timed.push('tests/acceptance/405/budgets.test.ts');
```

```sh
npm ci                          # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/405 --no-file-parallelism
npx tsc -p tests/acceptance/405/tsconfig.json   # type-check
rm -rf tests/acceptance/405/node_modules/.vite
```

- **Build.** Each file first runs `cargo build --locked --bin deep-show --no-default-features --features full`. It
  sets `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0` unless they're already set, copies the binary out of `target/`
  (honoring `CARGO_TARGET_DIR`), and fails each test whose build failed.
- **Release build.** `budgets.test.ts` also builds `--release`, but only on a machine `judgeLimit` says can judge a
  timing now.
- **Isolation.** Every test writes into temporary folders and deletes them. The suite uses Node built-ins and vitest
  only.
- **No decision.** A test that can't decide here fails with a message starting `INCONCLUSIVE:`. It never passes.

## The surface under test

**No new binary.** The suite drives the #393 `deep-show run` (one scenario line in, one answer line out), with the
#403 scenario `claims` and `requirements` and its `verdict` call, and the #393 agent `deep_show`. Every name below that
the issue and design don't give is this job's choice, listed again under Readings. An implementation builds exactly
these, or disputes them.

### The scenes (helpers.ts)

**The documents.** Every fixture is a `scene` document in the agent's form: no `id`, no `layers`, and `requires.modules`
holding `scene3d`, plus `motion` and `input` where a slider drives something. The working agent alpha (`sess-alpha`)
shows it with `{"call": "deep_show", "session": "sess-alpha", "doc", "document", "include": ["issues"]}`. The reply is
`outcome: "presented"`, with no `unknown_kind` notice or issue. Each scene is the one deliverable of a claim of alpha's.

**The parts:**
- Metres, +Y up.
- `mark.box@1`, `mark.sphere@1` and `mark.cylinder@1` are unit solids centred on `at.pos` and scaled by `params.size`. A
  cylinder's axis is +Y. Each is its own true shape.
- `tube@1` runs `{path: [[x, y, z], …], radius}`, and its true shape is capsules along the path. Its ends are the path's
  first and last points.

**The slider and the driver:**
- The slider is `controls.lift`: `{kind: slider, class: document, label, role: slider, range: [0, 1], default: 0}`.
- A driver reads it as `vars: {s: "controls/lift/value"}`, with `expr: "<rest> + 0.05 * exp(-pow((s - 0.6) / 0.05,
  2))"`.

**The physics world.** The physics world is `fixture.world@1`. Its `params` are `{step_hz, span, gravity: 0, floor,
restitution, bodies: {lid: {radius, pos}}}`. It's drawn as one sphere per body, and the driver writes
`items/lift-world/params/bodies/lid/pos/1`.

### The check, as a claim's requirement

Each requirement's `check` is a Check input of kind `geometry.audit`, with the issue's fields and the scene fields of
Geometry audit: scenes:

| Field | Used |
|---|---|
| `scope` | `"scene"` in every test |
| `tolerance` | `{sunk, touch, land}` in m: `{0.003, 0.001, 0.001}` for criteria 1 and 4 |
| `support` | `{floating: [ID]}`: what the definition lets float |
| `sweeps` | `{lift: 5}` in criterion 3 |

Criterion 4's rendered claim holds `{kind: "document.determinism", at_times: ["0s", "0.5s", "1s"], compare:
"same_machine"}`. `{"call": "verdict", "claim"}` judges each claim.

### The verdict's row

The requirement's row (the #403 `{id, kind, result, blocked?, issues}`) is decided. It is never BLOCKED with `not_run`,
as it is at the base.

**Results:**
- `FAIL` when the audit raises an error.
- `PASS` when it raises none and no exception it relied on is only the agent's own.
- `INCONCLUSIVE` when the only cover is the agent's own exception (below).
- `INVALID` when the check is refused at check (below).

**Issues.** Each issue has the design's shape: `{check: "geometry.audit", code, severity, ids, path, actual, t, what,
fix}`. A code's fields sit on the issue itself or in its `actual`; the tests read the issue first, then `actual`.
`ids` lists the part IDs the fault names. A sub-address `<id>#<part>` reads as `<id>`.

| Code | The fault | `ids` |
|---|---|---|
| `geometry.overlap` | two parts pass into each other past the tolerance | both parts |
| `geometry.floating` | a part nothing holds (in a scene: it rests on nothing) and that isn't declared floating | the part |
| `geometry.unlanded` | a wire's or tube's end that doesn't land on a part | the tube |

These three codes are errors. A notice decides nothing and may appear anywhere.

**Sweep fields.** A sweep's failure also carries `sweep: {control, value}`: the control and the value of it where the
audit found the fault.

**Estimates.** `estimates: [{control, samples: [value]}]` lists what a sweep could only sample. A sample may also be
written `{value}`. An estimate never decides a check.

**Refusal.** A check that needs the audit over a stretch the sweep can only sample is refused at check:
- The row's result is `INVALID`.
- The entry `{code: "sweep_unbounded", control, range: [lo, hi]}` sits in the row's `blocked` list, where #464's
  `display_only` refusal sits. A `refused` list is read too.

**Timing.**
- `timing: {check_ms}`: the audit's own wall time on the requirement, from the deliverable's evaluated arrays to its
  issues, every state and sweep it audits included. It's in ms, as #408's film.layout reports it.
- `document.determinism`'s row reports `timing: {render_ms, hash_ms}`:
  - `render_ms` is the wall time of the canonical renders the check made.
  - `hash_ms` is the wall time of their GPU pixel hashes, reduction and 16-byte readback.
  - Both are summed over the check, in ms.

### Approval asks and the `answer` call

- **The ask.** The verdict's `asks` carries the #200 approval asks: `{id, kind: "approval", requirement, …}`. `id` is a
  string, and the ask names the item and `floating` anywhere in its JSON. It asks about the one exception the
  document's own checks hold and the definition doesn't.
- **Asking again.** On the same revision, a later verdict carries no new approval ask on that requirement: none, or the
  same ask by its `id`.
- **The answer.** A new call answers the approval ask open on a claim's requirement:
  `{"call": "answer", "claim", "requirement", "answer": "yes", "peer": {pid, start}}` comes from you (#96's `deep show`
  peer, your shell, pid 3002); with `"session": "sess-alpha"` in place of `peer` it comes from the working agent.
  - From you, the reply is `{"outcome": "answered"}`. The exception is then approved for that claim's requirement, and
    later verdicts in the run count it as the definition's own.
  - From the agent, the reply is `{"outcome": "refused", "code": "not_your_decision"}` (the code `decide` uses), and
    nothing changes.

### The planted program (the scenario's `planted`, reachable only there)

The implementer adds it to `Planted` in `crates/deep-show/src/hub.rs` and names it in `src/main.rs`'s planted match:

| Name | The wrong program | Criterion |
|---|---|---|
| `sweep_audits_samples_only` | the control sweep runs the geometry audit at its declared samples and nowhere between them, bounding nothing; everything else as shipped | `#405.4b5d7511` |

No Cargo test feature is needed: every test builds `full`.

## Criteria to tests

IDs are `#405.` and the first 8 hex digits of the SHA-256 of each criterion's text, as `scripts/proof-change.mjs`
computes them: `- [ ] ` dropped, trimmed, and whitespace collapsed. Each file holds its criterion's ID as a string
`const ID`, and every test's name starts with `${ID}`, so the trace lane's static scan reads each test's tag
(checked with `spans` from `scripts/proof-change.mjs`). Each file's header states its fixtures, numbers and wrong
program in full.

| ID | File (tests) | What it asserts |
|---|---|---|
| `#405.0b08cb52` | `broken-fixture.test.ts` (1) | See [Criterion 1](#criterion-1) |
| `#405.4e6c0bc7` | `floating-exception.test.ts` (2) | See [Criterion 2](#criterion-2) |
| `#405.4b5d7511` | `lid-sweep.test.ts` (2) | See [Criterion 3](#criterion-3) |
| `#405.17969a94` | `budgets.test.ts` (1) | See [Criterion 4](#criterion-4) |

### Criterion 1

The scene holds boxes, a sphere, a cylinder and a 1.5 mm tube.

- **The broken figure:** FAIL. Its errors and warnings are exactly these three, each an error, and nothing else:
  - `geometry.overlap`, naming `bracket` and `housing` (0.02 m deep);
  - `geometry.floating`, naming `washer` (0.05 m over the plate);
  - `geometry.unlanded`, naming `cable` (its end 0.05 m above `socket-b`).
- **The trap.** The `knob`'s sphere clears the housing by 2.6 mm while its bounds pass 4 mm in, so an audit of bounds
  fails "exactly".
- **The clean twin:** PASS, with nothing raised.

### Criterion 2

The working agent's scene puts the vase 0.2 m above the table and declares it floating only in its own `checks`.

- **The definition without the vase:** INCONCLUSIVE, the claim too.
- **The ask.** There is exactly one approval ask, with an `id`, naming the vase and `floating`. A second verdict is
  INCONCLUSIVE with no new ask.
- **The definition naming the vase:** PASS, with no ask.
- **The agent's own yes** is refused with `not_your_decision`, and the requirement stays INCONCLUSIVE.
- **After your yes** the requirement passes, and so does the claim.

### Criterion 3

- **The fixture.** The lift is under 1 mm at s = 0, 0.25, 0.5, 0.75 and 1, and 0.05 m at 0.6. The test checks this
  arithmetic itself.
- **The driver's lid:** FAIL, with at least one `geometry.overlap` error naming exactly `lid` and `shelf`, with
  `sweep: {control: lift, value}` where the value is in [0.56, 0.64]. Every error and warning is such an overlap.
- **The planted `sweep_audits_samples_only`:** the same claim PASSes.
- **The lid a physics world lifts:** INVALID, with `{code: sweep_unbounded, control: lift, range: [0, 1]}`, and
  `estimates` listing lift's samples [0, 0.25, 0.5, 0.75, 1].

### Criterion 4

The figure is a plate and 999 boxes, cylinders and spheres, 9 of them shifted 0.02 m into a neighbour.

- **On this machine:** the audit FAILs with exactly the nine planted overlaps (proof that it read the whole figure), and
  reports `timing.check_ms`. `document.determinism` on the same parts, with a camera and a sun at 1920 × 1080, PASSes
  with `timing.render_ms` and `timing.hash_ms`, each above 0.
- **The timing.** On a machine `judgeLimit` says can judge a timing, the suite builds in release, runs one warm-up and
  then five fresh processes, each deciding as above. `judgeLimit` holds `check_ms` to 500 ms and
  100 × `hash_ms` ÷ `render_ms` to 5 (%).
- **The verdict.** Neither may FAIL. Otherwise, or without a GPU, the test is `INCONCLUSIVE:`.

## Readings where the issue and design leave a choice

### Fixtures

- **Scenes, scope `scene`.** Figures as documents (assemblies, their take-apart and motion, the card) are #504's, and
  #504 waits on #405. So every fixture is a `scene` document audited with `scope: scene`. Geometry audit: scenes says
  the audit is "the same audit on true shapes, with items in place of parts", so "part ID" reads as item ID.
  - In a scene, "every part is held" reads as "every item rests on something unless declared floating" (gravity −Y).
  - The definition declares floating the plate the figure stands on (and, in criterion 1, the cable, which hangs by its
    ends). Whether a ground plane counts as something to rest on is then never tested.
  - No assembly, take-apart, loop, tour or `motion_angles` state is exercised, and no relation either: no criterion
    names one.
  - The design leaves open whether a relation excuses a support or overlap failure, so no fixture depends on it. Every
    contact is a face resting on a face, or a sphere resting on a top.
- **Tolerances.** The figures' check sets `tolerance: {sunk: 0.003, touch: 0.001, land: 0.001}`. The cable's 1.5 mm end
  cap sinks into the socket it lands on less than `sunk`, and less than the scenes' default overlap tolerance of
  0.002 m, so it's no fault under either.
- **The faults' sizes.**
  - Every planted overlap is at least 0.01 m deep, past every tolerance.
  - The floating washer is 0.05 m off the plate, past the scenes' support tolerance of 0.005 m.
  - The cable's loose end is 0.05 m from everything, past `land`.
  - "Lands" is read as the end point lying on another part's true shape within `land`. The clean cable's end points
    lie exactly on its sockets' tops.

### Criterion 2

- **The document's own checks** are its envelope's `checks` list, where the core already reads a document's own
  `honest_numbers` inputs. It holds one `geometry.audit` Check input.
- **"Asks once"** reads as one approval ask, by `id`. Repeating the open ask by the same `id` is not asking twice; a new
  `id`, or two asks, is.
- **Your yes** reaches the hub through the new `answer` call, addressed by claim and requirement. A scenario gives all
  its calls before it runs, so it can't quote an ask ID minted mid-run.
  - The app's question card is the user's path to the same answer. It's left to the card's own suites.
  - The working agent's yes is refused, since an agent can't answer an ask or change a decision (invariant 3; Control:
    "It can never: … answer an ask").
  - The test splits into two runs, so that at the base it fails at its named assertion before the new call is parsed.

### Criterion 3

- **The samples.** "5 samples" over [0, 1] are evenly spaced with both ends included: 0, 0.25, 0.5, 0.75 and 1. "Rises
  under 1 mm at every sample" is the fixture's arithmetic (0.92 mm at 0.5 at most), checked in the test.
- **The witness.** "A value of s between 0.56 and 0.64" is the `sweep.value` of an overlap error naming the lid and the
  shelf. The lid passes into the shelf only for s in (0.5643, 0.6357), or (0.5666, 0.6334) past 2 mm, so any true
  witness lies in that range.
- **More than one report.** The implementation may split and report more than one overlap. Every error must still be
  such an overlap.
- **The lid may float.** The definition declares the lid floating in the driver's scene, so its 5 cm lift isn't also a
  support fault.
- **"Lifted through a physics world".** The lid is the body of a baked `fixture.world@1` whose starting height the
  slider's driver writes. This is #419's stand-in for the physics module's baked world, which #166 used the same way.
  - The physics module at the base (#2009) can't yet move a scene item: an output's `to` is #1918's, and a kinematic
    body's `follow` and a world's `inputs` are #522's. Neither is among #405's dependencies.
  - `deep-show` doesn't know `fixture.world@1` as a kind at the base, so the implementation must let `full` know it, as
    scene3d already draws it.
  - Zero gravity holds the body where it starts at every time, so the audit's time doesn't matter.
- **"Refused at check"** is the row's INVALID, with the refusal in `blocked` (or `refused`), as #464's `display_only`
  refusal is. It is never BLOCKED, since nothing can unblock it short of a different requirement.
  - "The range" is the slider's declared range, [0, 1].
  - "Lists its 5 samples as an estimate" is the row's `estimates` entry for the slider.

### Criterion 4

- **The 1,000-part figure** is the plate and 999 parts (1,000 parts). The camera and sun of the rendered copy aren't
  parts, and live in a second document so the audit's document holds parts alone.
- **The nine planted overlaps** prove the audit read the whole figure in every timed run, as #408's 60 cue ends did.
- **"Determinism hashing adds under 5% to render time"** reads as the determinism check's own `hash_ms` over its own
  `render_ms`, judged in percent with `judgeLimit` against 5. Measuring a build with hashing turned off would need an
  option the product doesn't need (AGENTS.md: no option the task doesn't need).
- **"On the reference Mac in the local preflight"** is `judgeLimit`'s rule: five runs after a warm-up, each a fresh
  release process. PASS is possible only on a reference Mac under its conditions; anything else is INCONCLUSIVE.
- **"Compared with the merge base"** reads as the preflight's edit guard running this file on the merge base too, as it
  does every new test. There the audit is BLOCKED `not_run` and has no timing, so the test fails. The base has no
  geometry audit whose time a regression could be measured against.

## Not tested

No criterion asks for these, so none is tested:

- **Audit states:** `states` other than rest and sweeps; `apart`, `loop`, `take_apart` and its reversals, `tour`, and
  `motion_angles`.
- **Other fields:** `displays` and the widest strings, `relations`, `combine: corners | grid`, `at: apart`, and
  `sweeps: {control: replay}`.
- **Other controls:** a toggle, choice or stages control audited at each value, and a turn or a drag bounded like a
  slider.
- **Other inputs to the bound:** a stretch the bound can't settle within the check's budget, a constraint's or a
  channel's interval form, and a part a piece's logic moves.
- **Other faults:** the coincident pair, a tessellate job's measured error, and the fix text or ops.
