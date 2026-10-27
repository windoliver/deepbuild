# Blind redraft of #371's AC8 acceptance test

A fresh run of #371's acceptance-test job, redrafting one disputed test file, `deprecated.test.ts`, as
`deprecated-redraft.test.ts` (AGENTS.md, Proof; technical design, Dogfooding: Who drafts it, Disputes). It saw no
implementation.

## What was read

- Issue #371 (`gh issue view 371 --repo windoliver/deepbuild`): the Document envelope's `requires` line
  (`modules: {canvas module → semver range}`) and AC8.
- At base `14561af` ("Merge pull request #755 … claude/issue-349-close"), from this job's own worktree:
  AGENTS.md; `docs/technical-design.md`, Document (1099: "A document declares the canvas modules its kinds need;
  one whose canvas module this build lacks is refused with `module_missing`"); `docs/canvas-primitives.md`,
  Document envelope (306: `requires`) and Item and kind (349: "A kind with `deprecated_since` still loads, with a
  `deprecated` notice naming its `replaced_by`"); `crates/deep-canvas/src/document/check.rs` (`check_by`,
  `required_minors`, `check_item`); `crates/deep-canvas/src/registry/mod.rs` (`module_of_kind`,
  `missing_for_kind`); `crates/deep-show/Cargo.toml` (its `test-*` features); `tests/acceptance/305/`
  (`helpers.ts`'s `requires`, its tests' boards, `REDRAFT-388.md` for this file's form).
- From the first draft only these files, copied unchanged into `tests/acceptance/371/`: `README.md`,
  `helpers.ts`, `tsconfig.json`, `deprecated.test.ts`. Nothing else under that checkout was opened.

## The dispute and how it was resolved

The first draft's board holds a `test.old@1` item, a kind the test canvas module `test.deprecated` registers
(README, Test builds), but declares no `requires.modules`. At the base, `check_item` refuses an item whose kind
a canvas module in the build registered when `requires.modules` doesn't name that module: an error
`out_of_range` at `items/old/kind` ("kind `test.old@1` is the `test.deprecated` module's, and
`requires.modules` does not name it"), returned before the kind's entry, and so its `deprecated_since`, is read.
That is the design's rule ("A document declares the canvas modules its kinds need"), and #305's suite sends
`requires.modules` for each test module's kinds for the same reason. So the first draft's board is refused on
every program that follows the design, and both of its tests fail there for a reason AC8 doesn't name: the
right program can't pass the first test, and the planted program fails the second on its `presented` assert.

The redraft keeps the first draft's surface (feature `test-deprecated`, module `test.deprecated`, kinds
`test.old@1`/`test.new@1`, the `notices` reply field, the planted `loads_deprecated_silently`) and changes one
thing in the document: it declares the module, `requires: {modules: {"test.deprecated": "^1"}}`, with the
module at 1.0.0 as the dispute's brief fixes. The README needs no change for this; it never said the board
leaves the module out. `helpers.ts` is unchanged and imported; the one extra helper, `loadedFailures`, is in the
redraft's own file.

## The redrafted tests

Build: `deep-show` with `full,test-deprecated`. Document: a 200 × 120 board (`helpers.ts`'s `board`) with one
item `old` of kind `test.old@1`, `params.box [16, 16, 80, 40]`, and `requires.modules {"test.deprecated": "^1"}`.
Each test is one fresh process: alpha's `deep_show` of the board to a hub-minted doc on `main`, then
`revisions`.

1. **A document declaring test.deprecated and using test.old@1 loads and becomes current, its reply carrying a
   deprecated notice naming test.new@1.** Asserts:
   - `loadedFailures` is empty: the reply has no error-severity issue, and no issue or notice with code
     `unknown_kind` or `module_missing` names `old` (so a program that skips or refuses the item can't pass on
     a notice alone);
   - `deprecatedFailures` (helpers, unchanged) is empty: the outcome is `presented`, and `notices` holds a
     `deprecated` notice whose `ids` include `old` and whose `replaced_by` is `"test.new@1"`;
   - the current revision in `revisions` is the reply's `rev`.
2. **A planted check that loads the deprecated kind silently fails this test, naming the kind.** Same scenario
   with `planted: "loads_deprecated_silently"`. Asserts the outcome is still `presented` and `loadedFailures` is
   empty (the wrong program loads the item, as its README row says), and `failsNaming(deprecatedFailures(…),
   ["test.old@1"])`: at least one failure, and one naming `test.old@1`.

## Where this differs from the first draft

- The board declares `requires.modules: {"test.deprecated": "^1"}`; without it the base and the design refuse
  the item at `items/old/kind` before deprecation is read.
- Added `loadedFailures` to both tests. "Still loads" is read as the item being neither refused nor skipped,
  which `presented` alone doesn't show (an `unknown_kind` item is skipped with a notice and the document still
  presented). In test 2 it confirms the planted program fails only on the missing notice.

## Base run

Type-check: `npx tsc -p tests/acceptance/371/tsconfig.json` exits 0.

`npx vitest run --root tests/acceptance/371 deprecated-redraft --no-file-parallelism` at the base: 2 tests,
2 failed, both on the build, as expected; the base has no `test-deprecated` feature.

```
 ❯ deprecated-redraft.test.ts (2 tests | 2 failed) 829ms
     × AC8 a document declaring test.deprecated and using test.old@1 loads and becomes current, its reply carrying a deprecated notice naming test.new@1 7ms
     × AC8 a planted check that loads the deprecated kind silently fails this test, naming the kind 2ms

AssertionError: the binary builds: deep-show with features full,test-deprecated: expected 'cargo build --locked --bin deep-show …' to be '' // Object.is equality
+ cargo build --locked --bin deep-show --no-default-features --features full,test-deprecated failed:
+ error: none of the selected packages contains this feature: test-deprecated

 Test Files  1 failed (1)
      Tests  2 failed (2)
```

Not run: the tests against any build that has `test-deprecated`; none exists at the base. Vitest's cache in
`tests/acceptance/371/node_modules/.vite` was deleted after the run. Nothing was committed.
