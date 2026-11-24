# Blind redraft of #490's criteria, for the closed-issue sweep (#2047)

This folder is `tests/acceptance/490/redraft-2047/`; its twins are `tests/acceptance/490/twins.json` and
`tests/acceptance/490/twins/`. It adds files only; no earlier file of `tests/acceptance/490/` is changed.

Issue #490, "The closed function list: interval forms, function tables, math functions and ease@1 in the core". Its
implementation is on main; its earlier blind suites (`tests/acceptance/490/`, `490-redraft-2/`, `490-oracle/`,
`490-oracle-redraft/`) name their tests "criterion N", which the proof lanes don't read, so the sweep (#2047) reopened
it. This folder names every criterion by its ID and gives each a planted twin. The implementing agent doesn't edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- **The issue**, #490, body only (`gh issue view 490 --repo windoliver/deepbuild`): its Scope, Fields, twelve criteria
  and Proof line. No comment's links, no pull request and no diff were opened. The IDs are the first eight hex digits of
  the SHA-256 of each criterion's whitespace-collapsed text, as given to this job.
- **The design and rules**: AGENTS.md; `docs/technical-design.md` (Dogfooding, Tests written first, The reference Macs);
  `docs/canvas-primitives.md` (The closed function list, Driver: tables, Channel and key: table eases, Registry and seal:
  registries, Path function).
- **The checkout** at `ccafae68f` (current main, a fresh clone): the sources the twins change
  (`crates/deep-canvas/src/{ease,interval,table,expr}.rs`, `expr/noise.rs`, `registry/{mod,core_lists}.rs`,
  `crates/deep-canvas-motion/src/{modifier,module,program}.rs`, `crates/deep-show/src/main.rs` and `Cargo.toml`), and
  `scripts/proof-runs.mjs` (how twins are laid and what failing at an assertion means). No `git log`, `git show` or
  `git blame` of the implementation, no other branch or worktree.
- **The earlier blind suites** for #490, and `tests/acceptance/689-redraft-2047/` and `1111-redraft-2047/` for the
  sweep layout.

## Run

```sh
npm ci && npm run build --workspaces     # once, in a fresh clone
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/490/redraft-2047 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/490/redraft-2047/tsconfig.json   # type-check (exits 0)
```

Each file builds what it drives once, in `beforeAll`, through the earlier suite's helpers (`../helpers.ts`,
re-exported by `helpers.ts`): `cargo build --locked --bin deep-motion` and/or `cargo build --locked --bin deep-show
--no-default-features --features <set>` (`core`, `full`, `full,test-leave-out-motion`,
`full,test-leave-out-motion,test-ease-in-motion`, `full,test-ease-renumbered`). `opening.test.ts` also exports the merge
base (`git merge-base HEAD origin/main`) with `git archive` into `target/acceptance-490-redraft-2047-base/<sha12>/` and
builds its `full` there with its own target folder (a cold build the first time; the folder is kept so later runs and
APFS clones of the checkout build warm). The files build cargo binaries and run for minutes, so they run one at a time;
the folder sits under `tests/acceptance/490/`, which `scripts/lanes.mjs` already runs alone. Every test passes a 30-minute timeout. Fixtures come from the earlier suites (`../fixtures/packs/`,
`../../490-redraft-2/fixtures/eased.json`). Delete `node_modules/.vite` in this folder after a run; it isn't the suite's.

## Criteria to tests

One test per criterion, so every part of a criterion, its planted program included, stands or falls together, and a twin
that undoes any part fails the criterion's only test. Each test's name starts with its ID.

| ID | Criterion (short) | File | What the test asserts |
|---|---|---|---|
| `#490.dfa2703b` | Every closed ease holds its identities in f64 | `ease-identities.test.ts` | `core` build (no motion): ease@1 lists all 38 closed names as first-party entries; through the `fn` call each reads exactly 0 at 0 and 1 at 1, each in_out ease e(x) + e(1 − x) = 1 within 1e-12 at the 1,001 points, each monotonic family (all but back, elastic, bounce and running_start) never decreases over them |
| `#490.ac6f64d6` | Opening ease@1 changes no key, golden or corpus snapshot; listed; renumbering plant fails | `opening.test.ts` | `full`: ease@1 listed as the core's, with `since`, digest, `fill` holding `pack`, each closed ease first-party from the core with since, digest and a PASS on every kit rule, the installed `epack.dip` with origin pack, planted entries FAIL. Every fixture of the merge base's manifest plus the eased board, at 0, 0.5 and 1.5 s: each `eval` node's key and bytes, each presentation's outcome and issues, each Vello CPU golden, each `corpus_record` file's document, times, values and snapshots equal the merge base's. `full,test-ease-renumbered` fails that comparison with a failure naming `in_out_cubic`, `item eased-box` and a changed content key. Then, off a reference Mac, INCONCLUSIVE (below) |
| `#490.328160a4` | Seeded counterexample search finds none; planted sin fails on [0, 3] | `interval-search.test.ts` | 119 expressions (every number-valued function of the closed list, in five groups, and every closed ease): 10,000 seeded ranges each (ranges across jumps, poles and extrema first), 1,000 seeded points per range, no point value outside its range's bound, no unbounded or estimated bound off a pole; five ranges per function recomputed through `at` (extremes equal, values within 1e-9 of an f64 reference where JavaScript has one); `sin_bounds_by_ends` bounds [0, 3] below 0.15 while a point near π/2 reads above 0.9999, failing the check naming `range [0, 3]`, while the real form holds there; outward rounding: 0.1 + 0.2 and 0.1 × 3 over a degenerate range hold the real 0.3000000000000000166…, sin over [1, 1] is widened past its point value, each within 1e-12 |
| `#490.040cdb41` | Linear table 0,1,2,4 → 0,1,1.5,1.75; plant extrapolates; monotone stays between knots | `tables.test.ts` | `table(fnpack.ramp, x)` reads exactly 1.625, 0, 1.75 at 3, −1, 5; its form over [0.5, 3] encloses [0.5, 1.625] within one ulp at each end; `table_extrapolates` reads 1.875 at 5 and fails the read check naming `fnpack.ramp`; a monotone table's 1,000 samples between each knot pair stay between their values, and aren't the linear table's |
| `#490.085831ca` | Table refusals: index 2, the NaN's index, the cap | `table-refusals.test.ts` | Through `deep-motion eval`, a driver's table: x 0, 2, 1 refused with `index: 2`; a NaN at y[1] (data-asset f64 bytes) refused with `index: 1`; 4,097 points refused with `cap: 4096`; each naming `tpack.t`; a well-formed table accepted |
| `#490.b9d53cc8` | Ease table with overshoot keys a channel; refusals name the key, knot 1, the endpoint | `ease-tables.test.ts` | `epack.dip` keys 0 → 100: −10 at 0.3 s; under [−20, 100] accepted with `bounds.channels.ch` = [−10, 100] within 1e-9; under [−5, 100] refused naming the key `lead` and −10; `overshoot: none` refused with `knot: 1`; ending at 0.98 refused with `endpoint: 1`; each naming `epack.dip` |
| `#490.469d61b8` | A sweep over drag's declared range bounds table(drag, speed); plant samples 8 and fails | `table-sweep.test.ts` | Slider `drag` [0, 40] carried by four test-writer entries (5, 9, 25, 33); driver `coef` = `table(dpack.drag, speed)`: bound [0.2, 1.4] within 1e-9 (the peak knot at 13, which no entry reaches), and the hard range [0, 1.3] refused naming `coef` and 1.4; `table_form_samples_8` fails that fixture naming `driver coef`, understating the bound |
| `#490.cba8d943` | sinc path fn; sinc's form near 0; Taylor sum; cpow; refused calls | `math.test.ts` | A path@1 with `fn: {y: "sinc(x)", over: [-10, 10]}` is presented with no notice naming it and the `path` call gives one sub-path spanning [−10, 10] and no notice; sinc over [−1e-9, 1e-9] within [0.99999999, 1], `sinc_as_sin_over_x` unbounded and failing; the Taylor sum with n a slider [0, 19] set to 19 by a test writer's entry within 1e-12 of sin x at 1,000 seeded x in [−6, 6] (and x without the entry); cpow(z, 2) within 2 ulp of (x·x − y·y, 2·x·y) at 10,000 seeded points; `factorial(171)`, `factorial(2.5)`, `sum(k, 0, 256, x)` refused naming the function and its argument, `factorial(170) + sum(k, 0, 255, x)` accepted |
| `#490.220e8248` | rush_in, running_start, exp_decay, pulse; plant leaves 1e-6 | `new-eases.test.ts` | rush_in(10) within 1e-12 of 2·sigmoid10(x ÷ 2) at 1,001 points; running_start(−0.5)'s least sample −0.1848 ± 1e-4 within 0.01 of x = 0.29, its 0 → 100 channel refused under [−18, 100] naming the key `pull` and −18.476, accepted under [−18.5, 100] with a bound enclosing −18.4761522 within 1e-6; exp_decay(0.1) 0.6321 ± 1e-4 at 0.1; the pulse exactly 1 at 0 and 1 s and 1.2 at 0.5 s; `pulse_leaves_residue` reads 1 + 1e-6 at 1 s and fails naming `channel sc` |
| `#490.cf56a3e3` | Without motion, ease(in_out_cubic, x) in a kind rule and a path fn reads as in full; plant refuses | `without-motion.test.ts` | `full,test-leave-out-motion` seals without motion and lists ease@1 as the core's; the 1,001 probe instances of `easepack.probe@1` pass `easepack.matches` and only `bad` (1e-6 off) fails it, in `full` and without motion; the path fn's 1,001 points are equal bit for bit in both, each within 1e-6 of in_out_cubic; `full,test-leave-out-motion,test-ease-in-motion` answers a `module_missing` naming motion and the rule check fails |
| `#490.474ad338` | noise's and fbm's forms hold over 10,000 ranges; 10 × fbm driver's bound; plant samples 8 | `noise.test.ts` | Searches over `noise(x, 7)` and `fbm(x, 7, 6, 0.5)`: 10,000 ranges in [−100, 100], 1,000 points each, none outside; five ranges recomputed (extremes equal, values varying); the driver `10 * fbm(t, 7, 6, 0.5)`'s bound equals the `fn` call's form of the same over [0, 6] within 1e-9 relative, its own bound as hard range passes and one 1% inside is refused naming `d`; `noise_form_samples_8` fails both searches, naming the range and the point |
| `#490.e727fb3a` | back_out {overshoot: 2.6} is the Bézier; bounce_out params; the ball drop | `param-eases.test.ts` | out_back {overshoot: 2.6} within 1e-12 of the Bézier (1/3, 28/15, 2/3, 1) at 1,001 points, its peak 1.2009 within 1e-4 of x = 0.5185 on 10,001; `back_ignores_params` peaks at 1.1000 and fails naming `key rise`; out_bounce's defaults within 1e-12 of the four-arc bounce; the 190 u drop with {restitution: 0.56, bounces: 5} touches the floor at 0.5472, 1.0481, 1.3286, 1.4857 and 1.5736 s within 0.1 ms, stands 59.584 ± 0.01 u at 0.7977 s where the default stands 36.54 ± 0.01 u; its bound within [0, 190] and the hard range [0, 190] passes |

The surfaces, names and readings the tests use (the `fn` and `path` calls of `deep-show run`, `deep-motion eval`'s
`packs` and `bounds`, the planted names, `back_out` read as ease@1's `out_back`, "declared monotone" as `overshoot:
none`, and the rest) are the earlier blind suite's, unchanged; its README ("The surface under test", "Choices where the
issue is open") explains each. The checks themselves are the earlier suites' too, gathered one test per criterion; what
is new here is the naming, the grouping, the GPU split of `#490.ac6f64d6`, and the twins.

## What reads INCONCLUSIVE, and where

- **`#490.ac6f64d6`, the GPU half** (reached only once the rest holds, which it doesn't on main: below). A golden on the `gpu` backend is drawn by the GPU, and a GPU draw counts only on a
  reference Mac (docs/technical-design.md, The reference Macs: hw.model Mac15,7, Mac15,12 or Mac17,10). On one, the
  test compares every fixture's `gpu` golden with the merge base's too and can pass. Anywhere else (this job's machine
  is a Mac18,1) the test compares everything else, all of which must hold, and then skips with a reason starting
  `INCONCLUSIVE:`; it never passes there. On a wrong program it fails at an assertion before that point. No other test
  draws pixels: presentations ask for issues only, goldens run on Vello CPU, and corpus snapshots are Vello CPU's.
- Nothing else needs a GPU, pixels or a timed budget. The criteria name no time limit.

## On main (`ccafae68f`): `#490.ac6f64d6` fails, for one fixture

Eleven tests pass on main. `#490.ac6f64d6` fails at its comparison (`opening.test.ts`, the `none` on "the opening
against the merge base"), with 27 failures, all in one shipped fixture, `parity/logic/readers.board` (added after
#490, by #2363): node `logic.step|-` and the nodes downstream of it (`motion.flip|dot`, `text.*|caption`,
`text.copy_columns|labels`, `marks2d.*`) answer another content key at 0, 0.5 and 1.5 s than the merge base's build of
the same commit. The same binary gives that fixture a different key on every run with the same scenario, while the
bytes the nodes write are equal, so the key isn't a pure function of the fixture there. Every other shipped fixture, the
eased board, every Vello CPU golden and corpus file compared equal, and the listing passed. The test is written as the
criterion states it; that fixture is not left out or special-cased, so the criterion reads FAIL on main until that key
is stable. Because the test stops at that comparison, its planted-opening part and its GPU skip aren't reached on main.

## Twins

`../twins.json` (`tests/acceptance/490/twins.json`, where `scripts/proof-runs.mjs` looks for a suite's twins, by its
top folder) maps each ID to one twin in `../twins/` (a full copy of one source file, changed only to undo that
criterion's behavior); `../twins/README.md` says what each undoes. With a twin laid over the checkout, every test naming its
ID fails at an assertion; `RUNS.txt` records each run.

## Scope not under a criterion

As the earlier suite's README says: interval forms of key interpolations and of clip and bake samplers, noise3 and cells,
elastic's params, a sum's term past a var bound, estimates refusing a check that needs their bound, tables from data
assets by hash in `assets` and from `fn.table@1`, table eases read by `ease(name, x)` in a driver, and a GPU step never
reading a table. No criterion states an observation for them, so no test here reads them.

## The Oracle lane

The issue's Oracle line maps upstream tests for 4 of the 12 criteria, run against our output (#136). This job didn't
open that page (it reads the issue's body only) and runs no upstream test; `tests/acceptance/490-oracle/` and
`490-oracle-redraft/` are the earlier blind work on that lane.
