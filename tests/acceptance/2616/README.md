# Acceptance tests for #2616: a pull request head's check runs read past the first page

Written first, blind, at base `e575a47af` (origin/main on 2026-11-20, the bug present) by a job that saw only:

- issue #2616's body (Scope, the three checkbox criteria, Proof, Depends on; no comments, no pull request);
- `docs/technical-design.md`: First-party extensions that ship on by default, with States people see; Verdict; How we
  know version 0 works (Criteria to tests, Criteria in a checked shape, Wrong programs, the edit guard, Dogfooding);
  and Tests written first;
- `AGENTS.md`;
- the base's files, for surfaces and shapes only: `packages/hub/src/forge.ts` (`Forge`, `parsePrUrl`, `pull`,
  `checksRunning`, `page`, `all`, `BUDGET_MS`), `packages/hub/src/hub-readings.ts` (the receipt, `change`, reads
  `forge.pull`), `packages/hub/src/answer-delivery.ts` (`pullFor`), `packages/hub/src/server.ts`
  (`DEEP_HUB_TEST_FORGE`), `packages/hub/test/forge.test.ts`, the package manifests of `hub`, `contracts` and
  `config-eval`, `scripts/proof-change.mjs` (`criterionId`), `scripts/proof-runs.mjs` (twins; failing at an
  assertion), `scripts/lanes.mjs` (`alone`, `timed`), `scripts/public-text.mjs`, `vitest.config.ts`,
  `tests/vitest-setup.ts`, and the READMEs of #2870's, #2898's, #2645's, #1342's and #83's suites for their shape.

No implementation of #2616 existed and none was read. The implementer doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding).

## Run

```sh
npm ci --prefer-offline --ignore-scripts
npm run build -w packages/contracts -w packages/evidence -w packages/record -w packages/config-eval -w packages/hub
NO_COLOR=1 npx vitest run tests/acceptance/2616 --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2616/tsconfig.json
```

- `packages/contracts` is built because `forge.ts` imports `@deepbuild/contracts/json`, which the root config resolves
  to its `dist`. The other four are built only so the root `vitest.config.ts` loads: it imports `scripts/lanes.mjs`,
  whose `scripts/config-eval.mjs` names them, and its bundler needs their entries. `npm run build --workspaces` covers
  all five.
- Each test takes under a second (62 to 913 ms here). The run of both files took 14 s in vitest and 23 s wall on an
  18-core Mac at a load of about 210; most of a file's time is the root setup file's hooks. No hub, no deep-hook, no
  child process, no timing, no throttle window, and nothing beyond 127.0.0.1. No `scripts/lanes.mjs` entry is needed:
  the files start no process (not `alone`) and judge no time (not `timed`).

## The surface under test

- **The forge reader the issue names**, `packages/hub/src/forge.ts`, imported by its path *(chosen: the issue names
  the file and `Forge.checksRunning`, and the hub's public entry doesn't export it)*. The tests call
  `new Forge(api, undefined, 60_000).pull(parsePrUrl('https://github.com/acme/widgets/pull/7'))` and read its `state`.
  `checksRunning` is private: `pull` calls it for an unmerged head, and `pull`'s `state` is the pull request's state
  the receipt shows (`hub-readings.ts` `change`: each ask's `pr.state`, and `PR <state> <url>` on its second line).
- **The budget** the constructor gets: 60 s *(chosen)*. The receipt passes none and gets `BUDGET_MS`, 5 s. No criterion
  names a time; a minute keeps a loaded machine from cutting a read short, so no leg depends on load.
- **The recorded forge** (`helpers.ts` `recordedForge`) *(chosen)*: an HTTP server on 127.0.0.1 holding GitHub's REST
  answers, in its shapes, for one open pull request, acme/widgets#7, its head's check runs and its commit status. It
  logs every request. It names:
  - `GET /repos/acme/widgets/pulls/7`: the pull request, open and not merged, its head the test's head;
  - `GET /repos/acme/widgets/commits/<head>/check-runs`, with any query but a page other than 1: page 1 of the head's
    check runs, `total_count` the head's whole count;
  - every later page only at the URL the page before it names in its `Link` header, `rel="next"` (and `rel="last"`),
    in GitHub's form `<root>/repositories/4242/commits/<head>/check-runs?page=<n>`, with that query and no other; page 1
    is there too, as later pages name it (`rel="prev"`, `rel="first"`);
  - `GET /repos/acme/widgets/commits/<head>/status`, any query: the combined status of a head that has no status, as
    GitHub answers it (`state: "pending"`, `total_count: 0`, `statuses: []`).

  Pages hold 30 runs, whatever page size the request asks. **A request the recording doesn't name is answered 404**
  with GitHub's Not Found body, and logged as not named; every failure message lists what the forge was asked, each
  request it didn't name marked.
- **The heads** (`helpers.ts`): 45 check runs (lint, typecheck, build, 24 unit shards, 16 end-to-end shards, docs,
  package), 30 on page 1 and 15 on page 2. For AC1 its 38th run, `e2e (shard 11 of 16)`, check run 41261600038, on
  page 2, is `in_progress` and the other 44 completed (`success`); for AC2 the same head, same commit and runs, all 45
  completed. 12 check runs on one page for AC3 (lint, typecheck, build, 8 unit shards, e2e): its 8th, `unit (shard 5
  of 8)`, check run 42261600008, is `queued`, the other 11 completed. No head has a commit status.
- **"Naming the run"** (AC1) *(chosen)*: the failure's first line names the unfinished run by its name, check run ID,
  status, and its place (`run 38 of 45, on page 2 of 2`), and says what the pull request read.
- **"Naming the request"** (AC3) *(chosen)*: the failure's first line is the request line the reader sent for a page
  of check runs the recording doesn't name, such as `GET /repos/acme/widgets/commits/<head>/check-runs?per_page=100&page=2`.
- **"A request for check runs"** (AC3) *(chosen)*: a request whose path ends in `/check-runs`.

## Criteria, tests and wrong programs

Each test's name starts with `AC<n>` and its criterion's ID, `#2616.` and the first eight hex digits of the SHA-256 of
the criterion's text, trimmed and its white space collapsed (`scripts/proof-change.mjs` `criterionId`).

| ID | Criterion | Test | What it asserts | On the base | Wrong program |
|---|---|---|---|---|---|
| AC1 `#2616.eb2caca2` | Against a recorded forge whose head has 45 check runs over two pages, the one unfinished run on the second, the pull request reads `checks running`. On the merge base it reads `open`, and the test fails, naming the run | `two-pages.test.ts`, AC1 | the pull request's state is `checks running` | fails at its assertion: reads `open`, naming `"e2e (shard 11 of 16)" (check run 41261600038, in_progress), run 38 of 45, on page 2 of 2` | the merge base |
| AC2 `#2616.f16645e8` | With every run on both pages completed and no pending status, the same head reads `open` | `two-pages.test.ts`, AC2 | the same head, every run completed, no status: the state is `open` | passes: the base reads page 1 alone, all completed, and the head has no status | twin `next-page-reads-running` |
| AC3 `#2616.58c0bef1` | A head with 12 runs, one of them unfinished, reads `checks running` from one request for check runs. A planted reader that asks for a page the forge didn't name fails, naming the request | `one-page.test.ts`, AC3 | in order: no request for a page of check runs the recording doesn't name (naming each); exactly one request for check runs (naming each); the state is `checks running` | passes: one request, `checks running` | twin `asks-past-last-page`, the issue's planted reader |

## Wrong programs

The merge base is AC1's. AC2 and AC3 hold on the base, so each names a twin in `twins.json`: the base's
`packages/hub/src/forge.ts` with one planted defect in `checksRunning`, which the proof lanes lay over the change at
that path. Each was written by this job from the base's file alone.

| Twin | Criterion | Its defect | How the test fails on it |
|---|---|---|---|
| `next-page-reads-running` | AC2 | it reads the head's first page of check runs and, when the forge names a next page, answers running without reading it: the shortcut that passes AC1 | AC2 fails at its assertion: the head whose 45 runs all completed reads `checks running` |
| `asks-past-last-page` | AC3 | it asks for pages by number, `?per_page=100&page=<n>`, never by the forge's link, until one comes back empty, so it always asks for one page past the last the forge names | AC3 fails at its first assertion, naming `GET /repos/acme/widgets/commits/<head>/check-runs?per_page=100&page=2` |

Each twin is a whole file, the base's, so it holds only what the base's `forge.ts` exports and takes. If the change
makes another file need more of `forge.ts`, the twin's checkout won't build and the lanes read it unrunnable: a dispute
for a redraft, since the implementer doesn't edit it.

## Readings where the issue leaves a choice

1. **"A recorded forge."** No live repo was read (the issue: "No run against a live repo was made"), so the recording
   is written here in the shapes of GitHub's REST API: the pull request, the check-runs list (`total_count`,
   `check_runs`, each run's `status` and `conclusion`), the `Link` header and the combined status.
2. **"45 check runs over two pages."** 30 on page 1 and 15 on page 2, GitHub's page when none is asked, as the issue
   gives it, whatever page size the reader asks: a reader that asks `per_page=100` still gets two pages and must follow
   the forge's link. So "over two pages" holds for every reader.
3. **Where the forge names a page.** At the URL in the `Link` header of the page before it, in GitHub's form for a
   repository's lists, `/repositories/<id>/…`, not `/repos/<owner>/<name>/…`. A later page a reader builds for itself,
   at any other path or with any other query, is a page the forge didn't name, and is answered 404. Since the file's
   other lists already follow the forge's next link through `all` (the issue), following it is what "every page" is
   read as.
4. **"No pending status."** The head has no commit status at all, and the forge answers its combined status as GitHub
   answers such a head: `state: "pending"` with `total_count: 0` and no statuses. The base reads that as not pending,
   as its own unit test holds. The same answer serves AC1 and AC3, so `checks running` can come only from a run.
5. **"Unfinished."** A run whose `status` isn't `completed`: AC1's is `in_progress`, AC3's `queued`, each with
   `conclusion: null`. Completed runs carry `conclusion: "success"`.
6. **"The same head"** (AC2): AC1's head, its commit and its 45 runs on the same two pages, the one unfinished run now
   completed.
7. **"From one request for check runs"** (AC3): exactly one request whose path ends in `/check-runs`. The pull request
   and the status aren't counted.
8. **"A planted reader that asks for a page the forge didn't name fails, naming the request"** (AC3): the planted
   reader is the twin `asks-past-last-page`, which the proof lanes run AC3's test against. The test's first assertion
   is that no request for check runs went to a page the recording doesn't name, its message naming each one that did.
   No untagged copy of the reader in test code is added: the twin's run below shows the message.
9. **"On the merge base it reads `open`"** (AC1) is the base's run of the same test, not a second assertion: the test
   asserts `checks running`, and on the base its failure shows `open` and names the run (`BASE-FAILURE.txt`).
10. **The receipt's forge budget** (Scope) and **"a status answer"** (the issue's opening) are named by no criterion,
    so neither is asserted. The tests read the pull request's state where the receipt reads it, `Forge.pull`, with a
    budget of a minute (the surface, above).

## BLOCKED and INCONCLUSIVE

- No leg reads INCONCLUSIVE: nothing is timed, and no load or machine gate is read.
- A `parsePrUrl` that reads no pull request in `https://github.com/acme/widgets/pull/7` throws `BLOCKED: …`, a plain
  error, never an assertion and never a pass. A recorded forge that can't listen on 127.0.0.1 errors before any
  assertion the same way.
- A reader that never answers is cut by its 60 s budget; each test's own timeout is 180 s.
- A twin that won't build over the change reads BLOCKED in the lanes (Wrong programs, above).
- AC1 names no twin: its wrong program is the merge base, so its proof needs the merge base to still have the bug.

## What the implementer adds outside this folder

- The fix in `packages/hub/src/forge.ts`'s `checksRunning`.
- Keep, as at the base: `Forge`'s constructor `(api, token, budget_ms)`, `pull(pr)` answering `{ state, closes }`,
  `parsePrUrl`, and the file's exports, since the tests call them and each twin replaces the whole file.
- Nothing in `scripts/lanes.mjs`.

## Checked beyond the base run

- Each twin type-checked under `packages/hub/tsconfig.json`'s options, then was laid over this worktree's
  `packages/hub/src/forge.ts` at the base and the file that tests its criterion run once (`BASE-FAILURE.txt`).
- A throwaway right reader (not committed; written in a scratch folder, laid over `forge.ts` for one run): the base's
  file with `checksRunning` reading `…/check-runs?per_page=100` and then each page the forge's `rel="next"` names, until
  none. All three tests passed on it (`BASE-FAILURE.txt`).
- `packages/hub/src/forge.ts` was restored to the base's after each, and `git status` shows only this folder.

## Files

- `helpers.ts`: the heads, the recorded forge, `stateOf` (the read through `Forge.pull`), and the messages' labels.
- `two-pages.test.ts`: AC1 and AC2, the head of 45 runs over two pages.
- `one-page.test.ts`: AC3, the head of 12 runs on one page.
- `twins.json` and `twins/<name>/packages/hub/src/forge.ts`: the wrong programs for AC2 and AC3.
- `tsconfig.json`: the suite's type-check, as other suites do.
- `BASE-FAILURE.txt`: the run on the base, and on each twin and the throwaway right reader.
