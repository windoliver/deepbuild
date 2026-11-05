# Acceptance tests for #490, Oracle lane: upstream tests and formulas run against our output

Written first, blind, from issue #490 (`gh issue view 490 --repo windoliver/deepbuild`), its Oracle page
(`oracle-tests/issues/490.md` and `oracle-tests/cases/490.json` in the oracle bundle at `4bfb6fe`, the page
`doneright/oracles/issues/490.md` in `DeepBuildAI/deepbuild`), the upstream files that page pins, the design
(`docs/canvas-primitives.md`: The closed function list; Driver: tables; Channel and key; Channel and key: table
eases; Pack: math@1's rate-function mapping) and base commit `37fed05f`, by a job that never saw an implementation;
none existed, and no other worktree, branch or `tests/acceptance/490*` folder was read. #136's rule applies: a linked
test counts only when run against our output, so every upstream case here is asserted against what `deep-show run`
or `deep-motion eval` answers. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes
to a blind redraft of this job (design: Dogfooding).

Scope: the four criteria the Oracle page links an upstream source to: 1 (bevy, formula), 3 (inari's IEEE 1788
suite, port), 4 (NumPy TestInterp and SciPy TestPCHIP, port) and 9 (manim-ce, formula). Each criterion's "ours"
parts (the oracle page's words: planted programs, refusals naming items, the seeded counterexample search, the
hard-range check, ease@1's registry) belong to the issue's own acceptance lane, not this folder.

## Sources

| Criterion | Upstream, pinned | Use | License |
|---|---|---|---|
| 1 | bevy `12a94e0cd6b18df7a0dc2e5a202a55156d80e9a6` `crates/bevy_curve/src/easing.rs` | formula | MIT OR Apache-2.0 |
| 3 | inari `9e519ce47c9baa897bf11a735300ca4718a7a2a1` `tests/itf1788.rs`, `tests/itf1788_tests/libieeep1788_elem.rs` | port | inari MIT; the file Apache-2.0 (libieeep1788, Nehmeier and Heimlich) |
| 4 | numpy `a3d0ef1df045b858e68115001fdabc930bb3b68c` `numpy/lib/tests/test_function_base.py` (TestInterp) | port | BSD-3-Clause |
| 4 | scipy `e4e854eaa8f18d807cd3496028e257e36caa93cc` `scipy/interpolate/tests/test_polyint.py` (TestPCHIP) | port | BSD-3-Clause |
| 9 | manim-ce `a6d5cc02b430fb57d22add51236b6406fbf19d91` `manim/utils/rate_functions.py` | formula | MIT |

The oracle bundle had every pinned file but NumPy's; that one was read from GitHub at the pinned commit
(`gh api repos/numpy/numpy/contents/numpy/lib/tests/test_function_base.py?ref=a3d0ef1df0…`). No upstream code is
copied: the formula sources are re-expressed in TypeScript in the test that uses them, each function named after
its upstream one; the ported values are copied with their test's name. The IEEE 1788 cases are data copied into
`fixtures/itf1788-libieeep1788-elem.json`, which carries the file's Apache-2.0 notice verbatim (`notice`) and, per
case, the upstream test, line and assert text. `fixtures/extract-itf1788.mjs` made it from the pinned file (Node
built-ins only; `node fixtures/extract-itf1788.mjs <libieeep1788_elem.rs> > fixtures/itf1788-libieeep1788-elem.json`
from this folder); it is never edited by hand.

## Run

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/490-oracle --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/490-oracle/tsconfig.json   # type-check (exits 0)
```

`--root` keeps the repo's `vitest.config.ts` out; it leaves Vitest's cache in
`tests/acceptance/490-oracle/node_modules/.vite`; delete it, it is not part of the suite. Each file builds what it
drives once, in `beforeAll`, honoring `CARGO_TARGET_DIR`: `cargo build --locked --bin deep-show --no-default-features
--features core` (every file) and `cargo build --locked --bin deep-motion` (`rate-functions-manim.test.ts`). The files
build cargo binaries, so they run one at a time: `scripts/lanes.mjs` needs `'tests/acceptance/490-oracle/'` in its
`alone` list (this job writes only this folder; the implementer makes that edit). Every `it` passes `TIMEOUT`
(30 min). Evidence folders go under the OS temp folder and are deleted. Node built-ins and vitest only.

`BASE-FAILURE.txt` is the one run at the base: every `fn` test fails because the base refuses a scenario holding a
`fn` call (`{"ok":false,"code":"bad_input"}`); see its header for the four that pass there.

## The surface under test

**`deep-show run`'s `fn` call** (the build `--no-default-features --features core`, so the core alone answers):
one scenario `{"evidence": <temp dir>, "sessions": {}, "processes": [], "panels": {}, "docs": {}, "calls": [...]}`
on stdin, answered by one line `{"ok": true, "replies": [...]}`, one reply per call, exit 0. A call is
`{"call": "fn", "expr": string, "context"?: "driver" | "field" | "path", "packs"?: [{name, tables?: {name: {x, y,
mode?}}}], "at"?: [number | {name: number}], "over"?: [[a, b]]}`. The tests send `at` with numbers (each binds `x`)
and read `{"values": [number | null]}`, one per point; they send `over` with finite `[a, b]` and read `{"bounds":
[{"lo": number | null, "hi": number | null, "estimate"?: true}]}`, one per range, null at an unbounded end. A
refusal is a reply `{"code": string, …}`. The tests use `at` and `over` on separate calls, `context: "driver"` for
`table(…)` and no context otherwise, and every call holds a small expression (under every context's cap). Eases are
read as `ease(<name>, x)` at their default params, tables as `table(oracle.t, x)` over the call's pack `oracle`.

**`deep-motion eval`** (#391's JSON-lines CLI, as `tests/acceptance/489` drives it): one line `{doc, times}`, read
back as `frames[i].channels.<id>.value`. The document is #391's film envelope with three `rect@1` items, each with
an f32 channel on `items/<id>/at/scale/0` holding one key `{t: "0s", value: 1, interp: "hold"}` and one modifier
`{pulse: {at: "0s", span: "1s", amount: 0.2, shape: "there_and_back" | "pause" | "wiggle"}}`, the ease left at its
default `sigmoid(10)`, `pause`'s share at 1/3 and `wiggle`'s count at 2 (Channel and key: `modifiers`).

## Criterion 1: bevy `easing.rs`, formula (`eases-bevy.test.ts`)

The closed names are the design's: `in_`, `out_` and `in_out_` of quad, cubic, quart, quint, sine, expo, circ, back,
elastic and bounce, and smoothstep, smootherstep, sigmoid, rush_in, rush_out, double_sigmoid, running_start and
exp_decay. Bevy's `MONOTONIC_IN_OUT_INOUT` maps to quad, cubic, quart, quint, sine, circ and expo (in, out, in_out),
and bevy's SmoothStep and SmootherStep to our smoothstep and smootherstep.

| Bevy test | Here | Judged |
|---|---|---|
| `ease_functions_zero_to_one` | every closed name at 0 and 1 | exactly 0 and exactly 1 (bevy: within 1e-6 in f32; the criterion: "in f64") |
| `ease_function_inout_deciles` | each triple at 0.1–0.4 and 0.6–0.9 | in_out(x) < x (> x); in_out(x) against in(2x)/2 (out(2x − 1)/2 + ½) within 1e-12; smoothstep and smootherstep against bevy's own `smoothstep_in/_out` and `smootherstep_in/_out` formulas (ours has no such names) |
| `ease_function_midpoints` | each triple at ½ | in(½) < ½ − 1e-6 and out(½) > ½ + 1e-6 (bevy's margin kept), in_out(½) and smoothstep(½) within 1e-12 of ½ |
| bevy's `easing_functions` formulas | each name a formula defines, at 1,001 samples i/1000 | within 1e-12 of the formula in f64 (bevy's renormalized expo is ours: (2^(10x) − 1)/1023) |
| (criterion) symmetry of in-out | every Penner family; smoothstep, smootherstep, sigmoid, double_sigmoid | out(x) = 1 − in(1 − x) and in_out(1 − x) = 1 − in_out(x), s(1 − x) = 1 − s(x), within 1e-12 at the 1,001 samples and their mirrors |
| (criterion) monotonicity | bevy's list, smoothstep, smootherstep, the sigmoid eases, exp_decay | never falls across the 1,001 samples |

Left out: bevy's `jump_at_*` step tables (steps are `quantize(n)` keys, not `ease@1` names, and the quantize jump is
another issue's); `ease_quats`, `ease_isometries_*`, `ease_function_curve`, `unit_structs_match_function` (bevy's
Curve plumbing); bevy's formulas for `in_out_back` and `in_out_elastic` (Penner's in-out back takes a different
overshoot, 1.525·c, and in-out elastic a different period, 0.45, from their in forms; the issue gives back and
elastic params, and which in-out convention they follow is the issue's own lane's), and back, elastic, bounce and
running_start from monotonicity (they overshoot or rebound). 1e-12 is the issue's own tolerance for formula
equalities (criteria 8, 9, 12); bevy's 1e-6 is f32's.

## Criterion 3: the IEEE 1788 suite, port (`interval-itf1788.test.ts`)

**Ported:** from `libieeep1788_elem.rs`, the non-decorated tests of every function on our closed list:
`minimal_{neg, add, sub, mul, div, recip, sqr, sqrt, pown, pow, exp, exp2, exp10, log, log2, log10, sin, cos, tan,
asin, acos, atan, atan2, sinh, cosh, tanh, asinh, acosh, atanh, sign, ceil, floor, round_ties_to_away, abs, min,
max}_test`. Each is one `it`; 504 cases are kept (the fixture's `dropped` counts every other case, by test and
reason). Each case's input and expected interval are inari's, each expression ours:

| inari | Ours over x | inari | Ours over x |
|---|---|---|---|
| `-X` | `-x` | `X.recip()` | `1/x` |
| `X + c`, `c + X` (also `-`, `*`, `/`) | `x + c`, `c + x`, … | `X.sqr()`, `X.powi(n)` | `x^2`, `x^n` (`x^(-n)`) |
| `X.pow(c)`, `c.pow(X)` | `pow(x, c)`, `pow(c, x)` | `X.exp2()`, `X.exp10()` | `pow(2, x)`, `pow(10, x)` |
| `X.ln()` | `log(x)` | `X.round()` (ties away) | `round(x)` (libm's `round` rounds ties away) |
| `Y.atan2(c)`, `c.atan2(X)` | `atan2(x, c)`, `atan2(c, x)` | `X.f()` for the others | `f(x)` |

Constants are written as plain decimals (the shortest text that reads back as the same f64, no exponent), a
negative one in parentheses, and −0 as 0 (IEEE 1788 intervals don't tell −0 from +0).

**Left out, and why** (counts in the fixture): cases with `EMPTY`, `ENTIRE` or `NaI` operands, or an infinite input
bound (`over` takes finite `[a, b]`); binary cases whose two operands are both non-degenerate intervals (`over`
binds `x` alone; this drops most of `pow`, `atan2`, `div`, `min` and `max`); cases whose answer is empty (an input
outside the domain); inputs that reach or cross a domain edge or a pole where our point form is not a finite real
(sqrt below 0; log, log2, log10 at or below 0; asin, acos past ±1; acosh below 1; atanh at or past ±1; recip, a
divisor or a negative power whose input holds 0; pow's base below 0, or 0 to a power ≤ 0; an atan2 box holding the
origin), since what our form answers there is not something the design states. Tan across its pole stays: no f64
is the pole, so the point form is finite everywhere and the tight answer is `ENTIRE`. The `_dec_` tests
(decorations are not ours) and `mul_add` (fma), `trunc` and `round_ties_even` (not on our list) are left out;
`itf1788.rs` is the harness (`n2i`, `assert_eq2!`), read for how a case is stated, and the other modules it lists
(atan2, constructors, booleans, set, overlap, reverse operations, cancel, mul_rev, num) are not among the files the
Oracle page pins. **`c_xsc.rs`, `fi_lib.rs` and `mpfi.rs` are not ported**: they are
LGPL-2.1 (C-XSC, FI_LIB, GNU MPFI), and AGENTS.md forbids porting GPL code; this job reads that rule as covering
the LGPL family. If the owner rules LGPL test data acceptable, their unary-function cases go through the same
extractor shape.

**How an upstream assertion maps onto our wider form.** inari asserts equality with the tight enclosure Y (the
smallest pair of doubles holding the function's range, rounded outward). Ours is "widened by its implementation's
error bound", so the test judges, per case:

1. `estimate` is not set: an estimate never decides a check, and none of these finite ranges needs one.
2. **Ours contains Y**: lo ≤ Y.lo and hi ≥ Y.hi, and an unbounded end of Y (null) is unbounded in ours. Since Y is
   the tightest double enclosure of the true range, any correct enclosure contains it, so this is exactly
   correctness, with no tolerance.
3. **Ours is at most 1e-12 × max(1, |Y's end|) past each end of Y**, and a finite end of Y may be unbounded in ours
   only past 1e300 in magnitude (where widening may overflow). Without a width limit, `ENTIRE` for everything would
   pass. The design bounds the widening by the implementation's error bound (libm's, a few ulp, about 1e-15
   relative) plus outward rounding (one ulp); 1e-12 relative, about 4,500 ulp, leaves room for any form built from
   monotone pieces and known extrema while failing a form that is loose by a visible amount. The absolute floor
   (the `max(1, …)`) keeps ends near 0, such as sin(π) = 1.2e-16, from demanding relative precision there.
4. Our point form (an `at` call) at both ends of the range lies inside our bound; a point past the largest double
   reads null and passes only where our bound is unbounded.

The near-pole singletons of `minimal_tan_test` (tan at 1.5707963267948966 and …68, finite in the tight answer) are
where a form that places the pole at the double π/2 instead of the real π/2 would answer `ENTIRE` and fail rule 3.

## Criterion 4: NumPy TestInterp and SciPy TestPCHIP, port (`tables-numpy-scipy.test.ts`)

| Upstream | Here | Judged |
|---|---|---|
| `TestInterp.test_basic` | linear table x = y = linspace(0, 1, 5) at linspace(0, 1, 50) | `assert_almost_equal` (decimal 7: \|Δ\| < 1.5e-7) |
| `TestInterp.test_right_left_behavior` | sizes 2–9, x arange(size), y ones, at −1, 0, size − 1, size and reversed | exactly 1 (`assert_equal`) |
| `TestInterp.test_scalar_interpolation_point` | 0, 0.3, float32(0.3) | almost equal |
| `TestInterp.test_zero_dimensional_interpolation_point` | xp 0, 2, 4, fp 1, −1, 1 at 1 | exactly 0 |
| `TestInterp.test_empty_x` | `at: []` on [1, 2] → [3, 4] | `values: []` |
| `TestInterp.test_exceptions` | x = y = [], and x [0] with y [1, 2]; and a one-point table | each a refusal (`code`) |
| the criterion's table | x 0, 1, 2, 4, y 0, 1, 1.5, 1.75 at 3, −1, 5 | equal to np.interp's rule (computed here: 1.625, 0, 1.75) |
| `TestPCHIP.test_overshoot` | monotone table on `_make_random` (RandomState(1234): 20 sorted x, 20 y), 10 samples linspace(x1, x2, 10) per pair of knots, and the criterion's 1,000 | each within [min, max] of its two knots, upstream's 1e-15 slack |
| `TestPCHIP.test_monotone` | the same table, 10 samples per pair | (y2 − y1)·(yp[k] − yp[0]) > 0 for every k ≥ 1, as upstream |
| `TestPCHIP.test_all_zeros` | monotone table x arange(10), y zeros at linspace(0, 9, 101) | exactly 0 |

`_make_random`'s data is regenerated, not copied: `helpers.ts` implements NumPy's legacy MT19937 (`init_genrand`
seeding, `genrand_res53` doubles), and a test checks its first values against NumPy's published ones
(RandomState(1234): 0.1915194503788923, …; RandomState(0): 0.5488135039273248, …).

Left out: TestInterp's `left=`/`right=` arguments, `period=`, complex tables (`test_complex_interp`, the `sc`
fixture's complex scales), NaN query points and the non-finite tables of `test_non_finite_*` (ours holds its ends,
has no period or complex mode, and refuses a non-finite table, which JSON can't carry anyway: criterion 5's lane),
and `test_if_len_x_is_small` (100,000 knots, past our 4,096 cap). TestPCHIP's `test_cast`, `test_nag`,
`test_endslopes`, `test_two_points`, `test_pchip_interpolate` and `test_roots` pin SciPy's Fritsch–Butland slopes,
derivatives or roots; ours takes Fritsch and Carlson's, so, as the oracle page says, only the bound applies. The
interval form over [0.5, 3], the planted extrapolating sampler and the table refusals of criteria 4 and 5 are the
issue's own lane's.

## Criterion 9: manim-ce `rate_functions.py`, formula (`rate-functions-manim.test.ts`)

| manim | Ours | Judged |
|---|---|---|
| `rush_into` = 2·smooth(t/2) | `ease(rush_in, x)` | within 1e-12 at 1,001 points (the criterion) |
| `smooth`, `rush_from`, `double_smooth` | `sigmoid`, `rush_out`, `double_sigmoid` (the design's mapping) | within 1e-12 at 1,001 points |
| `running_start` (pull −0.5) | `ease(running_start, x)` | within 1e-12 at 1,001 points; manim's dip (found here: −0.18476 at 0.2899) is −0.1848 ± 1e-4 near 0.29, ours reads it within 1e-12; our `over [0, 1]` is no estimate, its lo holds the dip and is no lower than −0.1848 − 1e-4, its hi holds 1 within 1e-4 |
| `exponential_decay` (half_life 0.1) | `ease(exp_decay, x)` | equals manim's divided by 1 − e^(−10) (the design's renormalization) within 1e-12 at 1,001 points; 0.6321 ± 1e-4 at 0.1, as manim's is |
| `there_and_back`, `there_and_back_with_pause` (pause_ratio 1/3), `wiggle` (wiggles 2) | pulse `there_and_back`, `pause`, `wiggle` of amount 0.2 on a held scale of 1 over 1 s | 1 + 0.2 × manim's shape(t ÷ 1 s) within 1e-12 at 1,001 times; exactly 1 at 0 s and 1 s; 1.2 at 0.5 s for there_and_back |

The design maps manim's `wiggle` to `pulse` wiggle with `count` its `wiggles`, so the shape is manim's
there_and_back(u)·sin(count·π·u). **At the base, motion's wiggle reads sin(2π·count·u)** (twice manim's
frequency) and this test fails there; there_and_back and pause already match manim at the base and pass.

Left out: the hard-range check that takes running_start's bound from its interval form, and the planted pulse that
leaves 1e-6 at its end (the issue's own lane: they need a check refusal and a planted program); manim's other rate
functions (`linear`, `slow_into` and the `ease_*` Penner set are criterion 1's ground; `lingering`,
`squish_rate_func` and `not_quite_there` map to keys, not to eases or pulses).

## Choices where the issue is open

1. **Defaults only.** `ease(name, x)` has no params, so every ease is read at its design default (sigmoid k 10,
   running_start pull −0.5, exp_decay tau 0.1; back, elastic and bounce at their fixed shapes).
2. **Exact ends.** Criterion 1's "ends at 0 and 1 … in f64" is read as exactly 0.0 and 1.0.
3. **The width margin** of criterion 3 is 1e-12 × max(1, |end|) (justified above).
4. **Refusals** of a bad table are a reply with a `code`, not a refused scenario.
5. **The pulse shapes** follow manim's formulas for every shape the Oracle page names.

## Obligations on the implementer

- `deep-show run` in the `core` build answers `fn` calls as the surface above states: `values` for `at`, `bounds`
  for `over` (null at an unbounded end, `estimate` only for a value the forms can't settle), `code` for a refusal,
  in one accepted scenario with one reply per call.
- The expression language takes plain decimal literals, unary minus, `+ - * / ^`, `pow sqrt exp log log2 log10 sin
  cos tan asin acos atan atan2 sinh cosh tanh asinh acosh atanh sign ceil floor round abs`, `ease(<name>, x)` for
  every name listed under Criterion 1, and `table(<pack>.<name>, x)` over a call's `packs`, in the driver context
  for tables.
- Each listed function has an interval form that contains the IEEE 1788 tight enclosure and is at most 1e-12 ×
  max(1, |end|) wider, at the 504 ported cases; the point form lies inside it.
- Linear tables follow np.interp's rule (held ends); monotone tables keep each segment between its knots; a table of
  fewer than 2 points or with x and y of different lengths is refused.
- The eases equal bevy's and manim's formulas as above, end exactly at 0 and 1, and keep their symmetries and
  monotonicity; running_start's interval form over [0, 1] holds its dip within 1e-4.
- `deep-motion eval`'s pulse modifier: shapes `there_and_back`, `pause` and `wiggle` equal manim's (wiggle:
  sin(count·π·u)), exactly the base value at both ends of the span.
- `scripts/lanes.mjs`: add `'tests/acceptance/490-oracle/'` to `alone`.

## Disputes

`eases-bevy.test.ts` (criterion 1) held our bounce and elastic to bevy's values: bevy's bounce has other arcs than
the four-arc bounce criterion 12 fixes as the default, and bevy's elastic reads ∓2⁻¹¹ at the ends where criterion 1
requires exactly 0 and 1. A blind redraft (`tests/acceptance/490-oracle-redraft/`) leaves those values out and keeps
bevy's other formulas and tests. The owner decided, once, on 2026-11-03: the redraft replaces this file. Also
decided then: the LGPL-2.1 files (C-XSC, FI_LIB, MPFI) stay out, and the fixture keeps libieeep1788's Apache-2.0
notice verbatim.
