# Acceptance tests for #172: the web player core, a shared piece played live in headless Chrome on WebGPU

Written first, blind, from issue #172 (live, November 15, 2026: its Scope, its Fields, its ten acceptance criteria and
its Proof line), its oracle page and the base commit `f98921218` ("Merge pull request #2636"), by a job that never saw
an implementation; none existed. No other worktree, branch, PR, stash or plan was read, and every repo file was read at
the base commit. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft
of this job (design: Dogfooding). The oracle page's upstream tests for criterion 1 are ported in
`tests/acceptance/172-oracle/`.

**Run only where cheap.** The surface plainly doesn't exist at the base (`video.codec: web` answers `unknown_target`),
so `BASE-FAILURE.txt` says, per test, the assertion it meets first at the base, mostly read from the base's code; it
says which legs were run. The type check passes (`tsc -p tests/acceptance/172/tsconfig.json`, exit 0) and `vitest list`
collects the 20 tests below. The browser driver, the server and the shim adapter were tried once on a hand-written
page in a scratch folder (a stand-in `<deep-player>`; not committed): ready, probe(), a seek, a play to `ended`, the
request log under the shim, the planted-limits judgement, a bad fragment's notice, no cross-origin isolation.

## What was read

- The issue, live (`gh issue view 172 --repo windoliver/deepbuild`), and its oracle page
  (`doneright/oracles/issues/172.md`, branch `doneright` of DeepBuildAI/deepbuild) with the two vendor files it pins.
- `docs/technical-design.md`: Films and figures on the canvas, How it installs, How we know version 0 works
  (Dogfooding, tests written first); `docs/canvas-primitives.md`: Export: playable page, Export: web player (and its
  compressed sound and ladder sections), Seam and backend, Tour, Net: relay and Join, Logic: saves, Check input: logic
  kinds, Logic `logic@1`, World and backend, Input track entries, Capture, Strip and track, Image: video frames,
  Control: device; `docs/parallel-proof.md` (the Spark, remote lanes, the budget window); AGENTS.md.
- At the base, for surfaces only: `crates/deep-show` (`main.rs`'s calls and scenario, `export.rs`'s `unknown_target`,
  `picks.rs`'s `logic` call, `physics.rs`'s `physics_bake`, `frames.rs`'s `eval` with `arrays`, `paths` and `data_hash`,
  `Cargo.toml`'s features); `crates/deep-logic` (`world.rs`'s checkpoints, `piece.rs`, `module.rs`);
  `crates/deep-canvas-physics/src/caps.rs` (`parallel` and `simd8` excluded); `scripts/proof-change.mjs`
  (`criterionId`), `scripts/benchmark.mjs`, `scripts/budget-window.mjs`, `scripts/lease`, `benchmarks/budgets.json`;
  the suites `169/` (the model for this one), `105/`, `501/`, `522/`, `531/`, `532/`, `533/`, `544/`, `1918/`, `2009/`,
  `2010-oracle/`, `2012/`, `2012-oracle/`, `1965-oracle/`, `225-redraft-ac5/`, `499/video/`, `503/`, `538-redraft-ac8/`.

Code was read only to learn the surfaces. Every expected value comes from the issue and the design.

## Run them

Put Node 24 and the pinned Rust toolchain first on PATH; in a fresh worktree run `npm ci` and `npm run build
--workspaces` once; then one file at a time:

```sh
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci && npm run build --workspaces
for f in lab refusals hashes budgets links reproducible probe limits images taste; do
  NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease \
    node node_modules/vitest/vitest.mjs run --root tests/acceptance/172 $f.test.ts --testTimeout=3600000
done
node node_modules/typescript/bin/tsc -p tests/acceptance/172/tsconfig.json   # type check
rm -rf tests/acceptance/172/node_modules                                       # vitest's cache after a --root run
```

Every `it` passes its own 3,600,000 ms timeout. Each file builds `deep-show` (`full`; `refusals.test.ts` also
`full,test-web-lacks`) once in `beforeAll`, as #169's helpers build it; files that read the app's world checkpoints
also build `deep-physics` (#2009's helper), and every file that exports the lab builds `deep-logic` once (#533's
layout probe, whose `check` gives the lab's program its offsets; the program's bytes are written in test code). Temp folders are removed after each test or file; each server runs as a child
process and Chrome in a process group of its own, each stopped by its PID; nothing is stopped by name or port.

`scripts/lanes.mjs` needs these lines (this job writes only its folders; the implementer adds them):

```js
alone.push('tests/acceptance/172/', 'tests/acceptance/172-oracle/');
timed.push('tests/acceptance/172/budgets.test.ts', 'tests/acceptance/172/images.test.ts');
```

## Criteria to tests

IDs are `#172.` and the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white space collapsed
(`criterionId` in `scripts/proof-change.mjs`, computed from the live issue). Each test's name starts `AC<n> #172.<h8>`.

| AC | ID | File (tests) | What it asserts, and the wrong program it fails on |
|---|---|---|---|
| 1 | `#172.36bfe3c1` | `lab.test.ts` (1) | The lab on its 600-step track: the app's record (deep-show's logic replay and world bake, deep-physics's checkpoints, `eval` at 20 seeded steps and 600). The bundle matches its receipt. Played in headless Chrome on WebGPU (`backend` names WebGPU) to `ended`: step 600's world and logic step hashes and evaluated data, and every checkpoint's full-state hash, the world's and the logic item's, are the app's. A fresh page seeked to 600 then to each sampled step in a seeded order: each the app's, and the checkpoints the played run's (seeking equals playing). Only the receipt's files loaded, by hash. Fails on: the base; a bit of drift in physics or logic (names the step and module); a seek that differs from playing |
| 2 | `#172.33b3fb42` | `refusals.test.ts` (2) | With a secret in the app's store and the hub's socket path set, no bundle file holds the secret, its base64 or the path (names the file). Six pieces each refused naming the item, nothing written: status binding `lamp_status` (#169's plate), capture (`wave`, a device control on hands@1), a video strip (`clip`), a video background (`sky`, #503's), a video point set (`depth`, #503's), a canvas module the player lacks (`native`, kind `test.native@1`). Fails on: the base (`unknown_target` names none); a leak into the index page or player |
| 3 | `#172.94f85be4` | `hashes.test.ts` (2) | The bundle as written is ready; a copy with `scorer`'s rewritten program one byte off isn't ready in 30 s, a notice names it (its recorded SHA-256 or path), and play() leaves the clock at 0. No WebAssembly of the bundle defines or imports shared memory (read from its sections); served with no isolation headers the page is ready with `crossOriginIsolated` false and no `SharedArrayBuffer`. Fails on: a player that skips a file's hash; a threaded build |
| 4 | `#172.1e1f958d` | `budgets.test.ts` (3) | A `benchmarks/budgets.json` task naming the criterion, valid against the merge base; the player under 12,000,000 bytes Brotli-11 compressed (any machine); on a reference Mac in a fit state, five runs after a warm-up: first frame under 3,000 ms, ms per frame drawn and per step run over the 600-step play at 1920 × 1080 within 1,000/60, by `judgeLimit`. Elsewhere INCONCLUSIVE |
| 5 | `#172.01200175` | `links.test.ts` (3) | `#stage=descent` once ready reads the stage, 12 s, and probe()'s step, step hashes and evaluated data as a host's `stage = 'descent'` and the app's `eval` at 12 s; `#t=12.5` as a host's `currentTime = 12.5` and the app at 12.5 s. `#t=abc`, `#stage=nowhere`, `#control.year=741`: each at 0 on `opening`, a notice holding the fragment, the plain start's data, `year` still 2000. The planted `web_fragment_writes_entry` fails, naming `year = 741` |
| 6 | `#172.c41df47e` | `reproducible.test.ts` (2) | Two macOS arm64 exports in clean homes (fresh HOME and TMPDIR, other USER, other paths, 1.5 s apart) byte-identical; the planted `web_index_export_time` fails naming `index.html` and a byte offset. Linux aarch64 over ssh (`DEEP_LINUX_AARCH64`, `DEEP_LINUX_AARCH64_DIR`) byte-identical to this Mac's; unset, BLOCKED |
| 7 | `#172.4780d9da` | `probe.test.ts` (2) | Every step 1 … 600 read through probe() after a seek equals the app's step hashes and `eval` data, from a bundle matching its receipt with only its files loaded; a run played to `ended` with no probe() until the end has the same full-state hashes as the run with a call at every step, and the app's. Two clean exports are byte-identical; the planted `web_probe_test_variant` fails the comparison, naming the player file |
| 8 | `#172.d308bc55` | `limits.test.ts` (2) | Under the shim of spec-default limits plus exactly `gpu_needs`' features, the lab plays to 600 with the app's hashes, 20 seeded seeks too, and each logged request equals `gpu_needs`. Under the shim offering maxStorageBufferBindingSize 1,073,741,824 (a default device 134,217,728), the request still equals `gpu_needs`; the planted `web_requests_adapter_limits` asks for 1,073,741,824 and fails, naming maxStorageBufferBindingSize |
| 9 | `#172.811cf803` | `images.test.ts` (2) | The pictures' bundle carries a level of the 2,048 px PNG by hash; ready, each image file decoded once (`decoded`), at least 65; on a reference Mac five loads' first frames under 3,000 ms by `judgeLimit`, else INCONCLUSIVE. A copy with that level one byte off isn't ready and a notice names it |
| 10 | `#172.f6838f04` | `taste.test.ts` (1) | reads the record only (The taste call) |

Test count: 1 + 2 + 2 + 3 + 3 + 2 + 2 + 2 + 2 + 1 = 20.

## The surface under test

`deep-show run` (#393's scenario: one JSON line in, one answer line `{"ok": true, "replies": [...]}` out), built and
driven by #169's helpers, with the scenario's `planted` key for the wrong programs (never an environment variable), its
Cargo features for build sets, the folder the export writes, a server and a browser. No new binary or call. **Every
name marked *(chosen)* is this job's**, taken from the design's words and shaped like the neighbouring surfaces; the
implementer builds exactly these, or a dispute goes to a blind redraft. Times are flicks in calls, seconds in the
player; hashes lower-case hex.

### `export` with `video.codec: web`

`{call: "export", doc, out, video: {codec: "web", web?: {sources?, fallback?}}, track?}`. The issue's `web` options sit
inside `video` *(chosen, as #169's `page`)*; `track` is the recorded input track the bundle carries and the player
plays, as the png_seq export's `track` (#544) *(chosen)*. `out` is the bundle's folder, written whole or not at all.

Outcomes: `"exported"` with `receipt`; `"refused"` naming each item that can't go (the design's `refused: [{item,
why}]`), with nothing written in `out`'s folder.

**The receipt.** The issue's `player: {core_version, module_set_digest, hash}` *(key names chosen)*, `fallback`,
`sources`, `bytes`, `refused`, `gpu_needs: {features: [name], any_of: [[name]], limits: {name → value}}`, and *(chosen,
as #169's)* `files: [{path, sha256}]`, every file the bundle holds by its path under `out` (`/`-separated). A file entry
may say what it is *(chosen)*: a logic item's rewritten program carries `logic: {item: <logic ID>, program: <the
SHA-256 the document names>}`; a reduced image level carries `level: {of: <the source image's SHA-256>}`. `player.hash`
is one of the files' SHA-256.

### The bundle

`index.html` at its root, which holds exactly one `<deep-player>` element *(chosen: the design's element)*; that element
is the player, and its members are the issue's: `play()`, `pause()`, `paused`, `currentTime` (s; setting it seeks),
`duration`, `stage` (setting it steps to that stage), `next()`, `back()`, `ready`, and events `ready`, `timeupdate`,
`stagechange`, `ended`. The page shows each notice as an element marked `data-deep-notice` *(chosen)* whose text holds
what it names (a fragment as written after `#`, a file's SHA-256 or path). The tests serve the folder as written over
HTTP (below) and never change it, except in the twins made in test code.

### probe()

`await document.querySelector('deep-player').probe()` returns a plain object (a promise of one is awaited):

- `step`: the steps run, the state shown; a seek to t s shows step ⌊t × 60⌋ for the 60 Hz pieces here.
- `step_hash: {<world or logic item ID> → 16 hex}` *(shape chosen)*: each world's step hash after `step` steps, as
  deep-show's `physics_bake` `step_hashes[step]`; each logic item's after its `step`-th step, as the `logic` call's
  `steps[step − 1].hash[<ID>]` (absent or null at step 0).
- `checkpoint_hashes: {<world or logic item ID> → [{step, hash}]}` *(shape chosen)*: every checkpoint the run holds,
  with its full-state hash as the app's checkpoints carry it (deep-physics's `deep_hash`; the logic call's
  `checkpoints.<ID>[].deep_hash`).
- `backend` (a string naming WebGPU when it draws there), `adapter` (any non-empty value naming the adapter).
- `values: {<stable ID> → value}` *(IDs chosen)*: each logic array `<logic ID>.<name>` as `eval`'s `arrays` reads it,
  each path a world output or a driver writes (`items/<ID>/at/...`) and each control's `controls/<ID>/value`, as
  `eval`'s `paths` reads it. The tests read `scorer.score` (against the app's `eval` arrays), `items/dot/at/pos/0` and
  `items/dot/at/pos/1` (against the app's `eval` paths), and `controls/year/value` (against the slider's default and
  the player's own plain start: the base's `eval` reads a control's value path as null).
- Beside these *(chosen)*: `frames`, the frames the player has drawn since load; `first_frame_ms`, the time from
  navigation start to its first drawn frame; `decoded: {<image file SHA-256> → times decoded}`.

### The app's side

The app's values come from the base's own surfaces, read as #533's, #522's and #1918's suites read them: deep-show's
`logic` (`{doc, steps, track}`: each step's `hash` per item and `checkpoints.<ID>` with `deep_hash`), `physics_bake`
(`{doc, world, track}`: `step_hashes` and the `inputs` it keeps), `eval` (`arrays`, `paths`), and deep-physics's
`bake` of the same scene and world on the kept entries with `checkpoints: true`, whose step hashes must equal
physics_bake's before its checkpoints' `deep_hash` are used.

### Other surfaces *(chosen)*

| Surface | What | Used by |
|---|---|---|
| scenario `secrets: {name → value}` | the app's store as the scenario holds it | AC2 |
| scenario `hub: {socket: path}` | the hub's socket path | AC2 |
| Cargo feature `test-web-lacks` | the full set plus the test canvas module `test.native` 1.0.0, kind `test.native@1 {box}` drawn as a rect and registered as `test.tick` is, in no player module set and no shipped build | AC2 |
| `DEEP_LINUX_AARCH64`, `DEEP_LINUX_AARCH64_DIR` | the Spark's ssh destination, and a checkout of the tested commit there with cargo | AC6 |

## Planted programs

Chosen by the scenario's `planted` key on `deep-show run`; at the base each name answers `bad_input`.

| Name | What it does wrong | Criterion | A failure must name |
|---|---|---|---|
| `web_fragment_writes_entry` *(chosen)* | the player writes a URL fragment it reads as an input entry (`#control.year=741` sets `year` to 741) | 5 | the entry, `year = 741` |
| `web_index_export_time` *(chosen)* | the exporter writes the export's time into `index.html` | 6 | `index.html` and the first byte offset that differs |
| `web_probe_test_variant` *(chosen)* | the export writes a test variant of the player that alone has probe() | 7 | the player file (the shipped bundle's player path) |
| `web_requests_adapter_limits` *(chosen)* | the player's device request asks for the adapter's own limits | 8 | maxStorageBufferBindingSize (and asks for 1,073,741,824) |

Made in test code: a logic program one byte off its recorded hash (AC3) and an image level one byte off (AC9), each in
a copy of a real bundle. AC2's wrong program is the merge base (and any leak, which names the file).

## Fixtures

All made at test time in `helpers.ts`; no personal data; CC0.

- **The lab** (`labDoc`; AC1–4, 6–8, 10): a 3D scene of 10 s at 60 steps a second. The world `field` (60 Hz, 4
  substeps): a ball of 0.11 m and 0.43 kg on turf before a goal 8 m away, kicked at (6, 3, 0.4) m/s by each entry of
  the press control `kick` (a launch input on the control, #522's form), its pose an output to the scene's `ball`, a
  checkpoint every 60 steps. The logic item `scorer` (60 Hz) reads `kick` and keeps score: each step it adds the
  number of `kick` entries it read to its f64 array `score` (its program assembled against the layout deep-logic
  reports through #533's layout probe; its bytes written in test code). The readout `score_bar`, a bar a driver moves
  0.25 m along x for each hit in `field.occurrences` (#1918's tally; at the base a motion driver can't read a logic
  array in a scene with a world: `ref_unresolved` at `drivers/<id>/vars/<var>`, observed). Its recorded
  track: kicks at steps 30, 150, 270, 390 and 510.
- **The piece with stages** (`stagesDoc`; AC5, 10): a 2D film of 16 s, four stage markers `opening` 0 s, `rising`
  4 s, `summit` 8 s, `descent` 12 s; a dot whose x a driver moves with time and whose y follows the slider `year`
  (1900–2100, default 2000).
- **The pictures** (`picturesDoc`; AC9): a 2D figure with a 2,048 × 2,048 PNG drawn in a 256 px box and 64 distinct
  64 × 64 PNGs drawn 28 px wide.
- **AC2's pieces**: #169's plate with the status binding `lamp_status`; a figure with the device control `wave` on
  hands@1; a film with the strip `clip` of a 60-frame H.264 file (#499's `cfr30`); #503's 360° video background scene
  (`sky`) and depth-points showpiece (`depth`), their layers left out; a figure with an item `native` of
  `test.native@1`. The videos are made by ffmpeg, as #499's and #503's suites make them.

## The server, the browser and the shim adapter

- **The server**: a `node:http` listener in a child process of its own (the test process blocks in `spawnSync` while
  `deep-show` runs, as #105's suite found), serving the bundle folder at `http://127.0.0.1:<port>/`, `index.html` with
  `no-cache`, every other file with a max-age of a year, WebAssembly as `application/wasm`, and no COOP or COEP
  header. It logs each response's status, path and SHA-256; the tests check every file the page loaded is a receipt
  file with the receipt's hash (a browser's own `favicon.ico` request aside).
- **The browser**: Google Chrome at `/Applications/Google Chrome.app` (or `CHROME_BIN`), `--headless=new` with
  `--enable-unsafe-webgpu --ignore-gpu-blocklist` and no `--disable-gpu`, a fresh profile, driven over its DevTools
  protocol by `helpers.ts` alone in flat sessions (no browser-automation library). Pages are 1280 × 720 at device scale
  1 unless a test asks 1920 × 1080. Play is started as a user gesture, so sound can't hold it.
- **The shim adapter** (AC8): test code installed before the page's scripts
  (`Page.addScriptToEvaluateOnNewDocument`). `navigator.gpu.requestAdapter` answers a real adapter behind a proxy whose
  `limits` are a default device's limits (WebGPU's spec defaults, read from a spare adapter, since an adapter makes one
  device) with the test's values laid on, and whose `features` are exactly the ones named. Each `requestDevice`
  descriptor is logged before it is passed on; a request past what the shim offers is refused as an adapter refuses it.
  A request "equals gpu_needs" when its features are `gpu_needs.features` plus at most one of each `any_of` set and
  nothing else, and its limits are `gpu_needs.limits`, any other limit it names at the spec default.

## Legs that read BLOCKED or INCONCLUSIVE

None of these is ever a pass.

- Every browser test is BLOCKED without Google Chrome at the path above, when Chrome opens no DevTools port within
  60 s, or when the page's player isn't ready and Chrome offers no WebGPU adapter there.
- AC2's refusals are BLOCKED without ffmpeg with libx264 (#499's helper's ask: `brew install ffmpeg`).
- AC6's first test is BLOCKED off macOS arm64; its second is BLOCKED without `DEEP_LINUX_AARCH64` and
  `DEEP_LINUX_AARCH64_DIR` (one ask: set them to the Spark's ssh destination and a checkout of the tested commit), when
  ssh can't reach the host without a prompt, or when the checkout there is at another commit.
- AC4's timed test and AC9's first-frame leg are INCONCLUSIVE off a reference Mac (by `scripts/benchmark.mjs`
  `fingerprint`), not on mains power, with Low Power Mode on or the thermal state not nominal, or whenever `judgeLimit`
  reads five runs as neither all within nor all over, or a run's load was above the cores. The criterion stays `Part
  of #172` until the scheduled budget window measures the merged commit against its merge base and closes the issue.
- AC10 is INCONCLUSIVE without the pictures in `docs/evidence/172/` or without a recorded call on exactly them.

## The taste call

The check run takes, from the pages in a browser, `player-lab.png` (the lab playing), `player-stage-descent.png` (the
fourth stage's settled frame opened from `#stage=descent`), `player-bad-fragment.png` (the notice for `#t=abc`) and
`player-lab.webm` (a recording of the lab playing), puts them in `docs/evidence/172/` *(names chosen)*, attaches them to
the PR and shows them in the session. The call is recorded in `tests/acceptance/172/TASTE.json`: `{issue: 172,
criterion: "#172.f6838f04", verdict: "looks_right" | "looks_wrong", who, when (ISO 8601), screenshots: {<name>:
sha256}, note?}`. This job writes no TASTE.json and makes no picture; no other criterion reads a picture.

## Readings where the issue and design leave a choice

- **"The app's on the reference Mac"** (AC1): the app's record made by the same run on the machine the test runs on,
  through the app's own surfaces (The app's side); the comparison is by step hashes, full-state hashes and evaluated
  data, never pixels.
- **"Full-state hashes at each checkpoint"**: every checkpoint the app's run took up to the step read, the world's from
  deep-physics's bake and the logic item's from the logic replay, each equal in the player, with no extra checkpoint.
- **"Evaluated data"** (AC1, AC7, AC8): the logic item's `scorer.score`, read by the app's `eval` with the track.
  At the base `eval` with a `track` replays the logic on it but not the scene's world (observed: the ball and the hit
  bar keep their unkicked values while the world's step hashes change), so the world's outputs are held to the app by
  its step hashes and full-state hashes, which cover every body's pose and velocity.
- **"20 sampled times"**: 20 distinct steps drawn by a generator seeded 172, each read at t = k/60 s.
- **"Seeking equals playing"**: a page seeked to 600 holds the played run's checkpoints, and seeks back and forth hold
  the app's step hashes and data.
- **"Doesn't start, naming it"** (AC3, AC9): `ready` stays false for 30 s, a notice names the file, and play() moves
  no clock.
- **"The input track gains no entry"** (AC5): the player's evaluated `controls/year/value` stays at the default and
  every evaluated value equals the plain start's; the planted player's entry shows there as `year = 741`.
- **"The frame the player shows when it plays to 12.5 s"**: the state a host's `currentTime = 12.5` gives and the
  app's `eval` at 12.5 s (seeking equals playing makes these one).
- **"Each in a clean home"** (AC6): fresh HOME and TMPDIR, another USER and LOGNAME, another evidence store and output
  path, the exports at least 1.5 s apart.
- **"The bundle-hash comparison"** (AC7): every bundle file against its receipt, and the bundle against a clean
  export's, file by file; two clean exports must already be byte-identical.
- **"Each image decoded once"** (AC9): every count in `decoded` is 1, over at least one file per picture.
- **"Under 12 MB compressed without fonts and assets"** (AC4): Brotli at quality 11 of the bundle's WebAssembly and
  JavaScript but logic programs and levels, plus inline scripts, under 12,000,000 bytes.
- **"60 fps at 1080p"**: over a 600-step play in a 1920 × 1080 page, wall ms per frame drawn and per step run each
  within 1,000/60.
- **Capture** (AC2): the camera's input use (Capture: "`use: input`, which feeds only the `hands@1` backend"), as a
  device control on hands@1; **a video strip**: a strip whose source is an H.264 file.
- If the base's document check refuses one of AC2's pieces outright (so it can't be presented), the test fails naming
  it; that is a dispute for a blind redraft, not an edit.

## Not tested, and why

No criterion asks: the fallback and tour pages (#1040), saves (#1041), live sources (`web.sources`), light and fonts
(#1042), embedding, `<deep-player>` on a host page and keys (#1043), progressive view, device loss and the stack ladder
(#1044), accessibility (#1045), compressed sound, the share card, the relay and Join, `#marker=`, `next()` and `back()`,
threads at export, a source that needs a key, the x86_64 export (no target yet), and run files (#1110).
