# Blind redraft of four files of #2339's acceptance suite

This folder stands in for four files of `tests/acceptance/2339/`: `ac1-planted.test.mjs`, `ac2-invariants.test.mjs`,
`ac3-checks.test.mjs` and `ac4-canvas.test.mjs`. It holds every test they hold, ten in all, under the same criterion
IDs. `ac1-section.test.mjs` and `lane.live.test.mjs` aren't redrafted and stay as they are.

It was drafted blind, as the design's Dogfooding rule asks of a redraft: by a fresh run of the job that writes the
tests, from the issue, the design and the base commit `9e77c2ad6` (main; its last merge is #3450). The job saw no
diff, no other work and no discussion of the first draft, and wasn't told why a redraft was asked for. Per AGENTS.md
nobody edits these files.

The issue's work is on the base, so all ten tests pass there, and each fails on a wrong program made outside the
checkout. `BASE-RESULTS.txt` holds both.

## What was read

- Issue #2339 as saved on November 25 (closed as completed on November 23; `type:chore`, `area:docs`; no comments):
  its opening paragraphs, its Scope with the "Not in this task" line, its `Runs on:` line, its four criteria and its
  Proof.
- `docs/technical-design.md`: Principles, which the issue's work wrote; the three sections the issue links (Rules
  every primitive follows, Built to be hard to get wrong, and Decided, of which the head and first rows); in How we
  know version 0 works, Criteria to tests, Closed issues stay proven, Criteria in a checked shape, Wrong programs, The
  edit guard and Dogfooding; and Landing in turn, for where main is watched. `docs/canvas-primitives.md`'s opening and
  "Conventions every primitive uses". `AGENTS.md` and `CONTRIBUTING.md`.
- At the base: `scripts/design-links.mjs`, `scripts/principles.mjs`, `scripts/doc-links.mjs` and
  `scripts/open-issues.mjs`; `scripts/lanes.mjs` (`checks`, `releaseLanes`, the `design links and names` entry) and
  `scripts/lanes-lists.mjs` (`byHand`, and how earlier redrafts are listed); `scripts/proof-change.mjs` (`TAG`,
  `tagsIn`, `isTestFile`, `criterionId`); `scripts/affected.mjs` (how it leaves `byHand` files out);
  `scripts/wait-ratchet.mjs`, `scripts/repo-rules.mjs` and `tests/takes-timed.test.mjs` (what they hold a test file
  to).
- The first draft, `tests/acceptance/2339/`: its README, its helpers, its `BASE-FAILURE.txt`, the four files
  redrafted here and the two that stay. For conventions, the helpers of the lane's other suites:
  `tests/acceptance/910/`, `1329/`, `2338/` and `2405/`.

Nothing was needed from outside the checkout and the saved issue, and nothing outside them was read, with one slip:
`git rev-parse origin/main` was run once and printed the commit that ref names. Nothing of that commit was read, and
no test or reading here rests on it.

What `helpers.mjs` needs of the scripts (the lines outside fenced code, GitHub's slug, a heading's text, a line's link
targets and where a target lands) is copied from `scripts/doc-links.mjs` as the base has it, each piece read against
the base, and never imported. The lane is reached only through its entry in `scripts/lanes.mjs`.

## How to run

```sh
node --test tests/acceptance/2339/redraft-1876/ac1-planted.test.mjs      # 2 tests
node --test tests/acceptance/2339/redraft-1876/ac2-invariants.test.mjs   # 3 tests
node --test tests/acceptance/2339/redraft-1876/ac3-checks.test.mjs       # 3 tests
node --test tests/acceptance/2339/redraft-1876/ac4-canvas.test.mjs       # 2 tests
```

Plain `node --test` files on Node's own modules (Node 24): no build, no `npm ci`, no network and no `gh`. They need
`git` on PATH and a checkout that is a git work tree, since git lists the files to copy. They take their paths from
their own place, so the working folder doesn't matter. They're under `tests/acceptance/`, so they run by hand or
through `scripts/affected.mjs`.

Each file makes one scratch copy of the checkout's whole tree under the OS temp folder, when its first planted test
starts, and removes it when its tests end. On the machine of the base run (macOS on Apple silicon, shared with other
sessions, the temp folder on the checkout's volume, so each of some 24,600 files is a clone) a file took 10 to 27 s,
most often 11 to 15: 6 to 12 s to make the copy, 3 to 4 s to remove it, and about 0.3 s for each run of the lane.
With the machine busy the copy took up to 20 s. Where the temp folder is on another volume each file is copied in
full, and a run takes longer. The three tests of the tree (below) make no copy; one alone takes under a second:
`node --test --test-name-pattern='<words of its title>' <file>`.

No test skips. A copy that can't be made, a lane that can't be told or didn't run to its end, a section, an invariant
or a heading that can't be found, and an unplanted copy the lane doesn't pass each fail the test, naming it.

## The surface under test

- **The lane** is the one entry of `checks` in the copy's `scripts/lanes.mjs` whose name matches `/\blinks?\b/i` and
  not `/catalogue|drift/i` (`design links and names` at the base). A test runs that entry's own `commands` in order
  (one at the base, `node scripts/design-links.mjs`) with the working folder at the copy's root, stopping at the first
  that fails. It doesn't go through `runLanes`, whose machine-wide throttle can hold a run for minutes.
- **Its environment** is the caller's, with `DEEP_OPEN_ISSUES` naming a file that holds `[]`, as
  `scripts/open-issues.mjs` reads the open issues. The variables that point git at another repository (`GIT_DIR` and
  the like) and the test runner's own `NODE_TEST_CONTEXT` aren't passed on. Nothing else is fenced: a lane that reads
  the machine's home or calls `gh` isn't kept from it.
- **What a test reads of a run**: its exit status; whether a line of its output starts `FAIL`; and one finding, the
  line that names what the criterion says is named. A finding is any line of the output but a `Fix:` line, which says
  how to repair and names nothing. The counts on the `FAIL` line, the other findings and the `Fix:` lines aren't read.
  An exit other than 0 with no `FAIL` line (a crash, `INCONCLUSIVE`) is not a failure of the plant, and fails the
  test as that.
- **The scratch copy** holds every file `git ls-files -z -co --exclude-standard` lists in the checkout: each tracked
  file and each untracked file git doesn't ignore, a regular file cloned (`COPYFILE_FICLONE`) and a symbolic link
  kept a link. So it is the whole tree, these tests and every other suite too, never a selection of folders: no
  criterion says which files the lane reads, and a later lane may read more than today's. A listed path the working
  tree no longer holds is left out, as it is in the checkout. Ignored files (`target/`, each `dist/`) aren't copied;
  `node_modules` is linked to the checkout's when it has one. The copy gets a fresh `git init` and no commit. Its
  `scripts/planned-names.txt` is emptied, since its entries name real open issues the empty list doesn't hold.
- **One copy a file.** A planted test first puts back what the test before it wrote, byte for byte, then runs the
  lane on the unplanted copy and requires exit 0, so a failure after its plant is the plant's. What it writes is put
  back when it ends.

## The ten tests

Each title starts with its criterion's ID, as `criterionId` in `scripts/proof-change.mjs` computes it from the
criterion's text: `#2339.` and the first 8 hex digits of its SHA-256, trimmed, white space collapsed. The titles are
shortened here: each planted one says "fails the design links lane". The wrong programs are in `BASE-RESULTS.txt`
under the names given here.

| Test | Criterion | What it does | Fails on |
|---|---|---|---|
| `ac1-planted`: a planted section whose fifth line has no link into the design fails the lane, naming the line | 1, `#2339.2ae5a05d` | Replaces the section's fifth line with a planted line that names a check and links nothing; the lane must fail and a finding must name the line | A lane with no link rule (L0, L1); findings that name no place (L8); a crash (L11) |
| `ac1-planted`: a planted line of two sentences fails the lane, naming it | 1, `#2339.2ae5a05d` | Replaces the fifth line with a planted line of two sentences that links the design and names a check | A lane with no sentence rule (L0, L2); L8; L11 |
| `ac2-invariants`: the section opens with the four invariants, each word for word as `AGENTS.md` has it | 2, `#2339.a190c5fb` | Reads the checkout's design and `AGENTS.md` | The design edited alone (D1); `AGENTS.md` edited alone (D2); a section that opens with another line (D3) |
| `ac2-invariants`: `AGENTS.md` edited alone fails the lane, naming the invariant | 2, `#2339.a190c5fb` | Takes one word out of invariant 2 in the copy's `AGENTS.md` | A lane with no invariant rule (L0, L3); a finding that names no invariant (L10) |
| `ac2-invariants`: the design edited alone fails the lane, naming the invariant | 2, `#2339.a190c5fb` | Takes one word out of invariant 4 in the section's fourth line | L0, L3, L10 |
| `ac3-checks`: each line of the section names at least one check that exists and none that doesn't | 3, `#2339.b90141c9` | Reads the checkout's design, `scripts/` and the lanes `scripts/lanes.mjs` lists | A line that names no check (D4); a line that names `scripts/no-such-check.mjs` beside its own check (D5) |
| `ac3-checks`: a planted line naming `scripts/no-such-check.mjs` fails the lane, naming the line and the name | 3, `#2339.b90141c9` | Replaces the fifth line with a planted line whose only check is that script | A lane that takes any `scripts/` path for a check (L0, L5); a finding without the name (L4); findings that name no place (L8); a tree that holds the script (X1) |
| `ac3-checks`: a planted line naming no check fails the lane, naming the line | 3, `#2339.b90141c9` | Replaces the fifth line with a planted line that links the design and names nothing | A lane with no names-a-check rule (L0, L6); L8 |
| `ac4-canvas`: the canvas reference's "Conventions every primitive uses" opens with a link to the section | 4, `#2339.6eaafe21` | Reads the checkout's canvas reference and design | No link (D6); the link under the first subheading (D7); a link to another section (D8) |
| `ac4-canvas`: a planted canvas reference without the link fails the lane, naming the heading it belongs under | 4, `#2339.6eaafe21` | Turns each link to the section under that heading into its label | A lane with no canvas rule (L0, L7); a finding that names the file and not the heading (L9) |

## Readings

Where the issue leaves a choice, these are the readings. Each says whether it is the first draft's.

### The section and its lines

- **The section** is the first heading in `docs/technical-design.md`, outside fenced code and at any level, whose text
  is `Principles` (any case). Its body runs to the next heading of its level or higher. Kept, but for a second such
  heading: the first draft failed on one, and here the first is read, since no criterion of these four files says
  there is one only. Where the section sits is `ac1-section.test.mjs`'s to assert.
- **Its anchors** are the heading's slug (`principles`) and each `<a id>` or `<a name>` on the lines just above it,
  with only blank and anchor lines between. Kept.
- **A line of the section** is a top-level list item of its body (`-`, `*`, `+`, `1.` or `1)` at column 0 to 3), one
  physical line. Prose in the body, such as the paragraph above the list at the base, is not a line. Only a body with
  no list item has its non-blank prose lines read instead. Kept, as `ac1-section.test.mjs` still reads it.
- **Opens with the four invariants**: lines 1 to 4 each hold, in their text as it reads rendered, `AGENTS.md`'s
  invariant of the same number rendered the same way: code spans by their content, links by their label, bold marks
  dropped, white space collapsed. Words around the invariant on its line, its link and its check, are allowed. The
  invariants are the lines numbered 1 to 4 under `AGENTS.md`'s heading "The four invariants". Kept.
- **A link into the design** is a link on a line, outside code spans, that resolves as `scripts/doc-links.mjs`
  resolves links to `docs/technical-design.md` or `docs/canvas-primitives.md`, with an anchor. Kept. It is used only
  to choose the link a planted line keeps: the replaced line's first into the technical design, else its first into
  the canvas reference.
- **Characters and sentences** aren't read here. The first draft counted both, to choose a line to plant in and to
  check its plant. The planted lines below are written whole by the tests: 64 to 103 characters as they read, plain
  sentences that end in a full stop.

### How a check is named

Used by the test of the tree, and to show each planted line names what it should. Kept from the first draft, but as
marked.

- A script: each `scripts/<path>` on the line, in code, a link's target or the text, after `./` or `../` or this
  repository's blob address. It exists when it is a file under `scripts/` of the tree. Changed in one case: a path
  with a folder before it, such as `packages/x/scripts/y.mjs`, is not read as `scripts/y.mjs`.
- A script by its file name: a code span or a link label that is the name of a file in the tree's `scripts/`.
  Changed: any extension, since the criterion says "a file under `scripts/`".
- A lane: a name that a code span or a link label holds whole (a trailing " lane" allowed, any case), or that the
  text gives as "<name> lane". The names are those of every list of lanes `scripts/lanes.mjs` exports: each exported
  array whose entries all have a name and commands, `checks` and `releaseLanes` at the base. Changed from those two
  by name, so a list a later main adds or renames is read too.
- A line passes when it names at least one that exists, and no `scripts/` path that doesn't. A lane that doesn't exist
  can't be told from any other code span, so it isn't looked for.

### Naming

- **A line of the section** is named by a finding that holds the doc's file name with the line's number in the doc
  (`technical-design.md:17`, `technical-design.md:3,17`, `technical-design.md#L17`, `technical-design.md line 17`,
  `technical-design.md (line 17`); or the line's ordinal in the section (`line 5`, `item 5`, `principle 5`, `5th`,
  `fifth`); or 30 characters in a row of the planted line, raw or rendered. Kept, with three changes: a bare `#5` no
  longer names line 5, since it reads as an issue's number; any 30 characters in a row rather than the first 30; and
  `(line 17` after the file's name.
- **The name** `scripts/no-such-check.mjs` is named by a finding that holds `no-such-check.mjs`. Kept.
- **An invariant** is named by a finding that holds the word "invariant" with its number (`invariant 2`,
  `invariant #2`, `second invariant`, `2nd invariant`); or either file's name with the invariant's line in it
  (`AGENTS.md:10`, `technical-design.md:14`); or 20 characters in a row of the invariant as either file words it,
  before or after the edit, raw or rendered. Kept, with one change: a number before the word needs its ordinal
  ending, since "4 invariants" is a count and names none.
- **The canvas heading** is named by a finding that holds `Conventions every primitive uses` (any case); or its slug,
  `conventions-every-primitive-uses`; or an `<a id>` that lands on it, written `#<id>` (`#conventions` at the base);
  or `canvas-primitives.md` with the heading's line. Kept; the anchor is read from the copy, not written in the test.

### The canvas link

"Conventions every primitive uses" opens with the link when the first paragraph under that heading, before the next
heading of any level and with lone anchor lines skipped, holds a link that resolves to `docs/technical-design.md`
with one of the section's anchors. Kept.

### The plants

Each plant is made in the copy, in place, so no other line moves.

| Case | The plant | Against the first draft |
|---|---|---|
| Fifth line with no link | The fifth line is replaced, after its own list marker, by ``A planted sentence is held by `scripts/lanes.mjs` and points at no section.`` | Changed. The first draft turned the line's own links into their labels. At the base that leaves "Sentence. (label; check)", for which the base's lane prints two findings, no link and two sentences (`BASE-RESULTS.txt`, section 3). So the plant breaks two rules there, and a lane with no link rule would still fail it. A line the test writes breaks one. |
| Two sentences | The fifth line is replaced by ``A planted sentence points at [its section](<target>) and is held by `scripts/lanes.mjs`. This is its second sentence.`` | Changed, to plant as the other lines are planted. The first draft added a sentence at the end of the shortest line, so what its plant broke depended on how the section writes its lines. |
| Names `scripts/no-such-check.mjs` | The fifth line is replaced by ``A planted sentence points at [its section](<target>) and is held by `scripts/no-such-check.mjs`.`` | Changed in part: the first draft swapped the line's own checks first and wrote such a line only when the swap didn't hold. |
| Names no check | The fifth line is replaced by `A planted sentence points at [its section](<target>) and is held by nothing.` | Kept, on the fifth line rather than the last. |
| `AGENTS.md` alone | The second word of invariant 2 is taken out of its line in the copy's `AGENTS.md` ("Nothing or unrun passes. …" at the base). | Changed. The first draft held invariant 2's words in the test, so an approved rewording of both files would have left it nothing to edit. |
| The design alone | The second word of invariant 4 is taken out of the section's fourth line ("A sees only what needs a person, …" at the base). | Changed, for the same reason. Taking a word out can't carry the line past 160 characters or add a sentence, so only the invariant can fail it. |
| Canvas without the link | Each link from under "Conventions every primitive uses", up to the next heading, to the section becomes its label. | Kept. |

`<target>` is a link into the design the replaced line holds, so the lane has passed it on that line.
`scripts/lanes.mjs` is the file under `scripts/` the issue itself names, so every tree that can run these tests holds
it. Each planted line is one plain sentence (or two) in the simplest form the issue's rules allow, and differs from a
line that holds them all in one thing. At the base the same line with nothing wrong passes the lane
(`BASE-RESULTS.txt`).

Before it plants, a test checks its own line by the reading above: that it names `scripts/lanes.mjs` alone and the
copy holds it, or `scripts/no-such-check.mjs` alone and the copy lacks it, or no check and no lane's name among its
words.

### Other changes from the first draft

- **The copy** was one per planted test and held the checkout's top-level files, `scripts/` and `docs/*.md`. Here it
  is the whole tree, one a file (The surface, above).
- **A `FAIL` line** is required beside the exit status, and a `Fix:` line is no finding. The first draft read the
  exit status and any line of the output.
- **The stand-in section** the first draft's helpers wrote into a base without one is gone: the section is on the
  base, and a tree without one fails each test, naming it.

## What isn't asserted

- Where the section sits, its 8 to 12 lines, and each line's one sentence, 160 characters and link:
  `ac1-section.test.mjs` asserts them. That the lane passes on this checkout with the real open issues, and that the
  canvas link lands: `lane.live.test.mjs` does. Here the lane must pass on the unplanted copy with no open issues.
- What a finding says is wrong, the counts on the `FAIL` line, the `Fix:` lines, and which status other than 0 the
  lane exits with. A later lane may print other findings beside the one a criterion names.
- That a planted line with nothing wrong passes the lane. The issue states no form for a line beyond its rules, so a
  lane stricter than the issue isn't failed for it; the base run records that the base's lane passes it.
- A line that names a lane that doesn't exist. The issue's Scope has the lane fail it, but no criterion plants it.
- Which files the lane reads, and that it reads nothing of the machine outside the copy.
- Whether each line links the section that states its rule and names the check that holds it. A reviewer reads that;
  the tests require a link into the design and a check that exists. The issue's Proof also asks for "the section as
  rendered in the PR", which a person looks at.

## What the caller adds outside the folder

One entry, and nothing in this folder depends on it. The first draft's four files run by hand once this folder runs
in their place. That list is `byHand`, which `scripts/lanes.mjs` exports and `scripts/affected.mjs` reads; its entries
are written in `scripts/lanes-lists.mjs`, each with a comment that says why, as earlier redrafts are listed there
(#83's `status.test.ts`, #1334's `contract.test.mjs`):

```js
byHand.push(...['ac1-planted', 'ac2-invariants', 'ac3-checks', 'ac4-canvas'].map((f) => `tests/acceptance/2339/${f}.test.mjs`));
```

The comment above it names this folder, `tests/acceptance/2339/redraft-1876/`, and the reason the redraft was asked
for, which this job wasn't told. The files of this folder go on no list: they time nothing, build nothing and take
well under two minutes, so they run in the parallel block.

## Files

- `helpers.mjs`: the markdown reading copied from `scripts/doc-links.mjs`; the section, the invariants, the
  conventions and the checks a line names; the lanes of `scripts/lanes.mjs`; the scratch copy and a run of the lane;
  naming.
- `ac1-planted.test.mjs`, `ac2-invariants.test.mjs`, `ac3-checks.test.mjs`, `ac4-canvas.test.mjs`: the ten tests.
- `BASE-RESULTS.txt`: the run on the base, what the base's lane printed for each plant, and each wrong program with
  the tests it fails.

No file holds a secret or personal data, and a home folder is written `~`.
