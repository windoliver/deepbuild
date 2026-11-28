# Blind redraft of #3507's second criterion (`#3507.056af128`): from 1 to 2 a covered pixel, and the report gives each fixture's count

The owner reworded #3507's second criterion on 2026-11-26. It read "On each class's fixture, where no bar hides
another, the count is 1 a covered pixel in every one of the 300 frames" (`#3507.42414ff7`), which
`../3507/ac2-classes.test.mjs` holds. It now reads:

> On each class's fixture, where no bar hides another, the count is from 1 to 2 a covered pixel in every one of the
> 300 frames, and the report gives each fixture's count

Its ID is the first 8 hex digits of the SHA-256 of that text as `scripts/proof-change.mjs`'s `criterionId` reads it,
computed from the issue's body: `#3507.056af128`, as the brief gave it. This folder is the criterion's test as it
reads now, written blind from the issue as it stands, the design, the base commit `5a81b58de` with what #3031 lands
laid over it, and the first suite, `../3507/`, by a job that never saw an implementation. Nothing in `../3507/` is
edited, moved or deleted; its `ac2-classes.test.mjs` stays as written. The implementing agent doesn't edit these
files (AGENTS.md, Proof).

| File | What |
|---|---|
| `ac2-classes.test.mjs` | the one test, `AC2 #3507.056af128 on each class's fixture, where no bar hides another, the count is from 1 to 2 a covered pixel in every one of the 300 frames, and the report gives each fixture's count` |
| `judge.mjs` | its two judges, `rangeProblems` and `reportProblems`, with `folded` and `linesOf` |
| `BASE-FAILURE.txt` | the file run once at the base, and what was checked before it |

## What was read

- The issue as it stands (`issue-3507-body.md`: both opening paragraphs, `Runs on:`, Scope, the five criteria, Proof;
  no comments) and the three design sections it links.
- The first suite, whole: its README, `drive.mjs`, `judge.mjs`, `lease.mjs`, `ac2-classes.test.mjs`,
  `ac3-report.test.mjs`, `lane.json` and `BASE-FAILURE.txt`.
- At the base, for names, shapes and conventions, never for expected values: `benchmarks/canvas/<class>.json`;
  `docs/spikes/3031/README.md` and `count.mjs` (`FRAMES`, `FPS`, a fixture's mean); `crates/deep-show/src/modes.rs`
  (the overdraw row) and `crates/deep-scene3d-render/src/diag.rs` (`Diag::Overdraw`, `DiagCounts`);
  `scripts/proof-change.mjs` (`TAG`, `tagsIn`, `isTestFile`, how a test's name is read), `proof-runs.mjs` and
  `proof.mjs` (`prepareRuns`, `byHandTags`, `trace`), `lanes-lists.mjs` (`redrafted`, `byHand`, `alone`, `LANE_FILE`),
  `lanes.mjs` (`aloneReasons`), `alone-lint.mjs`, `proof-guard.mjs` (a lane file's place), `throttle.mjs`;
  `docs/technical-design.md`, Dogfooding; the redraft folders `3295-redraft-fae86cca/` and `3461-redraft-once/`.
- Not read: any other checkout, branch or ref, GitHub, the web, and nothing of the work.

## How to run

```sh
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
node --test tests/acceptance/3507-redraft-ac2/ac2-classes.test.mjs
for f in tests/acceptance/3507-redraft-ac2/*.mjs; do node --check "$f"; done   # plain modules: no type-check
```

It needs what the first suite's `ac2-classes` needs, and the report: macOS on a Mac of a reference model, Node 24.22
first on `PATH`, `deep-show` (`DEEP_BIN_DIR`'s when a proof run supplies it, else built by the file with `cargo build
--locked --bin deep-show`), the machine's GPU lease free, and `docs/evidence/3507/README.md`. It draws 1,801 frames
at 480 × 270 to 1280 × 800, each class's 300 in two runs side by side: at the base the 1,800 took 33 s at a
one-minute load of 9 and 75 s at a load of 33 to 38 (BASE-FAILURE.txt). A lease another live process holds is
BLOCKED and nothing is drawn, as for the first suite's files: run it again. Never run vitest on this folder:
`../3507/drive.mjs` refuses to load there.

The test imports the first suite's driver, its reading of a frame row and its count of a fixture, and adds no
driver of its own: from `../3507/drive.mjs`,
`referenceMac`, `showBinary`, `underLease`, `classFixture`, `counted`, `listed`, `ALL_FRAMES`, `report`, `REPORT` and
`settle`; from `../3507/judge.mjs`, `CLASSES`, `FRAMES`, `countOf`, `stateOf`, `timeOf`, and `readingOf` through
`counted`. So the machine, the lease, the binary, the four states (`FAIL`, `BLOCKED`, `INCONCLUSIVE`, `INVALID`), a
file's 18 minutes and what a frame row reads as are that README's, unchanged. Redraft folders at the base import
their first drafts' helpers the same way (`103-redraft-1830/`, `1097-redraft-defaults/`, `1342-redraft-1812/`).

## The surface under test

No new call, mode, field, planted name, fixture or environment variable. Two things, one of them new:

**1. The count, on the overdraw mode's frame row: the first suite's, unchanged.** `deep-show run`, a `deep_show` call
that shows the fixture, then `deep_show` with `mode: "overdraw"`, `t` and `size`; the reply's `drawn` holds one row

```json
{ "id": "frame", "what": "overdraw", "max": 2, "shaded": 50960, "covered": 38900 }
```

`max` is the base's (the most fragments any pixel took, every face, depth ignored). `shaded` is the fragments the
geometry pass shades in the frame, a whole number; `covered`, the frame's pixels an opaque solid covers, a whole
number (`../3507/README.md`, The surface under test, part 1).

**2. The report, `docs/evidence/3507/README.md`: six more lines (yours).** One for each class's fixture, by the
fixture's name, in the form that README fixed for the every-pass fixture's count:

```
Shaded on `core_view`: 1.310 a covered pixel, 0.395 a pixel, over 300 frames
Shaded on `data_view`: 1.310 a covered pixel, 0.394 a pixel, over 300 frames
Shaded on `figure`: 1.310 a covered pixel, 0.394 a pixel, over 300 frames
Shaded on `work_product`: 1.310 a covered pixel, 0.393 a pixel, over 300 frames
Shaded on `showpiece`: 1.310 a covered pixel, 0.393 a pixel, over 300 frames
Shaded on `export`: 1.310 a covered pixel, 0.393 a pixel, over 300 frames
```

(The numbers are made up.) As the test reads them:

- The names are `core_view`, `data_view`, `figure`, `work_product`, `showpiece` and `export`, in backticks, with the
  colon right after the closing backtick.
- Each line is on a line of its own, with anything before and after it on that line (a bullet, a table's bars, more
  words). One line a fixture, and one fixture a line: a line reads the first fixture it names.
- The first number is the fixture's count a covered pixel: the mean, over frames 0 to 299, of the frame's
  `shaded ÷ covered`. The second is its count a pixel: the mean of the frame's `shaded ÷ (w × h)`. Each carries three
  decimals or more and is rounded, not cut: the test holds each to within 0.0005 of its own. The test prints each
  fixture's two numbers, to four decimals, as it counts them.
- `over 300 frames`, the 300 #3031 counted: frame k at k ÷ 5 s.
- The two lines the first suite reads, ``Shaded on `every_pass`: …`` and `Geometry pass: …`, stay as its README gives
  them. A line ``Shaded on `<class>` before: …``, or one for another fixture, is the report's own: this test neither
  reads nor refuses it.

## What the test asserts, and what fails it

One test, both clauses, one run: the report is held to the frames the first clause draws.

| Clause | Judge | What it asserts |
|---|---|---|
| "the count is from 1 to 2 a covered pixel in every one of the 300 frames" | `rangeProblems` | for each of the six classes, each of frames 0 to 299: `max` is 2 (no bar hides another), a pixel is covered, and `covered ≤ shaded ≤ 2 × covered`, in whole numbers |
| "the report gives each fixture's count" | `reportProblems` | for each of the six classes the report holds one line in the form, over 300 frames, and its two numbers are this run's count of the fixture, to three decimals |

| It fails on | How |
|---|---|
| the base | FAIL at its assertion, at once, on `core_view`'s frame 0: the overdraw view gives no count of what the geometry pass shades |
| a frame under 1 a covered pixel: `shaded` below `covered` by a fragment or more (the two fields the wrong way round; covered pixels taken at more samples than fragments) | FAIL, naming the class and the frame, `under 1` |
| a frame over 2: `shaded` above `2 × covered` by a fragment or more (fragments at the pass's 4 samples over pixels at one; fragments of more than the bars) | FAIL, naming the class and the frame, `over 2` |
| a frame that covers no pixel while the mode drew the bars | FAIL |
| a frame not counted, not drawn, or with no GPU | BLOCKED |
| a frame where `max` isn't 2: a bar hides another, or none is whole in view | INCONCLUSIVE |
| no report; a class with no line | FAIL, naming the class |
| a number off by more than 0.0005 from the run's (another build's count, a number cut short, two classes' counts under each other's names); a count over other than 300 frames | FAIL, naming the class and both counts |
| a class's line not in the form (two decimals, a range); two lines for one class | INVALID |
| a class's line where the run has no count of that fixture | BLOCKED |

A FAIL among the findings ends the test at an assertion; findings that are all BLOCKED, INCONCLUSIVE or INVALID end
it with a plain error that starts with that state. Never a pass, never a silent skip.

## Readings where the criterion leaves a choice

- **"From 1 to 2" has both ends in.** A frame's count a covered pixel is its `shaded ÷ covered`, and the test holds
  `covered ≤ shaded ≤ 2 × covered` in whole numbers, so no rounding decides an end. 1 is what a pass reads that shades
  each covered pixel once; 2 is the most a bar alone can take, its front and its back. The row gives a frame's sums,
  not each pixel's count, so "every covered pixel takes 1 or 2" is held as far as the sums show it.
- **So a count that leaves the depth test out is inside the criterion's words here.** The class fixtures' bars have a
  paint and no material, and at the base the pass culls no face of such a solid (`lib.rs`, `prepare_batch`: cull 0;
  the first suite's finding). A count with no depth test would then read 2 on a bar alone, its front and its back,
  which is "from 1 to 2". Criterion 1's planted count is what fails such a count, not this test. The criterion
  states no value between its ends, so the test holds none.
- **"Where no bar hides another"** is kept as the first suite read it: a statement about the six fixtures that the
  test checks in each frame before it judges it. The mode's own count is 2 for a bar alone and 4 where two bars share
  a pixel, so `max` of 2 says no bar hides another, and it is also why 2 is the criterion's upper end. A frame with
  another `max` is INCONCLUSIVE: the criterion states no count for it, and "every one of the 300 frames" can then
  not be shown. At the base `max` is 2 in all 1,800 frames, through this driver (BASE-FAILURE.txt).
- **"Each fixture's count"** is each class's fixture's, the six the sentence is about. The every-pass fixture's is
  criterion 3's, which `../3507/ac3-report.test.mjs` holds; it isn't drawn again here.
- **A fixture's count** is the first suite's (`countOf`), #3031's kind of mean: each frame's quotient, averaged over
  the 300 frames, a covered pixel and a pixel, as the Scope names both. The line is that README's form with the
  class's name, and the precision its three decimals, so the report says all seven counts one way.
- **How the report is held to the count.** The count is the test's own, drawn by the checkout it runs in; the
  report's numbers are compared with it and never read as a count. A fixture the run has no whole count of is
  BLOCKED there, not held to the report's word.
- **One test.** Both clauses need the same 1,800 frames, so a second test would only draw them again.

## What isn't asserted, because the criterion doesn't say so

- Which value from 1 to 2 a fixture reads, and that the count is the pass's own (its order, its cull, its depth
  test): criterion 1's, on the two walls.
- That `covered` is the bars' pixels and `shaded` their fragments, beyond the quotient of the two and a covered
  pixel in every frame: the criterion gives no pixel count for a class's fixture. Criterion 1 holds both numbers
  exactly, on the two walls.
- The mode's own count beside each fixture's (the Proof line's "beside the overdraw mode's"). The row gives `max`
  alone of the mode's own count, so a test has no mean of it to hold a report to, and #3031's kept numbers are no
  expected values. How the report shows it is the implementer's.
- The every-pass fixture's line, the `Geometry pass:` line, the two walls and the hashes in the report: criterion 3's
  tests, or the Proof line's.
- A count before, or a pass's time, for a class's fixture: criterion 3 asks those of the every-pass fixture.
- That a class's count stays at or under the Scope's 1.1: no criterion gives a class's fixture that line.

## What the implementer adds outside the folder

`scripts/lanes-lists.mjs`, at its end:

```js
// #3507's second criterion was reworded by the owner on 2026-11-26: the count is from 1 to 2 a covered pixel, and
// the report gives each fixture's count. The first draft's test holds the count to 1: kept as written, by hand only.
// Its blind redraft, 3507-redraft-ac2/, runs in its place; it builds deep-show and draws on Metal under the machine's
// GPU lease, so it runs alone, as #3507's folder does by its lane.json.
Object.assign(redrafted, { 'tests/acceptance/3507/ac2-classes.test.mjs': 'tests/acceptance/3507-redraft-ac2/' });
byHand.push('tests/acceptance/3507/ac2-classes.test.mjs');
alone.push('tests/acceptance/3507-redraft-ac2/');
```

`scripts/lanes.mjs`, in `aloneReasons`, in the `'shared: the GPU'` list, one entry, since the alone lint fails an
entry that names no reason: `'tests/acceptance/3507-redraft-ac2/',`.

No `timed` entry: the file judges no time. No `lane.json`: the lanes read only `tests/acceptance/<issue>/lane.json`,
and the guard refuses a lane file they never read, so the `alone` line above is what keeps the folder alone.

The report's six lines, above.

## Left to the owner

`../3507/ac2-classes.test.mjs` still carries `#3507.42414ff7`, which names no criterion of the issue as it stands.
By hand, it runs in no lane, but `scripts/proof.mjs`'s trace reads a by-hand file's tags too and fails one that
names no criterion of the issue (`prepareRuns`, `byHandTags`). The `byHand` line above doesn't change that. What to
do with the first draft's tag is the owner's call, by an approved proposal; this folder edits nothing of it.
