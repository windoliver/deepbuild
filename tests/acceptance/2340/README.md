# Acceptance tests for #2340: each design section shows the work filed against it

Written first, blind, from issue #2340 ("Each design section shows the work filed against it: one script lists every
linked section with its closed and open issues, so built and designed are counted and not estimated": its report,
Scope, five acceptance criteria and Proof, as the brief gave its body; it has no comments), the design and the base
commit `9d02561325430d91e0b8cff3242e11011cc1b8cc` ("Merge pull request #2836 …"), by a job that never saw an
implementation; none existed. No other branch, worktree or pull request was read, nor GitHub, and the real `gh` never
ran. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding). Node's test runner and built-ins only.

| AC | ID | File (tests) |
|---|---|---|
| AC1 | `#2340.fc02d61b` | `ac1-rows.test.mjs` (1) |
| AC2 | `#2340.8ccc28b4` | `ac2-one-row.test.mjs` (1) |
| AC3 | `#2340.7613f30b` | `ac3-counts-once.test.mjs` (1) |
| AC4 | `#2340.38f8ebe4` | `ac4-pages.test.mjs` (2: the 250 read, and the failed second page) |
| AC5 | `#2340.baf32dff` | `ac5-json.test.mjs` (1) |

IDs are the repo's rule (`criterionId` in `scripts/proof-change.mjs`): `#2340.` and the first 8 hex digits of the
SHA-256 of each criterion's text after `- [ ] `, trimmed, white space collapsed, over the body the brief gave; the live
issue wasn't read, so they aren't checked against it. Each test's name starts with its ID and its AC number.

## What was read

- The issue body, `AGENTS.md`, `CONTRIBUTING.md`, and in `docs/technical-design.md`: How we know version 0 works
  (Criteria to tests, both ways; Closed issues stay proven; Criteria in a checked shape; Wrong programs; Dogfooding;
  Built to be hard to get wrong, with Tests written first), How it installs, and What done means, fixed at the start.
  `docs/parallel-proof.md` section 6 (the throttle).
- At the base: `scripts/design-links.mjs` (how the design links lane reads a link and a heading: `prose`, `slug`,
  `headingText`, `targets`, `resolve`, `anchors`), `scripts/open-issues.mjs` (the shared open-issue fetch and its
  `DEEP_OPEN_ISSUES` cache), `scripts/proof-runs.mjs` and `scripts/proof-change.mjs` (how a test counts as failing at
  its assertion, test paths, twins), `scripts/lanes.mjs` (its lists), the headings and `<a id>`s of the two design
  docs, and the suites `910/`, `605/`, `2063/`, `2405/`, `2435/`, `2698/`, `2144/`, `1925/` and `2813/` for the house
  format.

## Run

```sh
node --test 'tests/acceptance/2340/*.test.mjs'
# on a shared machine, through the throttle:
node scripts/throttle.mjs test --wait 30 -- node --test 'tests/acceptance/2340/*.test.mjs'
```

They're `*.test.mjs` under `tests/acceptance/`, so the unit lane doesn't pick them up; run them by hand. All six are
offline: no network, no `gh` sign-in, no build. They need Node (the repo's 24.22 or newer), `git` (each scratch copy
gets a `git init`) and `/bin/sh` (the stand-in's launcher). Each test runs the script once and a planted program once,
each in its own scratch copy, a few seconds a test. No entry in `scripts/lanes.mjs` is needed: nothing here builds,
holds a port or shares state, and each run's files are under the OS temp folder, removed afterwards.

## The surface (my choice where the issue leaves it open)

Every name and shape below that the issue or the design doesn't give is a requirement of these tests on the
implementation; the list under "What the implementation must provide" repeats them plainly.

### The script and its command line

- **`scripts/design-issues.mjs`**, beside `scripts/design-links.mjs`: it lists the design's headings with the issues
  filed against them. Run from the repository's root as `node scripts/design-issues.mjs`, and with the JSON flag as
  `node scripts/design-issues.mjs --json <file>`.
- **What it reads.** The docs from `docs/` under the root it runs in, and the issues through `gh` only, from `PATH`.
  The tests run it with the working folder at a scratch copy whose `docs/` holds just the fixture's two docs, so a
  script that lists the headings of the two design docs and one that lists those of every `docs/*.md` give the same
  rows there; the tests don't decide between them. `DEEP_OPEN_ISSUES` is never set, so the open issues are fetched.
- It may import any file under `scripts/` (such as the design links lane's code, which the issue says it uses) and
  `node_modules`; nothing else of the checkout is in the copy beside the root's own files.

### The `gh` calls the stand-in answers (README: The stand-in, below)

- **The closed issues: one call per page of 100, through the REST issues endpoint,**
  `gh api 'repos/{owner}/{repo}/issues?state=closed&per_page=100&page=<n>'` for `n` = 1, 2, … until a page holds
  fewer than 100 (or none). The owner and repo may be written out or left as gh's placeholders, the leading `/` is
  optional, and the parameters may come instead as `-f`/`-F`/`--field`/`--raw-field key=value` with `-X GET` or
  `--method GET`. Each item carries `number`, `title`, `state`, `state_reason` (`completed`, `not_planned`, …), `body`
  and `html_url`. An issue is closed as completed when its `state_reason` is `completed`.
- **The open issues: either** `gh issue list --state open --limit <n> --json <fields>`, as the shared
  `scripts/open-issues.mjs` asks (fields among `number`, `title`, `body`, `state`, `stateReason`, `url`; 30 without
  `--limit`, as gh), **or** the same REST pages with `state=open`.
- Also `gh auth status` and `gh --version`. Everything else exits 1 with a message naming what it refused (for a
  refused flag or closed-list call, also the paged call to make): `--paginate`, `--slurp`, `--jq`, `--template`,
  `--include`, `--cache` and other flags, `state=all`, `gh issue list --state closed|all`, `gh issue view`, any other
  endpoint, and a POST. The issue's "in
  pages of 100" and "failing on the second page" need one call per page, so gh's own paging can't stand in for the
  script's.

### What it prints

- **The table, on stdout:** one line per heading, `| docs/<file>.md#<anchor> | <closed issues> | <open issues> | <word> |`.
  The anchor is the heading's own slug (GitHub's, with the `-1`, `-2` rule), never an `<a id>`. Issues are written
  `#<number>`, separated by spaces or commas, and a cell with none is empty. The word is `closed`, `mixed` or `open`
  for a linked heading, and **`unlinked`** for a heading no issue links: that is the Scope's flag, and every heading
  of the docs is a row, linked or not. A header line and its `|---|` rule may come first; the tests skip every line
  starting with `|` whose first cell isn't `docs/<file>.md#<anchor>`. Cells may be wrapped in backticks.
- **The summary line, the last line of stdout:**
  `<n> headings linked: <n> closed, <n> mixed, <n> open; <n> unlinked; <n> issues read: <n> closed, <n> open`.
  Any text may come before `<n> headings linked`; a number may carry thousands commas; `heading` and `issue` may be
  singular and a final `.` is allowed. "Issues read" counts the open issues and the issues closed as completed that
  the script read, never one closed as not planned or as a duplicate.
- **With `--json <file>`**, the same run prints the same table and summary line on stdout and writes `<file>`:
  `{ "rows": [ { "file": "docs/<file>.md", "anchor": "<slug>", "closed": [<number>, …], "open": [<number>, …], "reads": "closed" | "mixed" | "open" | "unlinked" } ], "summary": { "linked": n, "closed": n, "mixed": n, "open": n, "unlinked": n, "issues": { "read": n, "closed": n, "open": n } } }`.
  Other fields are allowed. Row order and the order of numbers inside a list don't matter.
- **A full read exits 0** and prints no line starting `BLOCKED`.
- **An issue list it can't read in full:** a line starting **`BLOCKED`** (stdout or stderr) that names the fetch: the
  word `closed` and the page that failed as `page 2` or `page=2`. No line starting `|` and no summary line, and a
  non-zero exit.

### The fixture

Two docs, in place of the design docs (`helpers.mjs`, `DOCS`), with their slugs worked by hand by GitHub's rules
(lowercase; drop what isn't a letter, number, space, hyphen or underscore; each space a hyphen):

| Doc | Headings (slugs) |
|---|---|
| `docs/technical-design.md` | `technical-design-fixture`, `alpha-section`, `beta-section`, `six-weeks-to-version-0` (with `<a id="plan"></a>` and a blank line before it, as the real doc writes `#plan`), `week-one` |
| `docs/canvas-primitives.md` | `canvas-primitives-fixture`, `gamma-section`, `delta-section`, `foxtrot-section`, `golf-section` |

Eight issues, newest first (`ISSUES`). Links are a full link on main
(`https://github.com/windoliver/deepbuild/blob/main/docs/…#…`), a relative `docs/…#…` link or a bare full link, as
issues write them:

| Issue | State | Links |
|---|---|---|
| #9801 | closed, completed | `alpha-section` (markdown link) |
| #9802 | closed, completed | `alpha-section` (bare link) |
| #9803 | closed, completed | `beta-section` (relative link) |
| #9804 | closed, completed | `#plan`, the `<a id>` before `## Six weeks to version 0` |
| #9805 | closed, completed | `foxtrot-section` three times: full link, relative link, and a bare link ending a sentence with `.` |
| #9806 | open | `beta-section`, `foxtrot-section`, `golf-section` |
| #9807 | open | `gamma-section`, `six-weeks-to-version-0` (the slug) |
| #9808 | closed, not planned | `delta-section` |

So, by the issue's rules: `alpha-section` reads `closed` with #9801 and #9802; `beta-section` `mixed` (#9803, #9806);
`six-weeks-to-version-0` `mixed` (#9804 by `#plan`, #9807 by its slug) on one row; `gamma-section` `open` (#9807);
`foxtrot-section` `mixed` with #9805 once and #9806; `golf-section` `open` (#9806); and `delta-section`, which only
the not-planned #9808 links, is `unlinked`, beside the two title headings and `week-one`. The summary: 6 headings
linked, 1 closed, 3 mixed, 2 open, 4 unlinked, and 7 issues read, 5 closed and 2 open. The counts differ from one
another so the JSON test can tell its fields apart.

AC4's tracker (`PAGED`) is 250 issues, #9250 down to #9001, each closed as completed and linking `alpha-section`, and no
open issue. The issue numbers are made up; no fixture holds a secret or personal data.

### The stand-in

`gh-standin.mjs`, run by a `gh` launcher first on `PATH` in a sandbox whose `HOME`, `TMPDIR` and XDG folders are its
own, with no GitHub token, host or repo variable, no `DEEP_OPEN_ISSUES`, and no git variable that points at another
repository (`GIT_DIR`, `GIT_WORK_TREE` and the like). It serves the calls above from the test's
tracker in pages of 100, whatever `per_page` says (the issue's "pages of 100"); a page past the end is `[]`. With
`failFromPage: 2`, every page of the closed issues from the second on fails as an HTTP 502 does (`gh: Server Error
(HTTP 502)` on stderr, exit 1). It records every call, one line of arguments each; the tests show the calls in their
messages and diagnostics, which is the Proof's "recorded `gh` calls".

### The scratch copy

Each run gets a sandbox under the OS temp folder, removed after the test. Its `repo/` holds the checkout's own root
files (never `.git` or a `.env*`) and `scripts/` (without any `node_modules`, `target` or `.git`), the fixture's two
docs as its only `docs/`, `node_modules` linked to the checkout's, and a fresh repository of its own from `git init`,
with `https://github.com/windoliver/deepbuild.git` as `origin`. In a git worktree the checkout's `.git` is a file
pointing at the shared repository, so it is never copied, and git runs there without `GIT_DIR`, `GIT_WORK_TREE` or
the other variables that point it elsewhere: the copy's `git init` can't reach the checkout's repository. `remote add`
runs only once `repo/.git` is the new repository's own folder; otherwise the run stops `BLOCKED`. The script runs
there with that folder as its working folder. A planted program runs the same way, from
`tests/acceptance/2340/planted/`.

## Criteria to tests, and the planted programs

How the suite gets each planted program: this job wrote them, in test code, in `planted/`. `planted/twin.mjs` is a twin
of the script written from the issue and this README alone, whose link reading is the base's design links lane code,
copied; each other file there runs it with one fault, named in that file's own code, never chosen by an environment
variable (design: Wrong programs). The implementation provides no planted program. Each test runs the script on the
fixture and holds it to the criterion, then runs the criterion's planted program on the same fixture, checks that it
does what the issue says it does, and checks that the same judgement fails it, naming what the issue says. Its
failure is printed as a test diagnostic, for the Proof's "each planted script shown failing".

| Criterion | Test | The script must | The planted program | It must fail, naming |
|---|---|---|---|---|
| AC1 `#2340.fc02d61b` | `ac1-rows.test.mjs` | exit 0 on the full read; `alpha-section` reads `closed` with exactly #9801 and #9802; `beta-section` `mixed` with #9803 and #9806; `gamma-section` `open` with #9807; `delta-section` is one row reading `unlinked`, with no issue | `not-planned-as-closed.mjs`: reads an issue closed as not planned as closed. It prints `delta-section` as `closed` with #9808 | `docs/canvas-primitives.md#delta-section` |
| AC2 `#2340.8ccc28b4` | `ac2-one-row.test.mjs` | put `#plan` and `#six-weeks-to-version-0` on one row, keyed by the slug, reading `mixed` with #9804 and #9807 | `anchor-as-written.mjs`: keys rows by the anchor as written. It prints a `#plan` row (closed, #9804) and a `#six-weeks-to-version-0` row (open, #9807) | both, `docs/technical-design.md#plan` and `docs/technical-design.md#six-weeks-to-version-0` |
| AC3 `#2340.7613f30b` | `ac3-counts-once.test.mjs` | list #9805 once on `foxtrot-section` (closed #9805, open #9806, `mixed`) | `counts-links.mjs`: counts links, not issues. It prints #9805 3 times | `docs/canvas-primitives.md#foxtrot-section` and `3 times` |
| AC4 `#2340.38f8ebe4`, first | `ac4-pages.test.mjs` | over 250 closed issues served in pages of 100, exit 0 and end with a summary line counting 250 issues read, 250 of them closed | `first-page-only.mjs`: reads page 1 only. Its summary counts 100 | both counts, 100 and 250 |
| AC4 `#2340.38f8ebe4`, second | `ac4-pages.test.mjs` | with every closed page from the second failing: a `BLOCKED` line naming `closed` and `page 2`/`page=2`, no line starting `\|`, no summary line, a non-zero exit | `table-on-partial-read.mjs`: prints the table of page 1, then BLOCKED, and exits 2 | "printed a table from a partial read", with the line and row counts |
| AC5 `#2340.baf32dff` | `ac5-json.test.mjs` | with `--json <file>`, one run: the table has rows reading each of `closed`, `mixed`, `open` and `unlinked`; the JSON's rows equal the table's (file, anchor, closed and open issues, word) and its summary equals the summary line, field by field | `json-drops-unlinked.mjs`: its JSON leaves out the `unlinked` rows its table lists | the count: "the table lists 4 unlinked headings and the JSON 0" |

### On the base

Every test fails at the same named assertion, in `helpers.mjs`'s `run`, before the script is run:
`scripts/design-issues.mjs does not exist: the script #2340 asks for, beside scripts/design-links.mjs, isn't in this
checkout`. It is a `node:assert` failure thrown under the test paths, so the proof lane reads it as a failure at the
assertion, and no planted program runs on the base (`BASE-FAILURE.txt`).

### How I checked the tests can pass and fail

In a scratch copy of the base outside this checkout (its `scripts/`, three root files and this folder),
`scripts/design-issues.mjs` was the twin with no fault, `import { main } from './design-issues-twin.mjs'; main();`, with
`planted/twin.mjs` copied beside it as `scripts/design-issues-twin.mjs`. All six tests passed there, through the
throttle, each printing its planted program's failure as a diagnostic. They passed the same way from a git worktree of
a throwaway repository with an `origin`, once plainly and once with `GIT_DIR` and `GIT_WORK_TREE` pointing at that
repository, and every file under its `.git` kept its content, size and mtime (`BASE-FAILURE.txt`, second part). Before that,
a probe outside the suite ran the clean twin and each planted program once over its fixture and read every judgement
on each: the clean twin passed all of them, and each planted program failed its own criterion's judgement, naming what
the issue says. No other wrong program was run.

## Readings where the issue leaves a choice

- **"Pages of 100" and "failing on the second page"** need the script to ask for each page itself, so the closed
  issues come from one `gh api` call per page of the REST issues endpoint, which also carries the close reason the
  Scope reads. The open issues may keep coming from the shared fetch in `scripts/open-issues.mjs`, as the design links
  lane reads them, or from the same pages.
- **"Naming the fetch"** is the word `closed` and the failed page, `page 2` or `page=2`, on the `BLOCKED` line. "Prints
  no table" covers the summary line too, since the Scope's summary line ends the table.
- **"The JSON, with a flag" and "reading both from one run"**: the flag names a file, so one run gives both the table
  (stdout) and the JSON (the file). A flag that switched the output to JSON alone couldn't give both from one run.
- **"Listed with a flag"**: an unlinked heading is a row whose word is `unlinked`. In the JSON too, so "drops the
  unlinked headings" is visible as rows.
- **The row's anchor is the heading's own slug.** The Scope makes an `<a id>` and its heading's slug one row; the slug
  is the one anchor every heading has.
- **"Counts 250 read"**: the summary's issues-read count, 250 with 250 closed, since AC4's tracker has no open issue.
- **"Counts once on its row"**: the issue's number appears once in the row's closed list. The planted program that
  counts links prints the number three times; the test names the heading and `3 times`.
- **A full read exits 0.** The Scope fails a run only when an issue list can't be read in full.

## What the implementation must provide

1. `scripts/design-issues.mjs`, run from the repository root as `node scripts/design-issues.mjs [--json <file>]`.
2. The closed issues read only as `gh api repos/{owner}/{repo}/issues?state=closed&per_page=100&page=<n>`, one call
   per page (parameters in the query or as `-f`/`-F` fields with `-X GET`), until a page holds fewer than 100 or none;
   an issue is read when its `state_reason` is `completed`. No `--paginate`, `--jq` or other flag beyond `-X`/`--method`,
   `-f`/`-F`/`--field`/`--raw-field` and `-H`/`--header`.
3. The open issues read as `gh issue list --state open [--limit <n>] --json <fields>` or as the same REST pages with
   `state=open`.
4. The docs read from the checkout's `docs/` (under the working folder, or beside the script's own `scripts/`: the
   same folder in the copy); nothing read from the checkout beyond its root files, `scripts/` and `node_modules`.
5. The table on stdout, a row per heading: `| docs/<file>.md#<slug> | #<n> … | #<n> … | closed|mixed|open|unlinked |`.
6. The last line of stdout:
   `<n> headings linked: <n> closed, <n> mixed, <n> open; <n> unlinked; <n> issues read: <n> closed, <n> open`.
7. With `--json <file>`: the table and summary line on stdout as above, and `<file>` holding
   `{ rows: [{ file, anchor, closed: [numbers], open: [numbers], reads }], summary: { linked, closed, mixed, open, unlinked, issues: { read, closed, open } } }`.
8. Exit 0 on a full read, with no line starting `BLOCKED`.
9. When a page of the closed issues fails: a line starting `BLOCKED` with `closed` and `page 2` (or `page=2`) in it,
   no line starting `|`, no summary line, and a non-zero exit.

No planted program and no lane-list entry is needed from the implementation.

## Not tested, because no criterion reaches it here

The summary line for main and the fixture table in the pull request (the Proof's, a reading of the real tracker);
links into a `docs/*.md` other than the two docs, and links with no anchor or to no heading; an `<a id>` with no
heading after it; issues closed as duplicates (the fixture has the one not-planned issue the criterion names); pull
requests in the REST list; whether the JSON is also withheld when a page fails; rows' order; and the open issues past
5,000.

## Files

- `helpers.mjs`: the scratch copy, the fixture's docs and issues, the stand-in's launcher, the run, the readers of the
  table, summary line, `BLOCKED` lines and JSON, and each criterion's judgement.
- `gh-standin.mjs`: the recording stand-in for `gh`.
- `ac1-rows.test.mjs`, `ac2-one-row.test.mjs`, `ac3-counts-once.test.mjs`, `ac4-pages.test.mjs`, `ac5-json.test.mjs`:
  one file per criterion, six tests.
- `planted/twin.mjs` and the six planted programs: `not-planned-as-closed.mjs`, `anchor-as-written.mjs`,
  `counts-links.mjs`, `first-page-only.mjs`, `table-on-partial-read.mjs`, `json-drops-unlinked.mjs`.
- `BASE-FAILURE.txt`: the run on the base, and the self-check on the twin.
