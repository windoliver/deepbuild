# Acceptance tests for #1250: clips of a play, the last seconds you played saved on one key as a GIF or MP4, rendered from the input track, with an indexed look's GIF exact to its palette

Written first, blind, from issue #1250 (live, November 20, 2026: its Scope, its Fields, its seven acceptance criteria and
its Proof line; it has no Oracle line, so there is no Oracle lane), the design sections it links and those they lean on,
and the base commit `7a256fd4b` ("Merge pull request #2947"), by a job that never saw an implementation; none existed. No
other worktree, branch, pull request, stash or plan was read. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

Lean: one file per criterion, each test's name carrying its criterion's ID, and exactly the three plants the criteria
name.

## What was read

- The issue (`gh issue view 1250 --repo windoliver/deepbuild`); for scope only, its epic #310, its parent #75, its
  dependencies #501, #157, #464, #522, #531 and #308, and #1110 (the web player's run file, named out of scope).
- `node scripts/design-section.mjs --issue 1250`: `docs/technical-design.md` Control and input track; Device gate,
  capture and export. `docs/canvas-primitives.md` Input track (`save_clip`, `save_still`, `clip.too_large`,
  `clip.desync`); Export (its receipt's `timing.wall`, `video.quality`'s export.fidelity floors, `range`, the png
  target's exact fidelity); Export: encode job (GIF writers take the BGRA8 frame); Look `look@1`: indexed basis (the index
  target, nearest upscale, `see_through: dither`'s 4 × 4 threshold). And what those lean on: Logic `logic@1` and its
  checkpoints; Net: desync and replay (a desync named by its first step, module and field, as #550's suite reads it);
  Check input: export kinds (export.fidelity); Transport: film viewer; Frame budget (five runs, p95); the budgets rule
  and The reference Macs; `docs/parallel-proof.md` section 6.
- At the base, for surfaces only: AGENTS.md; `scripts/proof-change.mjs` (`criterionId`), `scripts/benchmark.mjs`
  (`fingerprint`, `judgeLimit`), `scripts/lanes.mjs`, `scripts/lease`; `crates/deep-show/src/main.rs` (the call list,
  the scenario's keys: `clock`, `state`, `planted`), `input.rs` (`input`'s events, `presented`), `track_call.rs`,
  `time.rs` and `export.rs` (the export call and its `range`, `track`, `size`), `frames.rs` (`frames` with `paced`),
  `placement.rs` (the ask card, which a clip card is not), `film_viewer.rs`, `crates/deep-app/src/actions.json` (the
  app's action keys); `crates/deep-canvas-marks/src/data.rs` (a rect mark set's `encode`) and `print.rs` (the indexed
  basis as a look reads it); `crates/deep-gpu-layer/src/indexed.rs`; the suites `501/`, `157/`, `464/`, `522/`, `531/`,
  `308/`, `550/`, `549/` (its program bytes), `535/` (logic columns), `172/`, `1040/` and `2856/` (READMEs and helpers).

Code was read only to learn the surfaces. Every expected value comes from the issue and the design.

## What the base already does, and these tests don't credit

See `BASE-FAILURE.txt`. At the base `deep-show` has the live panel on the scenario's clock (#383: `input`,
`presented`), the input track per document (#1164's `track`), range exports (#501's `export` with `range`, `track` and
`size`) and the paced `frames` call (#856). A scratch run of existing calls only (not committed) showed the fixtures
well formed there: the indexed game, the tone piece and the sidebar are each presented with no issue; a `control`
input appends an entry of yours with its serial; `logic` steps `game` as the program says (the hero's `game.x` 202,
204, 206 … from step 0 at speed 1); and ⌘⇧C commits a gesture and appends nothing. But the panel presents the game
once (one frame by 2 s: its logic's steps arm no frame), and there is no clip: no `save_clip` or `save_still`, no
`clips` call, no `action` input event, no `indices` on `presented`, no `kept_bytes` on `track`, no indexed basis in
`deep-show`'s frames (it draws only in `deep-gpu`'s `film2d`, #464), no exports folder, and none of the three planted
names. Every test fails at the base and none is a guard.

## Run them

Put Node 24 and the pinned Rust toolchain first on PATH. In a fresh worktree run `npm ci` and `npm run build
--workspaces` once. Then run one file at a time, each under the machine's lease:

```sh
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci && npm run build --workspaces      # once, in a fresh worktree
for f in ac1-gif ac2-delays ac3-mp4 ac4-short-and-desync ac5-sidebar ac6-still ac7-budgets; do
  CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 sh scripts/lease \
    node node_modules/vitest/vitest.mjs run --root tests/acceptance/1250 $f.test.ts --testTimeout=600000 --silent=false
done
node node_modules/typescript/bin/tsc -p tests/acceptance/1250/tsconfig.json   # type check
rm -rf tests/acceptance/1250/node_modules                                       # vitest's cache after a --root run
```

Each file builds `deep-show` (`cargo build --locked --bin deep-show --no-default-features --features full`) once in
`beforeAll` through #501's `useShow`, copied out of the target folder (`CARGO_TARGET_DIR` honoured), so after the first
file the others reuse cargo's build. Every `it` passes its own timeout (3,600,000 ms; AC7 twice that), which
`--testTimeout` doesn't shorten. Temporary folders are removed after each test. No process is started but `cargo`,
`deep-show` and FFmpeg, each waited for; nothing is stopped by name or port. `--silent=false` prints each check's
readings. Imports: Node built-ins, vitest, `../501/helpers.ts` and `../157/helpers.ts` (read only; they import
`../502/` and `../498/decode/`).

`scripts/lanes.mjs` (this job's line, beside its neighbours'):

```js
// #1250's files (blind) each build deep-show (full) and play the fixture games live in it, the clips read back with
// FFmpeg; ac7-budgets.test.ts times the clip and the play's frames on the reference Mac and judges the kept track.
alone.push('tests/acceptance/1250/');
timed.push('tests/acceptance/1250/ac7-budgets.test.ts');
```

## Criteria to tests

IDs are `#1250.` and the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white space collapsed
(`criterionId` in `scripts/proof-change.mjs`), computed from the live issue. Each test's name starts `AC<n> #1250.<h8>`;
each file quotes its criterion in full.

| AC | ID | File (tests) | What it asserts | Plant |
|---|---|---|---|---|
| 1 | `#1250.a789fb24` | `ac1-gif.test.ts` (2) | After 40 s of the scripted play of the indexed game, ⌘⇧C: one card, written, `gif`, `range` [30 s, 40 s), the file alone in the exports folder. This suite's decoder: 512 × 384, global colour table the palette in index order, a NETSCAPE2.0 loop count of 0, 300 frames, delays 3, 3, 4 repeated summing to 1,000, and every frame's every pixel the palette colour of the live index frame on screen at 30 s + j/30 s at target pixel (X ÷ 2, Y ÷ 2). The planted run: the same check fails naming a frame and a pixel, and the live frame there holds all 16 colours | `clip_requantizes_median_cut` |
| 2 | `#1250.fb20b3cc` | `ac2-delays.test.ts` (1) | 12 s of play, ⌘⇧C, under the plant: the GIF holds 600 frames with delays 1 and 2 (the plant is what the criterion says), and AC1's check fails with `frame k: delay d hundredths, under 2`, k the first frame whose delay is under 2 | `clip_gif_every_frame` |
| 3 | `#1250.ba96e86c` | `ac3-mp4.test.ts` (1) | The tone piece (drawing look) plays 13 s, ⌘⇧C: written, `mp4`, `range` [3 s, 13 s); one video and one sound track. A fresh run exports [3 s, 13 s) from the track `track` read, as png_seq at the clip's size: 600 frames, and each of the clip's 600 decoded frames reads at least 40 dB PSNR-Y (BT.709 limited-range luma) against its raw frame. The sound: 48 kHz, 480,000 sample frames a channel, and in each second i of the clip the piece's tone of second 3 + i | none |
| 4 | `#1250.60cb9b00` | `ac4-short-and-desync.test.ts` (2) | ⌘⇧C at 5 s: `range` [0, 5 s), 150 frames, delays summing to 500, every frame the live frame on screen at j/30 s. Under the plant, 20 s and ⌘⇧C: refused, `clip.desync`, no file in the exports folder, `desync` `{first_step, module: "logic", field: "game.x"}` with `first_step` from 0 to 600 (at or before the clip's start), and the card's text holding all three | `logic_reads_wall_clock` |
| 5 | `#1250.d8e39d5f` | `ac5-sidebar.test.ts` (1) | The game on panel `main` with the bright sidebar on panel `side` beside it, 12 s, ⌘⇧C: 512 × 384, 300 frames, and every pixel of every composited frame one of the palette's 16 colours | none |
| 6 | `#1250.5ed3407b` | `ac6-still.test.ts` (1) | 7 s of play, then Save still half a frame later: written, `png`, alone in the exports folder; colour type 3, not interlaced, PLTE's first 16 entries the palette in index order, 512 × 384, every pixel's index the index of the frame presented at 7 s at (X ÷ 2, Y ÷ 2) | none |
| 7 | `#1250.7b1c7063` | `ac7-budgets.test.ts` (1) | On a reference Mac, after a warm-up run, five runs each: the clip's `timing.wall` (limit 3 s), the p95 of the 300 paced frames' `ui_ms` from the key (limit 1000/60 ms), and five runs of the 60-minute track's `kept_bytes` (limit 8 MiB), each judged by `judgeLimit` | none |

Test count: 2 + 1 + 1 + 2 + 1 + 1 + 1 = 9.

## The surface under test

The issue names the player controls `save_clip {seconds = 10 (≤ 60), scale = 2}` and `save_still {scale = 2}`, the key
⌘⇧C, the live play, the input track, #501's range export, the card with its codes `clip.desync` and `clip.too_large`,
the piece's exports folder and the encode job, but no call. As #501's, #549's and #550's suites do, everything in the
app is driven through `deep-show run` (#393: one JSON scenario on stdin, one answer line `{"ok": true, "replies":
[...]}`, one reply per call). **Every call, member, field, file place and planted name below that the issue or the
design doesn't give is this job's choice**, taken from their words and shaped like the neighbouring surfaces; the
implementer builds exactly these, or a dispute goes to a blind redraft. Times in calls are flicks (705,600,000 a
second) unless written as a time literal; seconds in readings.

### The scenario

`helpers.ts`'s `scenario`: your shell's process tree (#501's, peer pid 3002), `panels.main` at `[0, 0, 512, 384]`, the
played document on it, `evidence` (the store), **`state`** (the app's state folder, #105's key), `clock: {refresh_hz:
60, lead: 0, check: 0}` (#383's; each call carries its `at`), and `planted` when a test plants. AC5 adds
`panels.side` at `[512, 0, 256, 384]`, right beside `main`, with the sidebar document on it.

### Calls

| Call | What the tests send | What they read | Whose | At the base |
|---|---|---|---|---|
| `deep show` | #501's `present` from your shell, `at: 0` | `outcome: "presented"` | #393's | exists |
| `input`, a control | `{panel: "main", at, event: {type: "control", control: "move", value}}` | — | #383's and #372's | exists |
| `input`, ⌘⇧C | `{panel: "main", at, event: {type: "key", key: "c", mods: ["cmd", "shift"]}}`: Save clip's default key, its `save_clip` at its defaults | — | the issue's key; the event #383's | the key exists, Save clip doesn't (and `shift` isn't read on a key) |
| `input`, Save still | **`{panel: "main", at, event: {type: "action", action: "save_still"}}`**: the player-control action as the app's Commands run it, since it has no default key | — | this job's | new |
| **`clips`** | `{panel: "main", at}` | `clips: [Clip]` (below), answered once every clip job the panel started has ended | this job's | new |
| `presented` | `{panel: "main", at, **indices: {from}**}` | `frames[]: {vsync, t, …, **indices**}` | #383's; `indices` this job's | exists without `indices` |
| `track` | `{doc, at, load?}` | `track` (entries); **`kept_bytes`** | #1164's; `kept_bytes` this job's | exists without `kept_bytes` |
| `export` | `{doc, at, out, range: [in, out], track, size, video: {codec: "png_seq"}}` | `outcome: "exported"`; the PNG files under `out` | #501's | exists |
| `frames` | `{doc, at, count: 300, from: "720f", step: "1f", paced: true}` | `frames[].ui_ms` | #856's | exists |

- **The live play.** A piece presented in a panel plays live from its presentation on the scenario's clock, each
  vsync a frame and each 1/60 s a step of its logic item, as #549's copies play; the app keeps its input track from its
  start (or its last `track` load) and the checkpoints its logic already keeps. `input` events are entries of yours at
  their `at`.
- **`presented`'s `indices`.** With `indices: {from}`, each frame the live play presented at or after `from` (by `t`,
  the time it shows) carries **`indices`**: the SHA-256, in the evidence store, of its index target as the live play
  drew it, `256 × 192` bytes, one palette index a target pixel, rows top-down. The tests take the frame on screen at a
  time as the last presented frame whose `t` is at or before it.
- **A Clip** (one card, in the order the actions ran): `{action: "save_clip" | "save_still", at (flicks, the action's
  scenario time), outcome: "written" | "refused", format?: "gif" | "mp4" | "png", file?: absolute path, range?: [in,
  out] (flicks: the clip's span), code?: "clip.desync" | "clip.too_large", desync?: {first_step, module, field}, text
  (the card's words), timing?: {wall}}`. `timing.wall` is seconds from the key to the file under its name, as Export's
  receipt's `timing.wall` is from the command to the file. A refused clip has no `file`. The card's Reveal and Copy
  aren't read: no criterion presses them.
- **`kept_bytes`**: every byte the app holds to keep the document's input track (its entries, their values and any
  index), as #522's `ring.bytes` reports the checkpoint ring's.

### Files

The clip and the still are written in **the piece's exports folder, `<state>/exports/<doc ID>/`**, directly in it,
under a name of the implementer's choosing with the format's extension. The tests read the file the card names and
require it to be there alone afterwards: no file left at a temporary name, and nothing at all for a refused clip.

### Planted programs (the scenario's `planted`)

| Name | What it does wrong | Criterion | A failure must name |
|---|---|---|---|
| **`clip_requantizes_median_cut`** | the clip's GIF writer quantizes each frame's colours again through a median cut to the palette's size and writes the cut's colours as its colour table | 1 | a frame and a pixel (`frame j pixel (X, Y)`), on a frame of all 16 colours |
| **`clip_gif_every_frame`** | the clip's GIF writer takes every frame of the 60 fps play, its delays in hundredths with the remainder carried (1s and 2s) | 2 | the first delay under 2 (`frame k: delay d hundredths, under 2`) |
| **`logic_reads_wall_clock`** | the planted piece that reads the wall clock: after every step, in the live play and in a replica alike, the logic module adds the wall clock's nanoseconds modulo 2³⁰ to element 0 of the logic item's first written array (`game.x`) | 4 | `clip.desync` with the first step, `logic` and `game.x` |

Each changes nothing else. At the base each name answers `bad_input`.

## Fixtures

All made at test time (`helpers.ts`), CC0, no outside tool; the look and program bytes go into the evidence store and
are listed in the document's `assets`.

- **The indexed game** (`gameDoc`): a `scene`, 512 × 384 (the target times the look's scale), a 2D orthographic
  `camera@1` over the page, `transport: {span: "60s", frame_rate: [60, 1]}`, the slider `move` (−2 to 2 in steps of 1),
  and the logic item `game` (60 Hz, reads `move`, writes `x`, `x2`, `y`, `y2`, each f64 × 1). Its look is #157's drawing
  look with the 16 palette colours added as roles `p0` … `p15` (its own `ground` kept, which the look guard holds the ink
  to) and `basis: {indexed: {size: [256, 192], scale: 2, palette: [p0 … p15], tables: {}, protected: [], snap:
  "integer"}}` (#464's form): index i is palette[i],
  `#140c1c` … `#f6f0e8`, no two alike. It draws **the dithered gradient**: sixteen full-height bands of 16 target px, band
  i in colour i, and over each boundary an 8 px strip of the next colour at opacity 0.5, which the basis draws as its
  4 × 4 ordered threshold, so every frame holds all 16 colours; and **the hero**, a `marks@1` rect set of one row whose
  box is the four arrays (Mark set: logic columns, #535's form), in colour 15.
- **`game`'s program** (`gameProgram`, WebAssembly bytes written as #549's suite writes them): `init` puts the hero at
  target (100, 80) with speed 1; each step takes the speed from the step's last `move` entry, moves the hero by it
  along x (wrapping in 0 to 239) and one pixel down (wrapping in 0 to 175), and writes its 16 × 16 box in document
  units. So every step changes the frame and every entry changes the later ones.
- **The scripted play** (`scriptedPlay`): a `move` entry of yours every 0.75 s from 0.5 s, values 1, 2, −1, 0, −2 in turn.
- **The tone piece** (`toneDoc`, AC3): the same game and play at 160 × 90 under #157's drawing look (a ground, a muted
  side, the hero in accent), `transport.sample_rate` 48 kHz, and one strip of its sound: stereo, 16 s, second s a tone
  of 300 + 40 s Hz.
- **The sidebar** (`sidebarDoc`, AC5): a 256 × 384 figure of magenta `#ff00ff` and lime `#00ff40`, in no palette of the
  game.
- **The 60-minute track** (`heldTrack`, AC7): a `move` entry of yours at every step for 60 minutes, 216,000 entries, as
  a held key writes them, on the game with a 3,700 s span.

## The GIF check

`helpers.ts`'s `decodeGif` is this suite's own reader (GIF87a and GIF89a, colour tables, graphic control and
application extensions, LZW, interlace) and compositor: each frame as a viewer shows it, disposal and transparency
applied, so a writer may write sub-rectangles. Before it judged anything, two throwaway tests (not committed; their
readings are in `BASE-FAILURE.txt`) held it and `decodeIndexedPng` to FFmpeg's own decode of GIFs (whole frames,
sub-rectangles, transparency, local tables) and palette PNGs FFmpeg wrote, and ran `checkGif` on three GIFs FFmpeg
wrote from index frames made like the game's: mapped exactly to the palette, it named no pixel; through FFmpeg's median
cut (`palettegen`), it named a frame and a pixel; at 60 a second, it named the first delay under 2. `checkGif` names, as separate
failures: the size; the global colour table against the palette (and any local table that isn't it); the loop; the
frame count; the first delay under 2; the first delay off the rule; the sum; and for each frame, at most 20, its first
pixel whose colour isn't the live index frame's palette colour at (X ÷ 2, Y ÷ 2).

## Legs that read BLOCKED or INCONCLUSIVE

None of these is ever a pass.

- AC3 is BLOCKED without FFmpeg (`ffmpeg` and `ffprobe` on PATH, in `/opt/homebrew/bin` or `/usr/local/bin`, or named
  by `DEEP_FFMPEG` and `DEEP_FFPROBE`), #157's helpers' rule.
- AC7 is INCONCLUSIVE at once, with no run made, off a reference Mac or on battery, with Low Power Mode on or a thermal
  state other than nominal (#501's `referenceMacProblem`); on a reference Mac it runs and `judgeLimit` reads each limit,
  INCONCLUSIVE when a run's start or end load is above the core count or the five runs neither all pass nor all fail by
  the margin; BLOCKED when it can't judge five readings.

## Readings where the issue and design leave a choice

- **The clip's span** is `[key − seconds, key)`, half-open as #501's range export is, and never before 0: ⌘⇧C at 40 s
  covers [30 s, 40 s), at 5 s [0, 5 s). GIF frame j is the clip at `in + j/30 s` (the play's 60 halved once to 30), so
  it shows the live frame on screen then, the step `2j` after the clip's first.
- **"Decoded and divided by 2, equals the index frame"** is held on colours: each pixel of the decoded, composited frame
  is the palette colour of the live index at (X ÷ 2, Y ÷ 2), so every 2 × 2 block is one target pixel. With the global
  table equal to the palette in order that is the index too.
- **"The color table is the look's palette in order"**, and the still's palette: the GIF's global table's and the PNG's
  PLTE's first 16 entries are the palette's, in index order; entries a writer pads after them are allowed, since no
  pixel may use one (each pixel is held to the live index). A GIF frame's local table other than the palette fails.
- **"Loops forever"**: a NETSCAPE2.0 (or ANIMEXTS1.0) extension with a loop count of 0.
- **The planted median cut** "changes at least one pixel of a 16-colour frame": the check must name a frame and a pixel,
  and the live frame for that GIF frame must hold 16 distinct indices; every frame does (the gradient).
- **AC2's "fails, naming the first delay under 2"** is this suite's check, AC1's, failing on the planted GIF with a line
  naming the first frame whose delay this suite's decoder reads as under 2, and that delay.
- **"The export guard's comparison (#157)"** is export.fidelity's: frame for frame, in order, each decoded frame's
  BT.709 limited-range luma at PSNR-Y at least the delivery's floor, 40 dB at `standard` (Export: `video.quality`),
  against the raw frame; the raw frames are the png_seq range export's, exact by png's fidelity. The export is at the
  clip's own size, whatever `save_clip.scale` makes it for an MP4.
- **"With the piece's sound"**: one sound track, every sample of the range once (480,000 a channel at 48 kHz), and in
  each second of the clip the piece's tone of that second, by Goertzel power over the second's middle half.
- **The desync** is named as #550's net.desync names one, `{first_step, module, field}`; under a piece that reads the
  wall clock at every step the replica differs from its first replayed step, which is at or before the clip's start
  step (600 for [10 s, 20 s)), since the replica restores the nearest checkpoint at or before it.
- **"Its card naming"**: the card's `desync` and its words (`text`) both name the step, the module and the field.
- **"The frame on screen"** for Save still: the action runs half a frame after 7 s, so it is the frame presented at 7 s.
- **"Its pixels equal the frame on screen"**: each PNG pixel's palette index is the on-screen index at (X ÷ 2, Y ÷ 2),
  at `save_still.scale` 2, and the PNG's palette is the look's, so its colours are the screen's too.
- **"While the play continues at its frame budget"**: the key, then 300 frames (5 s, longer than the 3 s limit) of the
  live play on the wall clock through `frames` with `paced`, while the clip job runs; each run's p95 frame time (`ui_ms`)
  against 1000/60 ms, as Frame budget takes each run's p95. "Within 3 s of the key" is the card's `timing.wall`.
- **"Keeping the track for a 60-minute play"**: a 60-minute track as a held key writes it, an entry every step (the
  densest a play writes), loaded whole, and the app's `kept_bytes` for it; 8 MiB is 8,388,608 bytes.
- **The bright sidebar** is a panel beside the game's: the scenario world has no other chrome to put there.

## Not tested, and why

No criterion asks: `clip.too_large` (a GIF over 32 MiB written as an MP4, the card saying why); `seconds` other than 10
and its cap of 60; `scale` other than 2; rebinding ⌘⇧C; the card's Reveal and Copy; the clip carrying no evidence
weight; and a replica restoring physics checkpoints (the fixture has no physics world). The Proof line's "MP4 beside
its range export" and "timings" are what AC3 and AC7 print.

## Files

- `helpers.ts`: the IDs and planted names, the scenario and calls, the fixtures and the program, the card and live-frame
  readers, the GIF and indexed-PNG readers, the GIF check, Goertzel, and the budget judge.
- `ac1-gif.test.ts` … `ac7-budgets.test.ts`: one file per criterion.
- `BASE-FAILURE.txt`: each file's run at the base.
- `tsconfig.json`: the type check.
