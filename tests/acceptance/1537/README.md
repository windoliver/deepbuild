# Acceptance tests for #1537: the review, numbers and work checks run in a gate

Issue #1537, "The review, numbers and work checks are built and closed, but no gate runs them". Written first, blind,
by a job that never saw an implementation. Sources:

- **The issue**: its Scope, the six acceptance criteria, Proof and Depends on, and what #87, #68, #28 and #30 state.
- **The design**, `docs/technical-design.md`: In version 0 (the review check's one send-back of structured items; the
  numbers check that re-runs the query behind each number a claim states); How runs become one of five verdicts
  (precedence, pending, Whose checks count, Protection: drafted checks kept under `.deepbuild/`); the Check primitive
  (kinds, oracle, "a finding counts only when … its rule names a line of the review rubric your wiki holds").
- **`AGENTS.md`**, and the base commit's code, read for its surfaces only: `packages/hub` (`runs.ts`: every run a
  command check; `server.ts`: the control socket's roles; `plant.ts`: `DEEP_HUB_PLANT`; `core.ts`: the runner opened
  from `config.json`'s `runner.login_path` and `plan.reserve_pct`, `job.list`, `windows.report`), `packages/runner`
  (jobs, the plan-window wait, `job.recorded`), `packages/checks-review`, `packages/checks-numbers`,
  `packages/checks-work` (their public entries and kits), and the suites of #322, #323, #87 and #159.
- **The base commit**: `a4d2c5d4` (main).

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## How to run

With Node 24.22 first on `PATH`, `/usr/bin/perl` (the fake reviewer) and the Rust toolchain:

```sh
npm ci                                   # once
npm run build --workspaces               # the hub and the deep CLI the tests start
cargo build --locked -q -p deep-hook     # target/debug/deep-hook, which every hook runs
npx vitest run tests/acceptance/1537 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1537/tsconfig.json
```

Every test starts hubs of its own, so the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list (`alone`),
beside #322's and #87/gate's; the implementer adds it. No network, no real model, no paid call, no `gh` login. The
tests reuse #322's world and helpers (`tests/acceptance/322/helpers.ts`: the temp world under `/tmp/dh322-*` with
`HOME` set to it, the hub as a process, Claude Code sessions through the real deep-hook, `events.read`, processes
stopped by PID only) and #323's recorded GitHub answers for PR 21 (`tests/acceptance/323/github.ts`), which those
suites keep and nobody edits.

## The surface under test

- **The real hub**, `deep hub run`, with #322's test settings (`DEEP_HUB_TEST_CONFIRM`, `DEEP_HUB_TEST_DRAFTS`,
  `DEEP_HUB_TEST_WORK`, `DEEP_HUB_TEST_GITHUB`) and, for AC6, `DEEP_HUB_PLANT`.
- **Claude Code sessions through deep-hook**, as #322 drives them: SessionStart, the prompt, Read, Edit, Write, the
  `gh pr create` Bash call whose result is PR 21's link, and Stop with the agent's last words. A Stop's reply, and the
  next prompt's, are read from deep-hook's stdout and stderr.
- **The socket** (cli role, control token): `events.read` (`claim.made`, `run.started`/`run.finished`,
  `verdict.made`), `windows.report` (the account's five-hour window), `job.list` (the runner's jobs; kind `review`).
- **`config.json`** in the hub's root: `runner.login_path` (the fake reviewer's folder first) and `plan.reserve_pct`
  (10), as setup writes them.
- **The fake reviewer** (below), the one boundary we don't own: the second model.
- **The repo's sources**, fixtures: a SQLite file (AC2), a JSON source and a Markdown document (AC3).

Two surfaces are new, and these tests define them:

1. **A work check named by a definition of done (AC3)** is a drafted check file under `.deepbuild/checks/` whose bytes
   are a JSON object with check@1's fields and its kind's own (`packages/checks-work`'s `WorkSpec`), as
   `fixtures/q3-report.check.json`:
   `{"kind": "document", "runner": "markdown", "document": "report.md", "inputs": [...], "depth": "unit", "oracle": "code", "contract": null}`.
   A requirement names it by its path in `check`, as it names a drafted shell check, so the lock hashes its bytes as
   it hashes any drafted check's. At the base such a file is run as `sh <file>`.
2. **`checks.kinds`** (AC6), an RPC on the hub's socket for the cli role, with no params:
   ```ts
   { kinds: { kind: string; routes: string[] }[] }
   ```
   One entry per kind the hub holds as a check.kind@1 fill; `routes` names each way a gate run names that kind (such
   as a spec check, a definition of done, every claim that opens or updates a PR, every claim that states a number),
   in words of the implementer's; empty when no gate run can reach it. It is read from the table the gate dispatches
   through, so a held kind with no route shows as one. And one planted wrong program, `DEEP_HUB_PLANT=kind-without-route`:
   the hub still holds the shipped `message` kind but no gate run can reach it, and `checks.kinds` says so (empty
   `routes`, or `message` missing).

### The fake reviewer

`fixtures/fake-reviewer.pl` is installed as `claude` in `<tmp>/bin`, first on the runner's login PATH. It answers what
the runner asks of Claude Code: `--version` with the newest version Claude Code's facts cover, `auth status` as signed
in, and a headless run (`-p --output-format stream-json --verbose`, the prompt on stdin) with one stream-json run in
Claude Code's shapes (system/init, one assistant message, a result with `modelUsage`), every one naming
`claude-sonnet-5-5`, which the facts know and which isn't the session's model (`claude-haiku-5-5`). The run's final
result text is the review check's `ReviewerAnswer` as JSON: `{"findings": [{file, line, rule, quote}], "summary":
"…"}`; the summary is prose, which must never reach the agent. It reports the planted bug, `src/auth.js:4`, quote
`user.role = 'admin'`, whenever the code it is shown holds it: the quote in its prompt (the diff), or at that file and
line of its working folder (a checkout of the claim's commit). Its rule is the one its prompt's rubric gives the text
"an assignment where a comparison is meant" (`wrong-comparison` in the wiki's rubric the tests write at
`~/.deepbuild/wiki/review-rubric.md`), else the first `- <kebab-case-rule>: <text>` line of its prompt, else
`wrong-comparison`. It writes nothing and calls nothing. Each review job the runner records is one call of it, which
is how AC5 counts its calls (`job.list`, kind `review`).

The world also holds a made-up Claude Code sign-in (`~/.claude/.credentials.json`, so no job reads a real keychain)
and, before any claim, a window reading for the account (`windows.report`): 5% used; AC4 then reports 95%, with a
later reset, once the task's definition is locked.

## Criteria to tests

Each test name and failure message starts with its criterion's number and ID, `#1537.<first 8 hex of SHA-256 of the
criterion's text>`, trimmed and white space collapsed (`scripts/proof-change.mjs`).

| ID | Criterion (short) | Test file | What the test does |
|---|---|---|---|
| AC1 `#1537.efe493fd` | a PR claim with a planted bug gets one send-back naming its file and line | `review.test.ts` | the session fixes the middleware (unit and R1's check green) and adds `isAdmin: (user) => user.role = 'admin'` at src/auth.js:4, opens PR 21 and stops; exactly one of the stop's reply or, if that doesn't carry it, the next prompt's reply names `src/auth.js:4`; the failure names the claim |
| AC2 `#1537.cc546fc7` | "the suite has 412 tests" over a source counting 398 is not PASS, the verdict names the number | `numbers.test.ts` | `data/suite.db` with 398 rows in `tests`; green commands; the stop says "the suite has 412 tests (SELECT count(*) FROM tests on data/suite.db)"; no verdict on the claim is PASS and its verdict names 412 |
| AC3 `#1537.59bd30dc` | a definition naming a document check, with a document that breaks it, is not PASS | `document.test.ts` | no spec; R1's drafted check is the document check over report.md; the session writes report.md saying 1,250 where `sources/q3.json` says 1240; no verdict is PASS, and the verdict or the stop's reply names 1,250 |
| AC4 `#1537.930e77d5` | no second model free: BLOCKED or INCONCLUSIVE, never PASS | `no-model.test.ts` | AC1's claim with a clean diff; once the definition locks, the window reads 95% with your reserve 10%; no verdict is PASS, the last is BLOCKED or INCONCLUSIVE |
| AC5 `#1537.70369576` | no PR, no number: no review job, no numbers job, by the fake's calls | `no-jobs.test.ts` | green commands, no PR, words with no number, the fake ready with room in the window; no review job recorded and no run of the claim but its two command checks, 20 s after the verdict |
| AC6 `#1537.552d1d30` | a shipped kind planted with no route fails the reach test, naming it | `reach.test.ts` | the reach test (shipped kinds from each package's fills, against `checks.kinds`) passes on the real hub and fails naming `message` on the hub planted with `kind-without-route` |

## Readings where the issue leaves a choice

- **R1's drafted check** is #323's `expired-token` check (a node:test file the hermetic runner counts), in place of
  #322's `node -e` script, which counts no tests and so ran nothing on the base.
- **A claim that opens a PR** is the stop after a `gh pr create` the hub allowed, as #83 and #322 read it. "Its
  commands green" is held as a precondition (BLOCKED otherwise): the spec's unit check and R1's drafted check each ran
  and passed on the claim.
- **One send-back.** Where it reaches the session is the hub's: the stop's reply when the review lands within the
  hold, else the next prompt's (design: a verdict that landed while the session was stopped goes with the resume).
  The test types one more prompt only when the stop's reply doesn't name the bug, and requires exactly one of the two
  to name it. "Naming them" is `src/auth.js:4`, or the file and "line 4".
- **The second model is Claude Code's**, the only agent signed in on the test's machine, through the runner, as #87's
  and #159's suites run it. A Codex session's claims ("in both agents") aren't driven here.
- **The rubric.** The design puts it in your wiki; the tests write it as `~/.deepbuild/wiki/review-rubric.md`, and the
  fake picks its rule from what its prompt shows, so where the implementer reads the rubric from doesn't decide the
  test as long as the rubric reaches the second model.
- **How a claim cites the query behind a number.** #87: "each number a claim states cites the query behind it". Here
  the claim's own words cite it, in parentheses after the number: the SQL and the SQLite file in the checkout it
  runs on, as `packages/checks-numbers`' `Query` takes them. Not in backticks: the validity gate (`floor.ts`) reads a
  backticked span as a file, line, test or run the session must have read or run, and sends the claim back before
  any check when it isn't one. A claim with no number in its words states none (AC5's words hold
  no digit).
- **"The verdict names the number"** is the claim's `verdict.made` data holding `412`.
- **AC3's naming.** "Not PASS" alone passes at the base, where the drafted JSON file fails as a shell script, so the
  test also holds what #68 states for the document kind: the claim's verdict, or the stop's reply, names 1,250.
- **No second model free** is the window at your reserve, #87's own case; its verdict is BLOCKED (cause plan window)
  or INCONCLUSIVE, per the criterion. A missing binary is not driven.
- **A numbers job** in AC5 is any run of the claim other than its command checks, since the numbers check runs no
  model; the fake's calls are the review jobs the runner recorded.
- **The shipped kinds** are those the workspace's check packages ship as check.kind@1 fills, read from their public
  entries (the kits stay as they are): command, review, numbers, service, data, document and message. The journey kind
  is left out: the issue doesn't ask the hub to hold it.

## Wrong programs

| Criterion | Wrong program | How |
|---|---|---|
| AC1, AC2, AC4 | the base: every run a command check, no review or numbers check | `BASE-FAILURE.txt` |
| AC3 | the base: the drafted document check run as a shell script | `BASE-FAILURE.txt` |
| AC5 | a hub that reviews every claim, or runs a numbers check on a claim with no number | the review jobs and runs counted; not run here |
| AC6 | a hub holding the `message` kind with no route | `DEEP_HUB_PLANT=kind-without-route`; and the base, which lacks `checks.kinds` |

## What this suite could not encode

- **Codex sessions**, and a Codex job as the second model.
- **A source out of reach** for a work check (`missing`), and the review after the fix ("again after the fix").
- **Each kind's route proved by a run**: AC1-AC3 prove the review, numbers and document routes end to end; the rest
  are held by the reach test's listing.

## Files

- `helpers.ts`: criterion IDs, the world, the fake reviewer's install, the claim's steps, the verdict and job readers,
  and the reach test.
- `review.test.ts` (AC1), `numbers.test.ts` (AC2), `document.test.ts` (AC3), `no-model.test.ts` (AC4),
  `no-jobs.test.ts` (AC5), `reach.test.ts` (AC6).
- `fixtures/fake-reviewer.pl`, `fixtures/rubric.md`, `fixtures/q3-report.check.json`, `fixtures/q3.json`,
  `fixtures/q3-sales.md`.
- `tsconfig.json`: the root's strict options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit.
