# Acceptance tests for #1857: one cap on what recipes expand, and ranges on line profiles

Written first, from issue #1857 ("Numbers in a pack or document can't make the check or a frame run without end: one
cap on what recipes expand, and ranges on line profiles": its opening paragraph, its Scope, its seven acceptance
criteria and its Proof line), the design sections it links and those they lean on, and base commit `8637610231a5`,
by a job that never saw an implementation. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding).

**Not run at the base.** When this suite was written the checkout held no `target/` folder, so neither binary the
tests drive was there, and this job starts no build. Every fixture and call shape below is from the base's sources
and its nearest suites, read, not run. `BASE-FAILURE.txt` says what each test is expected to meet at the base and
is a forecast until someone runs it. A fixture the base refuses for a reason not foreseen here is a fault of this
suite, for a blind redraft, not for the implementer to work around.

## What was read

- The issue, whole. The oracle page it links was not read (it is in another repository); the brief gives its one
  line: no upstream test checks any of the seven criteria.
- `docs/canvas-primitives.md`: Recipe (Fields: a param's `{repeat: {count | over, as, let, of}}`, "its count fixed
  at check, at most 1,024"; steps with `op: … recipe …`; Semantics: "Expanded at check time … into derived items
  `<instance>.<step>[.<index>]`", "nesting stops at 4"; Cost: "at most 1,024 per repeat"); Look `look@1`: line
  profiles (Fields: `profile: {taper_in, taper_out: 0..1, swell, flick: px, overshoot: px, breaks: {every: px, gap:
  px}, …}`).
- `docs/technical-design.md`: Every task carries its own budgets; The reference Macs (five runs after a warm-up;
  PASS, FAIL and INCONCLUSIVE; where a time or a peak counts); the Memory and footprint rows of Numbers version 0
  has to hold. `docs/parallel-proof.md`: 5 (Binaries for tests), 6, 7 (a suite's own lane file) and 12a (Budget
  windows, and its Reading rule for "in the local preflight").
- At the base, for names, shapes and conventions only: `crates/deep-canvas/src/document/packs.rs` (`MAX_REPEAT`,
  `MAX_DEPTH`, `Planted`, the pack check of a step and its repeat, `Template` and `ListRepeat`) and
  `packs/expand.rs` (`expand_one`: how a repeat is counted, a derived ID made and checked, a nested step expanded
  with a copy of the item map, and what path each refusal carries); `crates/deep-canvas/src/document/mod.rs`
  (`Issue`) and `check.rs` (the `over_budget` issues the base already makes); `crates/deep-canvas-drawn/src/spec.rs`
  (`Refused {code, path}`, `profile`, `line`, `check`) and `geometry.rs` (`profiled`);
  `crates/deep-canvas-marks/src/look.rs` (`resolve_in`, `Refusal`, its JSON); `crates/deep-gpu-layer/src/film.rs`
  and `marks2d.rs` (`layers`: a refused look is the call's reply); `crates/deep-show/src/hub.rs` and `packs.rs`
  (`timing.check_ms`, `expansions`, `planted`).
- The base's suites, for layout, helpers and call shapes: `tests/acceptance/306/` (packs as fixtures, boards,
  instances, `deep_show`, `expansions`, `timing`, the budgets file, the reading of "names"), `2015/` (the `full`
  build once per file, the scenario), `1957/` (a step whose `op` is `recipe`; a board with one isn't required to
  be presented), `149/` (`deep-gpu run`, a look inline, a line profile on a stroke, a refused `layers` reply),
  `1719/` (the castle through `deep-show run`), `202/` (the machine gate and the judge of five runs).
- Two probes of this machine, by node scripts that start no binary of the repository: `ulimit -v`, `-d` and `-m`
  can't be set here ("cannot modify limit: Invalid argument"); `/usr/bin/time -l` reports "maximum resident set
  size" and "peak memory footprint" for a child that ended by itself and for one killed by PID; one `ps -o rss=`
  takes about 9 ms.

## Run them

Each file builds its binary once (a `cargo build` whose every argument is written out in `helpers.ts`, honouring
`CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set), copies it to a temporary
folder, and fails each test with `BLOCKED` if the build failed.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1857 --no-file-parallelism --testTimeout=3600000 cap.test.ts
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1857 --no-file-parallelism --testTimeout=3600000 budgets.test.ts
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1857 --no-file-parallelism --testTimeout=3600000 looks.test.ts
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1857 --no-file-parallelism --testTimeout=3600000 still.test.ts
node node_modules/typescript/bin/tsc -p tests/acceptance/1857/tsconfig.json
```

| File | Builds | Tests | Takes, on a program that passes | At the base |
|---|---|---|---|---|
| `cap.test.ts` | `cargo build --locked --bin deep-show --no-default-features --features full` | 4 | about 2 min where the numbers are only readings (5 children, the planted one held to its 60 s); about 3 min on a fit reference Mac (25 children) | about 3 min: two children run to their 60 s |
| `budgets.test.ts` | the same | 2 | under 1 min where the numbers are only readings (1 child); up to 30 min on a fit reference Mac (12 children, the planted ones slow, each held to 300 s) | up to 5 min |
| `looks.test.ts` | `cargo build --locked --bin deep-gpu` | 3 | about 2.5 min: the planted child is held to its 120 s | about 2.5 min |
| `still.test.ts` | both | 2 | about 1 min | the same |

`cap.test.ts` and `budgets.test.ts` are timed files: each judges a time (What the implementer adds outside the
folder). `looks.test.ts` and
`still.test.ts` draw on macOS's Metal device through `deep-gpu`, as #149's files do; `lane.json` has the suite run
alone for that. Node built-ins and vitest only; no file of another suite is imported. `still.test.ts` reads, as
data, the shipped packs and looks and the fixtures of #149, #417 and #1561: they are criterion 7's subject. A run
with `--root tests/acceptance/1857` may leave Vitest's cache in `tests/acceptance/1857/node_modules/.vite`; delete
it. Each test's evidence store, `out` folder and runner files are in its own temporary folder, deleted after it.

## The surface under test

Names marked **yours** are the implementer's to provide, exactly as spelled.

### The document check, through `deep-show run` (#393, #306), in the `full` build set

One scenario line: `{evidence, sessions, processes, panels, docs, packs: [{id, dir}], planted?, calls}`. The test
pack is installed from `packs` before the first call. The one call is the agent's `deep_show`:
`{"call": "deep_show", "session": "sess-alpha", "doc": "01JB1857D00000000000000001", "document": <a board>,
"include": ["issues", "timing"]}`. Its reply is read for `outcome`, `issues`, `expansions` and `timing.check_ms`,
all of which the base already answers for a document it checked, refused or not (#306's README: Reply fields added).

**The refusal of criteria 1 to 3** is the reply's `outcome: "refused"` and one issue:

```json
{"code": "over_budget", "severity": "error", "ids": ["t1"], "path": "items/t1/steps/rooms/repeat",
 "actual": 1049600, "what": "… past the cap of 100,000 …"}
```

- `code` `over_budget`, `severity` `error` (the issue's Scope; the base's other `over_budget` issues).
- `ids` holds the document's instance, as itself (`t1`) or as a derived ID under it (`t1.floors.0`): the base
  reports a nested step's fault under the nested instance's ID, and either names the instance.
- **yours**: `actual` is the count the expansion would reach, a whole number greater than the cap (Scope: "the count
  it would reach"; the base's `over_budget` on `budget/lights` carries its count the same way). Which count, by which
  rule of counting, isn't read.
- **yours**: the cap's number is somewhere in the issue's JSON text, in digits, plain (`100000`) or grouped by
  commas (`100,000`), not as part of a longer number. #306's suite reads "names" in an issue's whole text the same
  way.
- Criterion 1, **yours**: `path` holds the segments `steps/<step>` for a step of the chain. The base writes a
  step's faults at `items/<instance>/steps/<step>/…`.
- Criterion 2, **yours**: the input's name, `per_side`, is in the issue's JSON text as a whole word: in `path`
  (`items/d1/params/per_side`, where the base writes an input's faults) or anywhere else.
- Criterion 3, **yours**: `path` holds the segments `steps/<step>/params/<param>`, here
  `steps/mat/params/threads`, as the base writes a param's faults (`items/<instance>/steps/<step>/params/<param>`);
  segments after them are allowed.

The numbers in the example are made up. No wording of `what` or `fix` is read.

**The cap's value** is read from the design, where the issue's Scope says it is stated: in
`docs/canvas-primitives.md`, section `#### Recipe`, on the line that holds the words `at most 1,024 per repeat`, the
first whole number written after those words on that line, in digits, with or without thousands commas (such as
`at most 1,024 per repeat and 100,000 derived items and list elements per document`). **Yours**: to write it there
in that form. A cap under 1,024 is refused by the tests. At the base the line ends with those words, so every test
of criteria 1 to 3 also reports "the Recipe section states no cap".

**Criterion 4** reads the reply's `expansions` (`[{"instance": "g1", "derived": {<derived ID>: …}, …}]`, #306) and
`timing.check_ms`, "the wall time of the document's full check as the binary measured it, expansion included"
(#306).

### A look's check, through `deep-gpu run [--planted <name>]` (#377), the look inline (#149)

One line `{out, calls}`; each call is #385's `layers`:
`{"call": "layers", "doc": <a figure>, "look": <a look@1>, "by": ["gpu_layer"], "float": true}`. The base resolves
the look before it draws, and a refused look is the call's whole reply. **Yours**, for criteria 5 and 6: that reply
is

```json
{"ok": false, "code": "out_of_range", "path": "lines/nib/profile/breaks/every"}
```

read for `code` (`out_of_range`, the Scope's word; the base answers `bad_look` for every refusal of a drawn field,
since `Refusal::Bad` keeps the path and drops the code), for `path`, exactly the field's
(`lines/<name>/profile/breaks/every`, criterion 5's own words; by the same form `lines/<name>/profile/overshoot`
and `lines/<name>/profile/flick`), and for having no `layers`. An admitted look answers `layers` and no `code`.

### Planted programs (**yours**: each name, and what it does)

| Name | Reached by | Criterion | The wrong program |
|---|---|---|---|
| `expansion_counts_after` | scenario `planted` of `deep-show run` | 1 | The expansion makes every derived item of an instance, at every nesting level, and every element of every param `{repeat}` list, as the base does, and only then counts them against the cap and refuses with the shipped program's issue. Nothing else differs: it still stops at a bad ID, a cycle or a fifth recipe down. Given `f1` it never answers. |
| `expansion_copies_items` | scenario `planted` of `deep-show run` | 4 | For each nested instance, the expansion copies the document's whole item map before it expands that instance, as the base's `expand_one` does (`items.clone()`). Nothing else differs: the same derived items, keys and issues. |
| `profile_admits_zero_breaks` | `deep-gpu run --planted profile_admits_zero_breaks` | 5 | The look's check admits a line profile whose `breaks.every` or `breaks.gap` is 0, as the base's parser does, and the stroke is then drawn as the base draws it. Given criterion 5's look and figure the child never answers. If the work also makes `profiled` end on such a profile, the planted program draws without that guard: the criterion says it hangs. |

Each is reachable only by its name, never by an environment variable (design: Wrong programs), and is off unless
named. The base maps a scenario's `planted` name in `crates/deep-show/src/main.rs` and hands the expansion's to
`deep_canvas::document::packs::Planted` in `hub.rs`; `deep-gpu run` reads `--planted` in
`crates/deep-gpu-layer/src/main.rs`. None of the three names exists at the base, so the three tests that ask for
one aren't runnable there. The suite has no twin and no `twins.json`.

## Fixtures

Four test packs under `fixtures/packs/`, each `test/<name>@1.0.0`, needing only `marks2d`, their marks `rect@1` as
#306's chart pack writes them, their nested steps as #1957's study pack writes one, with `repeat: {count, as}`.

- `test-tower-1.0.0`: criterion 1's pack, four recipes that each repeat 1,024 times. `tower.block@1` (step
  `floors`: 1,024 of `tower.floor@1`), `tower.floor@1` (step `rooms`: 1,024 of `tower.room@1`), `tower.room@1`
  (step `shelves`: 1,024 of `tower.shelf@1`), `tower.shelf@1` (step `books`: 1,024 rects).
- `test-dial-1.0.0`: criterion 2's. `dial.grid@1` (step `rows`), `dial.row@1` (step `cells`) and `dial.cell@1`
  (step `dots`, rects), each with the input `per_side` (integer, default 2, 1 to 1,024) as its step's repeat count,
  the first two handing it down (`params: {per_side: "per_side"}`).
- `test-weave-1.0.0`: criterion 3's. `weave.mat@1`, one step `mat`, a rect whose param `threads` is
  `{repeat: {count: 1024, as: "a", of: {repeat: {count: 1024, as: "b", of: {repeat: {count: 1024, as: "c", of: 1}}}}}}`.
- `test-rows-1.0.0`: criterion 4's. `rows.sheet@1` (step `rows`: 1,024 of `rows.row@1`) and `rows.row@1` (step
  `dot`, one rect).
- `look.json`: a sound `basis: drawing` look@1, #149's base look under this suite's ID; each test lays `lines.nib`
  over it.

The boards, each naming one pack and holding one instance (counts by hand, from the files above and the Recipe
section's derived IDs, `<instance>.<step>.<index>`):

| Board | Instance | What it asks the check for |
|---|---|---|
| `t1` | a `tower.block@1` | 1,024 + 1,024² + 1,024³ + 1,024⁴ = 1,100,586,419,200 derived items, were its IDs to fit |
| `f1` | a `tower.floor@1` | 1,024 + 1,024² + 1,024³ = 1,074,791,424 derived items |
| `d1` | a `dial.grid@1`, `per_side: 1024` | 1,024 + 1,024² + 1,024³ = 1,074,791,424 derived items |
| `w1` | a `weave.mat@1` | 1,024 + 1,024² + 1,024³ = 1,074,791,424 list elements |
| 4,999 rects and `g1` | a `rows.sheet@1` | `g1.rows.0` … `g1.rows.1023` and each one's `.dot`: 2,048 derived items |

## What bounds each child

Every binary the tests start runs under `bounded.mjs`, one synchronous child of the test: it starts
`/usr/bin/time -l <binary> …`, writes the one line, and waits for one line back.

| Child | Answer deadline | Resident memory limit |
|---|---|---|
| `deep-show run` on a board of one instance (criteria 1 to 3) | 60 s | 1,024 MB |
| `deep-show run` on the 5,000-item board and on the castle (criteria 4, 7) | 300 s | 4,096 MB |
| `deep-gpu run` (criteria 5 to 7) | 120 s | 4,096 MB |

- The memory limit is a watch: the child's resident memory is read by PID (`ps -o rss=`) every 25 ms, since no
  `ulimit` holds on this macOS. In the probe a child taking 128 MB every 5 ms was stopped at a reading of 401 MB
  against a limit of 400, with a kernel peak of 717 MB: a child can pass its limit by what it takes between two
  readings, and no further.
- A child past its deadline or its limit is stopped by PID: `SIGKILL` to the process under `time`, never by name
  or port; `time` itself by PID if it hasn't ended 10 s later. The result says which limit stopped it.
- After its answer the child's input is closed and it has 15 s to end. The runner has a last deadline of its own,
  and the test bounds the runner.
- `/usr/bin/time -l` gives the kernel's own peaks for the child, stopped or not: "maximum resident set size" and
  "peak memory footprint". Off macOS both are null, never 0.
- The deadlines only bound a wait (`// deadline:` in the sources). They are long so that a loaded machine doesn't
  fail a program that is right; a child that had to be stopped fails its test on any machine.

## Criteria to tests

Each test's name starts with `AC<n> #1857.<id>`, a constant of its file, so the name reads whole from the source.
What fails each: the merge base, unless a planted program is named.

| Criterion | Tests | What they assert | Fails on |
|---|---|---|---|
| `AC1 #1857.b706b07a` | `cap.test.ts` (2) | `t1` and `f1` are each refused inside the child's limits by an `over_budget` error naming the instance, a step of the chain, the cap and the count, and then, on a fit reference Mac, five more children of each board have `timing.check_ms` under 1,000 and a peak memory footprint under 64 MB; the planted expansion runs out of time or memory on `f1` | the base: `t1` is refused with `bad_id`, no `over_budget`; `f1` is expanded until the child is stopped. `expansion_counts_after` |
| `AC2 #1857.2a469c19` | `cap.test.ts` (1) | `d1` is refused the same way, the issue naming `per_side`; the same two numbers | the base: `d1` is expanded until the child is stopped |
| `AC3 #1857.0972fd24` | `cap.test.ts` (1) | `w1` is refused the same way, its `path` holding `steps/mat/params/threads`; the same two numbers | the base: the list is made until the child is stopped |
| `AC4 #1857.df51c34e` | `budgets.test.ts` (2) | the 5,000-item board checks whole inside the child's limits (`g1` expands to exactly its 2,048 derived items, no `over_budget`), and then, on a fit reference Mac, five more children have `timing.check_ms` under 1,000; the planted expansion fails that budget | the base, which copies 5,000 items 1,024 times; `expansion_copies_items` |
| `AC5 #1857.812f8d12` | `looks.test.ts` (2) | the look is refused with `out_of_range` at `lines/nib/profile/breaks/every`, nothing drawn, the child ending by itself; the planted parser's child is still running at its 120 s deadline | the base, whose draw never ends; `profile_admits_zero_breaks` |
| `AC6 #1857.52aa8ad1` | `looks.test.ts` (1) | one child, given both looks, refuses each with `out_of_range` at `lines/nib/profile/overshoot` and `lines/nib/profile/flick`, answers both calls and exits 0 | the base, where one stroke is asked for 10^18 points |
| `AC7 #1857.5a457b1e` | `still.test.ts` (2) | every line profile of the shipped packs and looks and of the drawn-look fixtures is admitted and drawn; the castle has no `over_budget` and every instance of a composites recipe expands | passes at the base; a range that refuses a shipped profile; a cap under what the castle expands to |

"Refused the same way" (criteria 2 and 3) inherits from criterion 1: the child with a memory limit; refused at
check; `over_budget`; naming the instance, the cap and the count; in under 1 s; peak memory under 64 MB. It does not
inherit "the step where the count passes the cap": criterion 2 names the input and criterion 3 the param's path in
its place (Scope: "the step or param path"), and an issue has one `path`.

## Readings

- **Criterion 1's pack can't be expanded by any program.** The criterion's pack is written as it says: four
  recipes, each repeating 1,024 times, the last a mark. A repeating step's derived ID is
  `<instance>.<step>.<index>`, two segments a level, so the first mark of a four-recipe chain has nine segments,
  and an ID holds eight (`crates/deep-canvas/src/grammar/id.rs`). The base therefore refuses `t1` at once with
  `bad_id`, and so would any program that expands before it counts. The criterion is tested as written all the
  same: `t1` must be refused with `over_budget`, naming the instance, a step and the cap, which a program meets
  only by counting what the chain asks for before it makes or names any of it. The planted clause ("runs out of
  time or memory") can't be met on `t1`, so it is read on `f1`, the deepest chain whose IDs fit: the same pack's
  last three recipes, 1,074,791,424 derived items. The shipped program is held to the same check on `f1`, as a
  planted program's check must be one the shipped program passes.
- **"The step where the count passes the cap"** depends on the cap's value and on the order of counting, neither
  of which the issue fixes, so any step of the instance's chain is taken.
- **Criterion 3's value is written with `as`.** The criterion's `{repeat: {count: 1024, of: …}}` has no `as`. The
  base's grammar reads a `{repeat}` with no `as` as a plain map, not a list (`ListRepeat::of`), so that spelling
  asks for no elements in any program. The fixture adds `as: "a"`, `"b"`, `"c"` and nothing else. Whether a
  `{repeat}` without `as` is a list isn't this issue's and isn't tested.
- **Criterion 2's "input"** is the instance's `per_side`. Every recipe of the dial pack names its input
  `per_side`, so a refusal that names the nested instance's input and one that traces back to the document's both
  name it. "A nested step's repeat count" is read both ways at once: the count of the instance's own step, which
  nests a recipe, and of the steps of the nested recipes.
- **"In under 1 s"** is the check's own clock, `timing.check_ms`, as #306's budget reads a check: a process start
  loads fonts and the look, which are no part of "at check". A child that never answers is caught by its deadline,
  not by this number.
- **"Peak memory under 64 MB"** is the child's peak memory footprint as `/usr/bin/time -l` reports it, against
  64 × 2^20 bytes. The design's memory rows name "the process's physical footprint"; the other reading, maximum
  resident set size, was about 120 MB for a `deep-show run` that refuses a small document at the base, by the
  caller's reading of the base's binary (this job ran none), which no program could bring under 64 MB, while its
  footprint was about 56 MB. Both are in the runner's result.
- **Where a number counts.** The design counts a time or a peak only on a reference Mac on mains power, Low Power
  Mode off, thermal state nominal, at a load under its cores, from five runs after a warm-up. Each test of criteria
  1 to 4 therefore has two parts in one test, so that no criterion reads as proven on half of its words: first what
  holds on any machine (the refusal or the whole check, and that the child was never stopped), which fails the test
  wherever it fails; then the numbers, over five more children. Where the numbers don't count the test ends
  INCONCLUSIVE after its first part: a skip that says so, never a pass. The two planted tests of time are the
  same; the planted test of criterion 1 holds on any machine, since a child that had to be stopped is not a time.
- **"Compared with the merge base"** (criterion 4) is the budget window's comparison, on a task of
  `benchmarks/budgets.json` that names the criterion (parallel-proof 12a, Reading rule). This suite's test reads
  the criterion's own number on the debug binary the tests build, as the base's budget files do.
- **Criterion 4's board is a 2D board** and isn't required to be presented: at the base no board with a nested
  recipe step draws (#1957's README: What the base already does), which isn't this issue's. "Checks" is read as:
  the check ran whole, with no `over_budget`, and `g1`'s expansion holds exactly its 2,048 derived items.
- **"Hangs … past 5 s"** (criterion 5) is read on the child's 120 s deadline: a child still running then is past
  5 s. A shorter deadline would fail a right program on a loaded machine, where `deep-gpu` takes seconds to open
  the GPU.
- **"The process stays up"** (criterion 6): one child is given both looks, answers both calls and ends by itself
  with exit 0.
- **A look is checked through `deep-gpu run`'s `layers`**, which resolves the look and then draws: the one built
  binary through which a refused look answers and an admitted one reaches `profiled`. The issue names "the process
  that checks or draws it".

## Criterion 7: what is held, and by what

"Still" is against the base. This job could run nothing at the base and records nothing from a run.

- **What these tests add** (`still.test.ts`): the two new refusals leave shipped data alone. (1) Every line
  profile under `packs/`, `crates/deep-canvas-marks/looks/` and the fixtures of #149, #417 and #1561 is admitted
  and drawn on this suite's figure. At the base that is five profiles: three in `packs/art-1.0.0/pack.json`, one in
  #1561's `look.json`, and #149's `families/profiles.json`, the only one that sets `breaks` (every 240, gap 6),
  `overshoot` (6) and `flick` (14); the test fails if none sets all three. (2) The castle
  (`packs/examples/castle.json`, 134 items, 11 instances of `deepbuild/composites@1.0.0`'s recipes) has no
  `over_budget` and each of those instances expands.
- **What stays with the Proof**: "the same derived items and keys" and "the same pixels" are pinned by the base's
  own suites and goldens, which the work may not edit and which must keep passing (design: Closed issues stay
  proven): among them #306 (expansions, keys and seeds of a test pack), #2015 and #1957 (repeats over elements,
  nested steps), #422, #485, #1719 and #1720 (the castle: its goldens, its inputs, its render-back), #149 (the
  drawn-look family fixtures against their goldens, `profiles` among them), #417 (the shipped looks), #161 and
  #1436 (the fx and studio packs). This job did not audit each of those files; `node scripts/affected.mjs` on the
  change selects them.
- **Not held by any test here**: the pack check of each of the 21 pack folders, one by one; a comparison of
  expansions or pixels before and after the change. A recorded golden of this suite would have to come from a run
  of the base, which this job couldn't make.

## Not asserted

- The cap's value, beyond what the tests imply (at least 1,024; the castle and `g1`'s 2,048 derived items under it;
  `f1`'s 1,074,791,424 over it), and that a count just under the cap is admitted and one just over refused: no
  criterion says so.
- Which count `actual` holds, the order of counting, and "counted before each step or list allocates" as such
  (Scope): they are read only through the child's time, peak and limits.
- "A nested recipe step reads the document's items without copying the whole map" (Scope) as such: read only
  through criterion 4's time and its planted program.
- The maximum of `overshoot` and `flick`, and that the Look section states it (Scope): criterion 6 gives only
  `1e18`. A negative `overshoot` or `flick`, a negative `every` or `gap`, `gap: 0` with `every` above 0, and
  `lines/<name>/profile/breaks/gap` as a path: no criterion names them.
- A look's refusal through `deep-show` (a look by its asset's hash), through `deep-canvas-render check` or in a 3D
  scene: neither binary was built, and no criterion names a path.
- The wording of any `what` or `fix`.
- A `{repeat}` list in a recipe's `let`, a repeat `over` a list, `along` a curve or over a part's elements, and
  lights or emitters against the cap.

## What the implementer adds outside the folder

- `docs/canvas-primitives.md`: the cap, in the Recipe section, on the line of `at most 1,024 per repeat`, after
  those words, in digits (The surface under test). The maximum of `overshoot` and `flick`, in Look `look@1`: line
  profiles (no test reads it).
- The three planted names (Planted programs).
- `scripts/lanes-lists.mjs`: `timed.push('tests/acceptance/1857/cap.test.ts', 'tests/acceptance/1857/budgets.test.ts');`
- `benchmarks/budgets.json`: a task whose `criteria` names `#1857.df51c34e`, for the budget window.
- Nothing else: no `[[test]]` entry, no lane list beyond `lane.json` here, no twin.

## What was checked without a build

- `node node_modules/typescript/bin/tsc -p tests/acceptance/1857/tsconfig.json`: no error.
- Every judge of `judge.ts` against planted inputs, and `bounded.mjs` against node children (one that answers, one
  that hangs, one that takes memory, one that dies): each judge passes a good input and fails each wrong one,
  naming what its criterion names; a hung child and a child past its limit are stopped by PID and gone.
- Each test's name, read as the lanes read it (`scripts/proof-change.mjs`: `spans`, `tagsIn`): 11 tests, each with
  one tag.
- Not checked: anything a binary answers.

## Files

- `cap.test.ts` (criteria 1 to 3), `budgets.test.ts` (4), `looks.test.ts` (5, 6), `still.test.ts` (7): the tests.
- `cases.ts`: the boards of criteria 1 to 4 and the check each is held to.
- `judge.ts`: the judges, with no process and no test runner in them.
- `helpers.ts`: the builds, the bounded child, the scenario, documents and calls, the machine gate.
- `bounded.mjs`: the runner that holds one child to a deadline and a memory limit.
- `fixtures/`: the four packs and the look. `lane.json`, `tsconfig.json`, `BASE-FAILURE.txt`.
