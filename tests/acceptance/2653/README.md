# Acceptance tests for #2653: the asks core keeps a bounded history of a session's stops

Written first, blind, from issue #2653 (its text as of 2026-11-17T21:52:35Z: the description, Scope, the five
acceptance criteria, Proof and Depends on), the Nov 13 memory report it links
(`reports/package-story-memory-2026-11-13.md`: Measured, and Found and not applied, item 4), `docs/technical-design.md`
(An ask, and your answer getting back; Numbers version 0 has to hold; Dogfooding; Tests written first) and the base
commit `3cf41958f`, where the asks core keeps every stop of a session until it ends. The suites of #85 (the asks core's
stops, tasks and automatic continues: this folder's shape), #318 (the asks core), #16 (its 30-day record and how it
starts a hub) and `packages/hub/test/startup-memory.test.ts` (a hub thread's heap) set the conventions. No
implementation of #2653 was seen. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes
to a blind redraft by this job.

## Run

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # heap.test.ts's hubs run the built packages
PATH=$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node scripts/throttle.mjs build --wait 120 -- cargo build --locked -q -p deep-hook --features env-plants
                                         # heap.test.ts only: a hub refuses to start without deep-hook under target/
node node_modules/vitest/vitest.mjs run tests/acceptance/2653 --no-file-parallelism --testTimeout=600000 --hookTimeout=180000
node node_modules/typescript/bin/tsc -p tests/acceptance/2653/tsconfig.json
```

Node 24.22 or newer, and `git` with the merge base in this checkout's history (below). Every world is a real record on
SQLite and a home folder in a temporary folder, with a virtual clock, removed afterwards, as is each heap snapshot; the
merge base's asks core and the planted twin, built from git, are kept in `$TMPDIR/dh2653-*` between runs; AC5's two
launch trees are removed at its end, their links first. Only `heap.test.ts` starts processes (hubs, as #16's helpers
start them, stopped by their PIDs, never by name or port). No network, no agent, no model.

Each 50,000-stop file runs for minutes: one session's stops land one at a time and the core ticks after each, and on
the base the core's work per stop grows with the stops it holds. Measured on the base on a loaded 18-core Mac (load
about 225 to 265): 50,000 stops through the base's core alone, a tick after each, 134 s (a scratch driver, not in this
folder); `held.test.ts`, the merge base's core and this checkout's side by side with every step compared, 518 s under
`nice -n 10`; `readings.test.ts` 40 s; `heap.test.ts`, four hubs, 148 s. The tests set their own timeouts (40 minutes
for a 50,000-stop file, an hour for `heap.test.ts`). A Mac that clears worktrees' `target/` folders clears deep-hook
too (this one did, an hour after the first build): build it again before `heap.test.ts`.

## The surface

The issue names two fields, `stops` and `stopIds` of `packages/asks/src/index.ts`, and the rules that read a stop, but
no method that reports them. These tests add nothing to the surface: no method, option, flag or export. They reach the
code only through:

- **`@deepbuild/asks`, through its public entry `packages/asks/src/index.ts`**: `openAsks` (with `record`, `now`,
  `deliver`, `home`), `tick`, `inbox`, `needsYou`;
- **`@deepbuild/record`** as it is at the base: `openRecord`, `append`, `read`, `close`;
- **events** the tests append as the hook and the runner would, in the shapes the base already has: `session.start@1`;
  `agent.stop@5` (`turn`, `did_work`, `claim`, `cause`, `usage: null`, `outcome`, and as the adapter's facts give
  them `owner`, `signature`, `plan_resets`, and `child` for a subagent's stop), with `ts` and `seq` from deep-hook's
  stamp; `user.ask@1` (`from: person` for a prompt you typed, `from: continuation` for a goal's); `tool.before@1` and
  `tool.after@1` as #16's history records them; `verdict.made@1` PASS as #85's suite records it. They read
  `ask.created`, `ask.batched`, `ask.superseded`, `ask.moot`, `session.continued` and `session.reading`, as the core
  writes them;
- **the hub** (`heap.test.ts` only): `deep hub run` started as #16's helpers start it (their environment, a process
  group of its own, its ready line, stopped by its PID), from a tree of each side's (AC5, below), on #16's seeded
  record, with a preload (`node --import`, test code);
- **`node:v8`**: a heap snapshot of the test's own process (the count), and in the hub's core thread
  `getHeapStatistics` after two full collections (AC5);
- **`git`**: the merge base's `packages/asks` (below).

### How the tests drive it

- **A step** *(chosen)*: one event lands in the record, then the core ticks once, as the hub ticks the asks core when a
  stop lands (`packages/hub/src/core.ts`, "A stop drops what its turn no longer asks as it lands") and once a second
  while a task waits on its check. A step with no event is the clock moving and one tick.
- **Your settings** are #85's (`<home>/config.json`, no `batch`), so every ask shows when it is raised; unblock tasks
  wait two days. The clock starts at 2026-11-17 00:00 UTC (`T0`). You are actor and scope `you`.
- **AC1's session, S1** (`scenarios.ts`, `oneSession`): it starts at `T0`, then makes stop *n* at `T0` + *n* s, for *n*
  = 1 to 50,000, and never ends (no `session.end`). Its tenth stop is a spent plan window (`plan_window_spent`, owner
  `service`, signature `sig:5a0e1b2c3d4e5f60`, `plan_resets` at `T0` + 16 h); it raises the one unblock task, which
  unblocks `session:S1` and covers that stop. Every other stop is a turn that ended normally (`cause: unknown`,
  `outcome: finished`, as #85 reads Claude Code's Stop), which no rule acts on. The 50,000th stop lands at `T0` + 13.9 h,
  before the reset and well inside the task's two days, so the task is open at every step.
- **"Judged"** *(chosen)*: a spent window's task has the reset time as its check, which no runner runs (#85, criterion
  5): the core judges it at each tick, reading the reset from the stops it covers, and closes it at the reset
  (`ask.moot`, `because: window_reset`, `at` the reset). So the task is judged when the clock reaches the reset, after
  the 50,000th stop.
- **Stop IDs** carry a mark *(chosen)*: the ten letters of the stop's time, `STPZ`, two letters for its session, and its
  number. The tests keep stop numbers, never these strings, so the count below reads only what a core keeps.

## The merge base *(chosen)*

AC1, AC3 and AC5 compare with the merge base. The tests take it from git: `git merge-base HEAD origin/main` (else
`main`), which is `3cf41958f` for this suite and for the implementer's branch until it merges a newer main. Once this
folder is on that commit, the change has landed, and the merge base is the first parent of the commit that brought this
folder there, so a run from main afterwards still compares the change with the program it replaced (an improvement
compared with the program itself would always fail); AC3's first leg then reads the change's own edits, from that
parent to that commit (`helpers.ts`, `changeBase`).

The merge base's side is its `packages/asks` alone (`helpers.ts`, `asksAt`): `git archive <sha> packages/asks`, each
source compiled by this checkout's TypeScript with the root tsconfig's target and module, in
`$TMPDIR/dh2653-merge-base-<sha12>/` beside a link to this checkout's `node_modules`, so it runs on this checkout's
record, contracts and adapters. In-process it is imported beside this checkout's core; for a hub (AC5) it is the
`packages/asks` of the merge base's launch tree. Why not a whole built copy of the merge base, as #85's budgets
build one: the change is the asks core's, a whole build is 36 packages and minutes on a loaded Mac, and the record the
two cores read must be the same. Why not expected values derived from the scenario: "equals the merge base's at each
step" names the merge base's core as the reference, and AC1's 50,000 steps hold states (which ask shows, its age, what
was written) that only the merge base's rules define. Where an expected value is the design's own (AC2's reset, AC3's
continues), the test asserts it as well.

## Counted by the test *(chosen)*

The stops a core holds for S1 are **the IDs of S1's stops reachable from the core in a heap snapshot**
(`helpers.ts`, `stopsHeld`). The test holds the object `openAsks` returned and the record in a `Count2653`; writes a
heap snapshot of its own process (V8 collects garbage first, so what is read is live); finds the core as the
`bound_this` of the returned `tick` (the base binds every function it returns to the core); and walks from it over its
data (objects, arrays, maps and sets), never through a closure, a context, a hidden class or a prototype, and never into
the record, the holder or the returned functions. Every string with the mark of S1's stops it reaches is a stop the
core still holds, whatever shape the core keeps it in: a stop is known by its ID, so a core that keeps a stop keeps
its ID, and a core that let a stop go keeps no reference to its ID unless a rule still names it.

Why not a simpler reading:

- **A scan of the whole heap for stop IDs** counts the record's: its projector caches every turn of the 64 sessions it
  read last, each with its stop's event ID (`packages/record/src/projections.ts`, `TURNS_CACHED` and `turnsOf`), so a
  session of 50,000 turns keeps 50,000 IDs in the record whatever the core does.
- **A new method** on the asks' public surface (a count of stops) is what the issue doesn't name; the narrowest
  observable the base already has is the heap, which the Nov 13 report read too ("by each object's first holder in a
  heap snapshot").
- **Heap size** reads bytes, not stops; AC5 reads it, as its criterion says.

The count is guarded: it must find, in this checkout's core, S1's newest stop and the one its open task covers, which
any core still holds (the issue's Scope). Otherwise AC1 fails `BLOCKED unless the count finds …`, not PASS.

## The contract per criterion

1. **`#2653.8086bb1d` One session that makes 50,000 stops and never ends, with one open ask-task that covers its
   tenth stop: the core holds under 1,000 stops for it, counted by the test, and every ask, task and outcome equals the
   merge base's at each step.** `held.test.ts`: the merge base's core and this checkout's, each on its own record, take
   S1's start and 50,000 stops in lockstep. After every step the two read alike *(chosen: "every ask, task and
   outcome")*: every row of the core's inbox (ask, kind, session, status, outcome, owner, age, request, decision,
   missing, words), every event the log gained in the step (the core's appends and the step's own input, without event
   IDs or log positions), and everything handed to the agent; each ask is named by its first appearance in its world,
   so two cores that raise the same asks read alike. The first step that differs fails, naming the step and its stop,
   with both states. After the last stop, the count above: this checkout's core holds fewer than 1,000 of S1's stops
   (the drafted bound). On the merge base it holds 50,000, and the test fails naming the count:
   `this checkout's core holds 50000 of the 50000 stops S1 made (the merge base's holds 50000): expected 50000 to be
   less than 1000`.
2. **`#2653.7105a3cb` The stop the open ask-task covers is still read when the task is judged, 49,990 stops later.**
   `judged.test.ts`: S1's 50,000 stops; a second before the reset the task is open; a minute after it the task is
   `moot`, its one `ask.moot` reading `{because: window_reset, at: <the reset>}`: the reset of the stop it covers, read
   49,990 stops later. **Plant** (`plants.test.ts`): a core that keeps only the newest 100 stops loses it, and the task
   never closes; the test fails naming the task: `task ask:<id>, which covers stop 10 of S1 (a spent plan window
   resetting at 2026-11-17T16:00:00.000Z), is judged 49990 stops later: it closes at the reset that stop carries`.
3. **`#2653.d3fb687c` The time of the session's last finished stop, and the plan resets a block reads from its stops,
   are the merge base's at every step of #340's and #84's suites, unchanged.** `readings.test.ts`, two legs (Readings,
   below): #340's and #84's suites are as on the merge base and in the preflight's one-at-a-time block; and the two
   readings decide as on the merge base at every step of a run where they decide, 1,200 stops on from the stops they
   come from. **Plant**: the newest-100 core fails the second leg at the first step that differs (a dropped connection
   it continues a second time, having let go of the stop the first continue came from).
4. **`#2653.3f98736d` A hub restarted on that record folds to the same asks, tasks and stops held as the hub that ran
   through it.** `restart.test.ts`: this checkout's core takes S1's 50,000 stops; then the hub stops (the core goes, the
   record closes) and a core opens on the same record at the same time, as the hub's start opens it. Its inbox and Needs
   you equal those of the core that ran, and it holds the same stops of S1 (the count, by number: none gained, none
   lost).
5. **`#2653.b467ea15` On #16's 30-day record the core thread's heap after two full collections is at least 1.5 MB under
   the merge base's (drafted from the report's 2.2 MB).** `heap.test.ts`: four hubs, one after another, this
   checkout's, the merge base's, the merge base's, this checkout's (ABBA, so a drift over the run cancels). Each starts
   on #16's `seedHistory(root, 30)` (600 sessions, none ended, ten stops each) seeded into its own home just before, as
   #16 seeds it, so every hub sees a history of the same age; each starts from its side's launch tree *(chosen)*: every
   package of this checkout cloned into a temporary folder and linked by name in the tree's own `node_modules`, the
   checkout's third-party modules and other top-level entries (deep-hook's `target/` among them) linked, and
   `packages/asks` either this checkout's built asks core or the merge base's. 15 s after its ready line (as the report
   read the hub) and every 15 s after, a preload in the core thread runs two full collections and writes
   `getHeapStatistics().used_heap_size`; the hub's reading is the first within 0.25 MB of the one before *(chosen:
   settled)*, at most eight readings. MB is 2^20 bytes *(chosen, as the report's and startup-memory's figures)*. Each
   tree's hub must reach its own tree's asks package, or the test is BLOCKED. PASS when each of this checkout's
   readings is at least 1.5 MB under each of the merge base's; FAIL when none is (`the core thread holds … MB …, and on
   the merge base … MB: under it by … MB; at least 1.5 MB under is needed`); INCONCLUSIVE, skipped with the readings,
   when the readings straddle it or a hub never settled. Hubs of one program read within about 0.25 MB of each other
   this way, so a change saving about 1.75 MB or more reads PASS and none reads PASS by noise.

## Readings where the issue leaves a choice

- **AC3, "#340's and #84's suites".** The two readings are inside the core: `continuedSince` takes the time of the
  session's last finished stop (and of the stops earlier continues came from) to decide whether a dropped connection or
  a context overflow gets its one automatic continue, and `stopsSettled` reads the resets of the stops a block's task
  covers to close a spent window's task. Only those decisions can be seen. #340's and #84's suites drive the hub with
  deep-hook; at the base they make no dropped connection, context overflow or spent window (their only failed stop is
  #84 reach's revoked sign-in), so in their steps the two readings decide nothing and would pass whatever the readings
  were; their records go with their temporary folders. So the test asserts two things. First leg: those suites are
  unchanged against the merge base (`git diff`, and no untracked file), and `scripts/lanes.mjs` runs each in its
  one-at-a-time block and leaves none of it to a person, so the preflight runs every one of their steps against the
  change. Second leg (`scenarios.ts`, `readings`): the merge base's core and this checkout's take, in lockstep, a run
  of the turn kinds those suites drive (a prompt you typed, a goal's continuation, tool calls, a message typed mid-turn,
  a subagent's stop, turns that end normally or crash, #84's revoked sign-in whose task closes on its check and resumes
  its session), with the stops whose handling reads the two values: dropped connections and context overflows whose
  continue is counted since the last finished stop 1,200 stops back, or since an earlier continue's stop 1,200 stops
  back; and one spent window's task covering a stop of B and of C, resetting two hours apart, with 1,200 stops of each
  after. At every step everything the cores show is compared, as in AC1. The run also asserts that on the merge base
  these stops do what the design's rules say (the five continues of A, D's resume and its continue, and the window's
  task closing once, at the later reset), so the comparison can't pass on a run where the readings decide nothing.
- **AC4, "a hub restarted"** is the asks core opened again on the same record, as the hub's start opens it
  (`packages/hub/src/core.ts`, `openRecordAndAsks`), at the time the first one stopped. A real hub would need 50,000
  stops through its socket, each a Stop the hub judges, and the stops it holds can only be counted inside its core
  thread; the core's fold is the same code either way. "The same stops held" is the same set of S1's stop IDs.
- **AC5's merge base** in the hub is this checkout's hub with the merge base's asks core: what the criterion measures
  is the asks core's share of the core thread. Both sides start from a launch tree, so they differ in that package
  alone. Why not a module hook that resolves `@deepbuild/asks` to the merge base's core in the core thread (tried
  first): a pass-through `registerHooks` resolve hook alone left 1.08 MB more in V8's trusted space and 0.35 MB more
  in old space in some hubs and not others, a 1.4 MB swing between hubs of one program, as large as the effect
  measured; without a hook, hubs agree within about 0.25 MB (`BASE-FAILURE.txt`).
- **"After two full collections"**: each reading runs two (`gc({type: 'major', execution: 'sync'})`, as
  `packages/hub/src/settle.ts` reaches `gc`), then reads `used_heap_size`. Six more collections in a row moved no
  reading by more than 0.01 MB, so two are enough.
- **"Under 1,000 (drafted)"** is read as fewer than 1,000. Nothing smaller is asserted: S1's newest stop and the covered
  one must be held, and anything the change needs for the time of the last finished stop.
- **"Never ends"**: no `session.end` and no `session.start` after the first; no child session's stop.
- **Settings**: no `batch` (every ask shows when raised), as #85's suite; with batches the task would show at the next
  visit, which changes no stop.

## Criteria, tests and wrong programs

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed and the leading
`- [ ] ` dropped (`scripts/proof-change.mjs`). Each test name starts with `AC<n> #2653.<id>`.

| # | ID | Criterion (short) | Tests | Wrong programs it fails on | On the base |
|---|---|---|---|---|---|
| 1 | `#2653.8086bb1d` | 50,000 stops, one open task on the tenth: under 1,000 held, asks as the merge base's at each step | `held`: one | the base (holds 50,000); a core that changes an ask, task or outcome at any step | FAIL at the count: `expected 50000 to be less than 1000` |
| 2 | `#2653.7105a3cb` | the covered stop is still read when the task is judged, 49,990 stops later | `judged`: one; `plants`: one | plant: keeps only the newest 100 stops | `judged` PASS (the base keeps every stop); the plant FAILs naming the task, as required |
| 3 | `#2653.d3fb687c` | the last finished stop's time and a block's resets are the merge base's, #340's and #84's suites unchanged | `readings`: two; `plants`: one | plant: keeps only the newest 100 stops; a change to #340's or #84's suite or its lane | PASS (the base is its own merge base); the plant FAILs naming the step |
| 4 | `#2653.3f98736d` | a restarted hub folds to the same asks, tasks and stops held | `restart`: one | a core that lets stops go live but not at a start's fold (holds more after it, by number), or one whose fold loses the covered stop | PASS (both hold all 50,000) |
| 5 | `#2653.b467ea15` | core thread heap after two full collections at least 1.5 MB under the merge base's on #16's record | `heap`: one | the base (no saving) | FAIL: `under it by -0.24 to 0.24 MB; at least 1.5 MB under is needed` |

## Planted programs

| Name | Where | What it does | Must fail | Its failure names |
|---|---|---|---|---|
| a core that keeps only the newest 100 stops of a session *(chosen: `newestHundred`)* | `plants.ts`, test code: `packages/asks` at `3cf41958f` with one edit where a stop is applied: past the newest 100 a session's oldest stops leave `stops` and `stopIds` | as the base otherwise | AC2's scenario (`judged`) and AC3's (`readings`) | AC2: the task, `task ask:<id>, which covers stop 10 of S1 …, is judged 49990 stops later: it closes at the reset that stop carries`; AC3: the step, `at step <n> (A's stop <m> (timed_out, failed) at …), a core that keeps only the newest 100 stops of a session reads what the merge base's doesn't` |

The twin is made from the fixed base commit, not the merge base, so it stays the same wrong program after the change
lands. It is chosen by the test that imports it, never by an environment variable. The real program's runs are AC2's
and AC3's own tests.

## Legs that read BLOCKED or INCONCLUSIVE

- **Every leg** is BLOCKED (fails with `BLOCKED` at the head of its message) with no merge base in git history
  (`origin/main` or `main`), or when `packages/asks` can't be read at it.
- **AC1** is BLOCKED if the count doesn't find S1's newest stop and the covered one in this checkout's core (the count
  can't see how the core keeps them), and every count is BLOCKED if `openAsks`'s `tick` is no longer bound to the core
  (the walk starts there).
- **AC3's second leg** is BLOCKED if, on the merge base, its stops don't continue, resume and close as the design's
  rules say: the comparison would be of a run where the readings decide nothing.
- **AC5** is BLOCKED without deep-hook (the hub doesn't start: run the cargo line above), when a hub's core thread
  writes no heap within 300 s of being asked, or when a side's tree doesn't reach its own asks package. It is
  INCONCLUSIVE when a hub's heap doesn't settle within eight readings, or when the four settled readings
  straddle the 1.5 MB, and is then skipped with the readings, never PASS. Expect INCONCLUSIVE where another process
  keeps a hub's start from finishing within two minutes, or where the change's saving lies within a few hundred KB
  of 1.5 MB.

## Outside this folder, for the implementer

`scripts/lanes.mjs` (the five 50,000-stop and hub files each run for minutes on this Mac, and the 50,000-stop ones
hold two cores and a heap snapshot in memory):

```js
// #2653's files fold 50,000 stops of one session through the asks core, held.test.ts beside the merge base's, and read
// a heap snapshot; heap.test.ts starts four hubs on #16's 30-day record. One file at a time, each over two minutes.
alone.push('tests/acceptance/2653/');
slow.push('tests/acceptance/2653/held.test.ts', 'tests/acceptance/2653/judged.test.ts', 'tests/acceptance/2653/restart.test.ts', 'tests/acceptance/2653/plants.test.ts', 'tests/acceptance/2653/heap.test.ts');
```

Nothing else: no planted program for the implementer to add (the twin is in test code), no setting, no fixture.

## Files

- `helpers.ts`: stop IDs and stamps, your settings, the cores (this checkout's, the merge base's, `asksAt`), a world (a
  record, a home and a core on a shared virtual clock, restarted on the same record), the events the hook and the
  runner record, a step (`land`), a step's state (`stateOf`), and the count (`Count2653`, `stopsHeld`).
- `scenarios.ts`: AC1's session (`oneSession`), AC2's judgement (`judged`) and AC3's run (`readings`), shared with
  `plants.test.ts`.
- `plants.ts`: the newest-100 twin.
- `held.test.ts` (1), `judged.test.ts` (2), `readings.test.ts` (3), `restart.test.ts` (4), `heap.test.ts` (5),
  `plants.test.ts` (2 and 3).
- `tsconfig.json`: type-checks the suite under the root's strict options with `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: what the base reads, run and reasoned, and why each test fails or passes there.
