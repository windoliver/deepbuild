# Acceptance tests for #189, logic saves: bound to a state layout, proved on fixture saves, migrated, ended

Written first, blind, from issue #189 (`gh issue view 189 --repo windoliver/deepbuild`: its Scope, Fields, thirteen
acceptance criteria and Proof line), the design sections it links and the base commit `531da1ef0` (this worktree's
HEAD), by a job that never saw an implementation; none existed, and no other branch, worktree, pull request, plan or
session was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft
of this job (design: Dogfooding).

Scope: the criteria of the `deep-logic` surface, 1, 2, 3, 4, 5, 6, 12 and 13, and four legs of criterion 11 (opening a
48-page save, logic.layout, a 32 MiB migration, no work per frame). Criteria 7 and 9 (carry records, the web player) and
8 and 10 (the lab with a world) are other jobs'; criterion 11's re-derive leg (the lab's 1,800-step save under 5 s)
lives in `tests/acceptance/189/lab/`. Criterion 5's Oracle lane is `tests/acceptance/189-oracle/`.

## What was read

- The issue, live. `docs/technical-design.md`: Saves, Data layouts, Saves across changes, Carry records, Sandbox and
  budgets, Logic bake and checks, Dogfooding. `docs/canvas-primitives.md`: Logic: data layouts, checkpoints and bake,
  saves, saves across changes, carry records; Check input: logic kinds; Registry and seal and its runtime digest.
  AGENTS.md.
- At the base, only to learn the protocol: `crates/deep-logic` (`src/lib.rs`'s calls, `src/saves.rs`, `src/piece.rs`'s
  `saves` field and migration budget, `src/checks.rs`'s continuation probes, `src/live.rs`'s frame reply),
  `crates/deep-canvas-sandbox`'s role exports, `scripts/benchmark.mjs` (`judgeLimit`), `scripts/proof-change.mjs`
  (criterion IDs), and the suites `tests/acceptance/534/` (copied and cut down: helpers, assembler, the dungeon's
  shape), `522-oracle/` (the Oracle lane's pattern), `1041/`, `1920/` and `522/` (read, nothing taken).

What the base already does, which these tests don't credit: #534's saves (`saves` with `request`, `ends` and
`migrate`, save files written whole and renamed, `open_save`, `save_refused`, `migration_failed`, `no_save`, the
segment refusal inside the old program's segments, a migration's budget). It binds a save's layout to the program hash
whatever the program exports, records no full-state hash in a save's header, has no `layout` call, no field tables, no
`refused`, `open_ns`, `migration` or `saves_ns` field, and none of this suite's planted names.

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  npx vitest run --root tests/acceptance/189/saves --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/189/saves/tsconfig.json
rm -rf tests/acceptance/189/saves/node_modules/.vite
```

A run builds (honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set;
helpers.ts puts Homebrew's rustup or `~/.cargo/bin` on PATH when present) the assembler `wat/` (crate
`acceptance-189-wat`, #534's renamed, `wat =1.263.0` and `wasmparser =0.263.0`, outside the workspace with its own
`Cargo.lock`, regenerated at this base) into `target/acceptance-189-wat/`, and `cargo build --locked --bin deep-logic`
in the checkout. Every test passes an explicit timeout (90 minutes). Saves folders, binaries and assembler output are
temporary and deleted. **`scripts/lanes.mjs` needs `'tests/acceptance/189/saves/'` and `'tests/acceptance/189-oracle/'`
in its `alone` list**: the files build cargo binaries, write 32 MiB and 64 MiB memories' saves, and criterion 11 reads
timings. This README is the instruction; the implementer makes that edit.

Hosts. Criterion 11's legs are pinned to the reference Mac: elsewhere each fails `BLOCKED: … is pinned to the
reference Mac` before it measures, never passes and never skips. On a Mac each limit is judged by
`scripts/benchmark.mjs`'s `judgeLimit` (five readings after a warm-up; a reference Mac on mains power, Low Power Mode
off, thermal state nominal, load under the core count); anything but PASS fails, naming the judge's reason
(INCONCLUSIVE off a reference Mac). Everything else runs on every host.

`BASE-FAILURE.txt` records what ran at the base (the full run got no throttle grant) and what each file fails on.

## The surface under test

The issue names `layout_at`, logic.layout's fields, migrations, `ends`, refusals and planted twins, but no command
line. As in #534's suite the surface is `deep-logic`'s JSON lines: **every call, field, format and planted name below
that the issue or the design doesn't give is this job's invention**, the smallest the criteria need, extending #534's
protocol (its README: The surface under test), which holds for everything not named here. The implementer builds
exactly these, or a dispute goes to a blind redraft.

### State layouts

- A program's state layout is the bytes at its immutable i32 global `layout_at`, after a little-endian u32 of their
  length, as its memory holds them once instantiated. **Its hash is the sha256 of those bytes (64 lowercase hex), not
  counting the u32**; a program that exports no `layout_at` has its program hash as its layout, as at the base. A save's
  header `layout` and a `layout` Differ's two sides are these hashes (for a piece of one logic item, as here).
- **A field table** is the layout bytes as UTF-8 JSON `{"name", "version", "fields": [{"name": string, "offset": byte
  address in memory, "type": "i32" | "i64" | "f32" | "f64", "count": n}]}`. Two layouts carry field tables when both
  parse so. A field is matched by name; one only in the save's is `missing`, one only in the piece's `added`; for the
  same name, another `type` is `retyped`, another `count` `resized` and another `offset` `moved`: one entry per field,
  its class the first of those that applies.
- A save opens straight when its layout, content and module set match the piece's and the program's mutable globals
  match the save's in count and type; under a changed program with the same layout it then writes the program's active
  data segments, refusing first when a byte a new segment writes lies outside the old program's segments and the save
  holds it nonzero (design: Logic: saves).

### Save files

#534's format (`<sha256>.save`: a JSON header line, a newline, the state), plus one header field: **`deep_hash`**,
`{<item ID>: 16 hex}` for every item with carried state (logic items and `same_machine.counter@1` items), the full-state
hash the save recorded when written: the same map its `SaveWritten.deep_hash` gives. Opening a save checks the opened
state's full-state hashes against it.

### `open_save`: additions

```text
Opened   += "refused": [RefusedSave], "open_ns": ns, "migration"?: MigrationRun
RefusedSave = {"hash", "file", "differs": [{"what": "state", "module": "logic", "item": logic ID,
               "save": the full-state hash the save recorded (16 hex), "piece": the opened state's (16 hex)}]}
MigrationRun = {"by": the migration's asset ID, "fuel": the fuel its run used, "ns": its run's wall time,
                "budget": {"fuel", "memory", "stack"}}
```

- **`refused`**: each newer save of the slot that read back whole (its sha256 is its name) and decoded, but whose
  opened state's full-state hash isn't the one it recorded, newest first; the slot's next save that reads back whole
  then opens instead. When none opens, the reply is `no_save`, with `refused` beside `damaged`. `damaged` stays #534's:
  only saves whose file hash fails.
- **`open_ns`**: the wall time of opening the save: reading its file, checking its hash, decoding it, restoring it into
  fresh instances and checking its full-state hashes; the piece's check and the steps played after are excluded.
- **`migration`** (only when `via` is `migration`): the migration that ran (`by`), the fuel its run used as the
  rewrite counts it (per block, and per byte a memory copy or fill touches), the wall time from writing the old state
  block into its memory to reading the new one, and the budget it ran under: fuel `max(10,000,000, 8 × (old memory +
  new memory))`, memory `new + old + 4 MiB` in bytes, stack 262,144.

### Refusals: Differ additions

- `{"what": "layout", "save", "piece", "fields"?: [{"name", "class", "save"?: {offset, type, count}, "piece"?: {…}}]}`:
  when both layouts carry a field table, `fields` names **every** field that differs, each with its class, in any order.
- `{"what": "globals", "item", "global": index, "name"?: string, "save": count, "piece": count}`: the program's mutable
  globals don't match the save's in count or type; `global` is the first that differs, by **its index in the program's
  global index space as written** (before the rewrite; imports are none), and `name` its name-section name when it has
  one.
- `{"what": "segment", "item", "segment": index, "offset": address}` gains a second meaning: a byte the new program's
  active segment `segment` (its index in the new program's data section) writes outside the old program's segments,
  where the save holds a nonzero byte; `offset` is the first such address.

### logic.layout: the `layout` call

```text
{"call": "layout", "piece", "saves": [save hash], "steps"?: 60, "same"?: [array name]}
→ {"ok": true, "kind": "logic.layout", "verdict": "PASS" | "FAIL" | "BLOCKED", "failures": [Failure], "runs": [Run], "ask"?: string}
Run     = {"save", "via": "straight" | "migration", "control", "entries": [Entry], "from": s,
           "current": [StepRecord], "old": [StepRecord]}
Failure = {"save", "field": "array" | "trap" | "open", "array"?, "element"?, "step"?, "replica"?: "current" | "old",
           "trap"?: LogicTrap, "refused"?: the open's refusal}
```

- `saves` are fixture saves by asset ID: the sha256 of the save file, which the piece's `assets` carries (base64, as any
  asset). The piece's assets also carry the program that wrote each save (its bytes as given, by their sha256), found by
  the hash the save's header `program` names (as given or as rewritten; the implementer may add the given program's
  sha256 to the header for a direct lookup). Nothing is written to any folder.
- `same` names arrays of the piece's logic item (bare names; default: every array it writes). `steps` defaults to 60.
- For each save it opens the save under the piece's current program, straight or through its declared migration, and
  in a second replica under the program that wrote it with the item otherwise the same; then for each continuation
  probe logic.determinism uses (one per control the item reads: a seeded entry of that control stamped at the save's
  step s), feeds both and runs steps s to s + steps − 1. A Run reports that probe: its `entries` in the track's own
  Entry JSON (so they can be fed to `open_save` as a track), and each replica's steps, each `{step, arrays}` with every
  `same` array as `<item>.<name>` after that step.
- PASS when every save opens, neither replica traps and every `same` array matches at every step. Else FAIL: one
  Failure for each save, probe and array that differs, naming the save, the array (`<item>.<name>` or bare), the first
  step and that step's first element that differ; or the save that doesn't open (`open`), or the trap.
- **BLOCKED** when a fixture save, or the program that wrote it, isn't carried: `failures` empty and one unblock `ask`
  naming each missing save's hash (or program hash). Never PASS.

### Migrations

#534's state blocks (a u32 memory length, the memory, a u32 global count, 8 bytes a mutable global). A migration's
**remap table** asset is copied verbatim into the migration's memory at `remap_at`; its bytes are the migration's own to
read. This suite's (criterion 4): a u32 count, then each pair of i32 keys, old then new. A migration that traps answers
#534's `migration_failed` with `by` and `trap` (`{kind, function, offset}`), and the slot keeps only the old save.

### Frames

Every `frame` reply (#532's live view) gains **`saves_ns`**: the CPU time the saves machinery took in that frame (save
requests and `ends`, a save's track, carry records); for a piece whose logic declares no `saves` it is 0.

### Planted twins of `deep-logic` (`--planted <name>`)

Each is one criterion's wrong program, reachable only through this argument, and changes nothing else. A twin that
changes a save applies to the process that writes it and the one that opens it (the tests pass it where they say).

| Name | Criterion | The wrong program |
|---|---|---|
| `save_drops_a_page` | 5, Oracle | a save leaves out its highest-indexed page that holds a nonzero byte; its header still records the true full-state hash (the tests open it in a process without the twin) |
| `ended_keeps_earlier_save` | 6 | once an ended save reads back whole, the slot's earlier save is kept, and an open falls back to it when the ended save doesn't read back whole |
| `migration_runs_under_step_budget` | 4 | a migration runs under its item's step fuel budget (`budget.fuel`) instead of its own |
| `open_writes_new_segments` | 12 | under a changed program with the same layout, the open skips the overlap refusal and writes the new program's active segments over the save's pages |
| `refusal_names_first_field` | 13 | a layout refusal between two field tables names only the first field that differs |

Criterion 2's "planted program" is a program of the piece (`shifted`, below), run through the real `layout` call.

## Programs

`programs.ts` holds them as WebAssembly text, `pieces.ts` the pieces (one logic item at 60 Hz each, built against the
region map `check` gives it) and the dungeon's track (seeded moves about one step in 30).

- **The dungeon** (32 MiB): a roster of 3 units × (hp, attack, guard, xp) at 8,192, gold at 8,240, floor at 12,288, a
  bag of 8 item keys at 16,384 (11, 12, 13, 14 from the start), its layout bytes as active segment 0 at 6,144 and a
  damage table as segment 1 at 8,176 to 8,192; the foe's hp and a xorshift64 generator are its two mutable globals. Moves
  add xp and gold, each step moves one unit's hp and maybe the floor, and the damage formula hits only the foe. It saves
  slot 1 at step 1,800 and writes roster, gold, floor, bag, foe and request. Its variants: `old` (layout V1), `fix`
  (attack × 2 in the damage formula, V1), `inserted` (a `torch` field before the roster, V2), `shifted` (state as
  `inserted`, V1's bytes: criterion 2's planted program), `extra` (V1 and a third mutable global, global 5), `table` (V1
  and a 1 KiB table of 0xEE as segment 2 at 8,192), `v3` (torch inserted, gold renamed coins, floor an i64: V3), `m48`
  (48 MiB, the roster at 32 MiB + 8,192: V48), `bare` and `bare_nop` (no layout).
- **The migration** from V1 at 32 MiB to V48 at 48 MiB (1,283 pages): copies the old 32 MiB, moves the roster, renames
  the bag's keys through the remap table {11 → 211, 12 → 212, 13 → 213}, copies the globals.
- **The scribe** (32 MiB): a nonzero byte in exactly 48 pages (page 0 and pages 11, 21, …, 471, each with a byte at its
  last offset), saving when it reads an entry of its `save` control; a `same_machine.counter@1` item beside it.
- **The roguelike** (64 MiB, a nonzero byte in every page): its hero loses 1 hp a step from 3,000; it saves slot 1 at
  step 1,800 and writes slot 1 into `ends` at the end of the step its hp reaches 0, an ended save at step 3,000.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s.

| ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| 1 `#189.d38f773c` | `ac01-layout-binding.test.ts` (2) | The save's header binds sha256(V1). Under `fix` it opens straight; the frame at the opened state shows roster, gold and floor as step 1,799 left them, and step 1,800's roster, gold, floor and bag equal the never-stopped old run's while its foe differs. Under `inserted`: `save_refused`, a `layout` Differ naming sha256(V1) and sha256(V2). Fails: a save bound to the program hash, an open that loses the saved memory |
| 2 `#189.f77560ca` | `ac02-logic-layout.test.ts` (3) | `layout` over the fixture save, same [roster, gold, floor], 60 steps, under `fix`: PASS, one `move` probe from 1,800, both replicas' steps 1,800 to 1,859, the old replica's arrays equal to the test's own `open_save` of the save under `old` fed the reported entries, the current's equal. Under `shifted`: opens straight, FAIL naming the save, roster, element 0 and step 1,800 (the test's own runs say so too). Without the save carried: BLOCKED with an ask naming it. Fails: a check that compares nothing, a pass on a missing save |
| 3 `#189.b334c9c9` | `ac03-program-hash-and-globals.test.ts` (2) | `bare` → `bare_nop`: refused, the `layout` Differ naming both program hashes. `old` → `extra`: refused with a `globals` Differ naming global 5, and no `layout` Differ |
| 4 `#189.318802ef` | `ac04-migration.test.ts` (2) | Under `m48` with the migration from {sha256(V1), content, modules}: opens `via: migration` as a new save bound to sha256(V48) at 1,800; the old save stays, bytes unchanged; step 1,800's roster equals the never-stopped run's, the bag reads 211, 212, 213, 14; `migration.fuel` > 33,000,000 and > 10,000,000, within `budget` {671,088,640; 88,080,384; 262,144}. `migration_runs_under_step_budget`: `migration_failed` naming the migration, trap kind `fuel`, only the old save left |
| 5 `#189.43b8fb06` | `ac05-written-pages.test.ts` (2) | The scribe's save at 1,800 is at least 48 pages and under 49; its header's `deep_hash` is its SaveWritten's (scribe and counter); it opens at those hashes. With a good save at 1,200 and a `save_drops_a_page` save at 1,800: the open lists the latter in `refused` with module `logic`, its recorded hash and another, and opens the 1,200 save at its hashes |
| 6 `#189.159eb39e` | `ac06-ended-slot.test.ts` (3) | The run to 3,000 saves at 1,800 and an ended save at 3,000, after which the folder holds only the ended save; the slot opens at 3,000; with the ended save cut short it opens nothing (`judge` empty). A live session frozen and killed by PID while the ended save's `*.tmp` exists leaves the 1,800 save alone and unchanged, and it opens. `ended_keeps_earlier_save`: `judge` fails, each failure naming slot 1 |
| 11 `#189.9badbff7` | `ac11-budgets.test.ts` (4) | Reference Mac only, each by `judgeLimit`: the 48-page save's `open_ns` < 50 ms; a `layout` call's wall time < 2 s; the 32 MiB migration's `ns` < 1 s; and 120 frames of a live view of the dungeon without `saves` each report `saves_ns` 0 while it steps |
| 12 `#189.5c949f64` | `ac12-growing-segments.test.ts` (2) | Under `table`: `save_refused` with a `segment` Differ {segment 2, offset: the first byte at or after 8,192 the saved roster and gold hold nonzero}, no `layout` Differ. `open_writes_new_segments`: opens straight and the judge names roster first |
| 13 `#189.8d6bb564` | `ac13-field-table.test.ts` (2) | Under `v3`: `save_refused`, a `layout` Differ naming both layouts whose `fields` are exactly torch added, roster moved, gold missing, coins added, floor retyped. `refusal_names_first_field`: one field named, the judge naming the other four |

Test count: 2 + 3 + 2 + 2 + 2 + 3 + 4 + 2 + 2 = 22.

## Readings where the issue leaves a choice

- **"Saved at step 1,800"; "dies at step 3,000"**: as #534's suite numbers a save, by the state it holds: asked at the
  end of step 1,799, the save is at step 1,800; the hero's last hp goes at the end of step 2,999, so the ended save holds
  step 3,000's state. "Never step 1,800's" includes the ended save cut short: the slot then opens nothing.
- **"Naming both layouts"**: sha256 of each layout's bytes. **"Naming that global"**: its index as written (5).
- **"With the old program's run from the same save giving the expected arrays"**: the expected arrays are an
  `open_save` of the save under the old program fed the entries logic.layout reports, so the old replica must report
  what that program does; **"deleted"**: the piece names the save and doesn't carry it.
- **Criterion 4's "a step's cap"**: the most fuel a step's budget may give an item, 10,000,000 (the dungeon's item
  declares it), so "past a step's cap" is fuel over 10,000,000; the planted module runs the migration under it.
- **Criterion 5's "holds those 48 pages, plus its header and the other modules' state"**: the file is at least 48 pages
  and under 49, the counter's state in it shown by its opened hash; **"the module"**: the canvas module whose state hash
  differs, `logic`.
- **Criterion 12's "first offset that overlaps saved state"**: the first address the new segment writes, outside the old
  segments, where the save holds a nonzero byte: here a byte of the saved roster.
- **Criterion 13's "all four"**: the change's four parts (the new field, the moved roster, the rename, the retype), as
  five field entries; the rename is gold missing and coins added.
- **Criterion 11's "compared with the merge base"**: as #534's suite reads it, each reading against its absolute limit
  with the repo's judge on the reference Mac; "a piece without saves gains no work per frame" is `saves_ns` 0 every
  frame, the merge base's saves work for such a piece. The budget tasks the implementer adds to the preflight are theirs.

## Not tested here

Carry records and `carry_in` (criterion 7), the web player's storage (9), worlds in a save's content and re-derivation
after a runtime digest change (8, 10, and criterion 11's re-derive leg), a migration's remap check against catalogs, a
slot count above 1, and a save opened by a piece's own logic.
