# Acceptance tests for #100: ropes and cloth built first, and nothing of ours waiting on a licensing or patent review

Written blind at base commit `ba461c1ba`, from the issue, the design and that base. The decision #100 records is
already on main; the closed-issue sweep (`scripts/closed-sweep.mjs`, #2047) reopened the issue because no test on main
names its criterion's ID, and it holds a criterion only when a code file under the test paths names it. This folder
names and holds it. The drafting job saw no work on the issue: no other commit, branch, worktree or pull request. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding).

The base is main as of 2026-11-25 with one local commit on top that leaves the decision's record out of the two Decided
tables, so that the tests are drafted from the issue's words and not from the docs' wording. On it the criterion's
first half fails, and its second half holds.

## What was read

- **The issue**, #100, as the brief gave it: title, body, the owner's comment of November 9 (each table has "the row
  'Our own solver for ropes and cloth': build first, with no licensing or patent review gating it") and the sweep's
  comment of November 19.
- **The design.** `docs/technical-design.md`: Decided, The physics module, and in How we know version 0 works: Criteria
  to tests, both ways, Wrong programs, Failing on an assertion and Dogfooding. `docs/canvas-primitives.md`: What's
  decided, and what would reopen it, and `soft@1`. **AGENTS.md.**
- **The base, for surfaces and format**: `scripts/doc-links.mjs`, `scripts/closed-sweep.mjs`, `scripts/proof-change.mjs`
  (`criterionId`, `underTestPaths`), `scripts/proof-runs.mjs` (`twinsOf`, `prepareRuns`, `atAssertion`, `before`),
  `scripts/proof-reporter.mjs`, `scripts/lanes.mjs` with `scripts/lanes-lists.mjs`, `scripts/studied-names.mjs`, the
  by-hand rule of `scripts/affected.mjs`, the heads of other lane scripts, the suites
  `tests/acceptance/1111-redraft-2047/` and `tests/acceptance/1336/`, and what the READMEs of #594, #3242 and #3267
  say of live tests.
- **GitHub, reading only**: every issue's number, title and body, once to draft and once per live run, and two totals
  from its search: the issues (2,160) and, by mistake, the pull requests, a number only.

## Run

```sh
node --test tests/acceptance/100/criterion.test.mjs      # offline: the two tables and the public docs
node --test tests/acceptance/100/issues.live.test.mjs    # live: every issue, read once with gh
```

Node 24 and the checkout: Node built-ins and the repo's own `scripts/doc-links.mjs`. No install and no build. The tests
judge the checkout their files sit in and write nothing. The offline file needs no network and no `gh`, and takes about
0.1 s. The live file needs network and `gh` signed in with read access to `windoliver/deepbuild`; it runs
`gh issue list --state all` once, about 20 s. Signed out, offline, or given a list that is cut short or lacks #100, it
skips with a message starting `INCONCLUSIVE:`. A skip is never a pass.

## Criterion to tests

The ID is `#100.` and the first 8 hex digits of the SHA-256 of the criterion's text, `- [ ] ` dropped, trimmed, white
space collapsed (`criterionId`). The issue has one criterion: "Both docs' Decided tables record build first, and a
search of the public docs and the rendered issues finds no rope, cloth or solver of ours waiting on a licensing or
patent review".

| ID | Part of the criterion | Test | On the base | Twin it fails on |
|---|---|---|---|---|
| `#100.acd6f892` | Both docs' Decided tables record build first | `criterion.test.mjs`: `AC1 … both docs' Decided tables record build first for ropes and cloth` | **fails** at its assertion: neither table has the row | `design-row-undecided`, `primitives-table-silent` |
| | a search of the public docs finds nothing of ours waiting | `criterion.test.mjs`: `AC1 … a search of the public docs finds no rope, cloth or solver of ours waiting on a licensing or patent review` | **passes**: the base holds this half | `solver-waits-on-review` |
| | a search of the rendered issues finds nothing of ours waiting | `issues.live.test.mjs`: `AC1 … (live) a search of the rendered issues finds …` | doesn't read the checkout; **passes** on the 2,160 issues of 2026-11-25 | none: no twin can change an issue |

The second test can't fail on this base for the issue's reason, since the base's docs hold that half; it is proven by
its twin alone. `BASE-FAILURE.txt` holds the runs.

## What each test means by the criterion's words

### "Both docs' Decided tables record build first"

- **The two tables** are those the issue's Design line links: `docs/technical-design.md#decided` and
  `docs/canvas-primitives.md#whats-decided-and-what-would-reopen-it`. Each anchor is resolved by the repo's own link
  reader (`outline`): a heading's slug or an `<a id>`. The section runs to the next heading of its level or higher,
  and its table's columns are named by its header row.
- **A row records build first for ropes and cloth** when its cells, less the one under `Reopens if`, name a rope and
  cloth (`rope` or `ropes`, and `cloth`), and its cell under `Decision` says `build first`: also `built`, `builds` or
  `building`, with up to two words between ("build them first"), and none of the three words before it one of not,
  never, nor, neither, rather than, instead of, without, cannot or a word ending in n't.
- The owner's row does: "Our own solver for ropes and cloth", "build first, with no licensing or patent review gating it".
- **Not asked**: the row's title, a word about the review (the second half's), or the facts the scope lists.

### "A search … finds no rope, cloth or solver of ours waiting on a licensing or patent review"

- **The public docs** are the two design docs, which must exist, and every other `.md` file directly in `docs/` and
  in the root: nine on the base. Not searched: `docs/evidence/` and `docs/spikes/`, which record past runs as written,
  and code, packs, license files and tests.
- **The rendered issues** are every issue of `windoliver/deepbuild`, open or closed, by title and body. Comments and
  pull requests are not read.
- **A text is read** (`reader.mjs`) outside fenced code and as rendered: links by their text; no tags, emphasis, code
  ticks or quote marks; lower case. A paragraph, list item or heading is one block and a table row is its cells, each
  split into sentences after `.`, `!`, `?` and `;`. A cell under a `Reopens if` header is not read: it says what would
  reopen a decision, not what waits now.
- **A sentence names a licensing or patent review** when it holds a word starting `licens`, `licenc` or `patent` and
  the word `review`, or the phrase "licensing gate", "patent gate" or "licensing or patent gate".
- **It says something waits on it** when it also holds, with no negation: wait, await, pending, held back, on hold,
  gate, block, defer, postpone, depend on, subject to, need, require, until or unless; `after` or `once` up to six
  words before the review; or the review up to six words before `before` or `first`. A sentence with a negation (no,
  not, never, nothing, none, nor, neither, without, cannot, n't) is read as denying it, unless it has the form
  "not … until", "no … before" or "can't … unless" with no review or waiting word between the two.
- **The rope, cloth or solver** is named (`rope`, `ropes`, `cloth`, `solver`, `solvers`) in that sentence, in the
  sentence before it in its block, anywhere in its table row, or, for an issue, in the title.
- So these are not waiting: the issue's and the owner's own sentences ("with no licensing or patent gate", "no
  licensing or patent review gating it", "nothing … waits on a review", the criterion itself); a Decided row on a
  patent treated as expired whose reopening names a later review; a pack's license field; a license notice.

### What the tests can't tell

- **Whose it is.** Any rope, cloth or solver counts as ours.
- **Waiting in other words**: "under review", "undecided", "to be cleared". And a wait whose sentence has a negation
  elsewhere: "Not live: our cloth solver waits on a patent review" reads as a denial.
- **A wait that is over**: "the patent review that gated our solver was dropped" reads as waiting, a false alarm.
- **A subject farther off** than the sentence before, and a review named only as "the review" or by an issue number.
- **A record in other words**: "we write it first" or "first, build" fails the first test though it says the same.
- Whether a closed issue's wait still matters: closed issues are searched as open ones are.
- Meaning beyond these word forms. A reader settles the rest by the issue's Proof, the decision and its reasoning in
  the design doc. A test that reads a correct tree wrongly is a dispute for a redraft, not an edit here.

## The twins

`twins.json` names three wrong programs for the ID. Each is one whole stand-in doc at its repo path, under 700 bytes,
labelled as planted in its first paragraph.

| Twin | Replaces | What it plants | Test it fails |
|---|---|---|---|
| `design-row-undecided` | `docs/technical-design.md` | a ropes-and-cloth row whose Decision cell decides nothing; "build first" stands only in its Question and Reopens if cells | the first, at its assertion |
| `primitives-table-silent` | `docs/canvas-primitives.md` | the table without the row, as on the base, so only one doc records it | the first, at its assertion |
| `solver-waits-on-review` | `docs/technical-design.md` | the row as the owner words it, and in the physics module "our own solver …, which is held back until a patent and licensing review clears it", over two lines | the second, at its assertion |

How they were seen to fail (`BASE-FAILURE.txt`): the base already fails the first half, so each twin was laid over a
stand-in of mine for a tree where the criterion holds, built in a scratch folder and never committed: the base's
`.md` docs with one row added to both tables in the issue's own words. Both offline tests pass on the stand-in. Each
failure was read through `scripts/proof-reporter.mjs` and judged by the rule of `atAssertion`: an `ERR_ASSERTION`
whose innermost frame is in `criterion.test.mjs`. The proof lanes themselves were not run.

## Lanes

- **`criterion.test.mjs` needs no entry** in `scripts/lanes.mjs` or the lists it imports. It is `node:test`, so the
  unit lane's Vitest lists (`alone`, `exclusive`, `ownLane`) don't apply; it reads no clock (`timed`), runs in about
  0.1 s (`slow`), and starts and writes nothing.
- **`issues.live.test.mjs` needs a `byHand` entry**, which this job didn't add, since it edits nothing outside this
  folder. `scripts/affected.mjs` already leaves `tests/acceptance/**/*.live.test.*` to a person. The proof lanes pick
  files by tag and leave out only what `byHand` lists. By the brief `gh` can't read in their copies, so the test skips
  there and the before lane reports it INCONCLUSIVE for the change that adds it, which fails `scripts/proof.mjs`;
  where `gh` can read, it passes on every copy and fails on no wrong program, as no twin can change an issue.

## Not held

- **The scope's other lines**: live ropes and cloth on Rapier's soft bodies behind the backend interface and held to
  goldens, heavier cloth baked by asset jobs, and the facts about Rapier 0.36.0. None is an acceptance criterion.
- **The private design workspace** the issues are rendered from, and issue comments.
- **Later issues**: the live test reads GitHub as it is on the day it runs.
