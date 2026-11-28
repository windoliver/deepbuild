# Acceptance tests for #3472: what a person who isn't technical reads for a state

These tests were drafted blind from issue #3472 (its body as saved on November 25, 2026; it had no comments), the
issues it names as saved the same day (#1348 and #3418, which it depends on; #1999 and #3412, beside it; #1324, its
epic; #1463 and #1343), the design, AGENTS.md, CONTRIBUTING.md and the base commit `fd9be7a7` (main, no work on the
issue). In the design I read the five sections the issue links (States people see; Later, as extensions; Verdict;
Decided; One word per idea), Decisions' opening lines and its three tables, and the suite rules: Criteria to tests,
Closed issues stay proven, The work filed against each design section, Criteria in a checked shape, Wrong programs,
The edit guard and Dogfooding. At the base I also read `scripts/doc-links.mjs`, `scripts/design-links.mjs`,
`scripts/principles.mjs`, `scripts/design-section.mjs`, `scripts/doc-ceilings.mjs`, `scripts/catalogue-drift.mjs`,
`scripts/public-text.mjs`, `scripts/open-issues.mjs`, the doc lanes' entries in `scripts/lanes.mjs`,
`scripts/proof-change.mjs` (`criterionId`), the files the issue's six findings cite, and for conventions
`tests/acceptance/1336/`, `tests/acceptance/1352/` and `tests/acceptance/3267/` with `docs/evidence/1336/taste-call.json`
and `docs/evidence/1352/taste-call.json`. What `helpers.mjs` and `doc-lanes.mjs` need from those is copied, never
imported. Per AGENTS.md, the implementing agent doesn't edit these tests; a dispute goes to a blind redraft by this job.

The issue is design-only: "Not in this task: any change to a word, a sentence or the lane. A design change only". Its
Proof is "The design's diff, the doc lanes' results, and the issues filed from it".

## How to run them

```sh
node --test tests/acceptance/3472/ac1-decisions.test.mjs        # offline: the design here and at the base
node --test tests/acceptance/3472/ac2-lines-agree.test.mjs      # offline
node --test tests/acceptance/3472/ac3-state-words.test.mjs      # offline
node --test tests/acceptance/3472/ac5-taste-call.test.mjs       # offline: the record, and the design
node --test tests/acceptance/3472/ac2-doc-lanes.live.test.mjs   # live: GitHub through gh, then the three doc lanes
node --test tests/acceptance/3472/ac4-issues.live.test.mjs      # live: GitHub through gh
node tests/acceptance/3472/call-text.mjs                        # no test: prints what a taste call has to name
```

Plain `node --test` files on Node 24's built-ins: no build, no `node_modules`, and no other file of the repo needs an
edit for them to run. Run them from the repo's root, by hand, as the other Node suites here.

- All of them need git and a checkout that holds the base commit `fd9be7a702f7cac74bab5095a2780ebe4d487095`, which
  they read with `git show`.
- The two `*.live.test.mjs` files read GitHub through `gh`, so they need network and `gh` signed in with read access
  to `windoliver/deepbuild`. Offline or signed out they skip with a message starting `INCONCLUSIVE:`. A skip is never
  a pass, and a failure the design alone shows is reported as a failure, not hidden by a skip.
- `ac2-doc-lanes.live.test.mjs` also needs `origin/main`, which the public text lane scans the change against, and
  `packages/contracts/dist`, which the catalogue drift lane imports (`npm ci && npm run build -w @deepbuild/contracts`).
  Without the build it runs the other two lanes and then skips as `INCONCLUSIVE:`, naming that lane. It writes the
  open issues and the base's docs to a folder under the system's temporary folder and removes it.

## The surface, and what is yours to provide

Each name below is this suite's choice where the issue and the design leave it open. The tests spell them exactly so.

| What | Who provides it | Exactly |
|---|---|---|
| The answers | the implementer | sentences and table cells added inside `docs/technical-design.md#states-people-see` |
| An anchor in the new text | the implementer | a subheading inside that section, or an `<a id="…"></a>` inside it, under any name the design doesn't have yet. Example: `<a id="plain-surfaces"></a>` on the line above the new text |
| The Decided row | the implementer | a row of a table under `## Decisions` headed `Question \| Decision \| Reopens if`, with all three cells filled, that links into States people see, names it or holds the word `plain` |
| The plain-words line | the implementer | the line under `### Later, as extensions` that holds `plain words` and links into States people see |
| The issues that build the answer | whoever files them | at least two issues of `windoliver/deepbuild` filed after #3472, each with `#3472` in its body and a link to `docs/technical-design.md#<an anchor in the new text>` |
| The taste call | the person who makes it | `docs/evidence/3472/taste-call.json` |

### The new text

- **States people see** is found by the anchor the issue links, `states-people-see`: the heading with that GitHub slug.
  Its text runs to the next heading of its level or higher, so a subheading added inside it belongs to it, without the
  blank and `<a id>` lines that close it. This is #1352's and #3267's section rule. Headings, slugs and anchors are read
  as the design links lane reads them (`scripts/doc-links.mjs`).
- **What the section gained** is its pieces that the same section at `fd9be7a7` doesn't hold. A line of prose is cut
  into sentences, after each full stop followed by white space, as #3267 cuts one. A table row gives its first cell,
  and one piece for each other cell that isn't empty, written `<first cell> | <cell>`, so a cell says which row it
  sits in: `PASS | done, and the checks agree`. White space is collapsed and case is kept. A line that holds only an
  `<a id>` is no piece. So a new sentence inside an old paragraph counts, a column added to the old table counts row
  by row, an old sentence left alone never counts, and an old sentence edited counts as new.
- **Every floor below is read in what the section gained**, never in the section as a whole: at the base the section
  already holds `plain`, `sentence`, `surface`, `check` and every one of its own table's words. Words are read as the
  text renders: a link by its label, with no tag, so an anchor named `plain-surfaces` is not the word `plain`.
- A decision written under a new heading beside the section, or in another section, isn't in it.

### The decisions' words

Code can't judge a design text. The first test of criterion 1 holds what the section gained to a floor: the words any
answer to each Scope decision has to use, whichever way it goes, taken from the issue's own Scope lines (any case). It
is a floor for a text a person also judges, never a reading of it: the taste call of criterion 5 covers everything
else.

| Scope decision | Words what the section gained has to hold |
|---|---|
| What a state reads as on a plain surface | `plain`, `surface` (or `surfaces`), `state` (or `states`), `word` (or `words`) |
| The sentences | `sentence` (or `sentences`) |
| Which surfaces are plain | `plain`, `surface`, `list` (or `lists`), and `` `deep` `` as a code span, or `deep with no arguments` |
| The words for the levels | `milestone`, `attempt`, `check`, `run`, `goal`, `chapter`, `entry` (or `entries`), `thread`, each also with an `s` |
| Who holds a row's sentence to the list | `hub`, `sentence`, and `written` or `drawn` |

- **"With what was not taken"** is the phrase the design uses for it: what the section gained says `Not taken` (any
  case) at least five times, once per decision, as #1336 and #1352 count it.

Example of one decision that meets its floor: "**Who holds a row's sentence to the list.** The hub's sentences are
judged where they are written. Not taken: judging them only where they are drawn."

### The Decided tables

- **A Decided table** is a table inside the section the anchor `decisions` lands on (`## Decisions`) whose header is
  `Question | Decision | Reopens if`. The base has two, under `### Decided` (112 rows) and `### Decided for a hosted
  hub` (7 rows); a table added under a new heading there counts, and the `### Yours` table, with other columns, doesn't.
- **A gained row** is a row of one of them that none of them holds at `fd9be7a7`, compared as a whole line with white
  space collapsed.
- The second test of criterion 1 needs one gained row that is about the new text (it links into States people see by
  any of the section's anchors, or holds `States people see`, or holds the word `plain`) and that holds a question, a
  decision and what reopens it, as Decisions' opening lines say every decided question has.

Example: `| What a state reads as on a plain surface | Its word stays the contract, and a row leads with one plain
sentence (see [States people see](#plain-surfaces)). Not taken: the words alone | People skip the sentence |`

### The state words

- **The words of the States people see table** are the first cell of each row of the section's table that has a
  `Status-map entry` column, as the section holds it when the test runs: fifteen at the base, from `queued` to
  `running`.
- **The text names a word** when the word stands whole in a piece the section gained: `PASS`, `BLOCKED`, `INVALID`
  and `INCONCLUSIVE` in capitals, the others in any case; `pass` isn't `PASS` and `send-back` isn't `sent back`. A row
  of a new table whose first cell is the word names it, and so does a cell added to the word's own row of the old
  table, and so does a sentence such as "queued, working and quiet read as they are, since each is a plain word".

### The two lines

- **The plain-words line under Later, as extensions** is each line of the section `later-as-extensions` that holds
  `plain words` (or `plain-words`, `plain word`) and links into States people see, by any anchor the lane lands on that
  section or inside it. At the base that is one line, the list item that begins "**The project page.**".
- **The line in States people see** is what the section gained: it has to hold a sentence or cell with both `plain` and
  `surface` (or `surfaces`).
- **The surfaces** are the six the issue names as plain or asks about, each by one name both lines use (any case):

  | Surface | Read as |
  |---|---|
  | the card | `card`, `cards` |
  | the page | `page`, `pages` |
  | the list's rows | `list's rows`, `list rows`, or `rows of the list` (also `rows in the list`, `rows on the list`, and each with `the app's list`) |
  | notifications | `notification`, `notifications` |
  | end notices | `end notice`, `end notices` |
  | `deep` with no arguments | the code span `` `deep` `` alone, so not `` `deep status` `` |

- **They agree on which surfaces are plain** when both hold: each surface the plain-words line names in a sentence
  that holds `plain` is named somewhere in what States people see gained; and each surface States people see names in
  a gained sentence or cell that holds `plain` is named somewhere in the plain-words line.

Example of a pair that agrees: under Later, "The page, the card, the list's rows, notifications and end notices use
one list of plain words kept in the repo … `deep` with no arguments prints the same rows … see
[States people see](#plain-surfaces)"; in States people see, "The plain surfaces are the card, the page, the list's
rows, notifications, end notices and `deep` with no arguments."

### The doc lanes

- **The doc lanes** are the three CONTRIBUTING.md names: design links and names, catalogue drift and public text. The
  live test runs them as #1336's and #1352's tests do, and `tests/acceptance/1336/README.md` says why: each lane's own
  `commands` from its entry in `scripts/lanes.mjs` (not `runLanes`, which waits on the machine-wide throttle), with this
  checkout as their working folder, against one fetch of the open issues handed over in `DEEP_OPEN_ISSUES`.
- **A lane passes, or brings nothing.** A lane that fails is held to a baseline: every finding it prints (line numbers
  dropped) has to be one the same commands print when their working folder holds the base commit's docs, since main
  can fail on open issues no design change touches. Public text scans the change itself, so it has no baseline and
  has to pass.
- **Two changes from #1352's copy**, each read against this base. Its baseline folder held only the docs and
  `scripts/planned-names.txt`; the design links lane now also reads `AGENTS.md` and looks for files under `scripts/`
  from its working folder (`scripts/principles.mjs`), and stops before it prints a finding without them, which would
  make every old finding look new. So the base's folder here also holds `AGENTS.md`, each doc at the top of `docs/`, and
  `scripts/` as the base has it: its `.txt` lists whole and every other file by name alone. And each lane is judged by
  itself: a lane that can't run (no build, or it prints `INCONCLUSIVE`) makes the test skip as `INCONCLUSIVE:` only
  after the lanes that can run have run, so it never hides a finding of theirs.
- The test first requires that States people see gained text, since "no line of the design contradicts the new text"
  means nothing without it.

### The issues that build the answer

- **An anchor in the new text** is an anchor that sits in States people see and that the base's design doesn't have
  anywhere: the slug of a subheading inside the section, or an `<a id>` on a line above such a subheading or inside
  the section's text. The lane's rule decides where an anchor sits (`scripts/doc-links.mjs`): an `<a id>` on a line of
  its own lands on the heading that follows it, or on the section it sits in when text comes between them. The
  section's own anchors, `#states-people-see` and `#states`, are the base's and land on its old opening.
- **A design link that lands in the new text** is a link, as the lane reads links (a markdown link or a bare link,
  outside code spans and fenced code), to `docs/technical-design.md#<an anchor in the new text>`: with the repo's
  `https://github.com/windoliver/deepbuild/blob/main/` in front, or as `docs/technical-design.md#…`.
- **An issue that builds the answer** is an issue of `windoliver/deepbuild`, no pull request, with a higher number
  than #3472, not closed as not planned or as a duplicate, whose **body cites #3472** (`#3472`,
  `windoliver/deepbuild#3472` or the issue's URL) and holds a design link that lands in the new text. Example:

  ```
  **Epic:** #1324 · **Design:** [States people see](https://github.com/windoliver/deepbuild/blob/main/docs/technical-design.md#plain-surfaces)

  ### Depends on
  - #3472 Design: what a person who isn't technical reads for a state, a milestone, an attempt and a check
  ```

- **How the test finds them:** as #3267's does. It reads #3472's timeline
  (`gh api repos/windoliver/deepbuild/issues/3472/timeline`), where GitHub records each issue that cites it, and then
  each such issue with `gh issue view <n> --repo windoliver/deepbuild --json number,title,body,state,stateReason`. No
  list is kept in the repo.
- **At least two**, and among them the two the Scope already knows, each told by the words of its title and body (any
  case, read as they render):

  | Issue | Words its title and body hold between them |
  |---|---|
  | `deep`'s list read by the lane | `` `deep` `` as a code span (or `deep's`), `list`, `lane` |
  | A lane run that reaches every state | `lane`, `run`, and `every state` or `each state` |

### The taste call

The call is a person's, and code can't make it. The test reads its record, `docs/evidence/3472/taste-call.json`, in the
shape the project used for #1336's and #1352's, with `text` now a list that names what was judged piece by piece:

```json
{
 "criterion": "#3472.822bbdc5",
 "who": "the person who made the call, and how they came to make it",
 "when": "2026-11-26T10:00:00Z",
 "call": "reads_right",
 "text": [
  {
   "file": "docs/technical-design.md",
   "anchor": "states-people-see",
   "sha256": [
    "17285ff4aa06cdae8fbdc75b16297e33ff6b629fc6355d496b2d9415bb713045",
    "8c5f2f9693c3982f4a760d07e27998186f0a1a0dad2ad3336d5dbaaa5292de6b",
    "f95d11d1d2fb32c092715abc01595117c4c66864dcb69b555f967ba6203c79b8"
   ]
  },
  {
   "file": "docs/technical-design.md",
   "anchor": "later-as-extensions",
   "sha256": ["5b50cac0efd3fc62c3c45d60a8293372b480ac3e8c6ae2fc7f2b66dea4069a53"]
  }
 ]
}
```

- `criterion` is `#3472.822bbdc5`, `who` names a person, `when` is an ISO 8601 time and `call` is `reads_right`. Other
  fields, such as a `note`, are free.
- `text` is a list. Each entry names a section of `docs/technical-design.md` by an anchor that lands on it, and under
  `sha256` the SHA-256 (lowercase hex, of the UTF-8 bytes) of each piece judged there, cut as "What the section
  gained" cuts them. The three under `states-people-see` above are of "**Which surfaces are plain.** The plain
  surfaces are the card, the page, the list's rows, notifications, end notices and \`deep\` with no arguments.", of
  "Not taken: leaving the list's rows out." and of "PASS | done, and the checks agree".
- **Bound to what it judged.** Every piece the record names has to be in the section it names it under, now. So the
  call can't outlive an edit: a judged sentence reworded later is no longer there, and the test says how many are
  gone. A sentence a later issue adds beside the judged text disturbs nothing.
- **A call on the text and the sentences.** The pieces the record names, taken alone, have to pass criterion 1's
  first test and criterion 3's test: the five decisions with five `Not taken`, and each word of the table. And the
  record has to name every sentence of the plain-words line under Later, as extensions that holds `plain`, since the
  call is what judges that the two lines say the same. A call on part of the text fails, and the test lists what
  States people see gained that the call doesn't name.
- `node tests/acceptance/3472/call-text.mjs` prints the pieces a call on the design as it is now has to name, to read,
  and then the `text` value for them. It judges nothing and writes no file.

## Criteria and tests

Each ID is `#3472.` and the first 8 hex digits of the SHA-256 of the criterion's text, trimmed, white space collapsed,
as `scripts/proof-change.mjs` computes it. Every test's title starts with `AC<n>` and that ID.

| Criterion | ID | Tests | What fails them |
|---|---|---|---|
| 1. States people see answers each decision above, with what was not taken, and the Decided tables gain their rows | `#3472.3ffabd82` | `ac1-decisions.test.mjs`, two tests. The first: what the section gained holds the five decisions' words and five `Not taken`. The second: the Decided tables gained a row about the new text, with its question, its decision and what reopens it | The base, where the section gained nothing and the tables hold their 119 rows. A decision left out, a missing `Not taken`, the decisions under a heading beside the section; no new row, a new row about another matter, one with nothing to reopen it, one in the Yours table |
| 2. The plain-words line under Later, as extensions and the line in States people see agree on which surfaces are plain and what a state reads as there, and no line of the design contradicts the new text: the doc lanes pass | `#3472.afb5879c` | `ac2-lines-agree.test.mjs` (offline, one test: the surfaces the two lines name); `ac2-doc-lanes.live.test.mjs` (live, one test: the three lanes) | The base, where States people see has no new sentence on a plain surface. The two lines naming different plain surfaces, either way round; the line under Later no longer linking States people see. A link the new text breaks, or an anchor dropped that open issues link; and whatever else a lane finds that the base's docs don't give |
| 3. The text names each word of the States people see table and what a person reads for it on a plain surface, or says it reads as it is and why | `#3472.c86cb9a6` | `ac3-state-words.test.mjs`, one test | The base, where the new text names none of the fifteen. A word the text never names, `pass` for `PASS` |
| 4. The issues that build the answer are filed, each with a design link that lands in the new text | `#3472.78cc555a` | `ac4-issues.live.test.mjs`, one test | The base and GitHub as it is today: no anchor in the new text, and no issue that builds the answer. An issue that links only `#states-people-see` or another section, one that doesn't cite #3472, one closed as not planned, a pull request; one issue alone; neither of the two the Scope knows |
| 5. One taste call on the text and the sentences, recorded | `#3472.822bbdc5` | `ac5-taste-call.test.mjs`, one test | The base, where no record exists. No record, another criterion's, a call other than `reads_right`, no person or time; a call bound to other text; a judged sentence or the line under Later edited after the call; a call that names only part of the text |

## Readings where the issue and the design leave a choice

1. **Five decisions.** The Scope's list has seven lines. Five are decisions, each led by its name in bold: what a state
   reads as on a plain surface, the sentences, which surfaces are plain, the words for the levels, and who holds a
   row's sentence to the list. The sixth, "Then the list of issues that build the answer", is a list of work and has
   nothing not taken: it is criterion 4's alone. The seventh bounds the task.
2. **"States people see answers"** means the section gained the answers since the base, read where the issue's link
   lands. The section is old and busy, so the floors are read only in what it gained (see "Every floor below").
3. **A floor holds only what any answer has to say.** The Scope marks its answers "Drafted" and "yours to change", and
   names "the other answers". So the floor leaves out what only the drafted answer needs: `contract`, a `closed
   table`, `leads`, the six drafted sentences, `Project`, `title`, `task` and `detail views`. It keeps the names of
   the things each decision is about, which an answer has to use whichever way it goes: an answer that takes no
   sentences still says so, and one that leaves `deep` with no arguments out still names it.
4. **A cell carries its row.** #3267 cuts a table row at each `|`, so a cell alone doesn't say which row it sits in.
   Criterion 3 asks what a person reads "for it", for each word, so this suite reads a cell with its row's first cell.
   Otherwise a column added to the old table would name no word, and a new table's first cells, which the old table
   already holds, would count for nothing.
5. **"The Decided tables", in the plural,** are read by their header and not by one heading. `### Decided` is at its
   size ceiling at the base (`scripts/doc-ceilings.json`), so its rows may well go under another heading, as the
   hosted hub's did; a test that read `### Decided` alone would miss them.
6. **"Gain their rows"** is read as #1336 and #1352 read "gains its rows": at least one gained row about the new
   text. How the five decisions are spread over rows is left to the taste call: `### Decided for a hosted hub` holds
   seven rows for the eight decisions #1352's README lists, so one row may hold two.
7. **"The plain-words line"** is found by what the criterion calls it and by what it has to do: it says `plain words`,
   and it links the section it has to agree with. Two lines under Later hold `plain words` at the base; one links
   States people see.
8. **"Agree on which surfaces are plain"** is read as the two naming the same surfaces, of the six the issue names. A
   name in a sentence that holds `plain` on one side has to appear on the other. **"What a state reads as there"** is
   read no further than the link: whether the two say the same of it is the taste call's, and the record is bound to
   both lines for that.
9. **"No line of the design contradicts the new text: the doc lanes pass."** The lanes are the criterion's own
   observable, and all code can read of it; #1336's README says the same. A contradiction in meaning is the taste
   call's.
10. **"Each word of the States people see table"** is read from the table as it is when the test runs, found by its
    `Status-map entry` column, so a word a later issue renames is read by its new name. "What a person reads for it
    … or says it reads as it is and why" is held only to the word being named in the new text.
11. **"Lands in the new text"** needs an anchor of the new text's own. A link lands on a heading or an `<a id>` and
    nowhere else (the lane's rule), and the section's two anchors are the base's: they land above text the base
    already held, and issues open today link them, so a link to them says nothing of the new text. The criterion asks
    for the anchor in asking for a link that lands there. It names none, so any name serves, and an `<a id>` is
    enough: no heading is asked for. The answer is in States people see (criterion 1), so an anchor added elsewhere
    isn't read.
12. **"The issues that build the answer"** are found by their citation of #3472 and their link, so nobody has to name
    them to the test. The Scope says "Among them, already known: `deep`'s list read by the lane, and a lane run that
    reaches every state": the list holds at least those two, so the test asks for two issues and for each of the two.
    One issue that holds both sets of words is one issue: a second is still needed.
13. **"Recorded"** is read as #1336 and #1352 recorded theirs: a `taste-call.json` under `docs/evidence/`. #3267 read
    "you approve them" as a signed tag; this criterion asks for a call, by nobody it names, and tells nobody.
14. **Bound piece by piece, not by one hash of a section.** #1336 and #1352 hashed a whole section, which the issue
    had added and owned. Here the text sits inside a section later issues will edit, and beside a line under Later.
    One hash of States people see would make the call stale at the next unrelated edit, and a hash of what it gained
    at the next added sentence. Naming each judged sentence keeps the call bound to exactly what it judged.
15. **"The text and the sentences"** are what criteria 1 and 3 put in States people see, the drafted sentences among
    them, and the plain-words line criterion 2 holds them to. The Decided rows aren't required of the record: a row
    under Decisions already needs a person's approval (The edit guard).

## Not asserted

- **What the text means.** Whether a word sits in a decision or in what was not taken, which decision a `Not taken`
  belongs to, whether a surface is named as plain or as not plain, whether the two lines say the same of what a state
  reads as, whether what the text gives for a word is what a person should read, and whether any other line of the
  design contradicts it. The taste call covers those.
- **"None uses a word States people see says never to call a state."** The Scope says it of the drafted sentences.
  Code can't tell a sentence that calls a state `done` from one that says the checks aren't done.
- **"Not in this task: any change to a word, a sentence or the lane."** It bounds the change, and its diff shows it. A
  test that pinned `contracts/plain-words.json`, the hub's sentences or the lane would fail as soon as the issues this
  one files are built.
- **Verdict and One word per idea.** The issue links them, and no criterion names them.
- **The edit guard and the size ratchet.** A row under Decisions passes the guard only as an approved proposal, and
  `scripts/doc-ceilings.mjs` (the lint lane) holds `### Later, as extensions` and `### Decided` at their sizes. No
  criterion names either; they run in their own lanes.
- **How many rows the Decided tables gain** beyond one, and whether each has `Not taken`.
- **Where in the section an anchor sits.** An anchor the base didn't have, anywhere in States people see, is read as
  in the new text.
- **Who wrote the record, filed an issue or typed a line.** A file in the tree and an issue on GitHub don't say.
- **An issue's worth:** whether its criteria are in the checked shape, whether it names a wrong case, and whether it
  builds what the answer needs beyond the two the Scope knows.
- **That no issue which builds the answer lacks the link.** An issue filed after #3472 that cites it and links nothing
  in the new text is read as another matter's. The test names it only when the list is short or one of the two known
  issues is missing.
- **A record for another issue,** and every other suite's finders, results and recorded calls.

## Outside the inputs

Not fetched, and so not known to this job: under whose sign-in `gh` runs in the shell that will run the live files,
which open issues the doc lanes will read on that day, and whether that checkout has `packages/contracts/dist`. The
checkout these were drafted in has none, so the catalogue drift lane was never run here.

## On the base

All five offline tests fail on `fd9be7a7` at their own assertion: States people see holds no sentence it didn't hold
there, the Decided tables hold their 119 rows, and no call is recorded. The live tests' runs, and the planted texts,
issue bodies, timelines, records and doc folders with their mutants, are in `BASE-FAILURE.txt`. The planted inputs
were judged in memory or in a scratch folder outside the repo, and never written into this checkout or onto GitHub.
