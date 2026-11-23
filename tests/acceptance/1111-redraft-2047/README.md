# Acceptance tests for #1111, blind redraft for the closed-issue sweep (#2047): docs/parallel-proof.md and the design's budget line

Written blind at base commit `2d1ec171` (in it `docs/parallel-proof.md` is absent and the design's budget line reads
"in the local preflight"), from the issue, the design and that base. By the brief, the sweep over closed issues
(`scripts/closed-sweep.mjs`, #2047) reopened #1111 because no test names its three criteria; it holds a criterion only
when a code file under the test paths names its ID. This folder names and holds them. The drafting job saw no work
that implements the issue: no other commit, branch, worktree or pull request, and nothing on GitHub. The implementing
agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).
There is no taste criterion.

## What was read

- **The issue**, #1111, its body as the brief gave it on 2026-11-22: scope, the three criteria, Proof. And the twelve
  issues it calls T0–T10, #1112 to #1123, their bodies and states as of that day (four open, eight closed).
- **The design**, `docs/technical-design.md`: Every task carries its own budgets (the line the issue changes, at line
  2559 of the base, not the issue's 2418); in How we know version 0 works, Criteria to tests, both ways, The edit guard
  and Dogfooding. **AGENTS.md.**
- **The base, for surfaces only**: `scripts/design-links.mjs`, `scripts/doc-links.mjs`, `scripts/open-issues.mjs`,
  `scripts/planned-names.txt`, `scripts/closed-sweep.mjs`, `scripts/proof-change.mjs` (`criterionId`, `underTestPaths`,
  `isTestFile`), `scripts/proof-runs.mjs` (`twinsOf`, `prepareRuns`, `atAssertion`, `frames`, `runTests`),
  `scripts/proof-reporter.mjs`, `scripts/lanes.mjs` (`testPaths`, `alone`), the head of `scripts/public-text.mjs`; and
  for the house format `tests/acceptance/2256-redraft-2047/` and the README of `2513-redraft-2047/`.
- One thing outside that list: a search of `docs/` for the new doc's name also printed a line of
  `docs/evidence/2047/first-run.txt`, an earlier sweep's line on #1111 with three criterion IDs. Two of them differ
  from the IDs below, so the issue's text has changed since; the IDs here are computed from the text as the brief gave it.

## Run

```sh
node --test tests/acceptance/1111-redraft-2047/criteria.test.mjs
```

Node 24 and the checkout, Node built-ins and the repo's own `scripts/doc-links.mjs`: no `npm ci`, no build, no
network, no `gh`. Five tests, about a tenth of a second together on the base. The first runs
`node scripts/design-links.mjs` twice from the checkout's root, each bounded at two minutes, with its open issues in a
temporary folder outside the checkout that the test removes. Nothing is written in the checkout.

## Criteria to tests

The IDs are `#1111.` and the first 8 hex digits of the SHA-256 of each criterion's text, `- [ ] ` dropped, trimmed,
white space collapsed (`criterionId` in `scripts/proof-change.mjs` and `scripts/closed-sweep.mjs`).

| ID | Criterion | Test in `criteria.test.mjs` | On the base |
|---|---|---|---|
| `#1111.19901108` | `docs/parallel-proof.md` exists, and the design-links check passes with every link from the T0–T10 issues to it resolving to a heading | `AC1 … the design-links check passes on the twelve T0–T10 issues, having read all twelve and checked every link of theirs into docs/*.md` | **fails**: the check exits 1, `FAIL 15 links into docs/*.md land on no heading`, each `(docs/parallel-proof.md does not exist)` |
| | | `AC1 … docs/parallel-proof.md exists and every link to it from the twelve T0–T10 issues resolves to a heading` | **fails**: the file does not exist |
| `#1111.893a5670` | `docs/parallel-proof.md` states that "in the local preflight" in an existing budget criterion is met by the budget window's record for that commit | `AC2 … states that "in the local preflight" in an existing budget criterion is met by the budget window's record for that commit, and nowhere that it is met another way` | **fails**: the file does not exist, so it states nothing |
| `#1111.9ef2c17c` | `docs/technical-design.md` no longer says budgets are measured in the local preflight: it says they are measured in the scheduled budget window | `AC3 … no longer says budgets are measured in the local preflight` | **fails**: one sentence still says it, "… measured on a reference mac by a benchmark in the local preflight, and compared with the merge base." |
| | | `AC3 … says budgets are measured in the scheduled budget window` | **fails**: no sentence says it |

`BASE-FAILURE.txt` holds the base's output whole, with the load.

## What each test means by its criterion's words

### AC1: the check, and the links

**Where the twelve issues come from: a frozen copy.** `fixtures/t0-t10-issues.json` holds #1112 to #1123, number and
body, as the brief gave them on 2026-11-22, in the shape `gh issue list --json number,body` gives. The check reads only
open issues, and eight of the twelve were closed that day, so a live run would never read their links; and a test that
calls GitHub can't run in a proof copy. The tests therefore read all twelve as open, from the copy. A later edit of
one of those issues on GitHub is not seen here.

**The check** is `node scripts/design-links.mjs`, by the Node that runs the suite, from the checkout's root, with
`DEEP_OPEN_ISSUES` naming a file of open issues: the surface `scripts/open-issues.mjs` gives a run. That file holds the
twelve and, for each line `<name> #<issue>` of the checkout's `scripts/planned-names.txt` whose issue is not one of the
twelve, one issue of that number whose body is the planned name in code. Without them the check fails on every planned
name ("#1814 is not an open issue that names it" on the base), which is the copy's doing, not the tree's. This makes
the check's planned-names half pass by construction; this suite holds nothing about it.

**Passes** is all of:

- the check exits 0;
- no line of its output says the open issues were not read (`INCONCLUSIVE …`, "the open issues were not read", "could
  not read/fetch …"): then the test fails with a message starting `INCONCLUSIVE:`, whatever the exit code;
- its passing line counts `<n> links checked from <d> docs and <m> open issues`, and `<m>` is the twelve plus the planned
  names' issues. An exit of 0 without that line fails `INCONCLUSIVE:`;
- the same check run without the twelve counts fewer links by exactly the number of links into `docs/*.md` that the
  repo's own link reader (`prose`, `targets`, `resolve` in `scripts/doc-links.mjs`) finds in the twelve bodies, 15 in
  the copy. So a check that listed the issues and skipped their links fails. If that second run doesn't pass, the test
  fails `INCONCLUSIVE:`.

The check fails on any broken link, the design docs' own included, and on any `deep` command a T0–T10 issue names that
the design doesn't hold; the test fails with it, since the criterion asks that the check pass.

**Every link resolving to a heading** is the second test, without the check: each of the 14 links from the twelve
issues that the repo's reader resolves to `docs/parallel-proof.md` names an anchor that the repo's `anchors` maps to a
heading of that file: a heading's own GitHub slug, or an explicit `<a id>` that belongs to one, as the check accepts.
The ten anchors linked are `3-placement-what-runs-where`,
`4-build-reuse-fixed-path-workspaces-not-relocated-targets`, `5-proof-run-cost-cuts-inside-one-run`,
`6-scheduling-a-per-machine-throttle-table`, `7-the-alone-block-split-by-reason`, `8-remote-lanes`,
`9-hygiene-do-first-no-design-needed`, `10a-open-owner-decision-gates-t9`, `12-rollout-and-proof-of-each-step` and
`12a-budget-windows-owner-decision-2026-11-02`. If the copy isn't #1112 to #1123, or one of them has no link to the
doc, both tests fail with a message starting `BLOCKED:`.

### AC2 and AC3: what a document says

Both read a doc **sentence by sentence**: the lines outside fenced code, joined into paragraphs, list items, headings
and table rows; links read by their text; emphasis, code ticks and quote marks dropped; lower case; split after `.`,
`!`, `?` and `;`. A **negation** is one of not, never, no longer, nor, neither, rather than, instead of, or a word
ending in n't.

**AC2.** A sentence states the rule when it holds, in this order, `in the local preflight`, then `met by`, then
`commit`; names `budget window` and `record` between `met by` and `commit`; names a `criterion` (or `criteria`) and a
`budget` other than in "budget window"; and has no negation from `in the local preflight` to `commit`. The issue's own
wording does: *an existing budget criterion that says "in the local preflight" is met by the scheduled budget window's
record for its commit*. The test asserts that `docs/parallel-proof.md` exists, that at least one sentence states the
rule, and that no other sentence holding both `in the local preflight` and `met`/`meets` fails to state it: the rule
reversed, or an old rule left standing beside it, fails.

**AC3.** A sentence says something is measured in a place when it holds `measured`, then the place, with no negation
between them or in the three words before `measured`. It is about budgets when its paragraph names a `budget` other than
in "budget window". The first test asserts that no such sentence of `docs/technical-design.md`, anywhere in the
document, says measured `in the local preflight`. The second asserts that at least one says measured `in the scheduled
budget window`. The issue's own wording does both: "measured on a reference Mac by a benchmark in the local preflight"
becomes "… in the scheduled budget window".

**Wording these assume, and what they can't tell.**

- The passive "met by" and the word "measured", as the criteria and the issue's scope write them. "The window's record
  meets such a criterion", "is satisfied by", "are timed in" or "the benchmark runs in" would fail these tests though
  they say the same; that is a dispute for a redraft, not an edit here.
- The exact phrases `in the local preflight` and `in the scheduled budget window`. A link over part of a phrase is
  read by its text; a phrase broken by other words is not found.
- The rule in one sentence. A rule spread over two sentences, or over a sentence and a list, is not found.
- A denial the negation list doesn't name ("it is false that …", "fails to be", "seldom"), one more than three words
  before `measured`, or one in another sentence ("The next sentence is wrong.") is read as the statement.
- A condition after the rule ("… for its commit, but only once a person signs it") is not seen.
- A sentence that says the old thing in other words ("the local preflight's benchmark sets each budget's reading") is
  not found by the first AC3 test.
- "Existing" and "that commit": the tests ask for a criterion, a record and a commit in the sentence, not that the
  criterion is called existing or that the commit is the one the criterion judges.
- Text inside fenced code is not read, so a statement there neither counts nor offends.

## The twins

`twins.json` maps each ID to its wrong programs. Each is one whole replacement file at its repo path, short and
labelled in its first paragraph as planted. The `docs/parallel-proof.md` twins share one body, the ten headings above
and the rule in the issue's words, and differ only where planted; the `docs/technical-design.md` twins are a stub of
the design holding only the budgets paragraph's first sentences, so only the AC3 tests are to be read on them (the
check itself fails on a stub design, for the stub's reasons).

| Criterion | Twin | What it plants | Tests it fails |
|---|---|---|---|
| `#1111.19901108` | `headings-retitled` | `docs/parallel-proof.md` with tidy section titles (`## 3. Placement`, `## 12a. Budget windows`, …), so 13 of the 14 links land on no heading | both AC1 tests |
| | `decisions-folded` | section 10a's open decisions as a paragraph of section 10 with no heading, so #1115's link to `#10a-open-owner-decision-gates-t9` lands nowhere | both AC1 tests |
| `#1111.893a5670` | `rule-reversed` | the rule's words saying the opposite: "… is not met by the scheduled budget window's record for its commit: it still needs its benchmark run in the local preflight" | the AC2 test, at its second assertion |
| | `rule-contradicted` | the rule in section 12a, and in section 12 "… is met only by its benchmark's run in the local preflight of its change" | the AC2 test, at its third assertion |
| `#1111.9ef2c17c` | `both-statements` | the new sentence added, the old one left standing | AC3 "no longer says" |
| | `release-preflight` | "by a benchmark in the release preflight": the old statement gone, the window not named | AC3 "says … the scheduled budget window" |
| | `window-denied` | "by a benchmark in the local preflight, never in the scheduled budget window" | both AC3 tests |

What was run to see them fail (`BASE-FAILURE.txt`, last part): a stand-in for a correct tree, built outside the
checkout and never committed, of the base's `scripts/` and `docs/*.md` with a short `docs/parallel-proof.md` (the
shared body) and the design's line changed as the issue's scope writes it. All five tests pass on it. Each twin's
file was copied over it for one run, read through `scripts/proof-reporter.mjs`, and each failure judged by
`scripts/proof-runs.mjs`'s own `atAssertion`: every failure in the table is an `AssertionError [ERR_ASSERTION]` thrown
in `criteria.test.mjs`. The proof lanes themselves (`prepareRuns`, bays, the guard) were not run. Seen there too, by
replacing the stand-in's `scripts/open-issues.mjs`, never committed: a check that reports the issues unread fails the
first test with `INCONCLUSIVE:` and not at an assertion; one given no issues, or the twelve without their bodies,
fails it at an assertion.

## Lanes

No `scripts/lanes.mjs` line is needed. The file is `node:test`, not Vitest, so the unit lane's `alone` list doesn't
apply; it reads no clock, so it isn't `timed`; it runs in a fraction of a second, so it isn't `slow`.

## Not held

- **The live issues.** Whether #1112 to #1123 on GitHub still link what the frozen copy links, and what the check says
  on a run that fetches the open issues with `gh`. No test here calls GitHub.
- **The check's planned-names half**, passed by construction (above).
- **The scope's list of sections** (capacity, invariants, issue shaping, the review-round history dropped), "no code, no
  test, no lane change", and the signed approval tag naming both files: none is an acceptance criterion; the tag is the
  guard's to read.
- **That the reading rule sits in the Budget windows section**: the criterion asks that the doc state it, and the test
  reads the whole doc.
- **Meaning beyond the wording above**: the tests read words in an order, not sense. A reader settles the rest by
  diff review, which the issue's Proof line names.

## Files

- `criteria.test.mjs`: the five tests.
- `fixtures/t0-t10-issues.json`: the frozen copy of #1112 to #1123.
- `twins.json`, `twins/`: the planted wrong programs.
- `BASE-FAILURE.txt`: the run on the base, on the stand-in and on each twin laid over it.
