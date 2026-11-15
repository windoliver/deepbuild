# The twin for the 2063 tests

Criterion 4 (`#2063.0d14edf8`) names its own wrong program: "a planted lane that passes every name whose family the
list holds". It is kept here as other suites keep theirs (`tests/acceptance/1114/twins/`), and `../twins.json` names it
for the criterion, so `scripts/proof-runs.mjs` lays it over the change and runs the criterion's test against it.

| Criterion | Twin | Replaces | The planted fault |
|---|---|---|---|
| `#2063.0d14edf8` (criterion 4) | `passes-listed-families` | `scripts/catalogue-drift.mjs` | A name passes when its family is the family of any listed name, so with `plan.overlay` listed, `plan.ghost` passes |

The twin is the base's lane plus the blind job's own small implementation of #2063's list, with that one fault. It
reads the change's `scripts/not-event-kinds.txt`, and it imports the change's `scripts/open-issues.mjs` and
`catalogueDrift` from `packages/contracts/dist`, as the base's lane does, with the signatures they have at the base.
Apart from the fault it reads an entry as the tests do: stale unless its issue is an open issue whose body holds the
name in backticks.

On the twin, `ac4-listed-family.test.mjs` fails at "the lane let plan.ghost through" and the suite's other five tests
pass (`../BASE-FAILURE.txt`).
