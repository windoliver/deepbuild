# #1426 a17e5e56 on the real tree: a blind redraft

This folder holds one tagged test, the real-tree half of criterion `#1426.a17e5e56`: "A planted row naming a test that doesn't exist fails the lint, naming the row and the test; the same row naming an existing test passes. A row with no removal condition fails, naming the row". Its Scope line: "Each row names its test by full path and its removal condition: the upstream change that would retire it, or 'none' with a reason. The lint resolves each named test against the suite's own test list, so a row naming a test or script that doesn't exist fails, naming the row."

The planted half (the lint failing planted rows) stays with the added-criteria draft. This redraft replaces only that draft's real-tree check, which read the test files' text. Here each named test must be in its suite's own list, read from the suite's runner.

## What this job read

- Issue #1426 as `gh issue view 1426` gave it on November 7, 2026: Scope, the 13 criteria, Proof, Depends on.
- `AGENTS.md` and the Dogfooding bullet of `docs/technical-design.md`, at the base `db917989` (main of November 7, 2026, where nothing of #1426 is implemented).
- From the base: `scripts/proof-change.mjs` (`criterionId`), `scripts/lanes.mjs` (`named`, `reportResults`, `testGlobs`, the unit lane), `scripts/proof-vitest-reporter.mjs` (how a vitest name joins its suites), `vitest.config.ts`, `package.json`, the root `Cargo.toml` and `.cargo/config.toml`, `vendor/` (the four trees and `gpui-pre-apple/upstream/README.md`), and `tests/acceptance/882`'s conventions.
- The first draft's `README.md` and `common.mjs`, and the added-criteria draft's `README.md` and `common.mjs`. Nothing else of either draft.
- Nothing that describes how #1426 was implemented reached me. The user's memory index was in this job's context. Its loaded part has no line on #1426.

Per AGENTS.md the implementing agent doesn't edit these files. A dispute goes to a blind redraft of this job.

## The surface (the earlier drafts' terms)

- The table sits in `vendor/gpui-pre-apple/upstream/README.md` under `## Carried patches`, with exactly these six columns: `| Behavior | Issue | Files | Test | Budget | Removal |`.
- **Removal** holds the upstream change that would retire the row, or `none: <reason>`. An empty cell, a dash (`—`, `–` or `-`), or `none` with only punctuation after it (`none`, `none:`, `None.`) gives no removal condition.
- **Test** is `` `<path> › <name>` ``. The path is a full path from the repo root to a file that exists. It isn't absolute, doesn't start with `./`, and holds no `..`. A bare file name only resolves if the file sits at the root. The name is the test's whole name, as `scripts/lanes.mjs`'s `named` gives it, with each enclosing suite and ` › ` between them.

### The suite's own list, per runner

| File | Runner | How this test reads its list | A name there |
|---|---|---|---|
| `*.test.mjs`, `.test.cjs`, `.test.js` | `node --test` | `node --test --test-isolation=none` on the file, with `--test-name-pattern` matching the name's segments, and a reporter that records each test started and ended. Node has no list mode, so the named test itself runs. A suite isn't a test. | suites and parents joined by ` › `, as `lanes.mjs` reads a node report |
| `*.test.ts`, `.test.tsx`, `.test.mts`, `.test.cts`, `.spec.*` | vitest | `vitest list <path> --json` from the tree's root, with its own config and `node_modules`. No test body runs. | vitest's ` > ` read as ` › ` |
| `*.rs` | `cargo test` | `cargo test --locked --offline --manifest-path <crate>/Cargo.toml <target> -- --list`, in the nearest crate up, with a temporary target folder. The target is `--test <stem>` for `tests/<stem>.rs`, `--bins` for `src/main.rs` or `src/bin/`, and `--lib` for the rest of `src/`. | the listed name, module path included, such as `tests::switch_denies_the_engine` |

- Any other file is a script no runner lists, and its row fails.
- A name must equal a listed name. A comment, a string, the start of a longer name, a suite, or a leaf without its suite isn't in the list.
- **The file's text only disproves.** For a Rust row, a file with no `fn <last segment of the name>` fails before cargo runs. Text never passes a row.

### Nothing builds gpui

- A Rust row whose crate is named `gpui*`, or whose dependency graph (`cargo metadata --locked --offline`, which builds nothing) reaches a package named `gpui*`, reads **INCONCLUSIVE**: listing it needs a gpui build, which this test doesn't run. That covers gpui-pre, gpui-pre-apple, and any crate through gpui-kit or gpui-shell. The text disproof above still runs first, so a missing fn there fails.
- Every node and vitest run gets a `PATH` whose `cargo`, `rustc`, `rustup`, `xcrun`, `xcodebuild`, `swift` and `swiftc` exit 97 without running, and a temporary `HOME`. A node test that builds when run is still listed, but its build is refused. A test that calls a tool by its absolute path gets past this. That is a limit of the guard.
- The `cargo test --list` of a crate free of gpui builds that crate and its dependencies, cold, in a temporary target that is removed afterwards. In the probe below, `deep-contracts` took about 10 s.

### Verdict

- `FAIL` when any row fails, or when the table is missing, has a header other than the six columns, or has no rows. Each `FAIL row <Behavior>: ...` line names the row, and where a test is named, its path and name.
- Otherwise `INCONCLUSIVE` when any list couldn't be read. Each such line names what was missing: vitest not installed, a vitest config that won't load, cargo not on `PATH`, no `Cargo.lock`, `cargo metadata` failing offline, a cargo build failing, a gpui build, a node file that fails to load, or a timeout. The test then throws `INCONCLUSIVE: ...`, which `lanes.mjs`'s `stateOf` reads as INCONCLUSIVE. It never passes.
- Otherwise `PASS`, with one `PASS row` line per row giving the test, its runner and the removal condition.

## How to run

From the repo root, on Node 24, after `npm ci`:

```sh
node --test tests/acceptance/1426/added-real/real.test.mjs   # #1426.a17e5e56; seconds per node or vitest row, a cold crate build per Rust crate
node --test tests/acceptance/1426/added-real/wrong.test.mjs  # the judge against wrong tables; passes at the base; about 5 s
```

- A vitest row needs the repo's `vitest.config.ts` to load. At the base it imports workspace packages, which need `npm run build --workspaces` first. The typecheck lane runs that build. Without it, a vitest row reads INCONCLUSIVE.
- A Rust row needs `cargo` on `PATH` and its dependencies in cargo's cache, since the listing runs `--offline`.
- `wrong.test.mjs` needs `cargo` on `PATH`. It plants a tree under `/tmp/da1426-real-plant-*` with:
  - a node test file;
  - a vitest file, with the repo's `node_modules` linked in;
  - a Rust crate with no dependencies;
  - a crate with no `Cargo.lock`;
  - a stub `gpui-pre` whose `build.rs` writes `BUILT_GPUI` if anything builds it, and a crate depending on it.

  Every case checks that `BUILT_GPUI` never appears. The control also checks that the node test it ran met a refusing `cargo`.
- Nothing writes to the repo. Each run's scratch is under `/tmp/da1426-real-*` and is removed.

## Criterion, test and wrong programs

| ID | Criterion | Test | Wrong tables the judge must fail (`wrong.test.mjs`) |
|---|---|---|---|
| `#1426.a17e5e56` | A planted row naming a test that doesn't exist fails the lint, naming the row and the test; the same row naming an existing test passes. A row with no removal condition fails, naming the row | `real.test.mjs`, Scope on the real tree. Each row of the checkout's table gives a removal condition, names its test by a full repo path to a file that exists, and that test is in its suite's own list. | **Removal:** empty, `—`, `-`, `none`, `none:`, `None.` each fail naming the row. **Test:** each of these fails naming the row, the path and the name: <ul><li>a node test held only in a comment or a string;</li><li>the start of a name;</li><li>a suite, or a nested test without its suite;</li><li>a gone file, a bare file name, or an absolute path;</li><li>a file no runner lists;</li><li>a vitest test in a comment, or without its suite;</li><li>a Rust test in a comment, a plain `fn`, a name without its module path, or a fn the file lacks (in gpui too).</li></ul>An empty, dashed, path-only or name-only Test cell fails naming the row. One bad row among good ones fails, naming only it. No README, a five-column table and an empty table fail. **Unread lists** are INCONCLUSIVE, never PASS: a gpui crate, a crate through gpui, no vitest, no cargo, no `Cargo.lock`, a node file that won't load. A FAIL stands over an INCONCLUSIVE. **Control:** a node top-level test, a describe-nested test, a `t.test` subtest, a vitest test and a Rust test, each with a removal condition, pass. |

`BASE-FAILURE.txt` holds the base run, a mutation check of the self-tests, and probes of the listers on the real tree.

## Assumptions a redraft may revisit

- **A node list runs the named test.** Node has no list mode: with a name pattern, unmatched tests aren't reported at all. Running the one named test, with build tools refused, is the closest to "the suite's own list" that builds nothing. A heavy node test still costs its run time.
- **A Rust row in gpui can't PASS here.** The real list needs a gpui build, so such a row reads INCONCLUSIVE. AC2's four behaviors may well be Rust tests in `vendor/gpui-pre-apple`. If so, this test stays INCONCLUSIVE until a run that may build gpui reads those lists. The text disproof still catches a missing fn. At the base, the BGRA test `render_bgra_surface_premultiplied` lives only in `upstream/0001-...patch`, not in the vendored source.
- **A file that won't load** reads INCONCLUSIVE, not FAIL, because its list can't be read.
- **"Full path"** means relative to the repo root and normalized. Whether the file is tracked by git isn't checked, so an untracked file in a checkout counts.
- **Removal's wording** goes beyond the dash and `none` rules only this far: any other text passes. Whether it names a real upstream change isn't judged.
- **The Rust target** is picked from the file's place in its crate. A test file a crate maps to some other target through `[[test]] path = ...` may be listed under the wrong target and read FAIL. None of the base's vendored or workspace crates do this for a test file.
- **Vitest drops skipped tests** from `vitest list`, so a row naming a `test.skip` there fails. Node lists a skipped test, so it passes.
