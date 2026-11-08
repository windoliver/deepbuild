# Acceptance tests for #1426's added criteria

These tests cover the three criteria added to #1426 on November 8, 2026, and the three Scope lines that came with them: rows name their tests by full path and give a removal condition, the lint covers every tree under `vendor/`, and a clean rebase moves the pin only when the rows' tests pass. The first draft, one folder up, covers the other ten criteria.

## What this job read

- Issue #1426 as `gh issue view 1426` gave it during this job, after its November 8 edit: the Scope lines and the 13 criteria.
- From the base commit `db917989` (main of November 7, 2026, where nothing of #1426 is implemented): `AGENTS.md`, the Dogfooding bullet of `docs/technical-design.md`, `scripts/proof-change.mjs` (`criterionId`, `readIssue`, tags), `scripts/lanes.mjs` (the `lint` lane, `runLanes`, `named`), `vendor/` (all four trees, `gpui-pre-apple/upstream/README.md`, `unicode-17.0.0/README.md`, quickjs-jit-runtime's `Cargo.toml`), `.cargo/config.toml`, and the conventions of `tests/acceptance/882`.
- From the first draft, only its `README.md`, `common.mjs`, `lint-judge.mjs` and `merge-judge.mjs`.
- I fetched no pinned release. No test here needs one.
- Nothing that describes how #1426 was implemented reached me. The user's memory index was in this job's context; the part loaded holds no line on #1426.

Per AGENTS.md the implementing agent doesn't edit these files. A dispute goes to a blind redraft of this job.

## The added surface (my choice where the issue and the first draft name none)

Everything the first draft fixed stands: the table under `## Carried patches` in `vendor/gpui-pre-apple/upstream/README.md`, the mark `DeepBuild patch (windoliver/deepbuild#<n>)`, `check`'s `FAIL`, `BLOCKED`, `INCONCLUSIVE` and `ROW` lines, `merge <crate> <version>` and its `CONFLICT <path>:<line>` lines, `DEEP_VENDOR_RELEASES=<dir>` holding `<release>/` stub releases, the `lint` lane running `scripts/vendor-rebase.mjs check`, and a planted git checkout as the script's working folder. I added the following.

### Where a row's removal condition goes

A sixth column, `Removal`, after the first draft's five:

```
| Behavior | Issue | Files | Test | Budget | Removal |
|---|---|---|---|---|---|
| The BGRA surface ... | #377 | `vendor/gpui-pre-apple/src/metal_renderer.rs` | `vendor/gpui-pre-apple/src/metal_renderer.rs › metal_renderer::tests::render_bgra_surface_premultiplied` | — | none: zed closed zed-industries/zed#66114 unmerged on 2026-10-28 |
| The JIT switch | #358 | `vendor/quickjs-jit-runtime/src/lib.rs` | `...` | — | longbridge/quickjs-jit adds a switch that denies native code |
```

- The cell holds the upstream change that would retire the row, in words, or `none: <reason>`.
- An empty cell, a dash (`—`, `–` or `-`), `none` or `none:` with nothing after it is no removal condition. `check` fails the row with a `FAIL` line holding its Behavior.

### What "the suite's own test list" is, per runner

The Test cell keeps the first draft's form, `` `<repo path> › <test name>` ``. The path is the test file's full path from the repo root, so a bare file name doesn't resolve. The runner goes by the file:

| File | Runner | Its list | A name there |
|---|---|---|---|
| `*.test.mjs`, `*.test.js` | `node --test` | the tests the file registers when run, as `--test-reporter=tap` lists them (`# Subtest: <name>`) | a top-level test's whole name |
| `*.test.ts` and the other vitest suffixes | vitest | `vitest list <file> --json`, run from the repo root with the repo's `node_modules`, with ` > ` read as ` › ` | a test's whole name |
| `*.rs` | `cargo test` | `cargo test --locked -- --list` in the crate holding the file (the nearest `Cargo.toml` up), its lines `<name>: test` | the listed name, module path included, such as `tests::switch_denies_the_engine` |

- A name must equal a listed name. Text in the file, a comment, a string or the start of a longer name isn't a test.
- A file that isn't there is a script that doesn't exist.
- A `FAIL` line holds the row's Behavior and the test's name (or, for a missing file, its path).
- A Rust list read from the sources rather than from cargo is the implementer's call, as long as it gives the same names: a `fn` without `#[test]` isn't listed.

### How a tree with no `Cargo.toml` names its pinned release

- A tree under `vendor/` with a `Cargo.toml` is pinned by its `[package]` `version`, as the first draft says, and its stub release is `<folder>-<version>/`.
- A tree with no `Cargo.toml`, such as `unicode-17.0.0`, is named by its folder: `<name>-<version>`. Its stub release is `DEEP_VENDOR_RELEASES/<folder>/`, holding the files as their source publishes them (for Unicode, unicode.org's `Public/17.0.0/ucd/` files), at the paths the vendored tree holds them.
- The tree's own `README.md`, which lists each file's source and SHA-256, is ours. The plant's stub release holds a copy of it too, so a script that leaves it out and one that compares it both pass the plant. A script that checks each file against the README's SHA-256 also passes, since the plant's README holds the stub files' hashes.
- Every folder under `vendor/` is a tree: today's four, and any crate vendored later, as a wgpu patch for #1552 or #475 would be. A later crate needs nothing but its folder and its `Cargo.toml`.

### What `merge` does when the merge is clean and a row's test fails

- After a merge with no conflict, `merge` runs the rows' tests on the merged tree. The plant's failing test belongs to a row of the merged crate, so reading "the rows' tests" as every row's or as the merged crate's rows both work.
- When one fails, the pin stays where it was: the tree's `Cargo.toml` keeps its old `version`. `merge` exits non-zero, lists no `CONFLICT`, and prints a line naming the failing test with a word saying it failed (`FAIL`, `fails`, `failed` or `not ok`), such as `FAIL tests/planted/carried.test.mjs › gradient keeps its stops: fails on gpui-pre 0.3.10; the pin stays at 0.3.9`. It names no passing test as failing.
- Whether the merged sources stay in the tree for a look, or the tree goes back as it was, is the implementer's call. The criterion speaks of the pin only.
- When every row's test passes, the pin moves, as the first draft's clean merge already wants.
- "On the reference Mac": the tests run where `merge` runs. A real trial runs on the reference Mac; the plant's tests are plain node tests that pass on any machine. A script that refuses to move a pin off the reference Mac would fail the control here on another machine.

## How each criterion is read

IDs are `scripts/proof-change.mjs`'s `criterionId` on the issue's exact text: the first 8 hex digits of SHA-256 of the text, trimmed, white space collapsed.

| ID | Criterion | Tests | Wrong programs it must fail on |
|---|---|---|---|
| `#1426.a17e5e56` | A planted row naming a test that doesn't exist fails the lint, naming the row and the test; the same row naming an existing test passes. A row with no removal condition fails, naming the row | `rows.test.mjs`. node --test: the gradient row naming `gradient keeps every stop`, which the file holds only in a comment, fails naming the row and the name; the same row passes once the file has that test. A file that is gone, the start of a name (`gradient keeps`), a name held only in a string, and a bare file name each fail naming the row and the test. Scope: vitest (a comment fails, a real test passes) and cargo (a missing test and a plain `fn` fail, a real test passes). Removal: empty, `—`, `none` and `none:` each fail naming the row; `none: <reason>` and an upstream change pass. Scope, on the real tree: each row has a removal condition and names a test file in the repo that holds the test's name | `check-text-match` (the first draft's rule: the file's text), `check-file-only`, `check-basename`, `check-no-test-name`, `check-refuse-tests`, `check-no-removal`, `check-bare-none` |
| `#1426.ed3ed529` | A planted changed file under `vendor/quickjs-jit-runtime` with no row fails the lint, naming the file | `trees.test.mjs`. A changed `src/engine.rs`, a nested `src/runtime/osr.rs`, a changed `build.rs` and a new `src/planted_new.rs`, each with no row, fail `check` with a `FAIL` line naming the file; `engine.rs` listed in the switch's row passes. Through `runLanes`, the `lint` lane fails as `FAIL lint: ...` with a line naming the file. Scope: a changed and a new file in `unicode-17.0.0`, and a changed file in a crate vendored later (`vendor/wgpu-hal`), fail naming it, while that crate unchanged passes. On the real tree a row lists `vendor/quickjs-jit-runtime/src/lib.rs` | `check-gpui-only`, `check-changed-only`, `check-top-level`, `check-unnamed`, `check-crates-only`, `check-fixed-trees`; lanes `lanes-none`, `lanes-other-lane`, `lanes-paths` |
| `#1426.fdfd6785` | A planted rebase that applies cleanly while one row's test fails leaves the pin where it was and names that test | `pin.test.mjs`. Stub gpui-pre 0.3.10 rewrites upstream's color line 5 and gpui line 7, far from any carried hunk. The gradient row's test reads line 5, so it fails on the merged tree. `merge gpui-pre 0.3.10` lists no conflict, keeps `version = "0.3.9"`, exits non-zero, names `gradient keeps its stops` as failing and neither passing test. Scope control: the same merge with line 20 rewritten instead breaks no test and moves the pin to 0.3.10 | `merge-moves-anyway`, `merge-tests-before` (runs the tests on the old tree), `merge-no-name`, `merge-names-all`, `merge-exit-zero`, `merge-never-moves` |

`wrong/reference.mjs` is a small reference of the added surface alone. It reads stub releases only and holds none of the first draft's budgets. Each `check-*` and `merge-*` twin is one fault of it, and `wrong/control.mjs` is it with none. `wrong.test.mjs` also runs every judge on a script that prints nothing, one that refuses everything and a missing one, and each judge fails all three.

## How to run

From the repo root, on Node 24, after `npm ci`:

```sh
node --test tests/acceptance/1426/added/rows.test.mjs    # a17e5e56; about 10 s
node --test tests/acceptance/1426/added/trees.test.mjs   # ed3ed529; about 5 s
node --test tests/acceptance/1426/added/pin.test.mjs     # fdfd6785; about 1 s
node --test tests/acceptance/1426/added/wrong.test.mjs   # the judges against wrong programs; passes at the base; about 40 s
```

- Nothing here needs the network, a gpui build or Metal.
- **What each heavier test needs.** Where a thing is missing the test fails with `INCONCLUSIVE`, naming it. It never passes.
  - The vitest case in `rows.test.mjs` needs the repo's `node_modules` (`npm ci`). Each plant links it in at `node_modules`.
  - The cargo case needs `cargo` on `PATH` and a Rust toolchain. It builds a planted crate with no dependencies, about a second a case. The plant points `CARGO_HOME` and `RUSTUP_HOME` at your own, since each run gets a temporary `HOME`; without that, rustup would install a toolchain into it.
  - The lane case runs `scripts/lanes.mjs`'s `runLanes` in the plant with a temporary `HOME`, so its evidence record stays out of `~/.deepbuild`.
- Every test plants under `/tmp/da1426-*` and removes it. Nothing writes to the repo.
- The folder imports nothing from the first draft, so it runs at the base, where that draft's files aren't. Its `common.mjs` repeats that draft's plant, with the additions above.

## Where these tests and the first draft disagree

The new criteria change what the first draft's plant must do. I edit no existing file, so these are for a redraft of the first draft:

- **Removal condition.** The first draft's plant writes a five-column table with no removal condition. A `check` that meets `#1426.a17e5e56` fails every row of that plant, so the first draft's judges that want its plant to pass (`judgeClean` and every case built on it) fail a correct script. That draft's `carriedRows` also reads only exactly five columns.
- **unicode-17.0.0.** The first draft ignores a tree with no `Cargo.toml`, and its plant holds `vendor/unicode-17.0.0/README.md` with no stub release for it. With every tree covered, a `check` that pins unicode-17.0.0 by a release it can't find there reads `BLOCKED` or `INCONCLUSIVE` on that plant (the first draft's own rule for a missing release). A `check` that pins it by its README's SHA-256 list passes it.
- **A row's test.** The first draft passes a test whose file holds the name as text. Here that is a wrong program (`check-text-match`): the name must be in the suite's own list.
- **The clean merge.** The first draft's clean merge wants the pin moved and its plant's row tests are empty. That still holds here, since those tests pass.

## Assumptions a redraft may revisit

- **The column's name and place.** `Removal`, after `Budget`. A different header fails these plants.
- **A Rust test's name** is the name `cargo test -- --list` prints, module path included. A script that also accepts the bare function name still passes these tests.
- **Nested node tests** aren't planted, so how a subtest's name joins its parent's is open.
- **"Names that test"** is read as a line holding the test's name and a word saying it failed, not a fixed line shape, since the first draft pins none for `merge`'s test runs.
- **The exit code** of a merge whose test fails is read as non-zero, since a pin left for a failing test isn't a pass (invariant 2).
- **The real-tree checks** here are light: they read the table and the test files' text, with no network and no build. They don't run the suites' lists on the real tree, since the Rust rows' tests would build gpui. Whether every changed file in the real quickjs-jit-runtime and unicode-17.0.0 trees has a row is the first draft's `tree.test.mjs` question (AC1), which needs its count to take in unicode-17.0.0 now.
