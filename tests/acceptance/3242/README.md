# Acceptance tests for #3242: what a project learns and audits

These tests were drafted blind from issue #3242 (its body as saved on November 24), the six design sections it links
in `docs/technical-design.md` with those they lean on (Decisions' opening lines, Socket roles and contract versions,
Decision and rule, An ask, and the rules for a suite in How we know version 0 works), AGENTS.md, CONTRIBUTING.md and
the base commit `7cb1e5c4a` (origin/main on November 24, no implementation). I also read the bodies of the four issues
criterion 3 names as saved that day and, for context, #1336, #62 and #1340 with their comments. The saved bodies'
SHA-256:

| Issue | SHA-256 of its body on November 24 |
|---|---|
| #3242 | `8b26ab18e43a8da8823a8fc2c161c032d8caaeab37764d602777f20495bb825b` |
| #726 | `deab5534d0e2c02c8526fe8b5c682456873fdc19748550a1e9b188c4a3185480` |
| #109 | `da28a05aa5e9f8ddae3ac7eb521d9a80c2f1168ea13798b0e61eeabee28517d5` |
| #1567 | `2c2a1b8d866d500764a4642658dc92d60dd3440fbca87245dc869fffade6f6f3` |
| #1568 | `6857d13f901ca4e3be537f79aa6e83c3325c5871d3a9b2ea56fc746adee8504d` |

At the base I read `scripts/doc-links.mjs`, `scripts/design-links.mjs`, `scripts/principles.mjs`,
`scripts/catalogue-drift.mjs`, `scripts/public-text.mjs`, `scripts/open-issues.mjs`, `scripts/lanes.mjs` (the doc
lanes' entries), `scripts/doc-ceilings.mjs` with its JSON, `scripts/design-section.mjs`, `scripts/proof-change.mjs`
(`criterionId`, and how a test's name is read) and `scripts/closed-sweep.mjs`, and for conventions
`tests/acceptance/1336/` and `tests/acceptance/1352/` with `docs/evidence/1336/taste-call.json`,
`docs/evidence/1352/taste-call.json` and `docs/evidence/2063/live-doc-lanes.txt`. What the helpers need from those is
copied, never imported. I did not see the work, another checkout or another git ref, and read GitHub only by running
the three live files once at the base. Per AGENTS.md, the implementing agent doesn't edit these tests; a dispute goes
to a blind redraft by this job.

The issue is design-only: its Scope ends "Not in this task: any code", and its Proof is "The design change and its doc
lanes". The suite needs no line outside this folder.

## How to run them

```sh
node --test tests/acceptance/3242/ac1-project-hub.test.mjs        # offline: criterion 1
node --test tests/acceptance/3242/ac2-three-places.test.mjs       # offline: criterion 2, the three places
node --test tests/acceptance/3242/ac4-taste-call.test.mjs         # offline: criterion 4, the call
node --test tests/acceptance/3242/ac2-doc-lanes.live.test.mjs     # live: criterion 2, the doc lanes
node --test tests/acceptance/3242/ac3-issue-links.live.test.mjs   # live: criterion 3
node --test tests/acceptance/3242/ac4-told.live.test.mjs          # live: criterion 4, the others
node --test 'tests/acceptance/3242/*.test.mjs'                    # all seven tests, the live ones included
```

They're plain `node --test` files on Node built-ins (Node 24) and need no build, with one exception below. Criterion
1's file, the taste call's and the doc lanes test need the checkout to hold the base commit `7cb1e5c4a`, which they
read with git. The three `*.live.test.mjs` files read GitHub through `gh`, so they need network and `gh` signed in
with read access to `windoliver/deepbuild`. Signed out, offline, or when an issue can't be read, a live test skips
with a message starting `INCONCLUSIVE:`, unless something it could read already fails it; a skip is never a pass. The
doc lanes test also needs `origin/main` to diff against and, for the catalogue drift lane, `packages/contracts/dist`
(`npm ci && npm run build -w @deepbuild/contracts`). Without that build it still runs the other two lanes and fails
on what they find, and otherwise skips as `INCONCLUSIVE:`, naming the lane.

## The surface (my choice where the issue leaves it open)

Names marked **yours** are what the implementer, or the person who makes the taste call, provides, spelled as the
tests read them.

- **One hub for a project** is the section the anchor `project-hub` lands on, as the issue's Design line links it and
  as the design links lane resolves it (`node scripts/design-section.mjs docs/technical-design.md#project-hub` prints
  it). It runs to the next heading of its level or higher, so subheadings added under it belong to it and a new
  heading beside it doesn't. The other sections are found the same way, by the anchors the issue links:
  `the-learned-layer`, `how-we-know-version-0-works`, `later-as-extensions` and `decided`.
- **A line** of a section is a list item without what is nested under it, a paragraph, or a table row, outside fenced
  code. Physical lines that continue an item or a paragraph belong to it, so a wrapped line reads as one. Words are
  matched whole and without case, across a wrap.
- **The words** an answer to each Scope decision has to use (`…` is any ending; a word without it counts in its
  plural too and in no other form, so `quoted` isn't `quote`):

  | Decision | Words |
  |---|---|
  | Who is audited | `audit…` |
  | Whose answers make a rule | `rule`, `answer…`, and `offer…` or `three` |
  | Where a quote is checked | `quote` |
  | Who a habit belongs to | `habit` |

  That is a floor for a text a person also judges (criterion 4), never a reading of the text. At the base no line of
  the section holds any decision's words.
- **A decision is answered** (**yours**: four lines of One hub for a project) by a line of that section that holds
  the decision's words and says `Not taken`, the design's phrase for it. No `Not taken` counts for two decisions: a
  line that answers two says it twice. Example of one line, as the section's six write theirs:
  `- **Who is audited.** <the answer, with the word audit> Not taken: <what was not taken>.`
- **The Decided tables** are the tables headed `Question | Decision | Reopens if` anywhere in the section that holds
  the heading `decided` lands on (`## Decisions`): under `### Decided` and `### Decided for a hosted hub` at the base,
  119 rows, and under any heading the work adds there. A row is **gained** when no Decided row at the base has its
  question (its first cell, compared without case and extra spaces). **Yours**: gained rows that between them hold
  each decision's words; one row may hold two decisions. Example:
  `| <a question no row asks at the base> | <the decision, with the word habit>. Not taken: … | <what reopens it> |`
- **The three places** each name a project's hub on one line, holding the whole words `project` and `hub` (possessive
  or plural too, in prose or in a link such as `[One hub for a project](#project-hub)`). **Yours**: such a line in
  The learned layer (any line of the section); on a line of How we know version 0 works that holds `audit…` (one at
  the base, under Dogfooding); and on a line of Later, as extensions that holds `taste rule` or `taste-rule` (one at
  the base, its second list item). At the base none of those lines holds both words.
- **The doc lanes** are the three CONTRIBUTING.md names: catalogue drift, design links and names, and public text.
  Each runs its own `commands` from `scripts/lanes.mjs` in this checkout against one fetch of the open issues
  (`gh issue list --state open --limit 5000`, handed over in `DEEP_OPEN_ISSUES`). A lane passes, or every finding it
  prints (line numbers dropped) is also printed when the same commands read the base commit's files against the same
  issues; public text scans the change, so it has no baseline and must pass. Why a baseline, and why not `runLanes`,
  is in `tests/acceptance/1336/README.md`. The test first requires the new text: the four decisions answered and the
  three places named.
- **A link into the new text** (**yours**: one in the body of each of #726, #109, #1567 and #1568) is a
  `technical-design.md#<anchor>` link whose anchor lands in One hub for a project once that section answers the four
  decisions: `project-hub`, the heading's slug, a subheading's slug, or an `<a id>` set inside the section. Example,
  on an issue's Design line:
  `[One hub for a project](https://github.com/windoliver/deepbuild/blob/main/docs/technical-design.md#project-hub)`
- **The taste call** (**yours**: the file `docs/evidence/3242/taste-call.json`) is recorded in the shape the project
  used for #1336's and #1352's:

  ```json
  {"criterion": "#3242.28fd1eed", "who": "the person, and how they came to make the call",
   "when": "2026-11-25T18:04:00Z", "call": "reads_right",
   "text": {"file": "docs/technical-design.md", "sha256": "<64 hex digits, see below>"}}
  ```

  `when` is an ISO 8601 time with its zone. `sha256` is the SHA-256 of **the text**: the lines the tests above read,
  in the order the design holds them, each as the file holds it, joined with `\n`, with no final newline. Those are
  each line of One hub for a project that holds a decision's words, each line of the three places that names a
  project's hub, and each gained Decided row that holds a decision's words. This prints them, then the hash:

  ```sh
  node -e "import('./tests/acceptance/3242/helpers.mjs').then(({ theText }) => { const { lines, sha256 } = theText(); console.log(lines.join('\n')); console.log(sha256); })"
  ```

  So a call can't outlive an edit to a line it was made on, and an edit to any other line leaves it standing. Other
  fields, such as `by`, `note` or `text.anchor`, are free.
- **Telling the others** (**yours**: a comment on #3242) is done as it was for #1336 and #1352, by a comment on the
  issue. The test reads `gh issue view 3242 --json comments` for a comment whose body holds `#3242.28fd1eed` and
  `overrul…`, created at or after the record's `when`. Example: "AC4 `#3242.28fd1eed`: the taste call is recorded in
  `docs/evidence/3242/taste-call.json`. This comment tells the others on the project, and anyone can overrule it
  here."

## Criteria and tests

Each ID is `criterionId` from `scripts/proof-change.mjs`, computed from the saved body: `#3242.` and the first 8 hex
of the SHA-256 of the `- [ ]` text, trimmed, white space collapsed. Every test name starts with `AC<n>` and its ID.

| Criterion | ID | Tests, and what fails each |
|---|---|---|
| 1. One hub for a project answers each decision above, with what was not taken, and the Decided table gains its rows | `#3242.7fbbc69e` | `ac1-project-hub.test.mjs`, two tests. The section: a decision with no line holding its words, a line that holds them without `Not taken`, two decisions sharing one `Not taken`, or the decisions written outside the section. The Decided tables: no gained row, a decision no gained row holds, or the words added to a row the base already has |
| 2. The learned layer, the audit lines in How we know version 0 works and the taste-rule line in Later, as extensions each say what holds on a project's hub, and no line of the design contradicts the new text: the doc lanes pass | `#3242.a55ec11a` | `ac2-three-places.test.mjs` (offline): any of the three places with no line that names a project's hub. `ac2-doc-lanes.live.test.mjs` (live): the new text missing, or a lane finding the base's files don't give, such as a link to an anchor the change dropped |
| 3. #726, #109, #1567 and #1568 each link into the new text | `#3242.4156bcc2` | `ac3-issue-links.live.test.mjs`: the section without the four answers, or any of the four bodies with no link that lands in it |
| 4. One taste call on the text, by any one person on the project. The others are told, and can overrule it | `#3242.28fd1eed` | `ac4-taste-call.test.mjs` (offline): no record, another criterion, no person, no time with a zone, a call other than `reads_right`, or a hash of other text. `ac4-told.live.test.mjs` (live): no record, no comment on #3242 with the ID and `overrul…`, or only comments older than the call |

## Readings, where the issue and the design leave a choice

1. **What was added to a section that exists.** #1336's and #1352's suites found one new section by its heading's
   words. Here the section is there at the base, so the suite finds it by the anchor the issue links and reads what
   answers the four decisions, by their words. It counts no `Not taken` over the whole section, which would pin the
   six the base holds; later issues edit them.
2. **One line per answer.** "Each with what was not taken" is read on the line that answers, as the section's six
   decisions each hold their own. A `Not taken` in a list item nested under the answer, or in a table's header, is
   not on that line and doesn't count.
3. **"The Decided table gains its rows."** #1336's and #1352's tests need more rows under the heading slugged
   `decided` than at the base. That can't be met here: `### Decided` is at its size ceiling of 66,647 bytes
   (`scripts/doc-ceilings.json`, where a ceiling never rises), and since #3138 the Decisions section holds a second
   table with the same columns. So the table is read as every table with those columns under Decisions, and a row is
   gained by its question, not by a count, so moving or rewording older rows neither helps nor hurts. "Its rows" is
   read as rows for the four decisions, since each is new and Decisions' opening line says every question is decided
   below with what would reopen it. It isn't read as four rows: #1352's eight decisions got seven.
4. **"Say what holds on a project's hub"** is read as the least code can read: the place names a project's hub. What
   it says there is the taste call's. "The audit lines" is read as the lines of the section that name an audit, one of
   which has to name a project's hub, not every one; "the taste-rule line" as a line that names taste rules.
   `### Later, as extensions` is also at its ceiling (18,735 bytes), so its line may move under a subheading of that
   section and still be found.
5. **"No line of the design contradicts the new text: the doc lanes pass"** is read as #1336's suite reads it: the
   lanes find nothing the change brings. Two things differ from that suite at this base. Its base folder held only
   `docs/**/*.md` and `scripts/planned-names.txt`, and the design links lane now also reads AGENTS.md and asks
   whether each script the Principles name is a file, while catalogue drift reads `scripts/not-event-kinds.txt`; so
   the base folder here holds each `docs/*.md`, AGENTS.md and both lists at the base, with this checkout's other
   scripts linked in. And that suite skipped whole when the contracts build was missing; here the lanes that can run
   still run, and a finding fails before anything is INCONCLUSIVE.
6. **"Link into the new text."** Each of the four issues links The learned layer today, #726 also How we know version
   0 works and #109 also Later, as extensions, so a link to a section that holds some new line would pass with no
   issue edited. The link is read as landing in One hub for a project, where criterion 1 puts the answers, as
   #1337 to #1340 link `project-hub` for #1336. No new anchor is required; one set inside the section counts.
7. **The text a call is bound to.** #1336's and #1352's records hash one section whole and name its anchor. This
   text is lines in five sections that other issues edit too, so the hash covers the lines the criteria name and
   nothing beside them, and no one anchor names it, so `text.anchor` isn't read.
8. **"The others are told."** #1352's test read the record's own `note` for the words `told` and `overrul…`. That is
   the word of whoever wrote the record, and invariant 1 says an agent's word is never evidence, so this suite reads
   the comment instead and leaves the note free. A comment made before the recorded call can't tell of it, so after a
   call is made again the others are told again.

## Not asserted

- Whether what the design says is right, complete, or contradicted by another line in meaning; whether a decision's
  words sit in its answer or in what was not taken; whether a gained row says what its section says. Code can't read
  those; criterion 4's reader covers them.
- Privacy, which the issue links and no criterion names, and the three "Not in this task" lines (any code, a model of
  one person built from another's record, who may answer which ask): no criterion would carry a test for them.
- The doc ceilings and the edit guard. Neither is one of the doc lanes, and no criterion names them. The work still
  has to meet both: `### Decided` and `### Later, as extensions` can't grow by a byte, and a row under Decisions
  passes only as its own approved proposal.
- That `who` is a person on the project, that anyone read the comment, and that an overrule is possible or happened.
  The comment is where an overrule would be made; an overrule that changes the text makes the record's hash stale.
- Anything in the four issues but the link, and anything in a comment but the ID, the word and its time.

## On the base

All four offline tests fail on `7cb1e5c4a` for the expected reasons, and the live tests fail on the base and on GitHub
as it was on November 24. See `BASE-FAILURE.txt`, which also lists the planted texts, bodies, records and comments
each judge passed and failed, run from a scratch folder against the judges `helpers.mjs` exports and never written
into this checkout.
