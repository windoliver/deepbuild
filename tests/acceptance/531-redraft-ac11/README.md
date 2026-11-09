# Blind redraft of #531's budget-lines criterion

`#531.6b6fc913` (criterion 11): "In a bake whose worst step runs loops at `rules.rs:10`, `rules.rs:20` and `rules.rs:30`
for 3,000, 2,000 and 1,000 iterations, logic.budget names those 3 lines in that order, each with its fuel from the
rewrite's per-block counts; a planted report that charges each block to its function's first line names one line and
fails."

Written fresh from the criterion by a job that never saw an implementation of #531, a diff, or any other test of this
criterion (not `tests/acceptance/531/ac11-budget-lines.test.ts`, nor `programs.ts`). The implementing agent doesn't edit
these files; a dispute goes to another blind redraft (AGENTS.md, Proof; design: Dogfooding).

What was read: issue #531 (`gh issue view 531 --repo windoliver/deepbuild`) and its Oracle page (criterion 11 has no
upstream test: "Fuel charged per line from the rewrite's per-block counts is our budget report"); AGENTS.md; and, restored
from the suite's commit `9e44bd99` into the base checkout `dd83ac2f` (not committed here), `tests/acceptance/531/README.md`
(The surface under test: `deep-logic`, `bake`, `budgets`, sidecars, the planted twin `budget_charges_function_first_line`),
`helpers.ts`, which this file imports rather than redefines, `tsconfig.json`, `wat/` and `rules/`.

## Run it

As `tests/acceptance/531/README.md` (Run them), with that suite's harness files present (`helpers.ts`, `wat/`):

```sh
npm ci                                            # once, if node_modules is missing
export PATH=/opt/homebrew/opt/rustup/bin:$PATH    # rustup's cargo; the test also adds it
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/531-redraft-ac11 --no-file-parallelism
npx tsc -p tests/acceptance/531-redraft-ac11/tsconfig.json
```

It builds `budget/` (below) into `target/acceptance-531-redraft-ac11-budget/`, the 531 suite's assembler, and
`deep-logic` (`cargo build --locked --bin deep-logic`); no Docker, no Chrome. Each test passes the 531 suite's `TIMEOUT`.
`BASE-FAILURE.txt` is the run at the base.

## The program: `budget/`

A Rust cdylib for wasm32-unknown-unknown with debug info (`debug = 2`, `opt-level = "s"`, `panic = "abort"`, one memory of
two pages whose maximum is its minimum), no dependencies, outside the workspace. `src/lib.rs` holds `init`, the state and
the `reads_at` and `writes_at` regions; `src/rules.rs` holds `step`, declared on rules.rs:4, with its three xorshift loops
on rules.rs:10, 20 and 30 of 3n, 2n and n iterations, where n is 1,000 at step 7 and 100 at every other step. The item is
`{writes: {acc: {type: i32}}}` with no reads; the test checks `acc` is at offset 0 of the write region.

This suite writes its own program, not the 531 suite's `rules/`, for the twin. In `rules/` the worst step runs two
functions, `step` in lib.rs and `work` (whose first line is rules.rs:6). The twin, built exactly as its name says, charges
`work`'s blocks to rules.rs:6 and `step`'s to lib.rs's `step` line, so it names two lines, not the one the criterion says.
Here `step` calls nothing, so every block of the worst step is in one function and the twin has exactly one line to name.

Checked against real components (`xcrun dwarfdump --debug-line` / `--debug-info`, the 531 suite's assembler, Node's own
WebAssembly):
- `step` is the only concrete function whose range holds rules.rs rows, with `DW_AT_decl_line` 4.
- Its rows are rules.rs lines 5, 6, 8, 10, 11, 13, 20, 21, 30, 31, 33, 34 and 36, plus line 0. There is no inlined
  subroutine and no row from another file.
- Its body has 3 `loop`s and no call. No loop is unrolled: at `opt-level = 1` LLVM unrolled each loop 4 times, and
  `"s"` doesn't.
- Each loop body is the same 22 instructions, 9 of them on line 0.
- The module imports nothing. It runs 12 steps without a trap.

The test checks again, on every run, that `step` holds no call and three loops.

## What the tests assert

`budget-lines.test.ts`, one bake of 12 steps at 60 Hz with the sidecar named as `debug`. One judgement is applied to the
real `deep-logic` and to `deep-logic --planted budget_charges_function_first_line`:

- No trap; steps 0 to 11 ran. Step 7's `fuel` is more than every other step's: it is the worst step.
- `budgets` holds one report for the item. Its `step` is 7 and its `fuel` is step 7's record.
- Its `lines` are exactly three, whose sources end in `rules.rs:10`, `rules.rs:20` and `rules.rs:30`, in that order. Any
  directory before the file name is allowed.
- Each line's fuel is "from the rewrite's per-block counts". The test reads that against the step counter. Let D be step
  7's fuel minus step 6's: the same code with a tenth of the iterations, so D is what the extra 5,400 iterations cost.
  Each line's fuel must then be:
  - at least its iterations (one unit an iteration at the least);
  - at most 110% of its loop's share of D (3,000/5,400, 2,000/5,400 or 1,000/5,400);
  - at least 25% of that share;
  - in the ratio 3 : 2 : 1 within 10% of the others;
  - and the three together at most the step's fuel.

1. **The criterion**: the judgement finds nothing. It fails on a report that:
   - names lines by function;
   - lists them out of order or other than these three;
   - takes lines from another step;
   - counts instructions statically, or by anything other than executed fuel;
   - or names a worst step or fuel that disagree with the step records.
2. **The twin**: the bake still succeeds, and its report names exactly one line. That line is `step`'s first line in
   rules.rs (from 3 up to, but not including, 10: rules.rs:4 by its declaration, rules.rs:5 by its first instruction). The
   same judgement then fails on it, naming the lines it gave ("… not rules.rs:10, rules.rs:20 and rules.rs:30 in that
   order"). If the twin isn't there, or names zero lines or several, or names a loop's line, this test fails.

## Where this reads the criterion or the surface differently from 531's README

- **Its own program.** As above: in 531's `rules/`, the twin as named reports two lines. 531's row for criterion 11
  requires that it "names one line"; with `rules/` that can't hold.
- **The fuel bounds.** 531's README reads "each with its fuel" as "≥ its iterations, in proportion 3 : 2 : 1 within 10%,
  together ≤ the step's fuel". This keeps those and adds the bounds against D, so a line's fuel must match what the
  step's own counter spent on its loop.
  - The upper bound is tight (110%).
  - The lower bound is loose (25%). The build's DWARF puts 9 of each loop body's 22 instructions on line 0, and a report
    that splits a block's count across its instructions' lines may leave those out. That is still well above the 10% a
    report would show if it took its lines from a step with a tenth of the iterations.
- **"Names one line"** is checked on the twin's own `lines`. It is not inferred from the judgement failing.
