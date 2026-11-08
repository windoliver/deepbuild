# Acceptance tests for #497: steps on the one clock: stepping modules, held arrays and input entries that arrive late

Written first, from issue #497 (its Scope, two acceptance criteria and Proof line: "A test stepping module read at chosen
times by seeking and by playing, and the late-entry track equal by hash to the on-time one"), the design sections it names
and those they lean on, its Oracle page, and base commit `c469fe2e` ("Merge pull request #1670 …"), by a job that never saw
an implementation; none existed, and no other worktree or branch was read. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue, live with `gh issue view 497 --repo windoliver/deepbuild`: two criteria, both "(no upstream test)".
- Its Oracle page, `doneright/oracles/issues/497.md` (`DeepBuildAI/deepbuild`, branch `doneright`): no upstream test for
  either criterion (our own refusals and closed forms; seek equals play and late entries are our own invariants).
- `docs/canvas-primitives.md`: Time and the flick (the valid-rates rule: a step rate r is valid only if 705,600,000 ÷ r is
  whole; 85 Hz is not); Driver and Driver: time offsets (a look-ahead whose chain reads inputs is refused; lag never reads a
  live simulation at another time); Input track and Input track entries (a late peer entry joins at its step, ordered by
  step, player and seq, never forks and drops nothing); Logic `logic@1` (step k at k × the step length; a frame reads the
  arrays as the last step at or before t left them; `step_rate: Hz` under the valid-rates rule); Net `net@1` and Net:
  rollback (never order by arrival; a late entry is added at its step, dropping nothing).
- `docs/technical-design.md`: Dogfooding; Tests written first. AGENTS.md. `tests/acceptance/495/` (layout, `deep-motion eval`,
  `lag`), `489/input-track-scrub.test.ts` (input entries and `input: {hash, entries}`), `491/` (occurrence lists over
  `input.<control>`), `488/` (`deep-show run` scenarios, `test-*` features, `test.tick`). At the base:
  `crates/deep-motion/src/main.rs`, `crates/deep-canvas-motion/src/{input,lag,occurrence,program,doc}.rs`,
  `crates/deep-show/src/{main,frames,time}.rs`, `crates/deep-show/Cargo.toml`, `crates/deep-canvas/src/schedule/{steps,view}.rs`,
  `crates/deep-canvas-test-modules/src/{time,lib}.rs`.

## Run

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/497 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/497/tsconfig.json   # type-check (exits 0)
```

Each file builds its binary once in `beforeAll` and copies it out: `cargo build --locked --bin deep-show --no-default-features
--features full,test-held` (`held.test.ts`, `refusals.test.ts`) or `cargo build --locked --bin deep-motion`
(`late-entries.test.ts`); every test of a file fails when its build fails. The suite builds cargo binaries, so
`scripts/lanes.mjs` needs `'tests/acceptance/497/'` in its `alone` list (this job writes only this folder; the implementer
makes that edit). Everything runs headless on the CPU. Every `it` passes `TIMEOUT`. Delete Vitest's cache
`tests/acceptance/497/node_modules/.vite` after a run.

## The surface under test

No new binary or subcommand. Criterion 1 needs a test canvas module, which only `deep-show`'s registry and scheduler run
(#488's `test.tick` is the precedent); criterion 2 needs the input track, its hash and drivers over `input.<control>`, which
only `deep-motion eval` has (#489, #491). So each criterion extends the binary that already holds its half.

### Criterion 1: `deep-show run` with the test canvas module `test.held`

Scenario, `deep_show` and `eval` as #387 and #488 define them (`eval`'s `t` a JSON integer of flicks, #488).

| Feature | Module | Manifest and registration |
|---|---|---|
| `test-held` (new, `["dep:deep-canvas-test-modules"]`) | `test.held` 1.0.0 | Kind `test.held@1` {`box`, `step_rate: Hz`}, drawn as `rect@1`. Array `test.held.index` (i64, document, simulate). A stepping operator (simulate) that steps at the item's `step_rate`: step k runs at k × (705,600,000 ÷ `step_rate`) flicks and writes k into `test.held.index` (its index carried from the last step plus one, step 0 writing 0), declaring `checkpoint` carried state as `test.tick` does, so a seek restores and steps forward. A document that uses the kind declares `requires.modules: {"test.held": "^1"}` |

- **`eval` gains `arrays`.** `{"call": "eval", "doc", "t", "arrays": ["test.held.index"]}` answers as before plus
  `"arrays": {"test.held.index": <integer>}`: each named array as the frame at t reads it (the value a frame-phase reader
  sees: for a stepping array, what the last step at or before t left). Successive `eval` calls on one document in time order
  are playing (one session stepping on); calls that go back in time are seeks.
- **The step rate is checked at `deep_show`.** A `test.held@1` item whose `step_rate` has no whole-flick step (85 Hz) refuses
  the revision with an error issue `{"code": "bad_rate", "severity": "error", "path": "items/<id>/params/step_rate", …}` whose
  JSON names `85` (#488's `bad_rate` convention). 50 Hz (14,112,000 flicks) and 120 Hz (5,880,000) are presented.
- **A driver var reads a held array by its name**, `vars: {n: "test.held.index"}` (Logic: "read as `<logic ID>.<name>`";
  "Drivers and readouts read them by path"). `lag(n, "-0.5s")` over it is refused at `deep_show` as a look-ahead: an error
  issue whose JSON matches `/look.?ahead/i` (as the base's `look_ahead_on_control`) and names the driver's ID. The same
  `lag(x, "-0.5s")` over an item's position (`items/src/at/pos/0`) is presented, as at the base.

Boards: `{format: 1, profile: "board", seed, title, description, size: [320, 200], transport: {span: "2s", frame_rate: [fps, 1]},
requires, items, drivers?}`; items `rect@1` and one `test.held@1` with `params: {box, step_rate}`.

### Criterion 2: `deep-motion eval`, extended input entries

Input `{"doc", "times", "input": [entry], "planted"?}`; output `{"ok": true, "frames": [{t, items, input: {hash, entries}, …}]}`
as #489 has it. New:

- **An entry carries `player` and `arrives`.** `{t, seq, control, value, writer, player: 1…8 (absent: 1), arrives?: flick}`.
  The line evaluates `times` in the order given; before the frame at each time t, the track takes every entry not yet taken
  whose `arrives` ≤ t, in the order the line lists them (the test writer's appends); an entry without `arrives` is taken
  before the first frame. A frame's `input.entries` is the number of entries the track holds then, and `input.hash` the
  track's hash then. The track orders its entries by (t, player, seq), never by arrival, and a late entry is no fork: it
  joins at its `t` and drops nothing, so a track whose entries came late hashes as the on-time one.
- **An `input.<control>` list's occurrences carry the entry's player**: each occurrence's payload is `{value, player}`, so a
  driver var `{list: "input.fire", where: "player == 2"}` counts one player's presses (#491's `where` reads payload fields).
- **Two planted values** (`planted` on the eval line, as #489's): `track_orders_by_arrival`, a track that holds entries in
  the order they arrive, each placed at the flick it arrived (its `arrives`) instead of its stamped `t`; and
  `track_forks_at_late_entry`, a track where an entry arriving while entries stamped after its `t` are in the track forks it
  at its `t`: those later entries are dropped, then it is appended; entries arriving after that are appended as usual.

The piece: a 10 s film at 60 fps whose step is 11,760,000 flicks (60 Hz, logic's and net's default `step_rate`), so step k
is frame k; a slider control `fire`; drivers `d_p1` and `d_p2` writing `count(presses)` of each player's `fire` entries into
items `p1` and `p2`'s `at.pos[0]`.

## Criteria to tests

IDs as `scripts/proof-change.mjs` computes them (first 8 hex digits of the SHA-256 of the criterion's text, trimmed, white
space collapsed).

| ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| AC1 `#497.db40ef0b` | `held.test.ts` (2) | boards at 24, 30 and 60 fps, each with a 50 Hz `test.held@1`: every frame of the 2 s span (48 + 60 + 120) reads ⌊t ÷ 14,112,000⌋, and 1.019 s reads 50, 0.999 s reads 49; once played in time order, once sought in a seeded order after the span's last flick (fails a read of the next or the nearest step, steps at the frame rate, an index counted from 1, a seek that keeps the later state or restores the nearest checkpoint) |
| AC1 `#497.db40ef0b` | `refusals.test.ts` (1) | 85 Hz refused with `bad_rate` at the item's `step_rate`, naming 85, while 120 Hz is presented (fails accept-all and refuse-all-but-50); `lag(n, "-0.5s")` over `test.held.index` refused as a look-ahead naming `d_held`, while the same lag over a position is presented (fails a lag that reads the array, a refusal of every look-ahead) |
| AC2 `#497.2bda68b3` | `late-entries.test.ts` (3) | player 1's 40 on-time presses and player 2's 40 presses each 0 to 8 steps late (seed 497_02, appended by arrival, ties in a seeded order) over 600 steps: during the play each frame's track holds exactly the entries arrived by then (fails a track that ignores arrivals); the on-time run counts each player's presses at or before each step (fails a count that ignores players); once the last entry is in, the track's hash and every frame's items equal the on-time run's, in order and in a seeded order (fails an append-order track and a late entry at its arrival). `planted: "track_orders_by_arrival"` fails, its first differing step the earliest late entry's stamped step (21); `planted: "track_forks_at_late_entry"` fails, its first differing step the earliest dropped entry's (22, from replaying the appends against a forking track) |

## Choices where the issue is open

1. **Two binaries.** Each criterion goes to the base binary that already holds its half (above); a test canvas module in
   `deep-motion`, or an input track in `deep-show`, would be a larger new surface than the two extensions.
2. **The step rate is an item param**, `step_rate: Hz`, as logic@1's, checked when the revision is presented; the issue
   names a module "stepping at 50 Hz" and a refused 85 Hz, not where the rate is set.
3. **Reading the held array** is `eval`'s new `arrays`, the frame's read of the array; nothing at the base shows an array's
   value (eval's `steps` log is the step side, not the frame's read).
4. **Playing and seeking.** In criterion 1, playing is `eval` in time order on one session, seeking the same frames in a
   seeded order after a frame at the span's end. In criterion 2, "once the last entry is in" is after the line's play over the
   600 steps; then every frame is read in order (playing) and in a seeded order (seeking), and compared with the on-time line
   at the same times.
5. **Steps in criterion 2** are the piece's frames at 60 Hz; entries are stamped at step flicks. The hash is compared on its
   own; "the first step that differs" is the first step whose evaluated items differ (the track's hash covers the whole track,
   so it differs at every frame of a planted run).
6. **The planted twins** are defined above so each differs from the on-time run first at a step the test computes on its own.
7. **Not pinned.** The look-ahead refusal's code (only `/look.?ahead/i` and the driver's ID are read); the hash function.

## Criteria out of reach

- **A real match.** The issue's second criterion is a test writer on one copy; the relay, rollback and prediction are #74's
  epic, not this issue, and aren't driven here.
- **Physics and logic steps proper.** `test.held` stands in for a stepping module, as the criterion says; no WebAssembly
  logic item is run.

## What the base already does and these tests don't credit

`deep-show` steps registered stepping operators with checkpoints (#488) and `deep-motion eval` keeps an input track with a
hash, drivers over `input.<control>` and refuses a look-ahead through a control. The base has no `test-held` feature, no
`arrays` on `eval`, no `step_rate` check, no `player` or `arrives` on entries and no players in occurrence payloads, so every
test fails at the base (`BASE-FAILURE.txt`).
