# Acceptance tests for #1468: a deep expression is refused instead of crashing the process

Written first, from issue #1468 (its measurement, scope and four acceptance criteria), the design section it links
and the base commit `ede4b367` ("Merge pull request #1284 …", main), by a job that never saw an implementation; none
existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this
job (design: Dogfooding).

## What was read

- Issue #1468: its measurement on main, Scope, Acceptance criteria, Proof, Not in scope.
- `docs/technical-design.md`: Dogfooding, "Tests written first, by a job that never sees the code".
  `docs/canvas-primitives.md`: The closed function list ("Parsing caps nesting at 64 levels across every recursive
  path (parentheses, unary operators, the conditional, powers and call arguments) …"; the node caps, 64 ops for a
  driver, 256 nodes for a field, 512 for a path function).
- At the base, for surfaces and conventions only: `crates/deep-canvas/src/expr.rs` (`Expr::compile`, `Refusal`,
  `Nothing`, `V`, the parser's recursive paths), `crates/deep-canvas-motion/src/program.rs` (a driver's `expr`
  compiled with `DRIVER_OPS`, refused at `{path}/expr`), `crates/deep-motion/src/main.rs` (`deep-motion eval`),
  `crates/deep-canvas-marks/src/animator.rs` (`lay_out`, `Input`, `Host`; a field selector's `expr` compiled with cap
  256 and refused at `…/field/expr`), `crates/deep-marks-render/src/raster.rs` (how the renderer calls `lay_out`),
  `crates/deep-canvas/src/document/packs.rs` (`Packs::admit`, `check_pack`, `read_rules`: a kind rule's `expr`
  refused at `{recipe path}/rules/{i}/expr`), `crates/deep-show/src/packs.rs` (how a manifest's recipes are inlined
  before admission), `Cargo.toml` (the dev profile builds deep-canvas, deep-canvas-marks and deep-canvas-motion at
  opt-level 3); `tests/acceptance/1312/` and `327/` (form; Rust suites as `[[test]]` targets),
  `tests/acceptance/492/helpers.ts` (a film document's shape for `deep-motion eval`), `tests/acceptance/490/fixtures/
  packs/easepack-1.0.0` (a pack with a kind rule and its twin), `scripts/proof-change.mjs` (criterion IDs).
- Not seen: any branch, worktree, PR or issue comment.

## Surfaces used

One file, `depth.rs`, the `[[test]]` target `acceptance_1468` in `crates/deep-motion/Cargo.toml` (that package has the
`deep-motion` binary and already depends on deep-canvas, deep-canvas-motion, deep-canvas-marks, deep-text and
serde_json; no dependency added).

- **The child harness.** A stack overflow aborts the whole process, so every expression runs in a child: the test
  binary re-executed as `--ignored --exact child_entry` with the case in `ACCEPTANCE_1468_CASE`. The child runs the
  case on a thread with a 1 MB stack and prints one `RESULT <json>` line. The parent fails a child that dies by
  signal, exits non-zero, prints no result or runs past 300 s (it is then killed by its own PID). `child_entry` is
  `#[ignore]`d and panics with no case named, so it never passes as a test of its own.
- **Timing.** Under load a child's start-up is noise, so the child times the `Expr::compile` call alone (`Instant`
  around it; the string is built before), and the parent compares that to 50 ms.
- Criteria 1 to 3: `deep_canvas::expr::Expr::compile(text, &Nothing, 256)` (a field's node cap, so depth 64 of every
  opener fits under the node cap and only the depth cap can refuse); a compiled one is evaluated with
  `Expr::eval`, x = 0 and y = 2.
- Criterion 4: a driver through the real `deep-motion eval` binary (`CARGO_BIN_EXE_deep-motion`), one JSON line in,
  its answer and exit read; a text animator's field through `deep_canvas_marks::animator::lay_out`, as the renderer
  lays out an animated text, in a child; a pack's kind rule through `deep_canvas::document::Packs::admit` in the core
  build (`deep_canvas::registry::core()`), in a child. At the base no single document check reaches all three: the
  core check never compiles a driver or a field, motion compiles drivers in its `compile` operator and `deep-motion
  eval`, marks compiles fields when a text is laid out, and the pack check compiles kind rules when a pack is admitted.

## How each criterion is read

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, white space collapsed.

"Depth n" is read as n repeats of one opener: n parens around `1` (`((…1…))`), n unary operators before `1`
(`--…-1`, `++…+1`, `!!…!1`), n nested calls around `1` (`abs(abs(…1…))`), n nested conditionals before `1`
(`x ? y : x ? y : … 1`) and n carets between n + 1 ones (`1^1^…^1`). Every such expression at depth 64 evaluates to 1.

| Criterion | Read as |
|---|---|
| AC1 `#1468.ded1c18b` In a child process, 1,000,000 repeats each of `(`, `-`, `!`, `abs(` and `x ? y : ` return a refusal in under 50 ms. A planted parser with no cap dies by signal and fails | For each opener, its depth-1,000,000 expression (above) compiled in a child on a 1 MB thread is refused, the compile call taking under 50 ms, and the child exits 0 (`ac1_a_million_repeats_…`). The planted parser, `planted` in `depth.rs`, a recursive-descent parser over the same openers with no cap, run on the same five strings through the same harness: each must die by signal and be judged a failure (`ac1_a_planted_parser_…`; it passes on the base, since it proves the harness). |
| AC2 `#1468.a5827afe` Depth 64 parses and evaluates on a 1 MB thread in a debug build. Depth 65 is refused, naming the cap | Every recursive path the scope names: `(`, `-`, `+`, `!`, `abs(`, `x ? y : ` and `^`. Depth 64 compiles and evaluates to 1 on a 1 MB thread in a child (`ac2_depth_64_…`; holds on the base). Depth 65 is refused, and the refusal's `why` holds the number 64 as a whole number (`ac2_depth_65_…`). |
| AC3 `#1468.ba3528c4` `2^2^2…` at 10,000 terms is refused the same way | `2^2^…^2` with 10,000 twos (9,999 carets), compiled in a child on a 1 MB thread, is refused with a `why` naming 64, and the child exits 0. |
| AC4 `#1468.b22b517b` A document holding such a string through a driver, a field and a pack rule gets a refusal naming the path, and the process stays up | "Such a string": 1,000,000 parens around a value. Driver: a film with one `rect@1` and the driver `deep` on `items/dot/at/pos/1`; `deep-motion eval` at t 0 answers `ok: false` with a `path` holding `drivers/deep/expr` and exits 0, not by signal. Field: a `text@1` "ABCDE" whose animator's first extra selector is `{field: {expr}}`; laid out at t 0 in a child it is refused with a path holding `items/words/params/animators/0/selectors/0/field/expr`, and the child exits 0. Pack rule: a pack `test/deeprule@1.0.0` whose kind `deeprule.probe@1` holds the rule `<string around x> >= 1`; admitting it is refused with an issue whose path holds `recipes/deeprule.probe@1/rules/0/expr`, and the child exits 0. Each place has an accepted twin with one paren (`(1)`, `(i)`, `(x) >= 1`), so the document reaches the compile and it is the depth that refuses. |

Readings the issue leaves open, and how this suite reads them:

- **Repeats as well-formed expressions.** "1,000,000 repeats of `(`" is completed to a well-formed expression (closed
  parens and calls, a final `1`), so only a depth cap can refuse it: a refusal for an unclosed paren after parsing a
  million levels would still overflow.
- **The stack.** AC2 names a 1 MB thread; every child case here runs on one, AC1's and AC3's included. AC4's driver
  runs on `deep-motion`'s own main thread, as a user's process would.
- **"Naming the cap"** is the refusal's reason (`Refusal::why`) holding 64. AC1 asks only for a refusal; its reason
  isn't read there. AC4 asks for the path; its reason isn't read there.
- **"The same way" (AC3)** is read as AC2's depth 65: refused, naming the cap, in a child that stays up. No time
  budget is applied to AC3.
- **"A debug build"** is plain `cargo test`, the dev profile, in which the workspace builds deep-canvas, deep-canvas-
  marks and deep-canvas-motion at opt-level 3; the test file and its planted parser build at opt-level 0.
- **The node cap.** Criteria 1 to 3 compile with a field's cap, 256: under a driver's, 64, depth 64 of `abs(` (65
  nodes) would be refused by the node cap, not the depth cap.
- **One document check.** The base has none that reaches a driver, a field and a pack rule together (Surfaces used),
  so each place is reached through its own entry, each its own case.

## Wrong programs each criterion names

- **Main (the base):** AC1, AC3 and all three AC4 cases die by stack overflow (signal 6); AC2's depth 65 compiles on
  every opener with no refusal. All for the issue's reason (`BASE-FAILURE.txt`). AC2's depth 64 and each AC4 twin
  hold on the base.
- **A parser with no cap** (AC1's planted parser): dies by signal on every opener, and the harness fails it.
- **A cap on some paths only** (say parens, not `^` or the conditional): AC2's depth 65 and AC3 on the missed path.
- **A cap tighter than 64, or one that counts the outer expression as a level:** AC2's depth 64.
- **A cap that refuses without naming it:** AC2's depth 65, AC3.
- **A cap checked after the tree is built, or a parse that grows with the depth first:** AC1's 50 ms on a million
  repeats, and its child dying.
- **A refusal that loses its place:** AC4's path checks.

## Run them

```sh
cargo test --locked -p deep-motion --test acceptance_1468
```

## What was run

On the base `ede4b367`, Linux aarch64, debug build, load average about 57 from other sessions, once: AC1's
million-repeat test fails (all five abort by signal 6), AC1's planted-parser test passes, AC2's depth 64 passes and
depth 65 fails (no refusal on any of the seven openers), AC3 fails (signal 6), the three AC4 tests fail (signal 6;
their twins are accepted). See `BASE-FAILURE.txt`. Not run: a fixed program (none exists), or macOS.
