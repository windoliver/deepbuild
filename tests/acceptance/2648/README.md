# Acceptance tests for #2648: an idle hub's timers do no work when nothing changed

Written first and blind, at base commit `1a4b7d065` (origin/main, "Merge pull request #2886"), by a job that never saw
an implementation of #2648, another branch or another `tests/acceptance/2648*` folder. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- Issue #2648, live (updated 2026-11-20T01:45:39Z): its table of four timers, Scope, five criteria, Proof and Depends on.
- The two reports it cites, at the base: `reports/package-story-cpu-2026-11-13.md` and `reports/cpu-hillclimb-2026-11-10.md`.
- `docs/technical-design.md`: One hub per user, a tiny hook client, and extensions in-process; Numbers version 0 has to
  hold; Dogfooding; Tests written first, by a job that never sees the code; Wrong programs; Criteria to tests, both
  ways. `AGENTS.md`.
- At the base, to learn the surfaces: `packages/hub/src/{core,session-flags,watch,heavy,agents,doctor,claude-settings,
  mods,server,authority,plant}.ts`, `packages/extension-host/src/{host,host-shared,sources,sends,source-types}.ts`,
  `benchmarks/{hub,process-reader}.mjs`, `benchmarks/budgets.json`, `scripts/{benchmark,budget-window,release-budgets,
  proof-change,lanes}.mjs`, and the suites `16`, `2019`, `262`, `1016`, `1906`, `2402`, `2650`, `2665` and `2698` for
  their conventions. #16's socket helpers (`Conn`, `openAs`) are imported unchanged.

## How to run

On macOS, with Node 24.22 first on `PATH`, from the repo root:

```sh
npm ci && npm run build --workspaces
PATH=$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build -p deep-hook --locked
npx vitest run --root tests/acceptance/2648 --no-file-parallelism --testTimeout=600000 --silent=false --reporter=verbose
npx vitest run --root tests/acceptance/2648 --no-file-parallelism files.test.ts      # one criterion
npx tsc --noEmit -p tests/acceptance/2648
```

- **Builds.** Every file starts `deep hub run` from `packages/cli/dist`, and a hub stops at its start without
  `target/debug/deep-hook`: each hub start checks for it and is BLOCKED without it (this Mac's hourly cleanup can empty
  `target/`). `instructions.test.ts` also builds the merge base in a scratch folder: `git archive`, `npm ci`,
  `npm run build --workspaces`, this checkout's deep-hook copied in.
- **Times** in the recorded base run, at a load of 150 to 225 on 18 cores (readings, not budgets): the suite 34
  minutes; `files.test.ts` 161 s, `instructions.test.ts` 26.5 minutes (the two trees, then 14 hubs of about 60 s
  each; 12.3 minutes in an earlier run at a load near 140), `seen.test.ts` 142 s, `pipe.test.ts` 71 s,
  `budget.test.ts` 36 s.
- **Lanes** (`scripts/lanes.mjs`; this job doesn't edit it): the folder goes on `alone`, since every file starts real
  hubs and reads one's file calls or instructions, and `instructions.test.ts` builds a second checkout. `seen.test.ts`
  goes on `timed`: it judges wall-clock bounds (1 s, 2 s). `instructions.test.ts` and `seen.test.ts` run over two
  minutes, so `slow` too.
- **Safety.** Homes are under `/tmp/dh2648-*` with their own `HOME`, a Claude Code stand-in on their `PATH`, a login
  shell that keeps that `PATH`, a `launchctl` that loads nothing, the OS confirmation stubbed (`DEEP_HUB_TEST_CONFIRM`)
  and Claude Code's managed settings pointed into the folder (`DEEP_HUB_TEST_MANAGED_SETTINGS`); nothing reads or
  writes the real `~/.deepbuild`, `~/.claude` or the machine's managed settings. No network, no model: the test
  package's source goes to a local listener. Every process a test starts is stopped by its PID; every folder is removed
  with its file. With `--root`, Vitest writes `tests/acceptance/2648/node_modules/.vite/`: delete it before committing.

## The surfaces under test

All are named by the issue or the design, or merged at the base:

- **The hub**: `deep hub run` on a temp home, set up by `deep setup` (Claude Code's hook entries in its settings, the
  login `PATH` recorded in the hub's `config.json`); its socket with the control token; the record through
  `events.read` with `kinds`: `holds.watch`, `agent.reach`, `source.called`.
- **`deep` commands**: `deep setup`, `deep off`, `deep lease -- <command>`.
- **The files the issue names**: `gates.json`, `extensions/notices.json`, the agents' settings, the job pool's named
  pipe (`<hub folder>/jobserver`, #1016).
- **The app API**: `views.shown` (#262), as the app reports a shown view.
- **Planted programs**: `DEEP_HUB_PLANT` (`packages/hub/src/plant.ts`; the base refuses a name it doesn't list).
- **The benchmarks**: `benchmarks/process-reader.mjs` (#2698) to read a hub's instructions, `benchmarks/budgets.json`'s
  `hub-idle` and its command, and `scripts/benchmark.mjs`'s `validateBudgets` and `judgeCount` (#2665).
- **Test settings merged at the base**: `DEEP_HUB_TEST_CONFIRM`, `DEEP_HUB_TEST_MANAGED_SETTINGS`,
  `DEEP_HUB_TEST_RELEASE` (#2402: a package in DeepBuild's release, loaded in the hub), `DEEP_HUB_TEST_CORES` and
  `DEEP_TEST_MEMORY_PRESSURE_FILE` (#1016, #1411).

### Choices: names the implementation has to provide

1. **The planted hub `reads-files-at-start-only`** (AC3), listed in `packages/hub/src/plant.ts` and chosen with
   `DEEP_HUB_PLANT`: the hub reads `gates.json`, `extensions/notices.json` and each agent's settings (with all the
   agents' reach reads) once, at its start, and never again: no beat, watch or call reads them later, and it acts only
   on what it read then. Everything else as shipped.
2. **`wakeupsPerSecond` and `instructionsPerSecond`** (AC5): two top-level numbers in `hub-idle`'s report (the last
   stdout line of `node benchmarks/hub.mjs idle` that is a JSON object), beside `idleCpuPercent`. Each is the hub's own
   reading a second over the reader's span: the line's `hub.wakeups` divided by `spanMs` in seconds, and its
   `hub.instructionsPerSecond`, within 2%.
3. **`report.wakeupsPerSecond` and `report.instructionsPerSecond`** (AC5): count ceilings in `hub-idle`'s `limits` in
   `benchmarks/budgets.json` (#2665's `report.<name>`), each a positive number of the implementer's choosing, valid
   against the merge base's manifest. The budget window keeps a task's numbers only as a limit's readings, so these
   are what make its record keep both.

The test's own instrument, not the implementation's: `fixtures/fs-calls.mjs`, loaded into each of the hub's threads
with `NODE_OPTIONS=--import=…`, writing to `$DH2648_FS_LOG`.

## Criteria to tests

Each test's name starts with its criterion's ID, `#2648.<first 8 hex of the SHA-256 of the checkbox text>`, trimmed
and white space collapsed, as `scripts/proof-change.mjs` computes it.

| Criterion | ID | Test | Passes when |
|---|---|---|---|
| AC1 | `#2648.db254030` | `files.test.ts` | A hub on a home with 30 days of history and no session, after 15 s to settle: over the next 60 s the counter sees no open of any file the four timers read, and at most 120 calls on them (2 a second). Before judging, the counter must have loaded in the hub's main and core threads and seen the hub open one of these files at its start (else BLOCKED). |
| AC2 | `#2648.d3c34df7` | `instructions.test.ts` | Over 7 rounds, sides alternating which runs first, each hub (this checkout's, the merge base's) on a fresh copy of AC1's home: its own instructions over 30 s after 15 s to settle, a second. The change's median is at most 65% of the merge base's. A missing count is INCONCLUSIVE. |
| AC3 | `#2648.c3b6fe41` | `seen.test.ts`, two tests | On one idle hub, 15 s apart: `deep off` gives a `holds.watch` (cause `off`, on) within 1,000 ms of gates.json's write; DeepBuild's PreToolUse entry removed from Claude Code's settings gives an `agent.reach` for `claude-code` reading `unreachable` within 2,000 ms of the file's write; with the test package's view shown, a notice on its source saved in notices.json stops the source's next while-shown read (no `source.called` after the save, up to 5 s past when it was due). The second test runs the same three on the planted hub: each must fail, naming gates.json, settings.json and notices.json. |
| AC4 | `#2648.26092d61` | `pipe.test.ts`, two tests | A hub on 5 cores (a pool of 4) with memory pressure normal; `deep lease` of a build that takes 2 tokens and ends without giving them back. While it runs, no read of the pipe holds more than 2; once its `deep lease` exits, the first read holds 4; for the next 60 s the pipe's modification time never moves. The second test runs the same on `refills-while-running`, which must fail while the build runs, naming the sample. |
| AC5 | `#2648.ccff16b0` | `budget.test.ts` | `hub-idle`'s command, run once: its report holds `idleCpuPercent`, `wakeupsPerSecond` and `instructionsPerSecond`, the last two above 0 and within 2% of the hub's own readings in the same line; its `limits` hold `report.wakeupsPerSecond` and `report.instructionsPerSecond`, the base's `judgeCount` keeps this run's readings for each, and the manifest is valid against the merge base's. |

## Wrong programs

| Wrong program | Selected by | Criterion | How the test fails on it |
|---|---|---|---|
| The merge base | the checkout itself | AC1 | Its timers open the files on every beat: the failure names the file with the most opens, its count, rate and the calls that made them (`config.json`, opened 4.9 times a second, in the recorded run), then the next ones |
| The merge base | the checkout itself | AC2 | The two sides are one program: 88.2% in the recorded run and 104.1% in an earlier one, over 65% |
| The merge base | the checkout itself | AC4 | It refills the pipe every 500 ms with nothing leased: its modification time moves about 120 times in the 60 s |
| The merge base | the checkout itself | AC5 | Its report has no top-level `wakeupsPerSecond`, and `hub-idle` has no limits |
| `reads-files-at-start-only` | `DEEP_HUB_PLANT` (Choices 1) | AC3 | `deep off` not recorded, naming gates.json; the reach still `waiting`, naming settings.json; the source read at its next cadence, naming notices.json. At the base the hub refuses the name, so the test is BLOCKED there |
| `refills-while-running` (#1016) | `DEEP_HUB_PLANT`, merged at the base | AC4 | It tops the pipe up to 4 while the build holds 2: the failure names the sample read while the build ran. It fails so at the base, so that test passes there |

**At the base** (BASE-FAILURE.txt): 5 tests fail and 2 pass. AC1, AC2, AC4's main test and AC5 fail at their own
assertions for the missing behavior; AC3's main test passes, since the base reads its files on every beat; AC3's
planted test is BLOCKED where the base's hub refuses the plant's name; AC4's planted test passes, since
`refills-while-running` fails as it does today.

Before delivery, the judges were also run once against a throwaway twin of this checkout whose four timers read their
files once at start and whose heavy beat fills the pipe once at start and then only when a lease ends (built in
`/tmp`, never committed): AC1 read 0 opens and 0 calls and passed; AC3's three judges each failed naming its file;
AC4 passed and its planted test passed. At the base, AC3's main test passed.

## Readings where the issue and the design leave a choice

1. **"The files these four timers read"** are the paths the four timers' code reads on a beat at the merge base, as
   the counter saw them in an idle hub on this suite's home: `gates.json`; `extensions/notices.json`; the pool's pipe;
   and for the agents' reach, the hub's `config.json` (the login PATH, read once per agent looked for), each agent's
   program along the login PATH (`claude`, `codex`, `pi`, `opencode`, `cursor-agent`), Claude Code's `settings.json`,
   `settings.local.json` and managed settings, `claude-hooks.json`, `codex-hooks.json`, `codex-trust.json`, Codex's
   `config.toml` and `hooks.json`, deep-hook as setup recorded it, and `.git` in each folder above the home. A call on
   one counts whichever code makes it.
2. **"Opens"** are calls that open the file by name: reading or writing it whole, an open, a watch, a copy, a
   truncate. A try on a missing file counts: the base tries five files a home with only Claude Code doesn't have.
3. **Claude Code's `settings.json` counts its opens only.** A fifth timer, outside the issue's four (Claude Code's
   settings watch, every 500 ms beside its folder watch), checks its size and time twice a second at the base: that
   alone is the drafted two a second. The criterion names these four timers, so the call limit is read as theirs.
4. **"At most two file-system calls a second"** is the window's count over its length: 120 in 60 s. A `watchFile`
   counts one call per interval it polls inside the window, since libuv runs those stats where no wrapper sees them.
5. **"Counted by the test"**: by `fixtures/fs-calls.mjs`, which wraps `node:fs` and `node:fs/promises` in each of the
   hub's threads. It can't see a native addon's calls or another process's; at the base none of these files is read
   either way.
6. **"Naming the file read most"**: the file with the most opens in the window, with its rate and calls, and the next
   five. At the base it is `config.json`, read five times a second, not `notices.json`, four.
7. **"30 days of history and no session"**: #16's budget history (20 sessions a day of ten turns, 3,000 events a day),
   the newest over a day old, so no session is live; no hook arrives during a run.
8. **AC2's "instructions a second"** are the hub's own process's, not its children's: the `log stream` child's count
   follows the machine's log rate, as the Nov 13 report reads it. Read by `benchmarks/process-reader.mjs` over 30 s
   after 15 s to settle. **"At most 65% … over 7 alternated rounds"**: the change's median over its seven rounds
   against the merge base's median, as the Nov 13 report compares its medians.
9. **AC2's two sides** each run from a scratch folder of one shape, so neither runs where the other doesn't. The merge
   base is `git merge-base HEAD origin/main`, exported with `git archive` (no `.git`), with `npm ci` and
   `npm run build --workspaces` there. The change is this checkout's files as they are, built packages included,
   cloned without `.git` and `target/`. Each gets this checkout's deep-hook. In this job's first run, with the change
   side run from the checkout itself, the base's two identical programs read 104% (11.33 M against 10.89 M a second,
   the checkout higher in 6 of 7 rounds, at a load near 140); why was not looked into. In the recorded run, both
   sides from such folders, they read 88.2% (12.46 M against 14.13 M), single rounds from 11.0 M to 21.1 M at a load
   of 150 to 225: at that load seven rounds can move the ratio by a tenth either way. Both sides run on copies of one
   home, set up by this checkout's `deep setup`.
10. **"`deep off` written to gates.json is recorded within 1 s"**: `deep off` as a person runs it; the hub writes
    gates.json; the record's `holds.watch` (cause `off`, `on: true`, no session) has a `ts` within 1,000 ms of
    gates.json's modification time. Not seen within 10 s reads as not recorded.
11. **"A notice saved by a package"**: the hub serves no method that saves a notice at the base (the host's
    `subscribeNotice` has no socket route), so the test saves one as the host's `HostFiles.save` does: notices.json
    rewritten through a temp file renamed into place, adding a notice on the source at the source's own cadence
    (`every` 10,000 ms), which the host takes as standing in for the while-shown cadence. **"Changes the next
    while-shown cadence"**: the source's next read, due 10 s after its second, doesn't come by 5 s past then.
12. **The package** `test/glance`: a polled source `ext.glance.errors`, read only while the view `ext.glance.board`
    that binds it is shown, every 10 s, written for its run and installed and checked under the hub's folder before
    the hub starts, through the extension host's public entry, then handed to the hub as DeepBuild's release
    (`DEEP_HUB_TEST_RELEASE`), as #2402's suite does. Its host is a local listener that closes each connection, so
    each read is one `source.called`. The app reports the view shown at once and every 5 s.
13. **"An agent's hook entry removed from its settings"**: DeepBuild's PreToolUse entry taken out of Claude Code's
    `settings.json`, rewritten in place as an editor writes it. **"Unreachable within 2 s"**: an `agent.reach` for
    `claude-code` with state `unreachable` within 2,000 ms of the file's modification time. Before it, Claude Code's
    newest reach must not read unreachable (else BLOCKED).
14. **"Within the beat they show in now"** (Scope) is the criterion's numbers: 1 s, 2 s and the next cadence. Each
    change comes 15 s after the hub's start or the change before, so it finds the hub idle, past AC1's settling time.
15. **AC4's "one leased command running and then ended"**: a build under `deep lease` that takes 2 tokens and ends
    without giving them back, as a stopped build would, so the full count comes back only by a refill at its end.
    **"At once"**: the first read after its `deep lease` exits, which it does once the hub has answered its
    `lease.exited`. **"Nothing writes to it"**: a write to a named pipe moves its modification time (a read moves only
    its access time; checked on this Mac), read every 250 ms for 60 s. **"Still fails as it does today"**: #1016 AC3's
    reading, that no read while a leased build runs holds more than it left.
16. **AC5's "its record keeps both"**: the budget window's record row for a task keeps each limit's readings
    (`judgeTask`, `scripts/budget-window.mjs`), and nothing else of its report, so the test asks for the two count
    ceilings (Choices 3). Their values are the implementer's: the criterion names none.

## What is not tested, and why

- **Scope, "a beat that finds nothing to do for a set time stops, and starts again at the event that gives it
  work"**: no criterion names it apart from what AC1 counts and AC3 sees, which hold however the beats run.
- **Scope, "a new agent" and a changed `PATH`, a session's last-seen time or a watch event**: no criterion names
  them; AC3 names three changes.
- **The other timers** (17 in the core): the issue's four only, apart from reading 3.
- **Linux, and the reference Macs' budgets**: AC2 and AC5 are counts, judged on any machine; nothing here is a timing
  budget.
- **The Proof's numbers** are printed by `files.test.ts`, `instructions.test.ts` and `pipe.test.ts` as readings; the
  merge base's are in BASE-FAILURE.txt.

## Files

- `helpers.ts`: the world (home, stand-ins, `deep setup`, 30 days of history), the hub by PID, the record through the
  socket, the merge base's commit.
- `files.test.ts` (AC1), `instructions.test.ts` (AC2), `seen.test.ts` (AC3), `pipe.test.ts` (AC4), `budget.test.ts`
  (AC5).
- `fixtures/fs-calls.mjs`: the counter of the hub's file-system calls. `fixtures/holder.mjs`: AC4's leased build.
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: this job's one run of the suite at the base.
