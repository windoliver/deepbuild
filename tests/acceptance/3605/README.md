# #3605 acceptance tests: a shell for a course, `done` marks and the piece's own settings

Written blind, before any implementation, by a job that saw only issue #3605 (its Scope, Fields, nine acceptance
criteria and Proof), the design sections it links at base `d303e2b64` and that commit's code, read only to learn how
to build and call things. No expected value here is read from code: each comes from the issue's text, the design or
this suite's own fixture shell. The implementing agent never edits these files (AGENTS.md, Proof); a dispute goes to a
blind redraft.

## What was read

- The issue, live (`gh issue view 3605`).
- `node scripts/design-section.mjs --issue 3605`: Recipe: shell@1 game shell; Logic: saves (the profile record
  paragraph); Logic: carry records; Logic `logic@1`; Text `text@1`: keyed copy. Also `docs/canvas-primitives.md`'s
  Check input: shell journeys, Driver and group `flip`, and AGENTS.md.
- Code, for surfaces only: `crates/deep-logic/src/shell.rs`, `shell/{rules,run,journey}.rs`, `profile.rs`, `play.rs`;
  `crates/deep-replica/src/drive/{game_shell,play}.rs`; `packages/checks/playtest/{shell.ts,deepbuild.json}`;
  `packages/extension-host/src/host.ts` (`deep.canvas.play`); `scripts/proof-change.mjs` (criterion IDs),
  `scripts/lanes.mjs`. The harness is #851's suite (`tests/acceptance/851/`), copied and cut down, never imported; its
  `wat/` assembler is copied here, renamed `acceptance-3605-wat`. #276's `record/` README for the profile record's
  surfaces (`saves_dir`, `fresh`).

## Running

On a Mac (the replica runs on macOS only; elsewhere every test is INCONCLUSIVE), after `npm ci` and
`npm run build --workspaces`:

```sh
export PATH=/opt/homebrew/opt/rustup/bin:$PATH
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease node node_modules/vitest/vitest.mjs run \
  --root tests/acceptance/3605 --testTimeout=600000 --hookTimeout=180000 --no-file-parallelism [file]
node node_modules/typescript/bin/tsc -p tests/acceptance/3605/tsconfig.json   # type check
```

Each file builds, once, this suite's assembler (`wat/`, into `target/acceptance-3605-wat`), `deep-logic` (for the
level items' region maps, built first, so a base without the issue's fields fails before the replica is built) and
`deep-drive` with `--features env-plants` (the replica), then opens one extension host per hub with the playtest
plug-in installed and loaded, its replica a pool of `deep-drive` processes, and a second hub on a planted replica
where a file needs one. Processes are this suite's children, stopped by PID. `lane.json` runs the folder alone. The
implementer adds to `scripts/lanes.mjs` (this job writes only this folder):

```js
// #3605's criterion 9 ends INCONCLUSIVE until your taste call on its frames; it runs by hand.
byHand.push('tests/acceptance/3605/ac09-shown.test.ts');
```

and to `scripts/repo-rules.json`'s dependency rules, as #851's suite has it (`repo-rules.mjs` fails `deps` on this
folder's `wat/Cargo.toml` until then):

```json
"tests/acceptance/3605/wat/Cargo.toml": {
  "dependencies": {
    "wat": { "spec": "=1.263.0", "why": "Issue #3605's blind suite: its own assembler for the fixtures, #851's suite's, renamed, apart from the code under test; the version earlier suites pin." },
    "wasmparser": { "spec": "=0.263.0", "why": "Issue #3605's blind suite: validates each fixture module before it is written." }
  }
}
```

## The surface under test

Where the design names a surface, the tests call it as named. Where it is silent, the reading below is this suite's,
marked *(chosen)*, and the implementation builds to it. Names are matched as listed; wording never is.

### The check and its two new journeys

- **The check** is #851's: `host.runCheck('shell.journeys', spec, {checkout, deadline})` with the spec
  `{kind: 'shell.journeys', runner: 'deep.canvas.play', inputs: [], depth: 'journey', oracle: 'code', contract: null, play: input}`
  and `input = {piece: '<doc>@1', seed: 3605, journeys, moves?, devices, sizes: [[1512, 982]], level: {actions: {finish: [900]}, span: 1200}, budget: 30}`.
- **`moves` *(chosen)*: a journey of scripted moves.** The issue's criteria name paths through the shell (level 4
  entered first, level 2 left from pause, 120 chosen before a level, 240 chosen in pause) that no #851 journey takes,
  so the input carries them: `moves: [Move]`, played once per device and size, each play's call carrying them as
  `shell.moves` beside `journey`, `device` and `size`. A `moves` play starts with no profile record. Each move is made
  with the run's device, as #851's journeys make theirs, and ends with any transition settled:
  - `{activate: <control ID>}`: the shown screen's control, activated (focus moves and Enter, the pad's d-pad and
    south, or a tap at its box).
  - `{set: <control ID>, value: <number>}`: a choice set to that option (keys or the pad's left and right by one
    option, or a tap at the option's place across the box).
  - `{back: true}`, `{pause: true}`: the device's back, and its pause while a level plays.
  - `{play: <k> | "left"}`: the loaded level played with the input's `level` policy until **its step k has run** (it
    has run k + 1 steps), or with `"left"` until it is no longer loaded (completed). So `{play: 600}` then
    `{pause: true}` pauses with level step 601 next, and the issue's "seen reads 120 through step 600 and 240 from
    step 601" holds.
  The check judges every `moves` play *(chosen)*: a `done` element that turns true at any other step than its level's
  own `done` first turns true, or turns false, fails, naming the level and the shell step; and each level track the
  play recorded is replayed as a piece with no shell, through `deep.canvas.play` as the implementer chooses, and one
  whose arrays or full-state hash differ from the play's fails, naming the first level step that differs (`step <k>`).
  A suggested code is `shell.done` and `shell.replay`; the tests match no code for these, only what is named.
- **`relaunch` *(chosen)*: the profile record of #1050, which isn't on the base.** Four plays in one profile store
  that starts empty and that no other play shares: the first launch plays the input's `moves`; then a relaunch, a
  start fresh and a relaunch again, each with no moves. Each play's call carries `shell.launch`: `first`, `relaunch`,
  `fresh`, `relaunch`, in that order (the tests read the order and `launch` alone; how the store is named and kept,
  in the replica or by #276's `saves_dir` and `fresh`, is the implementer's). A relaunch starts from the store's
  record; `fresh` reads none and writes nothing over it, as #276's `fresh: true`. The check fails, naming each level
  whose mark a relaunch doesn't hold from its first row, as the last non-fresh launch left it.

### A play's reply (added to #851's `{shell: {steps, screens, entered, carry, track, refused, stopped, ...}}`)

- **Rows** (`steps[]`) *(chosen)* gain `done` (one bool or 0/1 a level, as `unlocked`), `custom` (one number a
  declared setting, in declared order; `{name → number}` is read too), `values` (the loaded level's arrays by
  `<logic ID>.<array>`, as its last step left them, as #851's `entered[].values` gives them) and `level_hash` (the
  loaded level's own full-state hash, as the replica's piece play computes `final`; null with no level). `level_step`
  stays the base's: the steps the level has run. A level's step k is the first row holding it at `level_step` k + 1.
- **`level_tracks: [{level, entries, steps}]`** *(chosen)*: one a level load, in order; `entries` the level's own input
  track, each entry in the JSON form the replica's piece play takes as `track` and returns as `entries`; a setting's
  entry holds `t` (flicks) and `value`, and its `control` is none of the level's controls.
- **`screens[<screen>].texts: {text item ID → string}`** *(chosen)*: each screen evaluated against the shell's arrays at
  the play's last step (keyed copy, flips, templates and drivers), every text item it draws then with its string; a
  child a flip hides is left out or empty. `screens[<screen>].frame` is that screen's frame then, as on the base.
- **`track`** stays the base's: the shell's own entries in the play. A relaunch's is empty (nothing opened by hand).
- **`refused`** stays the base's `{code, message}`; criterion 7 reads its `code`.

### Fields the levels and the shell read

- On a level's logic item, the issue's `settings: {mains: 230}`. Its read entry *(chosen)* is a `reads` entry of the
  region map `deep-logic`'s `check` reports, named `mains` or ending in `.mains` (`settings.mains`), laid out as a
  number control's: a u32 count and 4 zero bytes, then each entry a u32 player, 4 zero bytes and the value as an f64.
  Played alone or under a shell that doesn't declare the name, it holds one entry of the default at step 0.
- Screen documents read the shell's arrays by `game.done[<i>]` (a group's `flip.array`, a driver's var) and
  `game.custom[0]` (a driver's var), and show driver values through a text `template` such as `{data/ch1} of 3`;
  each `data` constant names `source: game`.

### Planted shells, `DEEP_DRIVE_PLANT` in the env-plants build *(chosen names)*

The base's `Plant::parse` knows none of them, so their tests fail on the base.

| Name | What it does wrong | Criterion | A failure must name |
| --- | --- | --- | --- |
| `done-on-enter` | marks a level's `done` when the level is entered, not when it completes | 1 | the level and `step <s>`, s the shell step of the first row holding the mark (± 1) |
| `done-in-save` | keeps `done` in the run's save rather than the shell's profile record, so a new launch starts clear | 3 | a level whose mark the relaunch lost (1 or 4) |
| `setting-through-reads` | writes a declared setting's value into the level's read region and enters nothing on its track | 5 | `step <k>`, the first level step at which the track replayed alone differs from the run |

A level is named by its `name` (`sockets`, `fuses`, `earthing`, `meters`, `circuits`, `testing`), as `done[<i>]`, or
as `level <n>` counted from 1 (the shell's own messages, "level 5 (circuits)") or from 0 (the issue's "level 4").
Words are matched whole and case-blind. Criterion 7's failures start with their code (the plug-in's convention):
`shell.setting` naming `volts_choice`, and `shell.reads` naming the level and `game.custom`.

## Fixtures (`shell.ts`)

A board document holding one `shell@1` item, `game`, with #851's six screens at 1280 × 720 u and these differences:

- **Six levels in two chapters of three**, `unlocked: [0, 1, 2, 3, 4, 5]`, named as above. Each is a board with one
  logic item `l<i>` at 60 Hz that reads `finish_key` (an actions control: key `f`, the pad's `north`, a touch zone),
  writes `done` (i32), `seen` (f64) and `clock` (i32) and lists `settings: {mains: 230}`. Its program (WebAssembly text,
  built against the region map `check` reports) keeps the last value its `mains` entry holds, writes it to `seen`
  each step (0 before any), and sets `done` to 1 at a step whose `finish_key` holds an entry. The journeys' level
  policy presses finish at level step 900, so a level played to its end is completed at its step 900.
- **The level select**: rows `row_0` to `row_5` (`{start: i}`, enabled `game.unlocked[i]`), chapter one's three in
  the left column and chapter two's in the right; each row's mark is a group `row_<i>_mark` that flips by
  `game.done[i]` between the texts `row_<i>_todo` ("To do") and `row_<i>_done` ("Done"); the counts `ch1_count` and
  `ch2_count` show `{data/ch1} of 3` and `{data/ch2} of 3`, each `data` value a driver `a + b + c` over its chapter's
  three `game.done` elements.
- **The settings screen**: `mains_choice`, a choice that does `{set: custom.mains}` with options [100, 120, 220, 230,
  240], `mains_value` (`{data/mains} V`, a driver over `game.custom[0]`) and `settings_back`. `settings.custom` is the
  issue's `{mains: {kind: choice, options: [100, 120, 220, 230, 240], default: 230}}`.
- **The pause screen**: `resume_button`, `pause_settings` (`{go: settings}`) and `leave_button` (back).
- **Planted documents**: `noCustom` (no `settings.custom`, no mains choice), `setsVolts` (the settings screen also
  holds `volts_choice`, `{set: custom.volts}`), `readsCustom` (level 2, earthing, reads `game.custom` by path).

## The files

| File | Criterion | What it plays | What it proves; the plant |
| --- | --- | --- | --- |
| `ac01-done.test.ts` | AC1 `#3605.2b30a7aa` | moves: levels, row_4, play left · keys | done all false and six rows enabled at the start; level 4 first loaded; done[4] turns true at the row whose step ran level 4's step 900, and nothing else; row 4 shows Done, the others To do; counts 0 of 3 and 1 of 3 · `done-on-enter` fails naming level 4 and the step |
| `ac02-left-again-hash.test.ts` | AC2 `#3605.0f6b90fe` | A: level 2 left from pause, completed, completed again, level 4 completed · keys, pad; B: A with level 4 left from pause · keys | done[2] false after the pause leave and up to step 900 of its second load, then true; the third load changes no element; A's keys and pad runs end on one hash; B ends on the level select with 001000 and another hash |
| `ac03-relaunch.test.ts` | AC3 `#3605.e582fe2c` | relaunch, moves completing levels 1 and 4 · keys | the first launch starts clear and ends 010010; each relaunch holds 010010 from its first row with an empty shell track and shows Done on rows 1 and 4 and 1 of 3 twice; start fresh holds every mark clear; the relaunch after it holds them again · `done-in-save` starts the relaunch clear and fails naming level 1 or 4 |
| `ac04-setting.test.ts` | AC4 `#3605.fd7b096d` | SETTING_MOVES · keys | l0.seen 230 at steps 0 to 60; l1.seen 120 at 0 to 600 and 240 at 601 to 899; paused rows at level step 601; custom 230, 120 at level 1's step 0, 240 at the end; level 1's track holds the setting's entries 120 at t 0 and 240 at step 601's time |
| `ac05-replay.test.ts` | AC5 `#3605.1380fa30` | SETTING_MOVES · keys; the planted: levels, PAUSE_CHANGE | level 1's track replayed alone, 900 steps: seen, done and clock equal the run's at every step, and the final hash equals the run's level hash after 900 steps · `setting-through-reads` fails naming the first differing step, computed here |
| `ac06-default.test.ts` | AC6 `#3605.840dc1ba` | level 0 alone, 120 steps; `noCustom`, level 0 to its step 60 · keys | 230 at every step alone and under a shell that declares no mains |
| `ac07-refused.test.ts` | AC7 `#3605.50677298` | `setsVolts`, `readsCustom`, layout · keys | `shell.setting` naming `volts_choice` (and the replica's `refused.code`); `shell.reads` naming level 2 and `game.custom` |
| `ac08-devices.test.ts` | AC8 `#3605.47c041ca` | moves: settings, mains_choice to 120, back · keys, pad, touch | each run's custom goes 230 to 120, its rows hold only its device, and the three end on one hash |
| `ac09-shown.test.ts` | AC9 `#3605.14ffdae4` | AC1's moves · keys | the level select's and the settings screen's frames are evidence by hash and PNGs at the window, copied to `$SHELL3605_SHOWN`; ends INCONCLUSIVE (by hand) |

Each criterion's ID is `#3605.` and the first 8 hex digits of the SHA-256 of its text after `- [ ] `, trimmed and with
white space collapsed, as `scripts/proof-change.mjs` computes it.

## Open points

- The fixture's level select, settings and level documents were not played on the base (the base refuses the shell
  at check: `custom.mains` isn't a field its settings hold, and `deep-logic` refuses `settings` on a logic item), so
  that the base canvas evaluates their flips, templates and drivers is unverified; a dispute over a fixture document
  goes to a blind redraft.
- `values` per row and `level_hash` may be large for long plays; the tests read them only while a level is loaded.
- Criterion 3 reads #1050's profile record through the `relaunch` journey alone; the web player and the macOS wrap
  (#1050's other parts) are not exercised here.
