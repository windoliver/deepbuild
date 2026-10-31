# Acceptance tests for #856: shaped-run cache, ellipsis fit over runs already shaped, large text shaped off the UI thread

Written first, from issue #856 (its scope, its four acceptance criteria and its proof line: "The warm and cold
coefficients, the counter's reuse, the fit's count, the worker run's frame times and the cache's bound"), the design
sections it links, and base commit `0b35e68e` ("Merge pull request #859 …"), by a job that never saw an
implementation; none existed. The issue's Oracle line says no upstream test checks these criteria, so none is
ported. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this
job (design: Dogfooding).

What was read:

- `docs/canvas-primitives.md`: Text `text@1` (its fields, `text` "≤ 4,096 chars", and its Semantics: "Shaped once per
  (text, font hash, size, features, width)"; its Cost: "Shaping O(chars) on change … O(visible glyphs) per frame";
  "It can never … shape per frame"); The cost model (per-glyph terms, coefficients from micro-benchmarks, the budget
  class table: a figure's frame CPU is 4 ms); Frame clock and scheduler; Render worker ("GPU-layer evaluation and
  encoding run off the UI thread, which only latches and composes"; "continue in later frames while the frame reports
  settling").
- `docs/technical-design.md`: Dogfooding and "Tests written first" (2518–2551); AGENTS.md.
- At the base: `tests/acceptance/390/`, `381/` (deep-text's JSON lines, `fit`), `379/` (timing judged by the design's
  rule, INCONCLUSIVE, five runs after a warm-up), `387/` (`deep-show run`: `deep_show`, `eval` with `clean` and
  `pixels`, `frames`, the startup `--planted` argument); `crates/deep-text` (`Shaper::shape`, whose ellipsis search
  shapes a fresh `prefix…` per step, and `fit`), `crates/deep-canvas-marks/src/modules.rs` (the `text.shape` operator,
  one `Shaper` per scheduler in the `text.fonts` table), `crates/deep-canvas/costs.json` (`text.shape`:
  `ns_per_glyph` 32,503.37), `crates/deep-show/src/costs.rs`, `crates/deep-show/src/main.rs`.

What the base already does and these tests don't credit: one shaper shapes every text (#390) and `fit` measures it;
the content-key cache (#387) reuses an operator's result when its whole key repeats. There is no shaped-run cache:
each scheduler holds its own `Shaper`, which keeps no runs, so every edit, every counter value and every step of the
ellipsis search shapes again; nothing shapes off the UI thread, and no frame reports settling for text.

## Run them

They build two release binaries, so they run one file at a time. `scripts/lanes.mjs` needs this folder in its
`alone` list (the one-at-a-time unit-lane line, so excluded from the parallel line); this README is the instruction,
and the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/856 --no-file-parallelism
npx tsc -p tests/acceptance/856/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Each file first runs `cargo build --release --locked --bin deep-text` and/or `--bin deep-show` in the checkout
(cached after the first) and fails each of its tests when a build fails; the tests run `target/release/deep-text`
and `target/release/deep-show`. AC1 says "on an optimized build" and AC3 judges a frame time, so every test runs
the release build. Evidence stores go to temporary folders that are deleted. The tests use node built-ins and vitest.
A run with `--root tests/acceptance/856` leaves Vitest's cache in `tests/acceptance/856/node_modules/.vite`; delete
it. `BASE-FAILURE.txt` is the run at the base.

**Timing.** Two tests judge a time: AC1's warm µs per glyph and AC3's worst UI-thread frame. Each takes a warm-up run
and five fresh runs and judges them by the design's rule (Every task carries its own budgets): PASS when all five are
within the limit, FAIL when all five are over it by more than the margin (the larger of 5% and their spread), else
the test fails with a message that starts `INCONCLUSIVE:`; it never passes then. Neither criterion says "on the
reference Mac", so neither is gated on the machine, and no test is gated on power or load (the owner's rule).

## The surface under test

The issue names a cache, a fit, a worker and planted programs, but no code API. These tests extend two binaries that
exist and add none:

| Binary (crate at the base) | What these tests add | Criteria |
|---|---|---|
| `deep-text` (`crates/deep-text`) | subcommand `shape`; startup `--planted no_cache`, `reshaping_fit`, `evicts_oldest`; `fit` read as at the base | AC1, AC2, AC4 (bound) |
| `deep-show` (`crates/deep-show`) | `run`'s `frames` call takes `paced`, `revise` and `pixels` and answers `ui_ms`, `settling`, `pixel_hash`; a `shaped_runs` call; startup `--planted shapes_on_ui_thread`, `run_per_document`; `deep_show` and `eval` read as at the base | AC3, AC4 (sharing) |

### The JSON-lines convention

As #390 and #387 give it: one JSON object per stdin line, exactly one JSON object out per line, in order, then exit
0; a line that can't be read or lacks a required field is answered `{"ok": false, "code": "bad_input"}`, never a
panic. An unknown `--planted` name answers one `{"ok": false, "code": "bad_input"}` line and exits 2 (#305, #379). A
planted program is reachable only through its argument; the shipped behavior is the one without it.

### `deep-text shape [--planted <name>]`

One process holds the one shaper and its one shaped-run cache; every line goes through them in order. A line takes
`fit`'s fields (#390: `text` required, `number`, `font`, `size`, `weight`, `numerals`, `box`, `max_lines`,
`overflow`) and shapes the text as drawing would, ellipsized when it overflows its box or line limit, and answers:

```json
{"ok": true, "glyphs": n, "width": px, "shown": string,
 "shaped": [{"text": string, "glyphs": n}],
 "cache": {"entries": n, "bytes": n, "bound": n}}
```

- `shown` is the text as drawn (the text, or its cut with `…`); `glyphs` the number of glyphs in its run; `width`
  the run's widest line's advance in px.
- `shaped` lists every text the shaper shaped to answer this line, in order, each with the glyphs that shaping gave:
  a text whose run the cache already held is reused and not listed. A line whose runs were all reused answers `[]`.
- `cache` is the shaped-run cache after the line: the runs it holds, the bytes it counts them as against its bound,
  and the bound in bytes (one value for the process). The key is the design's: text, font hash, size, features,
  width and max lines.
- `--planted no_cache`: the shaper with no cache: every line shapes its text (AC1's wrong program).
- `--planted reshaping_fit`: the ellipsis fit that shapes again per step of its search, past the cache (AC2's).
- `--planted evicts_oldest`: the cache that evicts the run it took in first rather than the one used least recently
  (AC4's).

### `deep-show run [--planted <name>]`

#393's scenario and #387's calls hold unchanged. These tests add:

- **`frames`** takes, beside `doc`, `count`, `from` and `step`:
  - `paced: bool = false`: frames are drawn on the wall clock, frame k not begun before k × `step` has passed since
    the call began, as a display paces them, so work handed to the render worker runs while frames go on.
  - `revise: {"frame": k, "document": payload}`: a whole revision of the document (as `deep_show` sends one)
    arrives at frame k's latch; it is checked as a `deep_show` revision is, without a frame of its own.
  - `pixels: bool = false`: each frame reports its `pixel_hash`.

  and each entry of its `frames` adds:
  - `ui_ms`: the UI thread's CPU time for that frame, measured by the binary on the thread's own CPU clock, from the
    frame's latch to the next frame's latch (to the call's end for the last): everything the thread that latches
    does in that interval, admitting and checking a revision that arrives in it included, apart from the capture
    `pixels` asks for.
  - `settling: bool`: true while the frame draws anything older than the current revision, such as a text's last
    shaped run while its new run shapes on the worker; a settled frame always shows the current text.
  - `pixel_hash` (with `pixels`): the SHA-256 of what the frame drew, rendered and encoded exactly as `eval`'s
    `pixels: true` snapshot is (its `sha256`), so a frame and an `eval` of the same revision compare digest to digest.
- **`eval`** with `clean: true` and `pixels: true` (#387, unchanged) is the reference "shaped on the UI thread": a
  clean evaluation runs every node itself on the thread that runs the call, and its snapshot never draws a last run
  in place of the current text.
- **`{"call": "shaped_runs", "text": string}`** answers `{"runs": [{"shaped": n, "docs": [doc ID]}]}`: one entry per
  run in the process's shaped-run cache whose text is `text`; `shaped` the times the shaper shaped that run's key in
  this process; `docs` the documents (as the calls named them) whose current revision draws it.
- `--planted shapes_on_ui_thread`: every text shapes on the UI thread at the latch, whatever its estimate (AC3's).
- `--planted run_per_document`: each document's runs in a cache of their own (AC4's).

## The texts

Made in `helpers.ts`, deterministically: lowercase words and single spaces, each character one glyph in the bundled
body face (checked at the base with the shaper's own glyph count). AC1's label is 300 characters; AC1's counter
shows a bound number (`number: true`, tabular) cycling through twelve values, `1,000` to `2,375`, over 60 ticks, so
48 ticks repeat an earlier text; AC2's string is 2,000 characters, fitted in a 300 px box on one line; AC3's two
figure texts are 10,000 characters each; AC4's run is 100,000 strings of 100 characters, distinct by number, plus an
anchor and a bystander.

## Criteria to tests

Each test's name starts with its ID. Where a criterion names a wrong program, the check it must fail is a function in
`helpers.ts` that returns failures as sentences naming what failed; the clean test asserts it returns none, and the
planted test asserts it returns ones naming what the criterion says.

| ID | Criterion (the issue's text) | Tests, and the wrong program each fails on |
|---|---|---|
| AC1 | On an optimized build, shaping a 300-glyph label already shaped once takes under 2 µs per glyph, and a counter that ticks 60 times reuses every run whose text repeats; a planted shaper with no cache shapes each tick and fails, naming the glyphs it shaped | `ac1.test.ts`: (1) warm timing, measured from outside the program: per run, the wall time of a process shaping the label once is taken from that of one shaping it once and then 5,000 times more, over 5,000 × 300 glyphs, judged against 2 µs; every warm line must also answer `shaped: []`, naming the glyphs if not, and the first must shape the label to 300 glyphs. (2) the counter: each tick showing a text for the first time shapes exactly that text to the glyphs it draws; each repeating tick shapes nothing (`counterFailures`). (3) `--planted no_cache` fails (2), naming the glyphs each repeat shaped and the total against the distinct texts' |
| AC2 | An ellipsis fit over a 2,000-character string shapes each candidate prefix at most once; a planted fit that shapes again per step fails, naming the count | `ac2.test.ts`: (1) the fit shows a prefix and `…` within 300 px, the longest such (the next longer candidate fails the base's own `fit` on one line, so a fit that shapes almost nothing fails); every text it shaped is the string or a prefix of it, none twice, and it shaped something (`fitShapingFailures`). (2) `--planted reshaping_fit` fails, naming a text shaped more than once, its count, and the count of shapings |
| AC3 | A 10,000-glyph text changed in a figure keeps the UI thread under its 4 ms frame CPU while it shapes on the worker, the frame is marked settling until the new run draws, and the settled frame equals one shaped on the UI thread by pixel hash | `ac3.test.ts`, a 960 × 540 figure (budget class `figure`) with one 10,000-glyph text, shown, then 180 paced frames at `frames`' default step of 1/60 s with the text changed at frame 60's latch: (1) frame 59 is settled; frame 60 is settling (the new run can't be shaped before that latch unless the UI thread did it); every frame until the first settled one draws the pixels of frame 59 (the last shaped run); from the first settled frame on, every frame is settled and its `pixel_hash` equals a clean `eval` snapshot of the changed figure in a fresh process (`changeFailures`). (2) the worst `ui_ms` from frame 60 on, judged over five runs against 4 ms; each run must settle. (3) `--planted shapes_on_ui_thread` fails (1), naming frame 60 as drawn unsettled. The base's cold shaping of 10,000 glyphs measures about 3.5 ms on this Mac, near the limit, so the planted program is caught by (1) whatever its time |
| AC4 | The cache stays inside its byte bound over a run of 100,000 distinct strings, evicting the least recently used, and two documents showing the same label share one run | `ac4.test.ts`: (1) one `deep-text shape` process: the anchor, the bystander, the 100,000 strings with the anchor used again after every 100, then the 50 latest again, the bystander, the anchor: `bytes` never passes `bound` (constant, above 0); every new string is shaped; every reuse of the anchor and of the 50 latest shapes nothing; the bystander, never used again, was evicted; the cache ends holding at least the 100 runs between two uses of the anchor, counted at no less than 6 bytes a glyph (`evictionFailures`). (2) `--planted evicts_oldest` fails (1), naming the anchor, evicted though used 100 strings earlier. (3) two boards in one `deep-show run`, the same label (`Ready to ship, all checks passed`: no digit, which the honest-numbers check would refuse unsourced; the same text, face, size and box) in `ink` and in `muted`, so their content keys differ and the content-key cache can't stand in for the run cache: `shaped_runs` lists one run, shaped once, drawn by both documents (`shareFailures`). (4) `--planted run_per_document` fails (3), naming two runs or two shapings |

## Readings where the issue and design leave a choice

- **Measured from outside where it can be.** AC1's warm time is the difference of two processes' wall times, so the
  program's own clock doesn't decide it. The base's cold shaping already measures about 0.4 µs a glyph in a release
  build on this Mac (2,000 lines of `fit` on the label), under the 2 µs limit, so the timing alone can't tell a shaper
  with no cache from one with it; the reuse each line reports (`shaped`) does, and the criterion's own wrong program
  is named by it. AC3's frame time is the binary's reading of the UI thread's CPU clock, as #387's `scheduler_ms` and
  #379's `cpu_ms` are: a frame's share of a thread can't be read from outside the process. Its behavior, the pixels of
  each frame and when it settles, is what the planted program fails on.
- **The counter is a sequence of bound-number lines to the one shaper**, not a document's counter: the criterion is
  about the shaper reusing runs, and `shape` shows each line's shaping. The sharing between documents is tested through
  `deep-show`, where documents are.
- **"Each candidate prefix at most once"** is read as: no text shaped twice in one fit, and every text shaped is the
  string or a prefix of it (with or without the ellipsis). An implementation may shape the whole string and measure
  prefixes from its run, or shape candidates; the test doesn't choose.
- **Settling** follows the Render worker's "the frame reports settling" and the issue's "draws its last shaped run until
  the new one is ready, marked settling, so a settled frame always shows the current text". The revision arrives at
  frame 60's latch, so frame 60 can only draw the new text if the UI thread shaped it or waited for it; frame 60 must be
  settling.
- **The reference "shaped on the UI thread"** is a clean `eval` with pixels, in a process that never saw the old text:
  a render-back never uses a settling frame (Render worker; GPU surface), so it shapes before it draws.
- **One 10,000-glyph text.** `text@1`'s field line caps `text` at 4,096 characters, which the base's check doesn't
  enforce; the criterion names one text of 10,000 glyphs, so the figure holds one. The check must also let that figure
  through its frame-CPU estimate (`over_budget` at the base, whose `text.shape` term charges 32.5 µs a glyph): the
  issue's "hold shaping to a warm cost in the coefficients".
- **The bound and the 100,000 strings.** The issue gives no byte bound; `shape` reports it. A run of 100,000 strings of
  100 glyphs takes at least 60 MB at 6 bytes a glyph, so a bound that never evicts there fails the criterion's
  "evicting the least recently used". The anchor is used every 100 strings, so the bound must hold 100 such runs.
- **Not tested:** the coefficients' `ns_per_glyph_warm` beside `ns_per_glyph` in `crates/deep-canvas/costs.json` and the
  `costs` call (the issue's scope and proof line, not a criterion: the implementer shows them in the PR); that a text
  estimated under 1 ms shapes on the UI thread; a second shaper (out of scope).

## The Oracle lane

The issue's Oracle line says no upstream test checks these criteria, with reasons per criterion on a private page
(`doneright/oracles/issues/856.md` in `DeepBuildAI/deepbuild`, branch `doneright`), which this job didn't read. These
tests are the local proof for every criterion.
