# Acceptance tests for #2339: the design states its principles once

Written first, blind, from issue #2339 ("The design states its principles once: a short section at the top of the
technical design, each line linking the rule it comes from and naming the check that holds it": its body, Scope, four
acceptance criteria and Proof, read with `gh issue view`), `docs/technical-design.md`, `docs/canvas-primitives.md`,
AGENTS.md, CONTRIBUTING.md and the base commit `2eaaeb0e6` (`origin/main`, no implementation). At the base I also read
`scripts/design-links.mjs`, `scripts/doc-links.mjs`, `scripts/open-issues.mjs`, `scripts/lanes.mjs` (its `checks` list
and `runLanes`), `scripts/proof-change.mjs` (`criterionId`) and the suites `1329/`, `910/`, `2338/` and `2340/` for the
house format, and `scripts/throttle.mjs` (why the lane runs without `runLanes`). No other branch, worktree or pull request was read. The scratch copy, fake `gh` and lane runner follow
1329's and 910's helpers; they're copied into `helpers.mjs`, never imported. Per AGENTS.md the implementing agent
doesn't edit these tests; a dispute goes to a blind redraft by this job (design: Dogfooding). Node's test runner and
built-ins only.

| AC | ID | File (tests) |
|---|---|---|
| AC1 | `#2339.2ae5a05d` | `ac1-section.test.mjs` (3: the real section and the lane on the real docs; the fifth line with no link; the line of two sentences) |
| AC2 | `#2339.a190c5fb` | `ac2-invariants.test.mjs` (3: the real section against AGENTS.md; AGENTS.md edited alone, then both; the design's copy edited alone) |
| AC3 | `#2339.b90141c9` | `ac3-checks.test.mjs` (3: the real section's checks; `scripts/no-such-check.mjs`; a line naming no check) |
| AC4 | `#2339.6eaafe21` | `ac4-canvas-link.test.mjs` (2: the real canvas link and the lane on the real docs; the canvas reference without the link) |

IDs are the repo's rule (`criterionId` in `scripts/proof-change.mjs`): `#2339.` and the first 8 hex digits of the
SHA-256 of each criterion's text after `- [ ] `, trimmed, white space collapsed, over the live issue body. Every test's
name starts with its ID and its AC number.

## Run

```sh
node --test 'tests/acceptance/2339/*.test.mjs'
```

They're `*.test.mjs` under `tests/acceptance/`, so the unit lane doesn't pick them up; run them by hand. All eleven are
offline: no network, no `gh` sign-in, no build, no `npm ci` (the design links lane reads no `dist/`). The four tests
that read only the real docs need nothing but Node. The others copy the checkout into a sandbox each (tracked files and
untracked files git doesn't ignore; the checkout must be a git repository) and run the design links lane one to three
times there, a few seconds a run; copying the checkout takes most of the time, about 15 to 50 s a test on a loaded
Mac. Each lane command has a 300 s limit; a stopped run's output ends with a `STOPPED:` line and the test fails.

## The surface (my choice where the issue leaves it open)

Every name and shape below that the issue doesn't give is a requirement of these tests on the implementation.

### The section

- **The section is the level-2 heading `## Principles`** (its rendered text exactly "Principles", any case) in
  `docs/technical-design.md`. "After the opening" is read as: the only heading before it is the doc's level-1 title.
  "Before What version 0 builds" is read as: the next heading after it is `## What version 0 builds, and what waits`.
  `<a id>`s before either heading are allowed.
- **A line of the section is a list item** (`-`, `*`, `+` or `1.` / `1)` markers), with any continuation line that
  follows it joined to it. Other text between the heading and the next heading (an introducing sentence, say) isn't a
  line and isn't checked. 8 to 12 lines are required.
- **The four invariants come first.** Lines 1 to 4 are invariants 1 to 4, in order: the line's rendered text (below)
  starts with the invariant's rendered text as AGENTS.md has it under "The four invariants", white space collapsed.
  What follows the invariant's words on its line (its link and its check) is free.
- **"At most 160 characters"** counts the line's rendered text in Unicode code points: the list marker dropped, each
  link and image by its label only (the URL doesn't count), each code span by its text, HTML tags and emphasis
  markers dropped, white space collapsed. It applies to every line, the four invariants' included.
- **"One sentence"** is at most one sentence end in the rendered text, code spans left out: a `.`, `!` or `?` (with any
  closing quote or bracket) followed by white space or the end of the line. So a line must not hold "e.g. " or a
  second sentence; `scripts/proof.mjs` in a code span isn't a sentence end. The four invariant lines are exempt,
  because invariants 1 and 2 are two sentences each in AGENTS.md and the Scope asks for them word for word; the Scope's
  "one sentence each" is about the lines after them.
- **"A link into the design"** is a markdown link (or a bare `https://github.com/windoliver/deepbuild/blob/main/…`
  link) on the line, outside code spans, to `docs/technical-design.md` or `docs/canvas-primitives.md` with a non-empty
  anchor: `#anchor` (the same doc), `canvas-primitives.md#anchor`, `./technical-design.md#anchor`, or the blob URL. That
  it lands is the design links lane's job, which already checks every link in the docs.
- **"Names a check".** A check is named in a code span or a link: a code span whose first word is a path under
  `scripts/` (`` `scripts/proof.mjs` ``, `` `scripts/canvas-closures.mjs drift` ``), a link to a path under `scripts/`
  (`../scripts/proof.mjs` or the blob URL), or a code span whose whole text is a lane name in the `checks` list
  `scripts/lanes.mjs` exports (`` `unit` ``, `` `design links and names` ``). The lane names come from importing the
  checkout's own `scripts/lanes.mjs` in a child process. A script exists when it is a file in the checkout. A lane named
  in plain words ("the proof lane") isn't recognized. Real-doc test: every line names at least one check that exists,
  and no line names a `scripts/` path that isn't a file. Invariant 2's `` `BLOCKED` ``, `` `PASS` `` and the like are
  code spans that name no check; the lane must not read them as missing checks.
- **The canvas link.** The first non-blank line under `## Conventions every primitive uses` in
  `docs/canvas-primitives.md`, before its first subheading (`<a id>`-only lines skipped), holds exactly one link to the
  Principles section: a link resolving to `docs/technical-design.md` whose anchor is the heading's slug or an `<a id>`
  right before it.

### The lane

- **The text checks are the design links lane's.** The issue says "The design links lane reads the section" and that
  the canvas link lands "by the same lane"; for criterion 2's text check, which the issue doesn't place, the Runs on
  line's "one text check in a lane that already runs" is read as that lane too. The lane is the one entry of `checks`
  in `scripts/lanes.mjs` whose name matches `/\blinks?\b/i` and not `/catalogue|drift/i`, as #910's and #1329's suites
  pick it (`design links and names` at the base).
- **The tests run the lane's own commands.** A child `node` with cwd at the scratch copy imports the copy's own
  `scripts/lanes.mjs` and reads that lane's `commands`; each then runs in order with cwd at the copy, stopping at the
  first that exits non-zero, with `DEEP_OPEN_ISSUES` naming a file in the sandbox not yet written (as `runLanes` names
  one per run, so the lane fetches the open issues through `gh` and keeps them there). They don't go through
  `runLanes` itself, unlike 1329's and 910's suites: `runLanes` puts each command behind the machine's throttle, whose
  one `build` slot another session's build held for over an hour while this suite was drafted, so each of the 17 lane
  runs could wait 30 minutes and read `BLOCKED`. What `runLanes` adds (throttle, lease, tree record, the verdict line)
  isn't what this issue changes.
- **The verdict, read as `runLanes` reads it.** A pass is every command exiting 0. A fail is a command exiting
  non-zero whose first output line starting with a state word (`FAIL`, `BLOCKED`, `INVALID`, `INCONCLUSIVE`) starts
  with `FAIL`, so a doc fault must print a `FAIL …` line before any other state, as `scripts/design-links.mjs` does at
  the base. `BLOCKED`, `INCONCLUSIVE`, a crash with no state line, or a stopped run (300 s a command) is neither.
- **Naming a line of the section.** One output line holds any of: the file line as `technical-design.md:<n>` (also in a
  list such as `technical-design.md:14, 16`, or `technical-design.md line <n>`); the word "Principles" and `line <k>`,
  with `k` the line's place in the section (5 for the fifth); or the first 30 characters of the line's rendered text.
  For `scripts/no-such-check.mjs`, that same output line must also hold `no-such-check.mjs`.
- **Naming the invariant.** One output line holds `invariant <n>` (or `invariant #<n>`, any case), the invariant's
  line as `AGENTS.md:<line>`, or the first 30 characters of the invariant's rendered text as AGENTS.md has it (the
  planted edits keep those 30 characters, so a lane printing either file's version matches).
- **Naming the heading.** One output line holds `Conventions every primitive uses`, its slug
  `#conventions-every-primitive-uses`, its `<a id>` `#conventions`, or `canvas-primitives.md:<line of the heading>`.

### The planted docs (`helpers.mjs`)

All plants are made in the scratch copy, never in the checkout; the checkout's AGENTS.md (whose four invariants are
guarded decisions) is never edited by this suite.

- **The planted section** (`plantedLines`) is `## Principles` and ten numbered lines (`1.` to `10.`). Lines 1 to 4 are
  the copy's own four invariants, copied from its AGENTS.md as written, each followed by a parenthesis holding a link
  and a check, such as `([How runs become one of five verdicts](#how-runs-become-one-of-five-verdicts),
  `scripts/proof.mjs`)`. Lines 5 to 10 are six of the issue's drafted principles, one sentence each, each with a link to
  a real heading or `<a id>` of the base's design (`#prim-rules`, `#built-to-be-hard-to-get-wrong`, `#decided`,
  `#how-runs-become-one-of-five-verdicts`, `#cut-or-deferred`) and a real check (`scripts/canvas-lint.mjs`,
  `scripts/repo-rules.mjs`, the lane `unit`, `scripts/proof-change.mjs`, `scripts/wait-ratchet.mjs`,
  `scripts/design-links.mjs`). Each is at most 160 characters as counted above. It replaces the copy's own Principles
  section when there is one (heading and body, up to the next heading's `<a id>`s), or goes right before `## What
  version 0 builds, and what waits` and the `<a id="scope">` above it.
- **The planted canvas opening** (`plantConventionsOpening`) replaces whatever sits between `## Conventions every
  primitive uses` and `### Time and the flick` with one line linking `technical-design.md#principles`, or with nothing
  for criterion 4's plant.
- **Planted faults**, one per test, each against the twin above that the same test first shows passing:

| Test | Plant |
|---|---|
| AC1, fifth line | line 5 becomes `Agents and plug-ins write data, not code, as `scripts/canvas-lint.mjs` holds.` (no link) |
| AC1, two sentences | line 7 becomes `The same input gives the same bytes. A rerun matches the first run byte for byte ([Decided](#decided), `unit`).` |
| AC2, AGENTS.md alone | the copy's AGENTS.md invariant 3 reads `… checks or verdicts.` for `… checks or decisions.`; then the section's line 3 the same, which must pass |
| AC2, the design alone | the section's invariant 2 reads `never a `PASS`` for `never `PASS`` |
| AC3, no such check | line 9 names `scripts/no-such-check.mjs` for `scripts/wait-ratchet.mjs` |
| AC3, no check | line 8 keeps its link and loses its check |
| AC4 | the Conventions opening is empty |

- **The copy's tracker.** The design links lane reads the open issues. A fake `gh` first on `PATH` serves three clean
  open issues (#9901 to #9903, made up), each linking a real heading of the base's docs and naming no `deep` command or
  agent tool; it answers `gh issue list … --json`, `gh auth status` and `gh --version` and fails anything else. The
  copy's `scripts/planned-names.txt` is emptied (a comment line only), because the checkout's entries name real issues
  the fake tracker doesn't hold and the lane would fail them as stale. `HOME`, `TMPDIR` and the XDG folders are in the
  sandbox; the GitHub token and host variables, `DEEP_OPEN_ISSUES`, `DEEP_PREFLIGHT` and git's `GIT_DIR`-style
  variables aren't inherited. The copy has no `.git`.

## Readings where the issue leaves a choice

- **"Each one sentence"** versus invariants 1 and 2 being two sentences: see above; the invariant lines are held to
  AGENTS.md word for word instead.
- **"Fails when either file is edited alone"** is read as comparing the two files: an edit to AGENTS.md alone fails,
  and the same edit made to both passes again. A lane that hard-codes the invariants fails the second half.
- **"The lane passes on the real docs"** is proven on a copy of the checkout with the fake tracker above, not on the
  live open issues: the issue's criterion is about the section, and the live issues' own links aren't this change's.
  The positive case runs in AC1's and AC4's first tests.
- **Between 8 and 12 lines** is checked on the real section only; no test plants a section of 7 or 13 lines, since the
  criterion names no such plant.
- **Proof's "section as rendered in the PR"** isn't a test.

## How each test fails on the merge base

The proof's before lane needs each tagged test to fail at an assertion on the merge base. On the base there is no
Principles section and the lane doesn't read one:

- The four real-doc tests (AC1, AC2, AC3 and AC4 first tests) fail at their first assertion, `docs/technical-design.md
  has no level-2 heading "Principles"`, before any copy is made.
- The seven planted tests first run the twin, which the base lane passes (its links land and it checks nothing else),
  and then the plant, which the base lane also passes, so they fail at `the design links lane doesn't FAIL …`.
  `BASE-FAILURE.txt` holds that run.

## Files

- `helpers.mjs`: the markdown reading (section, lines, rendered text, sentences, links, named checks, invariants), the
  planted section and canvas opening, the scratch copy, the fake `gh`, the sandboxed environment and the lane runner.
- `ac1-section.test.mjs`, `ac2-invariants.test.mjs`, `ac3-checks.test.mjs`, `ac4-canvas-link.test.mjs`: one file per
  criterion.
- `BASE-FAILURE.txt`: the run on the base, and the planted fix the harness was checked against in a scratch copy.

No fixture holds a secret or personal data; issue numbers 9901 to 9903 are made up.
