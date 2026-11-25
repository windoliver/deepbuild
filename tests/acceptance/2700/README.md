# Acceptance tests for #2700: a one-item patch stops paying for the document's other members

Written before the work by a job that saw only the issue, the design and the base commit `83b82f94a`. It designed no
implementation and saw none. Never edit a file here; a dispute goes to this job's blind redraft.

## What was read

- Issue #2700 (body only; it has no comments) and `AGENTS.md`.
- Design: `docs/canvas-primitives.md` (Dirty classes, The cost model) and `docs/technical-design.md` (Numbers version 0
  has to hold, Dogfooding).
- Base sources, for the surfaces the issue names: `crates/deep-canvas/src/document/{check,apply,mod,tests}.rs`,
  `crates/deep-canvas/src/schedule/mod.rs` (`revise_items`), `crates/deep-canvas/src/registry/`, and the two callers of
  the recheck in `crates/deep-show/src/` (`kit/engine.rs`, `shared/calls.rs`).
- How proofs run: `scripts/{proof-runs,proof-change,benchmark,lanes}.mjs`, `benchmarks/budgets.json`, and the READMEs
  and helpers of `tests/acceptance/896/` and `tests/acceptance/2651/`.

## Files

| File | Criterion | Runs |
| --- | --- | --- |
| `heap.test.mjs` | `#2700.9725b660` | fast |
| `equal.test.mjs` | `#2700.ce79405c` | fast (about 5 s after the build) |
| `data-row.test.mjs` | `#2700.65df5186` | fast |
| `as-given.test.mjs` | `#2700.934bb9b3` | fast |
| `budgets.long.test.mjs` | `#2700.db66efb8` | by hand, hours, needs `DEEP_2700_BASE` |
| `lib.mjs` | builds and runs the probe | |
| `probe/` | the Rust program that calls the canvas core | |
| `twins.json` | the planted wrong programs each criterion names | |
| `BASE-FAILURE.txt` | the fast files' real output on the base | |

Run: `node --test tests/acceptance/2700/<file>` from the checkout root, Node 24, cargo on `PATH`. The first run builds
the probe (release, the canvas core and its dependencies) into `target/acceptance-2700`.

## The surface

The probe (`probe/src/main.rs`) reaches the canvas core only through its public entry:
`deep_canvas::document::{apply_ops, check_in, recheck, recheck_with, Referrers, Packs}` and `deep_canvas::registry`.
Every recheck call passes the document as `&mut doc`, which compiles against the base (`&Value`) and against a change
that follows the issue's Scope (`&mut Value`). Both `recheck` and `recheck_with` are exercised in every test. If the
change gives either function other parameters, or renames one, the probe no longer builds and every test here fails as
`BLOCKED`: that is a dispute for the blind redraft, not an edit.

`lib.mjs` lays a copy of `probe/` at `target/acceptance-2700/probe` and builds the copy, so cargo's notes of the
checkout's unused `[patch]` entries land in the copy's lockfile and never rewrite `probe/Cargo.lock`.

The probe seals the core with one test module, `acc2700`: a kind `acc2700.pic@1` (params `box`, `asset`, `row`, `fuse`,
`gain`) and a rule that raises `ref_unresolved` at `items/<id>/params/asset` when `asset` names no entry of `assets`,
raises `ref_unresolved` at `items/<id>/params/row` when `data[row]` is no number, and panics when `fuse` is `"blow"`.
It is how an item's issues come to depend on an asset or a data row, and how a check panics, without any core kind
doing so at the base.

## Criteria, what the base does, and how each test can fail

### `#2700.9725b660` heap

> A one-item patch on a document that holds 4 MiB of `data` allocates under 256 KB more heap than the same patch on
> that document with no `data` (drafted). On the merge base it allocates at least 8 MiB more, and the test fails,
> naming the bytes

Test: `#2700.9725b660 a one-item patch allocates under 256 KB more heap on a document holding 4 MiB of data than on the
same document with none`. A document of 100 `test.slab@3` items; the patch is one `set` of `items/s007/params/width`.
The probe counts every byte asked of the allocator (alloc, zeroed alloc, growth by realloc) across `apply_ops`,
`Patched::changed` and the recheck, once with `data.blob` = 64 strings of 65,536 bytes and once with no `data` member.
It asserts the difference is under 256,000 bytes, for `recheck` and for `recheck_with`.

Base: fails at that assertion. `recheck`: 8,416,903 bytes with the data, 18,247 without, 8,398,656 more (at least
8 MiB: the data is copied twice). The message names the bytes. No twin: the merge base is the wrong program.

### `#2700.ce79405c` 10,000 generated patches

> For 10,000 generated patches on generated documents, the recheck's issues equal the whole check's, patches to an item
> whose params name an asset or a data row among them. A planted recheck that leaves out an item whose asset the patch
> changed fails, naming the item

Test: `#2700.ce79405c for 10,000 generated patches on generated documents the recheck's issues equal the whole
check's`. Recorded seeds `2700, 896, 854, 499`, 2,500 applied patches each, from a SplitMix64 generator in the probe
(no clock, no OS randomness). Documents hold 8 to 24 items (slabs and pics, with parents), six assets and six data
rows; ops set an asset, a row, a gain, a width or a name, unset, move, delete and create. After each applied patch the
issues of `recheck` and of `recheck_with` (previous issues, `Patched::changed`) are compared with `check_in`'s, as
sets of (code, ids, path). The test first asserts the run was the one the criterion names: 10,000 applied patches, at
least 100 documents, at least 5,000 patches to an item naming an asset, 5,000 to one naming a data row, 2,000 that
change an item's asset, 5,000 revisions with issues. Then it asserts no mismatch; the message names the item, the
seed, the document, the patch and its ops.

Base: passes (10,000 patches, 101 documents, 7,546 / 6,837 / 3,153 / 9,981, 0 mismatches).
Fails on twin `asset-left-out`.

### `#2700.65df5186` a data row's patch

> A patch that changes a row of `data` takes the whole check and reports what it reports today. A planted recheck that
> treats it as an item patch fails, naming the row

Test: `#2700.65df5186 a patch that changes a row of data reports what the whole check reports`. One pic item `meter`
reads row `goal`. The row changes from `7` to `["seven"]` and back; `changed` is `{"goal"}`. What a caller reports is
the recheck's answer, or the whole check's when the recheck answers nothing. The test asserts that equals the whole
check's issues both ways (the message names the row `data/goal`), and that the document is as given.

Base: passes. Fails on twin `row-as-item`.

### `#2700.db66efb8` budgets and the two suites

> `canvas-patch-settled` and `canvas-patch-dirty` in `benchmarks/budgets.json` retire no more instructions than on the
> merge base, and `tests/acceptance/896/` and `tests/acceptance/854/` pass unchanged

`budgets.long.test.mjs`, four top-level tests, by hand:
`#2700.db66efb8 canvas-patch-settled retires no more instructions than on the merge base`, the same for
`canvas-patch-dirty`, `#2700.db66efb8 tests/acceptance/896/ passes unchanged` and the same for `854/`.
The two tasks are measured on both checkouts by `scripts/benchmark.mjs` (`measure`, `judgeInstructions`), with the
merge base's own task definition; only its `PASS` passes. A suite passes when every file of its folder is the merge
base's byte for byte and its own vitest run has no failure, exit 0, at least one test passed and none skipped.

Never a pass by absence: no `DEEP_2700_BASE`, a checkout without `node_modules`, a task missing from the base's
budgets or a measurement that could not run on both sides is `BLOCKED`; a judgement other than `PASS`/`FAIL`, a
skipped test in 896 or 854 (they judge timings on a reference Mac only) or a suite in which nothing ran is
`INCONCLUSIVE`. All of these fail the test.

Not run by this job (hours; forbidden for the base run). No wrong program is named: the criterion compares the change
with the merge base, which passes against itself. The implementer lists the file in `byHand` and `timed` of
`scripts/lanes.mjs` (a signed change), as `tests/acceptance/2650/budgets.long.test.ts` is.

### `#2700.934bb9b3` the document as given

> After a recheck that returns issues, one that returns nothing because the patch needs the whole check, and one that
> panics inside a check, the document equals the document as given, byte for byte once serialized. A planted recheck
> that does not put the items back fails, naming the first item missing

Test: `#2700.934bb9b3 after a recheck that returns issues, one that returns nothing and one that panics inside a
check, the document is the document as given, byte for byte`. Twelve items in an order that is not sorted, with `data`
and `assets`. Three cases, each on `recheck` and `recheck_with`: a `set` that leaves an issue (returns issues); the
same with an entry in `collections` (returns nothing); a pic whose `fuse` is `"blow"` (the rule panics; the probe
catches the unwind). The document is serialized before and after. The test asserts each case took its path (issues /
nothing / panic) and the two texts are equal; the message names the first item missing, else the first out of place,
else the first byte that differs.

Base: passes (the base never touches the document). Fails on twin `unrestored`.

## Planted wrong programs

A twin is replacement source laid over the finished change, which this job cannot see, so the three twins are left to
the implementer. `twins.json` already names them, so the before lane refuses each test until its twin exists at
`tests/acceptance/2700/twins/<name>/crates/deep-canvas/src/document/check.rs` (the change's file with one behavior
changed, nothing else).

| Twin | Exact behavior | Test that fails, and what it names |
| --- | --- | --- |
| `asset-left-out` | The recheck leaves out of the items it checks again any changed item whose `params.asset` the patch changed; that item keeps its previous issues. Otherwise the change. | `equal.test.mjs`, at the mismatch assertion, naming the item |
| `row-as-item` | The recheck treats a patch whose `changed` names a row of `data` as an item patch: it checks again only the changed IDs that are items and carries every other item's issues, answering instead of leaving the patch to the whole check. | `data-row.test.mjs`, naming the row `data/goal` |
| `unrestored` | The recheck does not put the items back: on return (result, nothing or panic) the document holds only the items the patch reached. | `as-given.test.mjs`, naming the first item missing |

Each was tried in this job's scratch folder as an edit of the base's `check.rs` (signatures moved to `&mut`): each test
failed at its assertion on its twin and named what the criterion asks (`asset-left-out`: the item; `row-as-item`:
`data/goal` and `meter`; `unrestored`: "the item `zeta` is missing"). Those scratch edits are not twins and are not
kept.

## Measured tests

- `heap.test.mjs` counts bytes asked of the allocator, not time: load does not move it. A probe that cannot build, run
  or report is `BLOCKED` and fails the test.
- `budgets.long.test.mjs`: see its criterion above.

## Not tested, and why

- **"While it runs, the document holds only the items the patch reached"** and **"copies no member"**: not observable
  through the public entry at the base; the heap criterion bounds the copying.
- **"A patch says which members it reached, and `revise_items` compares only those"**: the surface for saying so does
  not exist at the base and the issue does not name it; no criterion asks for it directly. The budgets criterion
  covers its cost.
- **"Takes the whole check"** as a path (criterion 3): which function produced the report cannot be seen from outside;
  the test holds what is reported.
- **The hub** (`deep-show`) end to end: at the base no patch op reaches `data`, so no hub call changes a row.
- **A recheck that returns an error**: the base's recheck has no error return; the three cases the criterion lists are
  covered.

## Ambiguities and how they were read

1. **"A patch that changes a row of `data`"**. At the base `apply_ops` refuses any path outside `items`
   ("a patch reaches only items"), so no patch can do it. Read as: the document's `data.goal` is changed directly and
   the recheck is told `changed = {"goal"}`, as the hub adds non-item entry IDs to `changed`. Open question for the
   issue's author: if the change adds a patch op or a "members reached" argument for this, the test's stand-in may not
   be the path a real caller takes; the blind redraft should then be asked for a test through that surface.
2. **"Reports what it reports today"**: read as what the whole check (`check_in`) reports for the edited document.
3. **"256 KB"**: 256,000 bytes (the stricter reading). **"4 MiB of `data`"**: 4,194,304 bytes of string content in one
   row, as 64 strings. **"Allocates"**: cumulative bytes asked of the allocator over apply, `changed` and the recheck,
   not peak or resident memory.
4. **"The recheck"**: both public rechecks, `recheck` and `recheck_with`.
5. **Issues "equal"**: the same set of (code, ids, path), as the patch fuzzer's law compares them.
6. **"Params name an asset or a data row"**: no core kind's check reads either at the base, so the test module's kind
   stands for one.
7. **"Returns nothing because the patch needs the whole check"**: a document with a `collections` entry, one of the
   cases in which the base's recheck answers nothing.
8. **"Panics inside a check"**: a registered rule panics; the probe catches the unwind and then reads the document.
9. **"Pass unchanged"**: no file of `tests/acceptance/896/` or `854/` differs from the merge base's, and the folder's
   own run passes with nothing skipped.
10. **"Generated documents"**: about 100 documents per 10,000 patches (at most 100 applied patches per document), so
    revisions chain and previous issues carry.
