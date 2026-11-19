# Acceptance tests for #1041: the web player's saves, kept in the browser, per piece and persistent

Written first, blind, from issue #1041 (live, November 16, 2026: its Scope, its Fields and its four acceptance
criteria), its oracle page and the base commit `06e231702`, by a job that never saw an implementation; none existed. No
other worktree, branch, PR, stash or plan was read, and every repo file was read at the base commit. The implementing
agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).
The oracle page says no upstream test checks any of the four criteria, so there is no `1041-oracle/` folder.

**Run only where cheap.** The surface plainly doesn't exist at the base (its player keeps no save, has no control and
writes nothing), so `BASE-FAILURE.txt` says, per test, the assertion it meets first at the base, and which legs were
run. The type check passes (`tsc -p tests/acceptance/1041/tsconfig.json`, exit 0) and `vitest list` collects the 10
tests below. The browser mechanics were tried once on a hand-written stand-in page in a scratch folder (a stand-in
`<deep-player>`; not committed): a profile kept across a closed and reopened page, a fresh profile, the file a page
exports and a file handed to an import control, the origin's quota set below a save's size, and the shim's grant,
refusal and clearing journey. The three browser files were then run as written with the stand-in in the bundle's
place, to try their own logic: 9 of 9 passed, the planted tests by failing its planted variants. The fixture was
checked against the base's real components (Base facts, below).

## What was read

- The issue, live (`gh issue view 1041 --repo windoliver/deepbuild`), and its oracle page
  (`doneright/oracles/issues/1041.md`, branch `doneright` of DeepBuildAI/deepbuild).
- `docs/technical-design.md`: Films and figures on the canvas, How it installs, How we know version 0 works
  (Dogfooding, tests written first), Saves, Saves across changes; `docs/canvas-primitives.md`: Export: web player,
  Seam and backend, Tour, Net: relay and Join, Logic `logic@1`, Logic: checkpoints and bake, Logic: saves, Logic: saves
  across changes, Logic: carry records, Check input: logic kinds; AGENTS.md; CONTRIBUTING.md.
- At the base, for surfaces only: the suites `172/` (README, helpers, tests, DISPUTE.md: the model for this one) with
  the parts of `169/` it leans on, and `534/` (README, helpers, `dungeon.ts`, `programs.ts`: the dungeon and a save's
  fields), `533/` and `548/` (the layout probe and `deep_query`'s logic read); `crates/deep-show` (`main.rs`'s
  scenario and its `planted` key, `export.rs` and `export/web.rs`, `logic.rs`, `picks.rs`'s `logic` call);
  `crates/deep-player` (`web/element.js`, `src/page.rs`, `src/play.rs`); `crates/deep-play/src/logic.rs`;
  `crates/deep-logic` (`play.rs`'s `piece_of`, `module.rs`'s params, `piece.rs`'s `saves` and region map);
  `scripts/proof-change.mjs` (`criterionId`), `scripts/lanes.mjs`, `scripts/studied-names.mjs`.

Code was read only to learn the surfaces. Every expected value comes from the issue and the design.

## Run them

Put Node 24 and the pinned Rust toolchain first on PATH; in a fresh worktree run `npm ci` once; then one file at a
time:

```sh
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci
for f in ac01-saves-in-the-browser ac02-kept-per-piece ac03-persistent ac04-taste; do
  NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease \
    node node_modules/vitest/vitest.mjs run --root tests/acceptance/1041 $f.test.ts --testTimeout=3600000
done
node node_modules/typescript/bin/tsc -p tests/acceptance/1041/tsconfig.json   # type check
rm -rf tests/acceptance/1041/node_modules                                      # vitest's cache after a --root run
```

Every `it` and every hook passes its own 3,600,000 ms timeout. Each browser file builds `deep-show` (`full`) once in
`beforeAll`, as #172's suite builds it; nothing else is built (the dungeon's program is written as bytes in
`helpers.ts`, and its layout is read through `deep-show`). Node built-ins and vitest only; nothing is imported from
another suite. Temp folders are removed after each test; each server runs as a child process and each Chrome in a
process group of its own, each stopped by its PID; nothing is stopped by name or port. The pieces play at their own
rate, 60 steps a second, and a save is reached only by playing, so each browser file takes minutes beside the build
(the plays alone: about 160 s in `ac01`, 50 s in `ac02`, 90 s in `ac03`, and `ac01` holds 35 s for the quota).

`scripts/lanes.mjs` needs this line (this job writes only its folder; the implementer adds it):

```js
alone.push('tests/acceptance/1041/');
```

## Criteria to tests

IDs are `#1041.` and the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white space collapsed
(`criterionId` in `scripts/proof-change.mjs`, computed from the live issue). Each test's name starts `AC<n> #1041.<h8>`.

| AC | ID | File (tests) | What it asserts, and the wrong program it fails on |
|---|---|---|---|
| 1 | `#1041.0f4a9de0` | `ac01-saves-in-the-browser.test.ts` (3) | **Reopened.** A page plays the dungeon to its save at step 1,800 and closes; a new page of that profile lists the save in `probe().saves`, "Open save" opens it at its recorded full-state hash, and played on to step 2,400 its checkpoints 1,800 … 2,400 have the full-state hashes of a page in another profile that played 0 … 2,400 without closing, which are the app's at all 41 checkpoints. **A file.** "Export save" gives a file; a fresh profile lists no save, and "Import save" with that file opens it at the recorded full-state hash. **Quota.** After the save at step 600 the origin's quota is set to 64 bytes: the save at 1,200 isn't written, a `save_failed` notice says so, the slot still lists the save at 600, and in a new page it opens at its recorded full-state hash. Fails on: the base; a save kept in the page alone; a save without its input position or globals; a slot replaced before the new save is whole; a refused write that says nothing |
| 2 | `#1041.be83fe52` | `ac02-kept-per-piece.test.ts` (3) | The dungeon and the cellar, served from two folders of one origin, each play to their save at step 600 in one profile; opened again, each lists in slot 1 the save it wrote. The dungeon saved at one path and exported again into another folder of that origin lists that save there and opens it at its recorded full-state hash. The planted `web_saves_keyed_by_origin` fails the first judgement, naming `The cellar overwrote slot 1 of The dungeon`. Fails on: the base; saves keyed by origin alone (the twin); saves keyed by path (the re-export finds an empty slot) |
| 3 | `#1041.4e56c211` | `ac03-persistent.test.ts` (3) | Under the shim. **Granted:** the dungeon saved at 1,800, the page closed, the origin's non-persistent storage cleared, the page opened again: slot 1 lists the save and it opens at its recorded full-state hash. **Refused:** each of the dungeon's three saves is written and the page shows exactly one `saves_not_persistent` notice; "Export save" gives a file, the journey clears the storage (no save listed), and "Import save" with the file opens the save at its recorded full-state hash. The planted `web_saves_never_ask_persistence`, under a shim that would grant, fails the first judgement, naming `slot 1's save is lost`. Fails on: the base; a player that never asks (the twin); one that says so at each save, or never |
| 4 | `#1041.479f46e5` | `ac04-taste.test.ts` (1) | reads the record only (The taste call) |

Test count: 3 + 3 + 3 + 1 = 10.

## The surface under test

The base's, as #172's README defines it and unchanged: `deep-show run` (one JSON line in, one answer line out) with the
scenario's `planted` key for wrong programs, `export` with `video.codec: web` and `track`, the bundle's `index.html`
with its one `<deep-player>`, its members (`ready`, `play()`, `pause()`, `paused`), `probe()` and notices marked
`data-deep-notice`. No new binary, call, export option or receipt field. What this issue adds is below. **Every name
marked *(chosen)* is this job's**, the smallest surface the criteria need, shaped like its neighbours; the implementer
builds exactly these, or a dispute goes to a blind redraft.

### When the player saves

A piece's logic asks for a save as the design says (Logic: saves: a step that writes a slot number into its `request`
array saves that slot once the step ends). The web player writes that save to the browser's storage when play reaches
it: every test reaches a save by `play()` from the start of a page, waits for it on `probe().saves`, and then calls
`pause()`. No test seeks, so what a seek past an asking step does is the implementer's. A save's step is numbered as
#534's: a save made when step k ends holds the state before step k + 1, and its step is k + 1.

### probe()

Beside what #172 defines, `probe()` returns `saves` *(chosen)*: an array with one entry for each slot of this piece
that holds a save in the browser's storage, the save the viewer's open would open (the slot's newest that reads back
whole): `{slot: 1 to 8, step, deep_hash: {<world or logic item ID> → 16 hex}}`, shaped as #534's `SaveWritten`.
`deep_hash` is each carried state's full-state hash as the save recorded it when it was written, the hash the app's
checkpoint at that step carries. `[]` when the storage holds no save of this piece. It is read from the storage at each
call, and a save is listed only once it is written whole; `probe()` still writes nothing.

After a save opens, `probe().step` is the save's step (a later one once the player plays on) and
`probe().checkpoint_hashes` holds, for each ID, the opened state at the save's step with its full-state hash and then
every checkpoint the run reaches after it *(chosen, as #534's `Opened.checkpoints`)*. The tests read the logic item
`dungeon`'s entries only, in `saves` and in the checkpoints at and after the save's step, so earlier checkpoints may be
listed or not.

### The player's own controls

Three controls on the index page, each found by its name: `Export save` and `Import save` (the issue's Fields), and
`Open save` *(chosen: the design opens a save only by the viewer's hand, and names no control for it)*. A control is
a `button`, an element with `role="button"`, an `input`, a `label` or a link, in the page's document or in an open
shadow root under it, whose name is exactly the control's: its `aria-label` when it has one, else its text (an
`input`'s value), white space collapsed. It is there once the player is ready. The tests activate it with `click()`
as a user's gesture, so it may sit in a menu.

- **Open save** opens, from the browser's storage, the save `probe().saves` lists for the piece's slot.
- **Export save** hands the browser a file to save holding that same save: a download *(chosen)*, as a link with a
  `download` attribute gives one. The tests take the file from the browser's download folder; a save dialog of the
  system's can't be answered in a headless browser.
- **Import save** opens the browser's file chooser of an `<input type="file">` *(chosen)*, and opens the save in the
  file it is given, as any save opens. The tests answer the chooser through the DevTools protocol, which can hand a
  file only to such an input, and give back the exported file under the name the page gave it. The file's format is
  the implementer's.

Both pieces declare one slot, so each control acts on slot 1 with no further choice; how a piece with more slots picks
one isn't tested. Each test clicks Open save or Import save on a freshly loaded page, ready, at its start and not yet
played. A save that opens leaves the player holding the save's state (probe(), above); `play()` then plays on from
there on the bundle's recorded track. Whether the player plays on by itself after it opens a save isn't pinned.

### Notices

A notice is an element marked `data-deep-notice`, as #172's are, in the page's document or an open shadow root under
it. The attribute's value is the notice's kind *(chosen)*; #172's notices keep theirs. Two kinds are read:

| Kind | When | Read by |
|---|---|---|
| `save_failed` *(chosen)* | the browser refused a save's write, for quota or any other reason; the slot keeps its last good save | AC1 |
| `saves_not_persistent` *(chosen)* | once, when the browser didn't grant persistent storage: saves in this browser may be cleared | AC3 |

Each has text; its words are the implementer's and the taste call's. A notice stays in the document while the page is
open, as the base's do, so "says so once" is exactly one such element after the three saves.

### Asking for persistent storage

The player asks through the browser's own call, `navigator.storage.persist()`; the issue has the first save ask.
The shim answers that call, and the tests read what it saw once a later save is listed. The saves are kept in storage
the browser counts against the origin's quota and clears with the origin's data; which of the browser's stores that
is isn't pinned.

### The app's side

The app's values come from the base's own surface: deep-show's `logic` call (`{doc, steps, track}`: each step's arrays
and `checkpoints.<ID>` with `deep_hash`). The item's layout comes from `deep_query`'s logic read of a layout probe
(`region_map`), as the design's region map says.

## Planted programs

Chosen by the scenario's `planted` key on `deep-show run`, never an environment variable; at the base each name answers
`bad_input`. A twin is the shipped player with one thing wrong and changes nothing else; the export that carries it
writes it into the bundle.

| Name | What it does wrong | Criterion | A failure must name |
|---|---|---|---|
| `web_saves_keyed_by_origin` *(chosen)* | the player keys its saves by the page's origin alone, so every piece on an origin shares its slots | 2 | the slot the other piece overwrote: `The cellar overwrote slot 1 of The dungeon` |
| `web_saves_never_ask_persistence` *(chosen)* | the player never asks the browser to keep the origin's storage persistent | 3 | the slot whose save the journey lost: `slot 1's save is lost` |

AC1's wrong program is the merge base.

## Fixtures

All made at test time in `helpers.ts`; no personal data; CC0.

- **The dungeon** (AC1, AC2, AC3): #534's dungeon as a document. A 2D film of 40 s at 60 frames a second (2,400
  steps), a figure a driver walks with time, the slider `move` (0 to 7), and the logic item `dungeon` at 60 Hz, which
  reads `move`, writes `floor`, `health`, `inv` (8) and `request` (i32), declares `saves: {slots: 1, request:
  "request"}` and takes a checkpoint every 60 steps. Its program keeps its floor, its health and the state of its
  seeded generator in mutable globals and its inventory in memory; each `move` entry a step reads adds its index in
  the step + 1 to the inventory slot its value names. It writes 1 into `request` at the ends of steps 599, 1,199 and
  1,799: saves of slot 1 at steps 600, 1,200 and 1,800. The program's WebAssembly bytes are written in test code
  against the layout `deep_query` reports.
- **Its recorded track**: `move` entries of yours at seeded steps (about one in 30) and a burst of 40 at step 1,798;
  a step reads at most 16 a control, so 8 are still unread when the save at 1,800 is written (#534's track).
- **The cellar** (AC2): another piece, a document with another ID, title, seed and recorded track, whose logic runs
  the same program. Its saves record other full-state hashes than the dungeon's.

## The server, the browser, the quota and the shim

- **The server**: a `node:http` listener in a child process of its own, serving a folder at
  `http://127.0.0.1:<port>/`, each bundle from a folder of its own under it, every `index.html` with `no-cache`,
  every other file with a max-age of a year, WebAssembly as `application/wasm`.
- **The browser**: Google Chrome at `/Applications/Google Chrome.app` (or `CHROME_BIN`), `--headless=new` with
  `--enable-unsafe-webgpu --ignore-gpu-blocklist`, driven over its DevTools protocol by `helpers.ts` alone in flat
  sessions (no browser-automation library). One browser is one profile, a fresh folder: "the page closed and opened
  again" is a page closed and another opened in the same browser; "a fresh browser profile" is another browser.
  Pages are 1280 × 720 at device scale 1. Play is started as a user gesture.
- **The origin's storage quota** (AC1): set through the DevTools protocol (`Storage.overrideQuotaForOrigin`) to 64
  bytes, below any save's size, and lifted again before the first save is opened. The browser goes on allotting an
  origin's writes from the space it measured before for up to 30 s (observed on the stand-in with Chrome 157: a
  write right after the override is taken, one 35 s after is refused), so the test holds the player paused for 35 s
  after it sets the quota. The stand-in kept its saves in the browser's indexed database. A variant that kept them
  in the page's local storage took the write under the override (tried without the hold; the browser counted none
  of its bytes against the origin's quota), so such a player fails this leg. The origin's other quota-managed
  stores were not tried.
- **The shim over the browser's storage** (AC3): test code installed before the page's scripts
  (`Page.addScriptToEvaluateOnNewDocument`). `navigator.storage.persist()` is answered by the test, granted or
  refused, and counted; `persisted()` answers what was granted. Its journey: the page is closed; unless persistence
  was granted, every kind of the origin's storage is cleared (`Storage.clearDataForOrigin`); a page is opened again
  under the shim, which carries the grant over.

## Legs that read BLOCKED or INCONCLUSIVE

None of these is ever a pass.

- Every browser test is BLOCKED without Google Chrome at the path above, when Chrome opens no DevTools port within
  180 s (observed once at 60 s on this shared Mac, its one-minute load average above 400), or when the page's player
  isn't ready and Chrome offers no WebGPU adapter there.
- AC4 is INCONCLUSIVE without the pictures in `docs/evidence/1041/` or without a recorded call on exactly them.

## The taste call

The check run takes, from the dungeon's page in a browser, `player-save-controls.png` (the player with its save,
export and import controls, after its save at step 1,800) and `player-save-refused.png` (the notice after a save the
browser refused, under the quota of AC1), puts them in `docs/evidence/1041/` *(names chosen)*, attaches them to the PR
and shows them in the session. The call is recorded in `tests/acceptance/1041/TASTE.json`: `{issue: 1041, criterion:
"#1041.479f46e5", verdict: "looks_right" | "looks_wrong", who, when (ISO 8601), screenshots: {<name>: sha256},
note?}`. This job writes no TASTE.json and makes no picture; no other criterion reads a picture.

## Readings where the issue and design leave a choice

- **"Opened again from the browser's storage"** (AC1): the design opens a save only by the viewer's hand, never at
  start, so the reopened page is clicked on "Open save". Whether a page opens a save by itself isn't asserted.
- **"Fed the same next 600 steps"**: the bundle's recorded track from step 1,800 to 2,400, which both runs play.
- **"The same full-state hashes at each checkpoint as a run that never closed"**: checkpoints 1,800, 1,860 … 2,400 of
  the logic item `dungeon`, against a page that played from the start to the end in another profile; that run is
  first held to the app's replay at every checkpoint, so two wrong runs can't agree.
- **"The full-state hash recorded when it was written"**: `probe().saves`' `deep_hash`, which a save is waited for
  with: the app's full-state hash at that checkpoint. "Opens at" it: the player's checkpoint at the save's step.
- **"A fresh browser profile"**: another browser with a new profile folder, which lists no save before the import.
- **"The origin's storage quota then set below a second save's size"**: 64 bytes for the whole origin, set after the
  save at step 600 is listed; the second save is the one at step 1,200. A player whose saves sit in storage the
  origin's quota doesn't govern fails this leg.
- **"Fails and says so"**: within 30 s of step 1,200 a `save_failed` notice with text, and the slot unchanged.
- **"Two different pieces"** (AC2): two documents with their own IDs; the piece's stable ID is read as the document's
  ID. **"Exported to one origin"**: two folders under one server. **"After both save"**: each one's save at step 600.
- **"Re-exported to another path"**: the same document and track exported again into another folder of that origin.
- **"Keys saves by origin or path alone"**: one planted player. The failure the criterion names, a slot the other
  piece overwrote, is what a key of the origin alone gives, so the twin keys by origin. A key of the path alone is
  the wrong program the re-export test fails on; it gets no twin of its own.
- **"A journey that clears the origin's non-persistent storage"** (AC3): the shim's (above). A real browser's own
  eviction isn't driven.
- **"Says so once across 3 saves"**: one page, the dungeon's three saves each waited for, then one
  `saves_not_persistent` notice 2 s after the third.
- **"The save exported to a file still opens"**: after the journey cleared the storage, by "Import save".
- **"Screenshots of the player's save, export and import controls"** (AC4): one picture showing the three controls,
  and one of the notice.

## Base facts

Observed at the base with `deep-show` (`full`) built in this checkout and Chrome 157, in a scratch check:

- The base's document check presents both pieces with no issue, `saves` and `checkpoint` on the logic item included,
  and `deep_query`'s logic read reports the item's region map for a layout probe shown by an agent's `deep_show`.
- The app's `logic` call replays each piece's 2,400 steps: `dungeon.request` is 1 at steps 599, 1,199 and 1,799 only;
  the burst reaches steps 1,798, 1,799 and 1,800 as 16, 16 and 8 entries; 41 checkpoints, 0 … 2,400; the two pieces'
  full-state hashes differ at every checkpoint read.
- The base's web export admits the dungeon (`exported`); the base player is ready, `backend` `webgpu (wgpu 30.0.1)`,
  `duration` 40, and played from the start it reaches step 2,400 in 40.1 s with the app's full-state hash at all 41
  checkpoints. The base ignores `saves`: `probe()` has no `saves` and the page has no control and no notice
  (observed), and its element's code never touches the browser's storage (read).
- The base player replays the whole recorded track at load and reads each step from that replay
  (`crates/deep-player/src/play.rs`), and its element takes no input from the viewer, so in these tests a save's
  state always lies on the recorded track.

## Not tested, and why

No criterion asks: a slot count above 1 and how a control picks a slot; the slot's save before its newest; ended slots,
carry records and profile records in the browser; a save that fails its hash; a save refused for its layout, content
or module set, or migrated, in the player (#534 proves those in the app); a save under a changed program or another
recorded track; what a seek past an asking step writes; the viewer's own input before a save; the exported file's
format, or opening it in the app; a real browser's own grant or eviction; `<deep-player>` on a host page; the fallback
page; run files.
