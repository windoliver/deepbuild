# The twins for the 1837 tests

The criterion `#1837.78b8f3bb` names one wrong program, a planted catalogue missing a kind, which
`ac3-planted-catalogue.test.mjs` plants itself. The design's lines were already on the base (PR #2052), so the tests
that pass there each have a twin here that fails them at an assertion. `../twins.json` names them, and
`scripts/proof-runs.mjs` lays each over the change and runs the criterion's tests against it.

| Twin | Replaces | The planted fault | Tests it fails, and where |
|---|---|---|---|
| `design-without-lines` | `docs/technical-design.md` | A short design with the two linked sections and none of the eight items' lines: the design before the owed lines | every `ac1` test: "has no line for #…" and "the planted design for #… removed no line" |
| `catalogue-drops-ci-archived` | `packages/contracts/schemas/ci.archived@1.json` | The schema without `x-feeds`, so the catalogue has no `ci.archived` | `ac2` first, at "the catalogue lacks these Scope kinds" |
| `empty-catalogue` | `scripts/catalogue-drift.mjs` | The base's lane, checking names against an empty catalogue, so every catalogued kind the docs name is drift | `ac2` second, at "the lane's verdict … is PASS" |
| `reads-no-docs` | `scripts/catalogue-drift.mjs` | The base's lane, reading no design doc, so a kind only the docs name always passes | every `ac3` test, at "the lane's verdict with … missing from the catalogue is FAIL" |

Each lane twin is the base's `scripts/catalogue-drift.mjs` with one fault; it imports the change's
`scripts/open-issues.mjs` and `packages/contracts/dist`, as the base's lane does. The four `ac3` tests that fail on the
base itself (`resource.created`, `transcript.archived`, `archive.quiet`, `ci.archived`) fail on every twin too.
