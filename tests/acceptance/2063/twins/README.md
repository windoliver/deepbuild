# The twins for the 2063 tests

Criterion 4 (`#2063.0d14edf8`) names its own wrong program: "a planted lane that passes every name whose family the
list holds". Criteria 2 and 3 name none, and on the base their tests fail at the clean run they start from, before
their own assertions, so each has a twin that passes the clean run and fails the assertion the criterion is about.
They are kept here as other suites keep theirs (`tests/acceptance/1114/twins/`), and `../twins.json` names them by
criterion, so `scripts/proof-runs.mjs` lays each over the change and runs the criterion's tests against it.

| Criterion | Twin | Replaces | The planted fault | The test it fails, and where |
|---|---|---|---|---|
| `#2063.d47f7c6f` (criterion 2, first half) | `passes-any-name-once-listed` | `scripts/catalogue-drift.mjs` | Once the list holds any entry, every name passes, listed or not, so `ask.ghosted` passes | `ac2-uncatalogued-kind.test.mjs`, first, at "the lane's verdict on an open issue naming ask.ghosted is FAIL" |
| `#2063.d47f7c6f` (criterion 2, second half) | `never-reads-entry-issue` | `scripts/catalogue-drift.mjs` | A listed name passes without its entry's issue being read, so `ask.ghosted #9606` passes `ask.ghosted` | `ac2-uncatalogued-kind.test.mjs`, second, at "the lane's verdict with ask.ghosted listed under #9606, which does not name it, is FAIL" |
| `#2063.0ccaf9ec` (criterion 3, both halves) | `never-reads-entry-issue` | `scripts/catalogue-drift.mjs` | The same: an entry is never stale, whether its issue is closed or no longer names it | `ac3-stale-entries.test.mjs`, first, at "the lane's verdict with move.feel listed under the closed #9608 is FAIL", and second, at "the lane's verdict with move.feel listed under #9608, which no longer names it, is FAIL" |
| `#2063.0d14edf8` (criterion 4) | `passes-listed-families` | `scripts/catalogue-drift.mjs` | A name passes when its family is the family of any listed name, so with `plan.overlay` listed, `plan.ghost` passes | `ac4-listed-family.test.mjs`, at "the lane let plan.ghost through" |

Each twin is the base's lane plus the blind job's own small implementation of #2063's list, with its one fault. It
reads the change's `scripts/not-event-kinds.txt`, and it imports the change's `scripts/open-issues.mjs` and
`catalogueDrift` from `packages/contracts/dist`, as the base's lane does, with the signatures they have at the base.
Apart from its fault, each reads an entry as the tests do: stale unless its issue is an open issue whose body holds
the name in backticks.

What else each twin fails, run whole in a scratch copy of the base (`../BASE-FAILURE.txt`):
`passes-any-name-once-listed` also fails criterion 4's test, since `plan.ghost` passes too, and passes criterion 2's
second, where the unread entry is still stale. `never-reads-entry-issue` passes criterion 2's first and criterion
4's. `passes-listed-families` fails criterion 4's only: `ask` is not a listed family. Every twin passes every clean
run and criterion 1's test.
