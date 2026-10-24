# Redraft of three catalog tests (#138, criteria 7 and 29)

A blind redraft, as AGENTS.md (Proof) sends a dispute: written from issue #138, its oracle page, the design
and this suite's README, helpers and `catalog.test.ts` at base `e9c601b`, without reading any implementation.
Nothing in `catalog.test.ts`, `helpers.ts` or `README.md` was edited.

## What was disputed

Three tests in `catalog.test.ts` can't pass under any implementation:

| Test | Call |
|---|---|
| `#138.9e9940d1 test.kit.rogue … fails the kit's catalog part naming the code` | `expectFailure(…, 'uncatalogued', { code: 'test.kit.rogue.unlisted' }, …)` |
| `#138.c7f79e24 a planted ops fix that clears its issue but adds ref_unresolved … fails, naming the code` | `expectFailure(…, 'ops_fix', { code: 'test.kit.fixer.y_over' }, …)` |
| `#138.c7f79e24 an ops fix that no fixture applied … fails the kit, naming the code` | `expectFailure(…, 'unproved_fix', { code: 'test.kit.fixer.y_under' }, …)` |

`matching()` in `helpers.ts` keeps a failure only when `f.code` equals the failure code and every given field
equals its value, so each call asks for `f.code` to be two different strings at once. The README defines a
failure's `code` as its failure code ("Failure codes (closed list; each also carries `module` and `part`)"), and
then lists `uncatalogued {code}`, `ops_fix {code, added, missing}` and `unproved_fix {code}`, reusing `code` for
the check code each one names. That collision is the defect; the intent (the failure names the check code) is
clear from the issue's "naming the code" in both criteria.

## The field chosen: `issue_code`

In the redraft each of the three failures names its check code in `issue_code`:

```json
{"code": "uncatalogued", "module": "test.kit.rogue", "part": "catalog", "issue_code": "test.kit.rogue.unlisted"}
{"code": "ops_fix", "module": "test.kit.fixer", "part": "catalog", "issue_code": "test.kit.fixer.y_over", "added": ["ref_unresolved"], "missing": []}
{"code": "unproved_fix", "module": "test.kit.fixer", "part": "catalog", "issue_code": "test.kit.fixer.y_under"}
```

Why this name:

- The README's other failures name a field for the role of the value it holds, not generically:
  `undeclared_read {operator, array}`, `contribution {kind, array}`, `check_kind {fixture, kind}`,
  `oracle {fixture, oracle}`. The value here is a code, but `code` is taken, so the field says which code: the
  `code` of an issue a check raises. `docs/canvas-primitives.md` (Check input, "Every check returns issues as
  data: `{check, code, severity, …}`. Each code is in the check catalog …") gives that code its home on the issue.
- `name`, as in `mismatch {what, name, seed}`, was considered and not taken: there it names an array, cache or
  key, so a second meaning would make a failure's fields mean different things by failure code.
- `check` was not taken: in this suite `check` already means a check kind and its inputs (`check_kind`, the
  sidecar's `checks`), and the design's issue `check` field is the check, not the code.
- `fix_of` (the catalog case's field for an applied ops fix) fits `ops_fix` and `unproved_fix` but not
  `uncatalogued`, which names a code with no catalog entry and no fix; one field for all three is simpler.
- `added` and `missing` in `ops_fix` stay as they are: they already hold issue codes and don't collide.

The redraft passes `{ issue_code: … }` to the unchanged `expectFailure` from `helpers.ts`, which compares any
named field, so no new helper was needed.

## What else stays the same

Each redrafted test keeps the original's name (criterion ID first), build, `kit` call, module and part, its
`FAIL` verdict check, and in the `ops_fix` test the check that `added` equals `['ref_unresolved']`. The test
file builds only the three feature sets these tests use (`full` with `test-kit-rogue`,
`test-kit-fixer-dangles` and `test-kit-fixer-unproved`), defined as in `catalog.test.ts`. Strictness is
unchanged: the original matched the code by exact equality, and so does the redraft, now in a field that can
hold it.

## Until the owner decides

The three originals stay in `catalog.test.ts`, and the README's failure list still reads `{code}` for these
three, until the owner approves swapping them. Both files run under `npx vitest run --root
tests/acceptance/138`, so until then the three originals keep failing by construction beside their redrafts.
On approval: delete the three originals from `catalog.test.ts`, move the redrafts in (or keep this file), and
change the README's `uncatalogued {code}`, `ops_fix {code, added, missing}` and `unproved_fix {code}` to
`{issue_code}`, `{issue_code, added, missing}` and `{issue_code}`.
