# #1835: a landed change's proven criteria are ticked from its trace lane's record

Base `9ae04c6cd` (origin/main when the work started). The runs here are on that base and on the change before main was merged in; the pull request carries what ran after.

## Change

- `scripts/proof.mjs`: the trace lane writes an evidence record of its own, `~/.deepbuild/lanes/<tree>-trace.json`, for the tree it ran on. One row for each criterion of the change's issue: PASS for one a tagged test proved in that run, INCONCLUSIVE for one left open. The record's state is the lane's.
- `scripts/budget-window.mjs`: for each commit the window takes, before it reads what the commit's issues leave unticked, `ticked` ticks in each issue's body the unticked criteria that the record of the commit's change side holds as PASS, and names the record on a line under each. The criterion's own line keeps its text, so its ID stays. With no readable record for that tree, nothing ticks.
- `docs/parallel-proof.md`, section 12a: the Ticks line.

## Requirement → change → proof

| Requirement | Change | Test (`tests/acceptance/1835/window.test.mjs`) | Base → change |
|---|---|---|---|
| Scope, AC1 `#1835.fb2cf14f`: the two criteria the trace lane proved are ticked, each naming the lane's record, the third is not; a landing that ticks every line fails, naming the third | the trace record; `ticked` | first test; twins `ticks-every-line`, `names-no-record`, `names-on-the-line` | fails, "the trace lane left no evidence record" → passes |
| AC2 `#1835.5f2ccf69`, first half: the third a budget, a passing window closes the issue, naming its commit | the ticks go in before the window reads the unticked lines; its close rule is unchanged | second test | fails, "a passing window left #9601 open" → passes |
| AC2, second half: the third unproven and no budget, the issue stays open, naming it | the same; `unmeasured` then holds only the third | third test; twin `closes-unproven` | fails, `unmeasured` holds all three → passes |

Runs, each once on its program: [base](base.txt), [the four twins](twins.txt), [the change](change.txt).

- Base: 3 of 3 fail, each at its assertion.
- `ticks-every-line`: the first test fails naming the third criterion, `#9601.aaa6fd01`. `names-no-record` and `names-on-the-line` fail the first test. `closes-unproven` fails the third. Each twin ran as the change with `scripts/budget-window.mjs` replaced by the twin's file.
- The change: 3 of 3 pass.

## The blind suite

A separate job wrote `helpers.mjs`, `window.test.mjs` and the four twins from [this brief](blind-brief.md). The files here are byte-identical to what it left ([hashes](acceptance.sha256)). It chose the surface: the window is what ticks, when it takes a landed commit.

That job stopped before it wrote `README.md`, `twins.json` and `BASE-FAILURE.txt`, and a second job given the same sources to finish them wrote nothing. So the folder has no `twins.json`, and the twin runs above were made by hand. Every test fails on the merge base at an assertion, which is what the before lane counts.

An earlier draft of the suite, with both changes forked one after the other, ran once on the change before the job changed its scene: 2 of 3. The third stopped at its precondition, because the fixture's task read INCONCLUSIVE on instructions at a load near 170; the record already held only the third criterion as unmeasured.

## Open

- **The guard.** `scripts/proof.mjs` and `scripts/budget-window.mjs` are the proof lanes' own code. Their change needs its own commit and a signed approval tag from a key on `.deepbuild/approvers`.
- **`node scripts/affected.mjs`: INCONCLUSIVE, no job started** ([output](affected.txt)). No test grant came in its 30 minutes: another session's jobs had held both test slots for hours. Of the 47 files it selected, three ran directly: this suite, `tests/acceptance/1874/window.test.mjs` (4 of 4, on the final code) and `tests/acceptance/569/trace.test.mjs` (6 of 6, with HOME in a scratch folder, before the last correction to `budget-window.mjs`, which that file doesn't read). The other 44 did not run.
- **The proof lanes** (`node scripts/proof.mjs guard before trace`) read the change's commits, so they ran after this file was committed. Their result is in the pull request.
- **Lints run on the tree:** `design-links.mjs` and `public-text.mjs` exit 0. `size-ratchet.mjs` and `repo-rules.mjs` exit 1 on files this change doesn't touch, and name none it does.

## Limits

- A trace record is a file under the home folder of the machine whose lanes ran. A window on another machine, such as a reference Mac that proves no changes, finds none and ticks nothing; nothing fetches a record there yet.
- The window trusts that file as the other lanes' records are trusted.
- A commit that says `Closes #n` has its proven lines ticked too, from the same record. The issue asks only for `Part of #n`.
- The tests of `scripts/proof.mjs` that run it with the machine's own HOME, such as `tests/acceptance/569/`, now leave a trace record there for each scratch tree.
