# Acceptance tests for #2338: the design can be read a section at a time

Written first, blind, from issue #2338 ("The design can be read a section at a time: AGENTS.md asks for the sections an
issue links, one script prints a section by its anchor, and a section's size only drops": its report, Scope, five
acceptance criteria and Proof, as the brief gave its body; it has no comments), the design and the base commit
`58d3e19ee3e956709c1570b87c098350e285a19a` ("Merge pull request #2914 …"), by a job that never saw an implementation;
none existed. No other branch, worktree or pull request was read, nor GitHub, and the real `gh` never ran. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding). Node's test runner and built-ins only.

| AC | ID | File (tests) |
|---|---|---|
| AC1 | `#2338.c7574234` | `ac1-sections.test.mjs` (1) |
| AC2 | `#2338.19700c5a` | `ac2-unknown-anchor.test.mjs` (1) |
| AC3 | `#2338.64ab4593` | `ac3-issue.test.mjs` (2: the three sections once each, and BLOCKED without the issues) |
| AC4 | `#2338.1a6db6b6` | `ac4-ceilings.test.mjs` (5: the checkout's ceilings and line, 1 KB grown, new over the limit, ceiling raised, shrunk and lowered) |
| AC5 | `#2338.a3eb5a70` | `ac5-reading-rule.test.mjs` (2: the checkout's two files and the lane's check, and one file edited alone) |

IDs are the repo's rule (`criterionId` in `scripts/proof-change.mjs`): `#2338.` and the first 8 hex digits of the
SHA-256 of each criterion's text after `- [ ] `, trimmed, white space collapsed, over the body the brief gave; the live
issue wasn't read, so they aren't checked against it. Each test's name starts with its ID and its AC number.

## What was read

- The issue body, `AGENTS.md`, `CONTRIBUTING.md`, and in `docs/technical-design.md` (by headings and small ranges
  only): How we know version 0 works (Criteria to tests, both ways; Wrong programs; Dogfooding; Failing on an
  assertion) and Built to be hard to get wrong (Tests written first).
- At the base: `scripts/doc-links.mjs` (the anchor code the design links lane uses: `prose`, `anchors`, `targets`,
  `resolve`), `scripts/design-links.mjs`, `scripts/open-issues.mjs` (the shared open-issue fetch and its
  `DEEP_OPEN_ISSUES` file), `scripts/size-ratchet.mjs` and `scripts/size-ceilings.json` (the rule the doc ceilings
  mirror, and how it reads the merge base with origin/main), `scripts/repo-rules.mjs`, `scripts/lanes.mjs` (the `lint`
  lane's commands), `scripts/proof-runs.mjs` (`atAssertion`) and `scripts/proof-change.mjs` (`criterionId`); the
  suites `2340/`, `1432/` and `910/` for the house format.
- The two design docs at `4503c6f5` (an ancestor of the base, which the issue names), only to count their headings'
  own text: see "Readings".

## Run

```sh
node --test 'tests/acceptance/2338/*.test.mjs'
# on a shared machine, through the throttle:
node scripts/throttle.mjs test --wait 30 -- node --test 'tests/acceptance/2338/*.test.mjs'
```

They're `*.test.mjs` under `tests/acceptance/`, so the unit lane doesn't pick them up; run them by hand. All eleven are
offline: no network, no `gh` sign-in, no build, no `node_modules`. They need Node (the repo's 24.22 or newer), `git`
(AC4's scratch repositories) and `/bin/sh` (the `gh` stand-in). About seven seconds for the suite. Each scratch copy
is under the OS temp folder and removed after its test. Two tests (AC4's first and AC5's first) run a lint-lane
command with its working folder at the checkout itself; those commands read the checkout and write nothing.

## The surface (my choice where the issue leaves it open)

Every name and shape below that the issue or the design doesn't give is a requirement of these tests on the
implementation; "What the implementation must provide" repeats them plainly.

### The section script: `scripts/design-section.mjs`

Beside `scripts/design-links.mjs`, run from the repository root (the tests' working folder is the copy's root).

- **`node scripts/design-section.mjs <doc>#<anchor>`**, one argument, e.g. `docs/technical-design.md#decided`; `<doc>`
  is a path relative to the root. It prints the section on stdout **and nothing else**, byte for byte: from the start
  of the heading's line, or, for an explicit `<a id>` anchor, from the start of the line holding that `<a id>`, to the
  start of the next heading's line of the same or a higher level (fewer or as many `#`), or the end of the file.
  Subsections are included; the blank lines before the next heading are part of the section. Exit 0.
- **Headings and anchors are the design links lane's**: a heading is a line outside fenced code matching
  `^ {0,3}#{1,6}\s+`, its anchor GitHub's slug with the `-1`, `-2` rule, and an `<a id>` belongs to the heading that
  follows it, as `anchors` in `scripts/doc-links.mjs` reads them. A line inside a fence is never a heading, so it never
  ends a section.
- **An anchor no heading or `<a id>` of the file has:** a non-zero exit; stdout or stderr names the file (the path as
  given, `docs/technical-design.md`) and the anchor (`no-such-section`); no line of the doc on stdout.
- **`node scripts/design-section.mjs --issue <n>`** prints every section issue `<n>` links, once each, in the order the
  issue first links them. It reads the issue from **the open issues the lanes read**: `openIssues()` in
  `scripts/open-issues.mjs` (which reads the file `DEEP_OPEN_ISSUES` names when it exists, and otherwise asks `gh`).
  Links are read as the design links lane reads an issue's links (`prose`, `targets`, `resolve` with no `from`); a link
  counts once per section, the section being the heading its anchor belongs to. Each section is printed as one line
  **`==> <doc>#<anchor> <==`** (anchor: as the issue first links it, or the heading's own slug) followed by the
  section's bytes exactly as the anchor form prints them; stdout holds nothing else. Exit 0.
- **Without the issues** (no `DEEP_OPEN_ISSUES` file, and `gh` failing): a line starting **`BLOCKED`** on stdout or
  stderr naming what is missing: the issue as `#<n>` and the words `open issues`; a non-zero exit; no
  `==> … <==` line and no line of the doc on stdout. (The tests don't cover an issue that is closed or absent from a
  successful fetch; see "Not tested".)

### The doc ceilings: `scripts/doc-ceilings.json` and `scripts/doc-ceilings.mjs`

- **`scripts/doc-ceilings.json`** (the issue's name), shaped as `scripts/size-ceilings.json` is: a JSON object mapping
  `"<doc>#<slug>"` to a whole number of bytes, e.g. `"docs/technical-design.md#decided": 69359`. `<doc>` is
  `docs/technical-design.md` or `docs/canvas-primitives.md`; `<slug>` is the heading's own anchor (GitHub's slug with
  the lane's `-1`, `-2` rule), never an `<a id>`. It lists **exactly** the headings of the two docs whose own text is
  over **16,384 bytes**, each with its own text's size: no more, no fewer, every value equal to the size.
- **Own text**: the bytes from the start of a heading's line to the start of the next heading's line of any level
  (outside fences, as above), or the end of the file; text before a doc's first heading belongs to no heading.
- **`node scripts/doc-ceilings.mjs`**, run by the **lint lane**: `scripts/lanes.mjs`'s `checks` entry named `lint`
  holds the command `[process.execPath, 'scripts/doc-ceilings.mjs']` (the tests find it there and run it). It reads
  the two docs and the ceilings file under the root and the merge base's ceilings file through git, as
  `scripts/size-ratchet.mjs` does: `git merge-base HEAD origin/main`, then that commit's `scripts/doc-ceilings.json`
  if it has one (none: nothing to compare with, as the ratchet).
- **The rule** is the ratchet's, for docs: a heading with no ceiling over the limit fails (new over the limit); own text
  over its ceiling fails; a ceiling above the merge base's (a heading the base doesn't list counting as 16,384) fails.
  The ratchet also fails a size under its ceiling until the ceiling is lowered; the tests hold that only through
  "exactly" on the checkout, and through the shrunk heading passing once its ceiling is lowered.
- **A pass: exit 0 and exactly one non-empty line on stdout:**
  `PASS doc-ceilings: <n> headings read, <m> over the limit of 16,384 bytes; the largest is <doc>#<slug>, <bytes> bytes`
  where `<n>` counts every heading of both docs, `<m>` those over 16,384 bytes, and the largest is the heading with the
  most own text. Numbers may carry thousands commas; a final `.` is allowed. (The issue's Scope: "prints one line: the
  headings read, how many are over the limit, and the largest with its anchor".)
- **A finding: a non-zero exit and a line starting `FAIL`** that names the heading as `<doc>#<slug>` and, on the same
  line, the numbers below (with or without thousands commas). More lines may follow (a Fix line, other findings).
  - own text over its ceiling: its size and its ceiling;
  - a heading new over the limit: its key (the tests also require its size, 17,000, on the line);
  - a ceiling raised above the merge base's: its ceiling and the merge base's.

### The reading rule: `scripts/reading-rule.mjs`

- AGENTS.md's first rule, the first sentence of its first line after the title, **starts with the words
  `Read the design sections your issue links before edits`** (the issue's words). CONTRIBUTING.md holds that same
  sentence (through its first `.` followed by a space or the line's end), on one line. These words are compared as
  written: a markdown link inside them would differ.
- **`node scripts/reading-rule.mjs`**, run by the lint lane as `[process.execPath, 'scripts/reading-rule.mjs']` in
  `checks`' `lint` entry, reads `AGENTS.md` and `CONTRIBUTING.md` at the root. When both state the rule in the same
  words: exit 0 and a line starting `PASS`, no line starting `FAIL`, `INVALID`, `BLOCKED` or `INCONCLUSIVE`. When they
  differ: a non-zero exit and a line starting `FAIL`, and the output (stdout or stderr) names both lines as
  `AGENTS.md:<line>` and `CONTRIBUTING.md:<line>` (1-based line numbers of the rule in each file).
- **It must find the rule after an edit.** The tests' edit replaces `Read the design sections your issue links before
  edits` with `Read the design sections your issue links before any edit` in one file, or both; the line keeps its
  place and the words `Read the design sections your issue links`. So the check must not find the rule by its full
  current wording; finding it by the line that holds `Read the design sections`, or by AGENTS.md's first rule, works.

### The scratch copies and the `gh` stand-in

Each test that runs a script gets a sandbox under the OS temp folder, removed afterwards. Its `repo/` holds the
checkout's own root files (never `.git` or a `.env*`), `scripts/` (without `node_modules`, `target` or `.git`) and a
`docs/` holding only the test's docs. The script runs there with that folder as its working folder, with `HOME`,
`TMPDIR` and the XDG folders the sandbox's own, no GitHub token, host or repo variable, no `DEEP_OPEN_ISSUES` unless
the test sets it, no git variable pointing elsewhere, and a **`gh` stand-in first on `PATH`** that records its
arguments and fails as `gh` does with no sign-in (exit 4). So the open issues come only from the `DEEP_OPEN_ISSUES`
file the test writes (the shared fetch's cache), and with none set, nothing is fetched. A planted program runs the same
way, from `tests/acceptance/2338/planted/`.

AC4's scratch copies are git repositories of their own: the planted base docs and `scripts/doc-ceilings.json` are
committed (`git init`, `git add -f -- docs scripts/doc-ceilings.json`, one commit), `refs/remotes/origin/main` is set
to that commit, so the merge base with origin/main is the planted base, as `size-ratchet.mjs` reads it; then the
test's change is written to the work tree, uncommitted.

### The fixtures

**AC1 to AC3's doc**, `fixture/design.md`, at `docs/technical-design.md` in the copy (a one-heading canvas doc beside
it): headings at three levels (`#`, `##`, `###`); `## Alpha` with `### Alpha one` (holding a ```` ```sh ```` fence whose
second line is `# a shell comment, not a heading`) and `### Alpha two`; `## Notes`; `<a id="the-plan"></a>`, a blank
line, then `## Plan` with `### Plan step`; `## Notes` again (anchor `notes-1`) with `### Notes detail`; `## Omega`.
The expected sections are `fixture/alpha.md` (`#alpha`: from `## Alpha` to the line before the first `## Notes`),
`fixture/the-plan.md` (`#the-plan`: from the `<a id>` line to the line before the second `## Notes`) and
`fixture/notes-1.md` (`#notes-1`: from the second `## Notes` to the line before `## Omega`). No tested section ends at
a heading that has an `<a id>` before it, so where such an `<a id>` line belongs is left open.

**AC3's issues**, in a `DEEP_OPEN_ISSUES` file: #9339 links `#omega`; **#9338** links, in order, `#alpha` (full link on
main), `#the-plan` (full link), `#alpha` again (relative `docs/…` link) and `#notes-1` (a bare link ending a sentence
with `.`): three sections in four links. Expected: `==> docs/technical-design.md#alpha <==` and `alpha.md`, then
`the-plan` (header anchor `the-plan` or `plan`) and `the-plan.md`, then `notes-1` and `notes-1.md`, nothing else.

**AC4's docs** (`ceilingDocs` in `helpers.mjs`, filler prose of exact sizes): the technical design's own text is
`ceilings-fixture` 200, `big-section` 17,000, `small-part` 300 (a `###` under it, so a section and an own text differ),
`shrinking-section` 18,000, `edge-section` exactly 16,384 (at the limit, so not listed), `tail` 100; the canvas doc's
`canvas-fixture` 200, `wide-section` 16,500, `narrow-section` 500. The base's ceilings: `big-section` 17,000,
`shrinking-section` 18,000, `wide-section` 16,500. Its PASS line: 9 headings read, 3 over, the largest
`docs/technical-design.md#shrinking-section`, 18,000 bytes. Issue numbers and texts are made up; no fixture holds a
secret or personal data.

## Criteria to tests, and the planted programs

This job wrote the planted programs, in test code, in `planted/`: `section-twin.mjs`, `ceilings-twin.mjs` and
`rule-twin.mjs` are twins of the three scripts written from the issue and this README alone, reading headings and
links with `planted/doc-links-copy.mjs` (the base's `scripts/doc-links.mjs` code, copied, plus a heading scan with
byte offsets); each other file there runs a twin with one fault, named in that file's own code, never chosen by an
environment variable (design: Wrong programs). The implementation provides no planted program. Each test runs the
script and holds it to the criterion, then runs the criterion's planted program on the same input, checks that it
does what the issue says it does, and checks that the same judgement fails it, naming what the issue says; the failure
is printed as a test diagnostic, for the Proof's "each planted script shown failing first". For AC4 and AC5 the issue's
planted things are docs, ceilings and edits; the tests plant those, and add one planted check each.

| Criterion | Test | The script must | The planted program or input | It must fail, naming |
|---|---|---|---|---|
| AC1 `#2338.c7574234` | `ac1-sections.test.mjs` | print `#alpha`, `#the-plan` and `#notes-1` byte-equal to `fixture/<anchor>.md`, exit 0 | `stops-at-any-heading.mjs`: prints `#alpha` as `## Alpha` and its own text only; `fenced-hash-as-heading.mjs`: cuts `#alpha` at the fenced `# a shell comment` line | `docs/technical-design.md#alpha` (each) |
| AC2 `#2338.19700c5a` | `ac2-unknown-anchor.test.mjs` | for `docs/technical-design.md#no-such-section`: non-zero exit, output naming `docs/technical-design.md` and `no-such-section`, no line of the doc on stdout | `unknown-exits-zero.mjs`: prints nothing, exits 0 | "exited 0" |
| AC3 `#2338.64ab4593`, first | `ac3-issue.test.mjs` | for `--issue 9338` over the `DEEP_OPEN_ISSUES` file: three `==> … <==` sections, alpha, the-plan, notes-1, each byte-equal, nothing else, exit 0 | `once-per-link.mjs`: prints alpha, the-plan, alpha, notes-1 | the count: "printed 4 sections, not 3" |
| AC3 `#2338.64ab4593`, second | `ac3-issue.test.mjs` | with no `DEEP_OPEN_ISSUES` and `gh` failing: a `BLOCKED` line naming `#9338` and `open issues`, non-zero exit, no section | `blocked-prints-nothing.mjs`: prints nothing, exits 0 | "exited 0" and no BLOCKED line |
| AC4 `#2338.1a6db6b6`, on the checkout | `ac4-ceilings.test.mjs` | the lint lane runs `scripts/doc-ceilings.mjs`; `scripts/doc-ceilings.json` equals the oracle's over-16,384 headings and sizes for the checkout's two docs; the lane's command passes with its one line naming the oracle's heading count, over count and largest | the merge base (no ceilings, no check) | the missing script, or each wrong ceiling |
| AC4, 1 KB grown | `ac4-ceilings.test.mjs` | pass the planted base (one PASS line, its counts); fail `big-section` grown to 18,024 under its ceiling of 17,000 | the planted doc | `docs/technical-design.md#big-section`, 18,024 and 17,000 |
| AC4, new over the limit | `ac4-ceilings.test.mjs` | fail `## New big section`, 17,000 bytes, no ceiling | the planted doc | `docs/technical-design.md#new-big-section` and 17,000 |
| AC4, ceiling raised | `ac4-ceilings.test.mjs` | fail `big-section` grown to 18,024 with its ceiling raised to 18,024 above the base's 17,000 | the planted ceiling, and `no-merge-base.mjs`: a check that never reads the merge base, which passes it | `docs/technical-design.md#big-section`, 18,024 and 17,000; the planted check "exited 0" |
| AC4, shrunk | `ac4-ceilings.test.mjs` | pass `shrinking-section` shrunk by 1,024 to 16,976 with its ceiling lowered to 16,976 in the same change | — | — |
| AC5 `#2338.a3eb5a70`, on the checkout | `ac5-reading-rule.test.mjs` | AGENTS.md's first rule starts with the issue's words; CONTRIBUTING.md holds the same sentence; the lint lane runs `scripts/reading-rule.mjs` and it passes | the merge base | the missing script, or the rule |
| AC5, one file edited | `ac5-reading-rule.test.mjs` | fail AGENTS.md edited alone and CONTRIBUTING.md edited alone, each naming `AGENTS.md:<n>` and `CONTRIBUTING.md:<m>`; pass both edited alike | the planted edits, and `agents-only.mjs`: a check reading AGENTS.md alone, which passes CONTRIBUTING.md edited alone | `AGENTS.md:<n>`, `CONTRIBUTING.md:<m>`; the planted check "exited 0" |

### On the base

Every test fails at a `node:assert` assertion under the test paths before any planted program runs: AC1 to AC3 and
AC4's scratch tests in `helpers.mjs`'s `runIn` (`scripts/design-section.mjs does not exist …`,
`scripts/doc-ceilings.mjs does not exist …`), AC4's and AC5's checkout tests and AC5's second test at their first
assertion (`… does not exist: the check #2338 asks for isn't in this checkout`). The proof lane reads each as a
failure at the assertion (`BASE-FAILURE.txt`).

### How I checked the tests can pass and fail

In a scratch copy of the base outside this checkout (its root files, `scripts/`, the two real design docs and this
folder), the three scripts were the twins with no fault (`import { main } from './<twin>.mjs'; main();`), the ceilings
file was the oracle's list for the base's docs, the lint lane ran both checks, and AGENTS.md's first sentence and
CONTRIBUTING.md's reading sentence were both `Read the design sections your issue links before edits.`. All eleven
tests passed there, each printing its planted program's failure as a diagnostic (`BASE-FAILURE.txt`, second part).
No twin was left in the checkout.

## Readings where the issue leaves a choice

- **16 KB is 16,384 bytes.** With 16,384 the docs at `4503c6f5` have exactly the issue's 15 + 5 = 20 headings over
  the limit; with 16,000 the canvas reference has 6, 21 in all. Own text counted to the end of the file for a doc's last
  heading gives `### Decided` 68,942 bytes at `4503c6f5`, where the issue says 68,943: it is that doc's last heading,
  and the one byte is the file's final newline counted twice. The 20 agree, so the tests keep the plain count.
- **"On main … holds exactly the headings … 20 at `4503c6f5`"**: 20 is a count at an older commit (the base's docs
  already differ: the largest is now 69,359 bytes, and the canvas reference's largest heading changed). The test holds
  "exactly" against the docs of the commit under test, computed by an oracle in `helpers.mjs` (the lane's heading scan
  and slugs, own text as above): the ceilings file's keys and values equal the oracle's, and the lane's line names the
  oracle's counts and largest. At the base, that list is 20 headings (15 and 5).
- **"Exactly" includes the sizes**: the Scope's list is "with its size in bytes", and the ratchet it mirrors keeps each
  ceiling at its file's size; so every ceiling equals its heading's own text on the commit under test.
- **The ceilings file's keys** are `<doc>#<slug>`, the size ceilings' path keys with the heading's own anchor, which
  every heading has and the `-1` rule keeps unique.
- **"The lane passes"** is the lint lane's doc-ceilings command, run on the checkout; the rest of the lint lane
  (cargo, the other guards) isn't run here. "Prints one line" is the PASS line, the only line on a pass.
- **The merge base in a scratch copy** is its own first commit, through `refs/remotes/origin/main`, as the ratchet's
  `git merge-base HEAD origin/main` reads it; the copy's git can't reach the checkout's repository.
- **"A heading new over the limit"** is one with no ceiling: no ceiling in the change (the ratchet fails it whatever the
  base), here with no ceiling at the base either.
- **"A planted ceiling raised above the merge base's"**: the doc grows to the raised ceiling in the same change, so
  only the merge base's ceiling catches it.
- **"From the open issues the lanes read"** is `openIssues()` from `scripts/open-issues.mjs`, served offline by its
  `DEEP_OPEN_ISSUES` file. With `gh` failing in every test, a script that asked `gh` for the issue by itself would fail
  AC3's first test.
- **"Once each, in the order first linked"**: a section is the heading its anchor belongs to, so two links to it are
  one section; "naming the count" is "printed 4 sections, not 3".
- **"The `<a id>` before it"**: for an explicit anchor, the section starts at its `<a id>` line. Whether a heading's
  own slug also starts at an `<a id>` before it isn't tested.
- **"The words `CONTRIBUTING.md` uses"**: both files hold one sentence that starts with the issue's quoted words. The
  text check is a script of its own, run by the lint lane, rather than a check inside `scripts/repo-rules.mjs`: running
  that script in a scratch copy needs the whole tree, Cargo and its physics build, which a seconds-long offline test
  can't hold.
- **"Naming both lines"** is `<file>:<line>` for each file.

## What the implementation must provide

1. `scripts/design-section.mjs`, run from the root:
   - `node scripts/design-section.mjs <doc>#<anchor>`: the section's bytes on stdout and nothing else, exit 0; the
     section from the heading's line (an explicit `<a id>`'s own line for that anchor) to the next heading of the same
     or a higher level or the end, fenced lines never headings, anchors resolved as `scripts/doc-links.mjs`'s
     `anchors` does.
   - An unknown anchor: non-zero exit, `<doc>` and `<anchor>` named on stdout or stderr, no line of the doc on stdout.
   - `node scripts/design-section.mjs --issue <n>`: from `openIssues()` (`scripts/open-issues.mjs`), each section the
     issue links once, in first-linked order, as `==> <doc>#<anchor> <==` then the section's bytes; nothing else;
     exit 0.
   - Without the open issues: a line starting `BLOCKED` naming `#<n>` and `open issues`; non-zero exit; no section.
2. `scripts/doc-ceilings.json`: `{ "<doc>#<slug>": <own text bytes> }` for exactly the headings of
   `docs/technical-design.md` and `docs/canvas-primitives.md` whose own text is over 16,384 bytes.
3. `scripts/doc-ceilings.mjs`, in the lint lane's commands as `[process.execPath, 'scripts/doc-ceilings.mjs']`:
   the ratchet's rule for own text against the ceilings and the merge base's ceilings
   (`git merge-base HEAD origin/main`); on a pass exit 0 and only
   `PASS doc-ceilings: <n> headings read, <m> over the limit of 16,384 bytes; the largest is <doc>#<slug>, <bytes> bytes`;
   on a finding a non-zero exit and a `FAIL` line naming `<doc>#<slug>` with the size and ceiling (grown), the size
   (new over the limit), or the ceiling and the merge base's (raised).
4. `AGENTS.md`'s first rule starting `Read the design sections your issue links before edits`, the same sentence in
   `CONTRIBUTING.md`.
5. `scripts/reading-rule.mjs`, in the lint lane's commands as `[process.execPath, 'scripts/reading-rule.mjs']`: PASS
   and exit 0 when the two files state the rule in the same words; otherwise a `FAIL` line, `AGENTS.md:<line>` and
   `CONTRIBUTING.md:<line>` in the output, a non-zero exit; it finds the rule by the line, not by its full wording.

No planted program is needed from the implementation, and no `scripts/lanes.mjs` entry for this folder.

## Not tested, because no criterion reaches it here

AGENTS.md staying under one page and its four invariants unchanged (Scope, no criterion); the Proof's outputs for this
issue's own two links and the lane's line on main in the PR; `--issue` for a closed issue or one missing from a
successful fetch; links in an issue to an anchor no heading has; where an `<a id>` line before the next heading
belongs (no tested section ends at one); whether a heading's own slug starts at an `<a id>` before it; a section of
`docs/canvas-primitives.md` (the script takes any doc path; the fixture is the technical design's); a ceiling under
its heading's size or for a heading under the limit, on its own (held only through "exactly" on the checkout); a
ceiling for a heading that no longer exists; long lines (out of scope).

## Files

- `helpers.mjs`: the scratch copies and the `gh` stand-in, one run of a script or planted program, the fixture's
  expected sections and issues, AC4's planted docs, scratch repositories and own-text oracle, and each criterion's
  judgement.
- `fixture/design.md` (AC1 to AC3's doc) and `fixture/alpha.md`, `fixture/the-plan.md`, `fixture/notes-1.md` (the
  expected sections).
- `ac1-sections.test.mjs`, `ac2-unknown-anchor.test.mjs`, `ac3-issue.test.mjs`, `ac4-ceilings.test.mjs`,
  `ac5-reading-rule.test.mjs`: one file per criterion, eleven tests.
- `planted/doc-links-copy.mjs` (the lane's anchor code, copied), the twins `planted/section-twin.mjs`,
  `planted/ceilings-twin.mjs`, `planted/rule-twin.mjs`, and the planted programs `stops-at-any-heading.mjs`,
  `fenced-hash-as-heading.mjs`, `unknown-exits-zero.mjs`, `once-per-link.mjs`, `blocked-prints-nothing.mjs`,
  `no-merge-base.mjs`, `agents-only.mjs`.
- `BASE-FAILURE.txt`: the run on the base, and the self-check on the twins.
