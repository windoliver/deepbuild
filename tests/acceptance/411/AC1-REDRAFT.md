# #411 AC1, blind redraft

Criterion: "deep_query returns rows by stable ID with a coverage block, and a conclusion of absence drawn from a
partial result is refused." The redraft is `rows-redraft.test.ts`. It was written by a fresh job that saw the
issue, the design, the base and this suite, never an implementation of #411 (none exists at the base) or the
dispute.

## What was read

- AGENTS.md (Proof), `docs/technical-design.md` Dogfooding and "Tests written first", and the MCP tools row
  (`deep_query` "returns a revision's evaluated rows ... by stable ID, with a coverage block").
- Issue #411 (scope, the 10 criteria, Proof) and its oracle page (`doneright/oracles/issues/411.md`, branch
  `doneright` of DeepBuildAI/deepbuild). It has no upstream test for criterion 1, because deep_query's rows and
  coverage block are our own evaluation API.
- At `8d183e28` (base `f41a5b3e` plus this suite): the suite's README (deep_query on `deep-show run`, the rows
  reply, `Row`, `Coverage`, `expect: {none: {kind}}`, `cap`, `partial_result`), `helpers.ts` (`run`, `scenario`,
  `show`, `query`, `presented`, `rows`, `coverage`, `KEY`, `DOC`, `useBuilds`, `useEvidence`), `rows.test.ts`,
  `BASE-FAILURE.txt`, and the base's kind registries (`crates/deep-canvas/src/kinds.rs`,
  `crates/deep-canvas-scene3d/src/module.rs`, and `unknown_kind` in `crates/deep-canvas/src/document/check.rs`).

## Fixtures, and why

The base's `full` build of `deep-show` presents boards of `rect@1`, `text@1` and `group@1`, but notices each of those
items `unknown_kind` with "the item is skipped", because no canvas module in that build registers those kinds. A row
is an evaluated item with a content key, so the redraft uses only kinds that build registers and evaluates:
`camera@1` (core), and `mark.box@1` and `mark.sphere@1` from scene3d, which is in `full` and which the documents name
in `requires.modules`. Every document is a small 3D scene with a camera `cam`:

- **Shelf**: box `shelf` with two child boxes, `shelf.left` (size 1) and `shelf.right` (size 0.5, so the two
  children differ in a param and must carry different content keys), and a loose box `crate`. The test asks for
  `items: [shelf.right, crate, shelf, shelf.left]`, then for the same IDs in reverse order. Expected: exactly those
  four rows and no row for `cam`. Each row has its kind (`mark.box@1`), its parent (`shelf` for the bins, `null`
  for the others) and a 32-hex content key. `children_total` is 2 for `shelf` and 0 for the rest. Each child comes
  after its parent, and the two bins have different keys. The coverage block is complete, with 4 rows matched,
  4 shown and nothing cut. The same IDs asked in the other order give the same rows, keys included. The shelf has
  both of its children in the result, so `children_total` is 2 whether it counts the document's children or the
  result's.
- **Posts** (8 boxes, 9 rows with the camera) and **Posts and a ball** (the same posts plus sphere `zz.ball`). The
  ball comes last by ID, by `order` (`z0`) and in the listing. Both documents are queried with
  `expect: {none: {kind: "mark.sphere@1"}}`:
  - uncut (default cap 200): `absent: true` for Posts and `absent: false` for Posts and a ball, both complete, and
    the ball's row is in the result. This covers absence concluded both ways.
  - cut by `cap: 3`: `complete: false`, 3 rows kept, `rows_total` 9 or 10, `rows_shown` 3, and `cut` exactly
    `[{parent: null, shown: 3, total}]`. Neither reply is ever `absent: true`. When no sphere is among the kept
    rows, the reply is `code: "partial_result"`. On Posts that is always the case, because the scene has no sphere,
    so the program has no way to know the answer. On Posts and a ball, the sphere really exists but every order
    leaves it out of 3 rows, so a conclusion drawn from the kept rows would be wrong. If an implementation did keep
    the ball, `absent: false` would be the right answer, and the test accepts that.

A wrong program fails these tests in four ways. One returns rows in request order without IDs, or for items it
wasn't asked for. One gives every row the document's key, which fails the different-keys check. One reports a cut
result as complete. One concludes `absent: true` from the rows it kept.

Readings: `children_total` and `parent` follow the README's `Row`. The cut entry for a top-level cut is the
README's `{parent: null, shown, total}`. A complete reply carries no `code`. These tests don't use the
original's 5,000-item city; AC10's `cut.test.ts` covers that cap. A 3-row cap on a 9- or 10-row scene is enough for
"a result cut by its cap".

## The documents at the base

A temporary test (deleted, not committed) showed the redraft's three documents, exactly as `rows-redraft.test.ts`
builds them, through the suite's own `scenario`, `show` and `presented` on the base's `deep-show` (built with
`cargo build --locked --bin deep-show --no-default-features --features full`, run as `deep-show run`). Each one was
presented, with no issue and no notice:

```
shelf: outcome presented, rev 1, issues [], notices []
posts: outcome presented, rev 1, issues [], notices []
posts and ball: outcome presented, rev 1, issues [], notices []
 ✓ zz-fixture-check.test.ts > AC1 redraft fixtures at the base > every document the redraft shows is presented by the base, with no issue and no notice 1555ms
```

`tsc -p tests/acceptance/411/tsconfig.json` passes with the new file in place.

## The redraft at the base

```sh
node node_modules/vitest/vitest.mjs run --root tests/acceptance/411 rows-redraft --no-file-parallelism
```

Both tests fail and none passes. The reason is the expected one: the base has no deep_query. The scenario is the
one above plus the `deep_query` calls, and `deep-show run` refuses it with `bad_input`. Without those calls, the
same scenario is presented.

```

 RUN  v5.0.5 ~/dev/claude-worktrees/github-issue-411-25d63a/agent-ab952269c082a14bd/tests/acceptance/411

 ❯ rows-redraft.test.ts (2 tests | 2 failed) 2960ms
   ❯ AC1 deep_query returns rows by stable ID with a coverage block, and a conclusion of absence drawn from a partial result is refused (2)
     × AC1 rows asked for by ID come back keyed by those IDs, with kind, parent, content key and children_total, under a complete coverage block 1471ms
     × AC1 absence is concluded both ways on a complete result, and refused with partial_result, never absent: true, on a result cut by its cap 15ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  rows-redraft.test.ts > AC1 deep_query returns rows by stable ID with a coverage block, and a conclusion of absence drawn from a partial result is refused > AC1 rows asked for by ID come back keyed by those IDs, with kind, parent, content key and children_total, under a complete coverage block
AssertionError: deep-show run refused the scenario: {"ok":false,"code":"bad_input"}: expected false to be true // Object.is equality

- Expected
+ Received

- true
+ false

 ❯ run helpers.ts:149:83
    147|   expect(lines.length, `${SHOW_NAME} run: one output line per input li…
    148|   const out = obj(JSON.parse(lines[0]!) as JsonValue, `${SHOW_NAME} ru…
    149|   expect(out['ok'], `${SHOW_NAME} run refused the scenario: ${brief(ou…
       |                                                                                   ^
    150|   const replies = arr(out['replies'], 'run: replies').map((x, i) => ob…
    151|   expect(replies.length, 'run: one reply per call').toBe(arr(scenario[…
 ❯ rows-redraft.test.ts:61:35

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 FAIL  rows-redraft.test.ts > AC1 deep_query returns rows by stable ID with a coverage block, and a conclusion of absence drawn from a partial result is refused > AC1 absence is concluded both ways on a complete result, and refused with partial_result, never absent: true, on a result cut by its cap
AssertionError: deep-show run refused the scenario: {"ok":false,"code":"bad_input"}: expected false to be true // Object.is equality

- Expected
+ Received

- true
+ false

 ❯ run helpers.ts:149:83
    147|   expect(lines.length, `${SHOW_NAME} run: one output line per input li…
    148|   const out = obj(JSON.parse(lines[0]!) as JsonValue, `${SHOW_NAME} ru…
    149|   expect(out['ok'], `${SHOW_NAME} run refused the scenario: ${brief(ou…
       |                                                                                   ^
    150|   const replies = arr(out['replies'], 'run: replies').map((x, i) => ob…
    151|   expect(replies.length, 'run: one reply per call').toBe(arr(scenario[…
 ❯ rows-redraft.test.ts:96:53

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯


 Test Files  1 failed (1)
      Tests  2 failed (2)
   Start at  13:17:50
   Duration  3.09s (tests 98%, import 1%, transform 1%)
```

## Decision

The first draft's `rows.test.ts` fails on its own fixture, not on deep_query. Its plain board's caption "Three
boxes" is refused `number_unsourced`, and the `full` build skips its `rect@1` and `text@1` items as `unknown_kind`,
so neither test reaches a row. This redraft passes against the implementation, and both drafts can't pass on one
program. On Oct 31, 2026 the maintainer asked for a PR that closes #411, and the only way to prove AC1 is the
redraft. `rows-redraft.test.ts` replaces `rows.test.ts`, which is removed.
