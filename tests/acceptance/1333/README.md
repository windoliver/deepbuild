# Acceptance tests for #1333: main is watched

I drafted these tests blind from these sources:

- issue #1333, as saved verbatim for this job: its Scope, its six criteria and its Proof
- `docs/technical-design.md`: How we know version 0 works, Dogfooding, Known failures are waivers, Attempt and plan,
  and the lines on asks, the runner's jobs and the record
- `docs/parallel-proof.md`: section 6 (the throttle table), 10a and the evidence records
- AGENTS.md
- the base commit `9bdebdfb`, which has no implementation

At the base I also read `scripts/lanes.mjs`, `affected.mjs`, `known-failures.json`, `throttle.mjs`, `open-issues.mjs`,
`proof-guard.mjs`, `proof-change.mjs` (`criterionId`), `checks.mjs`, `preflight.mjs` and `scripts/lease`; the packages
`asks` (`sources.json`), `runner` (`types.ts`), `cli` (`main.ts`) and the hub's socket methods; and
`tests/acceptance/1116/` and `1115/` for their shape. The helpers are written here, never imported from another
suite. Per AGENTS.md, the implementing agent doesn't edit these tests. A dispute goes to a blind redraft by this job.

## How to run

```sh
node --test 'tests/acceptance/1333/*.test.mjs'
```

There are 8 tests in 5 files, all offline. They're `*.test.mjs` under `tests/acceptance/`, so the unit lane doesn't
pick them up. They need git and Node 24, and no `npm ci`: nothing here, and nothing the job runs in the fixture, imports
a package. At a load of 400 to 460 on this Mac, each file took 20 s to 95 s, and the suite about 2 minutes with files
in parallel.

They run real components: the real job (`scripts/main-watch.mjs`), this checkout's real `lanes.mjs` (`runLanes`,
its report readers, its evidence records), the real `throttle.mjs` and `scripts/lease`, real git, real `node --test`
on a real planted break, and the real `known-failures-check.mjs`.

Stand-ins, all first on `PATH`, all at boundaries the repo doesn't own:

- **`gh`**, for GitHub. Issues and pull requests are JSON files in the sandbox, and every call is recorded with its
  time. A pull request's head is a branch on the fixture's `origin`, and `gh pr merge` merges it into origin's main as
  GitHub would, or exits 1 when it can't merge cleanly. Calls it supports: `issue create|list|view|reopen|close|
  comment|edit`, `pr create|list|view|merge|comment|close`, `repo view`, `auth status`; `--json` with `-q`/`--jq`
  taking a plain path such as `.body` or `.[].number`; `--body`, `-b`, `--body-file`, `--comment`, `--title`,
  `--head`, `--base`, `--state`, `--label`. Anything else, `gh api`, `gh workflow` and `gh run` among them, exits 1
  and is recorded.
- **`claude` and `codex`**, for the agent. Each records its arguments, folder, stdin, start and end, changes nothing,
  prints a result saying so, and exits 0.
- **`deep`**, for the hub's `deep lease` (#1015), which `scripts/lease` calls first: it records the call and runs the
  command, marking it leased. Any other `deep` call exits 1. Without it, `scripts/lease` would start this checkout's
  CLI against a hub in the sandbox's home.
- **Any HTTP endpoint.** `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY` (with `NODE_USE_ENV_PROXY=1`), `ANTHROPIC_BASE_URL`
  and `OPENAI_BASE_URL` point at a recorder the test process runs on 127.0.0.1. Nothing should reach it.

**Every test points `HOME` and `TMPDIR` at a temporary folder**, so the throttle table, the lane records, the job's
state and git's identity are the sandbox's, never the real `~/.deepbuild`. `XDG_*` are in it too. The sandbox unsets
`DEEP_*`, `CLAUDE*`, `CODEX_*`, `GH_*`, `GITHUB_*`, `ANTHROPIC_API*`, `OPENAI_API*`, `NODE_TEST_CONTEXT`,
`NODE_OPTIONS` and `NO_PROXY`. Each process a test starts gets its own process group, and the test stops that group by
its PID. Nothing is killed by name or port. No model is called and no network is used.

## The surface (my choice where the issue leaves it open)

The issue names no command, file or store. At the base there's no landing queue (#1331 is open), no way for a script
to raise one of the hub's asks, and no runner job that changes code. What follows is the smallest surface that makes
each criterion true and observable. Every name below is picked here.

### The job

- **`node scripts/main-watch.mjs tick`** is one scheduled run. The host's scheduler (launchd or cron) calls it, say
  hourly. The tests call it as the scheduler would, and installing the schedule isn't tested.
- **The repository** it watches is the git repository of the current directory. Main is `origin`'s `main`, fetched
  at every tick. The tests run it in a clone that stays at the first commit, so only a job that reads origin's main
  sees the landings.
- **When it's due.** A tick runs when no run has happened on this repository yet, when 5 landings or more reached main
  since the last run, when 6 hours passed since the last run, or while landings are paused. Otherwise it runs no lane
  and exits 0. Only the count of landings is tested.
- **A landing** is a commit on main's first-parent line. **Its issue** is the first `Closes #n`, `Fixes #n`,
  `Resolves #n` or `Part of #n` in its message, or else in the body of the pull request `#N` its subject names
  (`Merge pull request #N …`), read with `gh pr view N --json body`. The fixture's landings carry it in both places.
- **The lanes** are the two named `unit` and `lint` in the `checks` export of `scripts/lanes.mjs` *in a checkout of
  the commit under test*, run through that module's `runLanes` with `cwd` set to that checkout. No other lane runs. So
  every command goes through `scripts/throttle.mjs` and `scripts/lease`: under the machine's throttle grant and its
  `deep lease`. The tick's environment reaches the lanes.
- **A new failure** is a test that fails on main's head, or a lane that fails with no failing test, that isn't listed
  in `failures` of that head's `scripts/known-failures.json`. **The last clean run** is the last tick that found no new
  failure, at the head it ran on.
- **Run alone again.** A new failure runs again, alone, on the same head, under the throttle and the lease. "Alone"
  means its file or narrower. It's **flaky** if it passes on any repeat, and **holds** if it fails on every one. The
  number of repeats is the job's.
- **Flaky.** The tick prints a line holding `INCONCLUSIVE` and the test's name. It files the test once with
  `gh issue create`: a title that doesn't start with `Ask:`, the test's name in the title or the body, `INCONCLUSIVE` in
  the body, and its runs one per line, each starting with `PASS` or `FAIL` after any bullet. Landings stay open.
  Nothing is reverted, reopened or asked.
- **Holds.** Landings pause before anything lands. The job bisects over main's first-parent commits after the last
  clean run, up to the head, running only the failing test at each. It names the first landing the test fails on, and
  so must run the test on that landing and on the one before it. The tick that's due first after the break prints a
  line holding that landing's commit (its first 7 hex digits or more) and its issue as `#n`.
- **The revert** is a branch pushed to `origin`, holding `git revert` of the landing (`-m 1` for a merge) on main's
  head, and opened with `gh pr create --base main --head <branch>`. The job runs the unit and lint lanes on it. **It
  lands** with `gh pr merge <n>` (`--merge`, `--squash` or `--rebase`) only after the failing test passed on it and
  no other test or lane failed there. Then the job runs `gh issue reopen <n>` on the landing's issue, comments with the
  failing test's name (`--comment`, or `gh issue comment`), and opens landings again.
- **A revert that conflicts** starts **an attempt on that issue**: a headless run of an agent CLI, `claude` or
  `codex` as found on `PATH`, in a checkout of main's head. Its arguments or its stdin name the issue as `#n`. The
  attempt ends when that process exits. The tick may wait for it or check on it at a later tick.
- **An ask** is a `gh issue create` whose title starts with `Ask:`. It names the issue as `#n` in its title or body.
  None is raised before the attempt ends. When the attempt has ended and main's head still fails the test, exactly one
  is raised, and later ticks don't raise it again while main stays red. Landings stay paused and nothing lands.
- **`node scripts/main-watch.mjs status`**, run in the same repository, is the gate a landing reads: its first line
  is `landings open` with exit 0, or starts `landings paused` (the reason is free) with a non-zero exit. It answers
  from the job's state without fetching, and must answer while a tick runs. The landing queue (#1331) and anyone landing
  by hand read it. Nothing at the base lands on its own, so this is what "landings stop" means here.
- **State** lives anywhere under `~/.deepbuild/`.
- **No model call and no hosted workflow.** On a break that a revert clears, the job starts no `claude` or `codex`,
  makes no HTTP request, and runs no `gh workflow`, `gh run` or `gh cache`, nor any `gh api` on a `dispatches` or
  `/actions/` path. An attempt is the one place an agent runs (Readings, below).

### Known failures

- **Each entry of `failures`** in `scripts/known-failures.json` ends with ` (#<issue>, added <YYYY-MM-DD>)`. The text
  before it is free, so `affected.mjs` reads it unchanged. This checkout's own file holds every entry in that form.
- **`scripts/known-failures-check.mjs`** is a command of the `lint` lane in `checks`:
  `[process.execPath, 'scripts/known-failures-check.mjs']`. It reads the `known-failures.json` of the repository it
  sits in, which is the one the lane runs in. It reads the open issues through `gh`, by `scripts/open-issues.mjs` or
  `gh issue view`. It exits non-zero, printing each failing entry's test ID, for an entry that names no issue, names one
  that isn't open, or was added more than 14 days ago. It exits 0 when every entry passes. A fresh checkout of main has
  no `node_modules`, so it imports only `node:` built-ins and `scripts/`.
- The `lint`, `timing` and `skips` keys aren't tested (Readings).

## The fixture

`watched()` builds three repositories in the sandbox. **`origin.git`** is a bare repository standing for GitHub's.
**`work`** is the clone the tests land in. **`mac`** is the clone the job runs in, left at the first commit `r0`.

`r0` holds this checkout's `scripts/` (copied whole), an empty `known-failures.json`, `lib/sum.mjs`,
`lib/double.mjs`, a suite of three `node --test` files, and `tags/base`:

| Test | File | What it does |
|---|---|---|
| `adds two numbers` | `tests/sum.test.mjs` | `sum(2, 3)` is 5. The planted break makes `sum` subtract |
| `doubles a number` | `tests/other.test.mjs` | `double(2)` is 4. It holds (below) |
| `settles on a repeat` | `tests/flaky.test.mjs` | Fails once when `$T1333_FLAKY` reads `armed`, rewriting it to `fired` |

Each test notes its run in `$T1333_EVENTS`: which test, whether it passed, the tree's tags, and whether it ran with a
throttle grant (`DEEP_THROTTLE`) and under the lease stand-in. **A landing** `k` is a branch `fixture/l<k>` that adds
`tags/l<k>`, merged into origin's main with `--no-ff` as GitHub merges pull request `#920<k>`. Its message and the pull
request's body say `Part of #910<k>`, or `Closes #910<k>` with that issue then closed. So each run's tags tell which
commit it ran on.

**How it relates to this repo's real suites.** The fixture's `scripts/lanes.mjs` re-exports this checkout's
`lanes.mjs` whole: `runLanes`, the report readers, the throttle and lease wrapping, and the evidence records. It
replaces only `checks`. `unit` is the real unit lane's `node --test` command (`node --test tests/*.test.mjs`). `lint` is
the real lint lane's known-failures command. `typecheck` stands for every other lane: it notes itself and fails, so a
job that runs more than unit and lint never sees main clean. The job can't tell this file from this repo's own. On this
repo the same job runs the real unit lane (vitest, `cargo test --workspace`, `node --test`) and the real lint lane.
Those take over half an hour a run, and a bisection runs them many times, so the planted break goes through the
fixture's tiny suite on the same lane code. The issue's Proof, "a planted break taken through the job on this repo's
real suites", isn't run here (Readings).

**The hold.** `doubles a number` waits, for at most 60 s, while the file `$T1333_HOLD` exists. It does so only on the
tree a revert of landing 2 leaves (`l5` there, `l2` gone). The watch scene creates that file and polls `status` while
the tick runs. It removes the file once landings read paused, or when the tick ends. So a job that pauses before its
revert lands is seen paused, however fast it is, and one that never pauses waits 60 s and is caught.

## The scenes

Each file plays its own scene on a fresh sandbox. Each starts with a first tick on `r0`, which is clean, then makes 5
landings so the next tick is due.

| File | Landings | Then |
|---|---|---|
| `watch.test.mjs` | 2 breaks `sum` and closes #9102 | Ticks, polling `status`, until something lands on main (at most 4). AC1, AC2 and AC6 read it |
| `flaky.test.mjs` | None breaks anything | `$T1333_FLAKY` armed, one tick, polling `status` |
| `conflict.test.mjs` | 2 breaks `sum` and closes #9102; 3 tidies the broken line, so a revert of 2 conflicts | Ticks until an ask exists (at most 4), then one more |
| `schedule.test.mjs` | One at a time | A tick after each of the first 4 runs no lane; the tick after the 5th runs both on main's head |
| `known-failures.test.mjs` | (no job) | The real lint lane's known-failures command, through the real `runLanes`, in a repository whose `known-failures.json` the test writes |

## Criteria to tests

Each criterion's ID is `#1333.<first 8 hex digits of the SHA-256 of its "- [ ]" text, trimmed, white space
collapsed>`, as `scripts/proof-change.mjs` (`criterionId`) works it out. Each test's name starts with its tag. The
Scope tests carry no tag, since no criterion holds them.

| Criterion | Test (file) | What it requires |
|---|---|---|
| AC1 `#1333.f14d14bc` A planted landing that breaks a test is named by the job within one schedule, and landings stop. A planted job that reports only that main is red fails, naming the missing landing | `watch.test.mjs` | The first due tick prints a line naming landing 2's commit and `#9102`. `sum` ran on landing 1 (passed) and landing 2 (failed). Nothing but `sum` ran on landings 1–4, and no lane but unit and lint ran. `status` read paused while the job worked. The "reports only that main is red" twin fails with `the job named no landing: … landing <sha> (PR #9202) with its issue #9102` |
| AC2 `#1333.747cd5ee` The revert lands, the issue reopens naming the failure, and landings resume, with no ask raised | `watch.test.mjs` | Main moved, and differs from the broken head only by landing 2's files, undone. One pull request the job opened is merged. All three tests passed on the revert's tree before the merge, and none failed there. #9102 is open with a comment naming `adds two numbers`. `status` reads open, and there's no ask |
| AC3 `#1333.aded8275` A test that fails once and passes on repeats reads INCONCLUSIVE, is filed, and pauses nothing | `flaky.test.mjs` | The flaky test failed on main's head and ran again after. A line reads INCONCLUSIVE with its name. It's filed once, with INCONCLUSIVE and a FAIL and a PASS run line. `status` read open throughout and after. Nothing landed, no pull request or reopen, no ask |
| AC4 `#1333.ed47bc1a` A revert that conflicts starts an attempt and raises no ask. If that attempt ends with main still red, one ask is raised and landings stay paused | `conflict.test.mjs` | A `claude` or `codex` run was told `#9102`. No ask before the first such run ended. Exactly one ask after it, naming `#9102`, still one after an extra tick. `status` reads paused, and nothing landed |
| AC5 `#1333.87ce4575` A `known-failures.json` entry with no open issue fails the lane, naming the entry | `known-failures.test.mjs` | The real lint lane holds the command. With an entry whose issue is closed and one naming no issue, the lane reads `FAIL lint` and names both. With only an entry naming an open issue, added 2 days ago, it reads `PASS lint` |
| AC6 `#1333.6c0af23f` The job makes no model call and starts no hosted workflow | `watch.test.mjs` | Over the whole watch scene: no `claude` or `codex` run, no HTTP request to the recorder, no `gh workflow`, `run`, `cache` or dispatch call. It isn't judged on nothing: every tick exited 0, the job ran tests after the landings, and it called gh |

| Scope line | Test (file) | What it requires |
|---|---|---|
| "A scheduled job … runs the unit lanes and lints on main's head, under the machine's leases … after a set number of landings or hours" | `schedule.test.mjs` | The first tick runs the three tests on `r0`. Ticks after 1–4 landings run none. The tick after the 5th runs all three on origin's head. Every tick exits 0, `typecheck` never runs, every test run had a throttle grant and a lease, and `deep lease` ran the lint lane's check |
| "Every entry … names an open issue and the date it was added. A lane fails an entry … older than 14 days" | `known-failures.test.mjs` | An entry naming an open issue, added 20 days ago, fails the lane, which names it. Every `failures` entry of this checkout's file ends `(#<issue>, added <YYYY-MM-DD>)` |

## Readings where the issue leaves a choice

- **"Landings stop" and "resume".** Nothing at the base lands, and #1331's queue isn't there yet, so a landing's
  gate is the job's `status`. A queue, or a person landing by hand, reads it. The job lands nothing but its revert
  while paused.
- **"An ask."** The design's asks live in the hub, raised through `@deepbuild/asks` from a row of `ask.sources@1`.
  At the base, no socket method lets a script raise one, and a scheduled job may run with no hub up. So an ask here is
  a GitHub issue titled `Ask: …`, which reaches the person on any host. This is the weakest line of the surface. A
  dispute should start here, and a hub method and a source row could take its place with the same count of one.
- **"An attempt on that issue."** The runner's job kinds at the base (draft, review, read, smoke) are read-only, so
  none fits. An attempt is the agent's own headless run, started by the job. It calls a model, as any attempt does,
  so AC6 is read as the job's own work: it's judged on the scene a revert clears, where no attempt starts. The
  conflict test checks the attempt by its stand-in, never a real agent.
- **"Opens a revert" and "the revert lands".** A pull request, merged through `gh`. A job that pushes straight to main
  fails AC2's merged-pull-request check.
- **"Nothing else changed".** Read as: on the revert, no test or lane fails that didn't at the last clean run. The
  test checks that every test ran and passed on the revert's tree before the merge. It doesn't plant a revert that
  breaks another test.
- **"Passes on repeats".** Read as: passes on any repeat after the failure. "Filed" means a GitHub issue, with its
  runs as lines.
- **"Within one schedule".** The first tick that's due after the break: the tick after the 5th landing since the
  last run.
- **"Hours".** The 6 hours aren't tested. A test would have to move the job's clock or its state, and neither is part
  of the surface.
- **`known-failures.json`'s form.** A suffix ` (#n, added YYYY-MM-DD)` on each `failures` value keeps every reader
  of the file unchanged. "Every entry" is tested on `failures` only.
  `lint` counts, the `timing` list and `skips` (#1115's own approval rule) may take a form of the implementation's
  choosing, and no test reads them. **#1115's test** `failures on main equal today's: known-failures.json keeps the
  merge base's failures, lint and timing` compares this file's `failures` with the merge base's. Any form that names
  an issue and a date changes every value, so that test fails on #1333's own branch, and passes again once #1333 is on
  main. That's the two issues' tests meeting, not a fault of either.
- **A lane failure that isn't a test**, such as the lint lane failing an expired entry, is a new failure by the
  surface above. No test bisects one.
- **Not tested:** a failure listed in `known-failures.json` reads as no new failure; a first run that finds main red;
  an attempt that clears main; a revert that applies but doesn't clear main; the job leaving its clone's working tree
  alone.
- **The Proof's real suites.** These tests run the job's lane code on a fixture suite (The fixture). A run of the job
  on this repo's own main, with a planted break through its real unit lane, takes hours of bisection at the real lane's
  cost. It's for the implementer to run once and report, not for this suite.

## Files

- `helpers.mjs`: the sandbox, the stand-ins (`gh`, `claude`, `codex`, `deep`, the HTTP recorder), launching, the
  watched repository and its landings, and readers for the calls, runs, issues and pull requests.
- `watch.test.mjs`: the break scene, with AC1, AC2 and AC6.
- `flaky.test.mjs`: AC3.
- `conflict.test.mjs`: AC4.
- `known-failures.test.mjs`: AC5 and the 14-day Scope line.
- `schedule.test.mjs`: the schedule Scope line.
- `twins.json`, `twins/`: the planted wrong programs (`twins/README.md`).
- `BASE-FAILURE.txt`: the run on the base, and which test caught each planted program.

No fixture holds a secret or personal data. Issues 9101 to 9105, 9501, 9502 and 9900 on, and pull requests 9201 to
9205 and 9300 on, are made up.
