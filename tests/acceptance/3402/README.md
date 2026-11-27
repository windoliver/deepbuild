# Acceptance tests for #3402: #1352's suite fails on main at its finder, its row count and a threats row

Written blind at base commit `c60215952` (main, with nothing that implements the issue), from the issue's body, the
design and that base. The drafting job saw no work that implements the issue: no other commit, branch, worktree or pull
request, and nothing on GitHub. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft by this job (design: Dogfooding). The redraft the issue's Scope asks for is in
`tests/acceptance/1352-redraft-3402/`, with its own README; this folder holds #3402's six criteria. There is no taste
criterion.

## What was read

The issue, AGENTS.md, the design (A hub of your own in the cloud, Decisions, Threats, Privacy, and in How we know
version 0 works: Criteria to tests, both ways, Wrong programs, The edit guard, Failing on an assertion),
`tests/acceptance/1352/` whole, `docs/evidence/1352/taste-call.json`, and for surfaces and format `scripts/lanes.mjs`,
`scripts/lanes-lists.mjs`, `scripts/known-failures.json`, `scripts/proof-change.mjs`, `scripts/proof-runs.mjs`,
`scripts/proof-reporter.mjs`, `scripts/bays.mjs`, and the folders `1111-redraft-2047/`, `3461-redraft-once/`, `3245/`
and `112-redraft-3245/`.

## Run

```sh
node --test tests/acceptance/3402/*.test.mjs
```

Node 24 and the checkout, Node built-ins and git: no `npm ci`, no build, no network, no `gh`. Eleven tests in six
files, a few seconds together, up to 15 s under load. Suite files run as children with `node --test`, reporting
through `reporter.mjs` to a pipe; planted designs are held in memory. Nothing is written in the checkout. One test
(AC1's first) writes a temporary tree outside it, under the system's temporary folder, and removes it.

**What the tests need from git, and what a skip means.** Two commits are read with `git show`, from the checkout's own
repository:

- `c60215952`, the base these tests were drafted on, for "main's design" and the record "as main holds it" (AC1's
  first test, AC2's two, AC3's first, AC5's two).
- `6aa228ce`, #1352's own base, which #1352's first-draft files read themselves (AC1's two tests and AC4).

A proof copy has a git folder that reads the objects of the repository it is made from, so both must be in that
repository. `6aa228ce` is not an ancestor of main: a clone of main alone doesn't hold it. Without a commit it needs, a
test skips with a message starting `INCONCLUSIVE:`; a skip is never a pass.

## What is judged where

A criterion speaks of two things, and each test holds both in one test, since a test that reads only a fixed commit
can fail on no program.

- **What the issue says of main**, "on the merge base", "main's design", "byte for byte as main holds it", is judged
  on the design and the record as the base commit `c60215952` holds them, read through git. A later approved edit of
  the design or a new taste call can't change it, so it can't break these tests the way #3138 broke #1352's.
- **What must stay true after any approved edit** is judged on the checkout: the redraft's tests pass, the threats
  test passes, the redraft finds its section among other headings and its rows under any heading, the record the
  checkout holds passes criterion 5's check, the lists and known-failures hold.

## Criteria to tests

The IDs are `#3402.` and the first 8 hex digits of the SHA-256 of each criterion's text, `- [ ] ` dropped, trimmed,
white space collapsed (`criterionId` in `scripts/proof-change.mjs`), recomputed from the issue's body. Every test name
starts with its ID.

| ID | Criterion | Tests | On the base | Wrong program |
|---|---|---|---|---|
| `#3402.bc48ab1e` | Each of #1352's five criteria is held by a test that passes on the change: the four failing today at the finder and the Decided count pass in their redrafted form, and the two passing today still pass. On the merge base the four originals fail with the messages above | `ac1-suite.test.mjs`: the four fail on the merge base's design with the issue's messages, and pass in their redrafted form on the checkout | passes | twin `section-lost-moving` |
| | | the two that pass today still pass | passes | twin `old-wording-back` |
| `#3402.efa6066b` | The redrafted section test passes on a planted design that holds three more headings with the words `hub` and `hosted`, and fails on one whose section lost one of the eight decisions, naming the decision. A planted finder that takes the one heading holding those words fails on main's design, naming both headings | `ac2-section.test.mjs`: the planted finder on main's design, and three more headings on the checkout's | passes | twin `section-lost-moving` |
| | | passes on the checkout's design; a lost decision, named, on main's | passes | twin `section-lost-moving` |
| `#3402.96b79474` | The redrafted Decided test finds the seven rows #1352 added under any heading inside Decisions, and fails on a planted design that drops one of them, naming its question. A planted reading that counts rows under `### Decided` alone fails on main's design | `ac3-decided.test.mjs`: the planted reading on main's design, and the seven under any heading inside Decisions on the checkout's | passes | twin `decided-row-dropped` |
| | | passes on the checkout's design; a dropped row, named by its question | passes | twin `decided-row-dropped` |
| `#3402.131135a1` | The threats test passes unchanged on the change, and on the merge base it fails, naming the row for another machine's connection | `ac4-threats.test.mjs` | **fails**, at its assertion, naming `Another machine's connection` | the merge base |
| `#3402.a95fc369` | Criterion 5's test passes, with `docs/evidence/1352/taste-call.json` byte for byte as main holds it. A redraft that passes only with a new record fails this test | `ac5-record.test.mjs`: the redrafted check passes on main's design with main's record, and the redrafted test passes on the checkout | passes | twin `record-for-other-text` |
| | | a planted finder returning other text needs a new record; while the checkout's section is main's text, its record is main's bytes | passes | twins `record-rewritten`, `record-for-other-text` |
| `#3402.76e0cb78` | The lanes run the redraft in the originals' place, and `scripts/known-failures.json` gains no entry for #1352 | `ac6-lanes.test.mjs`: the lists | **fails**, at its assertion: no entry yet | the merge base |
| | | no known-failures entry | passes | twins `known-failure-listed`, `known-skip-listed` |

`BASE-FAILURE.txt` holds the base's output whole, with the load, and the runs on the planted fix and on each twin.

## What each test means by its criterion's words

### AC1: the suite

- **"On the merge base the four originals fail with the messages above."** The first test copies the first draft's
  `helpers.mjs`, `ac1-section`, `ac3-agent-routes` and `ac5-taste-call` files, as the checkout holds them (each held by
  its SHA-256 at the base, since they stay as they are), into a temporary tree with the design and the record of
  `c60215952`, and runs them there with git pointed at the checkout's objects. It requires four failures: three with
  the issue's finder message, whole, `more than one heading holds "hub" and "cloud" or "hosted": "A hub of your own in
  the cloud, for someone with no computer", "Decided for a hosted hub"`, and one with `the Decided table has 99 rows,
  and had 112 at 6aa228ce: it gained none`. **The issue's table says 112 rows**; it was written on an earlier main, and
  the base's `### Decided` holds 99, so the base's message says 99. The rest is the issue's.
- **"Pass in their redrafted form."** The same test then runs the redraft's three files on the checkout and requires
  exactly four tests, all passed, under the tags #1352's README gives criteria 1 (twice), 3 and 5.
- **"The two passing today still pass."** The second test runs `tests/acceptance/1352/ac2-privacy-threats.test.mjs` as
  it is, on the checkout, and requires its search for the old wording and its privacy test to pass. The file's third
  test, the threats test, is AC4's.
- **"Each of #1352's five criteria."** Criteria 1, 3 and 5 are held by the redraft, criterion 2 by the first draft's
  offline file (two tests here, the third in AC4). Criterion 4 is not held: see Not tested.

### AC2: the section test

"The redrafted section test" is its whole check, `sectionCheck` in the redraft's helpers: the redraft's test asserts
that it gives no problem on the checkout's design.

- **A planted finder**, `findByWords` in `helpers.mjs`: the first draft's rule, the one heading whose text holds the
  word `hub` and the word `cloud` or `hosted`. Where the first draft throws on several, it gives the same sentence as
  its problem. Run through the redraft's check on main's design (`c60215952`) it must give exactly the issue's message,
  naming both headings.
- **Three more headings**, on the checkout's design: `### A hosted hub, planted before the section` above the section's
  anchor lines, `#### The hub when hosted, planted inside the section` under its heading, and `## Every hosted hub,
  planted after the section` at the design's end. The section is located by the redraft's own finder, not by its
  wording. The check must give no problem and find the same section as without them, with all eight decisions; the
  planted finder must fail there, naming the three planted headings.
- **Lost one of the eight decisions, naming the decision**: the checkout's design must give no problem. Then, on main's
  design, for each of seven decisions, the design without that decision's bullet (`- **Moving.**` and so on, by its
  bold label as main holds it) must give exactly one unanswered decision, that one, by the name the redraft gives it.
  The eighth, **The same hub.**, shares every word of its floor with other bullets, so without its bullet the check
  fails by the `Not taken` count alone and names no decision; the test holds that it fails.

### AC3: the Decided test

"The redrafted Decided test" is its whole check, `decidedCheck`. The seven rows are named by their questions as the
base design holds them: `A hub for someone with no computer`, `Who runs a hub in the cloud`, `Whose agents a hosted hub
runs`, `What a hosted hub keeps in the cloud`, `A browser reaching a hub`, `Who pays for a hosted hub`, `Moving between
a hosted hub and your own computer`.

- **A planted reading**, `readDecidedAlone`: the first draft's reading, the rows under the heading slugged `decided`
  alone. The first draft compared its count with the count at `6aa228ce`; here the redraft's check runs on what it
  reads, so "fails" means that on main's design (`c60215952`) it reads rows, finds none of the seven and names all
  seven.
- **Under any heading inside Decisions**, on the checkout's design: the seven are found where the design holds them;
  lifted into a table of their own under a planted `### Planted under another name` right under the Decisions heading;
  and lifted into the first table with the Decided columns under Decisions, whatever its heading. Lifted into a table
  with the same columns under a planted `## Planted before Decisions`, outside Decisions, none is found and each is
  named. The plants find their places by the Decisions heading's slug and the Decided columns, not by any other
  heading's wording.
- **Drops one of them, naming its question**, on the checkout's design: it gives no problem as it is, and without any
  one of the seven rows it gives exactly one problem, naming that question.

### AC4: the threats test

"Unchanged" is held by SHA-256: `tests/acceptance/1352/ac2-privacy-threats.test.mjs` is
`955ef90b…cdb6` and the helpers it imports, `tests/acceptance/1352/helpers.mjs`, `43af4c0b…4cdf`, as the base holds
them (the whole values are in the test). The file is then run as it is, on the checkout. Its threats test must pass.
When it fails, this test's first assertion shows the first cell of each row the first draft's failure holds, so on the
merge base it fails with `Another machine's connection`. That the threats test fails on the merge base is shown by this
test's own run there, in the before lane; no second test replays the merge base's row.

### AC5: the record

- **"Byte for byte as main holds it"** is the record at `c60215952`, whose SHA-256 is `64a443ba…2595` (1,000 bytes).
- **"Criterion 5's test passes" with it, and "a redraft that passes only with a new record fails this test"**: the
  redraft's check, `tasteCallCheck`, given main's design and main's record, must give no problem. A redraft whose
  finder returned any other text for the section would give `text.sha256` there, and fail this test, whatever record
  the checkout holds. The second test shows such a finder: `findFromAnchorLine` returns the same section starting at
  its `<a id="cloud-hub">` line, and the check, given it, must fail on main's design with main's record at
  `text.sha256` alone.
- **On the checkout**: the redraft's `ac5-taste-call.test.mjs`, run as it is, reports one test, passed, with whatever
  record the checkout holds. And while the checkout's section still has main's text (the same SHA-256), the checkout's
  record must be main's, byte for byte. Once an approved edit changes the section, the taste call is made again and a
  new record is right; the test then asks only that it pass criterion 5's check.

### AC6: the lanes

Read through the public entry, `scripts/lanes.mjs`, in a child process. **The entries the test expects**:

- `redrafted` maps each of `tests/acceptance/1352/ac1-section.test.mjs`,
  `tests/acceptance/1352/ac3-agent-routes.test.mjs` and `tests/acceptance/1352/ac5-taste-call.test.mjs` to
  `tests/acceptance/1352-redraft-3402/`.
- `byHand` names each of those three files, and of the six lists `byHand`, `ownLane`, `timed`, `slow`, `alone` and
  `exclusive` it is the only one that does.
- **None of those six lists** names `tests/acceptance/1352/ac2-privacy-threats.test.mjs` (it stays in the lanes as it
  is, so the folder `tests/acceptance/1352/` can't be listed whole) or any `*.test.mjs` file of
  `tests/acceptance/1352-redraft-3402/`, by its path or by a folder that holds it. These are the lists that take a file
  out of an ordinary affected run (`plan` in `scripts/affected.mjs`): by hand, a lane of its own, only with `--timed`,
  only with `--slow` unless the change touches it, or the alone block. On the base the first-draft files are in none
  of them, so the redraft, in their place, is in none. Each must be exported as a list.
- The redraft's test files hold exactly the `#1352.` tags of the three files they replace.
- `scripts/known-failures.json` has no string, key or value at any depth (`failures`, `lint`, `lintIssues`, the `skips`
  list's `id` and `reason`, the `timing` list), that holds `tests/acceptance/1352` followed by `/`, `-` or its end (the
  first draft or the redraft), or a `#1352.` criterion ID.

Other `redrafted` entries, such as one for `tests/acceptance/1352/helpers.mjs` or for the live files, are neither
required nor refused.

## The planted wrong programs

`twins.json` names them by criterion; each is under `twins/<name>/`. Each design twin is a `lines.json` whose `find`
lines the design must hold at exactly one place; **none names the threats table's row for another machine's
connection**, the one line of the design this issue changes. Each is laid over the checkout, so each breaks what a
test judges on the checkout.

| Twin | What it plants | The tests that fail on it |
|---|---|---|
| `section-lost-moving` | the design without the section's `- **Moving.**` bullet | AC1 first; AC2 first and second |
| `old-wording-back` | under `### Privacy`, the sentence #1352 removed: "There is no HTTP server for a UI, and the hub refuses any request carrying a browser Origin, so no web page can reach it." | AC1 second |
| `decided-row-dropped` | the design without the row `Who pays for a hosted hub` | AC3 first and second |
| `record-rewritten` | the record with another `when`: still bound to the section's text, but not main's bytes while the section is main's | AC5 second |
| `record-for-other-text` | the record with the SHA-256 of the text the planted finder returns | AC5 first and second |
| `known-failure-listed` | `scripts/known-failures.json` with a `failures` entry for a first-draft #1352 test | AC6 second |
| `known-skip-listed` | `scripts/known-failures.json` with a `skips` entry, `{ id, reason }`, for a redrafted #1352 test | AC6 second |

A twin can't replace a file under the test paths, so a wrong finder or reading is never a twin: those are planted in
the tests, as the criteria word them, and judged on main's design.

## Not tested

- **#1352's criterion 4**, and the live half of its criterion 2. Their only tests are
  `tests/acceptance/1352/ac4-issue-links.live.test.mjs` and `ac2-doc-lanes.live.test.mjs`, which need `gh` and the
  network, call the first draft's finder and so stop at it by hand today. This job may not use `gh`, so it wrote no
  redraft of them and no test here runs them. AC1's "each of #1352's five criteria" is therefore held for criteria 1,
  2, 3 and 5; whether criterion 4's live test is redrafted too is the owner's to say.
- **That the threats row names the web client in the words Socket roles uses.** AC4 holds #1352's rule (no row
  mentions a browser Origin, every browser or any browser without the words `web client`), not the row's wording.
- **That the lanes start the redraft's files.** AC6 holds the lists; that an affected run or a preflight then runs a
  file not by hand is those scripts' own behavior, tested where they are.
- **The suite's run on the change.** The change doesn't exist yet. `BASE-FAILURE.txt` holds the run on a planted fix.
- **That the change leaves the record untouched once the section is edited.** AC5 holds the record's bytes on the
  checkout only while the section's text is main's; after an approved edit of the section a new record is right.
