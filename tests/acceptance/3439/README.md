# Acceptance tests for #3439: the collector's flag is given at launch, and a hub that can't collect still starts

Written blind, from the issue, `docs/technical-design.md` and base commit `4d8baa1189968d95871417134c711e08918532c3`
(origin/main, November 25, 2026), before any work existed. Never edit these; a dispute goes to this job's blind
redraft (design: Dogfooding).

What this job read: issue #3439 (its body, Scope, five criteria, Proof) as of November 25, 2026; in the design, "One
hub per user, a tiny hook client, and extensions in-process", "Numbers version 0 has to hold", Dogfooding and the hook
protocol; `docs/parallel-proof.md` (lanes, `lane.json`, section 12a, Budget windows); `AGENTS.md`; the suites
`tests/acceptance/3430`, `2750`, `2698`, `3347` and `1865` for the format, and `tests/acceptance/27/helpers.ts`, which
this suite reuses; at base, `packages/hub/src/settle.ts`, `server.ts`, `core-worker.ts`, `parser.ts`,
`parser-pool.ts`, `mcp.ts`, `service.ts`, `setup.ts`, `scripts/repo-rules.mjs`, `scripts/proof-change.mjs` (how a tag
is derived), `scripts/perf.mjs`, `scripts/benchmark.mjs` and `benchmarks/budgets.json`.

## Run

```sh
npm ci && npm run build --workspaces        # the hub and CLI the tests run are the built ones
cargo build --locked -q -p deep-hook        # the hub's hook entries run it; ../27's helpers build it if it is missing
node node_modules/vitest/vitest.mjs run --root tests/acceptance/3439 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/3439/tsconfig.json
```

Node 24. With `--root` here Vitest may write `tests/acceptance/3439/node_modules/.vite`; delete it before committing.
The whole suite took 75 s on the base at a load of 10 to 17, 60 s of it the wait for a reading the base
never records. Every test makes its own home under `/tmp/dh27-*` (#27's helpers) with `HOME` there; the real
`~/.deepbuild`, `~/.claude.json` and the real launchd are never touched, and every process is stopped by PID.
`lane.json` runs the folder alone, as #27's files run.

## Criteria to tests

IDs are the first 8 hex of SHA-256 of each criterion's text, trimmed, whitespace collapsed (`scripts/proof-change.mjs`).

| Tag | Test | What it requires | On the base |
|---|---|---|---|
| `#3439.fead997e` | `rule.test.ts`: `no file under packages/ calls setFlagsFromString …` | This suite's own scan of every file git lists under `packages/` finds no line that calls it (comment lines aside); and `node scripts/repo-rules.mjs` in this checkout prints no FAIL, INVALID or BLOCKED line that names it | FAILS: `packages/hub/src/settle.ts:7` |
| `#3439.fead997e` | `rule.test.ts`: `a planted call … fails the repo rule, naming the file and the line` | In a scratch repository with a copy of this checkout's `scripts/`: a named-import call at `packages/hub/src/planted-settle.ts:41` and a member call (`v8.setFlagsFromString`) at `packages/cli/src/planted-member.mjs:17` each get a FAIL whose line holds the file's path and its line number; a third file under `packages/` with no call is named by no failure | FAILS: the base has no such rule |
| `#3439.0f3a1117` | `start.test.ts` | `node <built CLI> hub run`, no Node option before the script and none in its environment: it prints its ready line (it does so only after the core worker posts `started`); one PreToolUse hook through deep-hook, as `deep setup`'s entry runs it, is answered inside deep-hook's window; within 60 s the record holds a reading that says "shed"; and after three more hooks it holds exactly one | FAILS at the reading: the hub starts and answers, and records none |
| `#3439.9382967d` (first clause only) | `service.test.ts` | `deep hub start` hands the login service's definition to the stand-in, which starts the hub from it; `deep hub start` exits 0; `typeof gc` is `"function"` in the main thread, in the core worker, in a parser and in every other worker | FAILS: `"undefined"` in all three threads |
| `#3439.420f3cfc` | `mcp.test.ts` | The server `deep setup` wrote to `~/.claude.json` (`mcpServers.deepbuild`), run three times against one hub: as written; given a collector; with none at launch. Each answers `initialize` with its server info, then `deep_status` through `tools/call` with `isError: false`, twice. The second and third runs' collectors are read and must be `"function"` and `"undefined"` | PASSES (see below) |
| `#3439.40137b0c` | none | The budget window's: see Not covered here | not run |

`BASE-FAILURE.txt` holds the run. The `deep mcp` test passes on the base because the base's V8 call works on this
Node: `deep mcp` gets its collector either way and serves. The criterion's wrong program is of the fixed code, so it
can't exist yet; planted by hand on the base it fails the test at `initialize` (the second half of `BASE-FAILURE.txt`).

## Surfaces chosen

- **The rule.** `node scripts/repo-rules.mjs`, the lint lane's command, as a process. The script reads the checkout it
  sits in, so the planted run is a scratch git repository with a copy of `scripts/` left out of git's listing (#3347's
  way). Other checks fail there for want of the repo's files; only failures that name a planted file are read. How the
  FAIL is worded is the implementer's: the test asks that one line of a FAIL (the line itself or an indented line
  under it) hold the path and the line number as a whole number.
- **A hub launched without the flag.** `node packages/cli/dist/main.js hub run`, with `NODE_OPTIONS` removed from its
  environment. `started` is read from the hub's ready line on stdout, which `runHub` writes after `hub.open` resolves,
  and that waits for the core worker's `started`.
- **The hook budget.** The design gives the hub 20 ms to acknowledge and deep-hook 50 ms from its start before it acts
  as with the hub down and spools the request. The issue says the start runs on any machine, so the test reads that
  window, not a timing of its own: a hook counts as answered when deep-hook exits 0, nothing of the call is in
  `~/.deepbuild/spool`, and the call's `tool.before` is in the record. Up to 20 hooks are sent and one must be
  answered, since a loaded machine misses the window with any hub. The p50 against the merge base is
  `hub-round-trip`'s (below).
- **The reading.** `events.read` on a cli connection: an event whose kind holds `reading` and whose data holds `shed`
  (the issue: "says its start-up garbage was not shed"). The kind's name and the words are the implementer's.
- **The login service.** `$DEEP_HUB_LAUNCHER`, the seam `service.ts` has for a test's service manager.
  `fixtures/launcher.mjs` reads the definition (launchd's property list or systemd's unit) and starts its program
  arguments with its environment and nothing else, once, with its output in the definition's log. It adds one thing
  launchd would not: `--inspect-port=0` after the definition's own `NODE_OPTIONS`, which opens nothing by itself.
- **Reading a collector.** No surface the issue names says which threads have a collector, so the test reads it from
  outside: SIGUSR1 opens Node's inspector on the port the option above made its own, and `typeof gc` is evaluated in
  the main thread and, through the `NodeWorker` domain, in each worker, named by its script's URL. A collector given at
  launch is the global `gc` of every thread (`node --expose-gc …` reads `"function"` in all three, tried on the base).
  One reached later by `setFlagsFromString` is not: the base reads `"undefined"` in all three. The core worker and the
  parser are found by `core` and `pars` in the script's name, as the base names them (`core-worker.js`, `parser.js`).
- **`deep mcp`.** The command, arguments and `env` of `mcpServers.deepbuild`, spawned as Claude Code spawns a stdio
  server, with newline-delimited JSON-RPC. "Given a collector" adds `--expose-gc` to `NODE_OPTIONS`; "with none" drops
  any `--expose-gc` or `--expose_gc` from the arguments and from the entry's own `NODE_OPTIONS`. The as-written run
  gets no option of this suite's.

## Not covered here, and why

1. **`#3439.40137b0c`, `hub-cold-start` and `hub-round-trip` within their margins of the merge base.** No test. Both
   are tasks of `benchmarks/budgets.json` already; the perf lane and the budget window run them against the merge base
   over 20 alternated rounds on a reference Mac (parallel-proof 12a), and anywhere else the reading is INCONCLUSIVE. A
   test here could only repeat that machinery or fake it. For the window to record this criterion as measured, the two
   tasks must name it in their `criteria` (`"#3439.40137b0c"`); naming a criterion changes no frozen number. Until
   then the window lists it as unmeasured and the issue stays open. That edit is the implementer's, outside this folder.
2. **The rest of `#3439.9382967d`:** "`hub-idle` holds the design's 150 MB and reads within its margin of the merge
   base over 20 alternated pairs. A planted `shedStartup` that returns at once is read beside it: if `hub-idle` can't
   tell the two apart, the criterion reads INCONCLUSIVE, never PASS." No test, for the same reason, and because the
   planted `shedStartup` is a twin of code that doesn't exist yet. **The tagged test here proves the first clause
   only.** The trace lane reads a tag per criterion, so a pass of `service.test.ts` would read as the whole criterion:
   the PR must say `Part of #3439`, list this clause as open, and attach the `hub-idle` readings (the merge base, the
   change, and the change with `shedStartup` returning at once, each 20 alternated pairs in a budget window). If
   `hub-idle` can't tell the last two apart, the criterion is INCONCLUSIVE whatever this file says.
3. **"The PR shows each worker thread has it"** (Scope). `service.test.ts` reads every worker the hub holds once it
   answers: on the base, the core worker and one parser. The second parser (large lines) and the children worker start
   later and are not provoked here.
4. **Linux's unit.** The stand-in reads systemd's `ExecStart` and `Environment` too, but this job ran on macOS only.
5. **`deep hub start --root`, the dev hub "started by hand"** (Scope). No criterion names it; not tested.
6. **`deep mcp`'s own reading.** The issue's "says so once, as a reading" has no criterion for the `deep mcp` process;
   the test asks only that it serves.

## Twins needed

No twin folder is here: every wrong program below but the merge base is the fixed code with one rule broken, and the
fixed code doesn't exist yet. A twin replaces product files only, at `twins/<name>/<path of the file it replaces>`,
and `twins.json` names them per tag. Every tagged test fails by an `expect` of its own, never by a helper's throw.

| Tag, test | Twin | The one rule it breaks | Where the test fails |
|---|---|---|---|
| `#3439.fead997e`, the scan | the merge base | `settle.ts` calls `setFlagsFromString` | "no file under packages/ calls setFlagsFromString; these lines do: …" |
| `#3439.fead997e`, the planted call | the merge base; or `rule-skips-member-calls` | the repo rule is missing; or it sees only a bare `setFlagsFromString(` and not `v8.setFlagsFromString(` | "the planted call at … fails the repo rule, in a FAIL that names the file and the line" |
| `#3439.0f3a1117` | `v8-call-does-nothing`: the criterion's own, "the merge base with the V8 call planted to do nothing" | `shedStartup` as the base has it, with `setFlagsFromString` doing nothing | its first assertion, "reaches started: it printed no ready line", quoting the hub's output, which names the core worker |
| `#3439.0f3a1117` | `no-reading` (also the merge base) and `reading-per-thread` | a thread with no collector skips the collection and says nothing; or every thread says so | "records a reading that says its start-up garbage was not shed"; "one reading a process" |
| `#3439.9382967d` | the merge base; or `service-without-flag` | the login service's program arguments don't give the flag | "the main thread of a hub started as the login service starts it has a collector" |
| `#3439.9382967d`, the budget clause | `shed-returns-at-once`: the criterion's own | `shedStartup` returns at once | not a test's: read by `hub-idle` beside the change (Not covered here, 2) |
| `#3439.420f3cfc` | `mcp-throws-without-collector`: the criterion's own | `deep mcp`'s entry runs the collection without looking for a collector | "deep mcp with no collector given when it launched … serves the call initialize: deep mcp exited 1 with no reply" (or the tool call, if the throw is there), naming the call |

Two of these were run on the base by hand, changing no file: `fixtures/v8-call-does-nothing.mjs`, loaded into the
hub's and `deep mcp`'s main thread and workers by `NODE_OPTIONS`, makes `v8.setFlagsFromString` do nothing.

```sh
T3439_NODE_OPTIONS="--import=$PWD/tests/acceptance/3439/fixtures/v8-call-does-nothing.mjs" \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/3439 --no-file-parallelism start mcp
```

`start.test.ts` fails at its first assertion with "deep hub: a parser failed … parser.js" and "deep hub: the core
stopped … core-worker.js"; `mcp.test.ts` fails at `initialize` with `shedStartup`'s `ReferenceError: gc is not
defined`. `T3439_NODE_OPTIONS` is that hand run's only way in and is unset in every lane; it is no substitute for the
twins, which the lanes lay.

## Open questions

1. **Whether `deep hub run` may give itself the flag.** The test takes "launched without the flag" as `node <CLI> hub
   run` and expects that hub to have no collector and to say so. A fix in which `hub run` starts itself again with the
   flag would have a collector there and record no reading; the test would fail at the reading. The Scope's words
   ("in the login service's program arguments and in a hub started by hand") read as the flag coming from whoever
   launches, so the test holds that.
2. **Which event is "a reading".** The record has `session.reading` and a `reading` record kind; nothing at base is a
   hub's own reading about a thread. The test accepts any event whose kind holds `reading` and whose data holds `shed`.
3. **"One reading a process" and when.** The test counts after four answered hooks, which pass through the main
   thread, a parser and the core. A thread started much later (the large-line parser) that then said so again would
   not be seen here.
4. **"Inside the hook budget."** Read as deep-hook's own window, on one hook of up to 20 (Surfaces). A stricter
   reading, a p95 over many hooks, is a timing that holds only on a reference Mac.
5. **What "has a collector" means for a thread.** Read as the global `gc` the launch flag gives. A collector reached
   some other way that leaves `typeof gc` as `"undefined"` in a thread's own scope would fail `service.test.ts`; the
   issue's Scope says the collector is reached by the flag, so the test holds that.
