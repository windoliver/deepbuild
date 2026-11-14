# Acceptance test for #1417, first criterion (blind redraft): a 100,000-node graph refused at check

Written first, from issue #1417 (its body, scope and four criteria), the design sections below and base commit
`d4ed7be7` ("Merge pull request #1681 …", main at the time), by a job that saw no implementation, no branch or PR for
#1417 and no other suite for it. It covers one criterion only:

- `#1417.52357c9c` (first 8 hex of SHA-256 of the criterion's text): "A 100,000-node graph is refused at check with
  `over_budget`, naming the operator and its estimate; on main it passes the check"

The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft (design:
Dogfooding).

## What was read

- AGENTS.md; `docs/technical-design.md`: Dogfooding, Canvas modules and the module table's `graph` row.
- `docs/canvas-primitives.md`: The cost model and its budget class table (graphs are in the data view: 2 ms frame
  CPU, "layout and labels off the UI thread"); Document envelope (`budget`, `requires.modules`); Operator and read set
  (`cost: {ns_per: term, bench}`); Graph and layout memory `graph@1`, `layout@1` (its fields, `budget: ms = 50`, its
  Cost line).
- At the base: `crates/deep-canvas-graph` (`module.rs`: `layout` registered with no cost; the `layered` fixture's
  board), `crates/deep-canvas/src/cost.rs` (`estimate_by`: an operator's terms from `costs.json` per item, so
  `graph.layout` costs 10,792 ns per graph item whatever its size), `budget.rs` (classes and `of`),
  `document/check.rs` (`budget_check`'s `over_budget` error at `path: "budget"` with `ids` the top three items and
  `actual` `{cpu_ms, gpu_ms, gpu_mb, fingerprint}`; `module_checks`' 16 ms warning), `crates/deep-show` (`run`, the
  `deep_show` call, `include`, its `outcome` and `issues`), and the suites `tests/acceptance/399` and `379` (helpers,
  vitest, merge-base builds, the `deep_show` scenario).

## Run

```sh
npx vitest run --root tests/acceptance/1417-redraft-ac1 --no-file-parallelism --testTimeout=600000
npx tsc -p tests/acceptance/1417-redraft-ac1/tsconfig.json
```

The file builds `deep-show` with `cargo build --locked --bin deep-show` (debug, default `full` set, with
`CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set, honoring `CARGO_TARGET_DIR`) here, and once at the
merge base with `origin/main`: when HEAD is the merge base and no tracked file differs, this checkout's build is the
merge base's; otherwise the merge base is exported by `git archive` into `target/acceptance-1417-base/<sha12>` and
built there into its own `target`, as #399's suite does. Each run sends a document of about 6 MB; a debug run of it
takes about 10 s and 1.3 GB at the base. Delete `tests/acceptance/1417-redraft-ac1/node_modules/.vite` after a run.

## The document

One `profile: "board"` document, `budget: {class: "data_view"}` (the class the design gives graphs),
`requires: {modules: {graph: "^1"}}`, size 1280 × 720, holding one `graph@1` item `g` with `params.graph` of 100,000
nodes `n000000 … n099999` (each 8 × 8 u) and 99,000 edges `e001000 … e099999`, edge `e<i>` from `n<i-1000>` to
`n<i>`, so the layered layout makes 100 ranks of 1,000; `params.layout: {algo: "layered", seed: 1417}`. At the base
it is a valid board: `deep_show` presents it with no issue at all, so only a budget can refuse it.

## Assumed surfaces

The issue names `over_budget`, "the operator" and "its estimate" but no field. These are the smallest surfaces the
issue and the design give, read where the base's check already puts an `over_budget` issue:

- **Where:** `deep-show run`, one `deep_show` call by a session whose document is on screen in a panel, with
  `include: ["issues"]`; the reply's `outcome` and `issues` (each `{code, severity, ids, path, actual, what, …}`, as
  the base writes them).
- **Refused at check:** `outcome: "refused"`, `snapshots: []`, and at least one issue `code: "over_budget"`,
  `severity: "error"`.
- **Naming the operator:** that issue names `graph.layout`, the operator's registry key (`module.operator`, as
  `costs.json` and the `registry` call key it): the exact text `graph.layout` inside its `what`, or as a string value
  in its `ids`, `path` or `actual`.
- **Its estimate:** that issue's `actual` carries the operator's estimate in ms: `actual` is the number, or one of
  its top-level members is a finite number; the test requires one such number past 2 ms, the data view's frame CPU
  cap (a graph over any budget of its class has an estimate past it; the layout's own `budget: ms = 50` is past it
  too). The test doesn't fix the member's name, the cap compared with, or the item naming.
- **On main it passes the check:** the same bytes, through the same call on the merge base's build, give no issue of
  `severity: "error"`, no `over_budget` issue of any severity, and `outcome: "presented"`.

`BASE-FAILURE.txt` gives the result at the base.
