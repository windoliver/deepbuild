# Acceptance tests for #1430: text that re-breaks without reshaping, a width change reusing shaped runs, and typing reshaping one paragraph

Written first, from issue #1430 (its scope, its four acceptance criteria and its proof line: "The shaping counters and the
budget run"), the design sections it links and those they lean on, and base commit `7312c66d2` ("Merge pull request #2850
…"), by a job that never saw an implementation; none existed, and no other worktree, branch, pull request or stash was
read. The issue has no Oracle page (no upstream test checks these criteria), so nothing is ported. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue (`gh issue view 1430`): criteria `#1430.76f8be84`, `#1430.c8134c7e`, `#1430.550b2a5e` and `#1430.8a0fdfd2`,
  their IDs computed from the live text as `scripts/budget-window.mjs`'s `criterionId` computes them.
- `docs/canvas-primitives.md`: Text `text@1`, its fields (`text` "≤ 4,096 chars", `box`, `max_lines`, `align`,
  `overflow`) and its Semantics ("Shaped once per (text, font hash, size, features)"; "Shaping and line breaking keep
  separate keys: a shape key (text, font, size and features) and a layout key (the shape key plus width, line limit and
  alignment), so a change of width breaks lines again from the kept shaped runs and reshapes nothing. A long text shapes
  per paragraph, so typing reshapes only the paragraph it changes. Both caches keep a bound in bytes and in entries, and
  count their hits"), its Cost ("Shaping O(chars) on change, about 0.2 µs per char"); Frame budget (five runs after a
  warm-up, the margin, INCONCLUSIVE off the reference Mac); The cost model (coefficients from micro-benchmarks on the
  reference Mac).
- `docs/technical-design.md`: Decided, "Which text shaper" (one Rust shaper with bundled fonts; GPUI's own text stays for
  the app's chrome); How we know version 0 works: Every task carries its own budgets (each side against the merge base, a
  regression a p50 more than 50% above it, five runs judged by the margin, the times only on a reference Mac), The
  reference Macs, Wrong programs, Dogfooding (who drafts, proven on the base, a base with nothing to start).
- `docs/parallel-proof.md` §12a, Budget windows: a task of `benchmarks/budgets.json` names the criteria it proves, and the
  window measures each merged commit against its merge base on a reference Mac.
- At the base: `crates/deep-text` (`src/cache.rs`: the one shaped-run cache, keyed on the text, the font hash, size,
  features, width, max lines, alignment and more, bounded at `BOUND` = `32 << 20` bytes, with `record`/`take_log`,
  `stats` and #856's `Planted`; `src/shape.rs`: `Shaper::shape`, `run`, `fit`, `Spec`, `Shaped`, and #1966's paragraphs
  that a `\n` ends; `src/main.rs`: the `deep-text` binary and its `shape`, `fit` and `fonts` subcommands; `src/fonts.rs`:
  the bundled faces and `face_of`); `crates/deep-show/src/costs.rs` (the `costs` call's cold and warm shaping);
  `benchmarks/canvas.mjs` (its workloads, `judge` and the efficiency tasks' targets), `benchmarks/budgets.json`,
  `scripts/benchmark.mjs` (the reference Macs, `judgeLimit`, `validateBudgets`, `judgeTargets`), `scripts/lanes.mjs`
  (`alone`, `timed`); and, as conventions, `tests/acceptance/856/` and `224/` (both reused by import), `390/`, `381/`,
  `375/`, `379/` and `1968/`. Also parley 0.12's `LineMetrics`, the base's dependency, for how a wrapped line's hanging
  space counts in its advance (Readings, 9).

## What the base already does, and these tests don't credit

`deep-text shape` (#856) shapes a text through the one shaped-run cache and lists what it shaped. That cache keys a run on
its width, line limit and alignment beside its text, font, size and features, and shapes a text whole, `\n`s and all: a
text laid out at a new width is shaped again in full, and so is a text with one typed character. The cache holds runs to
32 MiB and counts no hits. A layout asked again exactly already reuses its run at the base (#856's AC1); no test here
counts that alone.

## Run them

Three files build the release `deep-text` (#856's `useRelease`), so the folder runs one file at a time:
`scripts/lanes.mjs` needs `'tests/acceptance/1430/'` in its `alone` list, and `'tests/acceptance/1430/ac4-budgets.test.ts'`
in its `timed` list, since that file's verdict reads the machine and its load. This job writes only this folder; the
implementer makes both edits.

```sh
npm ci                          # once, if node_modules is missing
PATH=$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH \
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease npx vitest run --root tests/acceptance/1430 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1430/tsconfig.json   # type-check (exits 0)
```

`ac1`, `ac2` and `ac3` first run `cargo build --release --locked --bin deep-text` (cached after the first) and fail each of
their tests when it fails; `ac4` builds nothing itself (on a reference Mac at rest the task's own command builds what it
times). A run with `--root` leaves Vitest's cache in `tests/acceptance/1430/node_modules/.vite`; delete it. Node
built-ins, vitest and the base's own scripts only; the folder imports `../856/helpers.ts` (the binary, its JSON lines,
#856's reader of `shape`, the prose words) and `../224/helpers.ts` (the seeded generator, the reference-Mac rule and the
task's judge) by path. `BASE-FAILURE.txt` says how each test is expected to fail at the base.

## The surface under test

The issue names a counter, two keys, planted programs and a bench, but no call. These tests extend the binary #856
extended, `deep-text shape`, and the bench `benchmarks/canvas.mjs` with one workload; they add no binary. **Every name
marked *(chosen)* is this job's choice** where the issue and the design leave it open; the implementer builds exactly
these, or a dispute goes to a blind redraft.

### `deep-text shape [--planted <name>]`

#856's contract holds unchanged (its README: one process, one shaper, one JSON line out per line in, in order; a line
takes `fit`'s fields, `text` required, `font` (`body`, `mono` or `math`), `size`, `weight`, `numerals`, `box: {w, h}`,
`max_lines`, `overflow`, and answers `{"ok": true, "glyphs", "width", "shown", "shaped", "cache"}`); #856's tests stay as
they are. These tests add:

- **`shaped`, read per paragraph** *(chosen reading)*. Each entry is one shaping the shaper made to answer the line, and
  a long text shapes per paragraph, so an entry's `text` is the one paragraph it shaped, with or without the `\n` that
  ends it, and its `glyphs` that shaping's glyph count. A **paragraph** is a longest run of the text holding no `\n`
  (U+000A), as #1966's `gap` reads "each paragraph a `\n` ends"; a text with no `\n` is one paragraph, so #856's entries
  read as before. Breaking lines from shaped runs a cache holds is no shaping and lists nothing. This list is the issue's
  counter.
- **`caches`** *(chosen)*, on every reply: the two caches after the line,

  ```json
  "caches": {"shape":  {"entries": n, "bytes": n, "bound": n, "hits": n},
             "layout": {"entries": n, "bytes": n, "bound": n, "hits": n}}
  ```

  `shape` holds shaped runs by the shape key (text, font, size, features); `layout` holds laid-out runs by the layout key
  (the shape key, width, line limit, alignment). `entries` and `bytes` are what each holds and counts against `bound`, its
  byte bound; `hits` counts the lookups since the process started that found their key. #856's `cache` stays beside it,
  as #856's tests read it.
- **`run: true`** *(chosen)* in a request asks for the laid-out text's whole output, which the reply then carries (and
  never carries without it, so #856's lines and timings are unchanged):

  ```json
  "run": {"lines": n, "width": px, "height": px, "shown": string,
          "glyphs": [[face, size, id, x, y], …]}
  ```

  `glyphs` lists every glyph drawn, in the run's order: `face`, the bundled face it is set in, as `deep-text fonts` names
  that face's `file` in its `faces` list (such as `crates/deep-text/fonts/Inter-Regular.ttf`); `size`, its font size in
  px; `id`, its glyph ID in that face; `x` and `y`, its position in px from the run's origin, `y` on its baseline.
  `lines`, `width` (the widest line's advance), `height` and `shown` are the run's, as `Shaped` holds them.
- **Planted programs** *(chosen names)*, each reached only by its startup argument, as #856's are; the shipped program is
  the one without one, and an unknown name answers one `{"ok": false, "code": "bad_input"}` line and exits 2, as at the
  base:
  - `--planted keyed_on_width`: one cache whose key holds the width, as at the base, so each new width shapes the text
    again (AC1's).
  - `--planted key_without_font`: the split caches with a shape key that leaves the font out, so a text laid out in one
    font is reused for another (AC2's).
  - `--planted whole_text`: the split caches with a long text shaped as one run, as at the base, so a typed character
    reshapes all of it (AC3's).

### How a typed character is sent

As the whole edited text, in the next `shape` line of the same process, at the same width: a revision carries the whole
text, as `deep_show` sends one. No edit call is added.

### How a text's output is compared byte for byte

Each case is laid out with `run: true` twice: in turn, in one process after every case before it (the split cache,
warm), and alone, in a fresh process that has laid nothing out (an empty cache). The two `run` fields must be the same
JSON: the test parses each line and compares the two `run` values' JSON text, which for one serializer is byte equality.
So that equal outputs can't be empty ones, each empty-cache output must show the case's text whole, list as many glyphs
as the reply's `glyphs` counts (some, for a text with any) and set every glyph in a face of its font role's family at the
case's size (`deep-text fonts`: `fonts[].family` by role, `faces[].family` by file).

### The budget task (AC4)

```json
{ "id": "canvas-text-reflow", "command": ["node", "benchmarks/canvas.mjs", "text-reflow"], "margin": 0.5, "limits": {},
  "targets": { "width_change_50kb_ms": 5, "typed_char_50kb_ms": 2 },
  "criteria": ["#1430.8a0fdfd2"], "initialReason": "Issue #1430 first measurement: …" }
```

*(chosen: the id, the workload `text-reflow`, the two target names.)* `width_change_50kb_ms` is a width change on a 50 KB
text: the text already laid out, laid out again at another width, from the request to its laid-out run;
`typed_char_50kb_ms` is one typed character: the same text with one character typed into one paragraph, laid out at its
width. The workload runs as #854's efficiency tasks do (a release build, one warm-up and five runs, each a fresh process,
each run with its `loadStart` and `loadEnd`) and prints its report with `task: "canvas-text-reflow"` and
`fingerprint.build.profile: "release"`; `canvas.mjs judge` holds both times to their targets on a reference Mac. `margin:
0.5` is the comparison with the merge base: the window holds the whole command's p50 and peak memory to 50% over the
merge base's (Every task carries its own budgets; §12a), and the lane's validator takes the file against the merge
base's. `initialReason` names #1430.

## Criteria to tests

Each test's name starts with its criterion's tag (`AC<n> #1430.<h8>`; the `AC` map in `helpers.ts`). Each criterion's
check is a function in `helpers.ts` that returns its failures as sentences naming what failed: the clean test asserts it
returns none, and the planted test that it returns the ones the criterion names.

| Criterion | File (tests) | What it asserts |
|---|---|---|
| AC1 `#1430.76f8be84` | `ac1-widths.test.ts` (2) | One process lays the long text out at the 100 widths in turn. **(count)** Line 1's `shaped` lists each of the 100 paragraphs exactly once and nothing that isn't one; lines 2 to 100 list nothing; every line shows the text whole and is no wider than its box by more than an em (`widthFailures`). **(scope)** At every line, and at a 101st asking line 100's layout again, both caches report the existing bound, 33,554,432 bytes, and hold no more; their hits never fall; the shape cache's hits rise by at least 99 over lines 2 to 100; the 101st shapes nothing and the layout cache's hits rise (`cacheFailures`). **(planted)** `--planted keyed_on_width` fails the count, naming line 2 shaping again at 160 px and the 99 later layouts' count of shapings, at least 99 |
| AC2 `#1430.c8134c7e` | `ac2-property.test.ts` (2) | The 160 cases from seed 1430 lay one text out in two fonts at one size and width, one text at two widths in one font and size, and a typed text after its original in one font and size (`meetingFailures`); every empty-cache output is the case's own (above); each case's `run` laid out in turn equals its `run` laid out alone, byte for byte; a difference is shrunk and named with the seed (`propertyFailures`). **(planted)** `--planted key_without_font` fails it, naming the seed, the case, its first difference and the shrunk cases |
| AC3 `#1430.550b2a5e` | `ac3-typing.test.ts` (2) | One process lays the long text out at 640 px, then the text with `q` typed at character 256 of paragraph 42: that line's `shaped` lists one entry, the paragraph with the `q`, and the line shows the text with it (`typedFailures`). **(planted)** `--planted whole_text` fails it, naming the texts it reshaped and their characters, more than the paragraph's 513 |
| AC4 `#1430.8a0fdfd2` | `ac4-budgets.test.ts` (1, timed) | **(record judge)** passes the merge base's `benchmarks/budgets.json` with the task added, and fails five planted records: a target loosened (`width_change_50kb_ms: 10`), the criterion not named, another margin, no reason, a frozen task removed. **(record)** The checkout's `benchmarks/budgets.json` holds the task above and the lane's validator takes it against the merge base's. **(times)** Only on a reference Mac at rest (`judgeLimit`'s rule on the machine and the load): the task's own judge (`judgeTargets`, as the window runs it) judges its two targets; FAIL fails, BLOCKED is BLOCKED, anything else but PASS is INCONCLUSIVE |

## Planted programs

- AC1: `--planted keyed_on_width`, in the binary (above).
- AC2: `--planted key_without_font`, in the binary.
- AC3: `--planted whole_text`, in the binary.
- AC4: five wrong records, made in test code from the merge base's `benchmarks/budgets.json` (above). Its times' wrong
  program is the merge base, which shapes the whole text again on a width change and on a typed character; the budget
  window measures against it.

## Fixtures

Made at test time, deterministically.

- **The long text** (AC1, AC3): 100 paragraphs of 512 characters, one `\n` after each but the last: 51,299 bytes of
  ASCII, past 50 KB read as 50,000 or as 51,200 bytes. Paragraph k is #856's `prose(512, 1 + k mod 22, 7k mod 23)`:
  lowercase words and single spaces, each paragraph by a stride and an offset of its own, so no two are equal; no word is
  longer than 8 characters, far narrower than 160 px at 13 px. Laid out in the body face at 13 px (`shape`'s defaults)
  with `overflow: "mask"`, so it is drawn whole and never ellipsized.
- **AC1's widths**: 160 to 853 px by 7, 100 widths, widest and narrowest alternating (853, 160, 846, 167, …, 510, 503), so
  no layout can stand in for the next.
- **AC3's typed character**: `q` at character 256 of paragraph 42 (index 41), mid-text and mid-word; both layouts at 640
  px. The typed paragraph is 513 characters.
- **AC2's cases**: seed 1430, mulberry32 (#224's `seeded`), 160 cases over eleven texts: six random texts of one to five
  paragraphs (one paragraph in ten empty) of 1 to 18 words from a 36-word ASCII list chosen for kerning pairs, ligature
  candidates, figures and punctuation (`AVATAR`, `office`, `->`, `1,234.50`, …), every character of which the three role
  faces map; the first four again, each with one character typed into one paragraph; and one text of the last two's
  paragraphs. Each case is one of the eleven texts, a font role (`body`, `mono` or `math`), a size (9, 11, 13, 16.5 or 24
  px, or one case in five any of 8 to 30 px to the hundredth) and a width (72, 150, 233.5, 320, 480 or 777 px, or one case
  in four any whole width from 40 to 799 px), with `overflow: "mask"`. The texts are 30 to 312 characters. At this seed
  the cases hold 6 pairs laying one text out in two fonts at one size and width, 62 at two widths in one font and size,
  and 17 typed texts after their original in one font and size.

## Legs that read BLOCKED or INCONCLUSIVE

Never PASS:

- AC4's times read INCONCLUSIVE off the reference Macs (Mac15,7, Mac15,12, Mac17,10), on battery, in Low Power Mode, at a
  thermal state other than nominal, without a macOS build, or with a one-minute load above the cores at the test's start
  or before the judge runs (`judgeLimit`'s rule, through #224's `standing`), naming why; INCONCLUSIVE when the task's
  judge reads INCONCLUSIVE or INVALID; BLOCKED when it reads BLOCKED (its command or its judge didn't run). Note: at the
  base, `canvas.mjs judge` hands `judgeLimit` no loads for an efficiency task's times, and `judgeLimit` reads a run whose
  load can't be read as INCONCLUSIVE; until that judge passes each run's `loadStart` and `loadEnd`, a task's times read
  INCONCLUSIVE even on a reference Mac at rest, here and in the window alike.
- AC4 reads BLOCKED when the merge base can't be found (`git merge-base HEAD origin/main`) or its `benchmarks/budgets.json`
  can't be read.
- Every test of `ac1` to `ac3` fails, never passes, when `cargo build --release --locked --bin deep-text` fails.

## Readings where the issue and design leave a choice

1. **The counter** is `shaped`: every shaping made to answer a line, one entry per paragraph shaped. "Shapes each
   paragraph once" is: over the 100 layouts each paragraph is in exactly one entry and nothing else is shaped. The
   proof line's "shaping counters" read the same list.
2. **A paragraph** ends at `\n` (#1966's reading), and a shaping of one is named by its text, with or without that `\n`.
3. **"Output"** is the laid-out run as drawing reads it: each glyph's face, size, ID and position, and the run's lines,
   width, height and shown text. **"An empty cache"** is a fresh process that has laid out nothing but that case; "the
   split cache" is the process that has laid out every case before it. Cases recur by design (eleven texts, short lists
   of sizes and widths) so both caches are hit: a property over texts that never repeat would never read a cache. The
   seed is recorded, and a failure is shrunk to the fewest cases before it that still make it differ.
4. **"Random fonts"** are the three font roles `shape` takes (#390, #417), whose families differ; weight, numerals, line
   limit and alignment stay at their defaults, since the criterion names text, fonts, sizes and widths.
5. **"One typed character"** is one character inserted inside a paragraph, sent as the whole edited text; "reshapes one
   paragraph" is exactly one shaping, of that paragraph as typed.
6. **50 KB** is at least 51,200 bytes. text@1's field caps `text` at 4,096 characters; that is the document check's cap,
   not the shaper's, which takes the issue's 50 KB text, as #856 read its 10,000-glyph text.
7. **The scope's "both caches keep the existing byte bound and count hits in the bench"** is tested under AC1, because
   AC1's run is where both caches work (100 layout keys of one text, each reusing its shaped runs) and its counter is
   what the hits complement: each cache reports the base's bound, `BOUND` = `32 << 20` = 33,554,432 bytes, which 100
   layouts of a 51,299-character text pass many times over if each is kept whole, and counts its hits beside its size in
   `shape`'s reply, the surface the tests and the bench can read the caches through. No bound in entries is asserted:
   the issue gives none.
8. **"Compared with the merge base"** is the budget window's comparison (§12a): the task's `margin: 0.5` against the merge
   base's run of the same command, and the validator against the merge base's file. The merge base has no such task, so
   its first window records the change's readings with the reason, as every new task's does; the tests build no merge
   base.
9. **AC1's guard on width** allows one em past the box: parley counts the space that hangs at a wrapped line's end in
   the line's advance (`LineMetrics::advance` includes `hanging_advance`), and a layout made at another width is hundreds
   of px off.

## Not tested, and why

- Alignment and the line limit as parts of the layout key, a variable font's axes in the shape key, and a bound in
  entries: the design says so, but no criterion of this issue does.
- A typed `\n`, which splits a paragraph in two, and a pasted run of text: neither is one typed character.
- The ellipsis fit over the split caches: #856's AC2 tests it, unchanged.
- Templates reshaping only when a value they show changes, text in depth, and the app's chrome text (gpui's): other
  issues.
- The cost model's `costs` call and its `ns_per_glyph_warm`: the issue's scope doesn't change them.
- The bench's readings off a reference Mac: the window measures them; this suite judges them only on a reference Mac at
  rest.
