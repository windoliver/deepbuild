# Acceptance test for #276 in the web player: the profile record kept in the browser, exported, imported and reopened at start

Written first, blind, from issue #276 (live, November 20, 2026: its Scope and its seven acceptance criteria), the
design sections it links and the base commit `fcbfca05f` (main `e575a47af` with #189's branch merged), by a job that
never saw an implementation; none existed, and no other branch, worktree, pull request, plan or session was read. This
folder holds one of the issue's seven criteria, the 7th, and one Scope line; the others belong to other jobs' folders.
The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding).

## What was read

- The issue, live (`gh issue view 276 --repo windoliver/deepbuild`).
- `node scripts/design-section.mjs --issue 276`: Saves and Carry records (`docs/technical-design.md`); Logic: saves,
  Logic: carry records and Export: web player (`docs/canvas-primitives.md`). AGENTS.md.
- At the base, for surfaces only: `crates/deep-player/web/element.js` (the saves' and carry records' store, controls,
  notices and `probe()`), `crates/deep-logic/src/piece/checks.rs` (the logic item's fields and its read region's
  `carry_in` entry), `scripts/proof-change.mjs` (criterion IDs) and `scripts/lanes.mjs`; the suites
  `tests/acceptance/189/carry/` (`ac09-web-player.test.ts`, its helpers, fixtures, assembler and README) and
  `tests/acceptance/1041/` (README). Their helpers are copied and cut down here; nothing is imported from another
  suite.

Code was read only to learn the surfaces. Every expected value comes from the issue and this suite's own program.

## Run it

Put rustup's cargo and Node 24 on PATH; in a fresh worktree run `npm ci` once; then:

```sh
export PATH=/opt/homebrew/opt/rustup/bin:$PATH
npm ci
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/276/web ac07-web-player.test.ts --testTimeout=600000 --hookTimeout=180000
node node_modules/typescript/bin/tsc -p tests/acceptance/276/web/tsconfig.json   # type check
rm -rf tests/acceptance/276/web/node_modules                                      # vitest's cache after a --root run
```

What a run builds (honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless
set; helpers.ts puts Homebrew's rustup or `~/.cargo/bin` on PATH when present), each copied out of the target folder:

- **The assembler** `wat/` (crate `acceptance-276-web-wat`, #189 carry suite's renamed; `wat =1.263.0`,
  `wasmparser =0.263.0`; outside the workspace, its own `Cargo.lock`) into `target/acceptance-276-web-wat/`.
- **`deep-logic`**: `cargo build --locked --bin deep-logic`, in `beforeAll`, for the item's region map.
- **`deep-show`**: `cargo build --locked --bin deep-show --no-default-features --features full`, as #1041's and #189's
  suites build it, on its first use, after the region map, so a base without the `profile` field fails before this
  long build.

Every `it` and hook passes its own 5,400,000 ms timeout, which outranks the command line's. Node built-ins and vitest
only. Temp folders are removed after each test; each server runs as a child process and each Chrome in a process
group of its own, each stopped by its PID; nothing is stopped by name or port. The piece plays at its own rate, 60
steps a second, so each test plays 15 s beside its builds.

`scripts/lanes.mjs` needs this line, since the file builds cargo binaries and starts browsers (this job writes only
its folder; the implementer adds it):

```js
alone.push('tests/acceptance/276/web/');
```

## Criteria to tests

IDs are `#276.` and the first 8 hex digits of the SHA-256 of the criterion's text, trimmed, white space collapsed
(`criterionId` in `scripts/proof-change.mjs`, computed from the live issue).

| What | ID | Test in `ac07-web-player.test.ts` | What it asserts, and the wrong program it fails on |
|---|---|---|---|
| AC7 | `#276.74f16402` | `AC7 #276.74f16402 the record step 900 writes keeps to the browser's storage …` | In a fresh browser profile the piece lists no record in `probe().profile` and reads a u32 0 and zeros at step 0; played, it lists a record once play is past step 900. The page reloaded in that profile lists the same record and reads a u32 1 and xp 1200 at step 0. "Export profile" gives a file whose bytes' sha256 is the record's hash. In another, fresh profile the piece reads zeros; "Import profile" with the file lists the record there, and the page reloaded reads a u32 1 and xp 1200 at step 0. Fails on: the base; a record kept in the page alone (the reload loses it); a player that doesn't reopen the record at start, or fills the read region late or not at all (its init leaves garbage there); a record of another step's xp; an export of other bytes than the stored record; an import that isn't kept |
| Scope | none (a Scope line, no criterion) | `Scope #276 the piece's menu, the player's own controls, names the profile, with start fresh (this run only) and delete` | After a session that wrote the record and a reload that reads it, the player's own `Profile` group names the record by its hash. "Start fresh" runs the piece from its start with a u32 0 and zeros at step 0 while `probe().profile` still lists the record, and the page reloaded reads xp 1200 again. "Delete profile" leaves `probe().profile` null; the page reloaded reads zeros, lists no record, and the group no longer names it. Fails on: the base; a menu that doesn't name the record; a start fresh that reads the record, deletes it or lasts past its run; a delete that leaves the record |

Test count: 2 (one for the criterion, one for the Scope line).

**Why the menu is here.** The Scope says "the piece's menu names the profile, with start fresh (this run only) and
delete". In the web player the menu a viewer has for a piece is the player's own controls, where the base already
puts Open save, Export save, Import save, Export record and Import record (`element.js`: a `role="group"` bar named
`Saves`); the issue's Fields add nothing for the piece's logic to draw a menu with, and the design keeps saves and
records out of the piece's logic's reach ("never the piece"). So the menu's line is proven here, in the web player,
through those controls; how the app shows the same menu is another job's.

## The surface under test

The issue names `profile: {arrays, request}`, the read region's u32 and arrays, the record's entry at step 0 by hash,
the browser's storage "with export and import", and the menu's start fresh and delete; it names no call, control,
probe field or storage key. The surfaces are the base's: `deep-logic`'s `check` (#531's region map, as #189's carry
suite reads it), `deep-show run` with `export` and `video.codec: web`, the bundle's `<deep-player>`, its `ready`,
`play()`, `pause()`, `probe()` and notices marked `data-deep-notice`. **Every name marked *(chosen)* is this job's**,
the smallest surface the test needs, shaped like the base's saves and carry records; the implementer builds exactly
these, or a dispute goes to a blind redraft.

### The logic item

- **`profile: {arrays: {name → {type, count}}, request: array name}`** on a `logic@1` item: the issue's field. Here
  `{arrays: {xp: {type: "i32", count: 1}}, request: "keep"}`; `xp` and `keep` are also among the item's `writes`
  (i32, one element each), so the record holds xp as the asking step left it, as a carry record holds its `out`
  arrays.
- **The read region's entry** *(chosen)*: `check`'s region map gives the item the entry `{region: "reads", name:
  "profile", offset, size}`, named after the field as #189's `carry_in` entry is. At step 0 the logic module fills it
  with a u32 1 and the record's arrays in `profile.arrays`' order, end to end, each laid out as a write of its type
  and count; or a u32 0 and zeros without a record, whatever memory held there before (the issue's Scope). Here that
  is 8 bytes: the u32, then xp. The program reads the entry's offset from the region map.

### The web player

- **Writing.** When play reaches a step that writes 1 into `request`, the player writes the profile record to the
  browser's storage for the page's origin, whole or not at all, kept per piece where saves are (Export: web player).
  The test reaches it by `play()` from the start of a page and waits for it on `probe().profile`.
- **Reopening at start.** When the piece starts (a page load, here a reload of the same tab), the player reopens the
  newest whole record in the storage: its entry enters the input track at step 0 by hash, and **by the time the
  player is `ready`**, step 0 has read it *(chosen: the design's `ready` means the player holds the piece's start, so
  the first state a probe or a viewer sees is the one with the record)*.
- **`probe().profile`** *(chosen)*: `null` when the browser's storage holds no profile record of this piece, else
  `{hash, …}`, `hash` the sha256 of the record's bytes (64 lower-case hex): the record the piece's next start would
  reopen, read from the storage at each call and listed once written whole. The test reads `hash`; other fields
  (a step, say) are the implementer's. It lists the stored record whether or not this run read it, so after Start
  fresh it still lists it. `probe()` still writes nothing.
- **`probe().values`** (#172's, unchanged): a logic array of one element, `<logic ID>.<name>`, as its value; the test
  reads `game.got_flag` and `game.got_xp`.
- **The player's own controls**, found as #1041's and #189's are (a `button`, an element with `role="button"`, an
  `input`, a `label` or a link, in the document or an open shadow root under it, whose `aria-label`, else text, is
  exactly the name, white space collapsed), there once the player is ready, on a page whose piece's logic declares
  `profile`, activated with `click()` as a user's gesture. A dialog a control opens (a confirm before Delete, say) is
  accepted by the test, as the viewer who clicked would; none is required.
  - **`Export profile`** *(chosen)*: hands the browser a download of the stored record, the bytes whose sha256 is
    `probe().profile.hash`. The file's name and format are the implementer's (the app's record file is another job's);
    the test hands the file back under the name the page gave it.
  - **`Import profile`** *(chosen)*: opens the file chooser of an `<input type="file">`; the record in the file is
    held to its hash and the piece's `profile` shape, then kept in the storage as the piece's record, so
    `probe().profile` lists it and the next start reopens it. What the running page does on import is the
    implementer's; the test reloads.
  - **`Start fresh`** *(chosen)*: makes the piece again from its start without the record, so step 0 reads a u32 0 and
    zeros; the stored record stays, and the next start reopens it (this run only).
  - **`Delete profile`** *(chosen)*: removes the piece's record from the storage, so `probe().profile` is `null` and
    the next start reads a u32 0 and zeros. What the running page does is the implementer's.
- **The `Profile` group** *(chosen)*: the controls above sit in an element with `role="group"` and `aria-label`
  `Profile`, as the base's `Saves` bar is. While the storage holds a record, the group names it: the record's hash,
  all 64 hex digits, appears in the group's text or in an attribute of an element in it (a `title`, say). After a
  delete it no longer does; whether the group stays is the implementer's.
- **Storage keys.** Not pinned: the base keeps saves and carry records in IndexedDB `deep-player` (object stores
  `saves` and `records`); where the profile record goes there, and under which key, is the implementer's, so long as
  it is the browser's storage for the page's origin, per piece, and survives a reload of the same profile.
- **Notices.** None is read. The failure messages print the page's notices.

## Fixture

Made at test time in the test file; no personal data; CC0.

- **The profile piece**: a 2D film of 20 s at 60 frames a second (1,200 steps), a figure a driver walks with time, and
  the logic item `game` at 60 Hz, a checkpoint every 60 steps, writes `xp`, `keep`, `got_flag`, `got_xp` (i32 each)
  and `profile: {arrays: {xp: {i32, 1}}, request: "keep"}`. Its program (WebAssembly text assembled by `wat/`, built
  against the region map `check` gives a layout probe with the same writes and profile) writes `0xa5a5a5a5` over the
  profile entry in `init`; step 0 copies the entry's 8 bytes into its memory; every step k writes them as `got_flag`
  and `got_xp`, xp = 300 + k, and `keep` = 1 at step 900 only. So the record holds xp 1200 (the issue's AC1 values),
  and a session that reopens it reads `[1, 1200]`, one without it `[0, 0]`, one whose module leaves the entry unfilled
  `[-1515870811, -1515870811]`.
- **The document** is exported on an empty recorded track into a folder served by a `node:http` child process, one
  origin; one browser is one profile (a fresh folder); "the next session" is the same tab reloaded.

## Readings where the issue leaves a choice

- **"As in the app"**: criterion 1's values, as the brief that started this job said: xp 1200 written at step 900 is
  read at step 0 of the next session with the u32 1. The test doesn't run the app; the app's record file format, and
  whether the exported file is byte for byte the app's, are other jobs' criteria.
- **"Keeps to the browser's storage"**: listed by `probe().profile` after a reload of the same profile, and the read
  region filled from it there.
- **"With export and import"**: Export profile's file holds the stored record's bytes; imported into a fresh profile,
  it is kept there and reopened by the next start.
- **"Start fresh (this run only)"**: this run from its start reads zeros, the stored record stays, and the next start
  reads it again.

## Base facts

At the base `deep-logic`'s `check` refuses the item's `profile` field (`logic@1 has no field profile`), so both tests
fail at their first call, the layout probe's region map, before `deep-show` is built. The base's player has no
profile record, no `probe().profile`, and no Export profile, Import profile, Start fresh or Delete profile control or
`Profile` group. `BASE-FAILURE.txt` is the run at the base.

## Not tested, and why

No part of criterion 7 or the Scope line asks: a record at the 64 KiB cap; a shape change's refusal and its notice; a
write cut short or a record whose hash fails; a match's entries; checks and replicas; the record's file format and its
name; per-piece keys on a shared origin (#1041's saves already prove the key); what the running page does right after
Import profile or Delete profile; the other criteria of #276.
