# Twins of the #490 sweep redraft

Each folder is a wrong program for one criterion: full copies of one source file at `ccafae68f` (current main when
written), laid over a checkout at the same paths, changed only to undo that criterion's behavior. Every changed line
carries a `TWIN (#490.<id>)` comment. With a twin laid over the checkout and the binaries rebuilt (each test file builds
what it drives in its `beforeAll`), every test naming that ID fails at an assertion. `../twins.json` maps each ID to its
twin; `../redraft-2047/RUNS.txt` holds the runs.

| Twin | ID | File | What it undoes |
|---|---|---|---|
| `in-out-asymmetric` | `#490.dfa2703b` | `crates/deep-canvas/src/ease.rs` | Every in_out ease's lower half is scaled by 1 + 1e-6, so e(x) + e(1 − x) misses 1 by more than 1e-12 (and the in_out eases step down at 0.5). |
| `ease-renumbered` | `#490.ac6f64d6` | `crates/deep-canvas/src/ease.rs` | `Entry::opened` numbers a key's ease by its name's place in sorted order (the planted opening's numbering) instead of the number it always had, so the eased board's compiled motion program (node `motion.compile`) writes other bytes than the merge base's. On main this ID's test already fails (`../redraft-2047/README.md`: On main), so this twin is caught but the test can't yet tell it from a right program. |
| `sin-by-ends` | `#490.328160a4` | `crates/deep-canvas/src/interval.rs` | sin's interval form is its two ends' values only, missing a peak or trough inside (the issue's planted form, made the real one). |
| `table-extrapolates` | `#490.040cdb41` | `crates/deep-canvas/src/table.rs` | `Table::at` extends its end segments past its ends instead of holding the end values (1.875 at 5 for the ramp). |
| `table-order-unchecked` | `#490.085831ca` | `crates/deep-canvas/src/table.rs` | `Table::new` no longer refuses x that doesn't strictly increase. |
| `ease-table-dips` | `#490.b9d53cc8` | `crates/deep-canvas/src/table.rs` | `EaseTable::check_shape` no longer refuses a dip in a table declared monotone (`overshoot: none`). |
| `table-form-samples-8` | `#490.469d61b8` | `crates/deep-canvas/src/table.rs` | `Table::bound` is the least and greatest of 8 even samples of the range, not its knots (the issue's planted form, made the real one). |
| `sinc-as-sin-over-x` | `#490.cba8d943` | `crates/deep-canvas/src/interval.rs` | sinc's interval form is sin(x) ÷ x in interval arithmetic, unbounded across the removable 0 (the issue's planted form, made the real one). |
| `pulse-residue` | `#490.220e8248` | `crates/deep-canvas-motion/src/modifier.rs` | A pulse modifier adds 1e-6 at and past its span's end instead of exactly 0. |
| `ease-in-motion` | `#490.cf56a3e3` | `crates/deep-show/src/main.rs` | Every build composes the `test-ease-in-motion` layout: ease@1 is declared by the motion module, not the core, so a build without motion has no ease@1. |
| `noise-form-samples-8` | `#490.474ad338` | `crates/deep-canvas/src/expr/noise.rs` | noise's interval form (and so fbm's, the sum of its octaves') is the least and greatest of 8 even samples of the box, not the per-cell bound. |
| `back-ignores-overshoot` | `#490.e727fb3a` | `crates/deep-canvas/src/ease.rs` | The back family ignores its `overshoot` param and always uses 1.70158. |

Each twin compiles (`cargo build --locked --bin deep-show` / `deep-motion` with the feature sets the suite uses); see
`../redraft-2047/RUNS.txt` for each run and the assertion each test failed at.
