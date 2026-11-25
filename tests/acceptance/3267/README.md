# Acceptance tests for #3267: a body's motion on the input track is personal data

These tests were drafted blind from issue #3267 (its body as saved on November 23, 2026; it had no comments), the
bodies of #1186, #1187 and #1188 as saved the same day, the design, AGENTS.md, CONTRIBUTING.md and the base commit
`5919c397` (main, no work on the issue). In the design I read the four sections the issue links (Privacy, Control and
input track, Device gate and capture; Seam and backend: device classes), Relay and Join, and the suite rules: Criteria
to tests, Closed issues stay proven, Criteria in a checked shape, Wrong programs, The edit guard, Dogfooding, Tests
written first, and Decisions' opening lines. At the base I also read README.md's "Approve an edit to a check",
`scripts/proof-approvals.mjs` (how an approval is read), `scripts/proof-change.mjs` (`criterionId`, `readIssue`),
`scripts/closed-sweep.mjs` and `scripts/design-issues.mjs` (how issues are read from GitHub), `tests/fixtures/approver.mjs`,
and for conventions `tests/acceptance/1336/` and `tests/acceptance/1352/` with their `taste-call.json` records, and the
READMEs of `tests/acceptance/569/`, `tests/acceptance/2109/` and `tests/acceptance/327-manual-evidence-proposal/` on what
"approved by you" can be read from. What `helpers.mjs` needs from those is copied, never imported. Per AGENTS.md, the
implementing agent doesn't edit these tests; a dispute goes to a blind redraft by this job.

The issue is design-only (`Runs on:` no machine). Its result is the approved text of two design sections and the
follow-on issues, and its Proof is "the approved diffs of the two sections, and the follow-on issues".

## How to run them

```sh
node --test tests/acceptance/3267/ac1-decisions.test.mjs          # offline: the two docs, git and ssh-keygen
node --test tests/acceptance/3267/ac2-follow-ons.live.test.mjs    # live: GitHub through gh
node --test tests/acceptance/3267/ac3-pointers.live.test.mjs      # live: GitHub through gh, then git and ssh-keygen
```

Plain `node --test` files on Node 24's built-ins: no build, no `node_modules`, and no other file of the repo needs an
edit for them to run. Run them from a checkout of the repo, by hand, as the other Node suites here.

- All three need git and a checkout that holds the base commit `5919c397`.
- Wherever an approval is read (the second test of `ac1-decisions.test.mjs`, and `ac3-pointers.live.test.mjs`), the
  checkout needs `origin/main`, the approval tags, and `ssh-keygen`. Tags reach a checkout with
  `git fetch origin '+refs/tags/deep/approved/*:refs/tags/deep/approved/*'`. Without `origin/main` or `ssh-keygen` the
  test skips as `INCONCLUSIVE:`; a tag that isn't there is a failure that says so.
- The two `*.live.test.mjs` files read GitHub through `gh`, so they need network and `gh` signed in with read access
  to `windoliver/deepbuild`. Offline or signed out they skip with a message starting `INCONCLUSIVE:`. A skip is never a
  pass.

## The surface, and what is yours to provide

Each name below is this suite's choice where the issue and the design leave it open. The tests spell them exactly so.

| What | Who provides it | Exactly |
|---|---|---|
| The decisions | the implementer | sentences added inside `docs/technical-design.md#privacy` and inside `docs/canvas-primitives.md#seam-and-backend-device-classes` |
| The approval of them | the owner | a signed tag `refs/tags/deep/approved/<any name>` holding `Approves: docs/technical-design.md` and `Approves: docs/canvas-primitives.md`, on the commit that added the sentences |
| The follow-on issues | whoever files them | issues of `windoliver/deepbuild` filed after #3267 whose body cites `#3267` |
| The line in #1186, #1187 and #1188 | the owner, or an agent on the owner's word | one line of each body that cites `#3267` |
| The record of that line | the implementer | `docs/evidence/3267/pointing-line.txt`, holding the line exactly as the bodies hold it |
| The owner's word for it | the owner | `Approves: docs/evidence/3267/pointing-line.txt` in a signed tag on the commit that added the line to the record |

### The two sections, and what each gained

- **A section** is found by the anchor the issue links: the heading whose GitHub slug is the anchor, or the heading an
  `<a id>` just above it names. Its text runs to the next heading of its level or higher, so its own subheadings belong
  to it, without the blank and `<a id>` lines that close it. This is #1352's section rule.
- **What a section gained** is its sentences and table cells that the same section at `5919c397` doesn't hold. Each
  line is cut after a full stop followed by white space and at each `|`, and white space inside a piece is collapsed;
  case is kept. This is how #1352 cuts a doc to judge a phrase by its sentence, here line by line. So a new sentence
  inside an old paragraph counts, an old sentence left alone never does, and an old sentence edited counts as new.
- **Both sections must gain something.** A decision written under a new heading beside the section, or in another
  section, isn't in it.

### The decisions' words

Code can't judge a design text. The first test holds what the two sections gained to a floor: the words any answer to
each Scope decision has to use, taken from the issue's own Scope lines and criteria (any case; `…` means any ending).
It is a floor for a text a person also judges, never a reading of it: the owner's approval covers everything else.

| Scope decision | Words, and where they are read |
|---|---|
| A device class says when its entries are a body's motion | `body` (or `bodies`) in what the device classes section gained |
| Body entries are personal data, and each way out is named | `personal data` and `body` in what the Privacy section gained; in what the two gained together: `save…`, `export…`, `match`, `relay`, `evidence`, `debug bundle` |
| A way out carries them only by the person's own gesture that names them | `gesture`, `join…` |
| What proves a hands piece is synthetic | `synthetic hand` (or `hands`), `recorded` (or `recording`), `person` |
| A fixture is never a person | `fixture`, `clip`, `person`, `drawn` or `rendered`, and `consent…`, `agree…` or `in writing` |

- **"Each with what was not taken"** is the phrase the design uses for it: what the two sections gained says
  `Not taken` (any case) at least five times, once per decision.
- **"And what would reopen it"** is the design's `Reopens if`, or "would reopen": what the two sections gained holds
  `reopen`, `reopens`, `reopened` or `reopening` at least five times.

Example of one decision that meets its floor: "A fixture is never a person. A test camera's clip is drawn, or it is
recorded by a maintainer who agrees in writing to its use, and the fixture says which. Not taken: … Reopens if …"

### The owner's approval

"You approve them" is read as the design reads any decision that is yours: an approved proposal (Decisions' opening
lines; The edit guard). An approval is an annotated tag under `refs/tags/deep/approved/`, SSH-signed with a touch or a
biometric by a key that `.deepbuild/approvers` lists at the merge base of HEAD and `origin/main`, with one
`Approves: <path>` line per file. It approves, for each file it names, what the commit it sits on added to that file. A
line `Approves: <path> @<full commit ID>` approves that for the named commit instead, one the tagged commit is or
descends from, so one tag can cover several commits. The owner makes one as README.md's "Approve an edit to a check"
says:

```sh
git -c gpg.format=ssh -c user.signingkey=~/.ssh/deepbuild_approver tag -s deep/approved/3267 <commit> \
  -m 'Approves: docs/technical-design.md' -m 'Approves: docs/canvas-primitives.md' \
  -m 'Approves: docs/evidence/3267/pointing-line.txt'
git push origin refs/tags/deep/approved/3267
```

- What the owner signs is what `git show <commit>` prints for those files: the tag approves what that commit added
  to each file it names, and nothing a later commit adds.
- **The approved text** of a section is its sentences and table cells that an approved commit added to it (those the
  section holds at that commit and not at the commit's first parent) and that the section still holds. The second test
  judges the decisions' words, the five `Not taken` and the five `reopen` in the approved text alone.
- So the approval is bound to the text: a sentence reworded after the tag is no longer approved, and the test names
  it; a tag on a commit that added other sentences, or none, approves nothing here. A line a later issue adds beside the
  approved text doesn't disturb it.
- The simplest way to meet it: one commit holds the two docs' edits and the record below, and one tag sits on it. Work
  in several commits needs each commit that added a decision's sentences approved.
- A tag that is unsigned, signed by a key the list doesn't hold at the merge base, or signed without a touch or a
  biometric approves nothing, and the failure names it. The signature is checked with `ssh-keygen` itself.

### The follow-on issues

- **A follow-on issue** is an issue of `windoliver/deepbuild`, no pull request, with a higher number than #3267, not
  closed as not planned or as a duplicate, whose **body cites #3267**: `#3267`, `windoliver/deepbuild#3267` or the
  issue's URL. Example: a `### Depends on` line `- #3267 Design: a body's motion on the input track is personal data`.
- **How the test finds them:** it reads #3267's timeline (`gh api repos/windoliver/deepbuild/issues/3267/timeline`),
  where GitHub records each issue that cites it, and then each such issue with
  `gh issue view <n> --repo windoliver/deepbuild --json number,body,state,stateReason`. No list is kept in the repo.
- **Which thing a follow-on covers** is told by its body's words, taken from the criterion (any case). Each of the
  three things needs one follow-on whose body holds all of its words; one issue may cover several.

  | Thing | Words its follow-on's body holds |
  |---|---|
  | The class's mark and the named gestures on save, export and Join, with a planted save | `class`, `gesture`, `save…`, `export…`, `join…`, `hand` (or `hands`), `planted` |
  | A scan of everything that leaves the machine in a round played with hands, with a planted evidence writer | `scan…`, `leave…`, `machine`, `body`, `evidence`, `track`, `planted` |
  | #1186's clip replaced or its consent recorded | `#1186`, `clip`, and `replac…`, `drawn`, `rendered`, `consent…`, `agree…` or `in writing` |

- **"None changing an entry's layout"** is read by the design's own rule that a changed layout is a new major: a
  follow-on that covers one of the three things names none of `pen@`, `touches@`, `motion@`, `midi@` or `hands@` at a
  major other than 1, not even to rule it out.

### The line in #1186, #1187 and #1188, and the owner's word

- **A line pointing here** is a line of the issue's body that cites #3267, as above. A comment isn't read.
- **The record** is `docs/evidence/3267/pointing-line.txt`: plain text, each line not empty being a line one of the
  three bodies holds, character for character once both are trimmed. One line serves all three when they hold the same
  one. Example of the whole file:

  ```
  **Waits on:** #3267, which decides how a body's motion on the input track is held
  ```

- **The owner's word** is an approval, as above, that names the record: `Approves: docs/evidence/3267/pointing-line.txt`
  on the commit that added the line to it. Each of the three issues must hold a line citing #3267 that an approved
  commit added to the record and that the record still holds.
- **The criteria** of the three issues are held to `saved-criteria.json`: each criterion's ID (as
  `scripts/proof-change.mjs` computes it) and its first eight words, from the bodies saved on November 23 (SHA-256:
  #1186 `d01b1c49cc0bcc7574c7d3a77484670b6aa1f329ef30f9a97f61d83f59dbd7a0`, #1187
  `003eca65e8e7eb51b7c6847f08e26352ebf24553d93379060807354662c2ef48`, #1188
  `2ee6e99579cfaa25ced261f963cbe8650e1e90b43d8b38fe77fa9a03f06dba9e`). Every saved ID must still be the ID of a
  criterion in the live body. A ticked box or a new criterion changes none.

## Criteria and tests

Each ID is `#3267.` and the first 8 hex digits of the SHA-256 of the criterion's text, trimmed, white space collapsed.
Every test's title starts with `AC<n>` and that ID.

| Criterion | ID | Tests | What fails them |
|---|---|---|---|
| 1. The decisions are written into the technical design's Privacy section and the canvas primitives' device classes, each with what was not taken and what would reopen it, and you approve them | `#3267.5b43d7cf` | `ac1-decisions.test.mjs`, two tests. The first: both sections gained text, and it holds the five decisions' words, five `Not taken` and five `reopen`. The second: the same, judged in the text a signed approval covers | The base, where neither section gained a sentence. A decision left out, a section left as it was, a missing `Not taken` or `Reopens if`; no tag, an unsigned one, one by an unlisted key or with no touch, one that names one doc only, one made on other text |
| 2. The follow-on issues are filed, each citing this one and none changing an entry's layout: the class's mark and the named gestures; a scan of everything that leaves the machine; and #1186's clip | `#3267.426b9145` | `ac2-follow-ons.live.test.mjs`, one test | GitHub as it is today, where no issue filed after #3267 cites it. A thing with no follow-on, a follow-on that doesn't cite #3267, one closed as not planned, one that names `hands@2` |
| 3. #1186, #1187 and #1188 each gain a line pointing here, added by you or on your word, and none of their criteria is reworded by an agent | `#3267.c390821e` | `ac3-pointers.live.test.mjs`, one test: the criteria first, then the lines, then the owner's word | GitHub as it is today, where none of the three cites #3267. A criterion reworded, dropped or marked moved; an issue without the line; a line with no approval, or another line than the approved one |

## Readings where the issue and the design leave a choice

1. **"Written into" the two sections** means each gained sentences since the base, read where the issue's links land.
   The issue doesn't say which decision goes where, so only three words are tied to a section: `body` in each, since
   both must speak of a body's motion, and `personal data` in Privacy, since the Scope says "personal data under
   Privacy". Everything else is read in what the two gained together.
2. **Five decisions.** The Scope lists five answers and one line of what was not taken. The criterion says "each with
   what was not taken and what would reopen it", so the floor is five of each, as #1336 and #1352 count `Not taken`
   once per decision. The Scope's answers are "the draft's recommended answers": the floor holds the words an answer
   has to use whichever way it goes, and leaves out those only the recommended answer needs (a headset, a taste call).
3. **"You approve them" is a signature, not a record file.** #1336 and #1352 read a person's call from a
   `taste-call.json` bound to its text by SHA-256. This suite reads a second way, for three reasons. Their criterion
   was a taste call by "any one person on the project"; this one is the owner's approval of decisions, which the design
   gives one form, the approved proposal. A file in the tree is written by whoever writes the change, so a file alone
   would let an agent's word count (invariants 1 and 3; the READMEs of #569 and #2109 say the same). And a hash of a
   whole section would pin text that later issues will edit; the commit a tag sits on binds the approval to the
   sentences that commit added and to nothing else.
4. **"You"** is read as a person whose key `.deepbuild/approvers` lists, as the guard reads it. Code reads a key, not
   a GitHub login.
5. **A follow-on** is found by its citation alone, so nobody has to name it to the test, and it is told from any other
   issue that cites #3267 by covering one of the three things. A thing split over two issues isn't read as covered:
   one of them has to hold all of its words.
6. **"An entry's layout"** is a device class's frozen layout, the one the Scope says doesn't change. The class's mark
   sits on the class, not in its entries.
7. **"Added by you or on your word"** is read the same way for both: the line the issue holds is a line the owner
   approved. GitHub records only the account that made an edit, and an agent can act under the owner's sign-in, so
   who typed the line is not something code can know.
8. **"None of their criteria is reworded by an agent"** is read as: every criterion saved on November 23 is still
   there, word for word. Code can't tell who reworded one. A criterion the owner rewords, moves or drops later needs
   `saved-criteria.json` changed with it, by an approved proposal, as the guard asks of any edit to a test's expected
   values.

## Not asserted

- **What the text means.** Whether a word sits in a decision or in what was not taken, which decision a `Not taken`
  belongs to, whether the answers agree with the rest of the design. The owner's approval covers those.
- **The Decided table and the doc lanes.** No criterion names them.
- **Control and input track, and Device gate and capture.** The issue links them, and criterion 1 names only the
  other two sections.
- **A taste-call record,** and anything said in the pull request, a chat or a GitHub review.
- **Who typed a line or filed an issue,** and the edit history GitHub keeps.
- **A follow-on's worth:** whether its criteria are in the checked shape, whether its planted wrong case is the right
  one, and a layout changed under its major, which the design forbids and words alone can't show.
- **Criteria added** to #1186, #1187 or #1188, and any other part of their bodies.
- **#1639, #76 and #310.** No criterion reads them.

## Outside the inputs

Not fetched, and so not known to this job: whether the owner holds a key on `.deepbuild/approvers` today and can reach
it, and under whose sign-in `gh` runs in the shell that will run the live files. The suite needs the first and doesn't
depend on the second.

## On the base

Both offline tests fail on `5919c397` at their own assertion: neither section holds a sentence it didn't hold there.
The live tests' runs, and the planted texts, issue bodies and tags with their mutants, are in `BASE-FAILURE.txt`. The
planted inputs were judged in memory and never written into this checkout or onto GitHub.
