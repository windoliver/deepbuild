# #2700 addendum: `revise_items` compares only the members a patch reached

Added after the suite in `README.md`, by a job that saw only the issue body, the design and the base commit
`3010e4cf3`, which already implements this scope point. It closes the suite's gap "A patch says which members it
reached, and `revise_items` compares only those" (README: Not tested). Never edit a file here; a dispute goes to this
job's blind redraft.

## What was read

- Issue #2700 (body only), with the criterion the issue's owner added for this point, and `AGENTS.md`.
- `tests/acceptance/2700/` (README, `lib.mjs`, `probe/`, `twins.json`).
- Base sources: `crates/deep-canvas/src/schedule/mod.rs` (`Session::load`, `Session::revise_items`),
  `crates/deep-canvas/src/schedule/tests.rs` (its callers there) and its one hub caller,
  `crates/deep-show/src/efficiency.rs`; `benchmarks/budgets.json` (`canvas-patch-settled`, `canvas-patch-dirty`).

## The criterion

`#2700.dad8fae2`:

> A patch whose `reached` names no member outside `items` is revised without the whole load, even when another member
> differs. A planted `revise_items` that compares every member fails, naming the member

No earlier criterion covers this point. A deep compare of `serde_json::Value` allocates nothing, so the heap criterion
(`#2700.9725b660`) cannot see it, and its test goes through `document::recheck` anyway. The budgets criterion
(`#2700.db66efb8`) compares the change with the merge base, and the merge base is the compare-all program, so
compare-all passes it by definition. The issue's owner added `#2700.dad8fae2` for it.

## The surface

`deep_canvas::schedule::{Scheduler, Options, Session}` (`Session::new`, `Session::load`, `Session::revise_items(&mut
self, s, doc, ids, reached)`) and `deep_canvas::registry::{Registry, BuildSet}`. Calls go only through the public
entry. "Revised without the whole load" means `revise_items` answers `Some(issues)`. `None` sends its caller to
`load`, as `crates/deep-show/src/efficiency.rs` does.

The probe is `probe-reached/`, a crate apart from `probe/`. Its release profile turns **debug assertions off**.
`revise_items` debug-asserts that no member outside `reached` changed, and that unnamed member is exactly the
criterion's case. `probe/` builds with debug assertions on, so this probe cannot be one of its modes.
`reached.test.mjs` lays a copy at `target/acceptance-2700-reached/probe` and builds it with
`cargo build --release --manifest-path target/acceptance-2700-reached/probe/Cargo.toml --target-dir target/acceptance-2700-reached`.
The test refuses to judge a build whose `cfg!(debug_assertions)` is true.

## The test

`reached.test.mjs`: `#2700.dad8fae2 a patch whose reached names no member outside items is revised without the whole
load, even when another member differs`.

The board has two `rect@1` items, `data` and `assets`. For each member, `data` and then `assets`, a fresh session
loads it. Then `revise_items` gets a revision that changes item `a`'s box and that one member, with `ids = ["a"]` and
`reached = []`. The test first checks the scenario: the member differs, and nothing but `items` and the member
differs. A failure there is `BLOCKED`. Then it asserts the call answered `Some`. As a record only, the probe also makes
the same call with `reached = [member]`; on the base that is `None`.

Run: `node --test tests/acceptance/2700/reached.test.mjs` from the checkout root, Node 24, cargo (arm64) on `PATH`.
The output on the base is in `REVISE-ITEMS-BASE.txt`, and it passes.

## How it can fail

- A `revise_items` that answers `None` for an unnamed member that differs fails at the assertion: "revise_items
  answered None (the whole load) for a patch whose reached names no member outside items: it compared the member
  `data`, which differs from the revision before and which the patch did not name as reached".
- A probe that does not build (for example, the change renames `revise_items` or gives it other parameters), does not
  run or prints no report fails as `BLOCKED`.

## The twin: `compare-all`

`twins/compare-all/crates/deep-canvas/src/schedule/mod.rs` is the base's file with one line of
`Session::revise_items` changed. That line is the test of which members to compare. Instead of comparing the members
`reached` names, the twin compares every member outside `items` in both directions (one present on only one side
counts as differing). The `debug_assert!` and everything else stay.

```diff
-            if reached.iter().any(|k| l.doc.get(k) != doc.get(k)) {
+            if doc.as_object()?.iter().any(|(k, v)| k != "items" && l.doc.get(k) != Some(v)) || l.doc.as_object()?.keys().any(|k| k != "items" && doc.get(k).is_none()) {
```

`reached` is then unused, which is a compiler warning, not an error. The twin's file is the base's file. If the
change moves `revise_items` or edits `schedule/mod.rs` again, the twin must be laid over the change's file instead,
with this one behavior changed.
