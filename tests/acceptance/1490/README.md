# Acceptance tests for #1490: a small piece pays for a small player, prebuilt player sets or a number that says it isn't worth it

Written first, blind, from issue #1490 (live, November 16, 2026: its Scope, its five acceptance criteria, its Proof
line, Not in scope and Depends on), its parent #172 and its epic #310, the design and the base commit `80561d40c`
("Merge pull request #2726"), by a job that never saw an implementation; none existed. No other worktree, branch, PR,
stash or plan was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind
redraft of this job (design: Dogfooding).

**Run only where cheap.** At the base the web player is one build: `crates/deep-player/web/dist/` holds one
`player_bg.wasm`, its glue and `player.json`, the export embeds those bytes for every piece, and its receipt's `player`
names no set. `BASE-FAILURE.txt` says, per test, the assertion it meets first at the base: AC1's was run (it builds
nothing); the others are read from the base's code, since each needs a build of `deep-show` and the machine was loaded
(one-minute load average about 900). The type check passes (`tsc -p tests/acceptance/1490/tsconfig.json`, exit 0) and
`vitest list` collects the 5 tests below.

## What was read

- The issue, live (`gh issue view 1490 --repo windoliver/deepbuild`), its parent #172 and its epic #310.
- `AGENTS.md`; `docs/technical-design.md`: Films and figures on the canvas, How we know version 0 works (Criteria to
  tests, Wrong programs, Dogfooding); `docs/canvas-primitives.md`: Export: web player (with its compressed sound and
  ladder sections), Export: playable page, Canvas module, Canvas module: interface and implementation, Registry and seal
  (with its runtime digest and registries), Seam and backend, Document envelope (`requires`), Check input, Check input:
  export kinds.
- At the base, for surfaces only: `crates/deep-show/src/export/web.rs` (the bundle, the receipt's `player`, the
  refusals, the embedded player), `crates/deep-show/src/export.rs` (#172's planted names), `crates/deep-show/src/main.rs`
  (an unknown `planted` name answers `bad_input`), `crates/deep-player` (`seal.rs`'s module list, `page.rs`'s `probe()`
  and `about()`, `play.rs`'s step and probe), `crates/deep-player/web/dist/player.json`, `scripts/player-wasm.mjs`,
  `crates/deep-canvas/src/registry/mod.rs` (build sets, `module_of_kind`), `crates/deep-canvas/src/document/check.rs`
  and `check/check_assemblies.rs` (`requires.modules`, control kinds as the input module's), `scripts/proof-change.mjs`
  (`criterionId`), `scripts/lanes.mjs`, `scripts/lease`; the suites `172/` (the model for this one), `169/` and `533/`
  (helpers only).

Code was read only to learn the surfaces. Every expected value comes from the issue and the design.

## Run them

Put Node 24 and the pinned Rust toolchain first on PATH; in a fresh worktree run `npm ci` and `npm run build
--workspaces` once; then one file at a time:

```sh
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci && npm run build --workspaces
for f in record picks smallest parity reproducible; do
  NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease \
    node node_modules/vitest/vitest.mjs run --root tests/acceptance/1490 $f.test.ts --testTimeout=3600000 --hookTimeout=180000
done
node node_modules/typescript/bin/tsc -p tests/acceptance/1490/tsconfig.json   # type check
rm -rf tests/acceptance/1490/node_modules                                       # vitest's cache after a --root run
```

`record.test.ts` builds nothing: it reads the checkout and compresses each set's player (a few minutes of Brotli 11).
Every other file builds `deep-show` (`full`) once in `beforeAll`, as #169's and #172's helpers build it (its own
3,600,000 ms hook timeout); `picks.test.ts` and `smallest.test.ts` export the physics lab, whose logic program #533's
layout probe lays out (a `deep-logic` build, once per file). Temp folders are removed after each test; the server runs
as a child process and Chrome in a process group of its own, each stopped by its PID; nothing is stopped by name or
port.

`scripts/lanes.mjs` needs these lines (this job writes only its folder; the implementer adds them):

```js
// #1490's files build deep-show (full), export the physics lab and a 2D piece to the web, and drive headless Chrome with WebGPU on.
alone.push('tests/acceptance/1490/');
```

## Criteria to tests

IDs are `#1490.` and the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white space collapsed
(`criterionId` in `scripts/proof-change.mjs`, computed from the live issue). Each test's name starts `AC<n> #1490.<h8>`.

| AC | ID | File (tests) | What it asserts, and the wrong program it fails on |
|---|---|---|---|
| 1 | `#1490.4cd26262` | `record.test.ts` (1) | The size record says its sizes are `brotli-11` and lists `figure` and `full`; every set's player and glue are the checkout's files by the record's SHA-256; each set's recorded size is within 1% of Brotli 11 of those two files measured here; `figure` holds fewer modules than `full` and none `full` lacks; no two sets ship one player. A copy of the record halving `figure`'s size fails, naming `figure`. Measured here, `figure` ≤ 0.75 × `full`, else it fails printing both sizes and the share. Fails on: the base (no record); a guessed or stale size, or a file that isn't committed (names the set); a saving under a quarter (names the number) |
| 2 | `#1490.db64c0a5` | `picks.test.ts` (1) | The 2D slider fixture exported plainly: its receipt's `player.module_set` is `figure`, its `module_set_digest` and `hash` are `figure`'s in the record, the bundle holds `figure`'s player and glue by hash and no other set's player. The physics lab on its track: the same for `full`. The planted `web_picks_full_set` bundles `full` for the slider fixture and the same check fails, naming `figure`. Fails on: the base (no set named; one player); a picker that always takes `full` |
| 3 | `#1490.22b977d9` | `smallest.test.ts` (1) | The physics lab on its track under the planted `web_picks_smallest_set`: refused, nothing written, with an entry of code `module_missing` that names a module the lab uses (`scene3d`, `physics`, `logic`) which the record's smallest set lacks; the shipped picker exports the same lab. Fails on: the base (`bad_input`: no such picker); a wrong set that gets past the refusal, or a refusal that names no module |
| 4 | `#1490.90194dfc` | `parity.test.ts` (1) | The 2D slider fixture on its track, in `figure` (plain export) and in `full` (under `web_picks_full_set`), two players; each played in headless Chrome on WebGPU from its receipt's files to `ended`, then seeked to 22 sampled steps: probe()'s step, step hashes, checkpoints' full-state hashes and evaluated data equal value by value at the end and at every sampled step. Not vacuous: each probe holds the dot's x and y and the slider's value, the slider reads 2000 at the start and 2050 at the end in both, and the comparison pairing each step with the next fails, naming `items/dot/at/pos/0`. Fails on: the base (no `figure`); a `figure` player that evaluates or plays the track otherwise (names the step and value) |
| 5 | `#1490.ea61d337` | `reproducible.test.ts` (1) | Two exports of the 2D slider fixture on its track, each in a clean home with its own store and bundle path, 1.5 s apart: both name `figure`, byte-identical (paths sorted). #172's planted `web_index_export_time` fails the comparison, naming `index.html` and a byte offset. Fails on: the base (no `figure`); anything that brings a time, path, user, host or file order into a `figure` bundle |

Test count: 5.

## The surface under test

`deep-show run` (#393's scenario: one JSON line in, one answer line `{"ok": true, "replies": [...]}` out), built and
driven by #169's and #172's helpers, with the scenario's `planted` key for the wrong programs (never an environment
variable); #172's web export, its receipt and the folder it writes; the bundle served and played in headless Chrome
through `probe()` (#172's server, browser and probe shape, unchanged); and one committed file, the size record. **Every
name marked *(chosen)* is this job's**, taken from the design's words and shaped like the neighbouring surfaces; the
implementer builds exactly these, or a dispute goes to a blind redraft.

### The module sets

The issue's sets `figure` and `full` by those names. Any other set the release ships (the issue's example `game2d`)
is checked as the size record lists it, and no test needs it. Which modules each holds is the implementer's, within
what the criteria require: the 2D slider fixture fits `figure`, and the physics lab fits no set smaller than `full`.

### The size record *(chosen)*

`crates/deep-player/web/dist/sets.json`, committed beside the sets' bytes (where `scripts/player-wasm.mjs` writes the
player and `player.json` today):

```json
{
  "compression": "brotli-11",
  "sets": {
    "<set name>": {
      "modules": ["<canvas module>", "..."],
      "module_set_digest": "<64 hex: the set's sealed module-set digest>",
      "wasm": {"path": "<checkout-relative path of the set's player>", "sha256": "<64 hex>"},
      "glue": {"path": "<checkout-relative path of its page glue>", "sha256": "<64 hex>"},
      "compressed": 0
    }
  }
}
```

- A set's player is its WebAssembly module, the file a bundle of that set names as `player.hash`; its glue is the
  JavaScript the build writes beside it, which the bundle carries too. The element script the bundle shares across
  sets, the fonts, the document and its assets aren't counted (the design's "without fonts and assets").
- `compressed` is in bytes: Brotli at quality 11 of the player and of the glue, each compressed alone, summed; as the
  tests compute it, Node's `zlib.brotliCompressSync` with `BROTLI_PARAM_QUALITY` 11, `BROTLI_PARAM_SIZE_HINT` the
  input's length and Node's default window (as #172's budgets compress the player). A recorded size must stand within
  1% of the tests' own measure of the same bytes.
- Paths are relative to the checkout, inside it.

### `export` with `video.codec: web` (#172's call), and the set its receipt names

`{call: "export", doc, out, video: {codec: "web"}, track?}`, unchanged. The export picks the set; the tests pass no
set. The receipt's `player` gains `module_set: <set name>` *(chosen)* beside #172's `core_version`,
`module_set_digest` and `hash`, which are that set's digest and its player's SHA-256 as the record gives them. A
refusal keeps #172's shape: `outcome: "refused"`, nothing written, each item it can't carry an entry `{item, code,
why}`; a module the bundled set lacks is code `module_missing`, and the entry names the module.

### probe()

#172's member and shape, read by #172's helpers: `step`, `step_hash` and `checkpoint_hashes` by world or logic item
ID, and `values` by stable ID (each path a driver writes, `items/<ID>/at/...`, and each control's
`controls/<ID>/value`). The tests read the 2D slider fixture's `items/dot/at/pos/0`, `items/dot/at/pos/1` and
`controls/year/value`.

## Planted programs

Chosen by the scenario's `planted` key on `deep-show run`; at the base each new name answers `bad_input`.

| Name | What it does wrong | Criterion | A failure must name |
|---|---|---|---|
| `web_picks_smallest_set` *(chosen)* | the export's set picker always takes the size record's smallest set (the fewest modules, then the fewest compressed bytes), whatever the document uses | 3 | the module the set lacks |
| `web_picks_full_set` *(chosen)* | the export's set picker always takes `full`, as the merge base's one player was | 2 (its wrong program); 4 (the piece in `full`) | `figure` |
| `web_index_export_time` (#172's) | the exporter writes the export's time into the index page | 5 | `index.html` and the first differing byte |

Made in test code: a copy of the size record with `figure`'s size halved (AC1), and the comparison of AC4 run on
pairs of neighbouring steps (AC4).

## Fixtures

All #172's, made at test time by its helpers; no personal data; CC0.

- **The 2D slider fixture** (#172's `stagesDoc`; AC2, AC4, AC5): a 2D film of 16 s, 320 × 180: a camera, three
  rects, four stage markers, the slider `year` (1900 to 2100, default 2000, a document control), and two drivers: the
  dot's x is `10 + 18 t`, its y `20 + 0.4 (year − 1900)`. No world, no logic item, no 3D. Its recorded track here:
  `year` set to 1950 at step 180 (3 s) and to 2050 at step 540 (9 s) (AC4, AC5; AC2 exports it with no track).
- **The physics lab** (#172's `labDoc` on `labTrack`; AC2, AC3): a 3D scene of 10 s with the world `field` (a ball
  kicked at a goal), the logic item `scorer` that keeps score, and the readout `score_bar`; kicks at steps 30, 150,
  270, 390 and 510. Its program's bytes are written in test code against #533's layout probe.

## Legs that read BLOCKED

Never a pass. AC4 is BLOCKED without Google Chrome at `/Applications/Google Chrome.app` (or `CHROME_BIN`), when Chrome
opens no DevTools port within 60 s, or when a page's player isn't ready and Chrome offers no WebGPU adapter there
(#172's helpers). No leg here is timed, so none reads INCONCLUSIVE.

## Readings where the issue and design leave a choice

- **"A record gives each set's compressed size"**: the committed record above, each size checked against the
  committed bytes it names, so a record can't hold a guess or a size from another build.
- **"If `figure` isn't at least 25% under `full`, the issue closes with that number"**: measured here, `figure` ≤ 0.75
  × `full` passes (exactly 25% counts). Short of it the test fails, printing both sizes and the share: that is the
  number the issue closes with, the sets aren't worth their builds, and criteria 2 to 5 don't apply. So no change that
  ships sets with a smaller saving can pass.
- **"Bundles `figure`" and "its receipt names it"**: the receipt's `player.module_set` is `figure`, and its digest,
  its player hash and the bundle's files are `figure`'s as the record gives them, with no other set's player inside.
- **"The physics lab"**: #172's lab; "bundles `full`" as above for `full`.
- **"The smallest set"**: the set the record lists with the fewest modules (then the fewest compressed bytes).
- **"Ends at the export refusal for a missing module, naming the module"**: refused, nothing written, an entry of code
  `module_missing` whose JSON names, as a word, a module the lab uses (`scene3d`, `physics` or `logic`) that the
  smallest set lacks. The lab's modules past the core are read from its kinds and world: its box marks are the 3D scene
  module's, its world the physics module's, its item `scorer` the logic module's.
- **"A 2D piece played in `figure` and in `full`"**: the export picks `figure` for the slider fixture, so `full` is
  reached only by a picker that doesn't take the smallest set; the planted `web_picks_full_set` is that picker (AC2
  fails it, so it is a wrong program, and its bundle is still a whole `full` bundle). "Played": a play from the start
  to `ended`, then seeks to 22 steps (0, 960 and 20 seeded with 1490), since seeking equals playing (#172).
- **"Equal step hashes through `probe()`"**: the piece has no world and no logic item, so in #172's shape its
  `step_hash` and `checkpoint_hashes` hold no entry; they are compared all the same, with the step and the evaluated
  data, value by value, its per-step state, as #172 read "by hash" for its 2D piece. The comparison is held to have
  something to compare (the values are there, the track reaches both, and a shifted pairing fails).
- **"Two exports stay byte-identical"**: two exports of a piece in `figure` (the set this issue adds) in clean homes:
  fresh HOME and TMPDIR, another USER and LOGNAME, another evidence store and output path, at least 1.5 s apart. #172's
  suite already holds the lab's, in `full`, across machines.

## Not tested, and why

No criterion asks: which modules `game2d` or any set other than `figure` and `full` holds; per-export compilation and
native players (Not in scope); sets for the app's builds; a host page's `<deep-player>`; the fallback page; timings.
