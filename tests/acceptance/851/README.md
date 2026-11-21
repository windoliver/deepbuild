# #851 acceptance tests: the game shell, `shell@1`, and its journeys

Written blind, before any implementation, by a job that saw only issue #851 (its Scope, its eight acceptance criteria
and the two added in "Amended (Nov 8)"), the design at base `00c1c0841` and that commit's code, read only to learn how
to build and call things. No expected value here is read from code: each comes from the issue's text, the design or
this suite's own fixture shell. The implementing agent never edits these files (AGENTS.md, Proof); a dispute goes to a
blind redraft.

## What was read

- The issue, live (`gh issue view 851`).
- `docs/canvas-primitives.md` at `00c1c0841`: Recipe: shell@1 game shell; Check input: shell journeys; Logic `logic@1`;
  Logic: saves; Logic: saves across changes; Logic: carry records; Check input: playtest; Check input: plug-in reads;
  Control; Control: actions, key repeat and gamepads; Control: touch zones; Replica `deep_drive`; Text `text@1` and its
  keyed copy; Rect `rect@1`; Document envelope; Item and kind; Paint; Overlay (for anchors).
- `docs/technical-design.md`: the logic module's bullet, Bounded games, and the reference window row in Decided.
- Code, for surfaces only: `crates/deep-replica/src/deep_drive.rs`, `src/drive/mod.rs`, `src/drive/play.rs`,
  `src/drive/plant.rs`; `crates/deep-logic/src/play.rs`, `carry.rs`, `piece.rs` (a control's slot), `track.rs`,
  `saves/layout.rs`; `packages/checks/playtest/` (manifest, `index.ts`, `types.ts`, `run.ts`);
  `packages/extension-host/src/host.ts` (`deep.canvas.play`, `runCheck`); `scripts/proof-change.mjs` (criterion IDs);
  `scripts/lanes.mjs`. Harnesses copied and cut down, never imported: `tests/acceptance/184/`, `tests/acceptance/555/`
  and `tests/acceptance/189/carry/` (whose `wat/` assembler is copied here, renamed `acceptance-851-wat`).

## Running

On a Mac (the replica runs on macOS only; elsewhere every test is INCONCLUSIVE), after `npm ci`:

```sh
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease node node_modules/vitest/vitest.mjs run \
  --root tests/acceptance/851 --testTimeout=600000 --hookTimeout=180000 --no-file-parallelism [file]
```

`node node_modules/typescript/bin/tsc -p tests/acceptance/851/tsconfig.json` type-checks the suite. Each file builds,
once, this suite's assembler (`wat/`, into `target/acceptance-851-wat`), `deep-logic` (for the level items' region
maps) and `deep-drive` with `--features env-plants` (the replica), then opens one extension host per hub with the
playtest plug-in installed and loaded, its replica a pool of `deep-drive` processes (one, or two in ac04), and a second
hub on a planted replica where a file needs one. Processes are this suite's children, stopped by PID.

The implementer adds to `scripts/lanes.mjs` (this job writes only this folder):

```js
// #851's files start replicas and a hub and play the fixture shell's journeys, levels of 3,700 steps, for minutes.
alone.push('tests/acceptance/851/');
// #851's criterion 8 ends INCONCLUSIVE until your taste call on its frames; it runs by hand.
byHand.push('tests/acceptance/851/ac08-shown.test.ts');
```

## The surface under test

Where the design names a surface, the tests call it as named. Where it is silent, the reading below is this suite's,
and the implementation builds to it.

- **The check.** `host.runCheck('shell.journeys', spec, {checkout, deadline})` on an extension host with
  `packages/checks/playtest` installed and loaded; its manifest's `checks` holds `shell.journeys` beside `playtest`
  (the first assertion of every test, so the base fails before any build). The spec is
  `{kind: 'shell.journeys', runner: 'deep.canvas.play', inputs: [], depth: 'journey', oracle: 'code', contract: null, play: input}`,
  with the input in `play`, as the playtest's is, so the host's `deep.canvas.play` guard reads its piece and seed:
  `input = {piece: '<doc>@1', seed: 851, journeys?: [...], devices: [...], sizes: [[w, h], ...], level: {actions: {collect: [600, 1800, 3000], finish: [3700]}, span: 4000}, pause: {at: 1200, hold: 30, to: 3600}, budget: 30}`.
  `journeys` left out means all ten. The host's `unplayed` rule today asks every passing run for 20 playtest runs by
  `runSeed(seed, i)`; a passing `shell.journeys` run plays at `seed` itself, so the host needs that rule kept to the
  playtest's kinds or taught the shell's runs.
- **Failures.** A failure's `message` starts with its code (the plug-in's convention), then names what the design
  says: `shell.unlock` the levels open before their turn, by `name` (`level 3`); `shell.reads` the array
  (`l1.score`); `shell.pause` the first level step whose hashes differ, as `step <k>`; `shell.device` the device
  (`pad`), the screen (`settings`) and the control (`volume_slider`); `shell.back` the screen (`credits`);
  `shell.focus` the control and `step <k>`; `prompt.agree` the prompt's text item ID; `ui.layout` both items by ID
  (`settings_back`, `volume_slider`); `wired` the control (`credits_button`). Words are matched whole and case-blind;
  `_` is part of a word, so `settings` doesn't match `settings_back`. A screen is named by its ID in `screens`
  (`title`, `settings`, `levels`, `pause`, `game_over`, `credits`), a control or prompt by its ID, which in the fixture
  is also the ID of the item that draws it.
- **The replica's play.** The host's play call reaches the test's hub replica as
  `{call: 'play', piece: '<doc>@1', seed, shell: {journey, device, size, ...}}`; the hub answers it on a free
  `deep-drive` as `{call: 'play', document: <the shell document>, assets: {<sha256>: <base64>}, seed, shell, ...}`
  (the levels' programs by hash). Tests read the call's `shell.journey`, `shell.device` and `shell.size` to find a
  journey's plays, and nothing else of it. The reply is `{ok: true, shell: {steps, screens, entered, carry, refused, recording}}`
  as the design gives it. Read leniently: `screen` as the screen's index in the six (−1 or null while a level plays)
  or its ID; `level` −1 or null for none; `unlocked` bools or 0/1; `enabled` a list of control IDs or `{ID: bool}`;
  `focus`, `device` and `refused` null or `none`; `hash` 16 to 64 hex digits. `box` and `text` are `[x, y, w, h]` in
  the view's pixels (the view is `size`, 1512 × 982 or 2400 × 1080 px). Levels are named by index (0, 1, 2).
- **The pause journey is two plays**, one never paused and one paused (the one whose rows hold `paused`). A level's
  full-state hash at level step k is the `hash` of the first row at which that level reached step k.
- **Planted replicas**, `DEEP_DRIVE_PLANT` in the env-plants build: `pause-runs-level-clock` (the level's clock runs
  while paused), `focus-stays-on-disabled` (focus stays on a control that turns disabled), `prompts-keep-key-glyphs`
  (prompts keep the keys' glyphs after a pad entry). The base's `Plant::parse` knows none of them. The other twins are
  documents (below).
- **Evidence** (criterion 8): each `screens[s].frame` and the scene change's `recording` are sha256s that appear in
  the check result's `evidence` and hash a file the replica wrote anywhere under its `--out` folder; a frame is a PNG
  at the size, or twice it (scale 2).

## Fixtures (`shell.ts`)

The fixture shell is a board document holding one `shell@1` item, `game`. Its six screens are 1280 × 720 boards of
rects (`rect@1`, the controls' items) and text (`text@1`, fixed boxes, `autosize: none`); each control's ID is the ID
of its rect, its label is `<ID>_label`, 20 u in from the rect's sides. Letterboxed, a 1280 × 720 board is scaled by
1.18125 and moved down 65.75 px at 1512 × 982, and scaled by 1.5 and moved right 240 px at 2400 × 1080.

| Screen | Controls (doc u) | Prompts |
| --- | --- | --- |
| title | `start_button` {start: 0}, `levels_button` {go: levels}, `settings_button` {go: settings}, `credits_button` {go: credits}, 300 × 64 from (490, 220), 84 u apart | `title_prompt` confirm |
| settings | `volume_slider` slider {set: volume.master} [−60, 0] by 6, `motion_toggle` toggle {set: reduced_motion} enabled `game.reduced_motion == 0`, `settings_back` back; 400 × 64 from (440, 200), 84 u apart | `settings_adjust_prompt` adjust, `settings_back_prompt` back |
| levels | `level_1_button` {start: 0}, `level_2_button` {start: 1} enabled `game.unlocked[1]`, `level_3_button` {start: 2} enabled `game.unlocked[2]`, 240 × 120 in one row at y 240; `levels_back` back | `levels_confirm_prompt` confirm, `levels_back_prompt` back |
| pause | `resume_button` resume, `leave_button` back | `pause_resume_prompt` pause, `pause_back_prompt` back |
| game_over (`back: title`) | `game_over_levels_button` {go: levels}, `game_over_title_button` {go: title} | `game_over_prompt` confirm |
| credits (`ends: 600`) | `credits_back` back | `credits_back_prompt` back |

`unlocked: [0]`; `transition: {kind: fade, steps: 12}`; `settings` with `text_size: [100, 125, 150]`,
`volume: {master: 0}`, `bindings: {collect: [c, west], finish: [f, north]}`; `pause` with `Escape`, the pad's
`start` and a 48 px button top right. The Reduce motion toggle disables itself once on, so activating it while it holds
focus hands focus to the settings screen's Back (criterion 6).

Three levels, inline board documents named `level 1`, `level 2`, `level 3`, `done: l<n>.done`, `lost: l<n>.lost`.
Each holds two actions controls of one action each, `collect_key` (`collect`: key `c`, pad `west`) and `finish_key`
(`finish`: key `f`, pad `north`), and two touch-zones controls, `collect_zone` and `finish_zone`, one circle zone each
(radius 80 px, 160 px in from the bottom left and bottom right corners; offsets read x right and y down in the view's
pixels), and one logic item `l<n>` at 60 Hz whose program is WebAssembly text from `shell.ts`, built against the region
map the logic module's `check` reports:

- Each entry on `collect_key` in a step is one collect: the i-th (from 0) adds 10 (i + 1) to `score` and i + 1 to
  `inventory[i mod 4]`. The program counts a control's entries and never reads their value bytes.
- Level 1 is done once `finish_key` holds an entry; levels 2 and 3 once they collect. Any level not done by its step
  3,900 is `lost` (a time limit), so a journey that must show game over can enter a level, press nothing, and wait.
- Level 1 gives `carry: {request: carry_req, out: [score, inventory]}` (it never writes `carry_req`; the shell writes
  its record at the step `done` turns true) and exports a state layout; level 2 takes
  `carry_in: {arrays: {score: i32, inventory: i32 × 4}, accepts: [level 1's layout]}` and starts from it at step 0.

Under the input's presses (collect at 600, 1,800 and 3,000, finish at 3,700), level 1 is still playing at 3,600, the
pause journey's `to`, and its record holds score `[60]` and inventory `[1, 2, 3, 0]`. These were checked against the
base's `deep-logic` before this suite was written (BASE-FAILURE.txt).

The planted documents: `unlockAll` (`unlocked: [0, 1, 2]`); `readsLevel1` (level 2's logic reads `l1.score`, built
against its region map in a probe piece beside level 1, in place of its `carry_in`); `dragOnly` (`volume_slider` is a
`drag_along`); `noBack` (credits has no Back control and `back: none`); `backCovers` (`settings_back` is
[440, 200, 200, 64], the left half of the volume slider's rect); `unbound` (`credits_button` has no `does`).

## The files

| File | Criterion | Runs (journeys · devices · sizes) | Twin |
| --- | --- | --- | --- |
| `ac01-unlock.test.ts` | AC1 `#851.9ac2fbcf` | title_to_level, unlock · keys · 1512 × 982 | `unlockAll`: unlock fails `shell.unlock` naming `level 3` |
| `ac02-carry.test.ts` | AC2 `#851.d9bf3012` | carry · keys · 1512 × 982; the record (score [60], inventory [1, 2, 3, 0]) and level 2's `entered` by that hash | `readsLevel1`: the replica's `refused` is `shell.reads` naming `l1.score`, no level step played; the journey fails `shell.reads` naming it |
| `ac03-pause.test.ts` | AC3 `#851.b6cf2eb0` | pause · keys · 1512 × 982; ≥ 1,800 paused rows, all at level step 1,200; equal hashes at 3,600 | replica `pause-runs-level-clock`: `shell.pause` names the first differing level step, computed from the two plays' rows, in (1,200, 3,600] |
| `ac04-devices.test.ts` | AC4 `#851.4125ce58` | title_to_level, unlock, pause, credits · keys, pad, touch · 1512 × 982; rows hold only the run's device; one end hash per journey (pause: at level step 3,600) | `dragOnly`, every journey with a pad: `shell.device` naming `pad`, `settings`, `volume_slider` |
| `ac05-back.test.ts` | AC5 `#851.938e41a6` | back · keys, pad, touch · 1512 × 982; every screen shown, some level followed by pause | `noBack`: `shell.back` naming `credits` |
| `ac06-focus.test.ts` | AC6 `#851.2badf2f3` | focus · keys, pad · both sizes; focus on an enabled control once set; each run disables its focused control and hands focus to the next enabled one in box order at that step | replica `focus-stays-on-disabled`: `shell.focus` naming the control and `step <k>` of the first row whose focus isn't enabled |
| `ac07-prompts.test.ts` | AC7 `#851.ad15698c` | prompts · keys, pad, touch · 1512 × 982; every prompt shows the device's glyph from the row after its first entry | replica `prompts-keep-key-glyphs`, pad: `prompt.agree` naming the first disagreeing prompt |
| `ac08-shown.test.ts` | AC8 `#851.651a914b` | back, carry · keys · 1512 × 982; six frames and the level 1 → 2 recording by hash, in the evidence and on disk, copied to `$SHELL851_SHOWN`; ends INCONCLUSIVE | none: the taste call is yours |
| `ac09-layout.test.ts` | AC9 `#851.27357504` | layout · keys · both sizes; every control's box is its rect letterboxed (±1 px), its text inside its label's box | `backCovers`: boxes overlap past 1 px; `ui.layout` naming `settings_back` and `volume_slider` |
| `ac10-wired.test.ts` | AC10 `#851.5b5156e7` | wired · keys, pad, touch · 1512 × 982; every screen shown | `unbound`, layout and wired · keys: `credits_button` shows (enabled, inside the frame, ≥ 24 × 24 px) and no `ui.layout` failure names it; `wired` names it and no bound title control |

Each criterion's ID is `#851.` and the first 8 hex digits of the SHA-256 of its text alone, trimmed and with white
space collapsed, as `scripts/proof-change.mjs` computes it; the two amended criteria are hashed the same way, though
that script reads only the "Acceptance criteria" section.

## Where the design was silent, and how it was read

- The check's input sits in the spec's `play`, flattened as the playtest's is (`piece`, `seed` and the `shell`
  fields side by side), so the host's guards apply unchanged.
- How a journey reaches game over: by a level being lost. The fixture's levels are lost at their step 3,900 when not
  done, so the back, focus, prompts, layout and wired journeys can reach it by entering level 1 and pressing nothing.
- Which journey works the volume slider: the design's example of `shell.device` is a slider a pad can't move, and the
  wired journey activates every enabled control, but the twin is checked with every journey so any reading meets it.
- The touch zones' corner names (`bottom_left`, `bottom_right`) and offset signs (x right, y down) are unnamed in the
  design; this suite's reading is as written above.
- An actions entry's value bytes: the fixture's levels count entries per one-action control, so they work whether
  the read region carries the design's 16 B record or not (the base fills the count and the player only).
- Expressions over the shell's arrays are written `game.unlocked[1]` and `game.reduced_motion == 0`.
- Rows' `device` is read as the device of the last entry or focus move, null before any.
- Frames for criterion 8 come from the back journey (every screen shown) and the carry journey (level 1 to level 2).
