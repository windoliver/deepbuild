# Acceptance tests for #533: readings and every player's entries in the read region, the logic@1 seal, and builds without physics

Written first, from issue #533 (its Scope, its four acceptance criteria and its Proof line: "The reading and
player-order fixtures, the logic@1 seal's patch-version test, and the build without physics"), its Oracle note (no
upstream test checks any criterion), the design sections it names and the base commit, by a job that never saw an
implementation; none existed, and no other branch or worktree was read. The base is this worktree's HEAD, `6042ef5a`
("Merge pull request #1728 …"), which holds #531's and #532's logic module (`crates/deep-logic`) and #238's sandbox
module. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this
job (design: Dogfooding).

## What was read

- The issue, live with `gh issue view 533 --repo windoliver/deepbuild`.
- `docs/technical-design.md`: The logic module (Logic; Sandbox and budgets; Logic bake and checks); Scenes, physics and
  the canvas core (Logic, Shared play); Dogfooding. AGENTS.md.
- `docs/canvas-primitives.md`: Canvas module; Canvas module: interface and implementation; Registry and seal and its
  runtime digest; Array and table: column view (`<world ID>.occurrences` is the physics module's entry; "a column whose
  form no entry in the build fills belongs to a document that needs a missing module, refused with `module_missing`");
  Phase (the time order in simulate, #137's); Input track; Input track entries; Logic `logic@1`; Logic: readings;
  Logic: checkpoints and bake; Net `net@1`, Net: rollback, Net: this copy's player; Document envelope.
- At the base: `crates/deep-logic` (its JSON-lines calls, `Entry` with `player`, `track_of`'s order, the read region's
  control slot, `--planted`), `crates/deep-show` (`modules()`, `interfaces()`, `sandbox_needs_logic`, its test features,
  `planted_named`, `eval`'s `arrays`, the evidence store a document's assets are read from, the kit's `bit` part in
  `src/kit/interface.rs`), `crates/deep-canvas/src/registry/mod.rs` (`KNOWN_MODULES` names `logic` and `physics` at
  `full`; neither module is in the repo's `full` build), and the suites `tests/acceptance/531/`, `532/`, `238/`, `185/`
  and `138/` (their READMEs and helpers, copied and cut down; nothing imported).

What the base already does, which these tests don't credit: deep-logic's bake orders a control's entries by time,
player and seq and writes each entry's player into the read region (`world.rs`), so a bake of criterion 2's two presses
already reads player 1 first; deep-show seals sandbox@1 and runs the canvas kit. It has no readings, no `append`, no
step records from a session, none of this suite's planted names, no logic module in deep-show (so no `logic@1`
interface), no physics module and none of this suite's deep-show features.

## Run them

```sh
npm ci                          # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/533 --no-file-parallelism
npx tsc -p tests/acceptance/533/tsconfig.json
rm -rf tests/acceptance/533/node_modules/.vite
```

What a run builds (honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set;
helpers.ts puts Homebrew's rustup on PATH when present):

- **The assembler** `tests/acceptance/533/wat/` (crate `acceptance-533-wat`, #532's; `wat =1.263.0`, `wasmparser
  =0.263.0`; outside the workspace, its own `Cargo.lock`) into `target/acceptance-533-wat/`. Its lockfile was made on
  this Linux machine: it differs from #532's only in the `[[patch.unused]]` entries the checkout's cargo config adds.
- **`deep-logic`**: `cargo build --locked --bin deep-logic` (criteria 1, 2 and 4).
- **`deep-show`** per feature set: `cargo build --locked --bin deep-show --no-default-features --features <set>`, copied
  out under its own name: `full`; `full,test-logic-patch`; `full,test-leave-out-physics`;
  `full,test-leave-out-physics,test-logic-needs-physics`.

Every test passes an explicit timeout (90 minutes: fresh deep-show builds take many minutes on a loaded machine).
Temporary folders (binaries, evidence stores, assembler output) are deleted. Node built-ins and vitest only. No host
beyond cargo is needed (no Docker, no Chrome, no reference Mac); an assembler that doesn't build is `BLOCKED:` with
cargo's error, and no test skips. **`scripts/lanes.mjs` needs `'tests/acceptance/533/'` in its `alone` list**: the
files build four deep-show feature sets and copy `target/debug/deep-show` after each build, which another suite's
build beside them would overwrite. This README is the instruction; the implementer makes that edit.

`BASE-FAILURE.txt` is the run at the base (its first lines give the counts and why): 10 of 10 fail for the missing
surface. The harness was checked against real components before that run, at the base: every program assembles; the
base `deep-logic` bakes the flock and the quiz (271 steps), the flock's `cx` equals `flockCx` at every step (4.5 at
step 0, 5.964899155081872 at step 270), the quiz asks 1, 0, 4, 3, 2 at steps 30, 90, 150, 210 and 270 (each question
once); `first` admitted and baked with criterion 2's two presses in either order writes `first` 1 and `n` 2 at step 3
with equal step hashes; `listen`, run in Node's own WebAssembly on a hand-made read region (count 2, values 7 and 9,
as-of 2,000 and 3,000), writes `count` 2, `values` [7, 9, 0, 0] and `as_of` [2000, 3000, 0, 0]; deep-show `full`
refuses a board with a `logic@1` item with `module_missing` naming logic, and its schedule's `text@1` kit lists the
canvas kit's parts. Not checked: `listen` through deep-logic (the base refuses a reading), and anything of deep-show's
logic module (none exists).

## The surface under test

The issue names readings recorded as entries, a test writer, a read region, planted twins, logic@1 with its
implementation and kit, test builds and `module_missing`, but no command line. As in #531's, #532's and #238's suites,
the surface is `deep-logic` for the read region and deep-show for the seal and the builds: **every call, field,
feature and planted name below that the issue or the design doesn't give is this job's invention**, the smallest
surface the criteria need; the implementer builds exactly these, or a dispute goes to a blind redraft. Calls and
fields of #531's and #532's protocols not named here stay as their READMEs define them.

### `deep-logic`: what this suite adds

- **Piece** gains `"sources"?: {<source>: {"shape": "scalar", "delivery": "latest" | "each", "max_per_step"?: n}}`
  (Logic: readings' fields on a source; these tests use one scalar source `feed`, delivery `each`, `max_per_step` 16),
  and a logic item's `reads` may name `reading:<source>` (the design's reading handle). Its read region slot is the
  design's: a u32 count and 4 zero bytes, then each value as an f64 followed by its as-of time as an i64 of
  microseconds, `max_per_step` slots for `each`; the layout names the entry `reading:<source>`, region `reads`.
- **Entry** on the input track is either #531's control entry (`{"t", "seq", "control", "value", "writer", "player"}`,
  `writer` may also be `peer`) or a **reading entry** `{"t", "seq", "reading": "reading:<source>", "value", "as_of":
  µs, "writer", "player"}` (Input track: "a reading … is an entry too, with its source and as-of time"; `seq`, `writer`
  and `player` of a reading entry are the implementer's and never compared). `bake`'s and `open`'s `track` take both.
- **`--planted`** gains two names (below).

| Call | Reply |
|---|---|
| `{"call": "append", "session", "entry": ControlEntry \| {"reading", "value", "as_of"}}` | `{"ok": true, "entry": Entry}`: the entry as the session's track recorded it |
| `{"call": "step", "session", "to": k}` (#531's) | #531's reply, plus `"steps": [StepRecord]` (#531's shape: the steps this call ran, in order) and `"track": [Entry]` (the session's whole input track so far, in track order) |

What each means:

- **A test writer** is `append` with a control entry: the entry joins the session's track as the writer stamped it
  (`t`), in the order of the calls (its arrival). The tests append only at steps not yet run.
- **A source's delivery** is `append` with `{reading, value, as_of}`: the logic module records it as one reading entry
  stamped at the first step not yet run (`t` = that step × the item's step length; before any step, step 0), so each
  value delivered is one entry, a repeated value included. A step reads, with `each`, every value recorded for it in
  the order recorded, past `max_per_step` the rest waiting (Logic: readings).
- **Track order** is by step, player and seq (Input track: a peer's entry "ordered there by step, player and seq"), and
  a step's entries reach the read region in that order, each with its player (Logic `logic@1`: "Each entry in the read
  region carries its player, 1 for a piece played alone").
- **A replay with the hub stopped** is a `bake` of the track a session recorded, in a fresh process with no `append`:
  deep-logic fetches nothing itself; the hub (#364) is what delivers, and here nothing does.

### deep-show: the logic module and the test builds

`full` holds the canvas module `logic` (it is in `KNOWN_MODULES` at `full`), implementing the interface `logic@1` with
`implementation: {name, version: semver, pins: {wasmtime: {version: sandbox@1's pin (=49.0.5, the issue's =49.0.2, moved by #2324), …}}, equivalence:
"bit", state: "canonical"}`; `schedule`'s `interfaces["logic@1"]` (#185's shape) shows it with `module: "logic"`,
`reference` its implementation's name, `kit` holding every part `text@1`'s kit holds (the canvas kit) and `behavior:
"none"`. `{"call": "kit", "modules": ["logic"], …}` (#138's) runs the logic module's own kit fixtures, at least the
parts `fixtures` and `carried_state`. In a document (Document envelope: `seed`, `transport`), a `logic@1` item's
`program` is a program's sha256, its bytes read from the scenario's evidence store (`<2 hex>/<62 hex>`, as an image's
asset is), and it plays in frames: **`eval`'s `arrays`** (#497's) reads a logic item's array `<logic ID>.<name>` of
count 1 and type i32 or f64 as a number, as the last step at or before the frame's time left it.

- **The `bit` part for a patch**: in a build whose logic@1 implementation is not the reference by version (same name,
  another version), the kit runs its `bit` part (today it runs only for another name): one case per logic kit fixture,
  each comparing this build's results with the reference's build.
- **`--planted digest_covers_version`**: the planted interface digest that also covers the implementation's version
  (as #238's `digest_covers_pins` covers its pins).

**Test features of `deep-show`** (each in no shipped build):

| Feature | What the build holds |
|---|---|
| `test-logic-patch` | the shipped logic implementation with only its version's patch changed (same name, pins, equivalence and state; same kinds, arrays and fixtures), in the shipped one's place |
| `test-leave-out-physics` | the full set's list without `physics` (as `test-leave-out-logic`; today no physics module is in the repo, so it leaves `full` as it is) |
| `test-logic-needs-physics` | planted: the logic module's manifest declares `physics` among its required dependencies (as `test-sandbox-needs-logic`) |

### Planted twins

| Name | Where | Criterion | The wrong program |
|---|---|---|---|
| `read_region_orders_by_arrival` | `deep-logic --planted` | 2 | a step's entries of a control reach the read region in the order they were appended, not by step, player and seq |
| `read_region_drops_player` | `deep-logic --planted` | 2 | the read region leaves out each entry's player (its u32 stays 0) |
| `digest_covers_version` | `deep-show run --planted` | 3 | the interface digest also covers the implementation's version |
| `test-logic-needs-physics` | deep-show feature | 4 | the logic module declares physics among its dependencies |

## Programs

`programs.ts`, WebAssembly text built against the layout `check` reports (`layoutProbe` first), each mirrored or read
back as the comments there say: `listen` (criterion 1: writes each step's reading count, first four values and their
as-of times), `firstPlayer` (criterion 2: writes the player of the first `press` entry and how many it read),
`flock` (criterion 4: 100 boids drifting toward their centre, writing its x, `cx`; `flockCx` computes the same f64
operations in the same order) and `quiz` (criterion 4: five questions shuffled at `init` by its seed, writing the
question of each second, `question`). Expected values from the issue: one entry per delivered value, the repeat
included; stamps at the first step not yet run; player 1 first; module names `logic@1`, `physics`, `module_missing`;
bit and canonical; a patch version change; `<world ID>.occurrences`.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace collapsed and the
leading `- [ ] ` dropped (`scripts/proof-change.mjs`). Each test's name starts with its criterion's ID.

| Criterion | File (tests) | What the tests check, and the wrong programs they fail |
|---|---|---|
| 1 `#533.1487ce3d` | `ac01-readings.test.ts` (1) | a session reading `reading:feed` (`each`); the source delivers 7 before step 0, 7 and 7 again after step 2, 9 after step 5, 7 after step 6; each append answers one entry stamped at steps 0, 3, 3, 6, 7 with its value and as-of time; the track holds those five entries and nothing else; the item reads at each step exactly the values stamped for it (step 3: count 2, both 7s); a bake of the recorded track in a fresh process with nothing delivering gives the same step records and hashes at every step. Fails: a value dropped as a repeat, a stamp at arrival or at a step already run, a reading not recorded on the track, a replay that reads none |
| 2 `#533.cbdc85ec` | `ac02-players.test.ts` (3) | two sessions: player 2's press (writer `peer`) then player 1's on step 3, and the other order; both write `first` 1 and `n` 2 at step 3, equal step records at steps 0 to 5, equal tracks, player 1 first. The twins `read_region_orders_by_arrival` and `read_region_drops_player` each fail the same judgement, with a failure naming step 3 |
| 3 `#533.40063163` | `ac03-seal.test.ts` (3) | `full` seals holding `logic` and `sandbox`; `logic@1`: module `logic`, a digest, bit and canonical, reference its own implementation, semver version, `pins.wasmtime.version` sandbox@1's (`=49.0.5`), kit ⊇ `text@1`'s kit, `behavior: "none"`; the kit over `logic` PASSes every part it runs, only parts of logic@1's kit, `fixtures` and `carried_state` among them. `full,test-logic-patch`: the implementation record equal but for a version of the same major and minor and another patch; logic@1's digest equal; the kit PASSes, its `bit` part PASSes one case per logic kit fixture, every other part's cases equal the shipped build's. `--planted digest_covers_version`: `full` still seals; the patch build exits 2, `interface_digest`, `interface: "logic@1"`. Fails: a digest over the version |
| 4 `#533.6d69e833` | `ac04-no-physics.test.ts` (3) | `full,test-leave-out-physics` holds `logic` and `sandbox` and no `physics`; the flock's and the quiz's boards are presented without an error issue, and `eval` at 0.5, 1.5, 2.5, 3.5 and 4.5 s reads `flock.cx` equal to `flockCx` and to deep-logic's bake at steps 30, 90, 150, 210 and 270, and `quiz.question` equal to the bake there, each of five questions once. In one scenario the flock, the quiz, a board whose item reads `lab.occurrences` and one whose item fires `{lab: ["launch"]}`: only the last two refused, each with an error `module_missing` naming physics, the first two with none. `full,test-leave-out-physics,test-logic-needs-physics`: the seal refuses, its `modules` naming `physics` and `logic` |

Test count: 1 + 3 + 3 + 3 = 10.

## Readings where the issue leaves a choice

- **The surfaces.** `deep-logic` for criteria 1 and 2, because a session is where "the first step not yet run" and "a
  test writer that appends" have a meaning and where a planted read region is reachable; deep-show for criteria 3
  and 4, because seals, interfaces, kits, test builds and `module_missing` live there.
- **"Its source delivers"**: the test is the source, delivering through `append`; the hub's fetching (#364) isn't
  driven, so "with the hub stopped" is a bake in a fresh process that nothing delivers to.
- **"A repeated value included"**: a value equal to the one before, delivered again, and one delivered twice before
  the same step with the same as-of time; with `each` the program sees both, so a dropped repeat shows in the arrays.
- **"Writes the player of the first entry it reads the value 1"**: the program's `first` array at the presses' step;
  "equal step hashes" is every step's hash equal across the two runs. **"Fails, naming the step"**: the test's
  judgement of the twin's output fails with a message naming step 3.
- **"Changes only its own patch version"**: the implementation record keeps its name, pins, equivalence and state, and
  its version keeps major and minor. Since the kit's `bit` part runs today only for an implementation with another
  name, "passes the logic kit bit for bit" is read as that part running for the patch (same name, another version)
  and passing on every logic kit fixture, with every other part's cases equal to the shipped build's.
- **"Every part of the canvas kit (#138) on this module's fixtures"**: logic@1's `kit` lists every part `text@1`'s
  does, and the kit's run of the logic module holds `fixtures` and `carried_state` (it has fixtures and carried state;
  a part a module has nothing for isn't listed, #138).
- **"A test build … without the physics module"**: `test-leave-out-physics`, which keeps physics out once a physics
  module lands, as `test-leave-out-logic` did for logic (#403).
- **"Plays the flock and the quiz"**: frames at five times read the items' arrays as their steps left them; the flock's
  and the quiz's programs are this suite's (#531's and #532's are cut down: no wind control, one write each, so the
  expected values need no control on deep-show's track and the mirror holds the flock exactly).
- **"A world's occurrence list" and "a world's input"**: `lab.occurrences` in `reads` and `fires: {lab: ["launch"]}`,
  with no world declared (no world kind exists without physics); **"naming the physics module"** is the issue's
  `what`, `path` or `module` holding the word `physics`.
- **"No other document is"**: of the four documents presented in one scenario, the flock and the quiz are presented
  with no `module_missing` and no error.

## Not tested, because no criterion reaches it here

The time order of logic and physics steps (the scope says the order is #137's, and no physics module exists); a late
peer entry's rollback through the net module; `latest` delivery, `reading.overflow`, shapes other than scalar, a
value whose shape or as-of time is refused, `readings_from`, the clock source; the planted implementation whose NaNs
keep x86_64's sign bit and the release build's refusal (Scope only: no criterion names them, and this machine has no
x86_64); the runtime digest (unchanged by a bit, canonical implementation; no criterion reads it).
