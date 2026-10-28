# Blind redraft of one #371 acceptance test file

A fresh run of #371's acceptance-test job, with the same inputs, redrafting the disputed `actual.test.ts`
(criterion AC7) as `actual-redraft.test.ts` (AGENTS.md, Proof; technical design, Dogfooding: Who drafts it,
Disputes). It saw no implementation and looked for none.

## What was read

- Issue #371 (`gh issue view 371 --repo windoliver/deepbuild`): scope, the Document envelope fields, the eight
  criteria, the proof line.
- At base `14561af` ("Merge pull request #755 … claude/issue-349-close"), in this job's own worktree: AGENTS.md;
  `docs/technical-design.md`, Who drafts it (2085: of the spike's checks that failed the merged fix, one kind
  used "a key the issue names that the base's own code already names differently", which "disputes are for")
  and Disputes (2089); `docs/canvas-primitives.md`, Item and kind (349: "outside min and max is an error"; "A
  field the kind's version doesn't define is an error (`unknown_field`)"), Patch's closed refusal codes (458:
  `unknown_field`, `out_of_range`), Circle `circle@1` (1504: `center`, `r: f32, u`, `inner_r`, `arc`, `paint`,
  `status`; no `radius`), What holds a document to its rules (8167: issue shape `{check, code, severity, ids,
  path, actual, t, what, fix}`; "`actual` is the value refused at `path`, cut at 8,192 characters").
- Base code naming the circle's radius: `crates/deep-canvas-marks/src/scene.rs` (`p("r")` for `circle@1` at
  1662, 2225, 2266, 2364; `radius` there is `rect@1`'s corner radius), `crates/deep-canvas-marks/src/outline.rs`,
  `crates/deep-canvas-marks/src/modules.rs` (1041: a `circle@1` with `"r": 30`), `crates/deep-canvas-scene3d/src/
  scene.rs` (1015), `crates/deep-show/src/costs.rs` (64: `"r": 4`), and the earlier blind suite
  `tests/acceptance/373/arc.test.ts` ("a filled circle@1 with r 100 u"). `crates/deep-canvas/src/document/mod.rs`
  for the base's `Issue` (it already has an `actual` field).
- `tests/acceptance/305/REDRAFT-388.md` for this file's form.
- From the first draft's checkout only these four files, nothing else: `tests/acceptance/371/README.md`,
  `helpers.ts`, `tsconfig.json`, `actual.test.ts`. They were copied into this worktree's `tests/acceptance/371/`
  unchanged; the redraft imports `helpers.ts` unchanged and needs no extra helper.

## How the key was resolved

The criterion says "a `circle@1` whose `radius` is -2 fails with `out_of_range` at `items/c/params/radius`".
`circle@1` has no field named `radius`: the design's Circle section names its radius `r` (`r: f32, u`), and the
base's own code reads a circle's radius from `params.r` everywhere it draws, outlines or boxes one, as does
#373's suite. Under Item and kind, a check faithful to the design answers a `radius` param on a `circle@1` with
`unknown_field` (an error, since the document requires no newer minor), not `out_of_range`, so the first draft
can pass on no program that follows the design. This is the case Who drafts it names: a key the issue names
that the base's own code already names differently.

The criterion's intent is unambiguous: the circle's radius, set to -2, outside its range, refused with
`out_of_range` at that field's path with `actual` -2. So the redraft keeps every value the criterion states (the
kind, the item ID `c`, the value -2, the code `out_of_range`, `actual` -2) and spells the field as the design and
base do: `r`, at `items/c/params/r`. The test names the field once (`RADIUS = 'r'`) and derives the path from it.

Nothing else in the first draft depended on `radius`, except the second test's circle, which set `radius: 40`
as its valid radius; under the design that would itself be an `unknown_field`, so it becomes `r: 40`.

## The redraft

### `actual-redraft.test.ts`, criterion AC7

Build: `full` (`useBuilds([FULL])`). Surface and planted value as the first draft's README defines them:
`deep-show run` with a `deep_show` whole revision from session `sess-alpha` on doc `DOC.a` in panel `main`; the
scenario field `planted: "issues_without_actual"`; issues read from the reply's `issues` and, for the whole
list, from `issues_evidence` through the evidence store's public entry. The board is 200 × 200 with one
`circle@1` `c` at `center: [100, 100]`, `paint.fill.role: muted`.

1. **A circle whose radius is -2.** Params add `r: -2`. Asserts:
   - `outcome` is `refused`;
   - exactly one error-severity issue has `code: out_of_range` and `path: items/c/params/r`;
   - its `actual` is `-2`;
   - every issue in the reply carries `actual` (`none(actualFailures(list))`).
2. **A value longer than 8,192 characters is cut there.** Params add `r: 40` and `note`: 10,000 characters
   (`'chk\u{1D11E}'` × 2,500, every fourth outside the BMP so a cut counted in UTF-16 units lands elsewhere).
   `note` is a field `circle@1` doesn't define, so it is refused at its path; the issue's code isn't read.
   Asserts:
   - the value has 10,000 code points;
   - `outcome` is `refused`;
   - in the issue list at `issues_evidence`, exactly one issue has `path: items/c/params/note`;
   - its `actual` is a string of 8,192 code points, equal to the value's first 8,192 code points;
   - every issue in that list carries `actual`.
3. **The planted check fails, naming the code.** Test 1's board with `planted: "issues_without_actual"`.
   Asserts:
   - `outcome` is still `refused`;
   - `actualFailures(issues(reply))` is non-empty and one failure names `out_of_range`
     (`failsNaming(…, ['out_of_range'])`).

## Where this differs from the first draft

- `radius: -2` → `r: -2`, and the path `items/c/params/radius` → `items/c/params/r` (tests 1 and 3).
- `radius: 40` → `r: 40` in test 2, so the only field the circle doesn't define is `note`.
- Test titles say `items/c/params/r`; the describe says "(redraft)". No assert was added or dropped.

## Base run

```
$ npx tsc -p tests/acceptance/371/tsconfig.json
(exit 0)

$ npx vitest run --root tests/acceptance/371 actual-redraft --no-file-parallelism
 ❯ actual-redraft.test.ts (3 tests | 3 failed) 171821ms
     × AC7 a circle@1 whose radius is -2 fails with out_of_range at items/c/params/r and actual -2 1642ms
     × AC7 a value longer than 8,192 characters is cut there: actual holds its first 8,192 characters 35ms
     × AC7 a planted check that returns issues without actual fails this test, naming the code 23ms

 FAIL … AC7 a circle@1 whose radius is -2 fails with out_of_range at items/c/params/r and actual -2
AssertionError: the circle is refused: {"rev":1,"issues":[],"issues_evidence":"4f53cda1…","snapshots":[],
"changed":[],"unchanged":[],"created":["c"],"removed":[],"outcome":"presented",…}: expected 'presented' to be 'refused'
 ❯ actual-redraft.test.ts:40:95

 FAIL … AC7 a value longer than 8,192 characters is cut there: actual holds its first 8,192 characters
AssertionError: the circle with a field its kind doesn't define is refused: {"rev":1,"issues":[],…,
"outcome":"presented",…}: expected 'presented' to be 'refused'
 ❯ actual-redraft.test.ts:52:132

 FAIL … AC7 a planted check that returns issues without actual fails this test, naming the code
AssertionError: deep-show run refused the scenario: {"ok":false,"code":"bad_input"}: expected false to be true
 ❯ run helpers.ts:138:101
 ❯ actual-redraft.test.ts:64:21

      Tests  3 failed (3)
```

All three fail at the base on assertions, none on loading: the base's check presents a `circle@1` with `r: -2`
and with an undefined `note` param, raising no issue, and it refuses the scenario's unknown `planted` value with
`bad_input` (#393's convention), which `run`'s `ok` assertion catches. The `cargo build` of `full` took most of
the 172 s. Vitest's cache in `tests/acceptance/371/node_modules/.vite` was deleted after the run. Nothing was
committed.
