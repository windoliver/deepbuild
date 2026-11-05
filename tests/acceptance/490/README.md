# Acceptance tests for #490: the closed function list: interval forms, function tables, math functions and ease@1 in the core

Written first, from issue #490 (its Scope, its Fields, its twelve acceptance criteria and its Proof line: "The seeded
counterexample search, the outward-rounding fixtures, the table and ease-table refusals, and the build without
motion"), the design sections it names and those they lean on, and base commit `69803b94` ("Merge pull request
#1021 …"), by a job that never saw an implementation; none existed, and no other worktree or branch was read. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding).

## What was read

- The issue, read live with `gh issue view 490 --repo windoliver/deepbuild`.
- Its Oracle page, `doneright/oracles/issues/490.md` on branch `doneright` of `DeepBuildAI/deepbuild`: **not
  reachable** from this job. `gh api repos/DeepBuildAI/deepbuild/...` answers 404 for the account this box is
  logged in as (JingW6, `repo` scope), for the file, the branch and the repository alike. The issue says the page
  maps upstream tests, pinned by commit, for 4 of 12 criteria; which four, and which tests, this job could not see.
  See "Upstream tests (the Oracle lane)".
- `docs/canvas-primitives.md` at the base: The closed function list (5967: the table, the interval-form paragraph,
  sinc's removable singularity, sums and their caps, "It can never"); Driver (5348), Driver: time offsets, Driver:
  tables (5384); Channel and key (5262: the ease list, `modifiers` with `pulse {at, span, amount, shape}`, "A pulse
  adds amount × shape(u) … exactly 0 at both ends"), Channel and key: table eases (5314); Registry and seal:
  registries (1078); Registries and closed lists (1245: the Eases row, "planted: an ease that reads 0.999 at 1";
  the closed function list row, "closed: interval forms"); Path `path@1`: function (1583: `fn`, `samples`, the 512
  node cap, "draws from its samples as an estimate, with a notice"); Pack: kind rules and the kind kit (3310);
  Control sweep (8740); Paint: noise fill and the Seeded row for noise.
- `docs/technical-design.md`: the canvas core and its module table; Dogfooding; Tests written first.
- At the base: AGENTS.md; `crates/deep-canvas/src/ops.rs` (the one ops module on libm); `crates/deep-canvas/src/
  document/packs.rs` (the recipe expression parser: `+ - * / %`, `min max floor ceil round abs` only; packs'
  `entries`, `module_missing` for a pack whose module the build lacks); `crates/deep-canvas-motion` (`ease.rs`: the
  base's 38 first-party ease names, rush_in, rush_out, double_sigmoid, running_start and exp_decay already among
  them, back/elastic/bounce without params; `doc.rs`: keys, `{ease: {name, params}}`, controls, drivers;
  `program.rs`: the driver ops, `range_check` covering springs and Béziers only); `crates/deep-motion/src/main.rs`
  (the `eval` line and #489's plants); `crates/deep-show` (`run`, the calls, the build sets and `test-*` features,
  `test-leave-out-data` as the precedent for leaving a module out); the earlier blind suites `tests/acceptance/489/`
  (layout, helpers, the eval-line plants), `200/` (registries, the planted renumbering opening, the merge base built
  apart), `411/` (pack fixtures and boards), `138/` (`corpus_record`).
- Probes of the base build (`deep-show run` with `registry`, `registries`, `fixtures`, `deep show`, `eval` and
  `corpus_record`; an unknown call `fn`) to learn the shapes those calls answer. At the base there is no ease@1, no
  `fn` or `path` call, and an unknown call refuses the whole scenario with `bad_input`.

## Run

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/490 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/490/tsconfig.json   # type-check (exits 0)
```

`--root` keeps the repo's `vitest.config.ts` out; a root with no config of its own uses Vitest's defaults. It leaves
Vitest's cache in `tests/acceptance/490/node_modules/.vite`; delete it, it is not part of the suite.

Each file builds what it drives once, in `beforeAll`, honoring `CARGO_TARGET_DIR`, and copies it out under its own
name: `cargo build --locked --bin deep-motion` and/or `cargo build --locked --bin deep-show --no-default-features
--features <set>` for each set it lists (`core`, `full`, `full,test-ease-renumbered`, `full,test-leave-out-motion`,
`full,test-leave-out-motion,test-ease-in-motion`). `opening.test.ts` also builds the merge base (`git merge-base HEAD
origin/main`, exported with `git archive` into `target/acceptance-490-base/<sha>/` and built there with its own
target folder, kept so later runs build warm), only after the candidate's listing check passes. Every test of a file
fails when its build fails. The files build cargo binaries and the searches run for minutes, so they run one at a
time: `scripts/lanes.mjs` needs `'tests/acceptance/490/'` added to its `alone` list (this job writes only this
folder; the implementer makes that edit). Every `it` passes `TIMEOUT` (30 min). Evidence folders go under the OS
temp folder and are deleted. Node built-ins and vitest only.

## The surface under test

The issue names functions, fields and checks but no code API, so these tests extend the surfaces #391/#489
(`deep-motion eval`) and #200/#387/#138 (`deep-show run`) left, add no binary and no subcommand, and read nothing
else. **Every name below that the issue or the design doesn't give is this job's choice** (each is listed again under
Choices), the smallest surface consistent with the design and the base; the implementer builds exactly these, or a
dispute goes to a blind redraft.

### `deep-show run`: the call `fn` (new; any build set, `core` included)

The core's closed function list, read as a check reads it: one expression, its point form at points, its interval
form over ranges, and the seeded search that pairs them.

```
{"call": "fn", "expr": string,
 "context"?: "driver" | "field" | "path",        // the cap a sum counts against: 64 ops, 256 or 512 nodes; default "path"
 "vars"?: {name: "controls/<id>/value"},          // a var bound to a control; its declared max is the control's range
 "controls"?: {id: control},                      // #489's control form: {kind: "slider", class, label, range, default}
 "input"?: [{t, seq, control, value, writer}],    // input-track entries appended before the read (Input track: entries)
 "packs"?: [{name, tables?: {name: table}, entries?: {"ease@1": [entry]}}],   // as a pinned pack's pack.json holds them
 "at"?: [x | {name: number}],                     // points: a number binds x; an object binds each named free variable
 "over"?: [[a, b]],                               // ranges of x
 "search"?: {"ranges": [[a, b]], "points": n, "seed": s},
 "planted"?: string}
```

The free variable is `x` (or the names an `at` object gives). Answers, one reply per call:

- `at` → `{"values": [number | [number, …] | null]}`, one per point: a number, a vector (vec2 for complex) as an
  array, or null where the value isn't finite.
- `over` → `{"bounds": [{"lo": number | null, "hi": number | null, "estimate"?: true}]}`, one per range: the interval
  form, null at an unbounded end, `estimate: true` where the forms can't settle the range within the check's budget.
- `search` → `{"search": [{"lo", "hi", "estimate"?, "min": {"x", "y"} | null, "max": {"x", "y"} | null}]}`, one row
  per range in order: the interval form over the range, and the least and greatest finite values the point form gives
  at the range's `points` seeded points, with their x (null when none is finite). Range i's points are x_j = a + (b −
  a)·u_j for j = 0 … points − 1, the u_j successive draws of mulberry32 seeded with (seed + i) mod 2³², exactly as
  `helpers.ts`'s `seeded` computes it (`a += 0x6d2b79f5; t = imul(a ^ a >>> 15, a | 1); t ^= t + imul(t ^ t >>> 7, t |
  61); (t ^ t >>> 14) / 2³²`, all 32-bit), so the tests recompute any range's points and read them through `at`.
- A refused expression (a check refusal) → a reply with a string `code` and none of `values`, `bounds`, `search`; it
  names the call (the function and its argument), as `factorial(171)` names `factorial` and 171.
- `packs` and `entries`: a function table is `{x: [f64], y: [f64], mode?: "linear" | "monotone"}`; `x` or `y` may
  instead be `{"f64": "<base64 of little-endian f64s>"}`, the bytes a data asset holds, so a NaN can reach the check
  (JSON has no NaN). It's read as `table(<pack>.<name>, x)`. An ease@1 entry is `{name: "<pack>.<name>", x, y, mode,
  overshoot: "none" | [min, max]}`, read as `ease(<pack>.<name>, x)` or a key's `{ease: {table}}`.
- Functions the tests write that the design leaves unspelled: `fbm(p, seed, octaves, gain)` and `noise(p, seed)` over
  a scalar p; swizzles `.x .y .z` after any vector-valued call; `^` as power; `pi` and `tau`; `x == 0.5` and the other
  comparisons and `&& || !` reading 1 or 0.

### `deep-show run`: the call `path` (new)

`{"call": "path", "doc", "item", "t"?}` → `{"item", "subpaths": [[[x, y], …], …], "notices": [notice]}`: the item's
drawn path at t (default 0) as the presented document draws it, in the item's own units, one array per sub-path, and
the notices its drawing raised (an estimate's notice naming its x range). For a path@1 with `fn: {…, samples: n}`
the one sub-path holds n points at x = a + (b − a)·i ÷ (n − 1).

### `deep-show run`: existing calls

`registries` (#200) lists `ease@1` (`owner: "core"`, `fill` including `pack`, `since`, `digest`, `kit`, `planted`,
`entries`, each entry with `origin`, `module`, `since`, `digest`, `kit`); `registry` names the build's `modules`;
`fixtures`, `deep show`, `eval` (nodes with `key` and `result`) and `corpus_record` (the written file's `values` and
`snapshots`) as at the base; the scenario's `packs` installs fixture packs at start. A path@1 item takes `fn` in place
of `d` (Path: function). A pack kind (a recipe) takes `rules: [{code: "<pack>.<rule>", expr, at: "rest", fix}]` and,
for the kind kit's planted twin per rule, `twins: [{params, expect: code}]`: the params of an instance that must fail
that rule (README: Choices). The core's `kind_rules` check raises each failed rule as an issue `{code, ids: [the
instance]}` in the `deep show` reply's `issues`.

### `deep-motion eval` (#391's and #489's lines, extended)

New on the input line:

- `packs: [{name, tables?, entries?}]`: as the `fn` call's, the pack tables and ease@1 entries a pinned pack would
  give the document.
- `bounds: true`: the answer gains `bounds: {channels: {id: {lo, hi, estimate?}}, drivers: {id: {lo, hi,
  estimate?}}}`, each channel's and driver's value bounded by the interval forms over the document's span and every
  control's declared range (Control sweep), the bound the hard-range check reads.
- `planted`: also `table_form_samples_8`, `pulse_leaves_residue`, `back_ignores_params` (Planted programs).

New in documents:

| Field | As the tests write it |
|---|---|
| Ease with params | key `interp: {ease: {name: "out_back", params: {overshoot: 2.6}}}`, `{name: "out_bounce", params: {restitution, bounces}}`, `{name: "rush_in", params: 10}` (a number for the one-param eases, as at the base) |
| Ease table | key `interp: {ease: {table: "<pack>.<name>"}}` |
| Pulse | channel `modifiers: [{pulse: {at: time, span: time, amount, shape: "there_and_back"}}]` |
| Driver hard range | driver `range: [min, max]`, checked against the driver's bound |
| Driver vars | `controls/<id>/value` (the control's value, swept over its declared range), `time` (seconds), an item path |
| Driver functions | `table(<pack>.<name>, x)`, `fbm(t, seed, octaves, gain)` and the rest of the closed list |
| Control | `controls: {id: {kind: "slider", class: "document", label, range, default}}` (#489's) |

Refusals stay `{ok: false, code, …}` (#391); the tests read their whole JSON, and these members by name anywhere in
it: `index` (a table's offending index), `cap` (4096), `knot` (an ease table's offending knot), `endpoint` (1 for the
end x = 1 an ease table misses).

### Test features of deep-show

| Feature | The build |
|---|---|
| `test-leave-out-motion` | the set's list without the motion module (as #489's `test-leave-out-data`); it seals |
| `test-ease-in-motion` | planted layout: ease@1 declared by the motion module instead of the core (with `test-leave-out-motion`, a build with no ease@1) |
| `test-ease-renumbered` | planted opening: ease@1's first entries renumbered, so a channel keyed with in_out_cubic gets another content key |

### Planted programs

| Name | Where | Criterion | The wrong program |
|---|---|---|---|
| `test-ease-renumbered` | deep-show feature | 2 | an opening that renumbers the entries |
| `sin_bounds_by_ends` | `fn` `planted` | 3 | sin's interval form bounds a range by its values at its ends alone |
| `table_extrapolates` | `fn` `planted` | 4 | a table sampler that extends its end segments past the ends |
| `table_form_samples_8` | eval `planted` | 7 | a table's interval form that samples 8 points between knots |
| `sinc_as_sin_over_x` | `fn` `planted` | 8 | sinc's interval form computed as sin(x) ÷ x |
| `pulse_leaves_residue` | eval `planted` | 9 | a pulse that leaves 1e-6 at its end |
| `test-ease-in-motion` | deep-show feature | 10 | ease@1 declared in the motion module |
| `noise_form_samples_8` | `fn` `planted` | 11 | noise's and fbm's interval forms from 8 samples of the range, their least and greatest |
| `back_ignores_params` | eval `planted` | 12 | out_back with its fixed 1.70158, ignoring `overshoot` |

## Criteria to tests

Each test's name starts with `criterion <n>`.

| Criterion | File | What it asserts, and the wrong program each fails on |
|---|---|---|
| 1 | `eases.test.ts` (2) | `core` build: ease@1 holds every closed name (the base's 38) as a first-party entry; through `fn`, each reads exactly 0 at 0 and 1 at 1, each in_out ease e(x) + e(1 − x) = 1 within 1e-12, and each outside back, elastic, bounce and running_start never decreases over the 1,001 samples |
| 2 | `opening.test.ts` (3) | ease@1 listed: owner core, `since` R*n*, digest, `fill` with `pack`; each closed ease first-party, module core, since, digest, kit PASS on every rule; the installed `epack.dip` with origin pack and kit PASS; planted entries FAIL. Every shipped fixture of the merge base and this suite's eased board: every node's content key and written bytes at 0, 0.5 and 1 s and `corpus_record`'s values and snapshots equal the merge base's; `test-ease-renumbered` fails that check, a failure naming `ease in_out_cubic` and `item knob` |
| 3 | `interval-search.test.ts` (7) | five groups (arithmetic and logic; powers and angles; hyperbolic and special; interpolation, vectors, sums, hash and every ease; complex as vec2), 119 expressions: 10,000 seeded ranges each (named ranges across jumps, poles and extrema first), 1,000 seeded points each, no point value outside its range's bound, no unbounded or estimated bound off a pole; five ranges per function recomputed through `at`, their extremes the search's, their values within 1e-9 of an f64 reference where JavaScript has one; `sin_bounds_by_ends` on [0, 3] bounds below 0.15 while a point reads above 0.9999 near π/2, and the check fails naming `range [0, 3]`; outward rounding: 0.1 + 0.2 and 0.1 × 3 over a degenerate range hold the real 0.3000000000000000166… (lower end at most the f64 below 0.30000000000000004), sin over [1, 1] widened past the point value on both sides, each within 1e-12 |
| 4 | `tables.test.ts` (3) | `table(fnpack.ramp, x)` reads exactly 1.625, 0 and 1.75 at 3, −1 and 5; over [0.5, 3] encloses [0.5, 1.625] within one ulp at each end; `table_extrapolates` reads 1.875 at 5 and the read check fails naming `fnpack.ramp`; a monotone table's 1,000 samples between each knot pair stay between their values, and differ from the linear table somewhere (fails a monotone mode that is linear) |
| 5 | `table-refusals.test.ts` (1) | a driver's table with x 0, 2, 1 refused with `index: 2`; a NaN at y[1] (f64 bytes) refused with `index: 1`; 4,097 points refused with `cap: 4096`; each naming `tpack.t`; a well-formed table accepted |
| 6 | `ease-tables.test.ts` (3) | `epack.dip` keys 0 → 100: −10 at 0.3 s, accepted under [−20, 100] with `bounds.channels.ch` = [−10, 100] enclosing, within 1e-9; under [−5, 100] refused naming the key `lead` and −10; with `overshoot: "none"` refused with `knot: 1`; ending at 0.98 refused with `endpoint: 1`; each naming `epack.dip` |
| 7 | `table-sweep.test.ts` (2) | control `drag` [0, 40] carried by four test-writer entries (5, 9, 25, 33); the driver `coef` = `table(dpack.drag, speed)`: its bound [0.2, 1.4] within 1e-9 (the peak knot at 13, which no entry reaches), and under the hard range [0, 1.3] refused naming `coef` and 1.4; `table_form_samples_8` fails that fixture naming `driver coef`, its bound understated or the range accepted |
| 8 | `math.test.ts` (5) | the sinc path fn presented: no notice names it, the `path` call gives one sub-path spanning [−10, 10] and no notice; sinc over [−1e-9, 1e-9] within [0.99999999, 1]; `sinc_as_sin_over_x` unbounded and failing; the Taylor sum with n a control [0, 19] set to 19 by a test writer's entry within 1e-12 of sin x at 1,000 seeded x in [−6, 6], and x at n = 0 without the entry; cpow(z, 2) within 2 ulp of (x·x − y·y, 2·x·y) at 10,000 seeded points; `factorial(171)`, `factorial(2.5)`, `sum(k, 0, 256, x)` refused naming the function and its argument, `factorial(170) + sum(k, 0, 255, x)` accepted |
| 9 | `new-eases.test.ts` (5) | rush_in(10) within 1e-12 of 2·sigmoid10(x ÷ 2) at 1,001 points; running_start(−0.5)'s least sample −0.1848 ± 1e-4 within 0.01 of 0.29, its 0 → 100 channel refused under [−18, 100] naming the key `pull` and −18.476 (1e-3), accepted under [−18.5, 100] with a bound enclosing −18.4761522 within 1e-6; exp_decay(0.1) 0.6321 ± 1e-4 at 0.1; the pulse exactly 1 at 0 and 1 s and 1.2 at 0.5 s (1e-12); `pulse_leaves_residue` reads 1 + 1e-6 at 1 s and fails naming `channel sc` |
| 10 | `without-motion.test.ts` (4) | `full,test-leave-out-motion` seals without motion, with marks2d and ease@1 the core's; the 1,001 probe instances of `easepack.probe@1` pass `easepack.matches` and only `bad` fails it, in `full` and without motion; the path fn's 1,001 points equal bit for bit in both, each within 1e-6 of in_out_cubic; the planted build answers a `module_missing` naming motion and the rule check fails |
| 11 | `noise.test.ts` (4) | the search over `noise(x, 7)` and `fbm(x, 7, 6, 0.5)`: 10,000 ranges in [−100, 100], 1,000 points, none outside, five ranges recomputed (and varying); the driver `10 * fbm(t, 7, 6, 0.5)`'s bound equals 10 × fbm's form over [0, 6] from `fn` within 1e-9 relative, its own bound as hard range passes, 1% inside it is refused naming `d`; `noise_form_samples_8` fails the search for both, naming the range and the point |
| 12 | `param-eases.test.ts` (5) | out_back {overshoot: 2.6} within 1e-12 of the Bézier at 1,001 points, peak 1.2009 within 1e-4 of x = 0.5185 on 10,001 points; `back_ignores_params` peaks at 1.1000 and fails naming `key rise`; out_bounce's defaults within 1e-12 of the four-arc bounce; the 190 u drop with {restitution: 0.56, bounces: 5} touches at the five times within 0.1 ms, stands 59.584 ± 0.01 u at 0.7977 s, the default 36.54 ± 0.01 u; its `bounds` within [0, 190] and the hard range [0, 190] passes |

## Choices where the issue is open

1. **Surfaces.** The closed function list (point forms, interval forms, the search, tables, refusals of an
   expression) is read through a new `deep-show run` call `fn`, available in every build set, since the list and
   ease@1 are the core's; drivers, channels, keys and their hard-range checks through `deep-motion eval`; registries,
   fixtures, content keys, corpus files, pack kinds and path fns through existing `deep-show run` calls plus a new
   `path` call. No new binary or subcommand.
2. **The search's points come from the binary's own mulberry32** seeded per range (`fn`'s `search`), since sending
   10⁷ points per function is too much; the tests recompute five ranges per function through `at` and require the
   reported extremes to be exactly those points' (criteria 3 and 11).
3. **"Each function"** (criterion 3) is every number-valued function of the table, each written as one expression
   over x (vectors and complex ones through a swizzle, two-argument ones with a constant, factorial and binom over
   `floor(x)`), plus every ease. Left out: `rand` (needs an item's seed), occurrence lists, input-track, view and
   time-offset functions (they read no x), noise3 and cells (signatures unspecified; noise and fbm are criterion
   11's). A bound may be unbounded or an estimate only on a range holding a pole (tan, 1/x, gamma); elsewhere either
   is a failure.
4. **Ranges** are 10,000 per function: its named ranges across a jump, a pole or an extremum first, then seeded ones
   with log-uniform widths from 10⁻⁶ of the domain to half of it.
5. **The outward-rounding fixtures** (Proof line) are degenerate ranges whose real value lies strictly between two
   f64s: 0.1 + 0.2 and 0.1 × 3 (real 0.3000000000000000166…, f64 0.30000000000000004 above it), and sin over [1, 1],
   whose bound must be widened past its point value; each within 1e-12.
6. **Tables come from packs** given inline (`packs` on the `fn` call and the eval line), as a pinned pack's
   `pack.json` holds `tables` and `entries`, named `<pack>.<name>`; a NaN arrives as f64 bytes, the form a data asset
   by hash has. The deep-show test pack `fixtures/packs/epack-1.0.0` uses the same entry shape.
7. **"Naming index 2", "the cap", "knot 1", "the endpoint"** are members `index`, `cap`, `knot`, `endpoint` anywhere
   in the refusal's JSON, which also names the table; `endpoint` is the x the table misses (1).
8. **"Declared monotone"** for an ease table is `overshoot: "none"` (the design's "With overshoot: none its knots
   never decrease"), not `mode: "monotone"`.
9. **"Its bound"** for a channel or driver is the eval answer's `bounds` (eval line `bounds: true`), over the span and
   every control's declared range; the hard-range check reads the same bound, and its refusal names the key or the
   driver and the bound.
10. **Criterion 7's names.** `drag` is a slider control with the declared range [0, 40]; the table is the pack table
    `dpack.drag` (a drag coefficient by speed); the driver's var `speed` reads `controls/drag/value`; "a test writer's
    entries" are eval `input` entries with `writer: "test"`. The sweep fixture is the bound equal to the knots'
    [0.2, 1.4] and a hard range [0, 1.3] refused, which every entry's own value respects.
11. **Criterion 8's sum** runs as a path function's expression (`fn` with `context: "path"`): its 20 terms of 18 nodes
    are 360 against the path cap of 512, where a driver's 64 would refuse it. n is a var bound to the slider `terms`
    (range [0, 19], the declared max) and set to 19 by a test writer's entry in the call's `input`.
12. **"Within 2 ulp"** is |got − w| ≤ 2·ulp(w) with w = x·x − y·y and 2·x·y in f64.
13. **"Naming the call"** is the refusal naming the function and its argument (171, 2.5; 256 or 257 for the sum).
14. **The path fn** is `params.fn: {y, over, samples?}` on path@1; "no notice" is no notice naming the item in the
    `deep show` reply and none in the `path` reply.
15. **The ease names.** The issue's `back_out` and `bounce_out` are ease@1's `out_back` and `out_bounce`: the base's
    names (side first, as the issue's own `in_out_cubic`), which the opening keeps so no key changes.
16. **Params of the families**: `params: {overshoot}`, `{amplitude, period}` and `{restitution, bounces}` objects;
    the one-param eases keep the base's bare number.
17. **The pulse** is the channel modifier `{pulse: {at, span, amount, shape}}` on a channel whose one hold key is 1.
18. **Criterion 10's kind rule** is a recipe's `rules` entry, read by the core's `kind_rules` check at rest; its planted
    twin, which the kind kit requires per rule, is written inline as `twins: [{params, expect}]` (an instance that
    must fail the rule) instead of an example document by sha256. Values are read through the rule: each of 1,001
    instances holds y = in_out_cubic(x) computed here and the rule `abs(ease(in_out_cubic, x) - y) <= 1e-12`; one
    instance 1e-6 off proves the rule runs. The path fn half compares the drawn points between builds bit for bit.
19. **The build without motion** is `full,test-leave-out-motion`; the plant adds `test-ease-in-motion`. The plant's
    `module_missing` may come from the pack check or the document check; the test finds it anywhere in the run's
    output.
20. **Criterion 2's "golden" and "corpus snapshot"** are, as #200 read them, the bytes each evaluated node wrote
    (`eval`'s `result`) and the `values` and `snapshots` of a `corpus_record` file; "the shipped fixtures" are every
    fixture the merge base's `fixtures` call lists, plus this suite's board keyed with in_out_cubic, out_back,
    sigmoid(6) and smoothstep. The comparison is against the merge base, as #200's AC11.
21. **ease@1's listing** requires `fill` to include `pack`, every closed ease as `module: "core"`, an installed pack's
    table with origin `pack`, and the registry's planted entries failing its kit (#200's rule for every registry).
22. **fbm's signature** is `fbm(p, seed, octaves, gain)`; criterion 11's driver reads `10 * fbm(t, 7, 6, 0.5)` with
    `t` the time in seconds over a 6 s span; its bound must equal the `fn` call's interval form of the same
    expression over [0, 6].
23. **Criterion 12's ball** is a channel of the ball's height above its floor (190 at 0.1 s, 0 at 1.6229 s); a touch
    is the lowest of the heights sampled every 706 flicks across τ ± 0.15 ms, within 0.1 ms of τ and under 0.01 u.
24. **Tolerances not in the issue**: point values against f64 references 1e-9 relative (criterion 3's guard against a
    point form that answers nothing); the path fn's points 1e-6 (a path may store f32); bounds "within 1e-9" where the
    issue gives an exact bound.

## What the base already does and these tests don't credit

The base's motion already has rush_in, rush_out, double_sigmoid, running_start and exp_decay as named eases and the
pulse modifier (#489), so `new-eases.test.ts`'s rush_in, exp_decay and pulse tests pass at the base, and the
running_start dip's values would; the hard-range part of the running_start test and the planted residue carry the
criterion's new part there. The base reads `out_bounce` with the fixed four-arc bounce, so `param-eases.test.ts`'s
default-bounce test passes at the base; its out_back ignores params, which is the plant's behavior. There is no
ease@1 registry, no `fn` or `path` call, no interval form, no function table, no math function beyond `min max floor
ceil round abs` in an expression, no ease params, no ease table, no hard-range check of a named ease, no `bounds`, no
kind rules, no path fn and none of the test features or plants. `BASE-FAILURE.txt`: 40 of 44 fail, the four above
pass.

## On this box (Linux arm64)

At the base, `deep show` of a board on this machine skips every `rect@1`, `text@1` and `path@1` item with an
`unknown_kind` notice, even though `registry` lists those kinds as marks2d's (the shipped fixtures too; the same lines
appear in `tests/acceptance/411/` and `412/`'s base runs). If that holds after the implementation, criterion 8's path
test and criterion 10's path and rule tests fail here for that reason, not the criterion's; run them where boards
draw.

## Scope not under a criterion

The issue's Scope also names interval forms for the key interpolations and for samplers of clips and bakes; noise3
and cells; elastic's params; complex forms bounding boxes; a sum's term past a var bound adding exactly 0; a value the
forms can't settle being an estimate that refuses a check needing its bound, naming the item and the range; tables
from data assets by hash in `assets` and from `fn.table@1` providers; table eases in `ease(name, x)` in a driver; a
check never reading a GPU step's table. No criterion states an observation for them beyond what the tests above
read, so they aren't checked here; they are follow-ups for the implementer's own tests.

## Upstream tests (the Oracle lane)

The issue's Oracle line says the page maps upstream tests, pinned by commit, for 4 of the 12 criteria, and that a
linked test counts only when run against our output (#136). This job could not read the page (404 from `gh api` for
this account, above), so it can't say which criteria or tests; nothing is ported, and no upstream test is run here.
There is no runner for upstream tests against our output in this repo, so that lane is **BLOCKED**, with one unblock
ask: give this job (or the redraft) read access to `DeepBuildAI/deepbuild`'s `doneright` branch, and a runner that
runs the linked tests against `deep-show`'s `fn` output. The twelve criteria are each covered above by this suite's own
tests.

`BASE-FAILURE.txt` is the run at the base.

## Disputes

Criterion 2's two comparisons against the merge base (opening.test.ts) stopped, on the merge base's own build,
at the first shipped fixture the base refuses in this suite's scenario (text/counter, whose bound value needs a
record the scenario doesn't give), before comparing anything. A blind redraft of that half
(`tests/acceptance/490-redraft-2/`) presents each fixture as it needs and compares refusals too. It also compared
each presentation's notices, which the criterion doesn't name, and which conflict with criterion 8 (the original
test and its blind redraft): the base notices `unknown_kind` ("the item is skipped") on every `rect@1`, `text@1` and
`path@1` it draws. The owner decided, once, on 2026-11-03: the false notice goes, the redraft replaces the original
comparisons, and the redraft's notice comparison is dropped. Every other part of both drafts stands unedited.
