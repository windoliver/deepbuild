# Acceptance tests for #189, the lab: saves across a runtime change, and worlds in a save's content

Written first, blind, from issue #189 ("Saves for games: bound to a state layout, games that end, carry records, and
saves replayed after a runtime change", read live), the design sections it links and base commit `531da1ef0`, by a job
that never saw an implementation (this worktree's HEAD was `4bf2fc7ad`, #2899's merge of moved pack kinds on top of
`531da1ef0`, which touches no save, world, logic or seal code); none existed, and no other branch, worktree, pull request,
plan or session was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind
redraft of this job (design: Dogfooding).

This folder holds one part of #189's suite: a lab with a world and logic. It owns criteria 8 and 10 and one leg of
criterion 11 ("re-deriving the lab's 1,800-step save under 5 s"). Criterion 11's other legs (opening a save of 48
written pages of a 32 MiB memory, logic.layout over one fixture save and 60 steps, a migration of 32 MiB, and a piece
without saves gaining no work per frame) belong to another job, in `tests/acceptance/189/saves/`, and aren't here;
nor is any other criterion.

## What was read

- The issue, live (`gh issue view 189 --repo windoliver/deepbuild`): its Scope, Fields, thirteen criteria and Proof.
- `docs/technical-design.md`: Saves, Saves across changes, Carry records; Dogfooding. AGENTS.md.
- `docs/canvas-primitives.md`: Logic: saves; Logic: saves across changes; Logic: carry records; Check input: logic
  kinds; Registry and seal and its runtime digest; World and backend `physics.world@1`.
- At the base, for surfaces and patterns only: the suites `tests/acceptance/534/` (saves, their files, `open_save`,
  planted names, the budget judge), `1920/` (the runtime digest and its test builds), `522/` (worlds, inputs other
  modules fire, checkpoints, restores), `1041/` (the app's `logic` call over a piece that declares saves, the layout
  probe), `182/` (a logic item reading a character body's `grounded` beside its world in `deep-show`); the crates
  `deep-show` (`main.rs`'s calls and `--planted`, `logic.rs`, `picks.rs`'s `logic` call, `physics.rs` and its
  `test-physics-rapier-patch`), `deep-play` (`logic.rs`, `worlds.rs`, `derive.rs`: where the app and the web player bake
  a piece's worlds and logic), `deep-logic` (`saves.rs`: #534's saves, logic state only), `deep-physics-rapier`
  (`character.rs`, the runner's `bake` and `restore`); `scripts/proof-change.mjs` (criterion IDs),
  `scripts/benchmark.mjs` (`judgeLimit`, `fingerprint`), `scripts/lanes.mjs`.

What the base does, which these tests don't credit: `deep-show`'s `logic` call steps a document's logic items on its
track, its worlds baked first on the core input track and each `<world>.<body>.grounded` read delivered from that bake
(#182); `schedule` publishes `runtime_digest` and `set_digest` (#1920); `test-physics-rapier-patch` moves the physics
implementation's pin and nothing else; #534's saves live in `deep-logic` and hold logic state only. At the base
`deep-show` keeps no save: its `logic` call takes no `saves_dir` (it ignores the key) and reports no `saves` and no
world checkpoints, it has no `open_save` call (a scenario holding one is `bad_input`), no notice, neither test feature
below and neither planted name.

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node scripts/throttle.mjs build --wait 240 -- sh scripts/lease \
  npx vitest run --root tests/acceptance/189/lab --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/189/lab/tsconfig.json
rm -rf tests/acceptance/189/lab/node_modules/.vite
```

Each file builds what it drives once, in `beforeAll` (four hours allowed), honoring `CARGO_TARGET_DIR`, with
`CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set and Homebrew's rustup put on PATH when present, and
copies each binary out of the target folder:

| File | Builds (`cargo build --locked -p deep-show --bin deep-show …`) |
|---|---|
| `ac08-rederived.test.ts` | no features (`full`, the default); `--features test-physics-rapier-patch-drift`; `--features test-physics-rapier-patch-heavy` |
| `ac10-world-content.test.ts` | no features (`full`) |
| `ac11-rederive-budget.test.ts` | `full` and `--features test-physics-rapier-patch-drift`, on macOS only |

A test that asks for a build that failed fails at "the binary builds", with cargo's error; without cargo it reads
`BLOCKED:`. Every test passes a 60-minute timeout. Evidence stores, saves folders and binaries are temporary and
deleted. Node built-ins and vitest only; nothing is imported from another suite but `scripts/benchmark.mjs`'s judge.
No process is started but `cargo` and `deep-show`, each waited for; none is stopped by name or port.

**`scripts/lanes.mjs` needs these lines** (this job writes only its folder; the implementer adds them): the files
build `deep-show` three times and criterion 11's leg reads a timing.

```js
alone.push('tests/acceptance/189/lab/');
timed.push('tests/acceptance/189/lab/ac11-rederive-budget.test.ts');
```

Hosts. Criterion 11's leg is pinned to the reference Mac ("on the reference Mac in the local preflight"): on any other
host it fails `BLOCKED: … is pinned to the reference Mac` before it builds or measures. On a Mac its readings are
judged by `scripts/benchmark.mjs`'s `judgeLimit` (five readings after a warm-up; a reference Mac on mains power, Low
Power Mode off, thermal state nominal, load under the core count), as #534's criterion 4 judges its budgets; anything
but PASS fails, naming the judge's reason. Criteria 8 and 10 run on every host.

## The lab (helpers.ts)

One document, `The lab`: a 41 s scene at 60 frames a second with the press controls `go`, `hop` and `back`, a camera,
the world `lab` and the logic item `rules`, its program kept in the scenario's evidence store by SHA-256.

- **The world** `lab` (`physics.world@1`, 60 Hz, 4 substeps, gravity (0, −9.81, 0), checkpoints at the default
  every 60 steps): the static floor `near` (top at y 0, x −2 to 3), a pit 1.4 m wide, the static floor `far` (x 4.4 to
  16), the pit's static floor 20 m down (x −10 to 100, so a hero in the pit walks on it to the end), the static `wall`
  (0.4 × 2 × 4 m, standing on `far`, its centre at x 12.2), a dynamic 0.5 m `crate` dropped from 2 m beside the path
  (it settles on `near`), and the character `hero`, #182's capsule (radius 0.3 m, half height 0.6 m) standing at x 0.
  Inputs: `go` moves the hero +x at 2 m/s, `hop` launches it at 4 m/s up, `back` moves it −x at 2 m/s, each
  `on: {control, each: entry}`.
- **The track** from step 0: `go` at step 0, `hop` at step 87 (the hero at x 2.9, 0.1 m before the pit), `back` at step
  1,900. Launched, the hero is off the ground about 50 steps and lands on `far` 0.13 m past its edge, walks into the
  wall and stays against it; at 1,900 it walks back and falls into the pit (off the ground about 121 steps). Under
  twice the gravity its launch falls short, 1 m below `far`'s top when it meets `far`'s side, and it falls to the pit's
  floor (about 99 steps off the ground).
- **The logic item** `rules` (60 Hz, `reads: ["lab.hero.grounded"]`, `writes: {alive: i32, request: i32}` in that order,
  `saves: {slots: 1, request: "request"}`): a program written here as WebAssembly bytes (one 64 KiB page, no state
  layout exported, so its layout is its program hash). Each step reads the hero's grounded reading; its memory counts
  the steps off the ground in a row, landings and steps on the ground; more than 70 steps off the ground in a row
  marks the hero dead for good. It writes `alive` (1 until dead) and `request` (1 at the end of step 1,799 only), so
  slot 1 is saved at step 1,800 (#534's numbering: the state before step 1,800).
- **The fix** of criterion 10 moves the wall's centre to x 12.7 and changes nothing else.

## The surface under test

The issue names saves of every carried state, the runtime digest, re-derivation by replaying the save's track
headless, one notice, a new save beside the old one, refusals naming the world, and planted twins, but no command line.
The surface is `deep-show run` (#393's convention: one scenario line in, one answer line out, one reply per call), the
app's engine, which already bakes a piece's worlds and logic items together (`deep-play`) and seals the runtime digest
(#1920). **Every call, field, reply field, code, feature and planted name below that the issue or the design doesn't
give is this job's invention**, the smallest surface the criteria need, extending the base's `logic` call, #534's
`open_save` and save files, and #1920's test builds; the implementer builds exactly these, or a dispute goes to a blind
redraft. Calls and fields not named here stay as their own suites define them.

### Builds: #1920's mechanism for a test build of the physics module

A test build is a test feature of `deep-show`, built beside the default `full` set, in no shipped build:

| Feature | The build |
|---|---|
| `test-physics-rapier-patch-drift` | the full set with `test-physics-rapier-patch`'s physics implementation record (#1920: rapier3d's pin moved to another 0.36 patch, so `schedule`'s `runtime_digest` differs from `full`'s and `set_digest` doesn't), whose backend builds every world as if its document declared its gravity times 1.000001: "a test build whose physics implementation differs", whose world steps to other bytes while the lab's logic reads the same |
| `test-physics-rapier-patch-heavy` | the same record, whose backend builds every world as if its document declared twice its gravity: criterion 8's "planted build whose physics change kills the hero" |

A test selects one by building `cargo build --locked -p deep-show --bin deep-show --features <feature>` and running that
binary; each accepts the same documents as `full` (the lab names no `backend`). The gravity applies wherever the world's
gravity does, its character controller's fall included.

### Saves in a document with worlds

- A logic item's **`saves`** is the design's field (Logic: saves), as #534 built it. In a document with worlds, a save
  holds every canvas module's carried state at its step: each logic item's, as #534's does, and each world's as its own
  checkpoint holds it (the backend's whole world, its static bodies included). It is bound to the state layout, the
  content (the piece's data assets and **each world whose state it holds, by hash**) and the module-set digest, and
  carries the seal's **runtime digest** (`schedule`'s `runtime_digest`, not `deep-logic`'s stand-in) and its input
  track from step 0 by hash.
- **Save files** are #534's: the saves folder keeps each save as `<sha256>.save`, one JSON header line (every binding
  field, readable without the state), a newline, then the state in the implementer's encoding; written under a
  `*.tmp` name and renamed once it reads back whole; each slot keeps its newest save and the one before it. Header
  fields read here: `slot`, `step`, `layout`, `content`, `modules`, `runtime` (64 hex). The folder may hold other files
  of the implementer's, never named `*.save` or `*.tmp`.
- **The save's track** is kept by its hash where the app keeps the piece's saves or evidence (the saves folder, or the
  evidence store the scenario names), so another process of another build finds it. The tests copy a saves folder whole
  and keep one evidence store for every process of a file.

### `logic`, with `saves_dir`

`{"call": "logic", "doc", "steps", "track", "saves_dir"?: folder}`, the base's call, plus:

- **`saves_dir`**: the folder the app keeps the piece's saves in. A step that writes slot s into its item's `request`
  saves slot s once the step ends, as #534's `bake` does. Without it no save is written, as at the base.
- The reply gains **`saves`**: `[SaveWritten]`, each save its steps wrote, once it read back whole (#534's shape:
  `{"item", "slot", "step", "hash": the file's sha256, "file", "ended", "deep_hash": {<carried state ID>: 16 hex},
  "write_ns", "on_ui_thread"}`); `[]` when none.
- Its **`checkpoints`** hold, beside each logic item's (`{<item ID>: [{"step", "deep_hash"}]}`), **each world's**, by
  world ID: the world's checkpoints at its ring's steps (every 60 here) over the steps run, through the state after the
  last, `deep_hash` the physics module's full-state hash of the checkpoint (16 hex, #2009's).

### `open_save`

`{"call": "open_save", "doc", "saves_dir", "slot", "track"?: [Entry], "steps": n}`: the viewer opening slot `slot`'s
newest save that reads back whole, from the app, for the piece the document `doc` presents (its last `deep_show`), as
#534's `open_save` does: every carried state, each logic item's and each world's, restored into fresh instances as a
seek restores, then `track` played on from the save's input position to step n − 1, each world stepped on from its
restored state and each world reading read from those steps. Here `track` holds only the viewer's entries after the
save; a re-derivation replays the save's own track, by its hash, never the call's.

```text
Opened   = {"ok": true, "opened": {"hash", "file", "step", "via": "straight" | "migration" | "rederived", "from"?: the old save's hash},
            "notices": [Notice], "deep_hash": {<carried state ID>: 16 hex}, "checkpoints": {<carried state ID>: [{"step", "deep_hash"}]},
            "worlds": {<world ID>: {<body ID>: {"pos": [x, y, z], "rot": [x, y, z, w]}}}, "steps": [...], "rederive_ns"?: ns}
Refused  = #534's {"ok": false, "code": "save_refused", "save": hash, "differs": [Differ], "damaged": [...]}, a world's Differ
            {"what": "content", "world": <world ID>, "save"?: its hash in the save, "piece"?: its hash now}
Differs  = {"ok": false, "code": "replays_differently", "save": the old save's hash, "notices": [Notice]}
Notice   = {"kind": "runtime_changed", "save": the old save's hash, "changed": [{"interface": "physics@1", "implementation": name}],
            "replays": "same" | "differently", "array"?: "<item ID>.<name>", "text": string}
```

- **`checkpoints`**: each carried state's, the opened state first (at the save's step), then every checkpoint step
  after it through n. **`worlds`**: every body of each world, static ones included, as the opened world holds it at the
  save's step. **`notices`**: `[]` on every open that shows none.
- **Only the runtime digest differs** (the save's layout, content and module set match the piece's, and its `runtime`
  isn't this build's `runtime_digest`): the open shows exactly one Notice and re-derives the save, replaying its own
  track headless from step 0 to its step under this build, with save requests, `ends` and carry records off; then it
  compares each logic item's state there (memory, globals, arrays) with the old save's.
  - The same: the result is written as a new save in the slot, bound to this build's runtime digest (its header's
    `runtime`), with the old save's layout, content and module set, and opened: `via: "rederived"`, `from` the old
    save's hash, `hash` the new one's; `replays: "same"`; `rederive_ns` is the wall time from reading the old save
    until the new one read back whole. The old save's file stays as it was.
  - Not the same: `replays_differently`, nothing opened; the Notice has `replays: "differently"` and `array`, the first
    array that differs, the first in its item's `writes` order whose values differ, as `<item ID>.<name>`; the slot's
    `*.save` files stay as they were. The re-derived save waits for the viewer's click, which isn't tested here (it may
    be held in a file of the implementer's, never `*.save` or `*.tmp`).
  - `changed` names each implementation the build's runtime digest covers, as `schedule`'s
    `interfaces["physics@1"].implementation.name` names it (here physics@1's alone, #1920); `text` is the words the viewer
    reads: it names that implementation, and with `differently` says the game replays differently under this build and
    names the array. The notice comes once per cause and never again for that save: the new save, opened again, shows
    none.
- **A world's content differs** (here a static wall moved): `save_refused`, with a `content` Differ naming the world.

### Planted twins (`deep-show run --planted <name>`)

Each is one criterion's wrong program, reachable only through the startup argument (as #1920's planted seals are),
working in any build, and changes nothing else:

| Name | Criterion | The wrong program |
|---|---|---|
| `restore_loads_old_world` | 8 | a save whose runtime digest alone differs opens as one whose digests all match: straight, its carried state as the save holds it, the world's backend bytes loaded into this build's world, with no re-derivation |
| `content_leaves_out_worlds` | 10 | the content a save binds, and the piece's it is matched against, hold the piece's data assets only, never a world; the tests pass it to the process that writes the save and the one that opens it |

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: the first 8 hex digits of the SHA-256 of each criterion's text as the issue
holds it, trimmed, white space collapsed. Each test's name starts with its criterion's ID.

| # | ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|---|
| 8 | `#189.4e3f31a0` | `ac08-rederived.test.ts` (3) | **1.** The lab saved at 1,800 in `full` (header `runtime` = `full`'s `runtime_digest`); the drift build's runtime digest differs and its module set doesn't, and its fresh run's world full-state hash at 1,800 differs from `full`'s while the logic item's is the same. Opened there (only the entries after the save handed in): one Notice, `runtime_changed`, naming the old save, `physics@1` and its implementation (in `changed` and its words), `replays: same`; `via: rederived` from the old save at step 1,800; the slot holds exactly the old save, its bytes unchanged, and the new one, bound to the drift build's digest and the old one's layout, content and module set; every full-state hash of `rules` and `lab` at 1,800, 1,860 … 2,400 equals a fresh run's of the same track in the drift build. Opened again in another process: straight, the new save, no notice, no save written, the same hashes. **2.** The judge that passes test 1's open fails `restore_loads_old_world`'s, naming the save and the implementation. **3.** The heavy build: the hero is dead by step 1,799 in a fresh run there; the open answers `replays_differently` for the old save, opens nothing, shows one Notice with `replays: differently` and `array: rules.alive` (its words name `alive` and the implementation), and leaves the slot's one save in place, bytes unchanged. Fails on: the base; a save without the world's state, its track or the runtime digest; a re-derivation that replays the call's track or the world readings the old bake recorded; a re-derived save that overwrites the old one or isn't bound to the new digest; a notice shown twice, or none; a restore of the old world's bytes (the twin); a mismatched replay opened by itself |
| 10 | `#189.dfd0da6e` | `ac10-world-content.test.ts` (2) | **1.** The lab saved at 1,800, opened after the fix (same program, so the same layout): `save_refused` for that save, a `content` Differ naming `world: lab`, no other kind; the save's bytes stay. **2.** The real save reopened in the unmoved lab: straight, every static body where the document draws it (`judgeStatics` passes). Under `content_leaves_out_worlds` (writer and opener): it opens straight after the fix with the wall at x 12.2, where the save had it, while the document draws it at 12.7, and `judgeStatics` fails, naming world `lab` and the wall. Fails on: the base; a binding without the worlds (the twin); a refusal that names no world |
| 11 | `#189.9badbff7` | `ac11-rederive-budget.test.ts` (1) | Reference Mac only (BLOCKED elsewhere): re-deriving the lab's 1,800-step save in the drift build, each reading a fresh copy's open (`via: rederived`) and its `rederive_ns`, judged by `judgeLimit` against 5,000 ms |

Test count: 3 + 2 + 1 = 6.

## Readings where the issue leaves a choice

- **The surface.** `deep-show`, not `deep-logic`: only the app bakes a piece's worlds and logic items together
  (`deep-play`, which the app and the web player share), and only its seal computes the runtime digest the save carries
  and #1920's test builds move. The web player's side is criterion 9's, another job's.
- **"A test build whose physics implementation differs, so its runtime digest differs, with the same layout, content and
  module set."** #1920's `test-physics-rapier-patch` moves the digest but steps every world to the same bytes, so a
  planted restore of the old world's bytes would pass "that comparison"; the criterion needs results that differ. The
  drift build keeps that record and nudges gravity by a millionth: the world's bytes differ (the crate's fall, the
  hero's arc), the hero's grounded reading and so the logic state don't. The test checks both on fresh runs before it
  opens anything, so a drift build that changes the logic state fails there, naming that.
- **"A planted build whose physics change kills the hero."** A test feature, not a `--planted` name: it is a build whose
  physics differs, and the app in it is the real one. Twice the gravity makes the lab's launch fall short of `far`.
- **"Re-derives the save by replaying its track headless."** The open is handed only the entries after the save, so a
  re-derivation that replays anything but the save's own track misses the walk and the launch and gives other
  full-state hashes. Whether it drew frames isn't observable here.
- **"Gives the full-state hashes of a fresh run of the same track in that build."** Each carried state's full-state
  hash (`deep_hash`) at every checkpoint from the save's step through the next 600 steps (1,800 to 2,400, every 60),
  the logic item's and the world's, against the `logic` call's run of the whole track from step 0 in the same build.
- **"Fails that comparison, naming the save and the implementation"** and **"fails, naming the world"**: the
  comparisons are the tests' judges (helpers: `judgeRederived`, `judgeStatics`), each run on the real program's output
  it must pass; their failures name the save's hash and the implementation as `schedule` names it, or the world and the
  body.
- **"Shows the notice naming the first array that differs."** The first of the logic item's arrays, in its `writes`
  order, whose values at the save's step differ from the old save's; in the lab only `alive` can, so the order rule
  isn't what decides it. It is named as the `logic` call names arrays, `rules.alive`.
- **"Doesn't open the re-derived save by itself, and leaves the slot's saves in place."** The reply opens nothing
  (`replays_differently`) and the slot's `*.save` files are the ones it held, byte for byte; the viewer's click that
  would open the re-derived save isn't tested.
- **"The old one's bytes stay."** The old save's file is byte for byte as it was; the slot then holds it and the new
  one (the lab saves once, so the keep rule drops nothing).
- **"Opening the new save again shows no notice."** A second open of the slot, in another process of the drift build,
  opens the new save (the slot's newest) straight with `notices: []`.
- **"The wall where the save had it while the document draws it moved"**: the opened world's `wall` (Opened's `worlds`)
  against the moved document's pose for it. A drawn frame isn't read: the document is what draws the wall.
- **"Keeps its program's layout"**: the fix changes the world only, so the program, and with it the layout (its program
  hash, as it exports none), is the save's; the test checks the program hash is unchanged.
- **Criterion 11's "compared with the merge base"**: as #534's suite reads it, the leg is judged against its absolute
  limit on the reference Mac with the repository's judge; the preflight's budget lane and its task are the
  implementer's.

## Checked at the base, and not

Checked: `npx tsc -p tests/acceptance/189/lab/tsconfig.json` exits 0; the logic program's bytes validate and, stepped
in Node's WebAssembly with a stood-in reading (off the ground 50, 70, 71 and 99 steps from step 88), keep `alive` 1
through 70 steps and mark the hero dead at more, and write `request` 1 at step 1,799 only (a scratch check, not
committed); cargo refuses both test features at the base. Not checked: the lab run through the base's `deep-show`
(this Mac's build queue held ten builds ahead of this job's for the whole session, so no `deep-show` was built here):
the hero's arc, landing and fall, the drift build leaving the logic state alone, and the deep_query region map are this
job's reading of the base's code and #182's suite, not a run. A dispute over the lab's numbers goes to a redraft.

## What the implementer adds outside this folder

This job writes only `tests/acceptance/189/lab/`.

- The two test features in `crates/deep-show/Cargo.toml` and their physics module (beside `test-physics-rapier-patch`
  in `crates/deep-show/src/physics.rs`).
- Saves of every carried state in `deep-show` (the `logic` call's `saves_dir`, `saves` and world checkpoints;
  `open_save`; the notice; the re-derivation; a world's content Differ), through `deep-play` where the web player
  shares it.
- The planted names `restore_loads_old_world` and `content_leaves_out_worlds` in `deep-show`'s `planted_named`.
- The two `scripts/lanes.mjs` lines above.
