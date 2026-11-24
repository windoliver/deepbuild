# Acceptance tests for #2750: every commit the default branch gains reads how it was judged

Written first, blind, at base commit `5fcfb690` (the issue says it read main at `1463afcb`; the base is newer and is what
counts), from the issue, the design and the base alone, before any implementation. The implementing agent doesn't edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

All six checkbox criteria are tested, in issue order, as AC1 to AC6, each `describe` and each test named with its
criterion's ID (`#2750.<h8>`, as `scripts/proof-change.mjs`'s `criterionId` computes it).

## What was read

- Issue #2750 as saved for this job (title, labels, milestone, body; no comments): its opening paragraph, Scope, the six
  criteria, Proof and Depends on. Its References link was not opened; the Scope's Research basis line is all this job
  had of it.
- `docs/technical-design.md`: First-party extensions that ship on by default (the `readings` and `github` rows, and
  States people see with its Watch-only line), How runs become one of five verdicts (Pinned to a commit: the snapshot,
  and "A commit status goes only to a pushed commit whose tree is the snapshot's"; Whose checks count: an escape after
  PASS), How we know version 0 works (Criteria to tests, both ways; Criteria in a checked shape; Wrong programs;
  Dogfooding and its measures; Built to be hard to get wrong), and One event log, with tables built from it.
- The base, for call shapes only: `packages/github/` (`src/pushes.ts`, `src/delivery.ts`, its README),
  `packages/readings/` (`types.ts`, `panel.ts`, `lifecycle.ts`, its README), `packages/hub/src/numbers.ts`, `watch.ts`,
  `status.ts` (`deep numbers`), `hub-control.ts`, `core.ts` (`openGitHub`, the Numbers it opens), `forge.ts`,
  `packages/gate/src/head.ts`, `packages/record/src/index.ts` and `lifecycle.ts`, `packages/contracts/schemas` and
  `fixtures` (`commit.made@1`, `claim.made@3`, `verdict.made@2`, `holds.watch@1`, `session.start@4`, `session.end@2`,
  `landing.made@1`, `push.record@1`, `reading.recorded@1`), `scripts/proof-runs.mjs` (twins, and what "at its assertion"
  is), `scripts/benchmark.mjs` (`fingerprint`, `judgeLimit`), `scripts/lanes.mjs`.
- The suites of `tests/acceptance/46`, `45`, `45-redraft`, `26`, `2018`, `2019`, `2047`, `2134`, `2513` and `3019`,
  for their conventions. #2000 has no suite at the base.

## What the base already does, and these tests don't credit

- A verdict reaches GitHub as a `deepbuild/verdict` status on a pushed commit whose tree is the snapshot's (#46,
  `packages/github/src/delivery.ts`), and the push readings name each pushed commit with its pusher, its ref and its
  tree (`packages/github/src/pushes.ts`). Nothing joins the two: no reading, event kind, command or method lists the
  commits the default branch gained.
- `deep numbers refresh` (`numbers.refresh`) reads each repo your sessions worked in from the forge, for the lifecycle
  numbers of #45, and `numbers.read` lists every reading. Both run cleanly at the base on this fixture; the reading
  these tests ask for isn't among the rows, so every test fails there at its assertion on it.
- The hub keeps the pushes it has read in memory and `github.json`; of a push, the event log takes `ref.unguarded@1`
  and `session.pushed@1` and nothing else.

## How to run

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the hub and the CLI run from dist/, and packages/record reads packages/evidence/dist
cargo build --locked -p deep-hook        # the hub's core stops at its start without it
node node_modules/vitest/vitest.mjs run --root tests/acceptance/2750 --no-file-parallelism
node node_modules/typescript/bin/tsc --noEmit -p tests/acceptance/2750/tsconfig.json
```

Use the repo's Node (`.node-version`, 24.22.0). With `--root` here Vitest writes its cache under
`tests/acceptance/2750/`; delete it before committing. Nothing leaves 127.0.0.1. Temp folders are `/tmp/dh2750-*`; every
process a test starts is stopped by its PID, never by name or port. No test runs an agent, a hook or a model.
`deep-hook` is built because the hub's core resolves it when it opens its products store at its start, to add the
guard entry that keeps that store read-only to sessions, and stops without it; a test then reads
`BLOCKED: the hub didn't start`, never a pass.

`forge.ts`, `fixture.ts` and `judges.ts` import nothing of DeepBuild, so the fixture and the judges can be tried
without a build.

## The surface under test

The issue names behaviors and no code API: "a reading per repo", which "lists with the other readings (#45, #2000)".
So the observable is reached through surfaces the base already has, and what an implementer must provide is the
reading's rows. **Yours** below means: a name this suite chose, which the implementation must spell the same way.

### 1. Reached through what exists at the base

| Surface | How the tests use it |
|---|---|
| `deep numbers refresh --json` (the `numbers.refresh` method) | Run by you, with the hub up. It reads each repo your sessions worked in from the forge, as at the base, and now also that repo's pushes. It returns once it has read them, exits 0 and prints `{ "repos": [...], "unread": [...] }` with `acme/shop` among `repos`. The tests make the reading no other way |
| `numbers.read` (socket method, `cli` role) | `{}` returns `{ rows: [...] }`. The reading is one of the rows |
| `events.read` (socket method) | The record's events, for AC5's asks and notifications |
| `DEEP_HUB_TEST_FORGE=<url>` and `GH_TOKEN` | The REST root the hub's forge calls use and their token, as #46's suite sets them |
| `~/.deepbuild/config.json`, `github.delivery["acme/shop"] = "on"` | #46's delivery rule, on, so a status could be posted |
| `openRecord` and `RecordStore.rebuild` (`packages/record`'s public entry) | Seeding the record with the hub stopped, and replaying the event log (AC4, AC6) |

### 2. The reading (yours)

One row of `numbers.read` per repo that has pushes read, among the other readings:

```jsonc
{
  "id": "landed.none",            // yours: the reading's id
  "subject": "acme/shop",         // the repo, owner/name
  "value": 0.3,                   // the share with none: commits that read none over commits listed, 0 to 1
  "unit": "share",                // as the lifecycle reading firstpass has it
  "detail": [                     // one row per commit the default branch gained in the last 30 days,
                                  // and one row per span the push readings don't cover
    { "commit": "<40 hex>", "judged": "PASS" },
    { "commit": "<40 hex>", "judged": "FAIL" },
    { "commit": "<40 hex>", "judged": "none", "cause": "off" },
    { "commit": "<40 hex>", "judged": "none", "cause": "no_session", "pusher": "sam" },
    { "commit": "<40 hex>", "judged": "none", "cause": "tree", "verdict": "PASS", "verdict_commit": "<40 hex>" },
    { "commit": "<40 hex>", "judged": "PASS", "reverts": "<40 hex>", "counted": "never_judged" },
    { "missing": true, "from": "2026-11-16", "to": "2026-11-18" }
  ]
  // source, age_ms, basis, status and band are a panel row's own and aren't asserted
}
```

A commit row (it has a string `commit`):

| Field | Values | Read by |
|---|---|---|
| `commit` | the commit's full SHA | all |
| `judged` | `PASS`, `FAIL`, `BLOCKED`, `INVALID`, `INCONCLUSIVE` (the verdict whose snapshot's tree is the commit's tree) or `none` | AC1 |
| `cause` | with `none`, one code, the first that applies: `off` (the gate was off), `checks`, `version`, `hooks` (`holds.watch@1`'s own causes), `no_session`, `tree`. A code, never a phrase (design: States people see) | AC1 reads `off`, `no_session`, `tree` |
| `pusher` | with `no_session`: the push's pusher, as the forge recorded it | AC1 |
| `verdict`, `verdict_commit` | with `tree`: the verdict a claim on the same branch has on another tree, by its word, and that verdict's commit | AC1 |
| `reverts` | on a revert: the full SHA of the landed commit it reverts | AC2 |
| `counted` | on a revert or follow-up fix: `never_judged` when what it reverts read none; `escape`, an escape after PASS, when it read PASS | AC2 reads both |

A missing row: `missing: true`, `from` and `to` as UTC dates `YYYY-MM-DD`, both inclusive, one row per span (the tests
read the dates the rows cover together), and no number in it (no count, no share: missing, never zero).

Rows may carry more fields, the list may be in any order, and rows of any other shape are ignored. The tests compare
`id`, `subject`, `value`, `unit`, `band` and `detail` as bytes between two rebuilds (AC4), so none of those may hold a
clock's reading.

### 3. One seam the twins need (base's, kept)

`numbers.read`'s rows are what `panelRows` of `@deepbuild/readings` gives (#45's surface), and
`packages/readings/src/index.ts` is exactly `export * from './impl.js'`, as at the base. Each twin replaces that one
file with `export *` plus a `panelRows` that changes the `landed.none` row on its way out. So the reading's row must
reach `numbers.read` through `panelRows`, or a twin won't reach it.

### 4. Planted wrong readers (yours)

| Criterion | Twin (`twins/<name>/packages/readings/src/index.ts`) |
|---|---|
| AC1 | `squash-takes-head-verdict`, `lists-only-judged` |
| AC2 | `revert-as-escape` |
| AC3 | `uncovered-as-zero` |
| AC5 | `status-on-unjudged` |

`twins.json` maps each criterion's ID to them, and `twins/README.md` says what each plants and where it fails. They are
test code, chosen by being laid over the file and by nothing in the environment (design: Wrong programs).

## The fixture forge (`forge.ts`)

Real HTTP on 127.0.0.1 over a real bare repo at `<tmp>/github.com/acme/shop.git`, copied from #46's and cut down.
`git push` into it runs its `post-receive` hook, which logs the ref change with `FORGE_ACTOR` (empty: no actor) and
`FORGE_AT` (whole seconds; the fixture's pushes are spread over thirty days). Bodies have GitHub's field names. Unknown
routes answer 404. `forge.calls` keeps every call.

| Route | Answers |
|---|---|
| `GET /repos/{o}/{r}` | `full_name`, `private`, `visibility`, `fork`, `default_branch` (`main`), `owner` |
| `GET /repos/{o}/{r}/activity` | ref changes: `id`, `before`, `after`, `ref`, `timestamp` (whole seconds), `activity_type`, `actor` (`{login}` or null); newest first, `direction=asc`, `per_page` (30, at most 100), the next page in `Link` by `after`; `ref`, `actor`, `activity_type` and `time_period` narrow it as GitHub's do. A new branch's `before` is all zeros |
| `GET /repos/{o}/{r}/compare/{base}...{head}` | `commits` (those of `head` that `base` lacks, oldest first), `files`, `status`, `ahead_by`, `behind_by`; 404 for a commit it doesn't hold |
| `GET …/commits/{sha}`, `GET …/commits?sha=` | a commit: `sha`, `parents`, `commit.{author,committer,message,tree}`, `author.login`, `committer.login`. `commit.message` is the whole message, as GitHub gives it: a revert's says `This reverts commit <sha>.` |
| `GET …/commits/{sha}/status`, `…/statuses` | the combined status; the statuses, newest first |
| `POST …/statuses/{sha}` | 201; 401 with no token; 422 for an unknown commit, a state outside GitHub's four, or a description past 140 characters |
| `GET …/pulls` | `[]`: the fixture has no pull request |
| any write to `…/branches/{b}/protection…` or `…/rulesets…` | 403, kept in `forge.refused` |
| **refused reads** (AC3) | Once the fixture calls `forge.withhold(shas)`, every read whose answer would name one of those commits answers 403 `{"message":"Forbidden"}`, with no rate-limit header: a `compare` whose `commits` would hold one, `commits/{sha}` of one, a `commits?sha=` page holding one. `activity` still lists those pushes' ref changes |

## The fixture (`fixture.ts`)

Built anew by each test, counted back from the moment it is built, so every push is inside the hub's last thirty days.
Accounts are made up: `maya` is you, `sam` a teammate. The record is `session.start@4`, `session.end@2`,
`commit.made@1`, `claim.made@3`, `verdict.made@2` and `holds.watch@1`, the base's own kinds, appended through the real
record with the hub stopped. Every claim is on a clean worktree's HEAD, so its snapshot is that commit. A session's
worktree is a real clone whose origin is the forge's repo.

### The shop: the issue's ten commits

| # | Days ago | What it is | Record | Push | Reads |
|---|---|---|---|---|---|
| | 45 | the repo's first commit, outside the thirty days | none | `maya` creates `main` | not listed |
| 1, 2 | 27, 25 | a session's commit on `main` | `commit.made`, a claim on it, PASS | `maya` | PASS |
| 3 | 23 | a session's commit on `main` | `commit.made`, a claim on it, FAIL | `maya` | FAIL |
| 4 | 21 | a squash with its branch head's tree: a session's `topic` head passed 22 days ago and `main` hadn't moved, so the squash you merge has that head's tree and a SHA of its own | the head's `commit.made`, claim and PASS; nothing names the squash | `maya` | PASS, by its tree |
| 5 | 19 | pushed while the gate was off | `holds.watch` cause `off`, on 12 hours before and off 12 hours after; `commit.made`; no claim | `maya` | none: `off` |
| 6 | 17 | a session's commit on `main` | as 1 | `maya` | PASS |
| 7 | 15 | by a person from no session in the record | nothing | `sam` | none: `no_session`, pusher `sam` |
| 8 | 13 | a session's commit on `main`; `main` moves past the `feature` branch's fork | as 1 | `maya` | PASS |
| 9 | 11 | the squash whose tree no snapshot matches: the session's `feature` head (committed 14 days ago, PASS 12 days ago, pushed to `feature`) squashed onto the moved `main`, so it holds commit 8's file, which the head never had | the head's `commit.made`, claim and PASS; the squash's `commit.made` on branch `feature`; no claim on it | `maya` pushes `feature:main` | none: `tree`, verdict `PASS`, verdict_commit the head |
| 10 | 9 | a session's commit on `main` | as 1 | `maya` | PASS |

6 PASS, 1 FAIL and 3 none; the share with none is 3 of 10.

- **The revert (AC2).** Seven days ago a session runs `git revert` on commit 5 on `main`: the message says
  `This reverts commit <sha of 5>.` and the diff removes commit 5's file. Its claim on the revert passes and `maya`
  pushes it. Eleven commits: 7 PASS, 1 FAIL, 3 none.
- **The three refused days (AC3).** Six, five and four days ago a session lands two commits a day on `main`, each with
  a PASS, in one push a day by `maya`. `forge.withhold` then refuses every read that would name one of the six. The
  ten commits above stay readable.

### The month: 2,000 landed commits (AC6)

2,000 commits on `main`, each adding one file, written into the forge's repo with `git fast-import`, in 200 pushes of
ten spread evenly from 29 days ago to one day ago. Pushes whose number is 7 modulo 20 are `sam`'s, with no record (100
commits: none, `no_session`). Of the rest, each a session's with `commit.made`, a claim and a verdict per commit, those
whose number is 3 modulo 20 hold FAILs (100) and the others PASSes (1,800). The record holds 6,080 events.

### Where the expected values come from

`fixture.ts`'s `expected` derives each commit's reading from the fixture's own commits, trees (as git gives them),
pushes and events, by the Scope's rule; the tests then hold that derivation to the issue's numbers (ten commits; 6
PASS, 1 FAIL, 3 none; the three causes with `sam`, `PASS` and the head's commit). No expected value was recorded from a
run of DeepBuild.

## Criteria

| AC | Test | What fails it |
|---|---|---|
| AC1 `#2750.8eb13c6b` | `landed.test.ts`: after `deep numbers refresh`, `numbers.read` lists `landed.none` for `acme/shop` with one row per commit, each read as the fixture says, none left out or added, value 3 of 10 | the merge base (no such reading); **named:** `squash-takes-head-verdict` (the failure names the squash and says the reading is 7 PASS) and `lists-only-judged` (it says 7 of the 10 commits listed, 7 of 7 judged); a reader that joins verdicts to commits by SHA (commit 4 reads none); one that calls every unjudged commit by one cause |
| AC2 `#2750.230902ce` | `revert.test.ts`: the revert's row names commit 5 in `reverts` and is counted `never_judged`; it is the one row counted so; no row is counted `escape` | the merge base; **named:** `revert-as-escape` (the failure names the revert); a reader that doesn't see a revert |
| AC3 `#2750.8f4da496` | `missing.test.ts`: one missing row covering exactly the three refused dates, no number in it, none of the six refused commits listed, and the ten readable commits read as before with their share | the merge base; **named:** `uncovered-as-zero` (the failure names the span); a reader that gives the span a zero; one that says missing for other dates |
| AC4 `#2750.6b561f56` | `rebuild.test.ts`: the reading is made and is the fixture's; then, with the forge closed and the repos removed, two hubs each started on a copy of the event log alone, the record's tables replayed first, list `landed.none` with the same bytes, and it is still the fixture's ten commits | the merge base; a reading kept in memory, in `github.json`, or read again from git or the forge; rows that hold a clock's reading or an unfixed order |
| AC5 `#2750.099939a8` | `quiet.test.ts`: with the delivery rule on and the reading made and listed twice, after a quiet 5 s the forge received nothing but GETs and the record took no `ask.created`, `notice.sent` or `notice.delivered` since the hub started; the test's own POST then lands, so one could have | the merge base (no reading is made, so the run doesn't exist); **named:** `status-on-unjudged` (the failure names the POST and the unjudged commit) |
| AC6 `#2750.e41e681f` | `budgets.test.ts`: the month's 2,000 commits are read and listed as the fixture says; then, on a reference Mac at rest, a warm-up and five runs of what the month adds to a rebuild from the event log, judged against 2,000 ms | the merge base (nothing to time); a rebuild that takes 2 s or more. Off the reference Macs or under load it fails as INCONCLUSIVE, never passes |

The Proof line ("the fixture's ten commits with how each was judged, the revert counted apart, the missing span, and
each planted reader shown failing") is these tests' output, with each twin's run by the proof's before lane.

Every test fails at the merge base at an assertion in its own file, on `numbers.read lists no landed.none reading for
acme/shop` (`BASE-FAILURE.txt`). No test asserts with `toThrow`.

## Readings: where the issue and the design leave a choice

1. **The surface.** The issue names no command, method or export. The design's Criteria in a checked shape allows a
   `deep` command, a socket method or an export the issue names with its signature; it names none, so the tests read
   the reading where #45's suite reads readings on a real hub, `numbers.read`, and add no method or export.
2. **What makes the reading.** `deep numbers refresh` is the base's one command that reads the forge for readings, per
   repo your sessions worked in. Chosen as the one way the tests make the reading, and read as returning only once the
   pushes are read. That the hub also makes it on its own schedule isn't asserted.
3. **The reading's id, subject, value and rows** are this suite's (section 2). The id is the Scope's word for what the
   band is on, "the share with none". One reading per repo holds the commits and the missing spans as its `detail`
   rows, the base's field for what a count counts, so no second id is needed.
4. **Counts.** "How many commits landed with PASS, with each other verdict, and with none by cause" is read by counting
   the rows; the tests ask for no count fields beside them.
5. **Cause codes.** `off`, `checks`, `version` and `hooks` are `holds.watch@1`'s causes, reused; `no_session` and
   `tree` are this suite's. The words a person reads for a cause aren't asserted, since no criterion states them and
   the design keeps a state a code.
6. **"A PASS on their tree."** One of the six (commit 4) has its PASS on another commit with the same tree, so the
   Scope's rule ("a verdict whose snapshot's tree is the commit's tree") is what the test holds, not a join by SHA.
   Its head is pushed to its branch and is in its session's clone, so the tree can be read from either.
7. **The squash.** Read as a session's own squash of its branch onto the moved default branch: the record must hold
   the commit as made by a session, or the earlier cause, no session, would apply first. "A claim on the same branch"
   is read from `commit.made`'s `branch`, which is `feature` for both the head and the squash.
8. **The gate was off** is read at the push's time, the forge's `timestamp`. The commit is made inside the same hours.
9. **A revert** is git's: the commit's message holds `This reverts commit <sha>.`, which the forge gives in
   `commit.message`, and its diff undoes that commit. The revert has a PASS of its own, and still counts as a revert
   of a commit never judged: `counted` is about what it reverts.
10. **Escapes after PASS** have no reading and no event kind at the base. "Stay at zero" is read on this reading: no
    row is counted `escape`. The guard against a reader that reads nothing is the one row counted `never_judged`.
11. **"The forge refusing the push readings for three of the thirty days."** A hub lives in real time and reads the
    forge when asked, so three days can't be lived through; and GitHub's activity keeps what a later read catches up
    on. Read as: the forge refuses, at the one read, every answer that would name a commit pushed on those three days,
    while its activity still shows that the pushes happened. The span is those pushes' UTC dates.
12. **"Gives no share for them."** The reading's value is the share over the commits it lists; the missing row holds
    no number, and the refused commits have no row.
13. **"Rebuilding the reading from the event log."** Read strictly: a new home holds a copy of the log's files and
    nothing else, the forge is closed and the repos are gone, the record's tables are dropped and replayed
    (`RecordStore.rebuild`), and a hub started there lists the reading. So what the reading needs of a push (its
    commits, trees, pusher and time) and of a missing span must be in the event log. Which event kinds hold them is
    the implementation's; the tests name none.
14. **"Recompute."** #45's budget word, read on the same rebuild: the time from the replay's start to the hub's first
    `numbers.read`, on the log with the month's push readings, less the same on the log as seeded. The difference is
    what 2,000 landed commits add, whether the hub rebuilds at its start or at the first read.
15. **"Compared with the merge base."** The base has no such reading and nothing to time, so nothing regresses from
    it, as #46's budget reads the same words.
16. **The reference Macs** are `scripts/benchmark.mjs`'s list, and its `judgeLimit` decides, as the perf lane does:
    mains power, Low Power Mode off, thermal state nominal, load within the cores.

## What isn't asserted, because no criterion says so

- The Scope's causes no criterion reaches: a repo whose checks weren't approved (`checks`), and a session watch-only
  for another cause, named as its row names it (`version`, `hooks`). The fixture holds no such `holds.watch`.
- The band, drafted at 10%, and where the row sorts among the others (#2000). `band` is compared between rebuilds only.
- A follow-up fix to a commit that read none, and that it "charges no check".
- Verdicts other than PASS and FAIL on a landed commit, and two verdicts on one tree.
- `deep numbers`' printed line, `deep_search`'s hits and the Numbers panel's pixels.
- That the reading "changes no verdict" and "blocks no push", beyond AC5's posts, asks and notifications.
- The design's own text ("the design states the reading with the github extension's, in the same PR").
- The Scope's "Not in this task": a status for an unjudged commit, and judging a commit after it lands.
- More than one repo, forks, a force-push to the default branch, and a push with no actor.
- That the hub writes the push readings into the record on its own passes: only after `deep numbers refresh`.

## What the implementer adds outside this folder

- `scripts/lanes.mjs`: `timed.push('tests/acceptance/2750/budgets.test.ts');`, since that file's verdict reads the
  machine's load and timing. `lane.json` already says the folder runs alone.
- `twins.json`'s five twins are delivered here and need nothing added, as long as `packages/readings/src/index.ts`
  stays `export * from './impl.js'` and the reading's row reaches `numbers.read` through `panelRows` (section 3).
- `BASE-FAILURE.txt` holds the base's run.
