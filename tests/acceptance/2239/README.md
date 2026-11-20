# Acceptance tests for #2239: fast movers the backend can't hold

`physics.fast_body` counts a turning body's tip, names a fast kinematic body and a pair it can't hold, and never
records a fix that fixes nothing.

Written first, blind, from issue #2239 as saved for this job on November 19, 2026 (its opening paragraph, Scope, six
acceptance criteria, Proof line and dependencies; it has no comments and no Oracle line), the design's physics
sections and base commit `9d0256132` ("Merge pull request #2836 …"), by a job that never saw an implementation or a
diff of one; no other worktree, branch, pull request or issue was read. The implementing agent doesn't edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test per
clause that needs its own run, one per planted wrong program the criteria name, and one clause kept in a test of its
own because the base contradicts it (Where the issue and the base disagree).

## Files, one per criterion

| File | Criterion | Tests |
|---|---|---|
| `ac1-kinematic-bat.test.ts` | `#2239.56aa2cc8`: the kinematic box passes the resting ball, with `ccd` on the ball or off; one issue of kind `kinematic` naming the box, step 1, 0.25 m and 0.01 m, its fix naming no `ccd`; the box with `ccd: true` refused at check; the planted lint offers `ccd` and fails, naming the fix | 3 |
| `ac2-dynamic-bat.test.ts` | `#2239.242f65d6`: the dynamic bat with `ccd` never leaves the ball behind its leading face, the ball leaves at 59.41 m/s within 1%, the lint raises nothing; the planted wrapper leaves the ball at rest behind the bat and fails, naming the ball and step 4 | 2 |
| `ac3-turning-bar.test.ts` | `#2239.42a90e17`: the bar turning in place raises `physics.fast_body` naming it, 0.105 m and 0.01 m, and the default turns `ccd` on with one row; the planted lint raises nothing and fails, naming the bar | 2 |
| `ac4-fast-ball-resting-ball.test.ts` | `#2239.fdc08cd1`: ten starts; with the resting ball's `ccd` off the moving ball never passes and the lint raises nothing; with `ccd` on both, one issue of kind `pair` naming both, its fix turning `ccd` off on the resting one; nine of the ten starts pass through; the planted lint raises nothing and fails | 4 |
| `ac5-head-on.test.ts` | `#2239.89f47a10`: at 120 Hz one issue of kind `pair` naming both, its fix naming `step_rate` and no `ccd`; at 480 Hz nothing raised and no swap in any of ten starts; the planted lint raises nothing at 120 Hz and fails | 3 |
| `ac6-kit.test.ts` | `#2239.4166d996`: the kit over criterion 1's world writes no row for the box and its playtest fails, naming the box; over #191's ball it writes the row as before; the planted kit's world is refused at check and fails, naming the field | 3 |
| `fixtures/parity/physics/fast-bat.scene` | criterion 1's new fixture | |
| `helpers.ts` | the worlds, the runner and the judges, over `../191/helpers.ts` (imported read only) | |
| `twins.json` | each criterion's ID to its planted program | |
| `BASE-FAILURE.txt` | each file run at the base | |

## What was read

- The issue as saved for this job (title, state and body); the criterion IDs are computed here from its body.
- `docs/canvas-primitives.md`: World and backend `physics.world@1`; Shape; Body `body@1`; Channel and key; Follow;
  Physics output; Bake; Physics: behavior kit; Units and axes; What holds a document to its rules (an issue's fields,
  "the code, never the message text, is what an agent branches on", a fix as text or patch ops); the word list's `kit`
  row and Pack: gridcore@1 (a kit shows each default as an assumption row). `docs/technical-design.md`: The physics
  module (World; Shape, body, contact material, collision group; Input, occurrence, output; Bake and golden; Behavior
  kit); the Playtest check; Who drafts it; Proven on the base; Criteria to tests; Wrong programs; Dogfooding; Tests
  written first. AGENTS.md and CONTRIBUTING.md.
- At the base, for surfaces only: `tests/acceptance/191/` (README, helpers, `ac11`, `ac12`), `191-oracle/` (what its
  ccd port asks), `2309/` (README, helpers, tests, `BASE-FAILURE.txt`), `2306/` (README, `twins.json`), `2009/` (its
  refusal judge), `1918/` (helpers, `ac1`, its channel-targets scene); `crates/deep-physics-rapier` (`main.rs`,
  `planted.rs`, `runner.rs`'s `check`, `bake` and issue, `runner/kit.rs`'s `expand` and planted names, `scene.rs`,
  `lib.rs` where bodies are built), `crates/deep-canvas-physics` (`fast.rs`, `caps.rs`, `check.rs`, `doc.rs`'s body
  and combine readers); `scripts/proof-change.mjs` (criterion IDs), `scripts/proof-runs.mjs` (`twins.json`, what
  counts as failing at an assertion), `scripts/lanes.mjs`.
- The pinned backend's own source, which the issue cites: rapier3d 0.36.1's `src/dynamics/ccd/ccd_solver.rs` and
  `src/geometry/narrow_phase/pair_update.rs`.

Nothing else was needed, and nothing else was read.

What the base already does, which these tests don't credit: `deep-physics` checks and bakes a world document or a
scene's world, lists the lints a bake ran in `issues`, runs #191's `expand` and takes `--planted <name>`. Its
`physics.fast_body` raises one issue per dynamic body with `ccd` off whose centre moves farther in a step than half
its thinnest extent, with `severity: "warning"`, `ids`, `step`, `move`, `half_extent` and the catalog's fix "Turn the
body's ccd on, or slow it."; `expand` turns `ccd` on for each flagged body that leaves it unset, with one row. The
check takes `ccd: true` on any body. `expand` takes a world document only. The wrapper builds a body that has
`ccd: true` with the backend's sweep on and its contact prediction out to `solver.max_speed ÷ step_rate`. The base has
no issue `kind`, no refusal of `ccd`, no lint for a kinematic body, a turn or a pair, and none of the six planted
names.

## Run them

```sh
npm ci                          # once, if node_modules is missing
# the build first, through the one build slot:
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  nice -n 10 sh scripts/lease cargo build --locked -j 6 --release -p deep-physics-rapier --bin deep-physics
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/2239 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2239/tsconfig.json   # type-check
rm -rf tests/acceptance/2239/node_modules                                      # vitest's cache
```

Each file asks cargo for #191's `release` build once (`cargo build --locked --release -p deep-physics-rapier --bin
deep-physics`), finds it made and copies it out of the target folder. Every test passes #191's 60-minute timeout and
each file's build hook its 4 hours. Node built-ins and vitest only. No process is started but `cargo` and
`deep-physics`, each waited for; none is stopped by name or port. No test times anything, so none depends on the
machine or its load. No cargo is `BLOCKED:`, and a bake whose reply lists no issues is `INCONCLUSIVE:`, each a
failure, never a pass. **`scripts/lanes.mjs` needs `'tests/acceptance/2239/'` in its `alone` list** (the files build
a cargo binary); this README is the instruction, the implementer makes that edit.

## The surface under test

The issue names the lint, the refusal's code, the two issue kinds, `caps()`, `ccd`, `step_rate` and the default, and no
call or flag. These tests drive `deep-physics` as #191, #1918 and #2009 left it and add the least the criteria need.
Each name is marked: *(issue)* the issue's word, *(design)* the design's, *(base)* what the base's suites already
drive, **bold** and *(ours)* this job's choice, which the implementer builds as written.

### Calls

| Call | Reply |
|---|---|
| `{"call": "check", "scene": Scene, "world": "court"}` *(base)* | `{"ok": true, "issues": [Issue]}` |
| `{"call": "bake", "world": World, "steps": 12}` and `{"call": "bake", "scene": Scene, "world": "court", "steps": 12}` *(base)* | `{"ok": true, "bodies": {ID: [state]}, "issues": [Issue], …}`; state k is the body after step k, its `pos` and `linear` read here |
| `{"call": "expand", "world": World}` *(base, #191)* | `{"ok": true, "world": World, "assumptions": [{"body", "reason", …}]}`, or a refusal `{"ok": false, "issues": [Issue]}` |
| **`{"call": "expand", "scene": Scene, "world": "court"}`** *(ours)* | the same replies for a world its scene lists, as `check` and `bake` take one; `world` is that world's document as the kit wrote it |

### The lint's issues, in a bake's `issues`

Examples of what the tests read; a fix's sentence is the implementer's, and a pair's `step` is any step of the run.

```text
kinematic   {"code": "physics.fast_body", "kind": "kinematic", "severity": "error", "ids": ["bat"], "step": 1,
             "move": 0.25, "half_extent": 0.01, "fix": "Make the body dynamic and move it with a motor or a
             starting velocity.", …}
pair        {"code": "physics.fast_body", "kind": "pair", "ids": ["moving", "resting"], "step": 3,
             "fix": "Turn ccd off on resting.", …}
pair        {"code": "physics.fast_body", "kind": "pair", "ids": ["left", "right"], "step": 5,
             "fix": "Raise step_rate until neither is fast, or slow them.", …}
one body    {"code": "physics.fast_body", "ids": ["bar"], "move": 0.1047, "half_extent": 0.01, …}
```

- `code` `physics.fast_body` *(issue, base)*; `ids`, `fix`, `severity` *(design: an issue's fields)*; `step`, `move`,
  `half_extent` *(base, #191)*, `move` now the fastest point's.
- **`kind`** *(ours as a field; the issue says "an issue of kind")*, with the values `kinematic` and `pair` *(issue)*.
  The issue of one dynamic body (the bar, #191's ball) has neither value.
- `ids` names the box for kind `kinematic` and both bodies for kind `pair`.
- For kind `kinematic`: `step` is the first step the box is fast (1), `move` its fastest point's move in that step
  (0.25 m within 1%), `half_extent` half its thinnest extent (0.01 m within a micron). For kind `pair`: `step` is a
  whole number from 1 to the run's steps.
- `fix` is read as text: the sentence, or patch ops as their JSON. **What each says** *(ours as tokens; the issue
  says what the fix says)*: kind `kinematic` names `dynamic` and never `ccd`; a pair whose other body has `ccd` on
  and is not fast names `ccd`, that body's ID (`resting`) and `off` or `false`; a pair of two fast bodies names
  `step_rate` and never `ccd`. `ccd` is matched whatever its case.
- **`severity: "error"`** on an issue of kind `kinematic` *(ours)*: how a playtest run that holds it fails, naming the
  box (criterion 6). The base's issue for one dynamic body is a `warning`.
- "The lint raises nothing" is a bake with no `physics.fast_body` issue at all; "raises one issue of kind …" is a bake
  with exactly one `physics.fast_body` issue, of that kind.

### The refusal at check

```text
{"code": "physics.backend_cap", "severity": "error", "path": "bodies/bat/ccd", "actual": true,
 "what": "rapier3d 0.36.1 …", …}
```

The base's refusal by `caps()`, as #2009's suite reads one: `code` *(issue, base)*, `path` the field *(base)*,
`actual` the refused value *(design)*, and a `what` that names the backend, `rapier3d` *(base)*. One such issue for
the box with `ccd: true`; the fixture as written checks with no error.

### The kit's run

#191's `expand` is the kit's default for fast bodies; its rows are the kit's assumption rows *(base)*. Over the
fixture's world it answers `ok: true` with the world and rows that hold no row whose `body` is `bat`, and the world's
`bat` has no `ccd: true`. Its playtest is that world, put back in its scene and baked *(#191's reading: a playtest run
bakes, and the lint is read there)*.

### Planted wrong programs

Each is `deep-physics --planted <name>` on the shipped build *(base: its way of starting a wrong program)*, changing
nothing but what its row says. Its process exits 0 and answers every call; the judge that passes the real program
fails on it, naming what the criterion says. Every name is *(ours)*; `twins.json` maps each criterion's ID to its
name.

| Name | Criterion | The wrong program | The judge's failure |
|---|---|---|---|
| **`lint_kinematic_as_dynamic`** | 1 | the lint treats a fast kinematic body as #191 treats a dynamic one: one issue naming the box whose `fix` offers `ccd` | quotes that fix |
| **`wrapper_drops_body_ccd`** | 2 | the backend wrapper builds every body with `ccd` off whatever the document says; the document, the check and the lint read it as written. The bat passes the ball, which ends at rest where it was built, behind the bat's leading face | names `ball` and `step 4` |
| **`lint_reads_move_only`** | 3 | the lint reads only a body's move, as the base's does: it raises nothing for the bar | names `bar` |
| **`lint_one_body_at_a_time`** | 4 | the lint reads one body at a time: it raises nothing where both balls have `ccd` on, in each of the ten starts | fails in each start |
| **`lint_pair_held_by_one_ccd`** | 5 | the lint calls a pair held whenever one of the two has `ccd` on: it raises nothing at 120 Hz, in each of the ten starts | fails in each start |
| **`kit_turns_ccd_on_kinematic`** | 6 | the kit turns `ccd` on for the flagged kinematic box: its `expand` over the fixture answers `{"ok": false, "issues": […]}` holding the refusal above | names `bodies/bat/ccd` |

### The fixture

**`fixtures/parity/physics/fast-bat.scene`** *(ours)*: criterion 1's new fixture, a scene with one world, `court`,
whose kinematic body `bat` follows `items/bat/at/pos`, written by the scene's channel `bat`. World, body, shape, item
and channel IDs are *(ours)*.

## The worlds

All at 120 Hz and 4 substeps unless a test says 480 Hz, gravity (0, −9.81, 0), every dynamic body with
`gravity_scale: 0`, one contact material of friction 0.5, density 1,000 kg/m³ and restitution 0 unless said. Motion is
along x; every centre is on the x axis. A bake of 12 steps is a tenth of a second.

- **The fixture** (criteria 1 and 6): `bat`, a kinematic box of half extents (0.01, 0.5, 0.5) m, 0.02 m thick along x,
  its centre from x = −0.91 m (its leading face 0.90 m before x = 0) to 29.09 m in 1 s on a linear channel: 30 m/s,
  0.25 m a step. `ball`, a dynamic sphere of radius 0.05 m at the origin. Neither writes `ccd`. The box's trailing
  face is past the ball's far side from step 4 on. Variants write `ccd: true` on the ball, or on the bat.
- **The dynamic bat** (criterion 2): the fixture's world, baked as a document of its own: `bat` a dynamic body of
  mass 10 kg with `velocity.linear` (30, 0, 0) and `ccd: true`; `ball` with mass 0.1 kg and `ccd: false`; the contact
  material's restitution 1; `combine.restitution: "max"` written.
- **The bar** (criterion 3): `bar`, a dynamic box of half extents (1, 0.01, 0.01) m with `velocity.angular`
  (0, 0, 720) deg/s and no linear velocity. Its turn in a step is 6°, its farthest extent from its centre
  √(1² + 0.01² + 0.01²) m, so its fastest point moves 0.10473 m a step, the issue's 0.105 m. The lint's bake writes
  `ccd: false`; the default's run leaves `ccd` unset.
- **The shot** (criterion 4): `moving`, a sphere of radius 0.05 m at 100 m/s along +x with `ccd: true`, and `resting`,
  the same sphere at the origin with `ccd: false` or `ccd: true`. Start 0 puts `moving` three steps and one radius
  before `resting`'s centre, at x = −2.55 m; start j is j tenths of a step, j × 0.0833 m, farther back.
- **Head on** (criterion 5): `left` at x = −1 m and +20 m/s with `ccd: true`, `right` at x = +1 m and −20 m/s with
  `ccd: false`, both of radius 0.05 m, at `step_rate` 120 or 480. Start j puts `left` j tenths of its step's move
  farther back: j × 0.0167 m at 120 Hz, j × 0.0042 m at 480 Hz. Each run is a tenth of a second, 12 or 48 steps.
- **#191's ball** (criterion 6): `../191/helpers.ts`'s `fastBallWorld(undefined)`.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s; each `describe` and test title starts with its criterion's ID. A judge returns
what is wrong as sentences, and each test asserts in its own file that there are none.

| File | Test | What fails it |
|---|---|---|
| `ac1` | real | the box off its channel at a step, or its trailing face not past the ball's far side at the end; the ball anywhere but where it was built, or moving, at any step, with `ccd` on it or off; the fixture's bake not holding exactly one `physics.fast_body` issue, of kind `kinematic`, naming `bat`, step 1, 0.25 m within 1% and 0.01 m, with a fix that names `dynamic` and no `ccd` |
| | refusal | the fixture not checking clean; the box with `ccd: true` not refused by exactly one `physics.backend_cap` error at `bodies/bat/ccd` with `actual: true` and a `what` naming `rapier3d` |
| | planted `lint_kinematic_as_dynamic` | the planted program not running; it not raising one issue for the box whose fix names `ccd`; the judge passing it, or no failure quoting that fix |
| `ac2` | real | the ball's centre behind the bat's leading face at the end of a step; the ball's speed along +x at the end not 59.41 m/s within 1%; any `physics.fast_body` issue |
| | planted `wrapper_drops_body_ccd` | the planted program not running; the ball not ending at rest where it was built, behind the bat's leading face; the judge passing it; the first step the ball is behind not step 4; no failure naming `ball` and `step 4` |
| `ac3` | real | the bar's centre moving; the bake not holding exactly one `physics.fast_body` issue, naming `bar`, 0.10473 m within 1% and 0.01 m, of neither new kind; `expand` of the bar with `ccd` unset not giving `ccd: true` on it and exactly one row, naming `bar` |
| | planted `lint_reads_move_only` | the planted program not running; it raising any `physics.fast_body` issue; the judge passing it, or no failure naming `bar` |
| `ac4` | `ccd` off on `resting` | `moving` past `resting` at the end of a step in any start; `resting` never struck; any `physics.fast_body` issue in any start |
| | `ccd` on both, the lint | any start's bake not holding exactly one `physics.fast_body` issue, of kind `pair`, naming `moving` and `resting`, a step of the run, with a fix naming `ccd`, `resting` and `off` or `false` |
| | `ccd` on both, the motion | `moving` past `resting` at the end of a step in any number of the ten starts but nine |
| | planted `lint_one_body_at_a_time` | the planted program not running; it raising any issue in any start; the judge passing it in any start |
| `ac5` | 120 Hz | any start's bake not holding exactly one `physics.fast_body` issue, of kind `pair`, naming `left` and `right`, a step of the run, with a fix naming `step_rate` and no `ccd` |
| | 480 Hz | `left` past `right` at the end of a step in any start; the two never meeting; any `physics.fast_body` issue in any start |
| | planted `lint_pair_held_by_one_ccd` | the planted program not running; it raising any issue at 120 Hz in any start; the judge passing it in any start |
| `ac6` | the fixture | `expand` of the fixture's world not giving a world and rows; a row whose `body` is `bat`; `ccd: true` on `bat`; the bake of that world in its scene not holding exactly one `physics.fast_body` issue of kind `kinematic` and severity `error` naming `bat` |
| | #191's ball | `ccd` not true on `ball`; not exactly one row, naming `ball`, its `reason` naming `physics.fast_body` |
| | planted `kit_turns_ccd_on_kinematic` | the planted program not running; its `expand` not answering `ok: false` with the refusal at `bodies/bat/ccd` naming the backend; the judge passing it, or no failure naming `bodies/bat/ccd` |

Test count: 3 + 2 + 2 + 4 + 3 + 3 = 17. At the base two pass, as they should (`ac5` at 480 Hz, `ac6` over #191's
ball); every criterion has a test that fails at the base and one that fails on its planted program once it exists.

Not vacuous: criterion 1's test holds the box to its channel and to having passed the ball; criterion 3's holds the
bar's centre still; criterion 4's first test requires that `resting` was struck, and its run is 8.3 m of free flight
from at most 3.3 m back; criterion 5's 480 Hz test requires that the two met, in a run that closes 4 m on a 2 m gap.

## Readings where the issue leaves a choice

- **The surface.** The lint is read on a bake's `issues`, the refusal on `check`, the kit's run on `expand`, as #191's
  suite reads them; no new call. Only `expand` gains a form: a scene's world, since a kinematic body's channel lives
  in a scene.
- **"A new fixture"** is this suite's scene file, as #1918's fixture is, not a fixture of the behavior kit: the
  criterion measures nothing a kit result holds.
- **The box's other sizes**: a 1 m square plate, the ball centred on it. **"With `ccd` on the ball or off"**: the
  fixture as written, and with `ccd: true` on the ball; the lint is asserted on the fixture as written.
- **"At rest"**: within a micron of where it was built and under a micron a second, at every step of the run.
  **"After the box has passed it"**: the box's trailing face is beyond the ball's far side, from step 4.
- **"One issue of kind …"** and **"raises nothing"** count every `physics.fast_body` issue of the bake, not only
  those of the new kinds. So a ball struck by a body the backend holds it against carries no issue of its own after
  the hit (criteria 2 and 4), and a fast ball with `ccd` off that is one of a flagged pair carries none beside the
  pair's (criterion 5, whose planted lint "raises nothing").
- **"Naming"** a body is its ID in `ids`; a step, a move and a half extent are the fields #191's issue has. A move
  is held within 1%, as #191's suite holds one, and a half extent within a micron. A failure "naming" something is
  the judge's sentence holding it.
- **What a fix "says" or "names"** is read from its text by the tokens under The surface; the code, never the
  wording, is what an agent branches on (design), so no test matches a sentence.
- **"The ball is never behind the bat's leading face"** is read by the ball's centre, as #191's suite reads its ball
  against its wall: a contact's softness may sink a touching ball a few millimetres. **"It leaves at"** is the ball's
  speed along +x at the end of the 12 steps. **`ccd` off** is `ccd: false` written, wherever a criterion says off and
  the default isn't under test. **"The step"** the planted wrapper's failure names is the first at whose end the
  ball's centre is behind the leading face: 0.90 m at 0.25 m a step, step 4.
- **The bar**: 0.02 m thick both ways, turning about z, `gravity_scale: 0` so it has no linear velocity. Its move is
  the issue's closed form, held within 1%; the test first shows the closed form prints as 0.105. The criterion names
  no step, so none is asserted. **"The default"** is #191's `expand`, which speaks only for a `ccd` left unset.
- **"Ten starts a tenth of a step apart"**: each start one tenth of the moving ball's move in a step farther back.
  Criterion 4's first start is the one that would end a step inside the resting ball, one radius short of its
  centre, were nothing to stop it. **"Passes"** and **"swap order"**: the centre of the one that started behind is
  past the other's at the end of some step. Each lint clause is asserted in every start.
- **Criterion 5's balls**: `left` has `ccd: true`, 2 m from `right`; the starts move `left`. The 120 Hz lint is
  asserted in the same ten starts, a tenth of a 120 Hz step apart.
- **"A kit run"** is #191's `expand`; **"its playtest fails, naming the box"** is the bake of the kit's world holding
  the box's issue with `severity: "error"`; **"as before"** is what #191's suite asserts of the row. **"Produces a
  world that is refused at check, and fails"**: the planted kit's `expand` answers `ok: false` with the refusal.
- **Nine of the ten starts** has a test of its own, so the lint's clauses are judged apart from the backend's motion.

## Where the issue and the base disagree

The issue's opening paragraph reports a probe of the pinned build. Three of its statements don't hold through
`deep-physics` at this base, because the wrapper gives a body that has `ccd: true` the backend's contact prediction
as well as its sweep (#191: `crates/deep-physics-rapier/src/lib.rs`, where bodies are built), and that prediction
holds bodies the sweep never tests.

1. **"While both have `ccd` on, the moving ball passes through the resting one in nine of the ten starts"**
   (criterion 4). At the base it passes in none of ten, at every first gap probed, 0.5 to 60 m. The test asserts the
   criterion's nine and fails at the base. With the base's own `--planted swept_collision_off`, which leaves no sweep
   and no prediction, the same ten starts pass in nine, so these starts give the issue's count where nothing holds
   the pair. To pass, the wrapper would have to stop holding two bodies that both have `ccd` on, which the issue's
   Scope doesn't list; or the sentence changes, which is the owner's to say.
2. **"A kinematic box at 30 m/s passes through a resting ball whatever `ccd` either holds."** At the base the box with
   `ccd: true` is accepted and strikes the ball at step 4. No criterion asserts that motion: criterion 1 has the box
   pass with `ccd` on the ball or off, which holds, and has `ccd` on the box refused.
3. **"Head on at 20 m/s each they do in five starts of ten"**, whatever their `ccd`. At the base, 2 m apart: one of
   ten with `ccd` on one, none with `ccd` on both, three with none. Criterion 5 asserts no count at 120 Hz.

And one tension inside the issue: after a held hit the struck ball of criteria 2 and 4 moves 0.15 to 0.5 m a step with
`ccd` off. #191's rule flags it (the base does, at step 4), and the Scope's pair rule read alone would flag the two
after the hit as both fast. The criteria say the lint raises nothing, and the tests hold them to that over the whole
run: the fix the base records there, `ccd` on the struck ball, is the one the issue's opening shows fixes nothing.

## Readings at the base

Where the base stands, not expected values (`BASE-FAILURE.txt` has the runs):

- The fixture, 12 steps: the box at x = −0.91, −0.66, −0.41, −0.16, 0.09 … 2.09 m; the ball at rest at every step,
  with `ccd` on it or off; no issue. With `ccd: true` on the box: no issue at check, and the ball leaves at 30 m/s
  from step 4.
- The dynamic bat: the ball is struck in step 4 and leaves at 59.406 m/s; the base raises `physics.fast_body` for
  `ball` at step 4 (0.149 m). Under `--planted swept_collision_off` the ball stays at rest behind the bat.
- The bar: its centre never moves; no issue; `expand` writes no row.
- The shot: with `ccd` off on `resting`, never past in any start, both leave at 50 m/s, and the base flags `resting`
  at step 4. With `ccd` on both: never past in any start, no issue.
- Head on at 120 Hz: `left` is past `right` in start 0 and the two stop each other in starts 1 to 9; the base flags
  `right` at step 1 (0.167 m). At 480 Hz: no swap in any start, no issue.
- `expand` of the fixture's world named through its scene answers a refusal ("the world must be an object"); over
  #191's ball it writes its one row.

## Not asserted, because no criterion says so

The shape of `caps()`'s data (Scope's first line; no criterion reads it); `ccd: true` refused on a static body; a
pair's issue's step beyond being a step of the run, or any move or half extent on it; the severity of a pair's issue,
and a playtest run that holds a pair failing; the kit writing no row for a body that is not fast, beyond the box; the
kinematic fix's words beyond `dynamic` and no `ccd`; the both-fast fix's "or slow them"; how many 120 Hz head-on starts
pass; the box with `ccd` on it passing the ball; the bar's step; the lint with `ccd` on the fixture's ball; any world
in 2D or on wasm32; a sweep run by the wrapper for a kinematic body, a sensor crossed between steps, a character body
and soft bodies (the issue's Not in this task).

## What the implementer adds outside this folder

The six planted names, the issue `kind`, the refusal, the lint's new rules and `expand` of a scene's world, in
`deep-physics-rapier` and `deep-canvas-physics`; `'tests/acceptance/2239/'` in `scripts/lanes.mjs`'s `alone` list.
Nothing in this folder changes.
