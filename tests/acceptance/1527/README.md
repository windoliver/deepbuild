# Acceptance tests for #1527: a repeat job wakes a model only when a no-model test finds something new, and the card says what a month costs

Written first, from issue #1527 as of 2026-11-19 (Scope, the seven criteria, Proof, Depends on; it has no comments), by
the blind acceptance-test job. No implementation of #1527 existed. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

| AC | ID | Criterion, in short | File |
| --- | --- | --- | --- |
| AC1 | `#1527.0d2627bf` | an hourly job over a feed that changes once in 24 h: one model turn, 23 uncounted no-ops with no plan usage; waking on each fire fails, naming the fire | `feed.test.ts` |
| AC2 | `#1527.a2d33481` | a wake test that exits non-zero is a FAIL on the claim, spaced as #365 states; reading it as nothing new fails, naming the run | `failing.test.ts` |
| AC3 | `#1527.ad1741ab` | at approval, a wake test quiet on the planted change is refused naming it, and one that wakes on the twin too | `refusals.test.ts` |
| AC4 | `#1527.d17d4e44` | a session that edits the approved wake test changes nothing: the next fire is BLOCKED on the digest, naming the file | `edited.test.ts` |
| AC5 | `#1527.6377853f` | a monthly report's second run with the same columns makes no model turn and passes its data check; a renamed column wakes the model once | `monthly.test.ts` |
| AC6 | `#1527.3e630e3d` | a card for an hourly job with no wake test is refused, naming the job | `refusals.test.ts` |
| AC7 | `#1527.cd627fd5` | the card shows a cost per run and per month (`monthly.test.ts`); a card without them fails (`refusals.test.ts`); a run past its per-run line stops before its next model turn (`spend.test.ts`) | three files |

Each test's name is its criterion's ID and full text (`#1527.` and the first 8 hex digits of SHA-256 of the criterion's
text, trimmed, white space collapsed, as `scripts/proof-change.mjs` computes it). AC7 has one test in each of three
files, each under the criterion's name. Each file runs one world of its own, except `refusals.test.ts`, whose five
inputs share one.

## What was read

- Issue #1527 (`gh issue view 1527 --json title,body,comments`).
- `docs/technical-design.md` at the base: Blocks for plug-ins that do real work (the **Schedule** bullet, its wake-test
  text and #365's verdicts and spacing; Runner; Source), Work outside a repo, and Dogfooding. `AGENTS.md`.
- At the base `b4a2049e8`, for surfaces and conventions only: `packages/hub/src/intake.ts` and `intake-port.ts` (the one
  input, the card, your yes, `due()` and a repeat job's `round`), `packages/briefs/src/index.ts` (the brief, `cadenceOf`,
  the card page), `packages/hub/src/core.ts` and `server.ts` (`test.clock` under `DEEP_HUB_TEST_CLOCK_STEPS=1`, #965),
  `hub-control.ts` and `work.ts` (the 2 s pass that calls `due()`), `packages/runner/src/types.ts`, the schemas
  `brief.made@1`, `brief.drafted@1`, `schedule.run@1`, `spend.charged@1`, `spend.reserved@1`, `job.recorded@1`,
  `job.ended@2`, `turn.usage@1`, and `scripts/proof-change.mjs`.
- The suites `tests/acceptance/1342` (README, helpers, both test files, `fixtures/claude.pl`), `365` (README, helpers),
  `1332/fixtures/agent.mjs`'s header, `965/helpers.ts`'s clock and `29/h-d.ts`. Imported by path, not copied:
  `../1342/helpers.ts` (`World`: the hub, `deep`, the card, `deep inbox`, `deep status --json`, the workspace) and
  through it `../29/h-d.ts` and `../1332/helpers.ts`.

## What the base does

See `BASE-FAILURE.txt` for the one run. At `b4a2049e8` a brief's cadence is day, week, month or year only, so "every
hour" is no repeat job; the research answer's `watch` and `wake` are ignored, and every input reaches an ordinary card
whose yes makes a workspace and starts one session. No `schedule.run` is ever recorded for a brief. So AC1, AC2 and AC4
fail at "your yes starts the job: a schedule.run of it", AC3, AC6 and AC7's card without costs fail at "refused, so
no workspace is made", AC7's card fails at "the card's brief carries what one run may spend", AC5 at its first run, and
AC7's spend at "the card says what one run may spend".

## How to run

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.0/bin:$PATH"   # the repo's Node
npm ci && npm run build --workspaces                        # every test runs packages/cli/dist/main.js
cargo build --locked -p deep-hook                           # the hub's guards name it: no hub starts without it
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1527 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1527/tsconfig.json
```

Each world lives under `/tmp/dh1342-*` (#1342's World, a short path for the hub's socket), HOME there, removed at the
end; every process is stopped by its PID. The folder belongs in `scripts/lanes.mjs`'s `alone` list (every test starts
its own hub). Vitest with `--root` leaves `node_modules/.vite/` here; delete it before committing. A missing deep-hook
reads BLOCKED (the hub's guards name it; #1342's World checks it). On a right program `feed.test.ts` and `failing.test.ts` each take about 24 and
32 fires of at least 3 s (12 s where no run begins), so 5 to 10 minutes.

## The contract (my choice)

Where the issue leaves a shape open, this is the plainest one the issue's words name, and the implementation builds
exactly this. Everything else is #1342's contract (its README), unchanged.

1. **The clock.** The hub runs with `DEEP_HUB_TEST_CLOCK_STEPS=1` and the tests let time pass with `test.clock`
   (`{ advance_ms }`, #965), then report a plan window with room at the hub's new now (`windows.report`). A fire happens
   on the hub's own pass after the step; the tests never wait real hours.
2. **Cadence.** "every hour" in your words is a job that fires hourly (`cadenceOf` reads hour as it reads day … year);
   "every month" one that fires monthly. A month step is 31 days, so either a 30-day or a calendar reading has one slot.
3. **The research answer** (#1342's, `research.answer`) gains two fields for a repeat job:
   ```jsonc
   {
     "watch": "<the input each fire reads: a link you typed or a file you attached, as you gave it>",
     "wake": {                                   // the wake test, drafted by the research job
       "test": "<the text of a POSIX sh script>",
       "planted": { "name": "…", "before": "<input text>", "after": "<input text>" },  // must answer new
       "twin":    { "name": "…", "before": "<input text>", "after": "<input text>" }   // must answer nothing new
     }
   }
   ```
4. **The wake test's protocol.** On each fire the hub reads `watch` (a GET of the link, or the file), keeps it, and runs
   the wake test with no model, as `sh <test> <before> <after>`: two file paths, the input as the last fire read it and
   as it is now. Its first stdout line answers: `new` or `nothing new`. A non-zero exit (or any other answer) is "fails".
   The wake test never runs as a job on the runner, so it is never a `job.recorded`.
5. **At approval** the hub runs the wake test on the planted pair (it must answer `new`) and on the twin (it must answer
   `nothing new`). One that doesn't is refused, before the card or on your yes: no workspace, no run, and the refusal
   (a `brief.made` `refused` reason, the list's row, or what `deep` or `deep inbox answer` prints) holds the planted
   change's `name` (quiet on it) or the twin's `name` (woke on it). An hourly job (more than one fire a day) whose
   answer has no `wake` is refused the same way, the refusal holding the job's heading (your first words).
6. **The workspace** holds the approved wake test as `.deepbuild/wake.sh`; its SHA-256 is fixed by your approval. A fire
   whose `.deepbuild/wake.sh` doesn't match is BLOCKED: `schedule.run` ended with `verdict: "BLOCKED"`, its `cause`
   holding `.deepbuild/wake.sh` and the word digest; the file on disk is never run and no model wakes.
7. **Each fire is a `schedule.run@1`** (phase queued, dispatched, ended), whose `schedule` holds the first 12 hex digits
   of the brief's key (as `brief.drafted` names it), such as `ext.briefs.r<12 hex>`. Your yes starts the first run at
   once, recorded the same way. Nothing new ends with `noop: true` and no verdict (uncounted, #365); a failing wake test
   is `verdict: "FAIL"` and the schedule spaces and pauses as #365 says (each next run waits twice the last gap, up to
   6 h; after 5 FAILs in a row it pauses).
8. **A model turn** is a job on the runner (`job.recorded`, then `job.ended` with the `cost_usd` its output reported),
   headless Claude Code (`claude -p`) whose folder is the job's workspace, one turn per task of the brief, in order,
   the prompt holding your words. (A session a run starts, `start.started`, counts as a model turn too.) Plan usage is
   any `job.recorded`, `job.ended`, `turn.usage`, `start.started`, `spend.reserved` or `spend.charged`.
9. **The job's own script.** Where a finished run left `.deepbuild/job.sh` in the workspace, a later run runs it with no
   model, as `sh .deepbuild/job.sh <input>` in the workspace (the input as this fire read it), then each
   `.deepbuild/checks/*.sh` there (exit 0 passes). The run ends PASS only when the script and every check pass. A script
   that exits 3 says its input's shape changed: the model wakes once for that run (a hub that detects the shape itself
   may wake it without running the script).
10. **The card's costs.** Before the card the hub runs a dry run: a job on the runner, in a folder of its own that is no
    workspace, whose prompt holds your words and the words "dry run". From the cost it reports, the card's brief
    (`brief.drafted`'s `brief`) carries `cost: { run_usd, month_usd }`: what one run may spend (at least the dry run's
    cost) and what a month comes to; the card's question shows both as dollars (`$0.42`, whole dollars bare) with the
    words run and month. A dry run that reports no cost leaves the card without them, and the card fails: refused as in
    5, the refusal saying cost or spend.
11. **Spend.** Each run's real spend is `spend.charged { run, usd }`, `run` the `schedule.run`'s handle, the sum of its
    turns' reported costs. A run whose spend passes its `run_usd` line starts no next turn: it ends not PASS, its `cause`
    naming the spend (cost, spend or a dollar amount).

## What is real, what is played

Real: the hub (`deep hub run`) and its record, the runner and its jobs, asks and `deep inbox`, `deep "<words>"`, the
list, #67's workspaces, git, the CLI. Played, at boundaries the repo doesn't own:

- **The model and Claude Code**: `fixtures/claude.pl`, installed over #1342's played claude as `claude` first on the
  login PATH. The research job (a prompt holding "DeepBuild research job") answers from `research.json` (#1342's
  format). Any other headless run is a work turn: a dry run (a prompt holding "dry run") takes `work.json`'s first `dry`
  entry whose `match` is in its prompt, any other its first `turns` entry; it writes that entry's `files` into the folder
  it runs in and reports its `cost_usd` as `total_cost_usd` (none when null). A session writes the same files, then runs
  #1332's played agent. The test rewrites `work.json` between fires, so the played model keeps no state of its own.
- **The feed**: a 127.0.0.1 server answering `/feed.json` with what the test sets: two stories, then three (AC1), then a
  page that isn't JSON (AC2).
- **Your files**: the monthly CSVs, attached with `--file` and rewritten by the test between months.

Fixtures: `wake-ok.sh` (new when the feed's stories differ; exit 2 on a feed that isn't JSON), `wake-quiet.sh` (always
nothing new), `wake-twin.sh` (new on any byte changed), `wake-edited.sh` (always new: what the session writes in AC4),
`feed-two.json`, `feed-three.json` (the planted change: a third story), `feed-two-again.json` (its twin: the same two
stories with a new `fetched_at`), `feed-garbled.txt`, `report-1.csv` to `report-3.csv` (`report-3.csv` renames
`region` to `area`), `job.sh` (the whole monthly job with no model; exit 3 on other columns) and `data.sh` (the data
check: the report's total is the input's).

## Readings of what the criteria leave open

- **"One model turn and 23 uncounted no-ops"** (AC1): 24 hourly fires after the first run; the feed changes before the
  10th. That fire has one model turn and a run that is no no-op; each of the other 23 has one run that ended `noop` with
  no verdict, no model turn and no plan usage between its step and its end. "Naming the fire" is `fire <n> at <time>`.
- **"Spaced as #365 states"** (AC2): from the first failing fire, runs at 0, 2, 6, 12 and 18 hours (±15 minutes), each
  FAIL, then none through 30 hours (paused); none wakes the model. "Naming the run" is its `run:<id>` and due time.
- **"At approval … refused, naming it"** (AC3): "it" is the planted change, named by its `name`; the twin's case names the
  twin. Refused before the card or on your yes both count; nothing is made either way. A right wake test in the same
  world is approved and makes its workspace, so refusing every wake test fails.
- **"A session that edits"** (AC4): the first run's model turn, in the workspace, rewrites `.deepbuild/wake.sh`; the next
  fire is the one an hour on.
- **"Still passes its data check"** (AC5): the second run ends PASS (under contract 9, only when `data.sh` passed) and
  the workspace's `report.md` holds the new total, 285, made with no model. "Wakes the model once": the third run has
  exactly one model turn.
- **"Shows a cost per run and per month"** (AC7): both numbers on the brief and in the card's question; from a dry run
  made before the card (at least two jobs on the runner before it) that made no workspace. **"Fails"**: no workspace, no
  run, and a refusal saying cost or spend. **"Stops before its next model turn"**: a two-task report whose first turn
  reports $5 against a line from a $0.30 dry run takes one turn, ends not PASS with a cause naming the spend, and has
  between $5 and $10 recorded against its run; a two-task report at $0.10 a turn in the same world takes both.
- **Waits** (2 minutes for a run to begin after your yes, 10 for it to end, 12 s for a fire to begin a run, 5 minutes
  for a fire to settle, 3 minutes for a refusal) are test timeouts, not criteria.

## Not covered

- The issue's Proof's **one real monthly job run twice on the reference Mac, with its spend from the record**: a live
  run on a paid model, by hand, not written here.
- The card's one line on what would stop the job on this machine, missed fires as one row, check-in links (the design's
  Schedule text, no criterion here). A program that marks the second monthly run PASS without running its data check
  is caught only through contract 9, not by an observation of `data.sh` running. A month's figure beyond being at
  least one run's is not pinned.
