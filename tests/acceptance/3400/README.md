# Acceptance tests for #3400: what a project's audit and pages still leave open

These tests were drafted blind from issue #3400 (its body as saved on November 25), the four design sections it links
in `docs/technical-design.md` (One hub for a project, The learned layer, How we know version 0 works, Decided) with
those they lean on (Decisions' opening lines, and the rules for a suite in How we know version 0 works), AGENTS.md,
CONTRIBUTING.md and the base commit `d0030e12ba9b71ab37aafba73c5633989d36530f`. That commit is the head of the branch
of pull request #3365 (`Closes #3242`, open that day). It holds the text #3242 wrote and is not on `origin/main` yet,
as the issue says itself: "The text #3242 wrote is in #3365 until that merges." So the criteria are read against the
design as that commit holds it. I also read the bodies of the two issues criterion 3 names as saved that day and, for
context, #3242, #1336, #726, #3241, #1567, #1568 and #1340 with their comments. The saved bodies' SHA-256:

| Issue | SHA-256 of its body on November 25 |
|---|---|
| #3400 | `99380e41fb01b489242e728d76e1d5258152035d6bf3158c301ad68150bd9bbf` |
| #3397 | `c46415dbb32ea71d833e5a625472af8593172b3b44a5c6b7236b26cb365a6ac8` |
| #3398 | `ba65a4cb8eb44d1ac12d6109281a7d281f74e2182913fada9f2f781109acc1b1` |

At the base I read `scripts/doc-links.mjs`, `scripts/design-links.mjs`, `scripts/principles.mjs`,
`scripts/catalogue-drift.mjs`, `scripts/public-text.mjs`, `scripts/open-issues.mjs`, `scripts/lanes.mjs` (the doc
lanes' entries and `changedPaths`), `scripts/doc-ceilings.mjs` with its JSON, `scripts/design-section.mjs`,
`scripts/proof-change.mjs` (`criterionId`, and how a test's name is read) and the opening lines of
`scripts/closed-sweep.mjs` and `scripts/repo-rules.mjs`, and for conventions `tests/acceptance/3242/`,
`tests/acceptance/1336/` and `tests/acceptance/1352/` with each one's `docs/evidence/<issue>/taste-call.json`. What
the helpers need from those is copied, never imported, and each copied helper was read against this base's scripts and
run on this base's design before it was kept. I did not see the work, another checkout or another git ref, and read
GitHub only by running the three live files once at the base. Per AGENTS.md, the implementing agent doesn't edit these
tests; a dispute goes to a blind redraft by this job.

The issue is design-only: its Scope ends "Not in this task: any code", and its Proof is "The design change and its doc
lanes". The suite needs no line outside this folder.

## How to run them

```sh
node --test tests/acceptance/3400/ac1-project-hub.test.mjs        # offline: criterion 1
node --test tests/acceptance/3400/ac2-audit-lines.test.mjs        # offline: criterion 2, the audit lines
node --test tests/acceptance/3400/ac4-taste-call.test.mjs         # offline: criterion 4, the call
node --test tests/acceptance/3400/ac2-doc-lanes.live.test.mjs     # live: criterion 2, the doc lanes
node --test tests/acceptance/3400/ac3-issue-links.live.test.mjs   # live: criterion 3
node --test tests/acceptance/3400/ac4-told.live.test.mjs          # live: criterion 4, the others
node --test 'tests/acceptance/3400/*.test.mjs'                    # all seven tests, the live ones included
```

They're plain `node --test` files on Node built-ins (Node 24) and need no build, with one exception below. Every file
but `ac4-told.live.test.mjs` needs the checkout to hold the base commit, which it reads with
`git show d0030e12ba9b71ab37aafba73c5633989d36530f:<path>`. That commit reaches `origin/main` only if #3365 merges
with its history; a checkout without it fails those tests, naming the commit, and never passes them. The three
`*.live.test.mjs` files read GitHub through `gh`, so they need network and `gh` signed in with read access to
`windoliver/deepbuild`. Signed out, offline, or when an issue can't be read, a live test skips with a message starting
`INCONCLUSIVE:`, unless something it could read already fails it; a skip is never a pass. The doc lanes test also
needs `origin/main` to diff against and, for the catalogue drift lane, `packages/contracts/dist`
(`npm ci && npm run build -w @deepbuild/contracts`). Without that build it still runs the other two lanes and fails
on what they find, and otherwise skips as `INCONCLUSIVE:`, naming the lane.

## The surface (my choice where the issue leaves it open)

Names marked **yours** are what the implementer, or the person who makes the taste call, provides, spelled as the
tests read them. Where #3242's suite already read a surface and that reading still holds at this base, this suite
reads it the same way; where it reads one differently, Readings says why.

- **One hub for a project** is the section the anchor `project-hub` lands on, as the issue's Design line links it and
  as the design links lane resolves it (`node scripts/design-section.mjs docs/technical-design.md#project-hub` prints
  it). It runs to the next heading of its level or higher, so subheadings added under it belong to it and a new
  heading beside it doesn't. The learned layer is found the same way by `the-learned-layer`, and the Decided tables by
  `decided`.
- **A line** of a section is a list item without what is nested under it, a paragraph, or a table row, outside fenced
  code. Physical lines that continue an item or a paragraph belong to it, so a wrapped line reads as one. Words are
  matched whole and without case, across a wrap. An issue's body is read in the same lines.
- **The words** an answer to each Scope decision has to use, taken from that decision's Scope line:

  | Decision | Words |
  |---|---|
  | What a miss freezes | `freez…` or `frozen`, and `audit…` or `miss` |
  | Whose count | `audit…`, and `count…`, `30` or `50` |
  | When an unshared claim reaches the project | `claim`, and `unshared` or `nobody shared` |

  `freez…` and `audit…` take any ending; `frozen` is also `froze`; `count…` is `count`, `counts`, `counted` or
  `counting`; `miss` and `claim` count in their plural too; `30` and `50` are those numbers alone, not part of a
  longer one; `nobody shared` is the two words in a row. That is a floor for a text a person also judges (criterion
  4), never a reading of the text: it holds no word of an answer, so a call that takes what the draft didn't
  recommend still meets it. At the base no line of the section holds any decision's words.
- **A decision is answered** (**yours**: lines of One hub for a project) by a line of that section that holds the
  decision's words and says `Not taken`, the design's phrase for it. No `Not taken` counts for two decisions: a line
  that answers two says it twice. Example of one line, as the section's ten write theirs:
  `- **What a miss freezes.** <the answer, with freezes or frozen and audit or miss> Not taken: <what was not taken>.`
- **The Decided tables** are the tables headed `Question | Decision | Reopens if` anywhere in the section that holds
  the heading `decided` lands on (`## Decisions`). At the base those are 112 rows under `### Decided`, 4 under
  `### Decided for what a project learns and audits` and 7 under `### Decided for a hosted hub`; a table under any
  heading the work adds there counts too. A row is **gained** when no Decided row at the base has its question (its
  first cell, compared without case and extra spaces). **Yours**: gained rows that between them hold each decision's
  words; one row may hold two decisions. Example:
  `| <a question no row asks at the base> | <the decision, with 30 or 50 and audit>. Not taken: … | <what reopens it> |`
- **The learned layer's audit lines** are the lines of The learned layer that hold `audit…`: two at the base, its
  item Judged after it applies, which holds the audit that keeps running, and its last item, On a project's hub. A
  line **names a project's hub** when it holds the whole words `project` and `hub` (possessive or plural too, in
  prose or in a link such as `[One hub for a project](#project-hub)`). A line's **sentences** are what lies between
  one `.`, `?` or `!` followed by white space and the next, and a sentence is **new** when no line of the section
  holds it at the base, compared without case and extra spaces; a sentence the work changed is new. **Yours**: an
  audit line that names a project's hub and holds `freez…` or `frozen` in a new sentence, and one, the same or
  another, that holds `count…`, `30` or `50` in a new sentence. Example, in the item On a project's hub:
  `… <a new sentence with freezes or frozen> <a new sentence with 30, 50 or count> Everything else in this section holds there unchanged.`
  At the base the one audit line that names a project's hub has no new sentence.
- **The doc lanes** are the three CONTRIBUTING.md names: catalogue drift, design links and names, and public text.
  Each runs its own `commands` from `scripts/lanes.mjs` in this checkout against one fetch of the open issues
  (`gh issue list --state open --limit 5000`, handed over in `DEEP_OPEN_ISSUES`). A lane passes, or every finding it
  prints (line numbers dropped) is also printed when the same commands read the base commit's files against the same
  issues; public text scans the change, so it has no baseline and must pass. Why a baseline, and why not `runLanes`,
  is in `tests/acceptance/1336/README.md`. The test first requires the new text: the three decisions answered and the
  two things said on the audit lines.
- **A link into the new text** (**yours**: one in the body of each of #3397 and #3398) is a
  `technical-design.md#<anchor>` link, on a line of the body, whose anchor lands in One hub for a project once that
  section answers the three decisions, and which is more than the link each body held on November 25. It is new in
  one of two ways:
  - It sits on a line of the body that holds a decision's words, by the table above. `#project-hub` will do. Example,
    for the Scope line of #3397 that ends "which #3400 decides" today:
    `- What a miss freezes on a project's hub, and whether the audit's 30 days and 50 decisions count for each person: as [One hub for a project](https://github.com/windoliver/deepbuild/blob/main/docs/technical-design.md#project-hub) decides`
  - Or its anchor is one the design didn't have at the base and that lands in the section: a subheading's slug, or an
    `<a id>` the work set inside the section. It may sit on any line of the body. Example:
    `[What a miss freezes](https://github.com/windoliver/deepbuild/blob/main/docs/technical-design.md#<the new anchor>)`.
    No such anchor is required.

  **What this leaves a person to do on the two issues:** edit each body once. Both link `#project-hub` on their
  Design line already and name #3400 once, on the Scope line that says what it decides. Putting a link to the section
  on that line, or on any other line that speaks of a decision in the table's words, is enough. The link each has
  today, left alone, is not.
- **The taste call** (**yours**: the file `docs/evidence/3400/taste-call.json`) is recorded in the shape the project
  used for #3242's:

  ```json
  {"criterion": "#3400.28fd1eed", "who": "the person, and how they came to make the call",
   "when": "2026-11-26T18:04:00Z", "call": "reads_right",
   "text": {"file": "docs/technical-design.md", "sha256": "<64 hex digits, see below>"}}
  ```

  `when` is an ISO 8601 time with its zone. `sha256` is the SHA-256 of **the text**: the lines the tests above read,
  in the order the design holds them, each as the file holds it, joined with `\n`, with no final newline. Those are
  each line of One hub for a project that holds a decision's words, each audit line of The learned layer that names a
  project's hub and holds either thing's words in a new sentence, and each gained Decided row that holds a decision's
  words. This prints them, then the hash:

  ```sh
  node -e "import('./tests/acceptance/3400/helpers.mjs').then(({ theText }) => { const { lines, sha256 } = theText(); console.log(lines.join('\n')); console.log(sha256); })"
  ```

  So a call can't outlive an edit to a line it was made on, in any of the three sections, and an edit to any other
  line leaves it standing. Other fields, such as `by` or `note`, are free.
- **Telling the others** (**yours**: a comment on #3400) is done as it was for #1336, #1352 and #3242, by a comment
  on the issue. The test reads `gh issue view 3400 --json comments` for a comment whose body holds `#3400.28fd1eed`
  and `overrul…`, created at or after the record's `when`. Example: "AC4 `#3400.28fd1eed`: the taste call is recorded
  in `docs/evidence/3400/taste-call.json`. This comment tells the others on the project, and anyone can overrule it
  here."

## Criteria and tests

Each ID is `criterionId` from `scripts/proof-change.mjs`, computed from the saved body: `#3400.` and the first 8 hex
of the SHA-256 of the `- [ ]` text, trimmed, white space collapsed. Every test name starts with `AC<n>` and its ID.

| Criterion | ID | Tests, and what fails each |
|---|---|---|
| 1. One hub for a project answers each decision above, with what was not taken, and the Decided tables gain their rows | `#3400.65620d27` | `ac1-project-hub.test.mjs`, two tests. The section: a decision with no line holding its words, a line that holds them without `Not taken`, two decisions sharing one `Not taken`, or the decisions written outside the section. The Decided tables: no gained row, a decision no gained row holds, or the words added to a row the base already has |
| 2. The learned layer's audit lines say what a miss freezes and whose count starts an audit on a project's hub, and no line of the design contradicts the new text: the doc lanes pass | `#3400.7371b274` | `ac2-audit-lines.test.mjs` (offline): no audit line that names a project's hub, or either thing said only in a sentence the base already held, on a line with no `audit…`, or outside the section. `ac2-doc-lanes.live.test.mjs` (live): the new text missing, or a lane finding the base's files don't give, such as a link to an anchor the change dropped |
| 3. #3397 and #3398, which build #3242's audit and its pages, each link into the new text | `#3400.8f95766f` | `ac3-issue-links.live.test.mjs`: the section without the three answers, or either body with no link that lands in it, or with only the link it has today: by an anchor the base has, on a line that holds no decision's words |
| 4. One taste call on the text, by any one person on the project. The others are told, and can overrule it | `#3400.28fd1eed` | `ac4-taste-call.test.mjs` (offline): no record, another criterion, no person, no time with a zone, a call other than `reads_right`, or a hash of other text. `ac4-told.live.test.mjs` (live): no record, no comment on #3400 with the ID and `overrul…`, or only comments older than the call |

## Readings, where the issue and the design leave a choice

1. **Words the section already holds.** #3242's suite chose words no line of the section held. Here five of its lines
   hold `audit…`, `count…`, `claim`, `unshared` or `nobody shared` at the base, and a floor an old line meets proves
   nothing. So each decision's floor is two groups of words from its Scope line that no one line of the section holds
   together at the base. `miss` may stand for `audit…` in the first, since that Scope line's label names a miss and no
   audit, and a short Decided row may do the same. `30` or `50` may stand for `count…` in the second, since the
   Scope's draft answer says "count" only in what was not taken.
2. **One line per answer**, as #3242's suite reads it. "Each with what was not taken" is read on the line that
   answers. A `Not taken` in a list item nested under the answer isn't on that line and doesn't count. An answer may be
   written into an item the base has, such as Who is audited, if that line then says `Not taken` once for each of this
   issue's decisions it answers; the suite counts no `Not taken` over the section, which would pin its ten.
3. **"The Decided tables gain their rows"**, as #3242's suite reads it: every table with those columns under
   Decisions, and a row gained by its question, not by a count, so moving or rewording older rows neither helps nor
   hurts. `### Decided` is at its size ceiling of 66,647 bytes (`scripts/doc-ceilings.json`, where a ceiling never
   rises), so the rows go under another heading there. "Their rows" is read as rows for the three decisions, not as
   three rows.
4. **"The learned layer's audit lines say … on a project's hub."** #3242's suite read "say what holds on a project's
   hub" as: the place names a project's hub. That is met at the base, by the item #3242 wrote. This criterion names two
   things to say, so each needs its words on an audit line that names a project's hub. The words alone aren't enough
   either: Judged after it applies holds `frozen`, `30` and `50` at the base, said of a hub with one person, so a clause
   about a project's hub added anywhere on that line would meet both floors. Hence the new sentence: the words count
   where the sentence that holds them was written or changed since the base. "The audit lines" is read as the lines
   that name an audit, one of which has to say each thing, not every one.
5. **"No line of the design contradicts the new text: the doc lanes pass"** is read as #1336's and #3242's suites
   read it: the lanes find nothing the change brings. The base folder holds each `docs/*.md`, AGENTS.md and the two
   lists of names at the base, with this checkout's other scripts linked in. Public text scans the change against
   `origin/main`, so while #3365 is unmerged it also reads #3242's files; it passed on them at the base.
6. **"Link into the new text."** #3242's suite read it as a link that lands in One hub for a project, where
   criterion 1 puts the answers. Both issues were filed after #3242 and link that section already, so that reading
   would pass with neither issue touched, and the criterion would ask nothing of them. The least that makes a link
   one into the new text, not into the section as it was: it lands on an anchor the new text brought, or it is made
   from the place where the issue speaks of what the new text decides. The first needs an anchor the issue doesn't ask
   for, and the design sets no `<a id>` inside a section's text today, so it is accepted and never required. The
   second needs only an edit to each issue. Which decision an issue links isn't read.
7. **The text a call is bound to**, as #3242's suite binds it: the lines the criteria name, in the three sections
   they sit in, and nothing beside them, since other issues edit those sections too. No one anchor names it, so
   `text.anchor` isn't read.
8. **"The others are told"**, as #3242's suite reads it: the comment, not the record's own `note`, which is the word
   of whoever wrote the record. A comment made before the recorded call can't tell of it, so after a call is made
   again the others are told again.

## Not asserted

- Whether what the design says is right, complete, or contradicted by another line in meaning; whether it takes the
  draft's recommended answers; whether a decision's words sit in its answer or in what was not taken; whether a
  gained row says what its section says. Code can't read those; criterion 4's reader covers them.
- How we know version 0 works, which the issue links: no criterion names a line of it. And the Scope's "Not in this
  task" line (any code, who may answer which ask, when a held learned change gives up): no criterion would carry a
  test for it.
- The doc ceilings and the edit guard. Neither is one of the doc lanes, and no criterion names them. The work still
  has to meet both: `### Decided` can't grow by a byte, `### One hub for a project…` (10,485 bytes at the base) and
  `### The learned layer` (13,215) must stay at or under 16,384, and a row under Decisions passes only as its own
  approved proposal.
- That `who` is a person on the project, that anyone read the comment, and that an overrule is possible or happened.
  The comment is where an overrule would be made; an overrule that changes the text makes the record's hash stale.
- Anything in the two issues but the link and the words of its line, and anything in a comment but the ID, the word
  and its time.

## On the base

All four offline tests fail on `d0030e12b` for the expected reasons, and the live tests fail on the base and on GitHub
as it was on November 25. See `BASE-FAILURE.txt`, which also lists the planted texts, bodies, records and comments
each judge passed and failed, run from a scratch folder against the judges `helpers.mjs` exports and never written
into this checkout.
