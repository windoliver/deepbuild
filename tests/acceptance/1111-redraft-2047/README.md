# Acceptance tests for #1111: the parallel-proof design in the repo, and budgets measured in the budget window

Written blind at base commit `2d1ec171` (main `654c560c1` with the issue's change undone: `docs/parallel-proof.md`
absent, the design's budget line as before), from the issue, the design and that base. By the brief, #1111's work is on
main, and #2047's closed-issue sweep reopened the issue because no test on main names its criteria's IDs. This folder is
that suite's blind redraft (design: Dogfooding), and its tests name the IDs. The drafting job saw no implementation: not
`docs/parallel-proof.md`, not the changed design line, not the commit or its tag, no pull request, branch or other
checkout, and nothing on GitHub. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job. There is no taste criterion.

## Sources

- **The issue**, #1111, its body as the brief gave it, and the twelve issues it calls T0–T10, #1112 to #1123, with
  their numbers, titles, states and bodies as of 2026-11-22, as the brief gave them.
- **The design**, `docs/technical-design.md` at the base: in How we know version 0 works, Criteria to tests, both ways;
  The edit guard; Wrong programs; Dogfooding; the budget line itself (`**Every task carries its own budgets.**`); and
  the Agents gaming checks row on approvals.
- **AGENTS.md.**
- **The base, for surfaces only**: `scripts/design-links.mjs`, `scripts/doc-links.mjs`, `scripts/open-issues.mjs`,
  `scripts/planned-names.txt`, `scripts/proof-approvals.mjs` (`readApprovals`), `scripts/proof-guard.mjs` (how the
  guard reads an approval's items), `scripts/proof-change.mjs` (`criterionId`, `underTestPaths`, `readChange`, `spans`),
  `scripts/proof-runs.mjs` (`twinsOf`, `prepareRuns`, `prepare`, `atAssertion`, the before lane),
  `scripts/closed-sweep.mjs`, `scripts/lanes.mjs` (`testPaths`, `alone`, `slow`, `timed`). For the house format:
  `tests/acceptance/2256-redraft-2047/`; for how other suites run the links check and make a tag,
  `tests/acceptance/910/` (helpers and criterion 1) and `tests/acceptance/1326/authenticator.mjs`.

## Run

```sh
node --test tests/acceptance/1111-redraft-2047/criteria.test.mjs
```

Node 24, `git` and `ssh-keygen` on PATH, and the checkout: Node built-ins and the checkout's own scripts only, no
`npm ci`, no build, no network, no `gh`. Five tests in one file. On the base, at a one-minute load of 74 to 94 on a
shared Mac, the file took under a second (BASE-FAILURE.txt). The tests write nothing in the checkout.

## Criteria to tests

The ID is `#1111.` and the first 8 hex digits of the SHA-256 of the criterion's text, trimmed, white space collapsed
(`criterionId` in `scripts/proof-change.mjs` and `scripts/closed-sweep.mjs`), computed from the issue's body as given.

| ID | Criterion | Test (`criteria.test.mjs`) | On the base |
|---|---|---|---|
| `#1111.19901108` | `docs/parallel-proof.md` exists, and the design-links check passes with every link from the T0–T10 issues to it resolving to a heading | `AC1 … exists, and every link from the T0–T10 issues to it resolves to a heading` | **fails**: the file does not exist |
| | | `AC1 … the design-links check, reading the T0–T10 issues, finds no link that lands on no heading` | **fails**: the check reports 15 links on no heading (those 14 and the design's own) |
| `#1111.bded4607` | `docs/parallel-proof.md` states that "in the local preflight" in an existing budget criterion is met by the budget window's record for that commit, and no open issue's criterion text is changed by this PR | `AC2 … states, under Budget windows, that "in the local preflight" in an existing budget criterion is met by the budget window's record for that commit` | **fails**: the file does not exist |
| `#1111.10d60f7c` | `docs/technical-design.md` no longer says budgets are measured in the local preflight, and the commit that changes it carries a signed approval tag under `deep/approved/` naming both files, which the guard's approval reader verifies | `AC3 … no longer says budgets are measured in the local preflight: they are measured in the scheduled budget window` | **fails**: the line says "by a benchmark in the local preflight" |
| | | `AC3 … the commit that changes the design's budget line carries a signed approval tag under deep/approved/ naming both files, which the guard's approval reader verifies` | **fails**: the design at HEAD still says it, so no commit has changed it |

## The surface

What the criteria leave open is marked *(chosen)*.

### The T0–T10 issues

`t0-t10-issues.json` is a frozen copy of #1112 to #1123 (number, title, state, body) as they read on 2026-11-22
*(chosen)*: eight of the twelve are closed, so the check's own reader, which lists open issues, would never give them,
and a live read needs the network and a sign-in in every lane's copy. A later edit to one of those issues isn't seen
here. Together they hold 14 links to `docs/parallel-proof.md`, on ten headings.

### AC1

- **Each link resolves** (first test). The links are read from the frozen bodies as the check reads an issue's links,
  with its own `prose`, `targets` and `resolve` (`scripts/doc-links.mjs`); the file must exist, and each link's anchor
  must be among the file's `anchors`, the check's own reading of GitHub's heading slugs and `<a id>`s. A link with no
  anchor resolves to no heading and fails.
- **The check passes** (second test). It runs the real `node scripts/design-links.mjs` from the checkout's root, with
  `DEEP_OPEN_ISSUES` naming the frozen file, so the check reads those twelve as its issues, and the docs' own links as
  always. *(Chosen:)* the test holds the check's verdict on links, not its exit code alone: the check also holds that
  each line of `scripts/planned-names.txt` names an open issue, and given twelve issues in place of every open one it
  reports such a line as stale (at the base, `deep waiter #1814`), which says nothing about #1111. So the test passes
  when the check exits 0 having read 12 issues, or when its `FAIL` line counts 0 links landing on no heading; it
  fails on any other count, and on output with no verdict. A check that couldn't read the issues fails the test with
  `INCONCLUSIVE:`.

### AC2

The test reads `docs/parallel-proof.md` through the check's own `outline` and takes each section whose heading's slug
names `budget-windows` (the issue's Scope puts the rule in § Budget windows), down to the next heading of its level or
above. *(Chosen:)* the doc "states" the rule when one paragraph or list item there names `in the local preflight` and
also a criterion, `met` (or `satisfied`), the budget window, a record and a commit, and doesn't say `not met`. Links
count by their text; emphasis, code ticks and case are ignored. This reads words, not meaning: a sentence that used all
those words to say something else would pass.

### AC3

- **The design's line** (first test). The issue's Scope names the words: "measured on a reference Mac by a benchmark in
  the local preflight" becomes "…in the scheduled budget window". The test takes every clause of
  `docs/technical-design.md` that starts `measured on a reference Mac`, up to the comma or full stop that ends it, and
  holds that there is at least one, that none names the local preflight, and that each says `in the scheduled budget
  window`. The design's other mentions of the local preflight (property tests, the kits, the trace lane) aren't budgets
  being measured and aren't read.
- **The commit and its tag** (second test), read from this checkout's git history and tags:
  - *The commit that changes it (chosen):* the newest commit in HEAD's history that takes the words "measured on a
    reference Mac by a benchmark in the local preflight" out of `docs/technical-design.md`
    (`git log -1 -S… HEAD -- docs/technical-design.md`, checked to hold the file without them).
  - *Carries a tag:* an annotated tag under `refs/tags/deep/approved/` whose target is that commit.
  - *Which the guard's approval reader verifies, naming both files:* the checkout's own `readApprovals`
    (`scripts/proof-approvals.mjs`) is given that commit and the merge base, and the items it returns for the commit
    must name `docs/technical-design.md` and `docs/parallel-proof.md` (an item names the file before any ` › `, as
    the guard reads it). So the signature is checked by `ssh-keygen` against `.deepbuild/approvers` as the merge base
    holds it, by a key of a type that needs a touch, with a touch.
  - *The merge base (chosen):* where the commit's branch left the line it was merged into: the merge base of the commit
    and the first parent of the oldest commit on HEAD's first-parent line that descends from it; the commit's own
    parent when it sits on that line itself.
  - What can't be read fails with `BLOCKED:`, never passes and never fails at an assertion: no git history, a shallow
    clone, no commit in history that takes the words out, no tag at all under `deep/approved/` in the checkout (tags
    not fetched), no merge base, no `ssh-keygen`.

So for the tests to pass, the checkout needs main's history back to the commit and its merge base, and the
`deep/approved/` tags fetched. The proof lanes' copies get the repository's refs and objects (`prepare` in
`scripts/proof-runs.mjs`), so a repository that holds the tag gives it to them.

## The wrong programs

- **The base.** `2d1ec171` has no `docs/parallel-proof.md` and the old budget line. All five tests fail there at an
  assertion (BASE-FAILURE.txt).
- For the proof lane, where main is the merge base and holds the criteria, `twins.json` maps each ID to its twins.
  Each replaces one file whole.

| Twin | For | What it plants | Fails |
|---|---|---|---|
| `heading-renamed` | `#1111.19901108` | `docs/parallel-proof.md` with every heading the issues link but one: the budget windows heading without "(owner decision 2026-11-02)", so #1116's link lands on no heading. It holds the reading rule. | both AC1 tests |
| `criteria-reworded` | `#1111.bded4607` | `docs/parallel-proof.md` with every heading, whose Budget windows section has the existing criteria reworded instead of giving the reading rule | the AC2 test |
| `half-reworded` | `#1111.10d60f7c` | a short `docs/technical-design.md` whose budget line says "in the local preflight and again in the scheduled budget window" | the first AC3 test |
| `approves-misread` | `#1111.10d60f7c` | `scripts/proof-approvals.mjs` as the base holds it, reading a tag's items from `Approved:` lines, so the reader gives no item for the tag | the second AC3 test |

The second AC3 test reads git history and a tag, which no file laid over a checkout changes, so its twin is a wrong
approval reader: it shows the test takes its answer from `readApprovals`, not from the tag's presence. The drafting job
couldn't run the twins over the implementation, which it never saw; BASE-FAILURE.txt records what it ran instead.

## Not held

- **"No open issue's criterion text is changed by this PR"** (AC2's second clause). No test holds it. The pull request
  is merged; what it did not do to some 256 issues' text can't be read from a checkout, and reading it from GitHub
  would need each issue's edit history as of the merge. Diff review of the pull request is its proof, as the issue's
  Proof says.
- **"The design-links check passes" as an exit code of 0 over every open issue.** The second AC1 test gives the check
  the twelve T0–T10 issues only and holds its count of links on no heading (The surface, AC1).
- **That the doc means the rule**, beyond the words above; and the rest of the Scope (the doc's sections, the dropped
  review history, "no code, no test, no lane change"), which no criterion names.
- **That the tag was on the commit when the pull request merged.** The test reads the tag the checkout holds now.

## Lanes

No `scripts/lanes.mjs` entry is needed. The file is `node:test`, so `alone` (Vitest files) doesn't apply; it runs in
under a second, so it isn't `slow`; no verdict reads the load or a clock, so it isn't `timed`.

## Files

- `criteria.test.mjs`: the five tests.
- `t0-t10-issues.json`: the frozen T0–T10 issues.
- `twins.json` and `twins/`: the planted wrong programs.
- `BASE-FAILURE.txt`: the run on the base, and the scratch runs on a stand-in and on each twin.
