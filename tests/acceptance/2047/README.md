# Acceptance tests for #2047: closed issues stay proven

Written first, blind, from issue #2047 as it read live on November 18, 2026 (its Scope, its seven criteria and its
Proof; the body only), the design and the base commit `9d0256132` ("Merge pull request #2836"), by a job that never saw
an implementation; none existed, and no other branch, worktree, stash or pull request was read. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read: `AGENTS.md`; `docs/technical-design.md`: How runs become one of five verdicts, and How we know version 0
works (Criteria to tests, both ways; Closed issues stay proven; Wrong programs; Dogfooding; Tests written first). At the
base, for surfaces only: `scripts/spine.mjs` (whole), `scripts/proof-change.mjs` (`criterionId`, `readIssue`, the test
paths and tags), `scripts/open-issues.mjs`, `scripts/lanes.mjs` (`testPaths`, `releaseLanes`, the unit lane),
`scripts/preflight.mjs`, `scripts/proof-runs.mjs` (`twinsOf`, the before lane's twins) and `scripts/affected.mjs` (how
a node suite is selected); and `tests/acceptance/1333/`, `2417/` and `33/` for the house format. Every expected value
comes from the issue.

| AC | ID | File |
|---|---|---|
| AC1 | `#2047.de9de3ac` | `report.test.mjs` |
| AC2 | `#2047.3e6fece2` | `report.test.mjs` |
| AC3 | `#2047.2d1ab05b` | `reopen.test.mjs` |
| AC4 | `#2047.5e2430c0` | `pending.test.mjs` |
| AC5 | `#2047.0356e83a` | `blocked.test.mjs` |
| AC6 | `#2047.ececce7b` | `pages.test.mjs` |
| AC7 | `#2047.a0828b81` | `moved.test.mjs` |

Each ID is `criterionId`'s in `scripts/proof-change.mjs`, as `readIssue` reads the live body: the text after `- [ ] `,
trimmed, white space collapsed, the first 8 hex digits of its SHA-256. They match the IDs the brief gave. Each test's
name starts `AC<n> #2047.<h8>`.

## How to run

```sh
node --test tests/acceptance/2047/report.test.mjs tests/acceptance/2047/reopen.test.mjs tests/acceptance/2047/pending.test.mjs \
  tests/acceptance/2047/blocked.test.mjs tests/acceptance/2047/pages.test.mjs tests/acceptance/2047/moved.test.mjs
```

Node 24 and git, Node built-ins only: no build and no `npm ci`, unless the sweep itself imports a package. Name the
files: on node 24 `node --test tests/acceptance/2047/` reads the folder as a module. 7 tests in 6 files, all offline.
At a load of 36 on this Mac the files took under 2 s each on the throwaway sweep, and `pages.test.mjs` 15 s (250 issue
reads); `BASE-FAILURE.txt` has the times. Under a heavy load a run of the sweep can take tens of seconds, so each run
may take 15 minutes (25 for AC6) and each test 30.

Every test runs this checkout's real `node scripts/closed-sweep.mjs` and reaches it only through its command line, its
output, its exit status and the `gh` calls the stand-in records. Nothing imports it. `scripts/affected.mjs` selects
these files for a change to the script, since `helpers.mjs` names its path (not run here: the checkout has no
`node_modules`, which `affected.mjs` needs). The unit lane doesn't run node suites under `tests/acceptance/`; they run
by hand, as its comment says.

## The surface (my choice where the issue leaves it open)

The issue names a sweep under `scripts/` beside `scripts/spine.mjs` that reads issues with your `gh` sign-in and runs
in the release preflight. Every other name below is picked here, marked *(chosen)*, shaped like the base's neighbours.

### The command

- **`node scripts/closed-sweep.mjs`** *(chosen)*, no arguments, run with its working folder in the repository whose
  tests it reads: the git repository of its working folder, not of the folder the script sits in. In the release
  preflight both are the checkout, since `runLanes` runs a lane at the repository's root. The tests run this
  checkout's script with its working folder in a fixture repository.
- **Main** is that repository's `origin/main` as it stands, read with git *(chosen)*. The fixture's origin is a bare
  repository in the sandbox, so a fetch, if the sweep makes one, reaches nothing outside it. Each run starts in a
  fresh clone, where `origin/main` is main.
- **The GitHub repository** is whichever `gh` serves. The stand-in serves one repository's issues whatever
  `repos/<owner>/<repo>` or `-R` names, so the sweep may take the name from origin's URL (the fixture's reads as
  `fixture/closed`), from `gh repo view`, from gh's `{owner}/{repo}` placeholders, or name `windoliver/deepbuild` as
  `scripts/spine.mjs` does.

### What holds a criterion

- **A test** is any file of main's tree under the repository's test paths, `testPaths` in `scripts/lanes.mjs`
  (`tests/**`, `packages/**/test/**`, `packages/**/*.test.ts`, `crates/*/tests/**`) *(chosen)*: test files, and the
  helpers house suites keep their IDs in, which their tests build names from. A file **names an ID** when its text holds
  it: `#<issue>.<h8>`. The lamp's suite keeps two of its four IDs in its `helpers.mjs`, so a sweep that reads only
  `*.test.*` files fails AC1.
- **A suite that names no criterion ID at all** is a folder `tests/acceptance/<issue>/` none of whose files holds any
  `#<digits>.<8 hex digits>` *(chosen)*. There a file that holds `AC<k>` as a word holds criterion k, counted from 1
  in the issue's order.
- **The criteria** are read as `readIssue` reads them: the `- [ ] ` and `- [x] ` lines under `### Acceptance criteria`,
  up to the next heading. The lamp's boxes are ticked, as a closed issue's often are.
- **Moved:** a criterion line whose text ends `(moved to #<m>)`.

### The gh calls *(chosen)*

- **Closed issues**, one page a call: `gh api 'repos/<owner>/<repo>/issues?state=closed&per_page=100&page=<n>'` for
  n = 1, 2, … until a page holds fewer than 100. Each item has `number`, `title`, `state`, `state_reason`
  (`completed`, `not_planned`, `duplicate`, `reopened` or null), `html_url`, `comments` (a count), `labels`, and for a
  pull request `pull_request` (`{ url, html_url, merged_at }`, with `state_reason` null). It has **no `body`**: each
  issue's text comes from its own read, which is where an issue can fail. An item is read only when it has no
  `pull_request` and its `state_reason` is `completed`.
- **One issue:** `gh issue view <n> --json <fields>`, the fields from `number,title,body,state,stateReason,comments,url,
  labels,author,createdAt,closedAt,closed`. `comments` is gh's list: `{ id, author: { login }, authorAssociation,
  body, createdAt, url, viewerDidAuthor }`.
- **Open pull requests:** `gh pr list --state open --json number,closingIssuesReferences`, with `--limit <n>` (gh's
  default, 30, applies without it). `closingIssuesReferences` is gh's list: `{ id, number, url, repository: { id,
  name, owner: { id, login } } }`.
- **Reopen with a comment:** `gh issue reopen <n> --comment <text>` (or `-c`), as `scripts/spine.mjs` does, or
  `gh issue reopen <n>` and then `gh issue comment <n> --body <text>` (`-b`, or `--body-file <file|->`). A **reopen
  call** is any `gh issue reopen`; a **comment call** is a `gh issue comment`, or a `gh issue reopen` with a comment.

### Lines *(chosen)*

On stdout, one line per issue with a find, then the summary:

```
#<n>: <find>; <find>; …
BLOCKED #<n>: <why>
closed issues: read <r>, held <h>, pending <p>, reopened <o>
```

A find is one of these:

- `unheld <id> "<first words>…"`, one for each unheld criterion: its ID, then its first words, at least its first
  five, as written.
- `stale <id> in <path>`, one for each file of main under the test paths that names an ID of the issue that no live
  criterion has, by the file's repository path.
- `pending #<pr>`, one for each open pull request that closes the issue. A pending issue has nothing else on its line:
  it isn't read.
- `moved <id> to #<m>`, one for each criterion line that ends `(moved to #<m>)`.
- `reopened` when this run reopened the issue, or `said before` when every unheld criterion was named by its earlier
  comments and it was left as it is.

An issue the sweep can't read prints `BLOCKED #<n>: <why>` and nothing else. The summary's counts are of issues:
**read**, closed as completed, not pending, with acceptance criteria, whose text this run read; **held**, read with no
criterion unheld (each held or moved); **pending**; and **reopened** by this run. More counts may follow
(`, blocked <b>`), and other lines may be printed; the tests read only these. On the six fixture issues the throwaway
sweep printed this (IDs shown as `<h8>`):

```
#9106: unheld #9106.<h8> "The lock turns with the key from either…"; stale #9106.<h8> in tests/acceptance/9106/door.test.mjs; reopened
#9104: unheld #9104.<h8> "The fan spins at three speeds from one…"; unheld #9104.<h8> "Its guard keeps a finger out at every…"; unheld #9104.<h8> "Oscillation sweeps 90 degrees at the top speed"; reopened
#9103: unheld #9103.<h8> "Daylight saving moves the hour forward on its…"; unheld #9103.<h8> "The snooze button silences the alarm for nine…"; reopened
closed issues: read 5, held 2, pending 0, reopened 3
```

### The comment, and what the sweep already said *(chosen)*

- **One comment** with each reopen. Its first line starts `Closed-issue sweep:`, and it names each criterion this run
  newly finds unheld by ID and first words, a line each: `- <id> <first words>…`.
- **What the sweep already said** lives on the issue, the record every machine shares: its own earlier comments,
  recognized by that first line. A criterion one of them names by ID was said. While every unheld criterion was said,
  a run makes no reopen and no comment for the issue; a newly unheld one gets one comment naming only it. The stand-in
  serves back every comment written through it, as GitHub would, also marked `viewerDidAuthor: true` with the login
  `fixture-sweeper`; a person's comment on the clock names its two new criteria by ID and isn't the sweep's.
- **Nothing on the machine stands in for that.** Each run starts in a fresh clone with a fresh `HOME` and `TMPDIR`, as
  a run on another machine would.

### Exit status *(chosen)*

1 when any issue is BLOCKED, or when the closed issues or the open pull requests can't be listed (a line `BLOCKED
closed issues: <why>`); 0 otherwise, whatever the run reopened or listed as pending, stale or moved. Every run with
nothing BLOCKED is checked for 0, so a sweep that always exits non-zero fails, and AC5 checks non-zero.

## The stand-in

`gh.cjs` stands in for gh and GitHub. The sandbox puts a wrapper, `<sandbox>/bin/gh`, first on `PATH`, which runs it
with its state folder: `issue-<n>.json` and `pr-<n>.json`, which the tests write and the stand-in updates, and
`fail.json`, the issue every call for fails (`HTTP 502`). It records every call in `calls.jsonl` (its arguments,
folder and time, and stdin for `--body-file -`) and serves back what earlier calls wrote. It serves the calls above,
and also `gh repo view --json nameWithOwner,…`, `gh pr view <n> --json …`, `gh auth status` and `gh --version`;
`-q`/`--jq` with a plain path such as `.body` or `.[].number`; and `-R`/`--repo` naming any repository. `per_page` is
honored up to 100, and is 30 when unset, as GitHub's. A reopen of an issue that is already open leaves it as it is,
without the comment, as gh does. Anything else exits 1 and is recorded in `refused.jsonl` too: `gh issue list` (it
pages inside gh, where no stand-in can show its pages), `gh api --paginate`, any other `gh api` path or method, an
unknown flag or `--json` field, and a `-q` query other than a plain path.

**The sandbox.** Each test has a temporary folder, removed after it, holding the stand-in's state, the fixture
repository and, for each run, a fresh `HOME` (with `XDG_*` in it) and `TMPDIR`. Git gets an identity of its own with
hooks off. The child's environment drops `GH_*`, `GITHUB_*`, `DEEP_*`, git's location variables, `NODE_OPTIONS`,
`NODE_TEST_CONTEXT` and `NO_PROXY`, and points `HTTP_PROXY`, `HTTPS_PROXY` and `ALL_PROXY` (with
`NODE_USE_ENV_PROXY=1`) at 127.0.0.1:9, where nothing listens. Before each run the harness checks that the first `gh`
on the child's `PATH` is the stand-in. Each sweep runs in a process group of its own, stopped by its PID. No test
reaches GitHub, the network or a model.

## The fixtures

All made up, and built at run time by `helpers.mjs` and the test files, which compute each criterion's ID, so no file
in this folder carries a fixture's ID.

| Issue | On the stand-in | Criteria | Tests on main | The sweep should read |
|---|---|---|---|---|
| #9101 the lamp | closed as completed; boxes ticked | 4 | `tests/acceptance/9101/lamp.test.mjs` names 1 and 2 by ID; its `helpers.mjs` holds 3 and 4 | held by ID |
| #9102 the kettle | closed as completed | 3 | `tests/acceptance/9102/kettle.test.mjs`: tests `AC1`, `AC2`, `AC3`, no ID anywhere | held by `AC<n>` |
| #9103 the clock | closed as completed; a person's comment names criteria 4 and 5 | 5; AC3 adds a sixth | `tests/acceptance/9103/clock.test.mjs` names 1 to 3 by ID | 4 and 5 unheld |
| #9104 the fan | closed as completed | 3 | none | 1 to 3 unheld |
| #9105 the toaster | closed as not planned | 2 | none | not read |
| #9106 the door | closed as completed | 3; the second reworded | `tests/acceptance/9106/door.test.mjs` names 1, the second's ID before the rewording, and 3 | 2 unheld; its old ID stale |
| #9121 the heater (AC4) | closed as completed; open pull request #9221 closes it, then closes unmerged | 2 | none on main | pending, then 1 and 2 unheld |
| #9111 the bell, #9112 the gate (AC5) | closed as completed; every call for #9112 fails | 2 each | each named by ID | #9111 held, #9112 BLOCKED |
| #10001 to #10250 (AC6) | closed as completed | 1 each | `tests/paged.test.mjs` names all 250 by ID | held |
| #9131 the map (AC7); #9132 the fog, open | closed as completed | 3; the third ends `(moved to #9132)` | `tests/acceptance/9131/map.test.mjs` names 1 and 2 by ID | moved |

The first six are AC1's fixture of six closed issues; the sixth, the door, is AC2's issue, as the Scope says.

## Criteria to tests

| Criterion | Test (file) | What it requires |
|---|---|---|
| AC1 `#2047.de9de3ac` From a fixture of six closed issues and a fixture tree of tests, the sweep reads five and reports … A planted sweep that counts an issue held when it has any suite passes the third issue and fails, naming it | `report.test.mjs` | A line holds `unheld <id>` and the first five words for each of the clock's criteria 4 and 5, and the clock's unheld set is exactly those; the same for all three of the fan's; no criterion of the lamp or the kettle reads unheld; no line names the toaster, and nothing reopens it or comments on it; the summary counts 5 read and 2 held; exit 0. The planted sweep fails at the clock, naming #9103 |
| AC2 `#2047.3e6fece2` A fixture issue whose second criterion was reworded after its suite was written … reports that criterion unheld and lists the test's ID as stale. A planted sweep that matches such a suite by `AC<n>` number holds the criterion and fails, naming it | `report.test.mjs` | A line holds `unheld <id>` of the door's live second criterion with its first five words, and the door's unheld set is exactly that; a line holds `stale <old id> ` and `tests/acceptance/9106/door.test.mjs`; exit 0. The planted sweep fails naming the criterion, its ID and text |
| AC3 `#2047.2d1ab05b` Against a recording stand-in for `gh`, the first run reopens the third fixture issue with one comment naming both unheld criteria … | `reopen.test.mjs` | Run 1: one comment from the sweep on the clock, holding the IDs and first five words of 4 and 5, and the clock open after one `gh issue reopen`. The issues run 1 reopened are closed again (Readings). Run 2: the clock still holds one comment from the sweep, then 0 reopen calls and 0 comment calls over the run. A sixth criterion is added to the clock's body. Run 3: one comment over all six issues, on the clock, holding the sixth's ID and first words and neither 4's nor 5's ID. Every run exits 0. The planted sweep fails at run 2, naming 2 comments |
| AC4 `#2047.5e2430c0` A closed fixture issue that an open pull request closes is listed as pending … | `pending.test.mjs` | Run 1: no `gh issue reopen` of #9121 and it stays closed; a line names #9121, `pending` and #9221. The pull request then closes unmerged. Run 2: #9121's unheld set is both its criteria, and it is open after one reopen call. Both runs exit 0. The planted sweep fails at run 1, naming #9121 |
| AC5 `#2047.0356e83a` With the stand-in failing for one issue, the run prints BLOCKED naming it and exits non-zero … | `blocked.test.mjs` | A line holds `BLOCKED` and names #9112; the exit status is a number other than 0; the summary counts 1 held (#9111) and 0 reopened. The planted sweep fails at the first, naming #9112 |
| AC6 `#2047.ececce7b` With the stand-in serving 250 closed fixture issues in pages of 100, the summary counts 250 read … | `pages.test.mjs` | The summary counts 250 read; exit 0. The planted sweep fails naming 100 and 250 |
| AC7 `#2047.a0828b81` A fixture issue of 3 criteria whose third line ends `(moved to #<m>)` … | `moved.test.mjs` | No `gh issue reopen` of #9131 and it stays closed; a line names #9131, `moved` and #9132; no criterion of #9131 reads unheld; no comment on it; exit 0. The planted sweep fails at the first, naming #9131 |

## Readings where the issue leaves a choice

- **"A criterion is held when a test on main names its ID."** Any file of `origin/main` under the test paths, helpers
  included (The surface). An ID named only outside the test paths isn't tested.
- **"A suite … that names no criterion ID at all."** No ID of any issue in any file of the folder.
- **"Reads five … one closed as not planned, not read."** The summary counts 5 read, and no line names the
  not-planned issue. Whether the sweep asks gh for it isn't read: its list item already says it was not planned.
- **"Named by ID and first words."** Its ID and at least its first five words, on the issue's line and in the comment.
- **"Lists the test's ID as stale, naming the test."** The file's repository path; the test's own name isn't read.
- **"A second run with nothing changed."** No issue's text and no test on main changed. A reopened issue is open, and
  the sweep reads closed issues only, so between the runs the test closes each issue the first run reopened again, as
  completed, keeping its comments: as a person who closed it again without adding a test would. The second run then
  meets the same closed issues with the same unheld sets, and "0 reopen calls and 0 comment calls" counts the whole run.
- **"Adds one comment naming only that criterion."** One comment over all six issues, on the clock, naming the sixth's
  ID and first words and neither 4's nor 5's ID. Whether that run reopens the clock again isn't read.
- **"Makes 2 comments in two runs and fails, naming the count."** The clock's comments from the sweep after run 2.
- **"Listed as pending with the pull request's number."** A line that names the issue, `pending` and `#<pr>`. A
  pending issue isn't read and isn't counted read.
- **"With that pull request closed unmerged."** Its state turns to closed. It then shows in the closed list as a pull
  request item, which isn't an issue. The merge case ("read once that pull request merges") isn't tested.
- **"BLOCKED naming it … neither held nor reopened."** A line holding `BLOCKED` and `#<n>`; the summary's held and
  reopened counts leave it out. Whether it counts as read isn't read.
- **"Pages of 100."** The stand-in serves `per_page` items a page, at most 100, as GitHub does, and the sweep asks for
  100. The count read is what the criterion names; the pages asked for aren't read.
- **"#<m> an open fixture issue."** #9132 is open on the stand-in. Whether the sweep reads it isn't checked.
- **"The run fails."** Exit 1. Reopens don't fail the run (Exit status).

## Not tested

- **"It runs in the release preflight."** No criterion names it, and no test reads `releaseLanes`. The implementer adds
  the lane to `releaseLanes` in `scripts/lanes.mjs`, for example:

  ```js
  {
    // #2047's: each issue closed as completed keeps a test on main naming each of its criteria; one that doesn't reopens.
    name: 'closed issues',
    commands: [[process.execPath, 'scripts/closed-sweep.mjs']],
    fix: 'Each BLOCKED line names an issue gh could not read: check your gh sign-in (gh auth status) and run the lane again.',
  },
  ```

  No `scripts/lanes.mjs` line is needed for these tests: `affected.mjs` selects them by the path `helpers.mjs` names.
- Issues closed as duplicates (the not-planned issue stands for both); a pull request that merges; a stale ID kept in a
  helper; a second line for one issue; a reopen that gh refuses; the Proof's first run on main.

## Files

- `helpers.mjs`: the sandbox, the fixture repository, the six issues of AC1 to AC3, running the sweep, and readers
  for its lines, its summary, the recorded calls and the comments.
- `gh.cjs`: the stand-in for gh and GitHub (The stand-in).
- `report.test.mjs` (AC1, AC2), `reopen.test.mjs` (AC3), `pending.test.mjs` (AC4), `blocked.test.mjs` (AC5),
  `pages.test.mjs` (AC6), `moved.test.mjs` (AC7).
- `twins.json`, `twins/`: the planted sweeps, one per criterion (`twins/README.md`).
- `BASE-FAILURE.txt`: the run on the base, the run on the throwaway sweep, and how each planted sweep fails.

No fixture holds a secret or personal data. Issues #9101 to #9106, #9111, #9112, #9121, #9131, #9132 and #10001 to
#10250, pull request #9221, `fixture/closed` and the logins `fixture-sweeper` and `fixture-person` are made up.
