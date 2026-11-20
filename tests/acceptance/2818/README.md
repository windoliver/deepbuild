# Acceptance tests for #2818: known-failures.json records main's failures

Written first and blind by a job that never saw an implementation of #2818, its diff, its branch or another checkout.
It read:

- the issue (`gh issue view 2818`), the issues it cites (#1872, #1873, #1333) and the pull requests it names as
  examples (#2552, #2592, #2590)
- `AGENTS.md`; `docs/technical-design.md`, How we know version 0 works (Criteria to tests, Wrong programs, The edit
  guard's known-failures rule, Dogfooding, Tests written first); `docs/parallel-proof.md` sections 6, 10, 10a, 11 and 12b
- the base commit `86b99ac36cfbbf5d806aaa5566bd8486f671920c`: `scripts/known-failures.json`,
  `scripts/known-failures-check.mjs`, `scripts/affected.mjs` (its `--record`), `scripts/main-watch.mjs` (how it files a
  flaky failure), `scripts/proof.mjs`, `scripts/proof-guard.mjs`, `scripts/proof-change.mjs` (criterion IDs),
  `scripts/proof-approvals.mjs`, `scripts/proof-runs.mjs` (twins, failing at an assertion), `scripts/lanes.mjs`,
  `scripts/wait-ratchet.mjs`, `tests/fixtures/approver.mjs`, and #1333's and #1115's suites, whose ways of driving
  these scripts in fixture repositories these tests follow

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## How to run

With the repo's Node (24), git and ssh-keygen, from the repo root (run on macOS; nothing in it is macOS-only, but
Linux was not run):

```sh
npm ci --no-audit --no-fund
node --test --test-concurrency=1 tests/acceptance/2818/*.test.mjs
```

- No build. Each test makes a sandbox under the OS temp folder (`deep-2818-*`): its own HOME, TMPDIR and git identity,
  and stand-ins first on PATH for gh, cargo and `deep`. It is removed after the test, with every process the test
  started, each stopped by its process group's PID.
- A record runs `scripts/affected.mjs` in a fixture repository of a few files, never over this repository. Under
  `node --test` with the sandbox's HOME, its throttle grants come from the sandbox's own table, so no slot of the
  machine's is taken (docs/parallel-proof.md, section 6: tables of a test's own).
- Nothing is written to GitHub: the stand-in gh holds issues in a folder. The last part of the first test reads this
  checkout's own `scripts/known-failures.json` and git history, locally.
- On the base the three files took 81 s in all (7 to 44 s each) at a load of 184 to 205 on an 18-core Mac; on a
  throwaway implementation that reruns each failure alone, 22 to 70 s each (Wrong programs).

## Surface choices

What the tests call and read, by name, so the implementation keeps them:

- **The record**: `node scripts/affected.mjs --record <path ...>`, run in the fixture repository on its `main`, which is
  also `origin/main` (pushed to a bare `origin`). The paths are every test file the fixture has and a source file of
  each crate (`crates/fixture-2818/src/lib.rs`): "over every test file and crate". No other argument, flag or variable
  is given.
- **What it writes**: the fixture's `scripts/known-failures.json`, read as JSON after the run. Its `failures` key holds
  exactly the tests that failed, by the ID affected.mjs gives them: `<file> › <name>`, and `cargo -p <crate> --lib ›
  <test>` for a crate's test. An earlier entry whose test passes now, and one whose test is in no file, are gone.
- **An entry's note**: it ends `(#<n>, added <YYYY-MM-DD>)`, as `known-failures-check.mjs` reads it, and it names the head
  it was recorded at by a word of at least seven hex digits of that commit, as the base's notes do
  (`fails on main d8c46f0d5: …`). The date is the record's own day, in UTC (the sandbox's TZ is UTC).
- **The issue an entry names**: the record names it with no input but the command. It reaches GitHub through `gh`: it may
  file one (`gh issue create`) or find an open one (`gh issue list`, `gh issue view`). The stand-in holds no issue for
  these failures beforehand. The issue must be open, and its title or body must name the test's file, or for a cargo
  test the `cargo -p <crate> --lib` that reruns it.
- **The check**: `node scripts/known-failures-check.mjs` in the fixture, with the stand-in gh, exits 0.
- **This checkout's file**: every entry of `failures` in `scripts/known-failures.json` ends
  `(#<issue>, added <YYYY-MM-DD>)` and names, by seven or more hex digits, a commit of this checkout's history at or
  before HEAD (`git rev-parse` and `git merge-base --is-ancestor` in the checkout).
- **The flaky failure**: a line of the record's output (stdout or stderr) that holds `INCONCLUSIVE` and the test's ID.
  The issue is filed as `scripts/main-watch.mjs` files one: exactly one `gh issue create` whose title names the ID and
  starts `Flaky:`, whose body says `INCONCLUSIVE`, names the ID and the head (seven or more hex digits), and lists its
  runs, a line starting `FAIL` and one starting `PASS` (after any list mark). The ID appears nowhere in
  `known-failures.json`. A failure that fails when run alone too is listed, and no `Flaky:` issue names it.
- **The guard**: this checkout's `node scripts/proof.mjs guard`, run in the guard's scene (below). A refusal is a line
  starting `FAIL guard:`, and one about the file holds `known-failures.json`; a pass is no `FAIL guard:` line and exit 0.
  The approval is the annotated tag `deep/approved/1` on the refresh commit, signed with `tests/fixtures/approver.mjs`'s
  maintainer key, which the scene's `.deepbuild/approvers` lists at main. Its `Approves:` items are
  `scripts/known-failures.json`, and for each entry the refresh adds, `scripts/known-failures.json › <id>` and `<id>`.
- **The stand-ins**: `gh.mjs`, issues as JSON files in the sandbox, every call recorded, numbers from 9900, and any
  call it doesn't know (`gh api` among them) refused with exit 1; `cargo.mjs`, whose `metadata` lists each
  `crates/<name>/Cargo.toml` with one lib target and whose `test` prints a run of `tests::passes` (ok) and
  `tests::fails_on_main` (FAILED) as cargo prints one, narrowed by `-p` and by a name after `--`, exit 101;
  `deep lease -- <command>` runs the command. The lint lane's scripts other than `known-failures-check.mjs` are stubs in
  the fixture, since each reads the whole repository, as #1115's fixtures stub them.
- **A failed check** is node:assert's `AssertionError` (`ERR_ASSERTION`), thrown from this folder's files. A plain
  error that starts `BLOCKED` means nothing was judged: no `node_modules`, a record that never ran its jobs (stopped, or
  no grant from the sandbox's table), a guard run with no `PASS guard:` or `FAIL guard:` line, or no git history here.

## Criteria → tests

Each test's name starts with its criterion's ID: `#2818.` and the first eight hex digits of the SHA-256 of the
criterion's text, trimmed and its white space collapsed, as `scripts/proof-change.mjs` computes it. The three IDs were
checked through `readIssue` itself, with the issue's bullets given as `- [ ]` lines.

| Criterion | Test | What it does |
|---|---|---|
| 1 `#2818.7301b617` | `record.test.mjs` | A fixture whose main has a vitest file, a node test file and a crate, each with one passing and one failing test, and a known-failures.json from an earlier record listing a test that passes now and one whose file is gone. A record over all of them must list exactly the three failures, each note naming the head and ending `(#<n>, added <today>)`, each issue open and naming its test; `known-failures-check.mjs` must pass on the result. Then this checkout's own file must hold that shape |
| 2 `#2818.1e81ba0c` | `flaky.test.mjs` | A fixture whose main has a test that fails once and passes on every later run, and one that fails on every run. The record must read the first INCONCLUSIVE, file it once as main-watch files one, and leave it out of the file, while it lists the second and files no `Flaky:` issue for it; and the first must have run again after failing, and passed |
| 3 `#2818.5656e229` | `guard.test.mjs` | The guard's scene: a refresh of known-failures.json, as a record at main's head writes one, as its own commit. With no approval tag the guard must fail, naming the file; under the signed tag it must pass |

### The fixture repository

`helpers.mjs` `mainRepo`: this checkout's `scripts/` copied (the code under test, never `.git`), a folder of links to
this checkout's `node_modules`, `vitest.config.mjs` (`include: ['tests/**/*.test.ts']`), `.gitignore`, the known-failures
file and the test files, committed on `main` in a fresh repository and pushed to a bare `origin`. Every git call runs
with the sandbox's environment, with no `GIT_*` variable from outside, and the helpers drop those from the test
process too before anything runs git.

### The guard's scene

`helpers.mjs` `guardScene`, as #1115's guard scenes: main holds `scripts/proof-guard.mjs` (so the proof lanes are on
main), `.deepbuild/approvers` and a known-failures.json with one earlier entry and one `skips` entry. The branch
`refresh` holds one commit naming a planted issue (`Part of #9818`, its body from `DEEP_PROOF_ISSUES`) that rewrites the
file as a record at main's head would: the earlier entry, whose test passes now, taken out, two failing tests added,
`skips` kept.

## Readings

Where the issue leaves a choice, this job read:

- **"at a named head"**: each entry names the head it fails at in its note, as the base's notes already do, rather
  than one key of the file naming it for all. This needs no new key, and an entry added later by hand names its own.
- **"over every test file and crate"**: the paths given. An implementation whose `--record` selects every test file
  and crate by itself on main reads the same set in the fixture; it must take the paths without refusing them.
- **"naming an open issue for its cause"**: the record finds or files the issue itself, through gh. The test can't
  judge a cause, so it holds the issue to naming the failing test's file (or cargo target), which an issue about that
  failure does.
- **"lists the tests that fail on main"**: exactly those. An entry whose test passes, or whose test no longer exists,
  is no failure at the named head.
- **"`node scripts/known-failures-check.mjs` passes"**: on what the record wrote, in the fixture. For this checkout's
  own file the test reads only what holds whatever the date: every entry ends in an issue and a date, and names a head
  of main. Whether each issue is still open and each entry within 14 days changes with the calendar and with GitHub;
  that is the lint lane's to read, as #1333's suite leaves it.
- **"passes when run alone"**: what reruns a failure, how and how many times is the implementation's. The test reads
  that the flaky test ran again after it failed and passed.
- **"filed the way main-watch files one"**: main-watch's issue: title `Flaky: <id>`, a body that says INCONCLUSIVE,
  names the test and the head, and lists its runs. One per record run; whether a second record files it again is not
  read (main-watch keeps that in its own state).
- **"is not listed"**: no part of known-failures.json names it.
- **"(the file is guarded, #1872)"**: the premise the third test holds, since a guard that reads no key but `skips`
  passes every refresh, approved or not. #1872 is open; until its rule is in the tree, the third test fails on the
  change too. #1872's form for an approval naming an entry isn't built, so the tag names the file, as the base's own
  approvals of this file do, and each added entry in two forms.
- **#1872 against #2818 on `--record`.** #1872's scope removes `affected.mjs --record` (its fifth criterion: a record
  leaves the file byte for byte as it was), while #2818 names `node scripts/affected.mjs --record` as the recorder.
  These tests follow #2818, the later issue: with #1872's fifth criterion in, the first two tests can't pass. That
  conflict is the owner's to settle.
- **The trace lane and this issue's shape.** `scripts/proof.mjs`'s trace lane reads criteria only from `- [ ]` lines
  under `### Acceptance criteria`; #2818 lists them as plain bullets under `## Criterion`, so the lane reads it as
  having none (BLOCKED) until the issue takes that shape. The IDs here are of the bullets' text as written.

## Wrong programs

The merge base fails each test at its assertion (`BASE-FAILURE.txt`). For the third, `twins.json` also names one twin,
for when main holds #1872's guard and the merge base no longer fails it:

| Twin | Criterion | Its defect | How the test fails on it |
|---|---|---|---|
| `skips-only-guard` | 3 `#2818.5656e229` | `scripts/proof-guard.mjs` as the merge base holds it, unchanged: of known-failures.json it guards only `skips`, so a refresh with no approval passes | at its first assertion, `a refresh of scripts/known-failures.json with no approval tag passed the proof guard, so the file isn't guarded (#1872)`, the guard printing `PASS guard: 1 commit checked` |

- The twin's file is the merge base's, so it holds only what the base's file exports. If the change's `proof.mjs` or
  `proof-change.mjs` need more of it, the guard fails to load on the twin, the test reads that as BLOCKED, not as an
  assertion, and the lanes read the twin unrunnable: a dispute for a redraft, since the implementer doesn't edit it.
- **Checked, not kept**: the tests were run on a throwaway implementation in this worktree, never committed and
  restored to the base before this suite's commit. It reran each failure alone up to three times, wrote
  `fails on main <head>: <message> (#<n>, added <today>)` notes with an issue it filed through gh, filed a flaky one as
  main-watch does, rebuilt `failures` from what failed, and gave the guard a rule on added `failures` entries; the real
  file's one note without a head was given one. All three tests passed on it (record 70 s, flaky 41 s, guard 22 s at a
  load of 186). Then, one at a time on it: the twin laid over its guard failed the third test at its first assertion;
  a record that also lists the flaky test failed the second at `the flaky test is listed in scripts/known-failures.json`;
  one whose notes name no head failed the first at `… doesn't name the head it was recorded at`; and one that keeps an
  earlier record's entries, as the base does, failed the first at `the record lists other tests than those that fail on
  main at its head`.

## Expected at the base

Run on the base, see `BASE-FAILURE.txt`:

- `record.test.mjs` fails at its assertion: the base's record lists the three failures but writes each failure's message
  as its note (`expected 1 to be 2 // Object.is equality`, `fails on main` for the cargo test), with no issue, date or
  head, and keeps the entry of the test whose file is gone. This checkout's own file would fail too, if reached: its
  #2844 entry (`FAIL 2.8468, …`) names no head.
- `flaky.test.mjs` fails at its assertion: the base's record runs the flaky test once, prints `NEW FAIL` for it, files
  nothing and lists it with its message.
- `guard.test.mjs` fails at its assertion: the base's guard passes the refresh with no approval tag.

## Unrun, and gaps

- **The real refresh.** No test records this repository's main: a record over every test file and crate takes hours
  and holds one of the machine's two test slots. Whether the committed file lists every failure of main at its named
  head is shown by that record's own output, which the change must carry; the first test holds the recorder on a
  fixture and the committed file only to its shape.
- **The real file's open issues and 14 days** are the lint lane's (Readings).
- **No live gh.** The stand-in answers the calls named above; a recorder that reaches GitHub another way, such as
  `gh api`, is refused there.
- **Filing across records** (a flaky test filed once over several records) is not read.
- **The guard on the change itself**, `node scripts/proof.mjs guard` on the implementing branch with its real approval
  tags, is the guard lane's run, not this suite's; the third test holds the rule it depends on.
