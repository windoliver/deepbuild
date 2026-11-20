# Twins for the 2047 tests

The base has no sweep, so every test fails there on a missing script, and that proves little about what the tests can
catch. These are the planted sweeps the criteria name, one per criterion, each a plausible way to get that criterion
wrong. `../twins.json` maps each criterion's ID to its twin.

The blind job built them on its own throwaway implementation, which isn't kept: a `scripts/closed-sweep.mjs` of about
130 lines that reads main's tests with `git ls-tree` and `git cat-file --batch`, imports only `testPaths` from
`scripts/lanes.mjs`, and makes the gh calls the README names. That implementation passes all 7 tests. Each twin is a
copy of it with one fault planted, noted in its first line, and replaces only `scripts/closed-sweep.mjs`, never a test,
helper or fixture. A copy goes stale as the real script changes, and still holds its fault; the implementing job can
plant the same faults in its real code under the same names.

To run one: lay `<twin>/scripts/closed-sweep.mjs` over the implementation's in a scratch copy of the checkout that holds
this suite, and run the test file the table names there, as the proof's before lane does.

| Criterion | Twin | The planted fault | Test file | Where it fails |
|---|---|---|---|---|
| AC1 `#2047.de9de3ac` | `any-suite-holds` | An issue with any suite under `tests/acceptance/<issue>/` counts as held, whatever its tests name | `report.test.mjs` | The clock, the third issue: `the third fixture issue #9103 … has no line naming its unheld criterion 4 by ID and first words` |
| AC2 `#2047.3e6fece2` | `ac-number-always` | A test in `tests/acceptance/<issue>/` holds the criterion whose `AC<n>` it names, even in a suite that names IDs | `report.test.mjs` | The door's reworded criterion: `criterion 2 of #9106, reworded after its suite was written, now #9106.<h8> "The lock turns with the key from either side", isn't reported unheld` |
| AC3 `#2047.2d1ab05b` | `comments-every-run` | It doesn't read its earlier comments: each run reopens and comments on every unheld criterion again | `reopen.test.mjs` | Run 2: `after two runs with nothing changed the third fixture issue #9103 holds 2 comments from the sweep, not 1` |
| AC4 `#2047.5e2430c0` | `main-only` | It reads main only: no open pull request makes an issue pending | `pending.test.mjs` | Run 1: `#9121 was reopened while pull request #9221, which closes it, is open` |
| AC5 `#2047.0356e83a` | `skips-unreadable` | An issue gh fails to read is skipped, unnamed, and the run exits 0 | `blocked.test.mjs` | `no line reads BLOCKED naming #9112, the issue gh failed to read` |
| AC6 `#2047.ececce7b` | `first-page-only` | It reads the first page of closed issues only | `pages.test.mjs` | `the summary counts 100 issues read, not 250` |
| AC7 `#2047.a0828b81` | `moved-unheld` | A criterion line ending `(moved to #n)` reads as any other criterion | `moved.test.mjs` | `#9131 was reopened, though the one criterion no test names, its third, ends (moved to #9132)` |

`../BASE-FAILURE.txt` has each twin's run.
