# Acceptance tests for #189: carry records, and carry records and ended slots in the web player

Written first, blind, from issue #189 (live, November 19, 2026: its Scope, its Fields and its acceptance criteria),
the design sections it links and the base commit `531da1ef0`, by a job that never saw an implementation; none
existed, and no other branch, worktree, pull request, plan or session was read. This folder holds two of the issue's
thirteen criteria, the 7th and the 9th in the issue's order; the others belong to other jobs' folders. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding).

## What was read

- The issue, live (`gh issue view 189 --repo windoliver/deepbuild`).
- `docs/technical-design.md`: Saves, Saves across changes, Carry records (and the Logic sections around them).
  `docs/canvas-primitives.md`: Logic `logic@1`; Logic: checkpoints and bake; Logic: saves; Logic: saves across
  changes; Logic: carry records; Check input: logic kinds; Registry and seal and its runtime digest; Export: web
  player. AGENTS.md.
- At the base, for surfaces only: `crates/deep-logic` (`lib.rs`'s calls, `saves.rs`, `piece.rs` and
  `piece/checks.rs`'s region map and fields, `track.rs`'s entries), `crates/deep-player` (`web/element.js`'s saves,
  controls and notices, `src/play.rs`'s saves and `probe()`), `crates/deep-play/src/read.rs` (what `probe().values`
  gives a logic array), `crates/deep-show/src/export.rs` (how a planted player is chosen), `scripts/proof-change.mjs`
  (criterion IDs) and `scripts/lanes.mjs`; the suites `tests/acceptance/534/` (deep-logic, saves, the assembler) and
  `1041/` (the player's saves in headless Chrome: its page API and harness), and where `172/helpers.ts` reads
  `probe().values`. Their helpers are copied and cut down here; nothing is imported from another suite.

Code was read only to learn the surfaces. Every expected value comes from the issue, the design and this suite's own
programs.

## Run them

Put rustup's cargo and Node 24 on PATH; in a fresh worktree run `npm ci` once; then one file at a time:

```sh
export PATH=/opt/homebrew/opt/rustup/bin:$PATH
npm ci
for f in ac07-carry-records ac09-web-player; do
  NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease \
    node node_modules/vitest/vitest.mjs run --root tests/acceptance/189/carry $f.test.ts --testTimeout=600000 --hookTimeout=180000
done
node node_modules/typescript/bin/tsc -p tests/acceptance/189/carry/tsconfig.json   # type check
rm -rf tests/acceptance/189/carry/node_modules                                      # vitest's cache after a --root run
```

What a run builds (honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless
set; helpers.ts puts Homebrew's rustup or `~/.cargo/bin` on PATH when present), each copied out of the target folder:

- **The assembler** `wat/` (crate `acceptance-189-carry-wat`, #534's renamed; `wat =1.263.0`, `wasmparser =0.263.0`;
  outside the workspace, its own `Cargo.lock`, regenerated at this base) into `target/acceptance-189-carry-wat/`.
- **`deep-logic`**: `cargo build --locked --bin deep-logic`, in each file's `beforeAll`.
- **`deep-show`** (`ac09` only): `cargo build --locked --bin deep-show --no-default-features --features full`, as #1041's
  suite builds it, on its first use inside the test, after the logic calls the test makes first, so a base without
  the logic module's surface fails before this long build.

Every `it` and every hook passes its own 5,400,000 ms timeout, which outranks the command line's. Node built-ins and
vitest only. Temp folders are
removed after each test; each server runs as a child process and each Chrome in a process group of its own, each
stopped by its PID; nothing is stopped by name or port. The pieces play at their own rate, 60 steps a second, so
`ac09` takes minutes beside its builds (chapter 1 twice, 10 s each, and the roguelike, 56 s).

`scripts/lanes.mjs` needs this line, since the files build cargo binaries and start browsers (this job writes only its
folder; the implementer adds it):

```js
alone.push('tests/acceptance/189/carry/');
```

## Criteria to tests

IDs are `#189.` and the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white space collapsed
(`criterionId` in `scripts/proof-change.mjs`, computed from the live issue). Each test's name starts `AC<n> #189.<h8>`,
`n` the criterion's place in the issue.

| AC | ID | File (tests) | What it asserts, and the wrong program it fails on |
|---|---|---|---|
| 7 | `#189.316a5672` | `ac07-carry-records.test.ts` (1) | Chapter 1 baked 600 steps writes one record, at step 599: `<sha256>.carry` in the saves folder, whose bytes hash to its name, `from.layout` the sha256 of chapter 1's layout bytes, `from.program` its program hash, `step` 599 and `arrays` `{roster: rosterAt(599), gold: [goldAt(599)]}`, which are also step 599's own arrays. `open_carry` into chapter 2: step 0 reads `[1, …roster, gold]` in carry_in's order; the run's track is exactly the record's entry at step 0 by hash; a `bake` of chapter 2 on that track gives the same full-state hash at every checkpoint and the same arrays at every step. The record rewritten with 16 roster values: `carry_refused`, one array `Differ`, `roster`. Chapter 1's program with another layout: its record names that layout; `carry_refused` with a layout `Differ` naming it and `accepts` `[chapter 1's]`. Chapter 2 baked without a record: step 0 reads all zeros over its init's garbage. Fails on: the base (no `carry`, `carry_in` or `open_carry`); a record at another step or of other values, arrays or layout; arrays read in another order; a replay that ignores the entry; a shape or layout check that passes; a read region left unfilled without a record |
| 9 | `#189.ddd81069` | `ac09-web-player.test.ts` (2) | **Main.** Chapter 1 played to its end lists one record at step 599 in `probe().records`; a new page of that profile still lists it; "Export record" gives `<sha256>.carry`, the record the storage keeps, with the app's record's layout, step and arrays. In a fresh profile chapter 2 lists no record and reads zeros; "Import record" of a copy whose gold has one changed byte, under the record's name, gives a `carry_refused` notice naming the record and chapter 2 takes nothing; "Import record" of the file opens chapter 2 with the step-0 arrays the app's chapter 2 reads with the app's record. The roguelike played from the start lists slot 1's save at 1,800, then its ended save at 3,000, each with the app's full-state hash there; past its later ask at 3,300 the slot still holds the ended save; in a new page the slot lists only it, and "Open save" opens it at step 3,000's full-state hash. **Planted.** `web_carry_import_skips_hash` takes the changed copy and the same check fails, naming the record by its hash. Fails on: the base (no record, control or `probe().records` in the player); a record kept in the page alone; another record than the app's; an import that skips the hash (the twin); a player that writes no ended save, lets a later save replace it, or opens an earlier one |

Test count: 1 + 2 = 3.

## The surface under test

The issue names `carry`, `carry_in`, the Record's fields, the viewer opening a record "as they open a save", the
record's entry on the input track at step 0 by hash, the refusals and, for the web player, the browser's storage
"with the same export and import (#1041)"; it names no call, file, control or probe field. The surfaces are the
base's: `deep-logic` (#531's JSON-lines protocol with #534's saves; "the app" is the logic module's own code through
it, as #534's README reads it) and the web player as #172's and #1041's READMEs define it (`deep-show run` with the
scenario's `planted` key, `export` with `video.codec: web`, the bundle's `<deep-player>`, `probe()`, the player's own
controls and notices marked `data-deep-notice`). **Every name marked *(chosen)* is this job's**, the smallest surface
the criteria need, shaped like its neighbours; the implementer builds exactly these, or a dispute goes to a blind
redraft. Calls and fields not named here stay as #531's, #534's, #172's and #1041's READMEs define them.

### deep-logic: fields

- **`carry: {request: array name, out: [array name]}`** on a logic item, and **`carry_in: {arrays: {name → {type,
  count}}, accepts: [layout]}`**: the design's fields (Logic: carry records). The tests' arrays are all `i32`.
- **`layout_at`**: the design's optional export (Logic: saves across changes), an immutable i32 global; at it a u32
  (little-endian) of the length n, then n bytes. The item's state layout is the **sha256 of those n bytes, in
  lower-case hex** *(chosen: the design says "their hash", and every hash a save or a record names is a sha256)*.
  A program that exports none has its program hash as its layout (#534).
- **The read region** *(chosen)*: a taking item's region map gains the entry `{region: "reads", name: "carry_in",
  offset, size, type}`, whose size is 4 plus each carry_in array's type size times its count (56 bytes here). Before
  step 0 the logic module writes it: a u32 1, then each array of the record in carry_in's declaration order, end to
  end, each laid out as a write of its type and count is; or, without a record, a u32 0 and zeros, whatever memory
  held there before. Where the entry sits among the read region's entries is the implementer's; the programs read
  its offset from `check`'s region map.

### deep-logic: calls

| Call | Reply |
|---|---|
| `{"call": "bake", …#531's and #534's fields, "saves_dir"?}` | #534's `Bake`, plus `"carries": [CarryWritten]` |
| `{"call": "open_carry", "piece", "saves_dir", "record": sha256, "track"?: [Entry], "steps": n}` *(chosen)* | `CarryOpened`, or `CarryRefused` |

```text
CarryWritten = {"item": logic ID, "step": k, "hash": 64 hex (the record file's sha256), "file": path}
CarryOpened  = {"ok": true, "record": sha256, "track": [Entry], "steps": [StepRecord], "checkpoints": {<item ID>: [Checkpoint]}}
CarryRefused = {"ok": false, "code": "carry_refused", "record": sha256, "differs": [CarryDiffer]}
CarryDiffer  = {"what": "array", "array": name, "record": {type, count} | null, "piece": {type, count} | null}
             | {"what": "layout", "record": the record's layout, "accepts": the taking item's accepts}
```

- **Writing a record.** A step k that writes 1 into the giving item's `carry.request` writes a carry record of its
  `out` arrays as step k left them once step k ends, into the bake's `saves_dir` (records are kept where saves are);
  with no `saves_dir` it writes none. A bake's reply lists in `carries` every record its steps wrote, in step order,
  each once it has read back whole. A record's `step` is k, **the step that asked** *(chosen: a record holds arrays
  "as that step left them", where a save, which a run resumes from, is numbered k + 1)*.
- **Record files** *(chosen)*. `<saves_dir>/<sha256>.carry`, the sha256 of the file's whole bytes, which is the
  Record's `hash`; no field inside holds it. The bytes are one JSON object, UTF-8: `{"from": {"layout", "document",
  "program"}, "step": k, "arrays": {name → [number]}}`, `arrays` holding exactly the `out` arrays, each as its
  `count` values; `layout` the giving item's state layout, `program` its program by hash (as `check` reports it,
  `hash` or `program`), `document` the piece by hash (64 hex). White space between tokens is the implementer's. A
  record is written under a name ending in `.tmp` and renamed once it reads back whole (design); no test here kills
  a write.
- **`open_carry`** is the viewer opening a record into the taking piece from the app, as a save opens: it reads
  `<saves_dir>/<record>.carry`, and refuses it when its arrays don't match the taking item's `carry_in` (one
  `CarryDiffer` an array whose name, type or count differs, or that one side lacks) or when its `from.layout` isn't
  in `accepts` (one layout `CarryDiffer`). Otherwise it runs the piece from step 0 to n − 1 on `track` with the
  record's entry added at step 0; `track` in the reply is the input track the run read; `steps` and `checkpoints` are
  #531's. A record whose bytes don't hash to its name, or a missing file, is refused with a code of the
  implementer's (no test here reaches it in the app).
- **The record's entry** on the input track *(chosen)*: `{"t": 0, "seq": 0, "carry": <sha256>, "writer": "you",
  "player": 1}`. A `bake` whose `track` holds one reads that record by hash from its `saves_dir`, so a replay reads
  the record its run read.

### The web player

- **Writing a record.** A piece whose logic declares `carry` writes its record to the browser's storage for the
  page's origin when play reaches the asking step, as #1041's saves are written; the tests reach it by `play()` from
  the start of a page and wait for it on `probe().records`. Records keep to the browser's storage as saves do
  (Export: web player): whole or not at all, in storage the origin's quota counts.
- **`probe().records`** *(chosen)*: an array with one entry for each carry record the browser's storage holds for the
  page's origin, `{hash: sha256 (the record's, which names its file), step, layout}`, `[]` when it holds none, read
  from the storage at each call and listed once written whole. The tests read `hash` and `step`. `probe()` still
  writes nothing.
- **`probe().values`** (#172's, unchanged): a logic array of one element, `<logic ID>.<name>`, as its value; the base
  gives no value for an array of more, so chapter 2 writes each value it read as an array of its own.
- **The player's own controls**, found as #1041's are (a `button`, an element with `role="button"`, an `input`, a
  `label` or a link, in the document or an open shadow root under it, whose `aria-label`, else text, is exactly the
  name, white space collapsed), there once the player is ready, activated with `click()` as a user's gesture:
  - **`Export record`** *(chosen)*, on a page whose piece's logic declares `carry`: hands the browser a download of
    the piece's newest record in the storage, its bytes those of the app's record file (Record files), named
    `<sha256>.carry`.
  - **`Import record`** *(chosen)*, on a page whose piece's logic declares `carry_in`: opens the file chooser of an
    `<input type="file">`. A file named `<64 hex>.carry` is held to the sha256 its name gives (the tests always name
    it so); the record is then checked against the piece's `carry_in` as the app checks it. Refused, the page shows a
    `carry_refused` notice and takes nothing: its run, the storage and `probe().records` stay as they were. Taken, the
    record is kept in the storage and opens the piece as the app opens it: its entry enters the input track at step
    0 by hash and the piece is made again on that track, held from its start.
  - **`Open save`** (#1041's) opens a slot's save; the roguelike declares one slot.
- **Notices.** `carry_refused` *(chosen)*: an imported record was refused (its hash, its shape or its layout). Its text
  holds the record's hash, all 64 hex digits, as the file's name gives it. #1041's kinds are unchanged.
- **Ended slots** keep to the browser's storage as saves do: once a slot's ended save is written whole the slot
  keeps only it and takes no later save, `probe().saves` (#1041's) lists it, and "Open save" opens it.

### Planted programs

Chosen by the scenario's `planted` key on `deep-show run`, never an environment variable; at the base the name
answers `bad_input`. The twin is the shipped player with one thing wrong; the export that carries it writes it into
the bundle (the tests plant it on chapter 2's export only).

| Name | What it does wrong | Criterion | A failure must name |
|---|---|---|---|
| `web_carry_import_skips_hash` *(chosen)* | "Import record" takes a record without holding its bytes to the sha256 its file's name gives | 9 | the record, by that hash |

Criterion 7 names no twin; its wrong programs are the merge base and the ones in the table above.

## Fixtures

All made at test time (`fixtures.ts`); no personal data; CC0. Each program is WebAssembly text assembled by `wat/`,
built against the region map `deep-logic`'s `check` gives a layout probe of its item (`check` with the item's fields,
so a base that refuses them fails there).

- **Chapter 1** (`chapter1`, 60 Hz, 600 steps, a checkpoint every 60): writes `roster` (i32 × 12: 3 units of 4
  values), `gold` (i32) and `carry` (i32) at every step: roster element i = 1000 (⌊i/4⌋ + 1) + 100 (i mod 4 + 1) + k,
  gold = 7k + 5, carry 1 at step 599 only; `carry: {request: carry, out: [roster, gold]}`. It exports `layout_at` =
  1024, an active data segment holding a u32 of the length and the text `campaign chapter 1 state: roster i32 x 12,
  gold i32; version 1`. **Chapter 1 with another layout** is the same program with `version 2`.
- **Chapter 2** (`chapter2`, 60 Hz, 121 steps in the app, 10 s in the player): `carry_in: {arrays: {roster: {i32,
  12}, gold: {i32, 1}}, accepts: [sha256 of chapter 1's version-1 layout bytes]}`. Its `init` writes `0xa5a5a5a5`
  over the carry_in entry; step 0 copies the entry (the u32 and the 13 values) into its memory; every step writes them
  as `got_flag`, `got_roster0` … `got_roster11`, `got_gold` (i32 each) and `purse` (the gold read, plus 1 a step).
  It reads nothing else.
- **The roguelike** (`rogue`, 60 Hz, 56 s: 3,360 steps): `saves: {slots: 1, request, ends}`; `hp` a mutable global,
  3,000 after `init` and 1 less each step until 0, which step 2,999 reaches. It writes 1 into `request` at the ends of
  steps 1,799 (a save at step 1,800) and 3,299 (an ask after its end), and slot 1 into `ends` at the end of step
  2,999: its ended save, numbered as #534's saves are, is at step 3,000 and holds step 3,000's state.
- **The documents** (`ac09`): each piece as #1041's dungeon is, a 2D film at 60 frames a second, a figure a driver
  walks, and the logic item with its program by hash, exported on an empty recorded track; three folders of one
  origin served by a `node:http` child process as #1041's server serves them. The app's values: chapter 1's record
  and chapter 2 opened with it through `deep-logic` (the same programs); the roguelike's full-state hashes through
  deep-show's `logic` call on its document, as #1041's suite reads the app's.

## Readings where the issue leaves a choice

- **"At its last step"** (7): the record of step 599 of a 600-step piece, `step` 599.
- **"Accepts chapter 1's layout"** (7): chapter 1 exports a state layout, so its layout is the sha256 of its layout
  bytes; chapter 2's `accepts` lists that value, computed by the test from the bytes.
- **"Opened with the record reads the 3 units and the gold at step 0"** (7): what step 0's read region held, copied
  out by chapter 2's program, against chapter 1's step-599 values computed by the test.
- **"A replay of chapter 2 reads the record by hash from its track to the same full-state hashes"** (7): a `bake` of
  chapter 2 on the track `open_carry` reports, with the saves folder that keeps the record, whose checkpoints all
  have the opened run's full-state hashes; that track holds the record by hash and nothing else.
- **"A record whose roster has 16 values"** (7): chapter 1's record rewritten with four more roster values and named by
  its own sha256 in the same folder; "naming roster": one array `CarryDiffer`, for roster.
- **"A record from a program with another layout ... naming both layouts"** (7): chapter 1 with the version-2 layout
  bytes, baked; the refusal names the record's layout and the layouts chapter 2 accepts (chapter 1's).
- **"Chapter 2 opened without a record reads a u32 0 and zeros"** (7): chapter 2 run from step 0 with no record entry;
  its init leaves garbage where the entry is, so a module that writes nothing there fails.
- **"As in the app"** (9): the step-0 arrays `deep-logic`'s `open_carry` gives chapter 2 with the record `deep-logic`'s
  chapter 1 wrote; the exported record is also held to the app's record's layout, step and arrays (its document hash
  may differ: the app's piece and the exported document are two documents of one program).
- **"Kept in the browser's storage"** (9): listed by a new page of the same profile; **"exported to a file"**: "Export
  record" on that page; **"a fresh profile"**: another browser with a new profile folder, which lists no record.
- **"The roguelike's ended slot opens only at its end in the player too"** (9): criterion 6's roguelike, this job's
  own fixture; "opens only at its end": the slot lists the ended save and no other, a later ask doesn't replace it,
  and "Open save" in a new page opens step 3,000's state.
- **"A planted import that skips the record's hash takes a record with one changed byte"** (9): the first digit of
  gold's value in the exported file changed, the file's name kept, so the copy is still a record of the right shape
  and layout and only its hash gives it away. The shipped player refuses it; the twin takes it, and the check's
  failures each name the record by the hash its name gives.

## Base facts

At the base `deep-logic`'s `check` refuses a logic item's `carry` and `carry_in` (`logic@1 has no field carry`), so
every test fails at its first call, a layout probe's `check`, before `deep-show` is built. It has no `open_carry`, no
`carries` in a bake's reply and no record file. The base's saves already take `ends`: a step that writes a slot into
`ends` saves it as ended, the slot then takes no later save (`saves.rs`), and the player's store keeps only an ended
save in its slot (`element.js`). The player has no `probe().records`, no `Export record` or `Import record` control
and no `carry_refused` notice. `BASE-FAILURE.txt` is the run at the base.

The harness was checked against the base's `deep-logic` in a scratch test, not committed, with the fields the base
doesn't build taken out: every program assembles and runs with no trap; chapter 1's step 599 writes `carry` 1 (and no
other step does), roster `rosterAt(599)` and gold 4,198; chapter 2, its entry stood in at an offset the base never
fills, reads `0xa5a5a5a5` in all 14 words at step 0, which is what a module that leaves the entry unfilled gives;
the roguelike's bake leaves only its ended save in the folder; `oneByteChanged` turns gold 4,198 into 5,198 and
nothing else. Not tried here: `deep-show` (`full`) was not built on this loaded Mac, so the documents' presentation and
export, the browser legs and the planted name were not run at all; the browser driver is #1041's, cut down, whose
README records its own trial.

## Not tested, and why

No criterion of this folder asks: a record cut short or a killed write; a record with no saves folder; a record and
a save in one piece; a piece with more than one taking item; arrays of types other than `i32` and their alignment in
the read region; a record refused for its shape or layout in the player (the app proves those); opening a record in
the profile that wrote it; a seek past the asking step; the record's document hash; the other criteria of #189.
