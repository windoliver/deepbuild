# #1687 remaining #18 assertion-form proposal — NOT APPLIED

The existing #18 binding suite is already its one blind redraft (`503c87ea9`,
base `b7bccf9`). No further redraft or proof-runner exception is proposed. The
previous approval of #822 construction and #1687 ownership/loader review did not
cover this change. This proposal needs the person's explicit approval and any
required real signed approval; no signature is fabricated.

## Exact scope

Only `tests/acceptance/18/binding/binding.test.ts`, function `holds()`, changes.
Keep `const found = problems(o);`, every scenario, condition, expected value,
violation string, timeout, cleanup step, and both test cases unchanged. Replace
its plain-Error report:

```ts
if (found.length) throw Error(`${TAG}${o.plant ? ` (DEEP_HUB_PLANT=${o.plant})` : ''}:\n- ${found.join('\n- ')}`);
```

with the framework assertion of exactly the same condition and diagnostic:

```ts
expect(found, `${TAG}${o.plant ? ` (DEEP_HUB_PLANT=${o.plant})` : ''}:\n- ${found.join('\n- ')}`).toEqual([]);
```

`expect` is already imported. Both forms require zero problems; neither changes
what behavior is accepted. The second test's checks for the planted failure and
its open-item text remain unchanged. No production special case, new fault,
classifier relaxation, test skip or tolerance change is permitted.

## Why this is a separate approval

The unchanged `unbound-reads-all` overlay was observed exposing the expected
session item, and `holds()` rejected it at its explicit validator. But a plain
`Error` is not a test-framework assertion. The design's “Failing on an assertion”
and `scripts/proof-runs.mjs` correctly require a framework assertion with a test
frame. The second tagged test expects that planted leak, so its existing
assertions cannot reject the unconditional-leak overlay. The independent
retention review found no other executable assertion for `#18.7f5b2ce8`.

This is a protected assertion-form change, not a runtime bug fix and not an
already-authorized setup change. Until approval, the original file stays intact
and this proof gap stays **BLOCKED**.

## Required proof after approval

An authorized check owner applies only this replacement in its own commit.
Build current clean and exact-twin snapshots independently, then run the same
criterion cases: both clean cases must pass; the same positive case must reject
the twin with a framework `AssertionError`, the innermost frame in `holds()`, and
the same leaked open item named. Preserve the old plain-Error evidence; do not
relabel it as a formal kill. The runner's decision must pass unchanged.
