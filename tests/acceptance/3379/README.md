# Acceptance tests for #3379: a logic item's control reads as declared references

Written first, blind, by a job that never saw an implementation of #3379; none existed. Written from the issue (its
body, Scope, the three acceptance criteria and Proof), `docs/canvas-primitives.md`, `docs/technical-design.md` and
the base commit `8c984adb9` ("Merge pull request #3376 …"). The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

Read as surfaces at the base: `tests/acceptance/1801` (its helpers, which this suite imports: the `deep-show`
build with `--features full`, `deep-show run` scenarios, the shared world, `show`, `refsTo`, `rows`,
`refsFailures`, `stored`), `tests/acceptance/551/fixtures.ts` (a `logic@1` program written as WebAssembly bytes, a
slider control) and `crates/deep-logic/src/piece/checks.rs` (what a logic read can name).

## Fixtures

- **The program**: one WebAssembly module, written as bytes in the test file: one 64 KiB page whose maximum is its
  minimum, immutable i32 globals `reads_at` = 0 and `writes_at` = 4096, and `init(i64)` and `step(i64)` with empty
  bodies. It is put into the evidence store by its hash; both logic items run it.
- **The board**: a shared document (alpha's layer `alpha-main`, revision 0 empty), profile `board`, requiring
  `logic ^1`. Revision 1 holds the slider controls `press` and `aim`, the logic item `counter` with
  `reads: ["press", "reading:pad", "other.score"]`, `preview: {reads: ["aim"], writes: {}}` and one write
  `presses`, and the logic item `other` that reads nothing and writes `score`.
- **The removal** (AC2): the board with the controls `aim` only, `counter` unchanged, sent with `removes: ["press"]`.
- **The rename** (AC3): the board with the controls `aim` and `tap`, sent with `removes: ["press"]`: once with
  `counter` still reading `press`, once with its reads `["tap", "reading:pad", "other.score"]`.

Deviation from the criterion text, noted: the criterion names only the controls and `counter`. The board adds the
item `other`, which writes `score`, so that `other.score` is a real array read rather than a dangling name; the
criterion's "array read" is then what its words say. No source `pad` is declared: the base presents the board with
`reading:pad` undeclared (and with or without `other`) with no issues, so the document as written is valid at
show time and a source declaration would add a field the criterion doesn't name.

## Criteria → tests (`control-refs.test.ts`)

| Criterion | Tag | Test asserts |
| --- | --- | --- |
| AC1 | `#3379.d3f05542` | On revision 1, `refs_to press` gives exactly one row, `items/counter/params/reads/0` of kind `control`, and `refs_to aim` exactly `items/counter/params/preview/reads/0` of kind `control`; no other row (so none for `reading:pad` or `other.score`). |
| AC2 | `#3379.1fe9c8e9` | The removal is `refused`, with a `ref_unresolved` issue at `items/counter/params/reads/0` whose `actual` equals the rows `refs_to press` gave on revision 1, in the same order; the reply's `rev` is 1, and a `refs_to` after it reads revision 1. |
| AC3 | `#3379.dce5a74c` | The rename leaving `counter` on `press` is refused the same way (same checks as AC2). |
| AC3 | `#3379.dce5a74c` | The rename with `counter` reading `tap` is presented as revision 2 with no `ref_unresolved` issue, and `refs_to tap` gives exactly `items/counter/params/reads/0` of kind `control`. |

## The base

`BASE-FAILURE.txt` is the run at `8c984adb9`. Every tagged test fails at its own assertion on a reply's data:
`refs_to press`, `aim` and `tap` give `rows: []`, and both revisions that remove `press` are `presented` (rev 2)
with no issue.
