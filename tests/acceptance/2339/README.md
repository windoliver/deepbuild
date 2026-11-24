# Acceptance tests for #2339: the design states its principles once

These tests were drafted blind from issue #2339 (its body as of November 22), the design sections it links (Rules
every primitive follows, Built to be hard to get wrong, Decided; `node scripts/design-section.mjs --issue 2339`),
AGENTS.md and the base commit `2eaaeb0e6` (`origin/main`, no implementation). At the base I also read
`scripts/lanes.mjs` (the `design links and names` entry and the `checks` and `releaseLanes` it exports),
`scripts/design-links.mjs`, `scripts/doc-links.mjs`, `scripts/open-issues.mjs`, `scripts/proof-change.mjs` (for
`criterionId`) and `tests/acceptance/910/` and `tests/acceptance/1336/` for conventions. What `helpers.mjs` needs from
the scripts (GitHub's slug and heading text, link targets and their resolution) is copied, never imported; the lane is
reached only through its entry in `scripts/lanes.mjs`. Per AGENTS.md the implementing agent doesn't edit these tests;
a dispute goes to a blind redraft by this job.

## How to run them

```sh
node --test 'tests/acceptance/2339/*.test.mjs'                 # all, the live file included
node --test tests/acceptance/2339/ac*.test.mjs                 # offline only
```

Plain `node --test` files, no build and no `npm ci`: the design links lane imports only Node's own modules. They're
under `tests/acceptance/`, so the unit lane doesn't pick them up; run them by hand. The offline files take about a
second. `lane.live.test.mjs` reads the open issues once with `gh issue list --repo windoliver/deepbuild --state open
--limit 5000 --json number,body`, so it needs network and `gh` signed in (in a sandboxed agent shell gh may need the
sandbox off). Offline, signed out, or when the lane itself prints `INCONCLUSIVE`, its tests skip with a message
starting `INCONCLUSIVE:`; a skip is never a pass.

## The surface (my choice where the issue leaves it open)

- **The lane** is the one entry of `checks` in `scripts/lanes.mjs` whose name matches `/\blinks?\b/i` and not
  `/catalogue|drift/i` (today `design links and names`), as #910's and #1336's tests pick it. The tests run that
  entry's own `commands` in order with cwd at the tree under test, stopping at the first that fails, and read the
  exit status and the combined output. Like #1336 they don't go through `runLanes`, whose machine-wide throttle can
  hold a run for minutes; the lane's verdict is its commands' exit status. The issue's Runs-on line ("one text check
  in a lane that already runs") is why every rule here, the invariant match included, is asked of this one lane.
- **The open issues** reach the lane as `scripts/open-issues.mjs` reads them, a JSON file named in
  `DEEP_OPEN_ISSUES`. The live run hands it one real fetch. The planted runs hand it an empty list `[]`, and the
  scratch copy's `scripts/planned-names.txt` is emptied, since its entries name real open issues the empty list
  doesn't hold and the lane would fail each as stale. So the planted runs are offline and see only the docs.
- **The scratch copy** (one per planted test, under the OS temp folder, removed after) holds the checkout's top-level
  files (AGENTS.md among them), every file under `scripts/` and every `docs/*.md`, tracked or untracked but not
  ignored, with `node_modules` linked to the checkout's and a fresh `git init`. A lane that reads more than that
  isn't seen by these tests; say so in a dispute.
- **The control.** Each planted test first runs the lane on the unplanted copy and requires exit 0, so a planted
  failure is the plant's and not something already broken.

### The section

- **The section** is the one heading in `docs/technical-design.md`, outside fenced code and at any level, whose text
  is `Principles` (any case). More than one fails. Its body runs to the next heading of its level or higher. It must
  end before the heading "What version 0 builds, and what waits".
- **Its anchors** are the heading's GitHub slug (`principles`) and each `<a id>`/`<a name>` on the lines just above
  it, with only blank and anchor lines between.
- **A line of the section** is a top-level list item of its body (`-`, `*`, `+`, `1.` or `1)` at column 0-3), one
  physical line, as the design writes its lists. Prose such as an intro paragraph may sit in the body and isn't
  counted. Only a body with no list items at all has its non-blank prose lines read as its lines instead.
- **Characters** are counted on the line as it reads rendered: after the list marker, links and images by their
  label, code spans by their content, tags and bold markers dropped, white space collapsed. So a URL or anchor
  doesn't count toward the 160.
- **Sentences** are counted with each link and code span read as one lowercase word, splitting where `.`, `!` or `?`
  (optionally closed by a quote or bracket) is followed by space and a capital letter or an opening quote. So a
  trailing "(… link …, `check`)" after a full stop isn't a second sentence, and a following capitalised sentence is.
- **The invariants and "one sentence".** The issue asks the section to open with the four invariants word for word,
  and AGENTS.md's first two are two sentences each ("An agent's word is never evidence. Only check results are.").
  So the first four lines may hold as many sentences as their invariant does, counted the same way, and no more;
  every other line holds one.
- **A link into the design** is a link on the line (outside code spans) that resolves, as `scripts/doc-links.mjs`
  resolves links, to `docs/technical-design.md` or `docs/canvas-primitives.md` with an anchor. Whether the anchor
  lands is the lane's own existing job, which the live run checks.
- **"Opens with the four invariants"**: lines 1 to 4 each hold, in their rendered text, AGENTS.md's invariant of the
  same number, rendered the same way (backticks dropped on both sides), in AGENTS.md's order. Extra words around the
  invariant on its line (its link and check) are allowed.

### How a check is named

Used by criterion 3's offline test on the real section, and to make sure each planted line names what it should:

- Any `scripts/<path>` on the line, in code, a link target or text, with leading `./` or `../` allowed; it exists when
  it's a file in the tree.
- A code span or link label holding a file name (`*.mjs`, `.js`, `.cjs`, `.ts`, `.sh`, `.py`) that's a file in
  `scripts/`.
- A lane name from `checks` or `releaseLanes` in `scripts/lanes.mjs`, held whole by a code span or link label (a
  trailing " lane" allowed, any case), or written in the text as "`<name>` lane" / "<name> lane".

A line passes when it names at least one that exists and no `scripts/` path that doesn't.

### Naming

- **A section line** is named by an output line holding the doc's file name with the line's number in the doc
  (`technical-design.md:12`, `technical-design.md:3,12`, `technical-design.md line 12`, `#L12`), or its ordinal in
  the section (`line 5`, `item 5`, `principle 5`, `#5`, `5th`, `fifth`), or the first 30 characters of the planted
  line's text, raw or rendered.
- **The name** `scripts/no-such-check.mjs` is named when some output line holds `no-such-check.mjs`.
- **An invariant** is named by an output line holding "invariant" with its number or ordinal (`invariant 2`,
  `invariant #2`, `second invariant`), either file's line number for it in the form above (`AGENTS.md:10`,
  `technical-design.md:14`), or 20 characters of its text as either file has it, before or after the edit.
- **The canvas heading** is named by an output line holding `Conventions every primitive uses` (any case), its slug
  `conventions-every-primitive-uses`, its anchor `#conventions`, or `canvas-primitives.md` with the heading's line.

### The canvas link

"Conventions every primitive uses" in `docs/canvas-primitives.md` opens with the link when the first paragraph under
that heading, before its first subheading (lone anchor lines skipped), holds a link that resolves to
`docs/technical-design.md` with one of the section's anchors. The live run is "lands, by the same lane".

### Planted cases

Each is planted in place in the scratch copy, so no other line moves, built from the copy's own section so the
implementation's own format is kept:

| Case | How it's planted |
|---|---|
| Fifth line with no link | Line 5's links into the design docs become their labels; bare blob links into `docs/` drop. Its check stays. |
| Two sentences | The shortest line after the four invariants, its final full stop kept or added, gets " This is a second sentence." The test requires it to stay within 160 characters, so only the sentence rule can fail it. |
| Names `scripts/no-such-check.mjs` | The shortest line after the invariants has each check it names swapped for `scripts/no-such-check.mjs` (each `scripts/` path, each code span naming a lane or script file, each "<lane> lane"). If that doesn't leave exactly the missing script named, or runs over 160 characters, the line is replaced by ``A planted line held by `scripts/no-such-check.mjs` links [the rule](<its first design link>).`` |
| Names no check | The last line is replaced by `A planted line that holds nothing links [the rule](<its first design link>).`, checked to name no script and hold no lane name as a word. |
| AGENTS.md alone | AGENTS.md's "Nothing missing or unrun passes." becomes "Nothing missing or unrun ever passes."; the design is left as it is. |
| The design alone | "twice" in the section's fourth line becomes "again"; AGENTS.md is left as it is. |
| Canvas without the link | Each link from the "Conventions every primitive uses" opening to the section becomes its label. |

**At the base** the copy has no section to plant in, so `helpers.mjs` (`ensureSection`) first puts in a stand-in
section written for these tests, just above "What version 0 builds, and what waits": ten bulleted lines, the four
invariants word for word and six of the issue's drafted lines, each with a design link and a check named in a code
span. It's used only when the tree has no Principles section, so on a branch with the section it never runs; it's
there so the base run shows what the lane does with each planted case.

## Criteria and tests

Each tag is `criterionId` from `scripts/proof-change.mjs`: `#2339.` and the first 8 hex of the SHA-256 of the
`- [ ]` text, trimmed, white space collapsed. Every test name starts with its tag.

| Criterion | Tag | Tests |
|---|---|---|
| 1. The section sits before "What version 0 builds, and what waits", 8-12 lines, each one sentence of at most 160 characters with a link into the design, and the lane passes on it; planted fifth line with no link and a planted two-sentence line fail, naming the line | `#2339.2ae5a05d` | `ac1-section.test.mjs` (the real section); `ac1-planted.test.mjs` (two planted cases); `lane.live.test.mjs` first (the real lane on this checkout) |
| 2. The four invariants match AGENTS.md word for word, held by a text check that fails when either file is edited alone, naming the invariant | `#2339.a190c5fb` | `ac2-invariants.test.mjs`: the real section; AGENTS.md edited alone; the design edited alone |
| 3. Each line names a check that exists; a planted line naming `scripts/no-such-check.mjs` fails naming the line and the name; one naming no check fails naming the line | `#2339.b90141c9` | `ac3-checks.test.mjs`: the real section; the two planted lines |
| 4. The canvas reference's link to the section lands, by the same lane; a planted canvas reference without it fails, naming the heading | `#2339.6eaafe21` | `ac4-canvas.test.mjs`: the real link; the planted copy without it; `lane.live.test.mjs` second |

Not tested: the issue's Proof asks for "the section as rendered in the PR", which a person looks at. Whether each
line links "the section of the design that states the rule in full" in meaning, and whether its check is the one that
holds that rule, are read by a reviewer; the tests require a design link and an existing check, not the right ones.

## Readings where the issue leaves a choice

- "Between 8 and 12 lines" counts list items, so an intro sentence above the list is allowed and not counted.
- "At most 160 characters" is the rendered text, not the markdown source.
- "Each line names a check" accepts lane names from `releaseLanes` as well as `checks`, both lists the module exports.
- The live run requires the lane to exit 0 with today's open issues. A finding the lane prints about an open issue
  unrelated to this change would fail it too; that is a main-side break to fix, not a reason to read the run as passed.

## On the base

All 13 tests fail on `2eaaeb0e6` for the expected reasons: the real docs have no Principles section, and the lane
passes every planted case. See `BASE-FAILURE.txt`, which also lists the planted fix and the wrong programs run
against these tests in a scratch tree, never in this checkout.

## Files

- `helpers.mjs`: the markdown reading copied from `scripts/doc-links.mjs`, the section, the invariants, check names,
  the scratch copy, the lane runner, naming and planting.
- `ac1-section.test.mjs`, `ac1-planted.test.mjs`, `ac2-invariants.test.mjs`, `ac3-checks.test.mjs`,
  `ac4-canvas.test.mjs`: offline.
- `lane.live.test.mjs`: the real lane on this checkout with one fetch of the open issues.
- `BASE-FAILURE.txt`: the run on the base and the planted programs.

No fixture holds a secret or personal data.
