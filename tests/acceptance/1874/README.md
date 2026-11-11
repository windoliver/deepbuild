# Acceptance tests for #1874: the window closes an issue only on criteria a passed task names

I drafted these tests blind from these sources:

- issue #1874, as saved verbatim for this job, and #1116's body
- `docs/technical-design.md`: How we know version 0 works (Criteria to tests, both ways; Criteria in a checked shape;
  Wrong programs; The edit guard; Dogfooding), Every task carries its own budgets, The reference Macs
- `docs/parallel-proof.md`, sections 7a, 10, 11 and 12a
- AGENTS.md
- the base commit `f28d8777`, which has no implementation. `scripts/budget-window.mjs` there is the same file as on
  main `a9d2e682`, the commit AC1 names

At the base I also read `scripts/budget-window.mjs`, `throttle.mjs`, `benchmark.mjs`, `lanes.mjs`, `proof-change.mjs`
and `proof-runs.mjs`, `tests/acceptance/1116/`, `tests/budget-window.test.mjs`, and the two `*-redraft-1405` folders.
Per AGENTS.md, the implementing agent doesn't edit these tests. A dispute goes to a blind redraft by this job.

Run them with:

```sh
node --test tests/acceptance/1874/window.test.mjs
```

One file, four tests, one scene: a fixture repository, four commits, one real window run through
`node scripts/throttle.mjs window` in the fixture's checkout. It took about 30 s on a Mac17,10 at a 1-minute load of 13 to 90.
The scene runs on the first test's turn. The sandbox, the fixture and the stand-ins (`gh`, the fingerprint tools, the
pinned load, `npm` and `cargo`) are #1116's, imported unchanged from `../1116/helpers.mjs`. Every process gets a
temporary `HOME`, `XDG_CACHE_HOME` and `TMPDIR`. `helpers.mjs` here adds an issue with a body of the test's own, a
criterion's ID, and the commit that makes the fixture's task name criteria.

## The surface (my choice where the issue leaves it open)

Everything in `tests/acceptance/1116/README.md`, "The surface", stays: how a window opens, what it measures, the mark,
the record's place and shape, `Part of #n`, and the `gh` calls. #1874 changes two things, and names neither field.

- **`criteria` on a task of `benchmarks/budgets.json`**: a list of criterion IDs, each the string `#<issue>.<h8>` the
  trace lane computes (`criterionId` in `scripts/proof-change.mjs`): the first 8 hex digits of the SHA-256 of the
  criterion's checkbox text, trimmed, white space collapsed.

  ```json
  { "id": "fixture-bench", "command": ["node", "bench.mjs"], "margin": 0.5, "limits": { "p50Ms": 60000 },
    "initialReason": "…", "criteria": ["#9404.1a2b3c4d", "#9404.5e6f7a8b"] }
  ```

  A task with no `criteria` names none. I chose the word the issue uses ("names the criteria it proves") and the ID
  the design already gives a criterion, so no second naming exists.
- **`unmeasured` on a commit's record**: a list of the same ID strings, one for each unticked criterion, of the issues
  the commit names, that no task that passed in this record names. It sits beside `commit` and `base`, the fields
  #1116 added to T9b's shape through `writeRecord`'s last argument. A record with nothing unmeasured may leave the
  field out or hold an empty list.
- **An issue's criteria** are the checkbox lines under its `### Acceptance criteria` heading, up to the next heading,
  as `readIssue` in `proof-change.mjs` reads them. A checkbox anywhere else has no ID, and an issue with no such
  section has no criteria.
- **Closing.** The window runs `gh issue close <n>` only when the issue has that section and every unticked line in it
  is named by a task whose row in this commit's record is `PASS`. Otherwise it leaves the issue open.

The tests enter only through `throttle.mjs window`, the record files under `~/.deepbuild/lanes/` and the stand-in
`gh`'s state. They import no script.

## Criteria to tests

| Criterion | Test (`window.test.mjs`) | What it requires |
|---|---|---|
| AC1 `#1874.31be6d55` A fixture commit naming an issue whose unticked budget criterion no task names leaves that issue open, and its record names the criterion as unmeasured. On main a9d2e682 the window closes it. A planted window that closes it fails this test | `#1874.31be6d55 a commit naming an issue whose unticked budget criterion no task names…` | The commit has a record whose `fixture-bench` row is PASS. Issue 9401 is OPEN. The record's `unmeasured` is exactly that criterion's ID |
| AC2 `#1874.5b585ee4` A fixture commit naming an issue whose only unticked criterion says "in the local preflight", and which no task names, leaves the issue open | `#1874.5b585ee4 …` | Record with the task PASS. Issue 9402 is OPEN |
| AC3 `#1874.e31e7828` A fixture commit naming an issue with no `### Acceptance criteria` section closes nothing | `#1874.e31e7828 …` | Record with the task PASS. Issue 9403 is OPEN |
| AC4 `#1874.cbb20ab2` A fixture commit whose issue's budget criteria are each named by a task that passed, with every other criterion ticked, closes the issue, as today | `#1874.cbb20ab2 …` | Record with the task PASS. Issue 9404 is CLOSED |

Every test first requires the commit's record with the task PASS, so a window that did nothing fails all four.

## The scene

```
r0 ─ r1 ─ task-names ─ unnamed ─ preflight ─ nosection ─ named      main; the first window marks task-names
```

`task-names` gives the fixture's one task its `criteria` and lands before the first window's mark, so no window
measures it and every later commit and merge base holds the same task (a commit that changes an established task's
definition isn't PASS at the base). Each of the four later commits adds one file and says `Part of #<n>`.

| Commit | Issue | Its body | The task names |
|---|---|---|---|
| `unnamed` | 9401 | `### Acceptance criteria`: one ticked line, and an unticked ``` `fixture-bench` stays within its p50 budget on a reference Mac ``` | nothing of it |
| `preflight` | 9402 | one ticked line, and an unticked `The fixture's docs are linted in the local preflight` | nothing of it |
| `nosection` | 9403 | no `### Acceptance criteria`; a `## Criterion` heading, as #1009 has, over one unticked budget checkbox | that checkbox, by the ID it would have as a criterion |
| `named` | 9404 | one ticked line, and two unticked budget lines (p50, peak memory) | both |

## Wrong programs

AC1 to AC3 fail on the base at an assertion: the base's window is AC1's "planted window that closes it", and it closes
9402 and 9403 too (`BASE-FAILURE.txt`). AC4 passes on the base, "as today", so it has a twin. AC1's base failure is
at the issue's state, before its record line is read, so that line has a twin too. `twins.json` maps them.

| Criterion | Twin | The planted fault |
|---|---|---|
| `#1874.31be6d55` (AC1) | `silent-record` | The issue stays open, and the record never holds `unmeasured` |
| `#1874.cbb20ab2` (AC4) | `never-closes` | The window never closes an issue |

Each twin is `twins/<name>/scripts/budget-window.mjs`: a whole window, my throwaway with one line changed, importing
only `./benchmark.mjs`, `./lanes.mjs` and `./throttle.mjs` beside it. The throwaway is the base's window plus about 20
lines that meet the issue on this surface. It passes the four tests and isn't kept. A twin goes stale as the real file
changes, and still holds its fault.

## Readings where the issue leaves a choice

- **"Names the criterion as unmeasured".** Read as the ID in the record's `unmeasured` list. A comment on the issue
  would say it too, and no test asks for one.
- **The record's state with a criterion unmeasured.** The issue doesn't say whether such a record is still PASS. The
  tests read the task's row, never the record's state, so either holds.
- **AC2's record.** The Scope line gives every unnamed criterion a place in the record. AC2 only says the issue stays
  open, so its test doesn't read `unmeasured`.
- **AC3, "closes nothing".** Each commit names one issue, so what it could close is that issue. The task names the
  checkbox under `## Criterion`, so the missing section alone keeps 9403 open: a window that hashes any checkbox in
  the body closes it.
- **AC4, "budget criteria … each named by a task".** One task names both. The fixture has one task, to keep the
  window short.
- **"On the reference Mac".** The helpers stand in a Mac15,7 on mains and pin the load each process reads, as #1116's
  suite does, so the limits are judged and a PASS is reachable on any Mac.

## Known limits

- Both sides of every commit hold the same `criteria`, so no test decides whether the window reads them from the
  commit or from its merge base.
- No test has a task that names a criterion and doesn't pass: a record that isn't PASS already keeps its issues open
  at the base.
- No test covers `docs/parallel-proof.md` section 7a or the signed approval tag. No criterion holds them.

## What the implementer adds outside this folder

- `criteria` on the tasks of the real `benchmarks/budgets.json`. `validateBudgets` at the base reads a new key on an
  established task as a changed definition, so the commit that adds them isn't PASS in its own window unless the
  change settles that.
- The swap of the five #1116 tests `tests/acceptance/1116-redraft-1874/REDRAFT.md` lists, by an approved proposal.

## Files

- `window.test.mjs`: the scene and AC1 to AC4.
- `helpers.mjs`: `fileBody`, `criterionId`, `unticked`, `nameCriteria`, and the timeouts.
- `twins.json`, `twins/`: the planted wrong programs.
- `BASE-FAILURE.txt`: the run on the base, the throwaway and each twin.

No fixture holds a secret or personal data. Issues 9401 to 9404 are made up.
