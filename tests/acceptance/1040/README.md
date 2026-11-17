# Acceptance tests for #1040: the web player's fallback page and tour pages where WebGPU or a needed feature is missing

Written first, blind, from issue #1040 (live, November 16, 2026: its Scope, its Fields and its ten acceptance criteria),
its oracle page and the base commit `80561d40c` ("Merge pull request #2726"), by a job that never saw an
implementation; none existed. No other worktree, branch, PR, stash or plan was read, and every repo file was read at
the base commit. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft
of this job (design: Dogfooding). The oracle page says no upstream test covers any criterion, so there is no oracle
folder.

**Run only where cheap.** `BASE-FAILURE.txt` says, per test, the assertion it meets first at the base, read from the
base's code, with five facts the coordinator observed by running this draft's documents at the base. This job ran: the
type check (`tsc -p tests/acceptance/1040/tsconfig.json`, exit 0), `vitest list` (the 18 tests below), and one scratch
leg (not committed) of the browser driver, the server, the recorder and the shim on hand-written pages: WebGPU switched
off gives a page no adapter and the page that replaces itself is followed; the recorder reads a state, an edge and the
next state; the shim withholds a feature, offers only the ones named, and logs device requests and textures by format,
size and mip count. This Mac's Chrome adapter has clip-distances, texture-compression-bc and texture-compression-astc.

## What was read

- The issue, live (`gh issue view 1040 --repo windoliver/deepbuild`), and its oracle page
  (`doneright/oracles/issues/1040.md`, branch `doneright` of DeepBuildAI/deepbuild).
- `docs/technical-design.md`: Films and figures on the canvas, How we know version 0 works (Dogfooding, Built to be
  hard to get wrong); `docs/canvas-primitives.md`: Export, Export: playable page, Export: web player, Seam and backend,
  Tour, Marker: present mode, Control, Control: kinds as a registry, Input track entries, Logic `logic@1`, Logic: turn
  clock, Logic: checkpoints and bake, Logic: saves, Net: relay and Join, Check input: logic kinds, Check input:
  playtest, Check input: export kinds, Cutaway `cutaway@1`, Material: texture maps; AGENTS.md.
- At the base, for surfaces only: `crates/deep-show/src/export/web.rs` and `page.rs`, `track_call.rs`, `tour.rs`,
  `logic.rs`; `crates/deep-canvas-export/src/page/list.rs` and `write.rs`; `crates/deep-player/web/element.js`;
  `crates/deep-logic` (the read region, `track.rs`, the saved state); `crates/deep-canvas-physics` (derived inputs and
  their `data` expressions); `crates/deep-canvas-input` (press, the tour, the track's hash); `crates/deep-codecs`
  (`maps.rs`); `scripts/proof-change.mjs` (`criterionId`), `scripts/lanes.mjs`; the suites `172/`, `169/`, `501/`,
  `533/`, `1164/`, `423/`, `424/`, `498/decode/`, `157/`.

Code was read only to learn the surfaces. Every expected value comes from the issue and the design.

## Run them

Put Node 24 and the pinned Rust toolchain first on PATH; in a fresh worktree run `npm ci` and `npm run build
--workspaces` once; then one file at a time:

```sh
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci && npm run build --workspaces
for f in quiz pages flips game bundle cutaway maps memory launches taste; do
  NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease \
    node node_modules/vitest/vitest.mjs run --root tests/acceptance/1040 $f.test.ts --testTimeout=3600000 --hookTimeout=180000
done
node node_modules/typescript/bin/tsc -p tests/acceptance/1040/tsconfig.json   # type check
rm -rf tests/acceptance/1040/node_modules                                       # vitest's cache after a --root run
```

Every `it` passes its own 3,600,000 ms timeout; the hook timeout covers closing browsers after a file. Each file builds
`deep-show` (`full`) once in `beforeAll`, as #169's helpers build it; `quiz`, `pages`, `flips`, `game` and `memory` also
build `deep-logic` once (#533's layout probe, which gives each logic program its offsets; the programs' bytes are
written in test code). Temp folders are removed after each test; each server runs as a child process and Chrome in a
process group of its own, each stopped by its PID; nothing is stopped by name or port.

`scripts/lanes.mjs` needs these lines (this job writes only its folder; the implementer adds them):

```js
// #1040's files each build deep-show (full) and export through the GPU; five also build deep-logic, and six drive
// headless Chrome with WebGPU switched off, or on under a test shim over its adapter.
alone.push('tests/acceptance/1040/');
```

No file is timed. `quiz.test.ts` (27 reloads and 81 clicks, each playing an edge) and `maps.test.ts` (four 2,048 px
maps, five browser sessions) will likely belong on the `slow` list once their fastest runs are recorded.

## Criteria to tests

IDs are `#1040.` and the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white space collapsed
(`criterionId` in `scripts/proof-change.mjs`, computed from the live issue). Each test's name starts `AC<n> #1040.<h8>`.

| AC | ID | File (tests) | What it asserts, and the wrong program it fails on |
|---|---|---|---|
| 1 | `#1040.62c32a87` | `quiz.test.ts` (1) | The quiz's web receipt reads `fallback: page`; the bundle matches its receipt; the receipt marks the fallback page, whose files are all there by hash and whose manifest holds the 27 end states. With WebGPU off the index page opens it in its start state and never starts the player; each of the 27 answer paths, clicked through its targets, plays an edge per click and lands where the manifest says, every state is reached, and nothing outside the bundle is asked for. Fails on: the base |
| 2 | `#1040.082d5019` | `flips.test.ts` (3) | The flip counter's receipt reads `tour_only`; its tour page is a chain of 6 states and 5 edges on `lever` (on, off, on, off, on), each with a clip, each still the app's after that many flips; with WebGPU off the page plays the six states in order with an edge between each two and the player never starts. With WebGPU on, a seek past each of 100 scripted flips reads count 0 … 100 and, played to the end, every checkpoint's full-state hash of `tally` is the app's. As a page alone it is refused past 64 states, naming `tally` (shared with AC7). Fails on: the base |
| 3 | `#1040.d2344cb1` | `bundle.test.ts` (2) | The lab's bundle against its receipt; every bundle file its index page names; the texture by hash; a file whose SHA-256 is the app's track hash; the fallback page's files by hash; each clip decoded from the bundle exactly and within export.fidelity's floor of the app's frames. The planted `web_leaves_out_font` fails naming a font and leaves nothing. A copy with the texture removed never reports ready or plays, a notice names the texture, and probe() never reports the poster drawn in full |
| 4 | `#1040.d641d88e` | `game.test.ts` (1) | The game's receipt reads `tour_only`; its tour page is a chain of 4 states on `tap`; with WebGPU off the page plays them in order and the player never starts; with WebGPU on the player runs it live, its logic step hash at the end the app's. Fails on: the base |
| 5 | `#1040.3d1179a9` | `cutaway.test.ts` (2) | The lab's `gpu_needs.features` holds `clip-distances`; with it withheld by the shim the index page opens the fallback page and never starts the player; with it granted the player runs the lab live, the world's step hash at the end the app's, each device request equal to gpu_needs. The planted `web_index_checks_webgpu_only` fails, naming `clip-distances` |
| 6 | `#1040.a023b5eb` | `maps.test.ts` (3) | The 2,048 px piece's `any_of` holds the two features as one entry; both granted: three BC7 and one BC5 map textures, live; only ASTC: four ASTC 4×4, live; neither: the fallback page, the player never started. The 1,024 px piece names neither and, both withheld, plays with four RGBA8 map textures. The planted `web_index_requires_every_any_of` fails, naming `texture-compression-bc` |
| 7 | `#1040.6bb03885` | `pages.test.ts` (1), `flips.test.ts` (1, shared) | The quiz as a page: 27 end states, one per path; the app shows four scores over the 27 paths; each end still is the app's at the end of its path (fails on two stills swapped, naming the path). The flip counter as a page: refused past 64 states, naming `tally` |
| 8 | `#1040.fc164908` | `memory.test.ts` (2) | In the app the two paths end on equal step hashes and different full-state hashes, alike in picture; the page keeps them as two states with equal controls whose reveals differ, the four stills the app's. The planted `page_keys_logic_by_step_hash` fails, naming `mem` |
| 9 | `#1040.055bc0b1` | `launches.test.ts` (2) | In the app the two launches draw alike at `look` and apart at `after`; the page keeps them as two states with one picture whose successors' stills differ, each the app's. The planted `page_keys_by_picture_and_logic` fails, naming `drop_world` |
| 10 | `#1040.67ee1fab` | `taste.test.ts` (1) | reads the record only (The taste call) |

Test count: 1 + 3 + 2 + 1 + 2 + 3 + 1 + 2 + 2 + 1 = 18 (the shared refusal counted once, under AC2).

## The surface under test

`deep-show run` (#393's scenario), built and driven as #169's and #172's suites drive it, with the scenario's
`planted` key for the wrong programs (never an environment variable); the folders the exports write; a server and a
browser. No new binary or call. **Every name marked *(chosen)* is this job's**, taken from the design's words and
shaped like the neighbouring surfaces; the implementer builds exactly these, or a dispute goes to a blind redraft.

### The web export and its receipt

`{call: "export", doc, out, video: {codec: "web"}, track?}` (#172's). The receipt as #172 reads it, with the issue's
`fallback: "page" | "tour_only"` and `gpu_needs: {features, any_of, limits}` now computed from the document.

### The fallback page in the bundle *(chosen)*

- The receipt's `files` entry of the fallback page's index page carries `fallback: "index"`, and that of its manifest
  `fallback: "manifest"`, exactly one of each. Nothing here fixes their paths: the design stores every bundle file but
  the index page under its SHA-256.
- The manifest is #169's (`{start, states: [{id, controls, marker, still}], edges: [{from, to, control, value}]}`), and
  the tests also read what the base's page writes beside it: an edge's `clip` and `span`, a state's `t` and `track`
  (AC3's clips) and `loop`.
- Every path the manifest or the fallback's index page names (a still, a clip, a `src` or `href`) is relative to the
  folder its index page sits in, and is a receipt file.
- **A tour page** is that same form: its states are the ones one pass of the tour reaches, the start first, each joined
  to the next by one edge carrying the control and value the tour's key sets and its clip. Once shown, it plays its
  tour by itself (Tour: where no one gives input, the tour plays), and the test only watches.
- The page's DOM marks are #169's: `<html data-deep-state>`, `data-deep-edge`, `[data-deep-target="<control>/<option>"]`.

### How a test sees what the index page did *(chosen)*

- **It opened the fallback page:** within 60 s the tab's top-level document is the file the receipt marks
  `fallback: "index"` (the URL's path is that file's bundle path), and the first state it shows is its manifest's start.
- **The player is never started:** no response serves the player's file (the receipt's `player.hash`), the shim logs no
  device request, and no `<deep-player>` reports `ready`.
- **Which map format the player chose:** the formats of the WebGPU textures its device creates, logged by the test's
  first script over `GPUDevice.prototype.createTexture` (format, size, mip count). A map's texture is one made at the
  map's width and height with more than one mip level; layers are counted; families are read by WebGPU's own names
  (`bc7-…`, `bc5-…`, `astc-4x4-…`, `rgba8unorm…`).

### probe() *(one member chosen)*

#172's `step`, `step_hash`, `checkpoint_hashes`, `backend`, `values` (`<logic ID>.<name>` for a logic array). AC3 adds
`drawn: {<item ID> → "full" | "proxy"}` *(chosen)*: the items the last drawn frame drew and how. It may be read before
`ready`; a probe() that answers nothing before `ready` drew no frame.

### The app's side

All from the base's own surfaces: a png_seq still or range export on an input track with its receipt's `frame_hashes`
(#501, #544, as #169's suite takes a state's still); deep-show's `logic` call (`steps[k].hash.<item>`,
`checkpoints.<item>[].deep_hash`, as #172's); `physics_bake`'s `step_hashes`; the `track` call with `load` and its
`hash` (#1164's); the decode worker's `media_decode` (#498's). Page stills are compared as BLAKE3 of their decoded
BGRA8, the raw frame hash; the live player by hashes and evaluated data; nothing by pixels but AC3's fidelity floor.

## Planted programs

Chosen by the scenario's `planted` key on `deep-show run`; at the base each name answers `bad_input`.

| Name | What it does wrong | Criterion | A failure must name |
|---|---|---|---|
| `web_leaves_out_font` *(chosen)* | the web export writes its bundle without one of its fonts | 3 | that font's bundle path or SHA-256; nothing is left in `out`'s folder |
| `web_index_checks_webgpu_only` *(chosen)* | the index page starts the player wherever the browser has WebGPU, never reading the adapter against gpu_needs | 5 | `clip-distances` |
| `web_index_requires_every_any_of` *(chosen)* | the index page requires every feature of each `any_of` set | 6 | `texture-compression-bc` |
| `page_keys_logic_by_step_hash` *(chosen)* | the page export keys a logic item by its step hash alone | 8 | the logic item, `mem` |
| `page_keys_by_picture_and_logic` *(chosen)* | the page export keys a state by its picture (its still's raw frame hash) and the logic module's carried state alone, leaving out its controls and every other carried state | 9 | the world, `drop_world` |

Made in test code: a copy of the lab's bundle with its texture's file removed (AC3), and two end stills swapped (AC7).

## Fixtures

All made at test time in `helpers.ts`; no personal data; CC0. Control and item IDs are lower-case.

- **The quiz** (`quizDoc`; AC1, 7, 10): #169's quiz, 320 × 180 at 10 fps, three stage markers waiting for the choices
  `q1`, `q2`, `q3` (a, b, c; right b, c, a) and `end`. Each option is a mark and a target, shown only while its question
  is; the logic item `scorer` keeps the score in `score`, which a driver hands the counter. 40 states, 27 at `end`.
- **The flip counter** (`flipsDoc`; AC2, 7): a toggle `lever` whose lamp fades over 0.5 s, the logic item `tally`
  counting its entries, a bar the count moves; a tour of five flips, once, no pointer. Scripted track: 100 flips, one
  every 6 steps.
- **The game** (`gameDoc`; AC4, 10): a press `tap`, the logic item `rules` counting taps in `score`, a runner and a win
  lamp; a tour of three taps; a recorded track of four.
- **The lab** (`labDoc`; AC3, 5): a world `field` whose puck (a block, so it slides to rest) the press `kick`
  launches; a goal cut by `cut` (cutaway@1, class document); a poster slab whose material's base color map is a PNG;
  a 3D label; a tour of two kicks and a recorded track of two.
- **The maps** (`mapsDoc`; AC6): a slab under four UASTC KTX2 maps with full mip chains (#423's writer): base color and
  emission sRGB, metallic-roughness and normal linear; at 2,048 px and at 1,024 px.
- **The memory piece** (`memoryDoc`; AC8): presses `btn_a`, `btn_b`, `reveal`; the logic item `mem` sets a flag at byte
  8,192 of its memory on an entry of A (1) or B (2) while it is still 0, writing nothing, and writes it to `shown` on
  an entry of reveal; two marks show 1 or 2. The first button pressed keeps the flag, so at most 34 states are
  reached: 2 before any press, and 8 control values × 2 readouts for each flag.
- **The chimney** (`dropDoc`; AC9): a ball inside an opaque box, thrown up at 1 m/s (soft) or 11 m/s (hard) by the
  waited choice `pick`; stages `aim` (0.1 s), `look` (0.45 s, waits for `go`), `after` (1 s). Every surface is unlit,
  and the ball draws only from `after` on (an opacity channel held at 0 until 1 s).

## The server, the browser and the shim adapter

- **The server**: #172's, a `node:http` child process serving the bundle with no isolation headers and logging each
  response's status, path and SHA-256; MP4 as `video/mp4`; `/.canary` answers a blank page, unlogged.
- **The browser**: Google Chrome (`CHROME_BIN` or `/Applications/Google Chrome.app`), `--headless=new`, driven over its
  DevTools protocol by `helpers.ts` alone. WebGPU on is #172's switches. **WebGPU switched off** is Chrome's own switch
  for its WebGPU service (`--disable-features=WebGPUService`), proven before each test page on `/.canary`, a page of the
  bundle's own origin: `navigator.gpu` is absent or gives no adapter. (On this Chrome the object stays and the adapter
  is null; a blank page proves nothing, since it is no secure context.)
- **The first script** of every page records each change of `<html>`'s `data-deep-state` and `data-deep-edge` as its
  mutation record, and every texture a device creates.
- **The shim adapter**: #172's: the real adapter behind a proxy whose features are exactly those the test names and
  whose limits are WebGPU's spec defaults; each device request is logged, and one past the shim is refused. "Withheld"
  is a feature left out of that list.

## Legs that read BLOCKED or INCONCLUSIVE

None of these is ever a pass.

- Every browser leg is BLOCKED without Google Chrome at the path above, or when it opens no DevTools port in 180 s.
- WebGPU-off legs (AC1, 2, 4) are BLOCKED when the canary still gets an adapter.
- WebGPU-on legs are BLOCKED when Chrome gives no adapter, and AC5's and AC6's when its real adapter lacks a feature
  the shim must grant (`clip-distances`, `texture-compression-bc`, `texture-compression-astc`).
- AC5's and AC6's browser legs are BLOCKED off a reference Mac (Mac15,7, Mac15,12, Mac17,10), which the criteria name.
- AC10 is INCONCLUSIVE without the screenshots in `docs/evidence/1040/` or a recorded call on exactly them.

## The taste call

The check run takes, from the pages in a browser with WebGPU off, `fallback-quiz.png` (the quiz's full playable page)
and `fallback-game-tour.png` (the game's tour page), puts them in `docs/evidence/1040/` *(names chosen)*, attaches them
to the PR and shows them in the session. The call is recorded in `tests/acceptance/1040/TASTE.json`: `{issue: 1040,
criterion: "#1040.67ee1fab", verdict: "looks_right" | "looks_wrong", who, when (ISO 8601), screenshots: {<name>:
sha256}, note?}`. This job writes no TASTE.json and takes no picture; no other criterion reads a picture.

## Readings where the issue and design leave a choice

- **Criterion 4's last sentence** ("playtest.not_live, is #1046's and runs on this page"). #1046 is open, blocked by
  this issue, and nothing named playtest.not_live exists at the base. The sentence gives the check to #1046, so this
  suite doesn't run it and adds no leg that waits for it. It asserts what that check will read and run on: the receipt
  marks the page `tour_only` (the design: "the receipt's `tour_only` marks the first"), and the page shown is the tour
  page with the player never started. #1046's own suite proves the check fails this page.
- **"Reaches every state as #169's own test does"** (AC1): by the page's targets, an edge per click, landing where the
  manifest says, every state reached, nothing asked outside the bundle. The quiz is a tree, so each path starts from a
  reload of the fallback page. An option hidden by its opacity channel is no target: the page shows three per question.
- **A choice in a logic item's read region** (AC1, 7): its option's index, as the slot's f64 value (Control: "a choice
  reads as the index of its option"; Logic: a number's f64). At the base a choice's entries never reach a slot.
- **A toggle's entries** (AC2) are booleans on the track, and a logic item that reads the toggle counts them.
- **Momentary buttons** (AC8): press controls. The page lists a press and its release; the test follows edges by control,
  not value: A's edge from the start, then A's edge again until the controls are the start's (a page that lands a press
  and release in one edge is read the same). In the app's tracks a press is the value 1 and a release 0; `mem` acts on
  any entry, so the value's form doesn't change a picture.
- **A page's logic key** (AC8): the logic item's full state. Under a key that also counts the clock, a piece with
  buttons a marker doesn't wait for has no bound; this fixture holds at most 34 states by controls and state.
- **The two launches** (AC9) are one waited choice, read in the launch's `data` expression as its option's index
  (Control), so that the page's states stay few; their controls differ, and the planted page leaves controls out. The
  base may already keep the two states apart (it keys by the core's carried-state list); the planted page is then
  this criterion's only wrong program (`BASE-FAILURE.txt`).
- **The app's still after k flips** (AC2): a png_seq still at 4 s on a track of k flips; for k = 0 at 0 s, since an
  export with no entry on its track plays the piece's own tour (#903).
- **"The same picture"** (AC9): the two states' stills decode to one raw frame hash, the app's at `look`.
  **"Next frames differ"**: their successors by `go`, at `after`, decode apart.
- **"An input track whose hash equals the app's"** (AC3): the recorded entries loaded whole into the hub give the
  app's hash (`track`); a bundle file's SHA-256 equals it, so the bundle keeps the track in the app's own form.
- **"Passes export.fidelity"** (AC3): decoded from the bundle's bytes by the app's decode worker, a clip holds its
  span's frames at the piece's rate and, with sound, its span's sample frames at 48 kHz, and each frame's BT.709 luma
  is within 35 dB PSNR (the `standard` floor) of the app's own png_seq frame of that play (the manifest's track of the
  state the edge lands in, from the clock of the state it leaves).
- **"Naming the font"** (AC3): its bundle path or SHA-256; a bundle font is a file with a font extension.
- **"Its proxy while files arrive"** (AC3): probe()'s `drawn` never reads the poster `full`.
- **"Runs it live"**: ready, `backend` WebGPU, played to `ended`, each device request equal to gpu_needs, and where the
  piece has logic or a world, its step hash at the last step the app's.
- **"On the reference Mac"** (AC5, 6): a functional leg, so only the model is asked, not power or thermal state.

## Not tested, and why

No criterion asks: a limit (not a feature) the adapter lacks, a piece with no tour (only the first state), saves,
the relay and Join, fonts subset to their glyphs, `<deep-player src>` on a host page, device loss, the tour's pointer,
the share card, a fallback page opened from disk, and playtest.not_live itself (#1046).
