# Acceptance tests for #1428: a failed pixel names its draw

Written first, from issue #1428 (its scope bullets, its five acceptance criteria and its proof line), the design
sections it links and base commit `0beb4a141` ("Merge pull request #3754 …"), by a job that never saw an
implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding).

## What was read

- Issue #1428, and #380 (closed, the dependency) for the words it cites: the CPU reference, planted wrong programs
  reached through `--planted`, the `reference` call.
- `docs/technical-design.md`, How we know version 0 works: "A CPU reference counts as an oracle only once it reproduces
  at least one fixture whose expected numbers the issue states … until then a comparison against it is a reading";
  the boundary pair (a planted twin one quantum past a threshold must fail, a clean example one quantum inside must
  pass); "The CPU reference covers every 2D pass we write, WGSL held in a string included, each with an analytic
  fixture whose expected values are written by hand and a planted twin that fails it. A failing pixel names its draw:
  the item's stable ID, its pass, and the expected and actual values. A frame can be saved as its draw data and atlas
  bytes and replayed on another machine with no shaping". `docs/canvas-primitives.md`, Determinism (same machine
  compares raw pixels; GPU pixels are never compared across machines).
- `AGENTS.md`, `CONTRIBUTING.md`, `GLOSSARY.md` (a reading informs and is never a verdict).
- At the base, for call shapes only: `crates/deep-gpu-layer/src/main.rs` and `calls.rs` (`deep-gpu run`, one JSON
  scenario `{"out", "calls"}` per line answered `{"ok": true, "replies"}`; an unknown call is refused `bad_input`;
  `--planted <name>`, an unknown name refused), `crates/deep-gpu-layer/src/effects.rs` and
  `crates/deep-effects-render/src/reference.rs` (#380's `operators` and `reference` calls, `cpu_pass`, `pass`,
  `glow`), `crates/deep-gpu-layer/Cargo.toml` (`test-meter` builds hold `testgpu.wgsl` and `burn.wgsl`), the 13
  `*.wgsl` files under the two crates and the Rust files holding WGSL strings, `tests/acceptance/380/` and
  `tests/acceptance/385/` (the scenario runner, the PNG reader, a 2D writer document with a text item),
  `scripts/render-lint.mjs`, `scripts/plant-lint.mjs`, `scripts/twins-lint.mjs` (`--root <checkout>`, one
  `FAIL <name>: <path>: …` line per finding and exit 1, or one `PASS <name>` line) and `scripts/lanes.mjs`
  (`lane.json`).

## Criteria and tests

| Tag | Criterion | File: tests |
| --- | --- | --- |
| `#1428.5e263fc9` | Every WGSL file under the two crates has an analytic fixture and a planted twin that fails it, naming the pass and the item. A file with neither fails the lane, naming the file | `ac1-lane.test.ts`: the lane passes the checkout; a `.wgsl` file planted under `crates/deep-effects-render`, and one under `crates/deep-gpu-layer`, fails it naming that file. `ac1-fixtures.test.ts`: every `*.wgsl` file under the two crates is a pass in the fixture table, each pass with a fixture file and a twin no other file's pass shares; every pass's fixture reads PASS; every pass's twin fails its fixture, naming the pass and an item the fixture draws for the worst 16 pixels |
| `#1428.842a6c09` | A one-code-value error in one channel of one pixel inside the tolerance passes; a three-value error in one pixel fails, naming the item | `ac2-tolerance.test.ts`: every pass under `--planted pixel_one_code` reads PASS with zero outliers; under `--planted pixel_three_codes` every pass reads FAIL with exactly one outlier, listed once, naming the pass and an item its fixture draws, 3 code values from its expected value |
| `#1428.cc64770c` | A saved frame replayed on the same machine is byte-equal to the original render | `ac3-saved-frame.test.ts`: `save_frame` of a 2D document with a line of text, moved to another folder, replayed by `replay_frame` in a fresh process: RGBA bytes equal; with the atlas bytes zeroed the replay's text box differs (or the replay is refused naming the atlas) |
| `#1428.f55fda22` | The result reads as a reading unless the pass's analytic fixture ran, and a planted run with the fixture skipped never reads PASS | `ac4-reading.test.ts`: every pass reads PASS with `fixture_ran: true`; under `--planted skips_fixture` every pass reads `reading`, none PASS, with `fixture_ran: false` |
| `#1428.6b850f58` | A planted WGSL string in a test crate with no fixture fails the lane, naming the file | `ac5-planted-string.test.ts`: a new crate `crates/deep-planted-1428` in a scratch copy, holding a vertex and fragment pass in a raw string in `src/lib.rs`, and in a second test a compute kernel in an ordinary quoted string in `src/kernel.rs`: the lane fails naming that file and no other |

The issue's numbers: within 2 of 255 per channel, zero outlier pixels, the worst 16 pixels, a one-code error passes,
a three-code error fails.

## The surface under test, and how each open point is read

The issue names the lane, the CPU reference's comparison, the failure report, the saved frame and its replay, and a
result that reads as a reading. It leaves their names and shapes open; each is read here as the smallest surface the
issue, the design and the base's conventions allow, so the implementer can follow it.

### The lane: `node scripts/pass-fixtures.mjs [--root <checkout>]`

- A node script in `scripts/`, like `render-lint.mjs` and `twins-lint.mjs`: run from the checkout it checks that
  checkout; `--root <dir>` checks another (the tests' scratch copy).
- It finds every pass: each `*.wgsl` file under `crates/deep-effects-render` and `crates/deep-gpu-layer`, and each
  Rust string under `crates/` holding WGSL (an entry point: `@vertex`, `@fragment` or `@compute`), raw or quoted, in
  any crate, a crate the workspace doesn't list included. Scene passes stay with their own oracles, so the lane may
  leave out a scene pass by naming its oracle; the suite doesn't test which existing strings it leaves out.
- Each pass with no analytic fixture or no planted twin is one finding. Output: one line starting `FAIL` per finding,
  each naming the file's path from the checkout's root (`crates/…`), and exit 1; or a line starting `PASS` and exit 0.
  A finding names only its own file: in the tests every `FAIL` line must name the planted file.
- How the lane knows a pass's fixture and twin (a fixture table it reads, a declaration beside the pass) is the
  implementer's. The scratch copy the tests make holds every file `git ls-files --cached --others --exclude-standard`
  lists at the checkout, except `tests/acceptance/`, cloned into a temp folder that is then `git init`ed with nothing
  committed (no `.git` is copied, and every `GIT_*` variable is left out of the environment). The tests first check the
  lane passes that copy, then plant one new file, run the lane, and remove it.

### `deep-gpu`, built with `test-meter`

Each GPU file builds `cargo build --locked --bin deep-gpu --features test-meter` once, through
`node scripts/throttle.mjs build --wait 240 --`, with `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0`, and copies the
binary out of `target/debug`. `test-meter` is the build that holds `testgpu.wgsl` and `burn.wgsl`, so every pass in
the two crates is reachable. Off macOS a test fails with an INCONCLUSIVE message, as #380's do. A test-meter build is
not a shipped build, so these calls need not be in one.

### The fixture table: `{"call": "passes"}`

```json
{"passes": [{"pass": "<pass name>", "file": "<path from the checkout's root>",
             "fixture": "<path of the file holding its hand-written expected values>[#<name>]",
             "twin": "<its planted twin's --planted name>"}]}
```

One row per pass: a WGSL file with several entry points, or a Rust file with several strings, may give several rows.
Every `*.wgsl` file under the two crates must be the `file` of at least one row. A row's `fixture` names a file in the
checkout (the part before `#`), which holds the expected values written by hand; several rows may share one fixture
file. Twins: a twin is a wrong program of its own file, so two rows of different files never share a twin name.
This is the proof line's "fixture table per pass". Strings held outside these two crates (such as
`crates/deep-show/src/efficiency.rs`'s 2D view pass, which deep-gpu does not link) are held by the lane; the suite
runs fixtures only through this table.

### Running a pass's analytic fixture: `{"call": "pass_fixture", "pass": "<pass name>"}`

The pass runs on the GPU on its analytic fixture's inputs; its output is compared with the expected values written by
hand and with its CPU reference on the same inputs, each within 2 of 255 per channel with zero outlier pixels. A
compute pass's output element counts as a pixel. The reply:

```json
{"pass": "<the pass asked for>", "result": "PASS" | "FAIL" | "reading", "fixture_ran": true | false,
 "items": ["<stable ID of each item the fixture draws>"],
 "outliers": <pixels past 2 of 255 in any channel, against either side>,
 "worst": [{"item": "<stable ID of the item drawn there>", "pass": "<pass>", "x": n, "y": n,
            "expected": [r, g, b, a], "actual": [r, g, b, a]}]}
```

- `expected` and `actual` are code values out of 255 per channel (as many channels as the output has); `expected` is
  the value the pixel's worse comparison holds it to.
- `worst` lists each outlier pixel once, worst first by its largest channel difference, at most 16: its length is
  `min(16, outliers)`. On a PASS it is empty and `outliers` is 0.
- `result` is PASS only when the fixture ran and both comparisons hold; FAIL when the fixture ran and one doesn't;
  `reading` when the fixture didn't run, whatever the comparison against the CPU reference found. This is how "reads
  as a reading" is read: the reply's `result` is the string `reading`, never PASS.

### Planted programs (`deep-gpu run --planted <name>`)

- Each row's `twin`: that pass's wrong program. Under it the pass's fixture reads FAIL, every listed pixel naming
  that pass and an item in `items`, more than 2 code values off.
- `pixel_one_code`: in every pass's fixture run, one channel of one pixel of the GPU output, at a pixel an item draws,
  is one code value off. Every pass still reads PASS with 0 outliers.
- `pixel_three_codes`: in every pass's fixture run, one pixel of the GPU output, at a pixel an item draws, is three
  code values off in one channel. Every pass reads FAIL with `outliers` 1 and one listed pixel, 3 code values off
  its expected value, naming the pass and an item in `items`.
- `skips_fixture`: every pass's analytic fixture is skipped; the pass is still compared with its CPU reference.
  Every pass reads `reading` with `fixture_ran: false`.

The implementer adds these names to deep-gpu's `Planted` table, as #380's are.

### The saved frame: `save_frame` and `replay_frame`

- `{"call": "save_frame", "doc": <2D document>, "look": <look>, "t"?: flicks, "frame": "<folder>"}` renders the
  document's frame as the GPU layer draws it and saves it to the folder as its draw data, `draws.json`, and its atlas
  bytes, `atlas.bin`. Reply `{"png": "<path of the render's PNG, absolute or under out>"}`. `doc` and `look` are as
  #385's `layers` call takes them (a document; a role map).
- `{"call": "replay_frame", "frame": "<folder>"}` draws the saved frame from that folder alone, with no shaping: no
  document, no fonts read. Reply `{"png": "<path>"}`.
- "Replayed on the same machine": saved in one `deep-gpu run` process, the folder copied to another place and the
  original deleted, replayed in a fresh process. Byte-equal is the decoded RGBA8 of both PNGs, byte for byte.
- That the replay draws text from the atlas bytes, not by shaping again: with `atlas.bin` overwritten by zeros of the
  same length, the replay's text box must differ from the original render, or the replay must be refused with a reply
  that names the atlas.
- The document (`helpers.ts`: `frameDoc`): 320 × 200, a panel, a band, a disc and the text item `title` at (16, 16),
  in one writer layer, with a role map look. The render must hold at least 4 colors, and at least 30 pixels of the text
  box (16, 16)–(280, 44) must differ from the bare panel at (300, 10).

## How to run

```sh
node scripts/throttle.mjs test --stall 120 -- node node_modules/vitest/vitest.mjs run --root tests/acceptance/1428 --no-file-parallelism --reporter=verbose --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1428/tsconfig.json
```

The folder runs alone (`lane.json`: the GPU is shared). `ac1-lane.test.ts` and `ac5-planted-string.test.ts` need no
build: they copy the checkout into a scratch folder and run the lane. The other four files build `deep-gpu` and run
every pass's fixture on the Metal device; `ac1-fixtures.test.ts` starts one process per twin and is listed slow.

## What was run

The suite once on the base `0beb4a141`, under a test grant, at load averages from about 40 to 61: 14 tests in 6
files, all failing, none passing, in 1029 s (mostly the `deep-gpu` build). Each fails at a named surface the issue
adds: the lane `scripts/pass-fixtures.mjs` doesn't exist (5 tests), and `deep-gpu run` refuses the `passes` call (7
tests) and the `save_frame` call (2 tests) as `bad_input`, "unknown call". Its output is `BASE-FAILURE.txt`. `tsc` on the
folder exits 0. Not yet seen to work: the scratch copy against a real lane, since the base has none.
