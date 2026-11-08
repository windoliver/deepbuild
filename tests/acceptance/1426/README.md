# Acceptance tests for #1426: the gpui patches are ours to carry

These tests cover #1426's ten criteria and the Scope lines they rest on: the carried-patch table, the mark on every hunk, the hunk and file budgets, the guarded budget number, `scripts/vendor-rebase.mjs merge | check | diff`, and the rebase trial's record.

They were written blind from issue #1426 (its text of November 6, 2026: Scope, the ten criteria, Proof, Depends on), `docs/technical-design.md` (the Dogfooding bullet, Decisions and Decided, and "The app's toolkit" row, which holds the line on patches), `docs/canvas-primitives.md` (GPU surface) and the base commit `c12a65bb`, where nothing of #1426 is implemented. From the base I read `AGENTS.md`, `scripts/proof-change.mjs` (`criterionId`, tags, `readChange`, `readApprovals`), `scripts/proof-guard.mjs`, `scripts/proof.mjs`, `scripts/lanes.mjs` (the `lint` lane, `runLanes`), `scripts/repo-rules.mjs`, `vendor/` (gpui-pre, gpui-pre-apple with `upstream/README.md`, quickjs-jit-runtime, and `.cargo/config.toml`'s patches), and the conventions of `tests/acceptance/882`, `1113` and `1115`. I fetched the pinned releases and the release lists from crates.io and GitHub to check the issue's numbers and the fetch in `tree-judge.mjs`. No implementation of #1426 was read. Per AGENTS.md the implementing agent doesn't edit these files; a dispute goes to a blind redraft of this job.

## The surface (my choice where the issue names none)

### The script

- **Commands.** `node scripts/vendor-rebase.mjs check`, `node scripts/vendor-rebase.mjs diff`, `node scripts/vendor-rebase.mjs merge <crate> <version>`, where `<crate>` is a folder under `vendor/` and `<version>` the new release.
- **The tree it reads** is its working folder, as `scripts/proof.mjs` reads its own: there is no `--root`. A test runs the checkout's script with `cwd` set to a planted tree. A planted tree is a git repository with its base committed and its plants uncommitted, so a script may read the disk or ask git for tracked and untracked files. `merge` also runs in a folder that holds only `vendor/`, not a git repository.
- **A vendored crate** is a folder `vendor/<crate>` with a `Cargo.toml`. `vendor/unicode-17.0.0` has none and is ignored. Its pin is the `version` under `[package]` in that manifest. `vendor/gpui-pre-apple/upstream/` is ours and isn't compared.
- **The pinned release in a test.** The variable `DEEP_VENDOR_RELEASES=<dir>` names a folder holding `<crate>-<version>/`, laid out as an unpacked `.crate`. With it set, the script reads releases from there alone and touches no network. Without it the script reaches the real releases its own way: how is the implementer's call, and only `tree.test.mjs` runs that path.
- **A changed file** is one whose bytes differ from its release, or one the release lacks. A file only the release holds (upstream's examples, docs and tests) isn't a change.
- **A hunk** is a contiguous change with no context lines, as `git diff -U0` gives it. Its size is its lines, the mark's line included. Every plant is a pure addition, so whether a replacement counts its removed lines is the implementer's call. At the base both readings give the issue's 16.

### The mark

`DeepBuild patch (windoliver/deepbuild#<n>)`, as #711 wrote it, in a comment. A hunk is marked when a line of it holds the mark, or a mark sits at most one unchanged line from its first or last line. A new file is one hunk, so a mark anywhere in it covers it. A marked hunk belongs to the row that lists its file and names the mark's issue.

### The table and the budget number

`vendor/gpui-pre-apple/upstream/README.md` holds, under the heading `## Carried patches`, one Markdown table with exactly these columns:

```
| Behavior | Issue | Files | Test | Budget |
|---|---|---|---|---|
| The BGRA surface ... | #377 | `vendor/gpui-pre-apple/src/metal_renderer.rs`, `vendor/gpui-pre-apple/src/shaders.metal` | `tests/acceptance/377/handoff.test.ts › the test's name` | 4 over: why it can't split |
| The tinted mask sprite ... | #390 | `vendor/gpui-pre/src/window.rs` | `path › name` | — |
```

- **Behavior:** what it does, in words. Rows for the four behaviors AC2 names are found by `/sRGB/i`, `/exact gradient/i`, `/BGRA/i` and `/report/i`.
- **Issue:** `#<n>`.
- **Files:** repo-relative paths, each in backticks, comma-separated.
- **Test:** `` `<repo path> › <test name>` ``, the repo's own way of naming a test (`named` in `scripts/lanes.mjs`). `check` fails a row whose file is missing or doesn't contain the name. A test runs by its extension: `.test.mjs` under `node --test`, `.test.ts` under vitest, `.rs` by `cargo test --locked` in its crate.
- **Budget:** `—`, or `<N> over: <reason>`. The issue's rule is 8 lines a hunk and 40 added a file. N is how many breaches the row may hold: each hunk over 8 lines and each file over 40 added counts one. A row with a number and no reason fails. The number lives only in this cell, so the guard has one thing to guard. A new file counts against neither budget, since the issue moves additions there because a new file can't conflict.

### `check`

- **Exit.** 0 with no line starting `FAIL`, `BLOCKED`, `INCONCLUSIVE` or `INVALID`; otherwise non-zero (1 in the tests' plants).
- **Per row, printed whatever the outcome:** `ROW #<n> <Behavior>: <m> marked, <o> over budget`.
- **FAIL lines:**
  - `FAIL <path>: no row in the carried-patch table` (the words `no row` are pinned).
  - `FAIL <path>:<line>: a carried hunk with no mark`.
  - `FAIL <path>:<line>: hunk of <size> lines, over the budget of 8`, for a row with no raised number. `<line>` is the hunk's first line in the vendored file, and `<size> lines` is pinned.
  - `FAIL <path>: <added> added, over the budget of 40 a file`.
  - `FAIL row #<n> <Behavior>: <m> hunks over budget, the row allows <N>`; the tests want the Behavior and both numbers.
  - `FAIL row #<n> <Behavior>: ...` for no marked hunks, no test, a test that isn't there, or no reason; `FAIL row <Behavior>: ...` for no issue. The tests want the Behavior.
- **A pinned release it can't read** is `BLOCKED <crate> ...` or `INCONCLUSIVE <crate> ...`, naming the crate, and never exit 0.
- **The lane.** The lane named `lint` in `checks` has a command whose last two arguments are `scripts/vendor-rebase.mjs check`, and no `paths` that skip `vendor/`. A test runs that command, with the script's path made absolute, through `runLanes` in a planted tree, so a first failure reads `FAIL lint: ...`.

### `merge` and `diff`

- `merge <crate> <version>` three-way merges each file of `vendor/<crate>`, from the release at its pin to the release at `<version>`, onto our tree, and touches no other crate. The manifest takes the new `version`, which moves the pin. A file we carry nothing in takes the new release, and a file the release adds is added.
- A conflict stays in the file between lines starting `<<<<<<<`, `=======` and `>>>>>>>`, and prints `CONFLICT <path>:<line>`, `<line>` being the `<<<<<<<` line. Nothing else prints `CONFLICT`. Exit 1 with a conflict, 0 without.
- `diff` prints a unified diff of each changed file against its release, with no file that doesn't differ, and exits 0.

### The guard

`scripts/proof-guard.mjs`, reached as `node scripts/proof.mjs guard` in a scratch repository whose main holds the table. A commit that changes a row's number, up or down, with no approval prints `FAIL guard: ...` naming `vendor/gpui-pre-apple/upstream/README.md` and exits non-zero. The number's change passes as its own proposal: a commit touching only that file, with the repo's signed tag under `deep/approved/` carrying `Approves: vendor/gpui-pre-apple/upstream/README.md`. A stranger's signature doesn't pass. An edit of the file outside the table isn't refused. Whether other cells of the table are guarded is the implementer's call, since the issue says "the guarded table".

### The rebase record

The same README, under the heading `## Rebase trial`:

```
## Rebase trial

Tried: gpui-pre 0.3.9 -> 0.3.11, gpui-kit 0.8.0 -> 0.9.0
Outcome: pin left

| Suite | Result |
|---|---|
| #377 | not run |
| #390 | not run |
| #391 | not run |
| #140 | not run |
| #358 | not run |

CONFLICT vendor/gpui-pre-apple/src/metal_renderer.rs:120
```

- `Tried:` names each from-version and to-version, with `->` or `→`.
- `Outcome:` is `pin moved` or `pin left`.
- Each of the five suites has a row: `pass`, `fail: <what failed>`, or `not run`, which only a conflict excuses.
- Each conflict is a `CONFLICT` line, as `merge` printed it, in a code block or not.

## How to run

From the repo root, on Node 24:

```sh
node --test tests/acceptance/1426/lint.test.mjs     # AC1, 4, 6, 7, 8, 9, 10; fast, no network, no build
node --test tests/acceptance/1426/merge.test.mjs    # AC5; fast, no network, no build
node --test tests/acceptance/1426/guard.test.mjs    # AC9; needs node_modules (typescript) and ssh-keygen
node --test tests/acceptance/1426/tree.test.mjs     # AC1, 6, 10 on the real tree; needs the network
node --test tests/acceptance/1426/record.test.mjs   # AC3; a left pin needs the network, a moved pin as reverts below
node --test tests/acceptance/1426/reverts.test.mjs  # AC2; macOS with full Xcode, cargo, node_modules; hours when cold
node --test tests/acceptance/1426/wrong.test.mjs    # the judges against wrong programs; passes at the base
```

- The `.mjs` files sit outside the unit lane's patterns, as #882's do; the proof lanes run them as tagged tests.
- **What each heavy test needs.** Where a thing is missing the test fails with `INCONCLUSIVE`, naming it. It never passes.
  - `tree.test.mjs`: `curl` to `static.crates.io` and `codeload.github.com`; `check` reaching its releases.
  - `reverts.test.mjs`: macOS, `xcrun --find metal` (gpui-pre-apple's `build.rs` compiles its shaders with it, and Command Line Tools don't hold it), cargo, `node_modules`.
  - `record.test.mjs`: the same as `tree.test.mjs` for `pin left`; the same as `reverts.test.mjs` for `pin moved`, since it runs the five suites itself.
- `reverts.test.mjs` copies the tree to `/tmp/da1426-copy-*` and builds there with `cargo --locked`, so its target folder is its own and no sibling build can swap a binary. A Rust test binary is copied out of that target before it runs.
- Every test copies what it plants under `/tmp/da1426-*` and removes it. A lane run gets a temporary `HOME`, so its evidence record stays out of `~/.deepbuild`. Nothing writes to the repo.

## Criteria, tests and wrong programs

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, white space collapsed (`scripts/proof-change.mjs`, `criterionId`). `wrong.test.mjs` also runs every judge of `check`, `merge` and `diff` on a script that prints nothing, one that refuses everything and a missing one, and each judge fails all three.

| ID | Criterion | Tests | Wrong programs it must fail on |
|---|---|---|---|
| `#1426.4ef6dcfa` | AC1: Every vendored file that differs from its pinned release has a row, and every row names an issue and a test. A planted changed file with no row, and a planted row with no test, each fail the lint lane, naming it | `lint.test.mjs`: a changed file with no row in each of the three crates, nested and under `gpui-pre-apple/vendor`, and a new file, each fail naming it; a row with an empty or dash Test cell, a test whose file is gone or doesn't hold the name, and an empty Issue cell each fail naming the row; no pinned release is BLOCKED or INCONCLUSIVE; through `runLanes` both plants fail as `FAIL lint:`. `tree.test.mjs`: on the real tree, by a count of its own against the real releases, each differing file has a row, each row an issue and a test that's there, and the four named rows exist | `check-no-row-rule`, `check-one-tree`, `check-top-level`, `check-unnamed`, `check-fresh-no-row`, `check-no-test-rule`, `check-any-test-word`, `check-no-issue-rule`, `check-missing-passes`; lanes `lanes-none`, `lanes-other-lane`, `lanes-paths`, `lanes-diff`, `lanes-never-fails`; the table judge on a plant |
| `#1426.eb2029f7` | AC2: Each row's test fails with that row's change reverted, for the sRGB layer tag, the exact gradient mode, the BGRA surface and the surface reports | `reverts.test.mjs`: on a private copy, each row's test passes, then fails with `REVERTS`' edit applied: the layer's colorspace set to none; the exact gradient branches folded into Oklab's; the BGRA branch off, so the base's 4:2:0 assert stands; the `sampled_surfaces` push gone. A build that can't run, or an edit that matches none of the row's files, is INCONCLUSIVE | On a plant: a row test that reads nothing, one that fails with the change in place, a name that runs nothing, a revert that matches nothing, no table, no row. The runner read on a real Rust test and a real vitest test: pass, fail, nothing run |
| `#1426.f319fe8d` | AC3: The rebase trial's record names the versions tried and ends in one of two ways: the pin moved with the suites for #377, #390, #391, #140 and #358 passing, or every conflicting hunk and failing suite listed. A trial with no record leaves this issue open | `record.test.mjs`: the record's words, then the tree: a moved pin must be in the manifests and `Cargo.lock`, and the five suites run here; a left pin must leave the pins, and its conflicts must match, file by file, a fresh `merge` of the real releases on a copy of `vendor/` | No record, no versions, an old release, a third ending, a moved pin with a failing suite, one the tree doesn't hold, a missing suite, a left pin listing nothing, one the tree moved, a suite not run with no conflict, a record missing a conflict a fresh merge finds or holding one it doesn't, a suite that fails behind a record's `pass` |
| `#1426.08aec3b4` | AC4: A planted unmarked hunk in a file that already has a row fails, naming file and line. The current rule passes it | `lint.test.mjs`: the plant fails naming `<path>:<line>`; a mark in the hunk, or one unchanged line from it, passes | `check-no-mark-rule` (the current rule), `check-mark-anywhere`, `check-no-line` |
| `#1426.5f9ac1c5` | AC5: `merge` onto a stub new release keeps a clean carried hunk and leaves a conflicting one marked, listing it | `merge.test.mjs`: the clean hunk stays, outside any markers; the new release's far change lands; the conflicting hunk sits between markers with both sides; it alone is listed, at its `<<<<<<<` line; exit 1; a merge with no conflict exits 0, moves the pin and passes `check` on the new release. Scope: `diff` shows a carried line and no unchanged file | `merge-theirs`, `merge-ours`, `merge-silent`, `merge-no-list`, `merge-lists-every`, `merge-no-line`, `diff-silent` |
| `#1426.8e0bb54e` | AC6: The count of marked hunks per row is printed, and a row with none fails | `lint.test.mjs`: each row prints its count; a new marked hunk moves it; a row with none prints 0 and fails naming it. `tree.test.mjs`: on the real tree each row prints a count above 0 | `check-no-counts`, `check-one-marked`, `check-empty-row-passes` |
| `#1426.0c3a7dfa` | AC7: A planted marked 9-line hunk in a file with a row fails, naming file, line and size. The mark rule alone passes it | `lint.test.mjs`: 9 lines fail naming `<path>:<line>` and `9 lines`; 8 pass. Scope: a file passes at 40 added and fails at 41, naming it and the count | `check-no-budget` (the mark rule alone), `check-budget-nine`, `check-budget-seven`, `check-mark-not-counted`, `check-no-size`, `check-no-file-budget` |
| `#1426.fde8001d` | AC8: Moving a pure addition to a new file with a one-line `mod` passes, with a row for the new file | `lint.test.mjs`: a 60-line addition fails in place, passes as a new file with one marked `mod` line and a row, and fails with no row for the new file | `check-budgets-fresh`, `check-fresh-no-row` |
| `#1426.f66ec7fc` | AC9: A row that raises a budget gives its reason, and an unsigned change to that number is refused by the proof guard | `lint.test.mjs`: `1 over` and `1 over:` fail naming the row. `guard.test.mjs`: an unsigned raise and an unsigned lowering are refused; the maintainer's signed proposal passes; a stranger's doesn't; prose outside the table needs no signature | `check-no-reason-rule`; `guard-none`, `guard-raise-only`, `guard-whole-file`, `guard-never-signed`, `guard-any-signature`. Control: `guard-control` |
| `#1426.4e893008` | AC10: The lint prints hunks over budget per row, and a change that raises the count fails | `lint.test.mjs`: each row prints its count; a second hunk over budget in a row whose number is 1 fails, naming the row, 2 and 1; the row's number at 2 passes. `tree.test.mjs`: on the real tree no row prints a count past its number | `check-no-ratchet`, `check-total-only`, `check-no-over-count` |

The refusal (link, date, the word, the old "open" gone) and the design's line are Scope lines, tested in `tree.test.mjs` under AC1's tag, as #882 tags its Scope tests. `wrong/rebase-base.mjs` is a small reference of the surface above, reading only stub releases; each `check-*`, `merge-*` and `diff-*` twin is one fault of it, and `check-control` is it with none. `wrong/guard-base.mjs` reads the change and the approvals through the real `scripts/proof-change.mjs`.

## What the base commit has

At `c12a65bb` every tagged test fails for a missing surface: no `scripts/vendor-rebase.mjs` and no lane runs one; the real guard passes an unsigned change to the number; the README has no table, no record and calls the pull request open; the design's toolkit row says "the only patch". `wrong.test.mjs` passes, 90 of 90. `BASE-FAILURE.txt` holds the run. On that machine, with Command Line Tools only, `reverts.test.mjs` would fail with `INCONCLUSIVE: no Metal compiler ...` once a table exists.

## Assumptions a redraft may revisit

- **The issue's numbers leave out manifests.** The pinned releases give 46 hunks in 11 files, with `Cargo.toml` and quickjs: 42 hunks and 16 over 8 lines once the two gpui manifests' 4 hunks are out, as the issue counts. AC1 says "every vendored file", so the tests want rows for the manifests and quickjs's two files too. `vendor/gpui-pre-apple/vendor/gpui/src/color.rs` repeats `vendor/gpui-pre/src/color.rs`'s change and needs a row of its own.
- **One number a row.** The issue gives two budgets and one "number". I count both kinds of breach in one N. How a file over 40 added, listed in several rows, splits between them is the implementer's call: only rows of one file are planted.
- **A file listed in two rows with one issue.** The BGRA surface and the reports may share #377 and their files. How their hunks split is the implementer's call; the real-tree test wants each row's count above 0.
- **"Can only fall."** A row's count above its number fails. A count below its number isn't tested either way: such a row can rise back to its number, which a stricter lint might refuse, and lowering the number takes a signature.
- **An unsigned lowering is refused.** The criterion says "change", so the test refuses both directions, though the Scope lets the count fall.
- **A mark's form.** The base also has `DeepBuild patch (#358)` and `DeepBuild patch:`. Plants use only #711's form. Whether `check` accepts the others on the real tree is the implementer's call; row attribution needs an issue in the mark.
- **"Next to"** is pinned at one unchanged line. A plain neighbour can't exist, since upstream's lines hold no mark.
- **The sRGB revert** sets the colorspace to none rather than removing the call. The code's own comment says GPUI alone leaves the layer to AppKit, which gives sRGB on macOS 26, so a literal revert may not change the pixels on a current Mac. None is what the base's planted twin does.
- **The reverts are edits of text.** They keep the tree compiling so a test fails on behavior. If the implementer moves the code past the patterns, the test reads INCONCLUSIVE, and a redraft updates the pattern.
- **`vendor/quickjs-jit-runtime/LICENSE`** isn't in the crate's folder upstream. My count exempts a vendored license file; the script may exempt it or give it a row.
- **gpui-kit's pin** is a git rev, and the record names versions, so a moved pin is read from `Cargo.lock`'s `gpui-kit` entry.
- **"Newest"** is read as at least the issue's 0.3.11 and 0.9.0, the newest on crates.io today, so a later trial still passes.
- **"Every failing suite"** can't be proven for a left pin without building the failed merge. The test wants each suite's line and re-finds the conflicts; a `fail:` line's words aren't checked.
