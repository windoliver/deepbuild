# Oracle-lane redraft for #490, criterion 1: bevy's easing.rs as a formula source

Criterion 1: "Every closed ease name holds its identities in f64 (ends at 0 and 1, the symmetry of in-out,
monotonicity over 1,001 samples for monotonic families)". The Oracle page (`oracle-tests/issues/490.md`,
`cases/490.json`) maps it to bevy `12a94e0cd6`'s `crates/bevy_curve/src/easing.rs`, use "formula", and says bevy
checks in f32 within 1e-6 while "f64 and monotonicity over 1,001 samples are ours".

Written blind, by a redraft job, from: issue #490 read live (all twelve criteria, its Scope and Fields); the Oracle
page, its case file and the vendored easing.rs (extracted from the downloaded zip as data; nothing in it was run);
`docs/canvas-primitives.md` at the base: Channel and key (its ease list: "the Penner families (with a renormalized
expo), smoothstep, smootherstep, sigmoid(k), rush_in(k) …"), Channel and key: table eases, The closed function list;
AGENTS.md; `tests/acceptance/489/` for conventions; and base commit `db09e652`. No other worktree, branch or
`tests/acceptance/490*` folder was read. Implementers don't edit these files (AGENTS.md, Proof).

## Run

```sh
npm ci --ignore-scripts     # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/490-oracle-redraft --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/490-oracle-redraft/tsconfig.json
```

`beforeAll` builds `cargo build --locked --bin deep-show --no-default-features --features core` (the core build: the
closed function list and `ease@1` are the core's, so no motion feature is needed) and copies the binary out.
`BASE-FAILURE.txt` is the base run: all 7 tests fail because the base's `deep-show run` answers the `fn` call with
`{"ok":false,"code":"bad_input"}`.

## The surface

One scenario on stdin, `{"evidence": <temp dir>, "sessions": {}, "processes": [], "panels": {}, "docs": {},
"calls": [...]}`, each call `{"call": "fn", "expr": "ease(<name>, x)", "at": [x…]}`, answered by one line
`{"ok": true, "replies": [{"values": [number | null]}, …]}`, one reply per call, one value per x. A `null`, a
non-finite value, a missing reply or a refused scenario fails the test, naming the name and the x. Names are called
with no params, so each reads its defaults.

## Where bevy is a source, and where it isn't

A bevy formula is a reference for one of our names only when the issue or the design pins our name to the same curve.
Each mapping below is checked within **1e-12 absolute at the 999 interior samples i ÷ 1000** (the issue's own f64
precision for ease values, criteria 9 and 12; an f32 evaluation is off by ~1e-7, so it proves f64). The ends are
held separately and exactly (below), because the criterion's ends override the residues some Penner formulas leave.

| Our names | bevy function | Why it's valid |
|---|---|---|
| `in_quad out_quad in_out_quad`, `…_cubic`, `…_quart`, `…_quint` | `quadratic_*`, `cubic_*`, `quartic_*`, `quintic_*` | The Penner families (design); bevy's are Penner's polynomials |
| `in_sine out_sine in_out_sine`, `…_circ` | `sine_*`, `circular_*` | Penner's |
| `in_expo out_expo in_out_expo` | `exponential_*` | The design's "renormalized expo": bevy's is (2^(10t) − 1) ÷ (2^10 − 1), its comment says, and any affine map of Penner's 2^(10t − 10) onto 0 at 0 and 1 at 1 is that one curve, so there's no other renormalization |
| `smoothstep`, `smootherstep` | `smoothstep`, `smootherstep` | 3t² − 2t³ and 6t⁵ − 15t⁴ + 10t³, the only curves those names mean |
| `in_back`, `out_back` | `back_in`, `back_out` (c = 1.70158) | The issue: back {overshoot = 1.70158} and "the defaults are the fixed shapes"; criterion 12's back_out {2.6} as the Bézier (1/3, 28/15, 2/3, 1) is this same cubic with c = 2.6 |
| `in_elastic`, `out_elastic` | `elastic_in`, `elastic_out` | The issue: elastic {amplitude = 1, period = 0.3}; bevy's sin((10t − 10.75)·2π/3) is Penner's with p = 0.3, s = p/4 (a = 1), and its out is exactly 1 − in(1 − x). Its ends, −2^−11 at 0 and 1 + 2^−11 at 1, are why the comparison is interior only |

Bevy's three tests, ported to f64 over the names above:

- `ease_functions_zero_to_one`: widened to **every** closed name (38), and tightened from [0, 1e-6] and [1 − 1e-6, 1]
  to **exactly 0 at 0 and exactly 1 at 1**: in f64 "ends at 0 and 1" means the value a key lands on, and bevy's slack
  was f32's.
- `ease_function_inout_deciles`: for the seven bevy triples that are all our names (quad, cubic, quart, quint, sine,
  circ, expo), in_out(x) < x and = in(2x) ÷ 2 at 0.1…0.4, in_out(x) > x and = out(2x − 1) ÷ 2 + ½ at 0.6…0.9, the
  relations within 1e-12 (bevy: 1e-6). For smoothstep and smootherstep only the convexity half: bevy's
  SmoothStepIn/Out and SmootherStepIn/Out aren't our names.
- `ease_function_midpoints`: in(½) < ½ − 1e-6 and out(½) > ½ + 1e-6 (bevy's margin, kept), in_out(½) = ½ within
  1e-12, plus smoothstep(½) and smootherstep(½) = ½.
- Bounce's construction (bevy lines 1305–1327): in_bounce(x) = 1 − out_bounce(1 − x), and in_out_bounce(x) =
  (1 − out_bounce(1 − 2x)) ÷ 2 below ½ and (1 + out_bounce(2x − 1)) ÷ 2 from ½, within 1e-12 at 1,001 samples. These
  are relations among our own values, valid whatever out_bounce's arcs are (see below why bevy's arcs aren't used).

The criterion's own identities, which bevy's tests extend to (the Oracle page: "ours"):

- **Symmetry of in-out**: in_out(x) + in_out(1 − x) = 1 within 1e-12 at the 1,001 samples (1 − x computed in f64 and
  sent as its own x), for all ten `in_out_<f>` (back, elastic and bounce included: a point reflection holds whatever
  their constants) and for smoothstep and smootherstep, bevy's in-out members of their triples.
- **Monotonicity over 1,001 samples** (never decreasing, i ÷ 1000): bevy's MONOTONIC_IN_OUT_INOUT as our names (the
  21 Penner names of the seven triples, smoothstep, smootherstep) and our other monotone eases at their defaults:
  sigmoid, rush_in, rush_out, double_sigmoid, exp_decay (each a sigmoid piece or 1 − e^(−x/τ) rescaled, by the
  design's definitions).

## Excluded, and why

- **bevy's `bounce_*` values.** Bevy's out arcs break at 4/11, 8/11 and 9/10 and dip to 0.7, 0.91 and 0.973, which
  is no drop with one restitution. The issue defines bounce as "a drop under constant gravity whose every rebound keeps
  restitution of its speed, scaled so the last rebound lands at x = 1", defaults 0.5 and 3 bounces "so the defaults
  are the fixed shapes": that drop lasts T₀(1 + 1 + ½ + ¼), so arcs end at 4/11, 8/11, 10/11 and 1 and dip to 3/4,
  15/16 and 63/64 (Penner's four-arc bounce; criterion 12's touch times for restitution 0.56 and 5 bounces confirm
  the construction). At x = 6/11 bevy reads 0.7 where ours must read 0.75; the curves differ by up to 0.05. Only
  bevy's in/in_out construction from out is used.
- **bevy's `back_in_out` values.** Bevy scales the overshoot as c1 + 1.525 = 3.22658; Penner (and easings.net) use
  c1 × 1.525 = 2.5949; the issue gives back one parameter, overshoot = 1.70158, and says nothing of an in-out
  scaling. Bevy's is no source for our default; in_out_back gets only the exact ends and the symmetry.
- **bevy's `elastic_in_out` values.** Bevy's uses period 0.45 (sin((20t − 11.125)·2π/4.5), Penner's p × 1.5) where
  the issue's default period is 0.3; whether our in_out stretches the period isn't written. Ends and symmetry only.
- **The ends of `in_elastic` / `out_elastic` against bevy**: bevy leaves ∓2^−11 there; the criterion's exact ends
  apply instead.
- **Monotonicity of back, elastic, bounce and running_start**: not monotonic families (overshoot, oscillation,
  rebounds, the pull's dip).
- **Symmetry of sigmoid and double_sigmoid**: neither is bevy's nor an `in_out_` name, and the design doesn't state
  sigmoid(k)'s centring; criterion 9's lane holds rush_in against 2·sigmoid10(x ÷ 2).
- **bevy's `Steps`/`JumpAt` tests** (`jump_at_*`): they belong to quantize jump (Channel and key: quantize jump), not
  an ease name or this criterion. **`Elastic(omega)`**, **`Linear`**, **`SmoothStepIn/Out`**,
  **`SmootherStepIn/Out`**: no such names in `ease@1`. **`ease_quats`, `ease_isometries_*`, `ease_function_curve`,
  `unit_structs_match_function`**: bevy's curve types, not values of a name.
- **Non-default params** (overshoot 2.6, bounce restitution 0.56, …): criterion 12's lane.

## Risks a reviewer should weigh

- `in_elastic`/`out_elastic` are held to raw Penner in the interior. If the implementation renormalized elastic as the
  design renormalizes expo, it would be off by up to ~5e-4 and fail; the design names only expo as renormalized, so
  this redraft treats elastic as not.
- Exact ends: an implementation that computes 1 − in(0) etc. and lands 1 ulp off fails. The criterion says "ends at
  0 and 1" in f64, and the design's channel semantics need a segment to land on its key's value.

## The owner's decision (2026-11-03)

This redraft replaces `tests/acceptance/490-oracle/eases-bevy.test.ts` (that README: Disputes).
