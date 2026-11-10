# rust-canvas-core: findings

Area: `crates/deep-canvas` and the ten small crates beside it (`deep-canvas-seams`, `-loop`, `-record`, `-sandbox`,
`-test-modules`, `-graph`, `-input`, `deep-sandbox-wasmtime`, `deep-input`, `deep-logic`).
Checkout: `the checkout`. Every path and line number is
origin/main 06fd33cd's (`git show 06fd33cd:<path>`). Nothing was built or run: every finding is from reading the
code, its callers and its tests, `rg`, `git log` and, for two numbers, `node -e`.

STATUS: IN PROGRESS. Slices C, D, E and F of `crates/deep-canvas` are still being read; this file holds slices A, B
and G only and will be replaced when they finish.

How it was read: the area is about 60,000 lines, so it was split in seven slices. The area reader read slice G (the
ten small crates) itself and re-checked the top findings of the others against the source; six slice readers, each
given the shared brief, read `crates/deep-canvas` (A registry, B packs and check, C the rest of document plus
session, D schedule, steps and cost, E expr, scope and grammar, F camera to base64). Each finding keeps its slice id
so its original text can be found in `scratchpad/rust-canvas-core-parts/<slice>.md`.

The lead has been editing this checkout while the readers read. At the time of writing the working tree differs
from 06fd33cd in five files of this area: `crates/deep-canvas/src/registry/core_lists.rs` (the `Rings` alias, G-11),
`crates/deep-canvas/src/schedule/mod.rs` (`OpError.actual` boxed), `crates/deep-canvas-sandbox/src/rewrite.rs`
(one cast), `crates/deep-canvas-input/src/track.rs` (an `#[allow]` on the planted lookup) and
`crates/deep-logic/README.md` (new). Line numbers below can be off by a few lines in those files.

## Counts

| kind | SURE | LIKELY | QUESTION | all |
|---|---|---|---|---|
| broken | 4 | 16 | 0 | 20 |
| inconsistent | 5 | 8 | 8 | 21 |
| inefficient | 0 | 1 | 0 | 1 |
| unneeded | 0 | 0 | 0 | 0 |
| all | 9 | 25 | 8 | 42 |

A finding whose confidence line names two levels (one for the fact, one for the fix) is counted at the first.

## Ranked index (worst first)

| # | slice id | kind | confidence | title |
|---|---|---|---|---|
| 1 | G-1 | broken | SURE | A logic item's `writes.count` is multiplied in u32 with no bound: a debug build panics, a release build wraps the region to a small size and admits the item |
| 2 | B-1 | broken | SURE | A recipe's `sum(k, a, b, term)` never ends once `a` reaches 2^53: the document check hangs |
| 3 | B-2 | broken | LIKELY | The incremental recheck drops or misses `over_budget` when the document names a `budget` |
| 4 | G-2 | broken | LIKELY | `Budget::of` casts whatever JSON gives it: a pack provider's `stack` past i32 lifts the rewrite's stack cap, and a negative `memory_mib` overflows |
| 5 | B-3 | broken | LIKELY | The recipe expression parser and its tree have no size bound: a long expression overflows the stack |
| 6 | G-4 | broken | LIKELY | A tour key at a negative time, or a period of one flick, makes deep-logic's `track()` loop without end |
| 7 | G-3 | broken | LIKELY | logic.determinism passes a sampled time it never seeks to |
| 8 | A-1 | broken | LIKELY | An entry whose value has no canonical form gets the digest `""` and is admitted |
| 9 | B-6 | broken | LIKELY | A step with op `mark`/`item`/`builder` whose kind is a recipe passes the check and draws nothing |
| 10 | B-10 | broken | LIKELY | A control or a time remap that is not an object passes with nothing checked |
| 11 | B-20 | broken | LIKELY | A `budget` the check can't read is skipped without an issue (rank: beside B-10) |
| 12 | B-4 | broken | LIKELY | `break_out` is always refused for an instance that repeats along a curve named by ID |
| 13 | B-5 | broken | LIKELY | Breaking out an item a nested recipe derived applies, then the instance stops expanding (`bad_id`) |
| 14 | A-2 | broken | LIKELY | A document that requires an earlier major with a minor or patch (`^1.2`, `~1.4`, `=1.3.0`) is refused although the module migrates |
| 15 | A-3 | broken | LIKELY | One module can register the same check kind twice; the seal refuses every other duplicate |
| 16 | B-7 | broken | LIKELY | An expression whose result is NaN or infinite becomes JSON `null` without an error |
| 17 | B-8 | broken | LIKELY | A step whose `when` is false still has its curve and count evaluated, and they can refuse the instance |
| 18 | G-6 | broken | LIKELY | A control whose `range` is written high-to-low panics the input session at the first drag or arrow key |
| 19 | G-5 | inconsistent | LIKELY | `algo: "pinned"` is honored by the view and ignored by the `layout` operator and by `deep-graph layout` |
| 20 | B-9 | inconsistent | LIKELY | A step `at` that gives no `pos` puts its item at the world origin, not the instance's |
| 21 | B-11 | inconsistent | LIKELY | `driven_counts` misses a count that reads its input through a `let`, and a spacing |
| 22 | B-12 | inconsistent | LIKELY | A recipe's channel silently replaces a document channel with the same ID |
| 23 | A-4 | inconsistent | LIKELY | The seal's two check-read refusals name no array, against their comment and their siblings |
| 24 | A-11 | inconsistent | LIKELY | `MODULE_CHECK_KINDS` has no row for the loop module, so its one shipped check kind is `module_missing` with no module named |
| 25 | G-7 | inconsistent | SURE | Salience reads `priority` from inside `facts`; its doc comment and the module's own fixture put it beside `facts` |
| 26 | A-6 | broken | SURE | `one_track` reports the wrong number of track hashes |
| 27 | B-17 | inconsistent | LIKELY | A failing recipe `let` is reported at `items/<id>/params/<let>`, a param that doesn't exist |
| 28 | B-19 | inconsistent | LIKELY | The repeat error names a missing count when it is `as` that is missing |
| 29 | G-8 | inconsistent | QUESTION | The web runtime hashes and restores f32/f64 globals through JS numbers; the app uses the raw bits |
| 30 | G-9 | inconsistent | QUESTION | The tour's laps differ between the input module and deep-logic |
| 31 | A-5 | inconsistent | QUESTION | A module's check kind never enters `check.kind.doc@1`, and that registry's kit would refuse it |
| 32 | A-10 | inconsistent | QUESTION | A reader of `earlier(x)` stays in the plan when x's writer is left out |
| 33 | B-14 | inconsistent | QUESTION | `relation_target`'s `frame` flag changes nothing |
| 34 | B-15 | inconsistent | QUESTION | `requires.core` is never compared with the build, in a document or a pack |
| 35 | B-16 | inconsistent | QUESTION | A `size` of zero or below passes the check and is refused at render |
| 36 | B-18 | inconsistent | QUESTION | `==` and `!=` never match a bool input, though every other operator reads a bool as 1 or 0 |
| 37 | A-7 | inconsistent | SURE | The doc comment of `Registry::declares` sits on `allows_bare` |
| 38 | A-8 | inconsistent | SURE | Two comments and a test name still say `cells@1` is the one bare module kind; the list holds 24 |
| 39 | A-9 | inconsistent | SURE | The module doc of `core_lists.rs` leaves out four of the fourteen registries it declares |
| 40 | B-13 | inconsistent | SURE | `check_key`'s doc comment opens with a sentence that describes `check_targets` |
| 41 | G-10 | inefficient | LIKELY | `deep_hash` copies the arrays and the whole memory before it hashes them |
| 42 | G-11 | broken | SURE | Known: `cargo clippy -D warnings` at `crates/deep-canvas/src/registry/core_lists.rs:863` |

## Findings

### rust-canvas-core-1  A logic item's `writes.count` is multiplied in u32 with no bound: a debug build panics, a release build wraps the region to a small size and admits the item
(slice id G-1; slice: the ten small crates)
- kind: broken
- confidence: SURE (the arithmetic); LIKELY (which bound to pick)
- where: `crates/deep-logic/src/piece.rs:432-435` (the only bound), `:631`, `:639`, `:694`, `:698` (the products and running sums), `:142` (`e.offset + e.size`), `:726` (the memory check, which reads the wrapped size); published at `crates/deep-logic/src/world.rs:880-887`
- evidence:
  ```rust
  let count = w.get("count").map_or(Some(1), Value::as_u64)
      .filter(|c| *c >= 1 && *c <= u32::MAX as u64);                         // piece.rs:432-435
  size: w.ty.size() * w.count,                                               // :694  u32 * u32
  at = align8(at + w.ty.size() * w.count);                                   // :698
  if u64::from(writes_at) + u64::from(layout.size("writes")) > memory {      // :726
  ```
  `Ty::size()` is 4 to 32 (`:82-90`). The piece is a user's: `deep-show` calls `deep_logic::piece::check` on a document's piece (`crates/deep-show/src/audio.rs:479`), and `deep-logic check` takes it from a JSON line.
- failure: `"writes": {"a": {"type": "quat", "count": 134217728}}` is 32 × 2^27 = 2^32. A debug build panics (`attempt to multiply with overflow`). A release build wraps the size to 0, so the write region fits any memory, the item is admitted, and every step publishes `a` as an empty array. `{"type": "f64", "count": 536870913}` wraps to 8 bytes and publishes one value. A reader of that array wraps the same way in the read region (`:631`, `:639`, `:678`).
- fix: bound the count by what a logic item's largest memory holds (64 MiB, `:469`), and refuse a total past it, so no product or sum reaches u32's end.
  `piece.rs:435` old `.filter(|c| *c >= 1 && *c <= u32::MAX as u64);` → new `.filter(|c| *c >= 1 && *c <= 64 * MIB / 4);`
  and before `if !refused.is_empty() {` at `:450` add
  ```rust
  let total: u64 = writes.iter().map(|w: &Write| u64::from(w.ty.size()) * u64::from(w.count) + 8).sum();
  if total > 64 * MIB {
      refused.push(refusal("write", "the writes pass a logic item's largest memory, 64 MiB".into(), json!({})));
  }
  ```
  The read region sums other items' arrays (`:678`); each is now at most 64 MiB, so 64 reads of one array could still wrap. Sum `at` there in u64 and refuse past 64 MiB the same way (a read region past memory already traps `bounds` at the first step, `world.rs:600-609`, so refusing at check changes when, not whether).
- verify: `{"call":"check","piece":{"seed":0,"assets":{…},"items":{"e":{"kind":"logic@1","params":{"program":"<sha>","writes":{"a":{"type":"quat","count":134217728}}}}}}}` to `deep-logic` must answer `logic_refused`; today a release build answers `ok: true` and a debug build dies.
- risk: none found. `rg 'count: ?[0-9_]{6,}' tests/acceptance/531 tests/acceptance/532` has no hit, so no test declares a count near the bound.

### rust-canvas-core-2  A recipe's `sum(k, a, b, term)` never ends once `a` reaches 2^53: the document check hangs
(slice id B-1; slice: crates/deep-canvas/src/document/ (packs.rs, check.rs))
- kind: broken
- confidence: SURE
- where: `packs.rs:2772-2790`
- evidence:
  ```rust
  2776  let (a, b) = (args[1].eval(scope)?, args[2].eval(scope)?);
  2777  if a.fract() != 0.0 || b.fract() != 0.0 || b - a + 1.0 > MAX_SUM {
  2778      return Err(format!("a sum runs over at most {MAX_SUM} whole k"));
  2779  }
  ...
  2782  let mut i = a;
  2783  while i <= b {
  2784      inner.push((k.clone(), number(i)));
  2785      total += args[3].eval(&inner)?;
  2786      inner.pop();
  2787      i += 1.0;
  2788  }
  ```
  The guard bounds `b - a + 1`, not the loop. For `a = b = 9007199254740992` (2^53) the guard passes (`b - a + 1 == 1`)
  and `i += 1.0` leaves `i` unchanged, so `i <= b` holds for ever. Checked: `node -e` gives
  `9007199254740992+1===9007199254740992` → `true`, `1e17+1===1e17` → `true`. The tokenizer takes a long digit run as
  one number (`packs.rs:2842-2847`, `3007`), and an `integer` input with no `max` passes any whole f64
  (`packs.rs:1188-1191`), so both a pack's text and a user's param reach it. Single call site: this arm of
  `Expr::value`. It runs in `expand_one` (lets, params, count, `when`), so inside `check_by` (`check.rs:168`), which
  deep-show calls on the patch path (`crates/deep-show/src/shared.rs:940`). The sibling `crate::expr` bounds its loop
  by a term counter (`crates/deep-canvas/src/expr.rs:1389`: `while k <= hi && n < MAX_TERMS`); this one does not. No
  test covers a sum in `packs.rs`; `git log -S'while i <= b'` → 9af641dd (#433).
- failure: a pack recipe with `"let": {"x": "sum(k, 9007199254740992, 9007199254740992, 1)"}`, or
  `"sum(k, n, n, k)"` with the instance's `n` set to `10000000000000000`: the check of any document that instances
  it spins for ever on the calling thread.
- fix: replace lines 2782-2788
  ```rust
                  let mut i = a;
                  while i <= b {
                      inner.push((k.clone(), number(i)));
                      total += args[3].eval(&inner)?;
                      inner.pop();
                      i += 1.0;
                  }
  ```
  with
  ```rust
                  // Counted, not stepped: past 2^53 `i + 1.0 == i`, and a stepped loop never ends.
                  let terms = (b - a + 1.0).max(0.0) as u64;
                  for j in 0..terms {
                      inner.push((k.clone(), number(a + j as f64)));
                      total += args[3].eval(&inner)?;
                      inner.pop();
                  }
  ```
  (`terms <= 256` by the guard above; `b < a` gives 0 terms as before; for |a| below 2^53 − 256 the k values are the
  same ones.)
- verify: add to `packs.rs` test `expressions_evaluate_over_scope`:
  `assert_eq!(e("sum(k, 9007199254740992, 9007199254740992, 1)"), 1.0);` (hangs before, passes after), plus
  `assert_eq!(e("sum(k, 1, 4, k)"), 10.0);`. Existing user: `packs/familiar-1.0.0/extrude@1.json:108`
  (`tests/acceptance/433`).
- risk: none seen; no test pins a hang.

### rust-canvas-core-3  The incremental recheck drops or misses `over_budget` when the document names a `budget`
(slice id B-2; slice: crates/deep-canvas/src/document/ (packs.rs, check.rs))
- kind: broken
- confidence: LIKELY (not run)
- where: `check.rs:673-685` (the guard), `check.rs:772-783` (the reduced document), `check.rs:483-511`
  (`lights_check`), `check.rs:517-565` (`budget_check`); caller `crates/deep-show/src/shared.rs:931`
- evidence: `recheck_by` checks a document of only the affected items and what they read, keeping every envelope
  member:
  ```rust
  683  if !maps_empty || sealed.has_costs() || packed {
  684      return None;
  685  }
  ...
  773  for (k, v) in after { if k != "items" { reduced.insert(k.clone(), v.clone()); } }
  ...
  783  let fresh = check_in(&Value::Object(reduced), sealed).issues;
  ```
  `check_in` → `budget_check` → `lights_check` counts `light.*` items of that reduced document against
  `budget.lights`, and `crate::cost::estimate_by` sums the reduced items against the class caps (`budget::of`,
  `crates/deep-canvas/src/budget.rs:104`). Both need every item. The comment at 678 says "The budget estimate sums the
  whole document, so a build whose modules cost needs it whole", but `has_costs()` is only the modules' registered
  `Cost` functions (`registry/mod.rs:1516`), and the only one in the tree is the test kit's
  (`crates/deep-show/src/kit/modules.rs:233`). So in every real build the recheck runs for a budgeted document.
  The fifth-law test (`mod.rs:596-672`) uses a document with no `budget`; `rg budget crates/deep-show/src/kit/fuzz.rs
  crates/deep-show/src/kit/engine.rs` → none.
- failure: a document with `"budget": {"lights": 2}` and two `light.sun@1` items; a patch creates a third. `changed` =
  {the new light}; the reduced document holds one light; `lights_check` raises nothing; the previous issues held
  none. The recheck returns no `over_budget`, the full check returns `over_budget` at `budget/lights` (an error), and
  deep-show accepts a patch the full check refuses. The other way: a document over its cap whose issue names
  `[l1, l2, l3]`; a patch sets a param of `l1`; the old issue touches `l1` and is dropped, the fresh check sees one
  light, and the error disappears while three lights remain. The class estimate (`budget.class`) fails the same way.
- fix: `check.rs:680-685`
  ```rust
      let packed = member(doc, "packs")
          .and_then(Value::as_array)
          .is_some_and(|p| !p.is_empty());
      if !maps_empty || sealed.has_costs() || packed {
          return None;
      }
  ```
  →
  ```rust
      let packed = member(doc, "packs")
          .and_then(Value::as_array)
          .is_some_and(|p| !p.is_empty());
      // A `budget` (its lights cap, its class estimate) counts every item, so it needs it whole too.
      let budgeted = member(doc, "budget").is_some();
      if !maps_empty || sealed.has_costs() || packed || budgeted {
          return None;
      }
  ```
- verify: in `mod.rs` beside `the_incremental_recheck_gives_the_full_checks_issues`: a document with
  `budget: {lights: 1}` and one `light.sun@1`, apply a create of a second light, assert
  `recheck(...)` is `None` (today it is `Some` without `over_budget`, while `check(&doc)` has it).
- risk: a budgeted document then takes the full check on every patch. Any acceptance timing of the patch path on a
  document with a `budget` would slow; `rg -l budget tests/acceptance/896 tests/acceptance/96` → none.

### rust-canvas-core-4  `Budget::of` casts whatever JSON gives it: a pack provider's `stack` past i32 lifts the rewrite's stack cap, and a negative `memory_mib` overflows
(slice id G-2; slice: the ten small crates)
- kind: broken (a sandbox limit that can be passed)
- confidence: LIKELY
- where: `crates/deep-sandbox-wasmtime/src/service.rs:77-82`; reached from a pack's provider spec at `crates/deep-show/src/sandbox.rs:390` and from the `deep-sandbox` lines at `service.rs:258`; the comparison it defeats is `crates/deep-canvas-sandbox/src/rewrite.rs:826-829`; the promise is `crates/deep-sandbox-wasmtime/src/lib.rs:21-23`
- evidence:
  ```rust
  let get = |k: &str| v.and_then(|b| b.get(k)).and_then(Value::as_i64);
  Budget {
      fuel: get("fuel").unwrap_or(fuel),
      stack: get("stack").unwrap_or(stack) as i32,
      memory: get("memory_mib").map_or(memory, |m| m as u64 * MIB),
  }
  ```
  The rewrite compares the stack unsigned (`e.i(I::I32GtU)`), and `NATIVE_STACK`'s comment says the 2 MiB native stack is "past any cap the rewrite charges against … so the rewrite's `stack` trap comes first". Nothing checks a pack's `providers.<p>.budget` before this (`rg '"budget"|providers' crates/deep-canvas/src/document/packs.rs` finds only the module-present test at `:369`).
- failure: (a) a pack provider with `"budget": {"stack": 4294967295}` gets cap −1, which is 4 GiB unsigned: the rewrite's check never fires, wasmtime's own 2 MiB stack overflows first, and the trap lands where the engine puts it (`kind` maps `StackOverflow` to `stack`, `lib.rs:239`, but the function and offset are the engine's, and a browser has another limit). `"stack": 4294967296` casts to 0, so every call traps `stack`. (b) `"memory_mib": -1` is `u64::MAX * MIB`: a debug build panics; a release build wraps to about 16 EiB, so `check` and `run` on a `deep-sandbox` line admit a memory of any size. deep-show checks a provider's memory against the default budget (`sandbox.rs:82`), so (b) does not reach a pack; (a) does.
- fix: clamp where the values are read. `service.rs:80-81`
  old `stack: get("stack").unwrap_or(stack) as i32,` → new `stack: get("stack").unwrap_or(stack).clamp(0, (2 << 20) - 1) as i32,`
  old `memory: get("memory_mib").map_or(memory, |m| m as u64 * MIB),` → new `memory: get("memory_mib").map_or(memory, |m| m.clamp(0, 4096) as u64 * MIB),`
  (2 MiB is `NATIVE_STACK`; 4096 MiB is the most a 32-bit memory holds.) A pack's `fuel` has no cap either: it runs to deep-show's wall-clock deadline. Whether `providers.<p>.budget` may raise the role's defaults at all is the owner's call; the design's `gen@1` paragraph (technical-design.md:1833) does not say.
- verify: the kit's budgets are `stack` 65536 and 262144 and `memory_mib` 16 (`crates/deep-canvas-sandbox/kit/kit.json`), all inside the clamp, so `cargo test -p deep-sandbox-wasmtime` and `tests/acceptance/238` see no change. `tests/acceptance/238/stack.test.ts:15` runs a `stack: cap` ladder over `CAPS = [65_536, 262_144]` (`programs.ts:37`), also inside the clamp.
- risk: a caller that relies on a stack cap of 2 MiB or more; none found.

### rust-canvas-core-5  The recipe expression parser and its tree have no size bound: a long expression overflows the stack
(slice id B-3; slice: crates/deep-canvas/src/document/ (packs.rs, check.rs))
- kind: broken
- confidence: LIKELY (the crash needs a crafted text; not run)
- where: `packs.rs:2618-2626` (`Expr::parse`), `2886-3037` (the recursive-descent parser), `2933-2953` (left-deep
  chains built in a loop), `2673-2818` (`value`/`eval` recurse the tree), `2561-2588` (`postfix`); callers on document
  text: `crates/deep-canvas-motion/src/doc.rs:1182`, `crates/deep-canvas-scene3d/src/sweep.rs:242`; on pack text:
  `Template::of` (`packs.rs:2413`) for every string in a recipe
- evidence: `Expr::parse` tokenizes and calls `p.cond()` with no cap on tokens, nesting or nodes. Each `(`, `[`,
  call argument and `?:` branch re-enters `cond → or → and → compare → sum → product → unary → postfix → atom`, and
  `unary` re-enters itself per `-`/`!`. `a+a+a+…` makes a left-deep `Expr::Bin` chain as deep as it is long, which
  `value`, `free`, `postfix::walk`, `Clone`, `PartialEq` and `Drop` then recurse. `postfix` is called on a document's
  `drivers/<id>/expr` (`doc.rs:1182`: `postfix(text).unwrap_or_default()`) and a sweep's `along/scale`, so the text is
  a user's scene as well as a pack. The sibling `crate::expr::Expr::compile` caps nodes after it parses
  (`expr.rs:1105-1122`); its parser was not read (outside this slice) and may share the parse-time half.
- failure: a recipe param or a driver `expr` of some tens of thousands of `(` (or `-`), or an `a+a+…` chain of that
  length: stack overflow, which aborts the process (not a catchable panic).
- fix: bound both in `Expr::parse` and the parser. In `Expr::parse` after `let tokens = tokenize(text)?;` add
  ```rust
          if tokens.len() > MAX_TOKENS {
              return Err(format!("an expression has at most {MAX_TOKENS} tokens"));
          }
  ```
  with `const MAX_TOKENS: usize = 1024;` beside `MAX_SUM`, and give `Parser` a `depth: usize` that `cond()` and the
  `-`/`!` arms of `unary()` raise on entry, refuse past 64 and lower on exit. The caps are a guess to be set by
  the lead: the one shipped sum (`packs/familiar-1.0.0/extrude@1.json:108`) is one line and nests 3 deep, and the
  only strings over 300 characters in `packs/` are descriptions, which `Template::of` never reads.
- verify: a unit test: `Expr::parse(&"(".repeat(100_000))` and `Expr::parse(&vec!["1"; 100_000].join("+"))` return
  `Err` (today the first overflows in the parser, the second on drop or eval).
- risk: a `Template::of` string past the cap becomes `Form::Literal` (text), as any unparsed string does. No test
  holds an expression near either cap.

### rust-canvas-core-6  A tour key at a negative time, or a period of one flick, makes deep-logic's `track()` loop without end
(slice id G-4; slice: the ten small crates)
- kind: broken (a hang and unbounded memory on a user's piece)
- confidence: LIKELY
- where: `crates/deep-logic/src/lib.rs:164-207`; the sibling that does not have the bug is `crates/deep-canvas-input/src/session.rs:1303-1322`
- evidence:
  ```rust
  let period = if looping { keys.iter().flat_map(|(_, k)| k.iter().map(|(t, _)| *t)).max().unwrap_or(0) } else { 0 };
  for lap in 0.. {
      let at = start + lap * period;
      if at > end || (lap > 0 && period == 0) { break; }
      for (t, value) in &ks { if at + t <= end { entries.push(…) } }
  }
  ```
  `flicks()` (`:126-134`) returns a negative number for negative seconds and nothing checks a key's time. The input module starts its maximum at 0 (`let mut last = 0;`), so its period is never negative.
- failure: `"tour": {"keys": {"speed": [[-1, 0.5]]}}` gives a period of −705,600,000: `at` falls every lap, never passes `end`, and every lap pushes an entry, so `bake`, `golden`, `budget`, `determinism`, `open` and `view` never answer and memory grows until the process dies. A single key at `1e-9` s gives a period of 1 flick and billions of laps.
- fix: `lib.rs:190` old `if at > end || (lap > 0 && period == 0) {` → new `if at > end || (lap > 0 && period <= 0) {`, and refuse a negative key time where the keys are read (`:173`): old `Some((flicks(k.get(0)?.as_f64()?), k.get(1)?.as_f64()?))` → new `Some((flicks(k.get(0)?.as_f64().filter(|t| *t >= 0.0)?), k.get(1)?.as_f64()?))` (the caller then answers `bad_input: track`). A floor on the period (one step) is a design call; the input module's `advance` (`session.rs:499-521`) loops per period too.
- verify: `{"call":"open","piece":{"seed":0,"items":{},"tour":{"keys":{"a":[[-1,1]]}}}}` must answer; today it does not return.
- risk: none found. The one tour in the suites is `tests/acceptance/531/ac02-seed.test.ts:22` (`[[0.6, 1, 'hold']]`, `loop: false`).

### rust-canvas-core-7  logic.determinism passes a sampled time it never seeks to
(slice id G-3; slice: the ten small crates)
- kind: broken (a check that passes with a part unrun)
- confidence: LIKELY
- where: `crates/deep-logic/src/checks.rs:214-217` (the skip) and `:176-179`, against `crates/deep-logic/src/lib.rs:310-314` (the bake's own seek refuses the same case); the module doc at `checks.rs:1-6`
- evidence:
  ```rust
  for &s in at {
      let Some(next) = ring.iter().copied().find(|c| *c > s) else {
          continue;
      };
  ```
  and in `lib.rs` `seek`: `.find(|c| *c > to).ok_or_else(|| bad("seek: no checkpoint after it"))?`. The doc says the bake runs "once from each checkpoint before each sampled time".
- failure: `{"call":"determinism","steps":100,"at_times":[1.5]}` at 60 Hz with `checkpoint.every` 60: step 90 has checkpoints 0 and 60 before it and none after, so the seek, its probes and its comparison are skipped, and the verdict is `PASS` on the "twice" run alone. A sample past the bake (`[60]`) is skipped the same way, and an empty `at_times` passes with no seek at all.
- fix: do not pass a sample that was not run. `checks.rs:215-217` old `else { continue; };` → new
  ```rust
  else {
      return Ok(json!({"ok": true, "kind": "logic.determinism", "verdict": "BLOCKED", "failures": [],
          "ask": format!("logic.determinism sampled step {s}, which has no checkpoint after it in a bake of {steps} steps; it hasn't run")}));
  };
  ```
  (the reply shape `lib.rs:539-543` already uses for `compare`). `BLOCKED` or a `bad_input` refusal is the owner's call.
- verify: `tests/acceptance/532/ac01-flock-determinism.test.ts` must still pass; a call with `at_times` past the last checkpoint must not answer `PASS`.
- risk: a caller that samples the last second of a bake starts getting BLOCKED. `rg at_times tests/acceptance/532` shows the README shape and one helper; nothing pins the skip.

### rust-canvas-core-8  An entry whose value has no canonical form gets the digest `""` and is admitted
(slice id A-1; slice: crates/deep-canvas/src/registry/)
- kind: broken (unchecked error)
- confidence: LIKELY
- where: `crates/deep-canvas/src/registry/lists.rs:357-359` (`d1`), `:120-122` (`RegistryDef::digest`),
  `:353-355` (`entry_digest`), `:709` (the seal); `crates/deep-canvas/src/document/packs.rs:591` and
  `crates/deep-show/src/sandbox.rs:192` (pack and sandbox entries)
- evidence:
  ```rust
  // lists.rs:357
  fn d1(v: &Value) -> String {
      crate::canon::revision_hash(v, &crate::canon::NoShape).unwrap_or_default()
  }
  ```
  `revision_hash` fails in two cases (`crates/deep-canvas/src/canon.rs:153-157`, `:332-338`): two object keys
  that are one key after NFC, and an integer no f64 holds exactly (`"{n} is not exact in an f64"`). The sibling
  `d1` in `registry/mod.rs:3514` returns the `Result`, and every caller there maps the error to a `bad_shape`
  refusal (`mod.rs:2989`, `:3033`). `lists.rs` drops it. `packs.rs` never canonicalizes the entry before
  line 591 (`rg "canon::|CanonError|canonical_bytes" crates/deep-canvas/src/document/packs.rs` → no hit; the
  manifest digest at `packs.rs:601` goes through `schedule::canonical`, which falls back to plain serde bytes
  instead of failing).
- failure: a pack fills `data.layout@1` (fill: `module, first_party_pack, pack`) with
  `{"validator": "v", "max_bytes": 9007199254740993, "twins": ["t"], "judged": [{"asset": "t", "valid": false}], "doc": "d"}`.
  The schema asks only `integer` for `max_bytes`, no kit rule reads it, so the entry is admitted and
  `deep://registries` lists it with `"digest": ""`. The same value with 9007199254740995 also lists `""`, so
  the digest ("frozen per version", `lists.rs:352`) no longer tells two values apart. A module's entry does the
  same at the seal (`lists.rs:709`), and the empty string is then hashed into the module's digest part
  (`lists.rs:460`).
- fix (smallest, keeps `entry_digest`'s signature and its 5 outside callers): refuse where an entry is admitted.
  `lists.rs:709`
  ```rust
  // old
          let digest = entry_digest(&e.registry, &e.name, &e.value, &e.since);
  // new
          let digest = entry_digest(&e.registry, &e.name, &e.value, &e.since);
          if digest.is_empty() {
              return Err(SealError::new(
                  "entry_refused",
                  &who,
                  &[],
                  format!("`{}` in `{}` has no canonical form, so no digest", e.name, e.registry),
              )
              .at(&e.registry, vec![name], &[]));
          }
  ```
  and the same test before `out.push` at `packs.rs:583` (push `refuse(json!({"registry": name, "entry": entry}), …)`
  and `continue`). The cleaner fix is `d1 -> Result` as in `mod.rs`, which touches `kinds.rs:375, 459, 905` and
  `sandbox.rs:192` in deep-show too.
- verify: a unit test in `lists.rs` tests: `entry_digest("t@1", "x", &json!({"n": 9007199254740993u64}), "R2")`
  is `""` today; a seal of a test module filling that value must fail `entry_refused` after the fix.
- risk: none found. No registry test fills an entry with such a number (`rg -l "9007199254740993|not exact in an f64" crates tests`
  → `canon.rs` and `tests/acceptance/14`, `311`, none about registries). Marked LIKELY, not SURE, because the
  lead should pick between the two fixes, and because I did not trace whether the hub hands a pack's
  `data.layout@1` entry to `packs.rs:591` or to `deep-show/src/sandbox.rs:192` first (both call `entry_digest`).

### rust-canvas-core-9  A step with op `mark`/`item`/`builder` whose kind is a recipe passes the check and draws nothing
(slice id B-6; slice: crates/deep-canvas/src/document/ (packs.rs, check.rs))
- kind: broken (a check that passes with nothing checked)
- confidence: LIKELY (not run)
- where: `packs.rs:785-809` (the pack check never ties `op` to the kind), `packs.rs:1515-1523` (instances are listed
  before any expansion), `packs.rs:2197` (only `op == "recipe"` nests), `check.rs:1234` and `check.rs:1343`
- evidence: `expand` collects the instances from the document's items once, so an item a step writes is never
  expanded unless its step's op is `recipe`. The derived item keeps the recipe kind; `KindFacts::of` marks it
  `instance` (`check.rs:1234: let instance = resolved.recipe(text).is_some();`) and `check_item` treats it as
  expanded: `1343: Lookup::UnknownKind if instance => None,` with no notice, no issue, no draw.
- failure: `nest.box` with `"inner": {"op": "mark", "kind": "nest.leaf@1"}` (the test's `nested()` with `mark` for
  `recipe`): the pack is admitted, the document checks `ok`, `n1.inner` is in `lowered` as an unexpanded
  `nest.leaf@1`, and nothing of the leaf draws.
- fix: refuse it at expansion. `packs.rs:2197`, before `if step.op == "recipe" {`, add
  ```rust
              if step.op != "recipe" && resolved.recipe(&step.kind).is_some() {
                  issues.push(Issue::error(
                      "out_of_range",
                      id,
                      at(&format!("steps/{}/op", step.id)),
                      json!(step.op),
                      &format!("`{}` is a recipe, which a step nests with op `recipe`", step.kind),
                  ));
                  return None;
              }
  ```
  (The other reading, nesting whatever the op, is `if step.op == "recipe" || resolved.recipe(&step.kind).is_some()`.)
- verify: unit test with the recipes above; today `result.ok` and `draws` lacks `n1.inner.r`.
- risk: a shipped recipe that relies on it would start failing. None does: the kinds under an `op` in `packs/` are
  `arch.roof|slab|wall@1` (scene3d's, `crates/deep-canvas-scene3d/src/building.rs`), `ball@1`, `camera@1`,
  `extrude@1`, `lathe@1`, `light.point@1`, `light.spot@1`, `material@1`, `plate@1`, `slab@1`, `tube@1`; none is a
  recipe of a pack.

### rust-canvas-core-10  A control or a time remap that is not an object passes with nothing checked
(slice id B-10; slice: crates/deep-canvas/src/document/ (packs.rs, check.rs))
- kind: broken (a check that passes with nothing checked)
- confidence: LIKELY (not run)
- where: `check.rs:1990-1993`, `check.rs:2030-2033`
- evidence:
  ```rust
  1990  for (key, entry) in entries {
  1991      let Some(fields) = entry.as_object() else {
  1992          continue;
  1993      };
  ```
  and the same at 2031. The doc comment (1981-1983) says "A control without one [a role] is refused, naming the
  control and the field; the section and its keys are `check_id_maps`'s", but `check_id_maps` (1961-1979) checks keys
  only ("whatever its entries hold"). The sibling `check_targets` refuses the same shape (`2093-2101`: "not an
  object"). The motion module refuses it later, at compile, as `bad_doc`
  (`crates/deep-canvas-motion/src/doc.rs:643-645`), so the check and the module disagree.
- failure: `"controls": {"knob": 5}` or `"time_remaps": {"r": "reverse"}`: `check(doc).ok`; no role issue, no target
  issue.
- fix: both places, `continue;` →
  ```rust
              issues.push(Issue::error(
                  "out_of_range",
                  key,
                  format!("controls/{key}"),      // "time_remaps/{key}" at 2031
                  entry.clone(),
                  "not an object",
              ));
              continue;
  ```
- verify: `mod.rs` test beside the controls tests: `check` of a base document with `controls: {"knob": 5}` is not ok.
- risk: a test document with a non-object entry in these two maps would start failing; none found (a regex for
  `"controls": {"<id>": <scalar or list>` over `crates` and `tests/acceptance`, Rust and TS spellings, → no hit; not
  exhaustive for documents built in code).

### rust-canvas-core-11  A `budget` the check can't read is skipped without an issue (rank: beside B-10)
(slice id B-20; slice: crates/deep-canvas/src/document/ (packs.rs, check.rs))
- kind: broken (a check that passes with nothing checked)
- confidence: LIKELY (not run)
- where: `check.rs:484-489` (`lights_check`), `check.rs:524-526` (`budget_check`),
  `crates/deep-canvas/src/budget.rs:102-106`
- evidence: `budget.rs:103` says of `budget::of`: "`None` when it names no class (or one that isn't a class, which
  the check refuses)". The check does not: `524: let Some((class, limits)) = crate::budget::of(lowered) else { return; };`
  and nothing else in `crates/deep-canvas/src` reads `budget` to validate it
  (`rg '"budget' crates/deep-canvas/src` → `budget.rs:105`, `shape.rs:137`, the envelope key list, and these two
  functions). The lights cap is read with `as_u64` (486), so `-1`, `2.5` or `"2"` is no cap.
- failure: `"budget": {"class": "work-product"}` (the name is not one `Class::parse` takes), or `"budget": 5`, or
  `"budget": {"lights": "2"}`: the check is `ok`, no estimate runs, no cap holds.
- fix: at the top of `budget_check`, before `lights_check(lowered, issues);`:
  ```rust
      if let Some(budget) = member(lowered, "budget") {
          let mut bad = |path: &str, actual: &Value, what: &str| {
              issues.push(Issue::envelope("out_of_range", path.into(), actual.clone(), what));
          };
          if !budget.is_object() {
              bad("budget", budget, "not an object");
          }
          if let Some(class) = member(budget, "class") {
              if class.as_str().and_then(crate::budget::Class::parse).is_none() {
                  bad("budget/class", class, "not a budget class");
              }
          }
          if let Some(lights) = member(budget, "lights") {
              if lights.as_u64().is_none() {
                  bad("budget/lights", lights, "not a whole number at or above 0");
              }
          }
      }
  ```
- verify: `mod.rs` test: `check` of a base document with `budget: {class: "nope"}` is not ok.
- risk: `crates/deep-show/src/watch.rs:808-809` falls back to `WorkProduct` for a class it can't parse, so some
  caller may hand in documents with other class text; a test document with such a budget would start failing. Not
  searched beyond `crates/deep-canvas`.

### rust-canvas-core-12  `break_out` is always refused for an instance that repeats along a curve named by ID
(slice id B-4; slice: crates/deep-canvas/src/document/ (packs.rs, check.rs))
- kind: broken
- confidence: LIKELY (not run)
- where: `packs.rs:1601-1637` (`derived_of`), `packs.rs:1922-1942` and `1679-1686` (the curve lookup);
  caller `apply.rs:1329-1337`
- evidence: `derived_of` expands the instance in a scratch map that holds only the instance and its broken-out items:
  ```rust
  1609  let mut scratch = Map::new();
  1610  scratch.insert(instance.to_string(), item.clone());
  ```
  `expand_one` reads a curve item out of the map it is given (`1929: match curve_points(items, &named)`;
  `1681: Value::String(id) => member(items.get(id)?, "params")`). The curve item is not in the scratch map, so
  `curve_points` is `None`, `expand_one` returns `None` (1939) and `derived_of` returns `None`. `break_out` turns that
  into `ref_unresolved … "not a recipe instance that expands in this build"` (`apply.rs:1329-1337`). The only
  break-out tests use a flat recipe (`packs.rs:3263`, `tests/acceptance/306/break-out.test.ts`); the curve test
  (`packs.rs:3509`) never breaks out.
- failure: the document of `copies_along_a_curve_stand_at_their_arc_lengths_turned_to_it` (`rail` input naming the
  item `rail`), then `{"op": "break_out", "instance": "n1", "item": "n1.post.1"}` → refused, naming the instance as no
  recipe instance, though the check expanded it.
- fix: expand against the document's items and return what the old map held. `packs.rs:1609-1636`
  ```rust
      let mut scratch = Map::new();
      scratch.insert(instance.to_string(), item.clone());
      // The items it broke out before, which its `broken_out` must find.
      for broken in member(item, "broken_out")
          ...
      }
      let mut issues = Vec::new();
      let mut order = 0;
      expand_one(
          &mut scratch,
          ...
      )?;
      scratch.shift_remove(instance);
      Some(scratch)
  ```
  →
  ```rust
      // The document's items, which the recipe's curves and broken-out IDs are read from.
      let mut scratch = items.clone();
      let mut issues = Vec::new();
      let mut order = 0;
      let expansion = expand_one(
          &mut scratch,
          instance,
          item.clone(),
          (pack, recipe),
          resolved,
          std::slice::from_ref(&recipe.id),
          Planted::default(),
          &mut order,
          &mut issues,
      )?;
      // What it writes now, and what it broke out before, as the document holds them.
      let mut out = expansion.derived;
      for id in &expansion.broken_out {
          if let Some(held) = items.get(id) {
              out.insert(id.clone(), held.clone());
          }
      }
      Some(out)
  ```
  (One clone of the items per `break_out` op. The cheaper form copies only the items the instance's `ID` inputs
  name into the old scratch map and removes them after.)
- verify: extend `copies_along_a_curve_…` or `a_derived_item_is_no_patch_target_until_broken_out_…` with a break-out
  of `n1.post.1`; `tests/acceptance/306/break-out.test.ts` must still pass. The kept broken-out entries preserve
  `apply.rs:1368`'s "already broken out" answer for an item broken out before.
- risk: `break_out` is the only caller (`rg derived_of crates` → `apply.rs:1329`).

### rust-canvas-core-13  Breaking out an item a nested recipe derived applies, then the instance stops expanding (`bad_id`)
(slice id B-5; slice: crates/deep-canvas/src/document/ (packs.rs, check.rs))
- kind: broken
- confidence: LIKELY (traced by hand; not run)
- where: `packs.rs:1664-1676` (`derives`), `1818-1854` (the instance's `broken_out`), `2090-2102` (the clash check),
  `2228-2244` (the nested expansion); `apply.rs:1317-1379`
- evidence: for the test recipes `nest.box` → step `inner` (op `recipe`) → `nest.leaf` → step `r`
  (`packs.rs:3407-3423`), `break_out {instance: "n1", item: "n1.inner.r"}`: `derived_of` holds `n1.inner.r`, so
  the op applies and `n1.broken_out = ["n1.inner.r"]`. At the next check `derives(box, "n1", "n1.inner.r")` is true
  only by accident: `rest = "inner.r"`, `"r".parse::<u64>()` fails, so `index` is `None` and matches the unrepeated
  step `inner` (`1668-1675`). The outer loop then expands `n1.inner` with a scratch copy of the items (2230), which
  now holds the broken-out `n1.inner.r`; the nested instance has no `broken_out` of its own, so
  ```rust
  2090  if items.contains_key(&derived_id) && !broken_out.contains(&derived_id) {
  2091      issues.push(Issue::error("bad_id", id, format!("items/{derived_id}"), …
  ```
  refuses the whole instance. Under a repeated recipe step (`n1.inner.3.r`) `derives` is false, so the same op leaves
  `out_of_range … "not a derived ID of this instance"` instead, and `is_derived` (`1641-1660`) never recognises such
  an ID, so a patch aimed at it is not answered with `derived_item`.
- failure: after the break-out the document fails its check with `bad_id` "the document holds an item at the ID
  `nest.leaf` expands to" and `n1` draws nothing; deep-show then refuses the patch with that text. A nested derived
  item can't be broken out at all, and nothing says so.
- fix: needs a decision. Either hand the outer list down (in the nested branch before `expand_one`, put the entries
  of `broken_out` that start with `"{derived_id}."` into the nested item's `broken_out`), or refuse the op in
  `break_out` when the item is not `<instance>.<step>[.<index>]` of the instance's own recipe. Not a hand-sized edit
  without a test.
- verify: a unit test beside `a_recipe_step_nests_its_recipe_under_its_own_derived_id`: break out `n1.inner.r`, then
  `check_packed(...).ok`.
- risk: none pinned (`rg break_out tests/acceptance` → 306 only, flat recipe).

### rust-canvas-core-14  A document that requires an earlier major with a minor or patch (`^1.2`, `~1.4`, `=1.3.0`) is refused although the module migrates
(slice id A-2; slice: crates/deep-canvas/src/registry/)
- kind: broken
- confidence: LIKELY
- where: `crates/deep-canvas/src/registry/mod.rs:1402-1419` (`migrates_from`), reached from `satisfies`
  (`:1397`) at `crates/deep-canvas/src/document/check.rs:984` and `document/packs.rs:307, 1441`
- evidence:
  ```rust
  /// … so a range an earlier major matches is met while every kind of the module carries its steps.
  migrating
      && (1..m.version.major).any(|major| {
          range.matches(Semver { major, minor: 0, patch: 0 })
      })
  ```
  Only `<major>.0.0` is tried. The range comes from the document's `requires.modules` (user data).
- failure: module `b` at 2.0.0, every kind with a migration from major 1. `"requires": {"modules": {"b": "^1"}}`
  passes (1.0.0 matches). `"^1.2"`, `"~1.4"`, `"=1.3.0"` or `">=1.1.0, <2.0.0"` all fail with
  `out_of_range: the document requires the b module at ^1.2; this build has 2.0.0`, because 1.0.0 is below each
  lower bound. Every one of those ranges is matched by some 1.x version, which is what the doc comment promises.
  The conformance kit's fixtures write `"^1"` and `"^2"` (`crates/deep-show/src/kit/modules.rs:84, 1336`), so
  nothing sees it.
- fix: ask the range whether any version of the major matches, not whether `major.0.0` does. In `semver.rs` add
  (after `matches`):
  ```rust
      /// True when some version of `major` satisfies every bound.
      pub fn admits_major(&self, major: u64) -> bool {
          let top = |maj: u64, min: u64, pat: u64| Semver { major: maj, minor: min, patch: pat };
          let (mut lo, mut hi) = (top(major, 0, 0), top(major, u64::MAX, u64::MAX)); // inclusive
          for bound in &self.bounds {
              let (l, h) = match *bound {
                  Bound::Any => continue,
                  Bound::Exact(e) => (e, e),
                  Bound::AtLeast(l) => (l, hi),
                  Bound::Below(h) if h == top(0, 0, 0) => return false,
                  Bound::Below(h) => (lo, before(h)),
                  Bound::Tilde(l, w) => (l, if w == 1 { top(l.major, u64::MAX, u64::MAX) } else { top(l.major, l.minor, u64::MAX) }),
                  Bound::Caret(l, w) => (l, if l.major > 0 || w == 1 { top(l.major, u64::MAX, u64::MAX) }
                      else if l.minor > 0 || w == 2 { top(0, l.minor, u64::MAX) } else { l }),
              };
              lo = lo.max(l);
              hi = hi.min(h);
          }
          lo <= hi
      }
  ```
  with `fn before(v: Semver) -> Semver` giving the largest version below `v` (patch − 1, else minor − 1 with
  patch `u64::MAX`, else major − 1 with both `u64::MAX`), and in `mod.rs:1412-1418`:
  `(1..m.version.major).any(|major| range.admits_major(major))`.
  This is about 30 lines, so it is the lead's call whether it belongs in this pass or in an issue.
- verify: in `mod.rs` tests, seal a module at 2.0.0 whose one kind has majors 1 and 2 with a 1→2 step, then
  `assert!(sealed.satisfies("b", &Range::parse("^1.2").unwrap()))`: fails today, passes after.
- risk: `"^1"` keeps passing (1.0.0..1.MAX.MAX is inside). No test pins the refusal of `^1.2`
  (`rg '"\^1\.[0-9]|"~1|"=1\.' crates/deep-show/src/kit tests/acceptance/138` → no hit). The sketch above was
  not compiled.

### rust-canvas-core-15  One module can register the same check kind twice; the seal refuses every other duplicate
(slice id A-3; slice: crates/deep-canvas/src/registry/)
- kind: broken
- confidence: LIKELY
- where: `crates/deep-canvas/src/registry/mod.rs:2349-2353`
- evidence:
  ```rust
  // One registry: a module's check kind is neither the core's nor another's.
  let taken = CORE_CHECK_KINDS.contains(&c.kind.as_str())
      || shapes.iter().any(|(other, o)| {
          other != name && o.checks.iter().any(|x| x.kind == c.kind)
      });
  ```
  `other != name` skips the module's own list. Operators (`duplicate_operator`, `:2408`), arrays and tables
  (`two_writers`, `:1896`, `:1957`) and kinds (`two_kinds`, `:2254`, which catches the same module too) are all
  refused when one module registers a name twice.
- failure: `r.check("c.audit", "any", &["a"], run1); r.check("c.audit", "same", &["b"], run2);` seals.
  `Sealed::check_kind` (`:1611`) returns the first, so `run2` never runs; `check_kinds()` (`:1586`) lists
  `c.audit` twice; and `module_shapes` writes both under the one key `check c.audit` (`:3433-3438`), keeping
  only the last in the map an `interface_digest` refusal reads.
- fix:
  ```rust
  // old
                      || shapes.iter().any(|(other, o)| {
                          other != name && o.checks.iter().any(|x| x.kind == c.kind)
                      });
  // new
                      || shapes
                          .iter()
                          .flat_map(|(_, o)| &o.checks)
                          .filter(|x| x.kind == c.kind)
                          .count()
                          > 1;
  ```
  The message (`check … is already in the document check registry`) still reads right.
- verify: add to `places_machines_tools_and_interfaces_are_closed` a module that calls `r.check("c.audit", "any", &[], …)`
  twice and expect `duplicate_check_kind`; it seals today.
- risk: no shipped or test module registers a kind twice. I listed every `r.check(` in `crates/`
  (`deep-canvas-loop/src/lib.rs:82`, `deep-show/src/test_machines.rs:181, 207, 214`,
  `deep-canvas-test-modules/src/registries.rs:89`, `lib.rs:791`): six distinct names.

### rust-canvas-core-16  An expression whose result is NaN or infinite becomes JSON `null` without an error
(slice id B-7; slice: crates/deep-canvas/src/document/ (packs.rs, check.rs))
- kind: broken
- confidence: LIKELY (not run)
- where: `packs.rs:2538-2544` (`number`), `packs.rs:2683` (`let n = |x: f64| -> Result<Value, String> { Ok(number(x)) };`),
  consumers `packs.rs:2009` (`when`), `2074-2077` (params), `1899` (lets)
- evidence: `number(n)` falls to `json!(n)` when `n.fract() == 0.0` is false, which it is for NaN and ±inf, and
  `serde_json`'s `From<f64>` gives `Value::Null` for a non-finite float. Only `/` and `%` by zero are refused (2758).
  `sqrt`, `asin`, `acos` are libm's (`crates/deep-canvas/src/ops.rs:19, 113, 119`) and return NaN out of domain;
  `pow` and `*` overflow to inf; a 400-digit literal parses to inf (`3007`).
- failure: step `"when": "sqrt(n - 5)"` with `n = 3`: `truthy(Null)` is false, so the step is left out silently.
  Step param `"h": "sqrt(n - 5)"`: the derived item gets `"h": null`; an F32 param then reports `bad_unit` "neither a
  number nor a unit literal" on a derived item the writer can't edit (`check.rs:1875-1886`), and a `Json` param takes
  the null unchecked (`check.rs:1845`).
- fix: `packs.rs:2683`
  ```rust
          let n = |x: f64| -> Result<Value, String> { Ok(number(x)) };
  ```
  →
  ```rust
          let n = |x: f64| -> Result<Value, String> {
              if x.is_finite() {
                  Ok(number(x))
              } else {
                  Err(format!("the result is {x}, not a finite number"))
              }
          };
  ```
- verify: in `expressions_evaluate_over_scope`: `assert!(Expr::parse("sqrt(0 - 1)").unwrap().value(&scope()).is_err());`
  (today `Ok(Null)`).
- risk: an instance that today expands with a null now fails at `items/<id>/steps/<step>/params/<k>` with that text.
  No test asserts a null (`rg 'is not a number|not in scope' tests/acceptance crates` → no recipe test).

### rust-canvas-core-17  A step whose `when` is false still has its curve and count evaluated, and they can refuse the instance
(slice id B-8; slice: crates/deep-canvas/src/document/ (packs.rs, check.rs))
- kind: broken
- confidence: LIKELY (not run)
- where: `packs.rs:1921-2005` (curve, spacing, count) run before `packs.rs:2006-2022` (`when`)
- evidence: the comment at 2006 says "A condition false at check leaves the step out: it derives nothing", and
  `Step::when` says "false leaves the step out" (`packs.rs:115`). But `curve_points` failing returns `None` at 1939,
  a bad spacing at 1957 and a bad count at 1975/1991/2002, all before `when` is read.
- failure: a recipe with `"inputs": {"fence": {"type": "bool", "default": false}, "rail": {"type": "ID", "default": ""}}`
  and a step `"when": "fence", "repeat": {"along": "rail", "count": 4, "as": "i"}`: with `fence` false the instance is
  refused with `ref_unresolved` at `steps/<step>/repeat/along`, for a step it leaves out.
- fix: move the block `packs.rs:2006-2022` (`// A condition false at check …` through its closing `}`) up to just
  after `for step in &recipe.steps {` (line 1920), before `let curve = …`. It reads only `scope[..base]`.
- verify: unit test with the recipe above; today `!result.ok`.
- risk: when both `when` and the count are faulty, the `when` error is now the one reported. No test has both
  (`rg '"when"' packs tests/acceptance/*/fixtures` → one familiar-names pack's `light@1.json` only, no repeat).

### rust-canvas-core-18  A control whose `range` is written high-to-low panics the input session at the first drag or arrow key
(slice id G-6; slice: the ten small crates)
- kind: broken
- confidence: LIKELY
- where: `crates/deep-canvas-input/src/session.rs:1203-1206` (the range is read, never checked), panics at `:406`, `:864`, `:873`, `:969`, `:1012`; reached from `crates/deep-input/src/main.rs:46` and `crates/deep-canvas-input/src/kit.rs:190`
- evidence:
  ```rust
  let (min, max) = (r(0, 0.0), r(1, top));                 // 1206
  let mut v = raw.clamp(c.min, c.max);                     // 864
  ```
  `f64::clamp` panics when `min > max`. `control_of` refuses a bad `kind` and a bad `handle.along` with `out_of_range`, but takes any two numbers as the range.
- failure: `"controls": {"gain": {"kind": "slider", "range": [1, 0], "handle": {"item": "knob", "along": "x"}}}` then a pointer `down` on the knob and a `move`, or a `key` op with `ArrowRight`: the process dies with `min > max, or either was NaN`. `deep-input`'s contract is "a line that can't be read answers `{"ok":false,"code":"bad_input"}`" and exit 0 (`main.rs:1-4`); every later line goes unanswered.
- fix: after `session.rs:1206` add
  ```rust
  if min > max {
      return Err(refused("out_of_range", format!("controls/{id}/range")));
  }
  ```
- verify: a unit test in `session.rs`: `Session::new` on that document is `Err(Refused { code: "out_of_range", path: "controls/gain/range" })`.
- risk: none found. Every range in `tests/acceptance/308` is low-to-high (`rg 'range: ?\[' tests/acceptance/308`).

### rust-canvas-core-19  `algo: "pinned"` is honored by the view and ignored by the `layout` operator and by `deep-graph layout`
(slice id G-5; slice: the ten small crates)
- kind: inconsistent (two paths over one item disagree)
- confidence: LIKELY
- where: `crates/deep-canvas-graph/src/view.rs:43-58` (reads `layout.pinned`), `crates/deep-canvas-graph/src/module.rs:163-180` (`layout_with`, never reads it), `crates/deep-canvas-graph/src/main.rs:44-58` (never reads it), `crates/deep-canvas-graph/src/lib.rs:70-71`
- evidence: `Layout.pinned` is documented "`pinned`: every node at its memory's place; otherwise `layered`" and `rg pinned crates/deep-canvas-graph/src` finds one reader, `view.rs:43`:
  ```rust
  let (places, groups) = match (&memory, layout.pinned) {
      (Some(m), true) => (m.clone(), BTreeMap::new()),
      (None, true) => return Err(Refused { code: "bad_input", names: "memory".into() }),
  ```
  The operator that writes `graph.layout` does:
  ```rust
  let memory = match params.get("memory") {
      None | Some(Value::Null) => layered(&graph, &laid)…,
      Some(m) => { let memory = read_memory(m)…; keep(&graph, &laid, &memory)…  .map_err(|_| OpError::new("layout.relayout_needed", …))? }
  };
  ```
- failure: the #399 suite's own route document (`tests/acceptance/399/helpers.ts:654-664`): `algo: "pinned"`, memory ranks A 0, D 0, B 2, E 2, edges A→D and E→B inside one rank. The view draws every node at its pinned place. The operator calls `keep`, finds both edges break their ranks (`lib.rs:657-662`) and answers `layout.relayout_needed` for an item the design says is pinned. With `algo: "pinned"` and no memory the operator lays the graph out afresh, while the view refuses `bad_input` and `drawn` (`module.rs:117-126`) falls back to `M0 0`.
- fix: `module.rs:164-179`, make the operator do what the view does:
  ```rust
  let memory = match params.get("memory") {
      None | Some(Value::Null) if laid.pinned => {
          return Err(OpError::new("bad_doc", format!("items/{id}/params/memory")))
      }
      None | Some(Value::Null) => layered(&graph, &laid).map_err(|r| refused(&id, r))?,
      Some(m) if laid.pinned => read_memory(m).map_err(|r| refused(&id, r))?,
      Some(m) => { /* as today */ }
  };
  ```
  `deep-graph layout` (`main.rs`) is #394's surface, which predates `pinned`; leave it or give it the same two arms.
- verify: a unit test in `module.rs` or `tests/memory.rs`: the route document's graph with `algo: "pinned"` yields its memory unchanged. `tests/acceptance/399/place-route.test.ts` must still pass.
- risk: nothing outside this crate reads the `graph.layout` array today (`rg '"graph.layout"' crates` → `module.rs` only), so the visible change is the operator's error going away for pinned graphs. `tests/acceptance/399/layout.test.ts:79` asserts `layout.relayout_needed` for a `layered` change through `deep-graph layout`, which this does not touch.

### rust-canvas-core-20  A step `at` that gives no `pos` puts its item at the world origin, not the instance's
(slice id B-9; slice: crates/deep-canvas/src/document/ (packs.rs, check.rs))
- kind: inconsistent (code against its comment)
- confidence: LIKELY (not run)
- where: `packs.rs:1754-1755`, `2120-2141`, `2179-2184`
- evidence: the comments say "its position is from the instance's origin" (1754) and "Without an `at` of its own, an
  item stands at the instance's origin" (2120). The origin is added only to a `pos` the step's `at` wrote:
  ```rust
  2128  if let (Some(origin), Some(pos)) = (&origin, v.as_object_mut().and_then(|a| a.get_mut("pos")).and_then(Value::as_array_mut)) {
  ```
  and along a curve the origin is dropped whenever the step has any `at`: `2179: let origin3 = if step.at.is_some() { [0.0; 3] }`.
- failure: instance at `pos [10, 0, 0]`; step A has no `at` → `[10, 0, 0]`; step B has `"at": {"pos": [0, 0, 0], "rot": [0, 90, 0]}` →
  `[10, 0, 0]`; step C has `"at": {"rot": [0, 90, 0]}` → no `pos`, so it stands at `[0, 0, 0]`.
- fix: `packs.rs:2127`, first thing inside `Ok(mut v) => {`:
  ```rust
                          // An `at` that gives no `pos` still stands at the instance's origin.
                          if let (Some(o), Some(a)) = (&origin, v.as_object_mut()) {
                              if !a.contains_key("pos") {
                                  a.insert("pos".into(), json!(vec![0; o.len()]));
                              }
                          }
  ```
  (the existing block then adds the origin; the curve branch reads the same `pos`).
- verify: unit test: `chart_pack` with `"at": {"rot": [0, 0, 90]}` → derived `at.pos == [40, 40, 0]`.
- risk: no shipped recipe has a step `at` without `pos` (`rg '"at":' packs | grep -v '"pos"'` → only operator graphs
  in `fx` and numbers in `chrome-fx`, not recipe steps). No test pins it.

### rust-canvas-core-21  `driven_counts` misses a count that reads its input through a `let`, and a spacing
(slice id B-11; slice: crates/deep-canvas/src/document/ (packs.rs, check.rs))
- kind: inconsistent
- confidence: LIKELY
- where: `packs.rs:1565-1571`; the rule it enforces at the pack check, `packs.rs:823-829` and `859-909`
- evidence:
  ```rust
  1565  let counted: BTreeSet<String> = recipe.steps.iter()
  1568      .filter_map(|s| s.repeat.as_ref())
  1569      .flat_map(|(count, _)| count.names())
  1570      .filter(|n| recipe.inputs.contains_key(n))
  ```
  A count evaluates over the inputs and the recipe's lets (`1978: count.eval(&scope[..base])`), and the pack check
  admits a count that reads a let (`828`). A let's own reads are not followed, and an `along` repeat's spacing
  (the count there is the placeholder `json!(0)`, line 861) is not read at all.
- failure: recipe `"let": {"n": "posts * 2"}`, step `"repeat": {"count": "n", "as": "i"}`; the document's channel
  targets `items/f1/params/posts`. `counted` is empty (`n` is no input), so the channel is admitted and does nothing
  to the count, where the same channel on a direct `"count": "posts"` is refused.
- fix: `packs.rs:1565-1571` →
  ```rust
          // The inputs a count or a spacing reads, itself or through the recipe's lets.
          let mut counted: BTreeSet<String> = recipe
              .steps
              .iter()
              .flat_map(|s| {
                  let count = s.repeat.iter().flat_map(|(count, _)| count.names());
                  let spacing = s.along.iter().filter_map(|(_, sp)| sp.as_ref()).flat_map(Template::names);
                  count.chain(spacing).collect::<Vec<_>>()
              })
              .collect();
          for (name, expr) in recipe.lets.iter().rev() {
              if counted.contains(name) {
                  counted.extend(expr.names());
              }
          }
          counted.retain(|n| recipe.inputs.contains_key(n));
  ```
- verify: unit test with the recipe above → an `out_of_range` at `channels/<id>/target`.
- risk: refuses documents that drive such an input today (the channel has no effect on them now).

### rust-canvas-core-22  A recipe's channel silently replaces a document channel with the same ID
(slice id B-12; slice: crates/deep-canvas/src/document/ (packs.rs, check.rs))
- kind: inconsistent
- confidence: LIKELY
- where: `check.rs:240-252`; compare `packs.rs:2090-2102`
- evidence: `248: if let Some(map) = channels.as_object_mut() { map.extend(recipe_channels); }`. `extend` on an
  `IndexMap` overwrites an equal key. A derived *item* that meets a document item is refused (`bad_id`, "the document
  holds an item at the ID … expands to"); a derived *channel* is not.
- failure: instance `n1` of `nest.grow` (channel `rise`, one target) and a document channel `"n1.rise"`: `lowered`
  holds the recipe's, the document's own is gone, no issue.
- fix: `check.rs:248-250` →
  ```rust
              if let Some(map) = channels.as_object_mut() {
                  for (cid, channel) in recipe_channels {
                      if map.contains_key(&cid) {
                          issues.push(Issue::error(
                              "bad_id",
                              &cid,
                              format!("channels/{cid}"),
                              json!(cid),
                              "the document holds a channel at the ID a recipe's channel expands to",
                          ));
                      } else {
                          map.insert(cid, channel);
                      }
                  }
              }
  ```
- verify: extend `a_recipes_channels_join_the_document_targeting_the_items_it_derived` with a document channel
  `n1.rise.0`.
- risk: low; no test has such a clash.

### rust-canvas-core-23  The seal's two check-read refusals name no array, against their comment and their siblings
(slice id A-4; slice: crates/deep-canvas/src/registry/)
- kind: inconsistent
- confidence: LIKELY
- where: `crates/deep-canvas/src/registry/mod.rs:2868-2896`
- evidence:
  ```rust
  // #411: a check whose result holds on any machine reads GPU work only from an exact
  // operator (Determinism class), or it is refused `not_exact`, naming the check and array.
  …
  return Err(SealError::new("unresolved_read", &[name], &[], format!("check `{}` of `{name}` reads `{read}`, which no operator writes", c.kind)));
  …
  return Err(SealError::new("not_exact", &[name], &[], format!("check `{}` of `{name}` says machines any but reads `{read}`, which is {class}", c.kind)));
  ```
  `SealError.arrays` is "what is involved" (`:1151`). The operator, kind and table `unresolved_read` refusals
  all pass the read (`:2130` `&[read]`, `:2276` `&[need]`, `:2602` `&[read]`). Here the array is only in the text.
- failure: a caller that reads `err.arrays` (the startup refusal prints it, `crates/deep-show/src/main.rs:2795`)
  gets `[]` for a check that reads a float array under `machines: any`.
- fix: in both calls `&[],` → `&[read],` (lines 2882 and 2893).
- verify: no test covers either refusal today (`rg "not_exact" crates/deep-canvas/src/registry` → only the
  code; `tests/acceptance/411` and `429` assert the document check's `not_exact`, not the seal's). A test that
  registers a `same_machine` operator and an `any` check reading it would assert `err.arrays == ["c.p"]`.
- risk: none found; nothing asserts `arrays` empty for these codes.

### rust-canvas-core-24  `MODULE_CHECK_KINDS` has no row for the loop module, so its one shipped check kind is `module_missing` with no module named
(slice id A-11; slice: crates/deep-canvas/src/registry/)
- kind: inconsistent (the list against its own doc and the module it serves)
- confidence: LIKELY
- where: `crates/deep-canvas/src/registry/mod.rs:688-705` (the list), `:1621-1633` (`module_of_check`);
  `crates/deep-canvas-loop/src/lib.rs:16` (`KIND = "geometry.shading"`), `:82`;
  `crates/deep-show/src/verdict.rs:413-417`; `docs/canvas-primitives.md:8370-8376`
- evidence: the list's doc: "The check kinds the design names for a canvas module, with that module, so a
  check input naming one in a build without it is `module_missing` naming the module". It has rows for record,
  input, export, physics, logic and net (added by #403, 1e8eeaf8, before the loop module existed) and none for
  `loop`. The loop module (#453) registers `geometry.shading`. `module_of_check` falls back to the kind's
  family, `geometry`, which is no module (`KNOWN_MODULES`, `:179-204`), and returns `None`; `verdict.rs:414`
  then leaves `module` out of the BLOCKED row. `tests/acceptance/453/README.md:39-40` records exactly this as
  the base's behavior: "BLOCKED with `module_missing` (no `module`: `geometry` is no module's family)".
- failure: an r2 build (no `loop`) and a requirement whose check input names `geometry.shading`: the row is
  `{"code": "module_missing", "kind": "geometry.shading", "ids": []}`, where `logic.determinism` in the same
  build gets `"module": "logic"` (`tests/acceptance/403/check-kinds.test.ts:57`).
- fix: add to `MODULE_CHECK_KINDS` after `("net.budget", "net"),`:
  ```rust
      ("geometry.shading", "loop"),
  ```
  The design lists ten more loop kinds (`scene.scale`, `camera.framing`, `render.exposure`, `render.contrast`,
  `render.noise`, `animation.contacts`, `animation.loop`, `animation.limits`, `effects.audit`,
  `render.review`; `docs/canvas-primitives.md:8376`). None is registered yet; adding them too is the same
  reasoning as the unregistered physics, logic and net rows, but that is the lead's call.
- verify: in `mod.rs` tests: `assert_eq!(core().module_of_check("geometry.shading").as_deref(), Some("loop"))`
  fails today.
- risk: low. `module_of_check` is called only at `verdict.rs:414`, after `check_kind` found no module with the
  kind, so a build with `loop` never reaches it. No test asserts the row has no `module`
  (`rg "module_missing" tests/acceptance/453/*.ts` → no hit; only the README's note on the base).

### rust-canvas-core-25  Salience reads `priority` from inside `facts`; its doc comment and the module's own fixture put it beside `facts`
(slice id G-7; slice: the ten small crates)
- kind: inconsistent
- confidence: SURE (the comment); LIKELY (the fixture)
- where: `crates/deep-canvas-record/src/lib.rs:202-203` (comment), `:215` (code), `crates/deep-canvas-record/src/module.rs:124` (fixture); the surface is `tests/acceptance/394/README.md:88` and `tests/acceptance/394/salience.test.ts:97`
- evidence:
  ```rust
  /// Reads `{id, facts: {needs_you, sent_back, failing, lacks_proof, touched, changed}, priority?,
  /// file?}`.
  …
  let priority = match facts.get("priority") {
  ```
  The acceptance surface writes `facts: { …, changed: false, priority: 0 }`, so the code is right and the comment is not. The fixture board writes `{"id": "hub", "facts": facts(false, false), "priority": 2}`: that `priority` is never read, so `hub` ranks as priority 0 and the level shows `app, api, docs` where the fixture's author meant `app, api, hub`.
- fix: comment, `lib.rs:202-203` → `/// Reads `{id, facts: {needs_you, sent_back, failing, lacks_proof, touched, changed, priority?},` / `/// file?}`.`
  Fixture, `module.rs:124` old `{"id": "hub", "facts": facts(false, false), "priority": 2}` → new `{"id": "hub", "facts": {"needs_you": false, "sent_back": false, "failing": false, "lacks_proof": false, "touched": false, "changed": false, "priority": 2}}`.
- verify: comment by diff review. Fixture: the kit's `level` fixture is checked with `document.validate` only (`module.rs:52-57`).
- risk: the fixture edit changes the fixture's bytes, so any recorded digest of the record module's fixtures (kit goldens in deep-show) moves. That is why the fixture half is LIKELY, not SURE.

### rust-canvas-core-26  `one_track` reports the wrong number of track hashes
(slice id A-6; slice: crates/deep-canvas/src/registry/)
- kind: broken (error text)
- confidence: SURE
- where: `crates/deep-canvas/src/registry/core_lists.rs:543-549`
- evidence:
  ```rust
  let mut hashes: Vec<&Value> = t.values().collect();
  hashes.dedup();
  if hashes.len() > 1 {
      Err(format!("its recorded fixture gives {} track hashes across frame rates", hashes.len()))
  ```
  `dedup` removes only neighbours that are equal, and `serde_json` here keeps insertion order
  (`crates/deep-canvas/Cargo.toml:15`, `preserve_order`).
- failure: `{"30": "a1", "60": "b2", "120": "a1"}` has two distinct hashes and the message says 3. The verdict
  is right either way (more than one remains exactly when the values are not all equal).
- fix:
  ```rust
  // old
      let mut hashes: Vec<&Value> = t.values().collect();
      hashes.dedup();
  // new
      let mut hashes: Vec<&Value> = Vec::new();
      for h in t.values() {
          if !hashes.contains(&h) {
              hashes.push(h);
          }
      }
  ```
- verify: in `core_lists.rs` tests, `class_one_track(&json!({"fixture": {"tracks": {"30": "a1", "60": "b2", "120": "a1"}}}))`
  must be `Err` containing `gives 2 track hashes`.
- risk: none. `rg "track hashes" crates tests` finds only this file and a comment in
  `tests/acceptance/200/core-registries.test.ts:11`; the planted entry `frame_rate_dependent` still fails
  `one_track` alone.

### rust-canvas-core-27  A failing recipe `let` is reported at `items/<id>/params/<let>`, a param that doesn't exist
(slice id B-17; slice: crates/deep-canvas/src/document/ (packs.rs, check.rs))
- kind: inconsistent (error path names the wrong thing)
- confidence: LIKELY
- where: `packs.rs:1897-1910`; compare a step's let at `packs.rs:2064`
- evidence: `1904: at(&format!("params/{name}")),` where `name` is the let's name; a step let uses
  `at(&format!("steps/{}/let/{name}", step.id))`.
- fix: `at(&format!("params/{name}")),` → `at(&format!("let/{name}")),` at line 1904.
- verify: no test reads this path (`rg 'let `|/let/' tests/acceptance crates` outside packs.rs → none).
- risk: none seen.

### rust-canvas-core-28  The repeat error names a missing count when it is `as` that is missing
(slice id B-19; slice: crates/deep-canvas/src/document/ (packs.rs, check.rs))
- kind: inconsistent (error text)
- confidence: LIKELY
- where: `packs.rs:888-898`
- evidence: the last arm catches a count with no `as`, and an `as` that is no name, and says
  "step `x`'s repeat is `{count, as}`: one without a count has no count fixed at check".
- failure: `"repeat": {"count": 3}` → told it has no count.
- fix: in that arm, pick the text by what is missing: when `member(r, "count").is_some()` say
  ``"step `{step_id}`'s repeat is `{{count, as}}`: `as` names its index"``.
- risk: `tests/acceptance` reads paths, not this text (`rg 'one without a count' tests crates` outside packs.rs → none).

### rust-canvas-core-29  The web runtime hashes and restores f32/f64 globals through JS numbers; the app uses the raw bits
(slice id G-8; slice: the ten small crates)
- kind: inconsistent (two implementations of one hash)
- confidence: QUESTION
- where: `crates/deep-logic/web/logic.mjs:35-42` (`encoded`), `:168` and `:250` (a checkpoint's globals, and their restore) against `crates/deep-logic/src/world.rs:287-294` and `:785-789`; the rule it leans on is `crates/deep-canvas-sandbox/src/rewrite.rs:733-742` (`float_result`)
- evidence: Rust hashes `Val::F32(x)` as the bit pattern's bytes. The web reads `live.ex[name].value` (a JS number), writes it with `setFloat32`/`setFloat64`, and restores with `live.ex[n].value = globals[i]`. The rewrite makes a NaN canonical only after arithmetic; `f32.const nan:0x200001`, `f32.reinterpret_i32` and a load pass as written (`float_result` returns 0 for them).
- failure: a program that keeps a signalling or payload NaN in a mutable float global. The app's step hash and deep hash cover the exact bits and a restore puts them back; the browser hands the value through a double, which may quiet it or drop the payload, so the web's hashes, and the state after a restore, can differ from the app's on the same rewritten bytes. The design's generator plan (technical-design.md:2617, wasm-smith programs compared across wasmtime and the browser) would draw such programs.
- fix: not a one-line edit. Either the rewrite canonicalizes on `global.set` of a float global, or the web runtime reads and writes float globals through memory. Owner's call.
- verify: a kit fixture with a NaN-payload f32 global, run in both engines.
- risk: changing the rewrite changes every rewritten hash and the kit's blessed values.

### rust-canvas-core-30  The tour's laps differ between the input module and deep-logic
(slice id G-9; slice: the ten small crates)
- kind: inconsistent
- confidence: QUESTION
- where: `crates/deep-canvas-input/src/session.rs:506-510` against `crates/deep-logic/src/lib.rs:193-205`
- evidence: both take the period as the last key's time. The input module skips a key at or past the period when looping (`if looping && *kt >= tour.period { continue; }`), so the last key of a looping tour is never written. deep-logic writes every key each lap (`for (t, value) in &ks { if at + t <= end {`), so lap n's last key and lap n+1's first land on one flick.
- failure: `keys: {gain: [[0, 0], [1, 1]]}`, `loop: true`: the input module's track holds only the 0 keys (the control never reaches 1); deep-logic's holds `0, 1, 0, 1, …` with two entries on each whole second, both of which a step reads.
- fix: none proposed; `tests/acceptance/308/README.md:223` says `loop` beyond its window has no criterion, and the design does not say whether the last key closes the lap.
- risk: either choice changes one module's track hashes.

### rust-canvas-core-31  A module's check kind never enters `check.kind.doc@1`, and that registry's kit would refuse it
(slice id A-5; slice: crates/deep-canvas/src/registry/)
- kind: inconsistent (code against its doc comment and the design)
- confidence: QUESTION
- where: `crates/deep-canvas/src/registry/mod.rs:637-639` (`Check` doc), `:1585-1595` (`check_kinds`);
  `crates/deep-canvas/src/registry/core_lists.rs:469-527` (`check_kind_doc`, its two rules), `:1259-1273`
  (the core's entries); `crates/deep-canvas/src/registry/lists.rs:609-612` (what the seal fills from);
  `docs/canvas-primitives.md:1312`, `:8284`
- evidence: the doc comment says a module's check kind "joins the core's in the document check registry
  `check.kind.doc@1`", and the design row says the registry is "holding the core's own kinds and filled by
  canvas modules". The seal fills registries only from `core_entries` and each module's `r.entries`
  (`lists.rs:609-612`); nothing turns `r.checks` into entries (`rg "shapes\.checks" crates` → only
  `deep-show/src/kit/fixtures.rs:554, 564` and `mod.rs`). The loop module registers a check
  (`deep-canvas-loop/src/lib.rs:82`) and fills no entry. If it did, the kit would refuse it: `catalogued`
  requires every code to be in `document::CORE_CODES` (`core_lists.rs:478`) and `reads_core` refuses any read
  that is not `core.*` or `document` (`:490`), with the message "a core check kind reading … a module's array"
  applied to every entry, a module's too.
- failure: `deep://registries` lists 11 check kinds in a build whose `check_kinds()` has 12 (with `loop`).
- fix: none proposed; it needs a decision (derive entries from `r.checks` with the module's own catalog, or
  reword the comment and the design row to say the registry holds the core's kinds only).
- verify: `tests/acceptance/200/core-registries.test.ts:80` asserts the registry holds the core's kinds
  (`holdsFailures(theRegistry(r, 'check.kind.doc@1'), CORE_CHECK_KINDS)`, AC11: "with today's entries as the
  core's"); I did not read whether `holdsFailures` allows more entries than those.
- risk: a design change, not a hand edit.

### rust-canvas-core-32  A reader of `earlier(x)` stays in the plan when x's writer is left out
(slice id A-10; slice: crates/deep-canvas/src/registry/)
- kind: inconsistent (two passes of the seal treat `earlier(…)` differently)
- confidence: QUESTION
- where: `crates/deep-canvas/src/registry/mod.rs:2555-2561` against `:2662-2671`
- evidence: the first pass strips the wrapper, so a direct read of a missing optional module's array through
  `earlier(a.x)` leaves the operator out:
  ```rust
  let read = &match read.strip_prefix("earlier(").and_then(|r| r.strip_suffix(')')) { … };
  ```
  The transitive pass looks the raw text up: `None => unwritten.get(read.as_str())`, and `"earlier(b.y)"` is
  never a key of `unwritten`, so an operator that reads `earlier(b.y)` stays when `b.y`'s writer was left out.
- failure: module `c` (optional dep on `a`): `fill` reads `a.x`, writes `c.y`; stepping `tick` reads
  `earlier(c.y)`. Without `a`, `fill` is left out and `tick` still runs every step over an array nobody
  writes. A plain read of `c.y` would have left `tick` out with cause `a`.
- fix (if intended to match): in `cause_of`, `None => unwritten.get(read.strip_prefix("earlier(").and_then(|r| r.strip_suffix(')')).unwrap_or(read))`.
- verify: extend `a_kind_or_table_over_a_missing_optional_dependency_is_left_out` with a stepping reader.
- risk: not verified what the scheduler hands such a node (`schedule/mod.rs:3298`); only test modules use
  `earlier(` on real operators today (`deep-canvas-test-modules/src/lib.rs:427, 450`), so nothing shipped hits it.

### rust-canvas-core-33  `relation_target`'s `frame` flag changes nothing
(slice id B-14; slice: crates/deep-canvas/src/document/ (packs.rs, check.rs))
- kind: inconsistent (code against its comment)
- confidence: QUESTION
- where: `check.rs:1619-1626`, callers `1666` (`false`) and `1698` (`true`)
- evidence:
  ```rust
  1619  /// A relation's target: an item ID with an optional `#part`, or a point `[u, u]`; `frame` too
  1620  /// where `frame` is allowed.
  1623  Value::String(s) => (frame && s == "frame") || !s.is_empty(),
  ```
  `(frame && s == "frame") || !s.is_empty()` equals `!s.is_empty()`: `"beside": "frame"` passes with `frame == false`.
  Since 9520f48a (#221). No test writes `"beside": "frame"` or `"onto": "frame"`.
- fix: either drop the parameter and the clause in the comment (no behavior change), or enforce it:
  `Value::String(s) => !s.is_empty() && (frame || s != "frame"),` which refuses `place.beside: "frame"` and also an
  item whose ID is `frame`. The owner's call.
- risk: the second form is a behavior change.

### rust-canvas-core-34  `requires.core` is never compared with the build, in a document or a pack
(slice id B-15; slice: crates/deep-canvas/src/document/ (packs.rs, check.rs))
- kind: inconsistent
- confidence: QUESTION (a test pins the document half)
- where: `check.rs:951-955` (`"core" => if !value.is_string() { issues.push(wrong("not a version")) }`),
  `packs.rs:268-280` (parsed as a `Range`, then dropped), doc comment `check.rs:928`
  (`requires … {core: semver, …}`)
- evidence: a document's `requires.core` may be any string; a pack's must parse as a range but is not tested against
  `registry::CORE_VERSION` (`"0.0.0"`, `registry/mod.rs:30`), while `requires.modules` is, in both
  (`check.rs:984`, `packs.rs:307`). `mod.rs:1255-1261` pins a document with `"core": "1.2.3"` as `ok` in the 0.0.0
  build. `"preview"` entries are likewise only checked to be strings (`check.rs:1011-1022`, text "not a name@major").
- failure: a pack with `"requires": {"core": ">=99.0.0"}` is admitted; a document with `"core": "banana"` checks ok.
- fix: none proposed; needs the owner's rule for a core range before 1.0 and a change to the pinned test.

### rust-canvas-core-35  A `size` of zero or below passes the check and is refused at render
(slice id B-16; slice: crates/deep-canvas/src/document/ (packs.rs, check.rs))
- kind: inconsistent
- confidence: QUESTION
- where: `check.rs:916-925` (`is_vector(size, 2)`: two numbers finite at f32), `check.rs:1923-1927` (`frame_of`:
  `v as u32`, so a negative side reads 0), `crates/deep-canvas/src/render.rs:496-499`
- evidence: render says "The envelope checks `size` at f32 width, where a subnormal is 0 and finite" and refuses
  `out_of_range` at `size`, "not above 0". The check, which "returns … the draw list", lets `[0, 0]` and
  `[-640, 360]` through, and lowers `fw`/`fh` literals against a 0 frame.
- fix: if the check should own it, in `check_envelope` after the `is_vector` test refuse a side whose f32 is not
  above 0 with the same text. Left as a question because `render`'s test (`render.rs:564`) shows the split is known.

### rust-canvas-core-36  `==` and `!=` never match a bool input, though every other operator reads a bool as 1 or 0
(slice id B-18; slice: crates/deep-canvas/src/document/ (packs.rs, check.rs))
- kind: inconsistent
- confidence: QUESTION
- where: `packs.rs:2719-2733`; `packs.rs:2672-2679` ("Its value as a number (a bool reads 1 or 0)")
- evidence: `same` compares `a.as_f64()` with `b.as_f64()` (both `None` for a `Bool`) and falls back to `a == b` on
  the JSON values. `lamp == 1` with `lamp: true` is `Bool(true) == Number(1)` → false, and `lamp == true` compares
  with the word `"true"` (a bare name nothing binds) → false. `lamp > 0`, `lamp && 1` and `!lamp` read it as 1.
- failure: `"when": "lamp == 1"` never holds; `"when": "lamp != 1"` always holds.
- fix: if bools should compare: in `same`, read each side with
  `|v: &Value| v.as_f64().or_else(|| v.as_bool().map(|b| f64::from(u8::from(b))))`.

### rust-canvas-core-37  The doc comment of `Registry::declares` sits on `allows_bare`
(slice id A-7; slice: crates/deep-canvas/src/registry/)
- kind: inconsistent (comment)
- confidence: SURE
- where: `crates/deep-canvas/src/registry/mod.rs:1701-1711`
- evidence:
  ```rust
      /// A registry the core declares in this build beside its own (#200).
      /// Lets `module` keep the bare kind name `kind`: a test build's fixture only (#412).
      pub fn allows_bare(mut self, module: &str, kind: &str) -> Registry {
          …
      }

      pub fn declares(mut self, def: lists::RegistryDef) -> Registry {
  ```
  `git log -S` shows #200 (81690760) added the first line above `declares`, and #412 (40c7e2aa) inserted
  `allows_bare` between the line and its function.
- fix: move the line `/// A registry the core declares in this build beside its own (#200).` from above
  `allows_bare` to directly above `pub fn declares`.
- verify: diff review.
- risk: none (comment only).

### rust-canvas-core-38  Two comments and a test name still say `cells@1` is the one bare module kind; the list holds 24
(slice id A-8; slice: crates/deep-canvas/src/registry/)
- kind: inconsistent (comment)
- confidence: SURE
- where: `crates/deep-canvas/src/registry/mod.rs:1569-1571`, `:2182-2184`, test name at `:4333`; the list at
  `:143-170`
- evidence: `:1569` "the one bare name a module's kind keeps, `cells@1` …, is the cells module's";
  `:2184` "The one module kind the design names bare, `cells@1`, is the cells module's."; the test
  `only_the_cells_module_keeps_a_bare_kind_name_and_a_build_without_it_names_it_missing`.
  `BARE_MODULE_KINDS` now has 24 rows over six modules (cells, scene3d, vector, graph, data, motion), and the
  code at both places reads the whole list.
- fix:
  - `:1569-1571` old: `// A core kind (`text@1`, `rect@1`) has no family to name a module by; the one bare` /
    `// name a module's kind keeps, `cells@1` (canvas primitives: Cell grid `cells@1`), is` /
    `// the cells module's.` → new: `// A core kind (`text@1`, `rect@1`) has no family to name a module by; a bare` /
    `// name the design gives a module's kind (`BARE_MODULE_KINDS`, such as `cells@1`) is` / `// that module's.`
  - `:2184` old: `// The one module kind the design names bare, `cells@1`, is the cells module's.` → new:
    `// The module kinds the design names bare (`BARE_MODULE_KINDS`) are their modules'.`
  - the test name can stay (it tests cells only); renaming it is optional.
- verify: diff review.
- risk: none (comments only).

### rust-canvas-core-39  The module doc of `core_lists.rs` leaves out four of the fourteen registries it declares
(slice id A-9; slice: crates/deep-canvas/src/registry/)
- kind: inconsistent (comment)
- confidence: SURE
- where: `crates/deep-canvas/src/registry/core_lists.rs:1-8` against `registries_with` at `:1176-1198`
- evidence: the header names `gpu.step@1`, `gpu.output@1`, `gpu.function@1`, `mark@1`, `builder@1`,
  `modifier@1`, `check.kind.doc@1`, `device.class@1`, `logic.service@1`, `data.layout@1`. `registries_with`
  also returns `column.source@1` (#397), `constraint@1`, `ease@1` (#490) and `outline.source@1` (#443).
  The doc of `entries` (`:1224-1226`) likewise omits that it starts with `ease_entries(false)` (`:1228`),
  which the seal filters out and adds again (`mod.rs:2907-2914`).
- fix: in the header, after "`data.layout@1` (#415), … whose validators the sandbox module runs" add
  "; and `constraint@1`, `column.source@1` (#397), `outline.source@1` (#443) and `ease@1` (#490)".
- verify: diff review.
- risk: none.

### rust-canvas-core-40  `check_key`'s doc comment opens with a sentence that describes `check_targets`
(slice id B-13; slice: crates/deep-canvas/src/document/ (packs.rs, check.rs))
- kind: inconsistent (comment)
- confidence: SURE
- where: `check.rs:1945-1947`
- evidence:
  ```rust
  1945  /// Checks a map of `{target: path[, source: handle]}` entries against the lowered document.
  1946  /// Every map keyed by ID takes keys in the ID grammar; a key a path can't name is `bad_id`.
  1947  fn check_key(section: &str, key: &str, issues: &mut Vec<Issue>) {
  ```
  `check_key` checks one key. The first sentence is `check_targets`'s, which has its own comment at 2073
  ("The entries of `channels` or `bound_values`…"). Left behind when the function was split (bfe243f8, #389).
- fix: delete line 1945.
- verify: diff review (comment only).
- risk: none.

### rust-canvas-core-41  `deep_hash` copies the arrays and the whole memory before it hashes them
(slice id G-10; slice: the ten small crates)
- kind: inefficient
- confidence: LIKELY
- where: `crates/deep-logic/src/world.rs:310-318`; paid at every checkpoint (`:475`) and, with a second whole-memory copy for the dirty pages, at `:484-491`; in a live view once per frame per item (`crates/deep-logic/src/live.rs:165` → `world.rs:434-440`)
- evidence:
  ```rust
  b.extend(&self.arrays.clone());
  b.extend(self.memory().to_vec());
  h64(&b)
  ```
  A logic item's memory is 4 MiB by default and up to 64 MiB (`piece.rs:469`). Each call allocates and fills a buffer of that size, then SHA-256s it. `checkpoint` then does `let m = l.memory().to_vec();` again to slice the dirty pages out.
- fix: feed the hasher in parts and drop the copies. In `deep_hash`: build `sha2::Sha256`, `update` with `next`, the pending count, `self.encoded()`, `&self.arrays`, `self.memory()`, and take the first 8 bytes as `h64` does. In `checkpoint` (`:484-491`) collect the dirty list first, then borrow `l.memory()` once and copy only those pages. The smallest step is `:315` `b.extend(&self.arrays.clone());` → `b.extend(&self.arrays);`.
- verify: `cargo test -p deep-logic`; the hashes in `tests/acceptance/531` and `532` must be byte-equal before and after (the input order is unchanged).
- risk: none for the copies; the hash input must stay next, pending, globals, arrays, memory.

### rust-canvas-core-42  Known: `cargo clippy -D warnings` at `crates/deep-canvas/src/registry/core_lists.rs:863`
(slice id G-11; slice: the ten small crates)
- kind: broken (a lint lane that fails)
- confidence: SURE
- where: `crates/deep-canvas/src/registry/core_lists.rs:863`
- evidence: the lint is `clippy::type_complexity` on `fn rings_at(v: &Value, at: &str) -> Result<(Vec<Vec<[f64; 2]>>, crate::outline::FillRule), String>`. `outline.rs` has no alias for a contour list; it writes `Vec<Vec<[f64; 2]>>` in its own signatures (`:113`, `:255`, `:332`, `:346`).
- fix: a private alias above the function:
  ```rust
  /// A fixture's contours with their fill rule.
  type Rings = (Vec<Vec<[f64; 2]>>, crate::outline::FillRule);
  fn rings_at(v: &Value, at: &str) -> Result<Rings, String> {
  ```
  This exact edit is already in the checkout's working tree (`git diff -- crates/deep-canvas/src/registry/core_lists.rs`), put there by the lead while this run was reading.
- verify: `cargo clippy -p deep-canvas -- -D warnings`.
- risk: none; the alias is private and changes no type.

## Slice notes: nits, what was checked and found sound, and each slice's own coverage

### Slice A: crates/deep-canvas/src/registry/

#### Nits (one line each; none is a behavior bug)

Comments and text:
- `semver.rs:1-5`: the header says a range is one bound "or two of the last two joined by a comma";
  `Range::parse` (`:98-128`) takes any number of any bounds joined by commas, and a bare version as a caret.
- `semver.rs:54`: "so one version has one spelling", while `parse` reads `1`, `1.2` and `1.0.0` as one version
  and trims spaces (`:26`). `Display` is the one spelling; the comment is about a part's digits only.
- `semver.rs:149`: `v.cmp(&lo) == Ordering::Equal` is `v == lo`; the `Ordering` import (`:7`) exists only for it.
- `mod.rs:3107-3108`: `well_named`'s doc says it is also the grammar "of an array or table name"; those are
  held to `id_named` (`:3118`, which allows `_` and `-`). Its three callers (`mod.rs:1797`,
  `document/check.rs:961`, `document/packs.rs:296`) all pass a module name.
- `mod.rs:1436`, `:1459`: docs say a module's kind draws as `rect@1` only; `DRAWS_AS` (`:75`) also has `path@1`.
- `mod.rs:1786`: "has two implementations in this build" is printed for three or more as well.
- `core_lists.rs:41-42`: `MARKS` doc says each row has "its unit fixture's bounds and the box its pixels cover";
  a row has one box, written as both (`:1249`).
- `core_lists.rs:917`: "The k-th point of the Halton (2, 3) sequence" is on a function that returns one
  coordinate in `base`.
- `core_lists.rs:981-985`: the `covers_2d_fill` failure reads `<fixture> <n> of 1000 sampled points; …`, with
  no verb. No test reads the text (`rg "sampled points" crates tests`).
- `core_lists.rs:1127-1128` against `:1161`: a named ease must read exactly 0.0 and 1.0 while the rule's
  message says "each within 1e-9" (a pack's table gets the tolerance through `check_ends`). Stricter, not wrong.
- `lists.rs:365, 402, 423`: a nested schema fault is located as `the entry.size` or `the entry[0]`, because
  the empty path is replaced by "the entry" before the suffix is added. No test pins it.

Small looseness:
- `mod.rs:599`: `Operator::determinism` is "one of `CLASSES`" but the seal never checks it, unlike machines,
  domains, places, table builds and carried kinds; an unknown class ranks as `exact` in `check_determinism`
  (`:1600`, `unwrap_or(0)`). Every caller passes a class from the list today.
- `mod.rs:1599-1608` against `:2870-2874`: the seal resolves a check's reads over every operator, the left-out
  ones too; `check_determinism` looks only at kept operators and reports a read with no kept writer as `exact`.
  Same family as A-10; not traced further.
- `lists.rs:546-552`: the `name@major` test accepts `x@+1` (`u32` parse takes a sign) and an empty name (`@1`).
- `lists.rs:373`: `integer` refuses `2.0`; fine for entries built with `json!`, noted for pack entries.
- `semver.rs:109-110`: `=1` is exactly 1.0.0 (Cargo reads `=1` as any 1.x.y). The header promises Cargo's
  reading only for caret and tilde.
- `mod.rs:1203`: `SealError::new` sets `operators`, `interface` and `implementations` to their defaults and
  then spreads `..SealError::default()`; the three lines can go.
- `mod.rs:41-43` and `crates/deep-canvas/src/schedule/mod.rs:73-75`: `CHECK_PHASES` is written twice with the
  same eight values (the registry calls `schedule::is_check_phase` at `:2495` and its own list elsewhere).
- `mod.rs:72` `TOOLS`: no module calls `Registrar::tool_entry` (`rg "tool_entry\(" crates packages scripts tests`
  → only the in-file test at `:3733`), and `tool_entries` is read only by the digest. The design keeps tool
  entries in the interface (`docs/canvas-primitives.md:1041`), so it stays; whether `deep_drive` belongs in
  the list is a question for whoever first registers an entry.

`pub` with no user outside its own file (grep over `crates packages scripts tests benchmarks docs adapters packs`;
each could drop `pub`, none is dead code):
- `mod.rs:91` `READ_TERMS` (reaches outside through `closed_lists()`), `:1312` `Sealed.camera_in_scene3d`,
  `:3118` `id_named` (`pub(crate)`, used only in `mod.rs`).
- `core_lists.rs:16` `SINCE`, `:20` `OUTPUTS`, `:644` `CYCLE`, `:915` `OUTLINE_SAMPLES`, `:1103` `EASE_SINCE`.
- `lists.rs:221` the free `run_kit` (outside callers use `RegistryDef::run_kit`), `:439` `admits_all`.

#### Checked and found consistent

- `closed_lists()` (`mod.rs:1640`) equals `packages/contracts/canvas-schemas/canvas.lists@1.json` list for list
  (phase, place, read_term, domain, table_build, carried_kind, machines, determinism), compared by eye.
- `core_lists::registries()` names, `since`, `resolve` and `fill` equal the 14 core rows of
  `packages/contracts/canvas-registries.json` (the 15th, `kind@1`, is deep-show's).
- `KNOWN_MODULES` holds every module name a crate registers (text, look, marks2d, data, graph, record, sheet,
  motion, vector, cells, scene3d, effects, input, building, sandbox, media, loop).
- `CORE_VERSION` "0.0.0" equals `crates/deep-canvas/Cargo.toml` `version`.
- `BARE_MODULE_KINDS`: spot-checked cells, graph, vector, arrange, material, sky, puff, cutaway, instance,
  effect against their crates; the builders, curve and the data module's three were not traced row by row.
- No `#[allow(dead_code)]` or `#[allow(unused)]` in the four files. No `HashMap`/`HashSet`, no clock or
  randomness beyond the injected `clock` (`mod.rs:1673`). `serde_json` runs with `preserve_order`, so object
  iteration is insertion order, not hash order.
- `unwrap`/`expect`/indexing: `mod.rs:935` (just pushed), `:1357` (a list it just inserted), `:1759` (constant),
  `:2547`, `:2607` (phases checked at `:1872`, `:2415`), `:3104` (empty set), `:3236` (`versions[0]`, guarded by
  the majors check at `:2166` that runs first), `:3309` (Kahn leftovers), `rank[k]` at `:2758, 2769` (keys of
  the same node list); `core_lists.rs:679` (`order[..ran]`, `ran` from `position`), `:819-820` (`rows[i]` under
  `b.min(rows.len())`; `frame[i]` is `serde_json` indexing, which gives `Null` out of range), `:899`
  (`% r.len()` inside a loop over `0..r.len()`). All hold.

#### Coverage

| file | lines | read |
|---|---|---|
| `crates/deep-canvas/src/registry/mod.rs` | 4749 | in full (source 1-3516 line by line; tests 3518-4749 read for what they pin) |
| `crates/deep-canvas/src/registry/core_lists.rs` | 1333 | in full |
| `crates/deep-canvas/src/registry/lists.rs` | 861 | in full |
| `crates/deep-canvas/src/registry/semver.rs` | 217 | in full |

Read in part, to check a claim: `crates/deep-canvas/src/canon.rs` (85-230, 310-357),
`crates/deep-canvas/src/document/packs.rs` (540-640), `document/check.rs` (960-1010),
`crates/deep-show/src/verdict.rs` (380-417), `crates/deep-show/src/kit/order.rs` (28-62),
`crates/deep-canvas-scene3d/src/module.rs` (280-345), `crates/deep-canvas-loop/src/lib.rs` (1-30),
the two contract JSON files, and the prior reports' registry sections (06 finding 4; 07 line 229).

Not read: `crate::steps`, `crate::ease`, `crate::table`, `crate::outline`, `crate::columns` (the kit rules in
`core_lists.rs` call into them; a panic inside `steps::exactness`, `EaseTable::unchecked`/`check_ends`/
`check_shape` or `outline::winding` on a pack's entry would not show from here), `schedule/core_ops.rs`,
and `tests/acceptance/200`, `221`, `305`, `412`, `443` beyond the lines quoted. Nothing was compiled or run.

### Slice B: crates/deep-canvas/src/document/ (packs.rs, check.rs)

#### Nits (one line each)

Stale or loose comments and text:
- `packs.rs:204`: "The step ops this slice expands: a mark or an item of a kind the build registers" sits over four ops
  (`mark`, `item`, `builder`, `recipe`); line 787's error text lists all four.
- `packs.rs:1639-1641`: `is_derived` is documented "True when…" and returns the instance's ID (`Option<String>`).
- `check.rs:572-574`: `recheck`'s comment gives one reason for `None` (other ID maps); the code has three more
  (module costs, `packs`, a document or `items` that is no object).
- `packs.rs:236-241`: `license` is refused as "not an SPDX string" but only tested to be a string.
- `packs.rs:315` against `packs.rs:1446`: the same refusal says "this build has {version}" at the pack check and
  "this build has another" at resolve.
- `check.rs:876`, `1468`, `1569`: "longer than 400 characters", the role list and the box-point list are typed out
  beside `MAX_DESCRIPTION`, `ROLES` and `BOX_POINTS` (same values today).
- `packs.rs:1937`: "names no curve@1 item" though `curve_points` (1681) takes any item with `params.points`, and the
  pack check admits `along` naming any input, not only an `ID` one (851).

Loose checks (each lets something through unread):
- `packs.rs:728-738`: an input's `min`/`max` that is no number and `options` entries that are no string are dropped
  silently, so `"min": "1"` bounds nothing.
- `packs.rs:683-685`, `check.rs:2244`: `u64`/`u32::parse` take a leading `+`, so recipe version `"+1.+0"` and frame
  rate `"+30/1"` pass.
- `packs.rs:1092-1129` with `156-169`: a twin whose `expect` names no rule is ignored, `twins` is ignored when there
  are no `rules`, and a twin "fails" its rule whenever a var is NaN (a wrong-typed param, or an input with no
  default and no param), so `{"expect": "<code>"}` alone can satisfy the kind kit. QUESTION for the kit's owner.
- `packs.rs:2374-2422`: a `{"repeat": {...}}` value with a mistyped key or a bad `let` becomes a literal object
  (`Form::Literal`) instead of a pack-check issue.
- `packs.rs:2413-2416`: any string the grammar reads is an expression, so a step param `"2024"` becomes the number
  2024 and `"north-east"` fails with "`north` is not in scope"; nothing escapes a literal. QUESTION.
- `packs.rs:2266` before `2273`: a step's own `channels` on an op `recipe` step are admitted and never written.
- `packs.rs:1027-1090`: two rules with one `code` are both kept.
- `check.rs:1598`: `at.anchor` is any string holding `#`.

Small behavior:
- `packs.rs:1790-1815`: an explicit `null` param raises two issues ("not a number" and "required, and absent").
- `packs.rs:1818-1853`: duplicate `broken_out` entries are kept, so `["a", "a"]` and `["a"]` give different keys.
- `packs.rs:2821-2831`: `shown` appends `…` to text over 80 bytes but 80 characters or fewer without cutting it.
- `packs.rs:1699-1719`: `along_at` on a zero-length first segment gives yaw `-0` from that segment, not the next.
- `packs.rs:873-879`: the count's read test repeats the `unfixed` closure defined at 823.
- `check.rs:459-465`: `costly` gets an item's ID once per cost function, so two on one kind list it twice.
- `check.rs:1751`: `gamma` of `1e-50` passes (above 0 as f64, 0 at f32).
- `packs.rs:28`, `185`, `check.rs:382`: `pub const MAX_REPEAT`, `MAX_DEPTH`, `FRAME_CPU_MS` have no user outside
  their file (`rg 'packs::MAX_DEPTH|MAX_REPEAT\b|FRAME_CPU_MS' crates packages scripts tests benchmarks adapters docs packs`
  → only these files; `check` is a private module and does not re-export `FRAME_CPU_MS`). They could be private.

Outside this slice, seen while checking callers (for whoever owns the file):
- `crates/deep-canvas/src/expr.rs:1107-1122`: `compile` caps nodes after parsing; its parser was not read and may
  need the same parse-time bound as B-3.

#### Coverage

| File | Read |
|---|---|
| `crates/deep-canvas/src/document/packs.rs` (3625 lines) | in full, tests included |
| `crates/deep-canvas/src/document/check.rs` (2546 lines) | in full |
| `crates/deep-canvas/src/document/apply.rs` | lines 300-330 and 1290-1391 only (callers of `is_derived`, `derived_of`) |
| `crates/deep-canvas/src/document/mod.rs` | lines 30-45, 109-212, 255-271, 538-545, 596-672, 1205-1262 (re-exports, constants, the recheck law test, the `requires` test) |
| `crates/deep-canvas/src/budget.rs` | lines 60-120 |
| `crates/deep-canvas/src/registry/mod.rs`, `expr.rs`, `ops.rs`, `cost.rs`, `render.rs` | greps and a few lines each (`has_costs`, `CORE_VERSION`, `compile`, the sum loop, `sqrt`/`asin`, `estimate_by`, the size guard) |
| `crates/deep-show/src/shared.rs` | lines 400-422, 905-960 (the recheck caller, `blocking`) |
| `crates/deep-canvas-motion/src/doc.rs` | lines 637-651, 1165-1190 (`section`, `driver_of`) |
| `tests/acceptance/306`, `420`, `433` | file lists and greps only (break-out, `when`, `along`, error texts); not read line by line |
| `docs/technical-design.md` | grepped for break-out, `requires.core`, `frame` relations: no matching text found, so the semantic calls above (B-5, B-14, B-15, B-18) are QUESTION or LIKELY, not SURE |
| prior reports 06 (finding 4, O2, modularity note on `check.rs:2374`, dispositions) and 07 | 06's sections on these files read; 07 has no mention of either file |

Not read: `rules.rs`, `rows.rs`, `close.rs`, `requires.rs`, `shape.rs`, `merge.rs`, `order.rs`, `transform.rs`
(other slices). Not done: no test or build was run, so every LIKELY above is unproven by execution; issue numbers
in comments (#306 AC8, #379, #488, #497 and the rest) were not checked against the tracker.

### Slice G: the ten small crates

#### Nits

Comments and docs that describe something else:
- `crates/deep-canvas-sandbox/src/layouts.rs:403-404`: `nav_level`'s comment says "five mesh polygons and six sorted links, with three tags"; it builds 3 nodes, 3 links and 2 tags (`:417-428`). The five/six/three level is the acceptance suite's own (`tests/acceptance/415/README.md:147`). Fix: "three mesh polygons and three sorted links, with two tags and typed links in nav.graph@2". SURE.
- `crates/deep-canvas-sandbox/src/rewrite.rs:624`: the comment in `encoded` says a section's encoding is "its id, its size and its contents"; the code skips only the LEB size, and `sized` (`:559-560`) pushes the id itself before `encode`. Fix: "its size and its contents". SURE.
- `crates/deep-canvas-test-modules/src/lib.rs:695`: "Only `deep-gpu`'s `test-meter` build holds it"; the feature and the call are in `deep-gpu-layer` (`crates/deep-gpu-layer/Cargo.toml:23`, `src/live.rs:130`), and `deep-gpu` has no such feature. SURE.
- `crates/deep-canvas-test-modules/README.md`: names the #305 and #488 modules and two files; the crate also holds `sandbox.rs` (#238), `probe.rs` (#499), `sim.rs` (#185), `kinds.rs` (#412), `registries.rs` (#200) and the #387, #371, #403, #497 modules in `lib.rs` and `time.rs`.
- `crates/deep-logic/src/piece.rs:742`: `assets_at` is called "an immutable i32 global", but only `reads_at`/`writes_at` are held immutable (through `check_role`, `crates/deep-canvas-sandbox/src/check.rs:666-672`); a mutable `assets_at` is admitted.
- `crates/deep-logic` had no README.md at 06fd33cd (every crate but it and `deep-canvas-media` has one); one is in the working tree now.
- `crates/deep-canvas-sandbox/src/layouts.rs:610` against `:664-673`: table.layout@1's doc says a column's `target` is 0 unless the column is a ref or refs; the validator never checks it. QUESTION (a validator edit changes its hash in `layouts/judged.json`).

Loose input handling:
- `crates/deep-canvas-sandbox/src/lib.rs:25-27`: `admits` parses hex with `u8::from_str_radix`, which takes a leading `+`, so `"+1+2"` is hex for `[1, 2]`. Fix: `.filter(|b| b.bytes().all(|c| c.is_ascii_hexdigit()))` before the parse. One caller, `deep-canvas-test-modules/src/sandbox.rs:48`.
- `crates/deep-sandbox-wasmtime/src/service.rs:459`: `kit["fixtures"].as_array().cloned().unwrap_or_default()` lets `kit()` answer `PASS` with zero cases if the compiled-in kit.json lost its list. Fix: `.expect("sandbox@1's kit lists its fixtures")`.
- `crates/deep-logic/src/budget.rs:157-165` with `lib.rs:629-661`: `logic.budget` over a bake of 0 steps answers `PASS` with an empty report; `golden_verify` (`lib.rs:600-626`) passes a golden of 0 steps the same way. QUESTION against invariant 2.
- `crates/deep-logic/src/lib.rs:126-134`, `crates/deep-canvas-input/src/session.rs:240-249`, `crates/deep-canvas-input/src/kit.rs:24-32`: three copies of seconds-to-flicks that truncate toward zero and then add 1 at a fraction of 0.5 or more, so −0.6 s is 0 flicks, not −1. They agree with each other; see the core's own conversion in slice E.
- `crates/deep-canvas-input/src/session.rs:1242-1243`: a handle `travel` of 0 gives NaN values (`(w − centre) / travel`), which reach the track as JSON `null`.
- `crates/deep-input/src/main.rs:30`: `fps` parts are cast `u64 as u32`, so `[4294967296, 1]` reads as 0 fps (then `fps.0.max(1)` at `session.rs:277`).
- `crates/deep-input/src/main.rs:104-111`: a blank line answers `bad_input`; `deep-sandbox` and `deep-logic` skip blank lines (`crates/deep-sandbox-wasmtime/src/main.rs:26`, `crates/deep-logic/src/main.rs:24`).
- `crates/deep-canvas-graph/src/labels.rs:150-153`, `:284-303`: `bucket` is `i32::MIN`/`MAX` for a zoom of 0 or infinity and `place` walks one bucket at a time from 0; the bitmap is `(frame × zoom ÷ cell)²` bits, so zoom 256 on an 800 × 500 frame at `cell` 2 asks for about 800 MiB. The one caller filters `zoom > 0 && finite` (`crates/deep-marks-render/src/lib.rs:778-781`) and caps nothing above.
- `crates/deep-canvas-graph/src/lib.rs:157-163`, `:296-320`: `min_len` up to 65,535 makes one row and one pass slot per skipped rank, so a chain of 100 such edges allocates 6.5 million rows. By design a number a document may write; noted, not a fix.
- `crates/deep-canvas-loop/src/count.rs:105-113`: `c[0] + dx` on a cell index overflows in a debug build for a position past 9.2e13 (or infinite) at the default weld. The glTF reader is scene3d's; whether it refuses non-finite positions was not checked.
- `crates/deep-sandbox-wasmtime/web/runner.mjs:90-96` against `service.rs:66-76` and `:184`: the web runner's defaults (fuel 1e9, stack 262144) are the provider's for every role, and it never sizes a validator's memory to the asset plus 4 MiB. Nothing sends it a validator today (`kit_plan` sends providers).
- `crates/deep-sandbox-wasmtime/web/runner.mjs:66-75`: `engineKind` matches V8's trap messages; another engine's wording for a memory trap would fall through to `unreachable`. Not verified in a browser.
- `crates/deep-logic/web/logic.mjs:203`: inputs are sorted by JS string order (UTF-16 units); Rust's `BTreeMap<&str, _>` (`world.rs:548`) sorts by bytes. They differ only for control names mixing astral and high BMP characters, and only in a trap's `inputs` list.

Settings that differ for no stated reason:
- `serde_json` features: `deep-canvas` and `deep-canvas-seams` take `preserve_order` only; `deep-canvas-test-modules` takes none; the other eight crates here take `preserve_order` and `float_roundtrip`. One workspace build unifies them, so behavior is the same; a crate built alone (`cargo test -p deep-canvas`) parses floats without `float_roundtrip`.
- `rust-version = "1.95"` is set in `deep-canvas-loop` (and nine crates outside this area) and absent from the other ten crates here.

`pub` with no user outside its own file (`rg -w` over `crates packages scripts tests benchmarks docs adapters packs`; each could be private, none is dead): `zoom::ListsFiles`; `check::{instruction_name, MAX_TABLE, RESERVED, role_exports}`; `layouts::{fn_table_bytes, nav_level, pages_bytes, NAV_TAG_CAP}`; `module::WASMTIME_FEATURES`; `rewrite::{CALL_OVERHEAD, CANONICAL_F32, CANONICAL_F64}`; `labels::{bucket_zoom, FADE_MARGIN}`; graph `TITLE_ADVANCE`, `TITLE_BAND`, `TITLE_HEIGHT`; input `THRESHOLD_PX`; logic `checks::PROBE_STEPS`, `lines::{at_address, code_start}`.

#### Checked and found sound

- The rewrite (`rewrite.rs`): every instruction sits in exactly one charged block; a loop's back edge reaches the charge placed after `loop`; `memory.fill`/`memory.copy` charge their length before they run; `memory.grow` traps; the start section is dropped and exported; branches to the function label land on the wrapper block, so the stack epilogue runs on every exit; the counters sit after the program's own globals, which the validator bounds, and `sandbox.`-prefixed exports are refused (`check.rs:532`). The NaN select keeps a non-NaN value and replaces a NaN. Frame sizes cannot overflow i32 at a 4 MiB program.
- The five first-party validators (`layouts.rs`): every count and offset is checked against the asset's length in i64 before a read goes through it; the twins and fixtures match the documented offsets.
- No `HashMap` or `HashSet` reaches output in these crates: `count.rs` uses two as lookups only. No clock or randomness outside `deep-input`'s probe, `deep-graph`'s `ms`, `deep-logic`'s budget timing and the seams' seeded relay.
- Cargo.toml: every dependency of the eleven crates has a `use` or path in its crate (checked by `rg '<crate>::'`); wasmtime's features in `deep-logic` and `deep-sandbox-wasmtime` equal `module::WASMTIME_FEATURES`.
- `#[allow]` in the small crates: one, `service.rs:171` (`clippy::too_many_arguments`), needed. No `#[allow(dead_code)]` or `#[allow(unused)]` anywhere in the area. One `cfg!`: `lib.rs:104` in deep-logic, macOS against Linux for the CPU's name, both of which the lanes build.

#### Coverage

| Crate | Read |
|---|---|
| `deep-canvas-sandbox` | `src/*` in full; `kit/kit.json` first 60 lines and its `program`/budget values by grep; 2 of 29 `.wat` files; `layouts/judged.json` first 60 lines |
| `deep-sandbox-wasmtime` | `src/*` and `web/runner.mjs` in full |
| `deep-canvas-seams` | in full |
| `deep-canvas-loop` | `lib.rs`, `count.rs` in full; `fixtures.rs` first 65 of 152 lines |
| `deep-canvas-record` | `src/*` in full; `tests/hold.rs` first 30 lines |
| `deep-canvas-graph` | `src/*` in full; `tests/memory.rs` first 40 lines |
| `deep-canvas-input` | in full |
| `deep-input` | in full |
| `deep-logic` | `src/*` and `web/logic.mjs` in full |
| `deep-canvas-test-modules` | `lib.rs`, `sim.rs`, `time.rs`, `sandbox.rs`, `probe.rs` in full; `registries.rs` first 140 of 544 lines and `kinds.rs` doc comments, the rest by grep for `unwrap`, `expect`, `panic!`, hash maps and `allow` (none); every `pub fn` has a user outside its file |

## Coverage of the area

(to be completed when all slices are in)
