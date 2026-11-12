# Acceptance tests for #409: craft@1, a first-party pack of craft checks a brief names, generated into the one skill

Written first, blind, from issue #409 ("craft@1: a first-party pack of craft checks a brief names, generated into the
one skill": its scope, its Fields, its six acceptance criteria and its proof line, "Each craft@1 check's fixture and
planted twin, motion share against the outside film gate, and the skill's drift test"), its Oracle page, the design
rows, and the base commit `cbd5e4f98` (main, "Merge pull request #2284 …"), by a job that never saw an implementation;
none exists at the base, and no other worktree, branch or PR was read. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Criteria 1, 3, 4, 5 and 6 are
here; criterion 2, the one the Oracle page links an upstream test to, is in `tests/acceptance/409-oracle/`.

## What was read

- Issue #409 (body, as of Nov 11, 2026) and its Oracle page (`doneright/oracles/issues/409.md`, branch `doneright` of
  DeepBuildAI/deepbuild), which links the outside film gate and its tests to criterion 2 and nothing to the other five.
  Test names start `AC<n> #409.<id>`, the first 8 hex digits of SHA-256 of the checkbox text after `- [ ] `, trimmed,
  white space collapsed (`scripts/proof-change.mjs`, `criterionId`).
- `docs/technical-design.md` at the base: Document check; What done means, fixed at the start (Who drafts it, Proven on
  the base, Locked: "Only you change it"); Dogfooding's Criteria to tests, Wrong programs and the edit guard.
- `docs/canvas-primitives.md` at the base: Film audit: craft@1 (the source of every threshold and of each code's
  meaning), Film audit, Film brief (the definition job drafts the brief; the working agent can't change it), What holds
  a document to its rules and Check input ("an exception the document itself declares is its writer's own statement"),
  Shot, Transition, Camera `camera@1` and its framing, Marker, Tempo map and cue alignment, Cue list `cues@1`, Look
  `look@1`, Pack: explain@1 film recipes, Narration and captions, Score `score.music@1`, Strip and track, Bus, Spawn and
  Check input: mix kinds (per-bus power bakes at export), The editor panel's "It can never" (no writer edits a brief).
- At the base, for surfaces and conventions only: AGENTS.md; `crates/deep-show` (`main.rs`: the scenario, `claims` with
  `brief`, the planted match; `hub.rs`: `Claim`, `Planted`; `verdict.rs`: the `verdict` call and #407's brief rows;
  `film_audit.rs`: `brief_rows`, show-time admission; `kinds.rs`: `deep_kinds`; `export.rs`; `spawn.rs`; `film.rs`;
  `frames.rs`: a shot's look by asset); `crates/deep-canvas` (`CORE_CHECK_KINDS`, the registrar's `check` and `code`,
  the envelope's keys, the patch ops); `crates/deep-canvas-motion` (`shots.rs`: a shot's orbit, framing, `keyed`;
  `score.rs` and `module.rs`: sound_lock and mix.balance as the motion module's check kinds until #409); `scripts/skill.mjs`
  and `skills/deepbuild/SKILL.md`. Suites read for their harness: `407/` (imported: the build, `run`, the rows, `lookOf`),
  `407-oracle/`, `408/`, `493/` and its AC7 redraft, `502/` and `502-oracle/`, `501/` (imported: the WAV writer, the
  evidence store), `154/`, `26/`, `1399/` and `202/` (packs written at test time), `1897/` (the agent's `deep_show` on its
  claim). Every expected value comes from the issue and the design.

## What the base has

`deep-show run` with #403's claims and `verdict`, #407's `brief` beside a claim's requirements (moments, holds, cues and
sources become rows `from: {moment | hold | cue: ID}`; any other field of the brief is ignored), #493's shots, cuts,
cross-fades and keyed shots, #501/#502's `export` to MP4, and `deep_kinds`. sound_lock and mix.balance are the motion
module's check kinds (entries of `check.kind.doc@1` with a generic description), not craft@1's. There is no craft@1, no
craft row, none of the codes below, no `measure`, and none of the four planted names; the skill names no craft check.

## Run them

They build `deep-show` with cargo, so they run one file at a time. The implementer adds this to `scripts/lanes.mjs` (this
README is the instruction; this job edits nothing outside its folders):

```js
// #409's files each build deep-show and export films through the GPU; 409-oracle also runs the outside film gate.
alone.push('tests/acceptance/409/', 'tests/acceptance/409-oracle/');
```

```sh
npm ci                                   # once, if node_modules is missing
export PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
node node_modules/vitest/vitest.mjs run --root tests/acceptance/409 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/409/tsconfig.json          # type-check (exits 0)
rm -rf tests/acceptance/409/node_modules/.vite
```

Each file first runs `cargo build --locked --bin deep-show --no-default-features --features full` (through #407's
`useBuilds`), copies the binary out of `target/` (honouring `CARGO_TARGET_DIR`) and fails each test whose build failed.
No test feature is needed: the planted programs are named in the scenario. Every test writes into temporary folders and
deletes them. Node built-ins and vitest only.

## Criteria to tests

| ID | File (tests) | What it asserts |
|---|---|---|
| AC1 `#409.1b284d72` | `craft.test.ts` (20) | Per check (16 tests, the table below): the parity film's verdict holds one row `from: {craft: <check>}`, PASS with no error or warning; the twin's row FAILs with an error of the check's code naming the shot and the frame of its planted fault. A brief with no craft check gets no craft row and no craft code, the claim not FAIL; one naming ends alone gets ends's row only, failing at `shot-3` 4 s, and no `craft.shot_length` error, on a film that breaks both. The agent's own `checks` lowering shot_length's minimum to 0.5 s change nothing: its 1 s shot FAILs at the brief's 2 s, naming `shot-2` at 3 s. Planted `craft_runs_every_check` and `craft_threshold_from_agent` each fail their test |
| AC3 `#409.b866029a` | `skill.test.ts` (1) | `deep_kinds` lists one entry of `check.kind.doc@1` from the craft@1 pack per check, each with its own description, a threshold and a fix; `skills/deepbuild/SKILL.md` holds each after the check's name; a skill with shot_length's threshold one off and a check whose description changed are each reported against shot_length |
| AC4 `#409.063c7b10` | `camera.test.ts` (5) | 12° at equal framed height: `craft.camera_grammar.jump_cut` naming `medium-a` and `medium-b` at 3 s; 35° and 12° at 1.5× height PASS. A third shot orbiting from 80° to 140°, across the line through presenter and chart: `craft.camera_grammar.line` naming `side-3` at a frame of it (6–9 s), none naming `side-1` (−40°) or `side-2` (20°); orbiting from −60° to 0° PASS. A keyed shot labelled hold whose camera's channel takes it from 5 m to 4 m reads `push` in `measure.moves`, to 4.8 m `hold`. Planted `craft_jump_cut_angle_only` and `craft_camera_by_label` each fail their test |
| AC5 `#409.0dc34e08` | `example.test.ts` (1) | Against the fixture film, the film matching it on 3 of 6 measures FAILs with `craft.not_example`; the one differing on 4 PASSes |
| AC6 `#409.c2d0c9cf` | `takes.test.ts` (1) | Under `signature: {count: 1, max: 20s}`, one 18 s take PASSes; a second FAILs with `craft.shot_length` naming `take-4` at 24 s, and no error names `take-2` |
| AC2 `#409.c9b3929c` | `../409-oracle/motion.test.ts` | See that folder's README |

### Criterion 1's table: each check's parity film and planted-fault twin

Films are 320 × 180 u at 24 frames a second unless said, shots `shot-1`, `shot-2`, … of 3 s each framing the whole page,
under the look `lk-a`; each brief names the check alone, its fields at their defaults.

| Check | Parity film | Twin's planted fault | The twin's issue names |
|---|---|---|---|
| shot_length | 3, 3, 3 s | the second shot is 1 s (min 2 s) | `shot-2`, 3 s |
| camera_grammar | the presenter cut 35° apart (AC4's) | 12° apart at equal height | `craft.camera_grammar.jump_cut`: `medium-a` and `medium-b`, 3 s |
| ends | three shots of a shape | a 14-word card over the last shot | `shot-3`, 6 s |
| text_led | the card over the second of four shots (0.25) | the card over the second of three (0.33 > 0.30) | `shot-2`, 3 s |
| look_lock | every shot on the film's look | the third shot names the look `lk-b` | `shot-3`, 6 s |
| recipes | instances of two recipes (regions 1, 2) | a third recipe's instance in region 3 | `shot-3`, 6 s |
| numbers_in_script | "42 cups" over shot 2 (a story number, `data.cups`, through a template, so honest numbers passes it); the caption line says "42" | the line says no number | `shot-2`, 3 s |
| caption_band | a label at y 100 over shot 2, a caption there | the label at y 154, in the bottom 15% | `shot-2`, 3 s |
| motion_share | the lively film (the lane's) | a muted cover hides region B from 6 s to 6.75 s (a blank run over 0.3 s) | `shot-b`, 6 s (± a frame at 12 fps) |
| accents | a slam at 3 s, marked `accent`, its click at 3 s on the beat | the click at 3.25 s | `shot-2`, a frame in [3, 3.25] s |
| not_example | differs from the fixture film on 4 of 6 (AC5's) | matches it on 3 of 6 | any of its shots, a frame in [0, 12] s |
| silences | an ambience bed with gaps at 2–2.8 s and 5–5.8 s | a cue marker at 5.4 s, inside the second gap | `shot-2`, a frame in [5, 5.8] s |
| sound_coverage | ambience, foley and music under the one section; an `action` moment at 4 s with its hit at 4 s | the hit at 4.25 s | `shot-2`, a frame in [4, 4.25] s |
| sound_bridges | beds that cross both cuts by 0.5 s | a 0.2 s hush over the cut at 3 s (one bridge) | `shot-1` or `shot-2`, 3 s |
| mix.balance | music of 1 kHz at 0.1 | shot 2's music is 60 Hz at 0.5 | `shot-2`, a frame in [3, 6] s |
| sound_lock | a score whose pad is in the palette [pad] | a horn whose first note is at bar 2 beat 3 (3 s at 120 BPM) | `shot-2`, 3 s |

## The surface under test

**No new binary and no new call.** #393's `deep-show run` with #403's claims and `verdict`, #407's `brief` on a claim,
#501/#502's `export`, #412's `deep_kinds`. What the issue names and the base lacks is added as below. Every name marked
*(chosen)* is this job's: the issue and design leave it open, and an implementation builds exactly it or disputes it
through a blind redraft.

### The films and the claims

Each film is the working agent's work: the agent presents it with `deep_show` from its session (`sess-alpha`), on a
panel of its own, and it is the one deliverable of a claim of the agent's with no requirement and the film's brief. A
film that isn't `presented`, and an export that isn't `exported`, fail the test as `BLOCKED: …`, naming it. The films
whose checks read sound (accents, silences, sound_coverage, sound_bridges, mix.balance) are exported to an MP4 before
their verdict (`export` with `video: {codec: h264}`, `audio: {codec: aac}`), so a check that reads "the export's
per-bus power bakes" has an export of the revision it judges; a check that bakes the mix itself may ignore it.

### The brief *(chosen: the field's shape)*

#407's brief gains the issue's field `craft: [check]`: each entry is `{check: <name>, …its fields}`, the name one of the
sixteen the Fields list (`shot_length`, `camera_grammar`, `ends`, `text_led`, `look_lock`, `recipes`,
`numbers_in_script`, `caption_band`, `motion_share`, `accents`, `not_example`, `silences`, `sound_coverage`,
`sound_bridges`, `mix.balance`, `sound_lock`), its fields the issue's names with times as `"<n>s"`; a field left out is
at its default. The tests write: `camera_grammar.line: {through: [presenter, chart]}`, `sound_lock.instruments: [pad]`
(the brief's sound palette), `shot_length.signature: {count: 1, max: "20s"}`, and `not_example.fixtures: [doc ID]`
*(chosen: how a fixture film is named; each a film the hub holds, here one you present with `deep show`)*.

### The rows *(chosen: `from.craft` and `measure`)*

Each check the brief names adds one row to the verdict, `{id, kind, result, issues, from: {craft: <name>}, measure}`,
decided as #407's are (FAIL on an error, BLOCKED where it can't decide, else PASS). `kind` isn't read. `measure` is the
measure the check's threshold is held to; two are read: motion_share's `measure.share` (the share, 0 to 1) and
camera_grammar's `measure.moves` (`{<shot ID>: hold | push | pull | pan | orbit}`, each shot's move as read from its
camera's evaluated poses). A check the brief doesn't name adds no row and raises no code anywhere in the verdict.

### The codes *(chosen)*

Each check fails with `craft.<check>` (`craft.shot_length`, …, `craft.mix.balance`, `craft.sound_lock`), except
camera_grammar's jump cut, `craft.camera_grammar.jump_cut`, and a camera across the brief's line,
`craft.camera_grammar.line` (its other faults' codes aren't read). An issue is in the design's shape (`{check, code,
severity, ids, path, actual, t, what, fix}`); it names its shot in `shot`, a cut's two in `shots: [out, in]`
*(chosen)*, read anywhere but the prose (`what`, `fix`); `t` is the frame, integer flicks or `"<n>s"`.

### The checks' own statements *(chosen: where they're read)*

Each craft@1 check is an entry of the document check registry `check.kind.doc@1`, named by the check, with `pack`
naming the craft@1 pack (a string holding `craft`), and its own `description`, `threshold` and `fix` as text, on the
entry's `value` or on the entry itself, read through `{call: "deep_kinds", op: "list", registry: "check.kind.doc@1"}`
and every page its `next` cursor gives. The listing's stand-in description ("an entry of …") isn't the check's own.

### The skill

`skills/deepbuild/SKILL.md`, the one skill. For each check, some mention of its name is followed, within 2,500
characters, by its description, threshold and fix as the check states them, compared without backticks or bold, white
space collapsed, case ignored. How the generator lays them out is the implementer's.

### The agent's threshold *(chosen: the attempt)*

The design gives the brief to the definition job and no writer a way to edit it (Film brief; What done means: "Only you
change it"; Check input: a document's own `checks` are its writer's statement). The agent's attempt is the one place it
writes: its film's own `checks: [{kind: "film.audit", craft: [{check: "shot_length", min: "0.5s"}]}]`. It must be
refused or ignored; the claim is judged by the brief.

### The pack *(chosen)*

recipes counts the distinct pack recipes a film's items instantiate: explain@1's and piece@1's film recipes once they
land, any pack recipe until then (the base has no film recipe pack). The test pack `acme/reel@1.0.0`, written at test
time and installed by the scenario's `packs`, has three recipes, `reel.title@1`, `reel.badge@1` and `reel.chart@1`, each
one rect. A count over `max` names the shot that first frames the extra recipe's instance and that shot's first frame.

### The planted programs (the scenario's `planted`, reachable only there) *(chosen names)*

| Name | The wrong program | Criterion |
|---|---|---|
| `craft_runs_every_check` | every craft check runs on a claim with a brief, named or not | AC1 |
| `craft_threshold_from_agent` | a craft check takes a threshold from the deliverable's own `checks` (a film.audit input's `craft` entry) over the brief's | AC1 |
| `craft_jump_cut_angle_only` | camera_grammar judges a cut by the angle alone, ignoring `size_min` | AC4 |
| `craft_camera_by_label` | camera_grammar reads each shot's move from its `move` label, not its camera | AC4 |

Added to `Planted` in `crates/deep-show/src/hub.rs` and named in `src/main.rs`'s planted match; at the base each makes the
scenario `bad_input`.

## Fixtures

All built at test time by `helpers.ts`, truth by construction; nothing is committed but code. 2D films are 320 × 180 u
at 24 frames a second with `safe: 8`, on a 2D camera, under `lk-a` (#407's `lookOf`: ground 255, muted 124, accent 160,
raised 245, ink #1b1d22), `lk-b` among their assets. Texts are shown over a span by hold keys on `adjust.opacity`. The
card is 14 words at 22 u over most of the frame, past `words` (8) and most of its area by any reading. Sound films hold
three buses, ambience, foley and music, and 16-bit stereo WAVs at 48 kHz (sines with 5 ms ramps; a click is 30 ms of
3 kHz dying away), each a strip on its own track. The presenter films are 3D, 640 × 360, requiring scene3d `^1`, under
the default look: the presenter (a 0.5 × 1.8 × 0.4 m box at the origin) and the chart (1.6 × 1.0 × 0.1 m, 3 m to its
right), so the line is the plane z = 0 (azimuths 90° and 270°); a shot keeps the presenter (`frame.keep`) from its own
`orbit.azimuth` at elevation 0, framed at `fill` 0.6 (0.9 for 1.5 times the height). The motion films are the lane's (`../409-oracle/README.md`). The not_example films: four 3 s shots (a wide hold,
a push and a pan onto the subject, a wide hold), a 0.5 s cross-fade at 6 s, a 120 BPM tempo map with two 6 s sections.

## Legs that read BLOCKED or INCONCLUSIVE

None by design. A film not presented, an export not written, or a scenario cut short reads `BLOCKED: …`, naming it, so a
setup failure is never mistaken for the criterion. Exports need this Mac's GPU and the encode tool, as #501's do.

## Readings where the issue leaves a choice

- **"The shot and the frame"** is where the planted fault is: the shot it falls in and its first frame. Where the fault
  is a span (a gap, a late sound, a low band), any frame of that span counts; where it is a whole film's (not_example), any
  of its shots and frames counts; sound_bridges's missing bridge may name either shot the cut joins.
- **text_led** is a shot whose text is led: the card (14 words, most of the frame) is text-led by any reading of `words`
  and area, and plain shots hold no text. `max: 0.30` is the share of text-led shots.
- **accents** are the camera's accents (a slam) landing with their sound: the slam starts at 3 s, a moment marker tagged
  `accent` marks it, a click lands there and the tempo map's beat too; only the click moves in the twin.
- **sound_coverage**'s action is a moment marker tagged `action`; its hit is a strip on the foley bus (an onset its power
  bake shows). With no treatment in the brief there is no sound table to cover.
- **silences**' cue is a marker of kind `cue`.
- **mix.balance**'s bands are read against the music bus's own level: shot 2's music is all in the low band, so it is
  over `low_max` whether judged per window or over the whole bus.
- **not_example**'s measures: the twin changes the first shot's look, the signature transition (a cross-fade becomes a
  wipe) and the tempo map's section shape (120 to 90 BPM, two sections to three), keeping the shot kinds, camera moves and
  last shot; the film differing on 4 also changes the middle shots' moves (push and pan to pull and hold). A reading of
  "shot kinds" that counts moves makes that film differ on 5, still a pass.
- **A long take** is any shot over `hard_max` (8 s) up to `signature.max`; the brief's `count: 1` declares one, the first
  in time, and a second fails, naming it.
- **numbers_in_script** reads the script's lines' words; the films' lines are `caption` lines (text with no speech job).
- **A push**: 20% closer is a change in distance over 10%, so a push; 4% is under 10%, so a hold.
- **A camera that crosses the line**: the crossing shot orbits across the plane, so it fails whether the rule is read as
  every shot's camera on the side the others keep or as no camera crossing within its shot; its issue may name any frame
  of the shot.

## Not tested

Because no criterion asks: montage spans, `max` between 6 s and 8 s, `accents_max`, `push_run_max` and `neighbours`,
`palette: one` and `looks: sequence`, `warn`, `blank_max`'s exact edge, `beds` and the sound table, `air_max`, `cut_change`
turned off, `min_differ` other than 4, the skill's layout, the reduced-motion rendition, explain@1's examples (#142).

## Not settled

- The names and shapes marked *(chosen)*: the brief's entries, `from.craft`, `measure`, the codes, `shot`/`shots`,
  `fixtures`, where a check states itself, the agent's attempt, the test pack.
- Whether a sound check reads the export the test makes or bakes its own (either passes).
- Whether a check the brief names but can't run (no export) is BLOCKED (the tests always give it what it needs).
