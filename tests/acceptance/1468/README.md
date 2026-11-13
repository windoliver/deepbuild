# Acceptance tests for #1468: a deep expression is refused instead of crashing the process

Written first, from issue #1468 (its report, Scope and four acceptance criteria), the design sections it links and
the base commit `96b462a6` ("Merge pull request #2051 …", main), by a job that never saw an implementation; none
existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this
job (design: Dogfooding).

## What was read

- Issue #1468: the report (600 parens abort a debug `Expr::compile`), Scope, Acceptance criteria, Not in scope.
- `docs/technical-design.md`: Dogfooding, "Tests written first, by a job that never sees the code".
  `docs/canvas-primitives.md`: The closed function list (the 64-level cap across parentheses, unary operators, the
  conditional, powers and call arguments, refused with a reason naming the cap; node caps of 64 for a driver, 256 for
  a field, 512 for a path function).
- At the base, for surfaces and conventions only: `crates/deep-canvas/src/expr.rs` (`Expr::compile`, `eval`, `bound`,
  `Refusal`, `Nothing`, the parser's shape), `src/interval.rs` (`Iv`), `src/document/packs.rs` (`Packs::admit`,
  `check_pack`, `read_rules`: a kind rule's issue at `…/rules/<i>/expr`, a rule needs a planted twin; the unit tests'
  chart pack), `src/document/check.rs` (`check_packed`); `crates/deep-canvas-motion/src/program.rs` (a driver's
  refusal at `<path>/expr`) and `tests/bounds.rs` (a driver document); `crates/deep-canvas-marks/src/animator.rs`
  (`amounts`, a field selector's refusal at `items/<id>/params/animators/<k>/selectors/<j>/field/expr`, and the unit
  test `five_selectors_are_refused_and_a_field_reads_its_unit`, whose `i / n` over `ABCD` reads 0, 0.25, 0.5, 0.75),
  `src/modules.rs` (the text module reads `amounts` over the item's shaped run); `crates/deep-motion/src/main.rs`
  (`eval`); `crates/deep-marks-render` (not used: its gpui dependency doesn't build on this Linux machine at the
  base); `tests/acceptance/1312`, `490`, `496`, `1477` (forms, `INCONCLUSIVE:` messages, load readings);
  `scripts/proof-change.mjs` (criterion IDs).
- Not seen: any branch, worktree, PR, issue comment or history beyond the base's shallow clone.

## How it runs

`cargo test --locked -p deep-motion --test acceptance_1468` (registered in `crates/deep-motion/Cargo.toml`, the crate
that reaches the core's parser, motion's drivers through the `deep-motion` binary, the text module's field selectors
with the one shaper, and the pack check).

Every reading that could crash runs in a child process: the test binary run again with `DEEP_1468_CHILD=<mode>`,
which runs the ignored test `child` alone. The child works on a thread with a 1 MB stack and prints `RESULT <json>`
per step. A child that dies by a signal fails its criterion whatever the load. The 50 ms reading is the time from the
`Expr::compile` call to its result dropped, inside the child, building the string excluded. When the one-minute load
(`/proc/loadavg`, before and after the child, the greater) is at or above half the cores, a timing reads INCONCLUSIVE:
the test fails with a message starting `INCONCLUSIVE:`, never a pass. A wrong answer or a crash is a FAIL under load
too.

## Choices

- Depth n is n of the construct: n parens around `1`; n `-` or `!` before `1`; n `abs(` around `1`; n `x ? y : ` before
  `1`; for powers, n carets, `1^1^…^1` (n + 1 terms). The strings are well formed, so only their depth can refuse them.
- "Names the cap": the reason holds 64 as a number of its own and isn't the node cap's or a syntax refusal. Strings
  compile with a node cap of 512 (2^24 for AC1 and AC3), so the node cap never refuses them.
- AC1's "repeats each of": the five strings at 1,000,000 levels, well formed. The planted parser is this file's own
  recursive-descent parser of the same paths with no depth counter (`mod planted`).
- AC4's "such a string": 1,000,000 parens around the expression's own body (`t`, `i / n`, `x <= 1`). "A document
  through a driver": a film document evaluated by `deep-motion eval`. "A field": a text@1 item's animator field
  selector, read from the document by `deep_canvas_marks::animator::amounts` over the item's run from
  `deep_text::Shaper`, as the text module reads it. "A pack rule": a pack whose recipe kind holds a kind rule, admitted
  by `deep_canvas::document::Packs::admit`, then a board holding its kind checked by `check_packed`. "The process stays
  up": the same process answers the next request (a shallow document) after the refusal and exits 0.

## Criteria → tests

| Criterion | Tests |
|---|---|
| AC1 `#1468.ded1c18b` 1,000,000 repeats of `(`, `-`, `!`, `abs(`, `x ? y : ` refused in a child in under 50 ms; a planted parser with no cap dies by signal and fails | `ac1_a_million_opening_parens_…`, `ac1_a_million_minus_signs_…`, `ac1_a_million_bangs_…`, `ac1_a_million_abs_calls_…`, `ac1_a_million_conditionals_…`: the child exits 0, refuses naming 64, under 50 ms (INCONCLUSIVE under load). `ac1_a_planted_parser_with_no_cap_dies_by_signal_and_fails`: the planted parser on each of the five dies by signal and the same judge reads FAIL. |
| AC2 `#1468.a5827afe` depth 64 parses and evaluates on a 1 MB thread in a debug build; 65 refused naming the cap | `ac2_depth_64_parses_and_evaluates_on_a_1_mb_thread_in_a_debug_build`: in a child, on a 1 MB thread, each of the six constructs at 64 compiles, evaluates to 1 (the conditional to y = 5 when x is 1), its bound holds that value, and it drops; INCONCLUSIVE in a non-debug build. `ac2_depth_65_is_refused_naming_the_cap`: each at 65 is refused naming 64. |
| AC3 `#1468.ba3528c4` `2^2^2…` at 10,000 terms refused the same way | `ac3_a_power_tower_of_10000_terms_is_refused_the_same_way`: in a child on a 1 MB thread, refused naming 64. `ac3_a_planted_parser_with_no_cap_dies_on_the_tower_and_fails`. |
| AC4 `#1468.b22b517b` a document holding such a string through a driver, a field and a pack rule gets a refusal naming the path; the process stays up | `ac4_a_driver_…_deep_motion_stays_up` (path `drivers/d…/expr`, then the shallow film evaluates), `ac4_a_field_…` (path `items/word/params/animators/0/selectors/0/field/expr`, then `i / n` reads 0, 0.25, 0.5, 0.75), `ac4_a_pack_rule_…` (an issue at `…rules/0/expr`, then the shallow pack is admitted and its board checks). `ac4_the_same_documents_with_a_shallow_expression_evaluate`: the control, holding on the base, so the refusals are the deep strings'. |

## On the base

`BASE-FAILURE.txt` (96b462a6, debug, load 14.7 then 12.2 on 20 cores): 10 failed, 4 passed, 1 ignored (`child`).

- Failed by a child or `deep-motion` dying by SIGABRT ("has overflowed its stack"): the five AC1 tests, the AC3 tower
  test, and the three AC4 tests (`deep-motion eval` itself aborts on the driver).
- Failed on its assertion: `ac2_depth_65_is_refused_naming_the_cap`, as all six constructs parse at 65.
- Passed, as expected on the base: both planted-parser tests (the planted parser dies by signal and the judge reads
  FAIL), the depth-64 test (64 levels fit a 1 MB debug thread on the base) and the AC4 control.

The 50 ms reading is taken in the debug test build and includes everything the compile does with the string. Outside
this suite, a capped parse that first copies the 1–8 MB string into a `Vec<char>` measured 27–122 ms in debug under
a load of about 15, so a fix may need to refuse before scanning the whole text to read under 50 ms there.
