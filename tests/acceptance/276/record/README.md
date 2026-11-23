# Acceptance tests for #276: the profile record in the app (criteria 1, 2, 3, 5 and 6)

Written first, blind, from issue #276 (live, November 20, 2026: its Scope and its acceptance criteria), the design
sections it links and the base commit `fcbfca05f` (main `e575a47af` with #189's branch merged, PR #2936 at
`a4a247731`), by a job that never saw an implementation; none existed, and no other branch, worktree, pull request,
plan or session was read. This folder holds five of the issue's seven criteria, the 1st, 2nd, 3rd, 5th and 6th in the
issue's order; criterion 4 (a two-seat match) and criterion 7 (the web player) belong to other jobs' folders. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding).

## What was read

- The issue, live (`gh issue view 276 --repo windoliver/deepbuild`).
- `node scripts/design-section.mjs --issue 276`: Saves and Carry records (`docs/technical-design.md`); Logic: saves,
  Logic: carry records and Export: web player (`docs/canvas-primitives.md`); and Check input: logic kinds, which
  Logic: saves names. AGENTS.md.
- At the base, for surfaces only: `crates/deep-logic` (`lib.rs`'s calls, `carry.rs`, `saves.rs`'s save listing,
  `track.rs`'s entries, `piece/checks.rs`'s fields and data assets, `planted.rs`, `main.rs`), `scripts/proof-change.mjs`
  (criterion IDs) and `scripts/lanes.mjs`; the suites `tests/acceptance/189/carry/` (the assembler, the layout probe,
  `deep-logic`'s carry records) and `tests/acceptance/534/` (sessions, saves folders, controls, a cut-short save). Their
  helpers are copied and cut down here; nothing is imported from another suite.

Code was read only to learn the surfaces. Every expected value comes from the issue (xp 1200 at step 900, 2000, the
64 KiB cap), the design and this suite's own program.

## Run them

Put rustup's cargo and Node 24 on PATH; in a fresh worktree run `npm ci` once; then one file at a time:

```sh
export PATH=/opt/homebrew/opt/rustup/bin:$PATH
npm ci
for f in ac01-reopen-replay ac02-shape-binding ac03-written-whole ac05-check-replicas ac06-start-fresh; do
  NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease \
    node node_modules/vitest/vitest.mjs run --root tests/acceptance/276/record $f.test.ts --testTimeout=600000 --hookTimeout=180000
done
node node_modules/typescript/bin/tsc -p tests/acceptance/276/record/tsconfig.json   # type check
rm -rf tests/acceptance/276/record/node_modules                                      # vitest's cache after a --root run
```

What a run builds (honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless
set; helpers.ts puts Homebrew's rustup or `~/.cargo/bin` on PATH when present), each copied out of the target folder:

- **The assembler** `wat/` (crate `acceptance-276-record-wat`, #189's carry suite's renamed; `wat =1.263.0`,
  `wasmparser =0.263.0`; outside the workspace, its own `Cargo.lock`) into `target/acceptance-276-record-wat/`.
- **`deep-logic`**: `cargo build --locked --bin deep-logic`, in each file's `beforeAll`.

Every `it` and every hook passes its own 5,400,000 ms timeout, which outranks the command line's. Node built-ins and
vitest only. Saves folders are temporary and removed after each test. Criteria 3 and 6 start one `deep-logic` each
through `/bin/sh -c 'ulimit -c 0; ulimit -f 1 && exec "$0"' <deep-logic>` (A write cut short, below); nothing is
stopped by name or port, and no process outlives its `spawnSync`. The sessions are a few hundred steps of a small
program, so a file takes seconds beside its build.

`scripts/lanes.mjs` needs this line, since the files build cargo binaries and run processes under a file-size limit
(this job writes only its folder; the implementer adds it):

```js
alone.push('tests/acceptance/276/record/');
```

## Criteria to tests

IDs are `#276.` and the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white space collapsed
(`criterionId` in `scripts/proof-change.mjs`, computed from the live issue). Each test's name starts `AC<n> #276.<h8>`,
`n` the criterion's place in the issue.

| AC | ID | File (tests) | What it asserts, and the wrong program it fails on |
|---|---|---|---|
| 1 | `#276.ead11f27` | `ac01-reopen-replay.test.ts` (2) | **Main.** The read region's `profile` entry is 24 bytes (a u32 and 5 i32). Session 1, from an empty saves folder, reopens nothing and writes one record at step 900 (xp 1200), `<sha256>.profile`, whole. Session 2, a new process: `open` reopens it (`profile.record` its hash, nothing damaged, no notice); step 0 reads a u32 1, xp 1200 and the look [10, 20, 30, 40]; its track holds one profile entry, at t 0, naming the record; it writes its record at step 600 (xp 2000). The folder keeps both. A `bake` of session 2's track with the saves folder (its replay) reads 1200 at step 0 and writes session 2's arrays at all 601 steps; a start after it reopens the 2000 record. **Planted.** `profile_replay_reads_store`, on the replay alone: it reads 2000 at step 0, and the replay-against-session check fails, a failure naming `step 0` and `hero.xp`. Fails on: the base (no `profile`); no record, a record at another step or not whole; a start that doesn't reopen it, or fills the region in another order; a replay that reads the store's newest (the twin) or zeros; a track without the entry |
| 2 | `#276.298725e9` | `ac02-shape-binding.test.ts` (2) | **Main.** The hero with stage 1 writes its record at step 900 (xp 1200). With a new stage asset beside stage 1 (another content, the same program) a start reopens it, no notice, step 0 reads xp 1200 and the look. The hero whose `look` has 6 values: `profile.record` null, one notice `{code: "profile_refused", array: "look"}`, step 0 reads a u32 0 and zeros (got_flag 0, xp 0, look zeros, over its init's garbage), the folder's `*.profile` files keep their names and bytes, and the stage-1 hero then reopens the record again. **Planted.** `profile_bound_to_content`, on every process of its test: the start after the stage change refuses the record, and the keeps-the-record check fails, a failure naming the new stage asset's ID (its sha256). Fails on: the base; a record bound to the content or the program; a shape change that opens the record, gives no notice, several, or names another array, starts with old values or garbage, or drops or rewrites the record |
| 3 | `#276.87ed7e10` | `ac03-written-whole.test.ts` (1) | The big hero (a stash of 1,024 i32) writes record A at step 300 (xp 400), over 1,024 bytes. Session 2 reopens A and asks for its next record (xp 800) at step 300 under a one-block file-size limit: no reply lists it as written whole, and the process is stopped by SIGXFSZ or the write fails with a reply. Session 3 reopens A with nothing damaged and xp 400 at step 0, and writes B (xp 800) whole at step 300. B's file cut short by its last byte: session 4's `profile.damaged` is `[B]` and `profile.record` is A, xp 400 at step 0. Fails on: the base; a record written in place or under its own name before it reads back whole (session 3 names it damaged); a store that drops the previous record before the new one reads back whole; a start that skips the hash, opens nothing when the newest fails, or doesn't name it |
| 5 | `#276.0d49208e` | `ac05-check-replicas.test.ts` (2) | **Main.** The viewer's saves folder holds a record of xp 1200; another folder a record of xp 400, whose bytes are the fixture. Three runs of 61 steps, each different at step 0: a `bake` with no record (zeros, checked: a u32 0 and zeros), a start in the viewer's folder (1200) and a start in the fixture's folder (400). A `golden` with `saves_dir` the viewer's folder has the zeros run's 61 step hashes; with the fixture's bytes in the piece's assets and `profile` its asset ID, the fixture run's. **Planted.** `check_reads_viewer_profile`, on the golden alone: its step hashes are the stored record's run's, and the check fails, naming the source, "the viewer's stored record" and its hash. Fails on: the base; a check that reads the viewer's store (the twin), ignores the fixture the brief names, or leaves the region unfilled |
| 6 | `#276.e0857b1c` | `ac06-start-fresh.test.ts` (1) | The big hero writes A at step 300 (xp 400). `open` with `fresh: true` to step 149: nothing reopened, step 0 reads a u32 0 and zeros, no profile entry on its track, the folder's `*.profile` files keep their names and bytes, and a start after it reopens A. A fresh run asking at step 150 (xp 200) under the one-block limit: its write is cut short, and a start after it reopens A with nothing damaged. A fresh run asking at step 150 without the limit writes C whole, and a start after it reopens C, xp 200 at step 0. `check` admits a profile of xp and 16,383 i32 (65,536 bytes) and refuses one of xp and 16,384 i32 with `logic_refused`, item `hero`, and one refusal of `field: "profile"` whose `size` is 65,540. Fails on: the base; a fresh start that reopens the record, leaves the region unfilled, or deletes or rewrites the stored record; a request that drops the stored record before the new one reads back whole; a cap that admits 65,540 bytes, refuses 65,536, counts the u32, or names no size |

Test count: 2 + 2 + 1 + 2 + 1 = 8.

## The surface under test

The issue names `profile: {arrays: {name → {type, count}}, request: array name}` on a logic item, the 64 KiB cap, the
record written whole or not at all where saves are kept, the reopen at start entering the input track as one entry
at step 0 by hash, the read region's u32 and arrays, the shape refusal's one notice, start fresh, and fixture records
for checks; it names no call, file or notice code. The surface is the base's `deep-logic` (#531's JSON-lines protocol
with #534's sessions and saves folders and #189's carry records): "the app" is the logic module's own code through
it, as #534's and #189's READMEs read it, and **a session of the app is one `deep-logic` process**, closed when the
process exits. **Every name marked *(chosen)* is this job's**, the smallest surface the criteria need, shaped like
its neighbours (#189's carry records above all); the implementer builds exactly these, or a dispute goes to a blind
redraft. Calls and fields not named here stay as #531's, #532's, #534's and #189's READMEs define them.

### Fields

- **`profile: {arrays: {name → {type, count}}, request: array name}`** on a logic item: the issue's field. Each name in
  `arrays` is one of the item's own `writes`, of that type and count *(chosen: as `carry.out` names its arrays)*;
  `request` is one of its own i32 arrays. The tests' arrays are all `i32`, declared in its writes as `{type: "i32",
  count}`.
- **Its size** is the sum over `arrays` of the type's size times the count (an i32 is 4 bytes): the record's numbers,
  without the read entry's u32. At most 65,536 bytes; past it, `check` refuses the piece: `{"ok": false, "code":
  "logic_refused", "item": <logic ID>, "refusals": [{"rule": "field", "field": "profile", "size": <bytes>, "what":
  text}, …]}` *(chosen: #531's refusal shape, with `size` naming the size)*.
- **The read region** *(chosen, as #189's carry_in entry)*: the item's region map gains `{region: "reads", name:
  "profile", offset, size}`, `size` 4 plus the profile's size. Before step 0 the logic module writes it: a u32 1, then
  each array of the record in `arrays`' declaration order, end to end, each laid out as a write of its type and count
  is; or, without a record, a u32 0 and zeros, whatever memory held there before. Where it sits among the read
  region's entries is the implementer's; the program reads its offset from `check`'s region map.

### Record files and the store

- **Writing a record.** A step k that writes 1 into the item's `profile.request` writes a profile record of its
  `arrays` as step k left them, once step k ends, into the run's `saves_dir` (records are kept where saves are); with
  no `saves_dir` it writes none. A record's `step` is k, **the step that asked** *(chosen, as #189's carry records)*.
- **Files** *(chosen)*. `<saves_dir>/<sha256>.profile`, the sha256 of the file's whole bytes; the bytes are the
  implementer's (they hold the arrays and what binds the record: their shape alone, the issue's "bound by its arrays'
  shape alone"). A record is written under a name ending in `.tmp` and renamed once it reads back whole; the folder
  may hold other files of the implementer's (an index, a sequence), never named `*.profile`.
- **The store** keeps at least each piece's newest whole record and the one before it (as a save slot keeps its
  saves). Which is newest is the order the records were written in; how the store keeps that order is the
  implementer's. A record whose bytes don't hash to its name is damaged.

### Calls

| Call | Reply |
|---|---|
| `{"call": "open", …#531's fields, "saves_dir", "track"?, "fresh"?: true}` *(`fresh` chosen)* | #531's `{ok, session, items}`, plus `"profile": ProfileOpened` |
| `{"call": "step", "session", "to"}` (#531's, #534's) | #534's, plus `"profiles": [ProfileWritten]` |
| `{"call": "bake", …, "saves_dir"?}` (#531's, #534's) | #534's, plus `"profiles": [ProfileWritten]` |
| `{"call": "golden", …#532's fields, "saves_dir"?, "profile"?: asset ID}` *(`profile` chosen)* | #532's `{ok, golden: {step_hashes, …}}` |
| `{"call": "check", "piece"}` (#531's) | #531's, or the cap's refusal above |

```text
ProfileOpened = {"record": sha256 | null, "damaged": [{"hash": sha256, "file": path}], "notices": [ProfileNotice]}
ProfileNotice = {"code": "profile_refused", "array": name, "record": sha256, "what": text, …}
ProfileWritten = {"item": logic ID, "step": k, "hash": 64 hex (the record file's sha256), "file": path}
```

- **`open` is the piece starting in the app** *(chosen)*. With `saves_dir` and an item that declares `profile`, it
  reopens the newest whole record in the folder: `profile.record` is its hash, and the session's track gains its entry
  at step 0. `damaged` names each record file in the folder whose bytes don't hash to its name; a damaged newest record
  is passed over for the one before it. A record whose arrays don't match the item's `profile.arrays` in name, type
  and count is refused: `record` null, one `ProfileNotice` naming the first array (in the piece's declaration order)
  that differs, the run reads a u32 0 and zeros, and the record's file stays as it is. A record binds nothing but that
  shape: a data asset, the program or the document changing keeps it. With no record, `record` null and `notices` [].
  Every `open` of an item with a profile and a `saves_dir` answers `profile`, `{record: null, damaged: [], notices: []}`
  from an empty folder. The first session a process opens is `s1` (#531's).
- **`fresh: true`** *(chosen)* is the piece's menu's start fresh, this run only: `open` reopens nothing, reads no
  record, writes nothing to the store, and the run reads a u32 0 and zeros (`record` null). Its requests write records
  as any run's do, which replace the stored one only once they read back whole.
- **`step` and `bake`** list in `profiles` every record their steps wrote, in step order, each once it has read back
  whole (the reply waits for it); a write that fails is never listed as written whole.
- **The record's entry** on the input track *(chosen, as #189's carry entry)*: `{"t": 0, "profile": <sha256>, …}`,
  its other fields (`seq`, `writer`, `player`) the implementer's; a session's `step` reply's `track` holds it. **Only a
  start reopens a record.** A `bake` (a replay) and every check call read a record only when their track holds a
  profile entry, by hash from their `saves_dir`, so a replay reads the record its run read whatever the store holds
  now; with none they read a u32 0 and zeros.
- **Checks** *(chosen)*: a check's replica starts with zeros, whatever its call's `saves_dir` holds (the folder the
  app keeps the piece's records in, the viewer's store), unless the call names a fixture record, `"profile": <asset
  ID>`, its bytes (a record file's bytes) carried in the piece's `assets` under that sha256, as logic.layout's fixture
  saves are: then its replica starts with that record's entry at step 0. The tests drive `golden` (#532's: the
  replica that records every step's hash) with and without one; the same holds for `determinism`, `budget` and
  `layout`, which the tests don't drive. Step hashes are #531's: a step's `items.<id>.hash`, which depends on what the
  step wrote alone.

### A write cut short

Criteria 3 and 6 cut a record's write short with the kernel's file-size limit rather than a timed kill: the process
runs under `ulimit -f 1` (one block, 512 or 1,024 bytes as the shell counts it; core files off), so any regular file
it writes stops there and the kernel stops the process with SIGXFSZ (or, if the process ignores the signal, the write
fails with EFBIG). The big hero's record holds 4,116 bytes of numbers that don't compress, so its write is cut short
in any encoding, while the session's earlier steps write no file. Checked at the base (BASE-FAILURE.txt): a save of
the big hero asked under the limit stops `deep-logic` with SIGXFSZ after its two earlier replies, leaving a
1,024-byte `.tmp`. Before the asking step the session must answer as usual. The tests accept
either ending (stopped by SIGXFSZ, or a reply that lists no record written whole) and then need, in a new process
without the limit, the previous record to open with nothing damaged: written whole or not at all.

### Planted twins

`deep-logic --planted <name>` (#531's argument, `crates/deep-logic/src/planted.rs`), never an environment variable; at
the base an unknown name answers `bad_input` and exits 2. Each is the shipped module with one thing wrong.

| Name | What it does wrong | Criterion | Passed to | A failure must name |
|---|---|---|---|---|
| `profile_replay_reads_store` *(chosen)* | A run whose track holds a profile entry (a `bake`, a replay) reads, at step 0, the newest whole record in its `saves_dir` instead of the record the entry names | 1 | the replay's process | the step (`step 0`) and the array (`hero.xp`) |
| `profile_bound_to_content` *(chosen)* | A record is bound to its item's data assets (the content) as well as its arrays' shape: a start whose item names other data assets than the record's writer did refuses it | 2 | every process of its test | the new stage asset's ID |
| `check_reads_viewer_profile` *(chosen)* | A check's replica that names no fixture record starts from the newest whole record in its call's `saves_dir`, as a start in the app does | 5 | the golden's process | the source: "the viewer's stored record" and its hash |

Criteria 3 and 6 name no twin; their wrong programs are the base and the ones in the table above.

## Fixtures

All made at test time (`hero.ts`); no personal data; CC0. Each program is WebAssembly text assembled by `wat/`, built
against the region map `deep-logic`'s `check` gives a layout probe of its item (`check` with the item's `profile`,
so a base that refuses the field fails there, at each test's first call).

- **The hero** (`hero`, 60 Hz, checkpoint every 60): reads the control `rest` (a slider; an entry of yours at step k,
  `t` = k × 11,760,000 flicks, is a rest point the player reaches); writes `xp` (i32), `look` (i32 × 4), `request`,
  `got_flag`, `got_xp`, `got_look` (i32 × 4), and in the big hero `stash` (i32 × 1,024); `profile: {arrays: {xp: {i32,
  1}, look: {i32, 4}, stash?: {i32, 1024}}, request: "request"}`; names the data asset stage 1 (and stage 2 in
  criterion 2), placed at its `assets_at` and never read. Its `init` writes `0xa5a5a5a5` over the profile entry. Step 0
  copies the entry's u32, xp and look into its state; every step k writes xp = (xp read) + ⌊4k / 3⌋ (1,200 at step 900
  from 0; 2,000 at step 600 from 1,200; 400 at step 300 and 200 at step 150 from 0; 800 at step 300 from 400), look =
  the look read when the u32 was 1, else 10, 20, 30, 40; got_* = what step 0 read; request = 1 at a step that reads a
  `rest` entry; stash[i] = a 32-bit mix of xp + i.
- **Criterion 2's other pieces**: the hero with stage 1 and stage 2 (the same program); the hero whose `look` and
  `got_look` have 6 values (its own program, the profile's `look` count 6).
- **The cap's pieces**: a probe of 4 pages whose item writes `xp`, `stash` (16,383 or 16,384 i32) and `request` and
  declares both in its profile.

## Readings where the issue leaves a choice

- **"The app"**: the logic module through `deep-logic`; "closed" is the process exiting; "its next session" is an
  `open` in a new process on the same saves folder; "kept per piece and per viewer" is that folder.
- **"Writes xp 1200 into its profile at step 900"**: the hero's rest point at step 900 asks for the record, which
  holds the arrays as step 900 left them, xp 1200; it is the session's only record.
- **"A replay of that session reads 1200 from its track after the stored record has moved on to 2000"**: a `bake` of
  session 2's reported track with its saves folder, run after session 2 wrote its 2000 record; compared with session
  2 at every step. A start after the replay shows the store's newest is 2000.
- **"Naming the step and the array"** (1): the comparison is the test's, and one failure names `step 0` and
  `hero.xp`.
- **"A new stage asset"** (2): a second data asset the item names beside stage 1, so its content differs and its
  program doesn't. **"A changed count on one array"**: `look` 4 → 6. **"The old record stays"**: the folder's record
  files keep their names and bytes, and the record still opens for the piece whose shape matches.
- **"Naming the asset"** (2): the new stage asset by its asset ID, the sha256 the piece names it by.
- **"A write cut short"** (3, 6): the file-size limit above. **"A record whose hash fails"**: the newest record's file
  cut short by its last byte, as #534 cuts a save.
- **"A replica a check runs"** (5): the replica `golden` runs, compared with three reference runs by step hashes;
  **"the brief names a fixture record"**: the call's `profile`, its bytes a real record of xp 400 another folder
  holds. **"Naming the source"**: the failure names which run the replica's hashes are, "the viewer's stored record"
  with its hash.
- **"Start fresh runs with zeros and keeps the stored record"** (6): `fresh: true`; "keeps": the folder's record
  files unchanged and a later start reopening the record. **"The next request replaces it only once the new one reads
  back whole"**: the fresh run's own next request, cut short (nothing replaced) and then whole (replaced). The fresh
  run asks at step 150 so its record (xp 200) never equals one the store already holds.
- **"A profile declared past the cap … naming its size"** (6): 65,540 bytes of numbers, `size` in the refusal; the
  one at 65,536 is admitted, so the u32 isn't counted.

## Base facts

At the base `deep-logic`'s `check` refuses a logic item's `profile` (`logic@1 has no field profile`), so every test
fails at its first call, a layout probe's `check`, before any session runs. It has no `fresh`, no `profile` in an
`open` reply, no `profiles` in a `step` or `bake` reply, no profile entry on a track, no `.profile` file, no
`profile` on `golden`, and none of the three planted names. `BASE-FAILURE.txt` is the run at the base.

## Not tested, and why

Criteria 4 (a two-seat match, the Join prompt's words) and 7 (the web player) are other jobs'. No criterion of this
folder asks: the piece's menu and delete; a program change keeping the record (the issue's Scope; criterion 2 changes
content only); arrays of types other than `i32`; several items with profiles in one piece; `determinism`, `budget` and
`layout` with a fixture record (`golden` stands for the checks); a record moving numbers only and never counting as
evidence; a whole-state save still opening only by the viewer's hand.
