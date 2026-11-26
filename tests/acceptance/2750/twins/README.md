# Twins for the 2750 tests

The base has no reading of the commits the default branch gained, so every test fails there on a missing reading
(`../BASE-FAILURE.txt`), which proves little about what the tests can catch. These are the five wrong readers the
criteria name. `../twins.json` maps each criterion's ID to its twins. AC4 and AC6 name no wrong reader; the merge base
is theirs.

No implementation existed when they were written, so none of them copies one. Each is one file,
`twins/<name>/packages/readings/src/index.ts`, laid over the base's `packages/readings/src/index.ts`, which is exactly
`export * from './impl.js'` and must stay so (`../README.md`, The surface under test, section 3). The twin re-exports
everything and wraps `panelRows`, which gives `numbers.read` its rows: the real one runs, and the `landed.none` row is
changed on its way out. So the fault holds whatever builds the reading, as long as its row reaches `numbers.read`
through `panelRows`. A twin is chosen by being laid over that file and by nothing in the environment.

To run one: lay its file over the implementation's in a scratch copy of the checkout that holds this suite, build, and
run the test file the table names there, as the proof's before lane does.

| Criterion | Twin | The one fault it plants | Test file | Where it fails |
|---|---|---|---|---|
| AC1 `#2750.8eb13c6b` | `squash-takes-head-verdict` | A commit that reads none with cause `tree` is given the verdict its row names, its branch head's, and loses its cause; the value is the share over the changed rows | `landed.test.ts` | `<squash> (the squash whose tree no snapshot matches, its branch's head PASS) reads {"judged":"PASS"}; it must read none (tree not judged, naming PASS on <head>…`, then `the reading is 7 PASS, 1 FAIL and 2 none: it lists 10 of the 10 commits the default branch gained, 8 of 10 judged; the fixture is 6 PASS, 1 FAIL and 3 none` |
| AC1 `#2750.8eb13c6b` | `lists-only-judged` | Every commit row that reads none is left out; the value is the share over the rows left | `landed.test.ts` | `<commit> (pushed while the gate was off) has no row…` for each of the three, then `the reading is 6 PASS, 1 FAIL and 0 none: it lists 7 of the 10 commits the default branch gained, 7 of 7 judged; the fixture is 6 PASS, 1 FAIL and 3 none` |
| AC2 `#2750.230902ce` | `revert-as-escape` | A row counted `never_judged` is counted `escape` | `revert.test.ts` | `the revert <revert> of <commit>, a commit that read none (gate off), is counted "escape", an escape after PASS; it must be counted "never_judged", apart from the escapes`, then `escapes after PASS: 1, not zero: <revert>…` |
| AC3 `#2750.8f4da496` | `uncovered-as-zero` | Every missing row is left out, so the span reads as one in which no commit landed | `missing.test.ts` | `the reading says missing for no date; the forge refused the push readings for <from> to <to> (3 dates): that span reads as zero unjudged commits, not as missing` |
| AC5 `#2750.099939a8` | `status-on-unjudged` | Each time the reading is listed, a `deepbuild/verdict` status is posted on its first unjudged commit, to the forge the hub reads (`DEEP_HUB_TEST_FORGE`) with the hub's token (`GH_TOKEN`); the rows are left as they are | `quiet.test.ts` | `the forge received POST /repos/acme/shop/statuses/<sha> (answered 201): a status posted on the unjudged commit <sha>` |

Each was run by the blind job against a throwaway right reader of its own, which isn't kept: a script that read the
fixture forge over HTTP and the fixture's events as data and built the `landed.none` row. With the twin's `panelRows`
over that row, the judge the test file calls (`../judges.ts`) gave the failures quoted above; with the row unchanged it
gave none. The twins type-check against the base's `packages/readings/src/impl.ts`. They were not run through a hub:
no implementation existed to lay them over.

If the implementation's `numbers.read` doesn't take the reading's row through `panelRows`, a twin doesn't reach it and
its test passes on it. Plant the same fault under the same name where the row is built, and replace the twin's file;
the tests stay as they are.
