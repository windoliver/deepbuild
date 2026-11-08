# Acceptance tests for #1426: the carried-patch table, redrafted

A blind redraft of the tests for eight of #1426's thirteen criteria: AC1, AC4, AC5, AC6, AC7, AC8, the lint half of AC9, and AC10. They agree with the issue as it stands after its November 8, 2026 edit: the table's six columns with a removal condition, test names resolved against each suite's own list, every tree under `vendor/` covered with `unicode-17.0.0` among them, and the clean-merge rule. Other folders cover AC2, AC3, the guard half of AC9 and the three added criteria (AC11 to AC13).

## What this job read

- Issue #1426 as `gh issue view 1426 -R windoliver/deepbuild` gave it during this job: its Scope and its 13 criteria.
- From the base commit `db917989` (main of November 7, 2026, where nothing of #1426 is implemented): `AGENTS.md`; the Dogfooding bullet of `docs/technical-design.md` and its toolkit line that says "the only patch"; `scripts/proof-change.mjs` (`criterionId`); `scripts/lanes.mjs` (the `lint` lane and `runLanes`); `vendor/` (all four trees, `gpui-pre-apple/upstream/README.md`, `unicode-17.0.0/README.md`, the manifests); `.cargo/config.toml`; `Cargo.lock`'s quickjs entry; and the conventions of `tests/acceptance/882`.
- From the first draft, only its `README.md` and `common.mjs`. From the added-criteria draft, all of it: `README.md`, `common.mjs`, its judges, tests, `wrong/` and `BASE-FAILURE.txt`.
- Online, the pinned releases: `gpui-pre` 0.3.9 and `gpui-pre-apple` 0.3.9 from crates.io, `longbridge/quickjs-jit` at `96593cd` from GitHub, and the three Unicode 17.0.0 files from unicode.org.
- Nothing that describes how #1426 was implemented reached me. The user's memory index was in this job's context; the part loaded holds no line on #1426, and I read no transcript or memory file.

Per AGENTS.md the implementing agent doesn't edit these files. A dispute goes to a blind redraft of this job.

## The surface

This folder keeps the surface the two earlier drafts fixed; where they differ, the added draft's wins. `common.mjs` is the added draft's plant byte for byte, apart from its header and its criterion IDs, so a script that passes one draft's plant passes the other's.

- **The script.** `node scripts/vendor-rebase.mjs check | diff | merge <tree> <version>`, run with its working folder at the checkout it reads. A planted checkout is a git repository with its base committed and each test's plant uncommitted.
- **Releases.** `DEEP_VENDOR_RELEASES=<dir>` holds each pinned release: `<folder>-<version>/` for a tree with a `Cargo.toml` (its `[package]` `version` is the pin), and `<folder>/` for a tree with none, such as `unicode-17.0.0`. With it set, the script reads releases from there alone. A release it can't read is a line starting `BLOCKED <tree>` or `INCONCLUSIVE <tree>`, and never exit 0.
- **What is compared.** Every folder under `vendor/`. `vendor/gpui-pre-apple/upstream/` is ours, and so is the `README.md` of a tree with no `Cargo.toml`. A changed file is one whose bytes differ from its release's, or one the release lacks.
- **A hunk** is a run of changed lines as `git diff -U0` gives it; its size is its lines, the mark's line included. A new file is one hunk.
- **The mark** is `DeepBuild patch (windoliver/deepbuild#<n>)`, #711's form, in a comment. A hunk is marked when one of its lines holds the mark or a mark sits at most one unchanged line from its first or last line. A marked hunk belongs to the row that lists its file and names the mark's issue.
- **The table** is in `vendor/gpui-pre-apple/upstream/README.md`, under `## Carried patches`, with the columns `| Behavior | Issue | Files | Test | Budget | Removal |`. Issue is `#<n>`. Files are repo paths in backticks. Test is `` `<repo path> › <test name>` ``, the name as the file's own runner lists it (`node --test`, `vitest list`, `cargo test -- --list`). Budget is `—`, or `<N> over: <reason>`. Removal is the upstream change that would retire the row, or `none: <reason>`.
- **Budgets.** 8 lines a hunk and 40 added lines a file. A new file counts against neither. A row's N is how many breaches its hunks and files may hold.
- **`check`** exits 0 with no line starting `FAIL`, `BLOCKED`, `INCONCLUSIVE` or `INVALID`, and non-zero otherwise. For each row it prints `ROW #<n> <Behavior>: <m> marked, <o> over budget`. Its failures, as these tests read them:
  - `FAIL <path>: no row ...` for a changed file no row lists;
  - `FAIL <path>:<line>: ...` for an unmarked hunk, `<line>` being the hunk's first line in our file;
  - `FAIL <path>:<line>: hunk of <size> lines, over the budget of 8` in a row that raises nothing;
  - a `FAIL` line naming the file and its count for a file over 40 added lines;
  - a `FAIL` line holding the row's Behavior for a row with no issue, no test, no marked hunk, no reason for its number, or more hunks over budget than its number, the last one with both numbers after the Behavior.
- **The lane.** The lane named `lint` in `scripts/lanes.mjs`'s `checks` runs `scripts/vendor-rebase.mjs check`, with no `paths` that skip `vendor/` or the README. Run through `runLanes`, a failure reads `FAIL lint: ...`.
- **`merge <tree> <version>`** merges three ways, from the release at the pin to the release at `<version>`, onto our tree, and touches no other tree. A conflict stays in the file between `<<<<<<<` and `>>>>>>>` with both sides, and prints `CONFLICT <path>:<line>`, `<line>` being the `<<<<<<<` line. It exits non-zero with a conflict. A merge with no conflict runs the rows' tests and moves the pin only when they pass (the added draft's rule, tested there).
- **`diff`** prints a unified diff of each changed file against its release, and exits 0.

## How each criterion is read

IDs are `scripts/proof-change.mjs`'s `criterionId` on the issue's exact text: the first 8 hex digits of SHA-256 of the text, trimmed, white space collapsed. "(scope)" marks a test of a Scope line the criterion rests on.

| ID | Criterion | Tests | Wrong programs it must fail on |
|---|---|---|---|
| `#1426.4ef6dcfa` | AC1: every vendored file that differs from its pinned release has a row, and every row names an issue and a test; a planted changed file with no row and a planted row with no test each fail the lint lane, naming it | `lint.test.mjs`: a changed file with no row fails, naming it, in each place one can sit (a nested gpui-pre file, gpui-pre-apple's own `vendor/gpui`, a new file, gpui-pre's `Cargo.toml`, quickjs-jit-runtime's `src/engine.rs`, unicode-17.0.0's `GraphemeBreakTest.txt`), and passes once listed; a row whose Test cell is empty or a dash, and one whose Issue cell is empty, fail naming the row; a missing release is BLOCKED or INCONCLUSIVE naming the tree; through `runLanes`, both plants fail as `FAIL lint:` naming the file or the row. `tree.test.mjs`, the real tree (below) | `check-no-row-rule`, `check-gpui-only`, `check-crates-only`, `check-top-level`, `check-changed-only`, `check-manifest-exempt`, `check-unnamed`, `check-no-test-rule`, `check-missing-passes`; lanes `lanes-none`, `lanes-paths`, `lanes-diff`, and the control lanes table with a check that never fails |
| `#1426.08aec3b4` | AC4: a planted unmarked hunk in a file that already has a row fails, naming file and line; the current rule passes it | `lint.test.mjs`: in `color.rs`, which has a row, an unmarked 2-line addition and an unmarked rewrite of an upstream line each fail naming `<path>:<line>`; a mark as the hunk's first line, as its last, and one unchanged line above it each pass | `check-no-mark-rule` (the current rule), `check-mark-anywhere`, `check-additions-only`, `check-no-line`, `check-mark-inside-only` |
| `#1426.5f9ac1c5` | AC5: `merge` onto a stub new release keeps a clean carried hunk and leaves a conflicting one marked, listing it | `merge.test.mjs`: stub gpui-pre 0.3.10 rewrites upstream line 50 and adds a line where our second hunk sits. The first hunk and its mark stay outside any markers, line 50's rewrite lands, the second hunk sits between markers with the release's line, exactly one `CONFLICT color.rs:<its <<<<<<< line>` is listed, the exit is non-zero, and no other tree changes. (scope) Without the conflicting line, the merge exits 0, moves the pin, keeps both hunks, and `check` passes the result. (scope) `diff` shows `+pub const PLANTED_STOP: u8 = 1;`, names each changed file and no unchanged one | `merge-theirs`, `merge-ours`, `merge-silent`, `merge-lists-every`, `merge-no-line`, `merge-exit-zero`, `merge-no-markers`, `diff-silent` |
| `#1426.8e0bb54e` | AC6: the count of marked hunks per row is printed, and a row with none fails | `lint.test.mjs`: the plant prints 2, 2 and 1; a third marked hunk in `color.rs` makes the gradient's 3; a row for `#9004`, which marks nothing, prints 0 and fails naming it | `check-no-counts`, `check-count-files`, `check-empty-row-passes` |
| `#1426.0c3a7dfa` | AC7: a planted marked 9-line hunk in a file with a row fails, naming file, line and size; the mark rule alone passes it | `lint.test.mjs`: a marked 9-line hunk in `color.rs` fails with a line naming `<path>:<line>` and `9 lines`; 8 lines pass. (scope) `color.rs` passes at 40 added lines in hunks of at most 8, and fails at 41, naming the file and 41 | `check-no-budget` (the mark rule alone), `check-budget-nine`, `check-budget-seven`, `check-mark-not-counted`, `check-no-size`, `check-no-file-budget` |
| `#1426.fde8001d` | AC8: moving a pure addition to a new file with a one-line `mod` passes, with a row for the new file | `lint.test.mjs`: a marked 60-line addition in `color.rs` fails; the same lines in a new `src/planted_stops.rs`, with `mod planted_stops; // DeepBuild patch (...)` as one line in `color.rs` and the new file in the gradient's row, pass; with no row for the new file, it fails naming it | `check-budgets-fresh`, `check-changed-only` |
| `#1426.f66ec7fc` | AC9, the lint half: a row that raises a budget gives its reason | `lint.test.mjs`: the surface's Budget as `1 over` and as `1 over:` each fail naming the row; `2 over: <reason>` passes | `check-no-reason-rule` |
| `#1426.4e893008` | AC10: the lint prints hunks over budget per row, and a change that raises the count fails | `lint.test.mjs`: the plant prints 0, 1 and 0 over budget; a second marked 9-line hunk in the surface's row, which allows 1, prints 2 and fails, naming the row, 2 and 1, and still fails with the gradient's row given a spare 1; with the surface's row at `2 over: <reason>`, it passes | `check-no-ratchet`, `check-total-only`, `check-no-over-count` |

### The real-tree test (AC1's tag)

`tree.test.mjs` runs `judgeRealTree` in `tree-judge.mjs` on the checkout. It checks:

- **Words, with no network.** The README has a paragraph holding zed-industries/zed#66114's link, the word closed (or refused, declined, rejected) and the date, October 28, 2026. It no longer says "The pull request is open". The design no longer says "the only patch", and it names the README's path or "carried-patch table".
- **The table.** The six columns. Each row has an issue and a removal condition. Each row names a test its suite's own list holds:
  - a `.test.mjs` file is loaded with `list-node.mjs`, which stands a recorder in for `node:test`, so the file lists its top-level tests and runs none;
  - a vitest file goes through `vitest list <file> --json`;
  - a Rust file's list is read from its source: each `#[test]` or `#[<path>::test]` function, with its module path from the crate's root (its `[lib] path`) and its inline `mod` blocks. Each shorter tail of that path is accepted too, so `metal_renderer::tests::x` and `tests::x` both resolve. Cargo isn't run, since gpui-pre-apple's list would build gpui.
- **The releases.** The test fetches each pinned release:
  - a crate from crates.io at its manifest's version, or, when its manifest pins a GitHub repository at a `rev` (quickjs-jit-runtime does), from that repository at that rev, taking the folder whose manifest names the crate and the repository's top-level files that folder lacks, such as `LICENSE`;
  - a tree with no `Cargo.toml` from the URLs its README lists.
  A fetch that fails is `INCONCLUSIVE`, naming the tree, and the test fails.
- **Each differing file has a row.**
- **Marks and budgets, by this judge's own count.** Each row has a marked hunk above 0 in its files. Hunks over budget are within the numbers. This count takes the lowest reading of the issue, so a script that counts more gets no false failure:
  - a hunk's size is its added lines;
  - manifests are left out of the budgets;
  - the base's shorter mark `DeepBuild patch (#n)` counts as a mark;
  - rows that share an issue pool their numbers, since how two rows on one issue split a hunk is the implementer's call;
  - every hunk and file over budget, marked or not, counts against the sum of all rows' numbers.

`wrong/reference.mjs` is a small reference of the surface, reading only stub releases and listing only `node --test` suites. Each `check-*`, `merge-*` and `diff-*` twin is one fault of it, and `wrong/control.mjs` is it with none. `wrong.test.mjs` runs:

- every judge on the control and on its twins;
- every judge of `check`, `merge` and `diff` on a script that prints nothing, one that refuses everything and a missing one, failing all three;
- the lane judge on four lanes tables;
- the real-tree judge on a complete planted tree, which passes, and on fifteen faults planted in it, each of which fails. Its fetch isn't self-tested, since that needs the network. This job ran it once by hand at the base (BASE-FAILURE.txt).

## How to run

From the repo root, on Node 24, after `npm ci`:

```sh
node --test tests/acceptance/1426/redraft-table/lint.test.mjs    # AC1, 4, 6, 7, 8, 9 (lint), 10; about 15 s
node --test tests/acceptance/1426/redraft-table/merge.test.mjs   # AC5; about 1 s
node --test tests/acceptance/1426/redraft-table/tree.test.mjs    # AC1 on the real tree; needs the network
node --test tests/acceptance/1426/redraft-table/wrong.test.mjs   # the judges against wrong programs; passes at the base; about 50 s
```

- No test builds gpui or needs Metal. Plants are small and stubbed through `DEEP_VENDOR_RELEASES`, and each is planted under `/tmp/da1426-*` and removed. Nothing writes to the repo.
- `tree.test.mjs` needs:
  - `curl` reaching `static.crates.io`, `codeload.github.com` and `www.unicode.org`. In a sandboxed session, run it with the sandbox off.
  - For a row naming a vitest file, the workspaces built (`npm run build --workspaces`); otherwise `vitest list` can't load `vitest.config.ts` and the row reads `INCONCLUSIVE`.
  - For a row naming a node file, that file's top level must load. Its tests don't run.
- The lane test runs `scripts/lanes.mjs`'s `runLanes` in the plant with a temporary `HOME`, so its evidence record stays out of `~/.deepbuild`.
- The `.mjs` files sit outside the unit lane's patterns, as #882's do. The proof lanes run them as tagged tests.

## Assumptions a redraft may revisit

- **A row with no issue.** With the surface's attribution (a marked hunk belongs to the row naming the mark's issue), a row with no issue also has no marked hunk, so AC6's rule fails it too. No wrong program here passes it, and the judge asks only for a `FAIL` line naming the row.
- **The manifest needs a row.** AC1 says "every vendored file", so a changed `Cargo.toml` with no row fails, as in the first draft. Budgets on the real tree leave manifests out, the lower count.
- **"Next to"** is at most one unchanged line between the mark and the hunk, as the first draft pinned. The plant puts a hunk's mark as its last line and an unmarked line one unchanged line below.
- **The rewritten line.** AC4's second plant replaces an upstream line in place. `<line>` is that line's number in our file under either reading of a replacement's size.
- **"9 lines".** AC7's failure line must hold `9 lines`, the first draft's pinned phrase for the size.
- **"A change that raises the count fails"** is read row by row: another row's spare number doesn't cover it. A count below its number isn't tested.
- **A new file and the budgets.** A new file is held to neither the hunk nor the file budget, as the first draft pinned and as the Scope's reason ("a new file can't conflict") suggests.
- **The merge's conflict and the pin.** AC5 doesn't say where a conflicting merge leaves the pin, so no test reads it.
- **The design's line.** "Corrected" is read as "the only patch" gone, and the design pointing at the table, by the README's path or the words "carried-patch table". Wording that names the patches in another way fails the second half.
- **The refusal paragraph** needs the link, a word for the refusal and the date in one paragraph. The date is accepted as `2026-10-28`, `October 28, 2026` or `28 October 2026`.
- **quickjs-jit-runtime's release** is the `jit/` folder of `longbridge/quickjs-jit` at the rev its manifest names, with the repository's top-level `LICENSE`. At the base the vendored `LICENSE` equals it, and the vendored `Cargo.toml` differs, so that manifest needs a row.
