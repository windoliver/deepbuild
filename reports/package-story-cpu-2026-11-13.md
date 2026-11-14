# Package story and CPU hill-climb, 2026-11-13

Base: main at `9b77cd2cd`. Asked for: pull the latest change, audit package by package so the packages read as one
connected story, and hill-climb on CPU usage.

Every package was placed in one import graph, and the graph is clean: no package cycle, no undeclared import, and the
core imports no extension. Six workspaces have no caller in the hub or the CLI; their cards now say so, and none was
wired here. Three edits cut CPU, each measured against the base's build: an idle hub retires 39% fewer instructions,
a record replay 5.9% fewer, and on this Mac the hub's sandbox-report stream 63 to 78% fewer. Nothing is committed.
Main moved 150 commits while this ran and was not merged in.

## The story: how the packages connect

`packages/` holds 36 npm workspaces and three folders of plug-ins (10 plug-ins). `crates/` holds 43 crates. The edges
below are read from production source by #1687's own oracle (`tests/acceptance/1687/ac3-redraft/graph.mjs`), tests
left out. "(types)" marks an edge the build erases.

1. **Three packages import no workspace package.** `contracts` holds the shapes, `evidence` the files kept by hash
   and the scrub, `readings` the pure folds. Everything else stands on them.
2. **The record is the one log.** `record` stands on `contracts` and `evidence`, and 16 packages read or append
   through it.
3. **The kernel sits on the record.** `leases`, `asks`, `budget` and `verdicts` each keep one table's rules.
   `adapters` holds one adapter per agent, driven by its facts file.
4. **The trusted ring runs things.** `supervisor` starts every process. `gate` turns a stop into a claim, `runner`
   runs headless jobs, `conformance` holds the kits, and `extension-host` loads packages and checks their calls.
5. **The hub composes the extensions in one file.** `packages/hub/src/hub-runtime.ts` hands the core its providers:
   the check kinds (`checks-command`, `checks-numbers`, `checks-review`, `checks-work`), `env-local`,
   `resolver-decisions`, `archive`, `wiki`, `github` and `workspaces`. `reading` is called by the hub and the CLI.
6. **Two packages sit on top.** `hub` is the composition and the socket. `cli` is dispatch, and it alone imports the
   hub. `otlp` is reached only through the CLI's doctor item.
7. **Twelve pieces are outside the import graph by design.** `pi` and `paseo` are loaded by their agents and reach
   the hub over its socket. The 10 plug-ins under `channels/`, `jobs/` and `sources/` are installed with
   `deep install`; each manifest's digest equals its folder's.
8. **The Rust side joins at nine binaries.** Of 27 binaries, package source names nine: `deep-hook` (10 packages),
   `deep-app`, `deep-canvas-render`, `deep-drive`, `deep-gpu`, `deep-replica` and `deep-show` (the hub; the jobs
   plug-ins name `deep-show` too),
   `deep-canvas` (the CLI) and `deep-contracts` (`contracts`). No package's source names the other 18.
   `deep-typeset` reaches no binary: `scripts/typeset-wasm.mjs` builds it for the typeset plug-in.

### Each workspace, what it imports and who imports it

| Package | Imports | Imported by |
|---|---|---|
| contracts | none | adapters, asks, budget, buying, cli, conformance, extension-host, gate, hub, leases, reading, record, verdicts, workspaces; runner and supervisor (types) |
| evidence | none | archive, checks-command, checks-journey, cli, extension-host, hub, reading, record; routing-replay (types) |
| readings | none | hub |
| record | contracts, evidence | archive, asks, budget, buying, config-eval, extension-host, hub, leases, reading, routing-replay, runner, supervisor, verdicts, wiki; otlp and resolver-decisions (types) |
| leases | contracts, record | gate, hub; extension-host and supervisor (types) |
| asks | adapters, contracts, record | hub, routing-replay; archive, budget, buying, extension-host, resolver-decisions, runner, supervisor (types) |
| budget | contracts, record; asks (types) | hub, resolver-decisions; buying and runner (types) |
| verdicts | contracts, record | gate, hub; checks-journey, checks-numbers, checks-review (types) |
| adapters | contracts, the repo's `adapters/` folder | asks, checks-review, conformance, hub, otlp, runner; archive and extension-host (types) |
| supervisor | record; asks, contracts, leases (types) | checks-command, checks-journey, config-eval, env-local, extension-host, hub, runner; gate (types) |
| gate | contracts, leases, verdicts; conformance and supervisor (types) | checks-command, checks-journey, config-eval, github, hub |
| runner | adapters, record, supervisor; asks, budget, contracts (types) | hub; checks-review, extension-host, reading (types) |
| conformance | adapters, contracts | checks-host, checks-numbers, checks-review, checks-work, cli, extension-host, proof; checks-command, checks-journey, env-local, gate, hub, workspaces (types) |
| extension-host | conformance, contracts, evidence, record, supervisor; adapters, asks, leases, runner (types) | hub |
| checks-command | evidence, gate, supervisor; conformance (types) | checks-journey, hub |
| checks-numbers | conformance; verdicts (types) | hub |
| checks-review | adapters, conformance; runner and verdicts (types) | hub |
| checks-work | conformance | hub |
| env-local | supervisor; conformance (types) | checks-journey, hub |
| resolver-decisions | budget; asks and record (types) | hub |
| archive | evidence, record; adapters and asks (types) | hub |
| wiki | record | hub, reading |
| github | gate | hub |
| workspaces | contracts; conformance (types) | hub |
| reading | contracts, evidence, record, wiki; runner (types) | cli, hub |
| otlp | adapters; record (types) | cli |
| hub | 25 packages: every one above but otlp | cli |
| cli | conformance, contracts, evidence, hub, otlp, reading, the repo's `adapters/` folder | none: it is the entry |
| pi | none at run time | none: pi loads it |
| paseo | none | none: paseo loads it |
| buying | contracts, record; asks and budget (types) | **none** |
| proof | conformance | **none** |
| checks-journey | checks-command, env-local, evidence, gate, supervisor; conformance and verdicts (types) | **none** |
| checks-host | conformance | **none** |
| routing-replay | asks, record; evidence (types) | **none** |
| config-eval | gate, record, supervisor | **none** |

### What the graph says

| Measure | Base | Change |
|---|---|---|
| Workspace dependencies declared and unused | 0 | 0 |
| Workspace imports with no declared dependency | 0 in `src`; one build step, below | same |
| Package-level cycles, type-only edges included | 0 | 0 |
| Edges from the core to an extension (#1687 AC3's rule) | 0 | 0 |
| Runtime cycles between modules | 1: `hub/src/list.ts` and `rows.ts` | 0 |
| Type-only cycle edges between modules | 13 | 13 |
| Plug-in manifests whose digest is their folder's | 10 of 10 | 10 of 10 |

The one import outside a declared dependency is `packages/pi/tools.mjs`, which reads the hub's built tool list at
build time by path. Its card lists it as a deviation. The 13 type-only cycle edges are in `config-eval` (7), the hub
(4) and `record` (2), and are erased at build.

### The six gaps

Nothing in the hub or the CLI reaches these. Each has an acceptance suite of its own, so those suites cover code a
real hub never runs. None is wired here: wiring one is a feature, and the first three are #1982's to decide.

| Package | What calls it today | What owns the gap |
|---|---|---|
| checks-journey | its own tests, `tests/acceptance/37/`, `benchmarks/journeys.mjs` | #1982. The hub's kind table holds no `journey` kind, and the design's own `done.yaml` example names one (#2205) |
| proof | its own tests, `tests/acceptance/685` | #1982 and #1896. The kind table holds no `proof` kind |
| buying | its own tests, `tests/acceptance/69/` | #1982. The design puts buying with the money extensions |
| checks-host | `tests/acceptance/1943` | #1946 and #1947, as its card already said |
| routing-replay | its own tests and `tests/acceptance/1980`, which the preflight's unit lane runs | No issue found that wires it; #1167's demo names it |
| config-eval | `scripts/config-eval.mjs`, whose report the preflight's config eval lane reads | No issue found. Its card said the learned layer calls `runEval`; nothing in `record` or the hub does |

## What changed

| Asked | Change | Proof |
|---|---|---|
| Coherent story | 17 cards, the jobs card among them: each "What it is for" now names the callers the graph shows, and says "nothing in the hub calls it yet" where that is so. `jobs` gains its `score` plug-in, which the card left out | Each sentence checked against the table above. `scripts/repo-rules.mjs` cards, `scripts/design-links.mjs` and `scripts/public-text.mjs` pass |
| Coherent story | `hub/src/sections.ts` holds `SECTION`, which `list.ts` and `rows.ts` both import. The hub's only runtime module cycle is gone | The oracle reads 2 runtime cycle edges on the base and 0 now. The built `list.js` and `rows.js` differ from the base's only in that import and the moved constant. The hub's worker loads 117 files where it loaded 118: `list.ts` and `visible.ts` no longer |
| CPU | `hub/src/agents.ts`: `hookedAgents` reads the agents' facts once. The hub asked every second, and each call parsed five facts files, 96 KB | Same value from the base's build and the change's, on the first call and the second. Measured below |
| CPU | `record/src/projections.ts`: `up` finds its statement by the table and the columns, not by a key string built for every row | Same rows, below. Measured below |
| CPU | `supervisor/src/supervisor.ts`: when the sandbox-report stream's first filter shows no report, the stream starts again on the kernel's messages, and on the sender alone only if that shows none either | A test that failed first, below. Measured below |
| CPU | `supervisor/native/helper.c` gains `leash`, and the stream runs on it: a watcher forked beside the stream ends it once the process that started it is gone. A hub that was killed, or whose start failed, left its `log stream` running until the machine's next matching report | A test that failed first: `sandbox-report streams still running 5 s after their process was killed: expected [ 4389 ] to deeply equal []`. It passes after, with the file's other four cases and `tests/acceptance/30/sandbox.test.ts`'s two |

`+97 −31` lines of source in 8 files, one of them new; `+60 −4` in one test file; and 17 one-line card edits,
with one line more in the supervisor's card for the helper's `leash`.

## CPU: measured

Wall time is not used: the load average was between 90 and 440 on 18 cores. These are instructions retired and CPU
time, read from the live process with `proc_pid_rusage` or from `/usr/bin/time -l`. Each row alternates the base's
build and the change's in one worktree. The base's build of a file is made by transpiling the base's source; the
method is checked first by reproducing the worktree's own built file byte for byte.

| What | Base | Change | How |
|---|---|---|---|
| Idle hub, its own process, M instructions a second | 11.1, 11.2, 11.0, 15.4, 11.5, 11.2, 11.7 | 10.4, 6.3, 6.6, 6.6, 7.1, 6.9, 6.9 | 15 or 25 s to settle, then 30 s; 7 rounds a side. Medians 11.2 and 6.9, −39%. The first change round read 10.4; why was not found |
| The same, ms of CPU a second | 3.4, 3.5, 3.8 | 2.9, 2.8, 2.8 | The last 3 rounds, with every edit in |
| The hub's `log stream` child on this Mac, M instructions a second | 166.6, 188.5, 223.3 | 61.6, 65.2, 48.3 | The same 3 rounds, −63 to −78% |
| The two filters side by side over the same seconds | 46.1, 97.6, 175.3, 263.5 M/s; 19.0, 25.6, 37.7, 48.0 ms CPU/s | 9.6, 21.1, 51.0, 38.5 M/s; 4.7, 5.3, 12.9, 8.5 ms CPU/s | 4 windows of 20 to 40 s. Both showed the same reports each time: 59 of 59, 12 of 12, 37 of 37, 19 of 19 |
| `record-replay-100k`, G instructions | 56.022, 56.603, 56.627 | 53.335, 53.259, 53.278 | −5.9% by medians |
| `record-append-20k`, G instructions | 10.038, 9.898, 9.903 | 9.678, 9.660, 9.658 | −2.5% by medians |

### The record writes the same rows

One fixed stream went into a fresh record under each build and was then rebuilt by replay: every published event
kind's every fixture three times (1,077 appends), then 3,000 tool events. It reaches 76 of `up`'s statements over
30 tables.

- Base and change, twice each: the same digest of what each append returned, of the log, and of all 44 projection
  tables (35 hold rows, 3,664 rows), before the rebuild and after it.
- A wrong program, which takes a statement for any row with as many columns: a different log and different tables.
- The log's digest leaves out the ids the record makes for itself, which are random, and the hashes over them.
  Before the restart two runs of one build differed in exactly those ids, 102 of 4,179 events, and in nothing else.

### The sandbox-report stream

After a restart at 13:51 this Mac's sandbox reports carry no subsystem: process `/kernel`, sender `Sandbox`, an empty
subsystem. In two runs, 28 denials made for the check (refused writes and refused connections) showed through the
subsystem filter 0 times and through each of the other two 9 times; why the log showed 9 of the 28 was not looked
into. So every hub here fell back to the sender alone, where `log` tests every message the machine writes: 1.9 to
4.8% of a core for the hub's life. Before the restart hubs on this Mac stayed on the subsystem filter, their stream
at 0.2 to 1.3 M instructions a second, as the Nov 10 audit measured. Same macOS, 27.2, both sides of the restart.
Why the reports changed was not found.

- **Failed first.** The fallback's test gained one assertion: the stream left running is the narrowest that shows a
  report. The final test file on the base's `supervisor.ts`, 1 failed and 3 passed:
  ```
  AssertionError: the one stream left is the narrowest that shows a report
  /usr/bin/log stream --style ndjson --predicate sender == "Sandbox" AND eventMessage CONTAINS "dev.deepbuild.run:": expected [ false ] to deeply equal [ true ]
  ```
- **Passes after**, unchanged: 4 of 4 in `packages/supervisor/src/supervisor.test.ts`, three runs, the last on the
  final files.
- **A second case** plants a Mac where the kernel's messages show no report either. A supervisor whose chain stops
  at its second filter fails it: `a sandbox.denied for run:DENIED ...: expected +0 to be 1`.
- **What it costs.** A Mac where neither narrow filter shows a report waits out two 10 s warm-ups before its first
  sandboxed run, where it waited one.
- **Not verified:** that reports come from the kernel on macOS 14 or 15. None was at hand. Where they don't, the
  stream ends on the sender alone, as on main, and the first case of the test fails there.

## CPU: found and not changed

| Where | Finding |
|---|---|
| hub, idle | After the edit `agentsReached` is still 18% of the hub's timer time: each second it looks for five agent binaries along `PATH`. `HeavyQueue.tick` refills the job pool's pipe every 500 ms with no leased command (12%). The extension host reads `notices.json` every 250 ms (8%). `gatesWatched` reads a file each second (4%) |
| hub, timers | Tried on the built file: one interval per period for the core's 17 jobs. Wakeups read 34.9, 26.1, 26.7 a second before and 23.3, 29.0, 21.8 after; instructions did not move. Inside the noise, so not applied |
| contracts | `json.copy` builds a closure per value. Hoisting it read 9.559 against 9.639 G, medians of 5, inside the spread of single runs. Not applied |
| hub, per hook | 3.6 and 4.0 M instructions a hook over 600 and 3,000 hooks. No edit touches this path |
| record, resolver | `resolver-match-10k` is 29.8 G instructions, 91.5% inside SQLite's write transaction. `record-learn-rebuild-10k` is 30.9 G and `archive-live` 27.4 G |

Every row was read before the restart. The profiles and logs were in the machine's temporary
folder, which the restart emptied, so those rows stand on this session's transcript alone.

## Verification

On the final tree unless a row says otherwise.

| Check | Result |
|---|---|
| `packages/supervisor/src/supervisor.test.ts` | 4 of 4 pass |
| `tests/package-deps.test.mjs`, `tests/acceptance/1687/full/structure.test.mjs` | 10 of 10 pass |
| 23 files chosen for the edits: `packages/record/test`, five files of `tests/acceptance/14`, five hub tests on rows and states, six of `tests/acceptance/1463`, `tests/acceptance/2019/agents.test.ts`, `tests/acceptance/30/sandbox.test.ts` | 168 of 179 pass. The 11 are set out below. Run before the last edits, which change comments only |
| `scripts/repo-rules.mjs` | PASS on all six rules |
| `scripts/design-links.mjs`, `scripts/public-text.mjs`, `scripts/plant-lint.mjs`, `scripts/blocking-call-guard.mjs`, `scripts/known-failures-check.mjs` | pass |
| `scripts/size-ratchet.mjs`, `scripts/record-reader-guard.mjs` | 46 and 1 FAIL lines, the same on the base before the restart. None names a file this change touches |
| `tsc --noEmit` on the root config, before those comment edits | 2 errors, in `packages/extension-host/test/liveness.test.ts` and `packages/hub/test/job-session-close.test.ts`. Neither file is touched. Not run on the base |

### The 11 failures

That run put three files side by side, though `tests/acceptance/1463/` and `tests/acceptance/30/` are in the lanes'
alone list. Each failing file was run again alone.

| Cases | First run | Alone |
|---|---|---|
| 8 in `1463/list`, `deep` and `words` | `BLOCKED: deep-drive didn't say {"ready": true}`; it had exited. Why was not found | 7 pass. The eighth, `1463/list`'s first case, gets past it and fails as the next row says |
| `1463/list` first case, `1463/words` "992/agree still holds" | The first BLOCKED as above; the second failed | Fail on the change, and the same way on the base's build of every file this change touches. #2333 lists both as failing on main; neither is in `scripts/known-failures.json` |
| `30/sandbox` AC5 | No `sandbox.denied` within 15 s | Not seen again: 12 of 12 on the change and 11 of 11 on the base, six a side run three at once at a load of 265 to 305. Its cause was not found. The file's `afterAll` hook timed out after its cases had passed in 8 of the base's 11 runs and 7 of the change's 12 |
| `packages/hub/test/reach.test.ts`, one case | `ENOTEMPTY` deleting its temp home | 9 of 9 pass |

### Not run

- `node scripts/affected.mjs`. Its selection for this change is 548 parallel and 802 alone vitest files, 126 node
  files, `cargo test` of `deep-app` and `deep-logic`, 112 timed, 50 slow and 76 by hand. No WIDE line. The whole
  selection is INCONCLUSIVE.
- The preflight, the perf lane, clippy, `cargo test`, any Linux run.

## Deviations and loose ends

- **The machine restarted mid-run**, at 13:51. Every measurement taken before it was taken again after it, on the
  final tree. What was not repeated is marked above.
- **Main was not merged.** It is 150 commits ahead of the base. Of the touched files it changed only
  `packages/jobs/README.md`, on the sentence this change edits: both additions should stay. Four crates and one job
  plug-in that arrived on main were not read.
- **Two other audits started the same day edit some of the same files**, uncommitted in worktrees of their own:
  one `packages/hub/src/rows.ts` and `packages/jobs/README.md`, the other the cards of `budget`, `config-eval` and
  `jobs`. Their files were read, not changed.
- **An existing test was changed**: the supervisor's fallback case keeps its assertions and gains one. A second
  case with its plant (`reports-other-process`) and the leash's case were added.
- **Part of #1982**, not a close: its fifth criterion asks that the cards of `gate`, `buying`, `proof` and
  `checks-journey` say what calls each. They now do. Its other four criteria are untouched.
- **Streams left behind while this ran.** Before the leash, eleven `log stream` processes were left by hub starts
  that failed in this worktree for want of a built `deep-hook`. Each was stopped by its PID. 18 more on the machine
  belonged to other sessions and were left alone.
- **Follow-ups, none filed:** the six gaps above; the idle hub's remaining timers; why this Mac's sandbox reports
  lost their subsystem.
