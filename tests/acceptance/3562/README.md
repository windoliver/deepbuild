# Acceptance tests for #3562: a green stop's reply doesn't wait for a slot

Written first, blind, by a job that never saw an implementation of #3562; none existed. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- Issue #3562 as it stood when this job ran (open, no comments): its opening paragraph and four bullets, the table of
  #3539's readings, Scope, the five acceptance criteria with the sentence above them, `Runs on`, Proof and Depends on.
  Issues #3539, #29, #907, #965, #2075 and #1982, which it names, for the words it cites.
- `docs/technical-design.md`: An agent says it's done (Fast and slow lanes; Held time is counted; Slow runs start when
  the turn ends; A loop's turn end isn't a hand-back; Latest snapshot wins, in the queue; Stale results stay stale; The
  verdict in the chat), Numbers version 0 has to hold, and How we know version 0 works (Criteria to tests, Wrong
  programs, The edit guard, Dogfooding). `docs/parallel-proof.md`, sections 5 to 7. `AGENTS.md`, `CONTRIBUTING.md`.
- At the base (`2a689d81f`): `packages/hub/src/stop-reply.ts` (`stopReply`, `turnEnds`), `gate-runner.ts` (`stop`,
  `turnEnded`, `queueSlow`, `place`, `hold`, `release`, `record`, `pump`, `runOwn`, `carry`, `held`), `runs.ts`
  (`launch`, `recordable`), `core.ts` (`wireGateServices`'s `slots`, `testClock`, `buildReply`), `server.ts` (`holdFor`,
  `coreReply`), `claude-settings.ts`, `ask-tasks.ts` (`asksForChange`, `claim`, `expected_ms`), `verdict-chat.ts`
  (`claimState`), `log-reads.ts`; `packages/verdicts/src/line.ts`; `packages/gate/src/exec.ts` (`admit`) and
  `scheduler.ts` (`QueueEvent`, `HeldRecord`); `packages/leases/src/index.ts` (`SLOW_SLOT`, `decide`);
  `packages/checks-command/src/index.ts` and `packages/supervisor/src/seatbelt.ts` (what a check's run may read);
  `packages/contracts/schemas/check.held@1.json`, `stop.held@1.json`, `run.started@3.json` and the package's README;
  `packages/readings/src/record.ts` (`loopHolds`); `scripts/proof-change.mjs`, `proof-runs.mjs`, `proof.mjs`,
  `wait-ratchet.mjs`, `lanes.mjs`, `lanes-lists.mjs`; `tests/vitest-setup.ts`; and the blind suites
  `tests/acceptance/965` (helpers, the five files, README, BASE-FAILURE), `907`, `29` (`h-d.ts`), `2075`, `2742`,
  `2844` and `3178` for format.
- `docs/spikes/3539/`, which is not the base's: the issue says the folder is not on main yet, and it was copied into
  this job's checkout as #3539 left it. It is read as the script's state before the change: `reply-hold.mjs`,
  `load.mjs`, `out/reply-hold.json` and the README's sections on them.

Nothing outside these was needed, and nothing was fetched.

What the base does: at a green stop, `stopReply` awaits `turnEnded` before it reads the line. `turnEnded` awaits its
pump, and the pump takes a place out of the queue whenever `slots()` counts a slot free, then awaits the run until it
has started. `slots()` is the pool less the runs holding a slot, and slow runs hold at most all but one (#907), so on
two slots with one journey running the pump always takes the next place and waits in `admit` for a slot the lease
table won't give. So the core's reply to the second session's stop is made only when the first journey ends, and the
hub lets the Stop hook go with no line when its hold is over (60 s). A place the pump took is out of the queue, so a
newer snapshot finds none to take, and both snapshots' runs then wait in `admit`, each asking again every 50 ms: a
freed slot goes to whichever asks next. The record holds no place that waits for a slot (`check.held` is written only
for a loop's or background work's hold), and the line names no queued check.

## Run them

```sh
npm ci                            # once, if node_modules is missing
npm run build --workspaces        # the four .test.ts files start `deep hub run` from packages/cli/dist
cargo build --locked -p deep-hook # their sessions are played through target/debug/deep-hook
node node_modules/vitest/vitest.mjs run tests/acceptance/3562/reply.test.ts
node node_modules/vitest/vitest.mjs run tests/acceptance/3562/replaced.test.ts
node node_modules/vitest/vitest.mjs run tests/acceptance/3562/order.test.ts
node node_modules/vitest/vitest.mjs run tests/acceptance/3562/unchanged.test.ts
node --test tests/acceptance/3562/reply-hold.test.mjs
node node_modules/typescript/bin/tsc -p tests/acceptance/3562/tsconfig.json
```

Use the repo's Node (`.node-version`, 24.22.0), from the checkout's root, one file at a time. A missing build is
BLOCKED, naming what is missing, never a failure of a criterion.

| File | Needs built | Takes |
|---|---|---|
| `reply-hold.test.mjs` | `packages/evidence/dist/patterns.json` and `packages/record/dist/versions.json` (a build writes them; so do the two commands under How to run in `docs/spikes/3539/README.md`). No hub | 8.4 s at the base, measured once on this job's Mac under a 1-minute load of 40 to 80. Its limit is 15 minutes; the script's own is 10 |
| `reply.test.ts` | the CLI and deep-hook | Not measured: this job had no build. One hub, two sessions, two stops: well under a minute on a quiet machine. On the base about two minutes, since the held stop's hook returns only when its 60 s hold is over. Its limit is 20 minutes |
| `replaced.test.ts` | the CLI and deep-hook | Not measured. One hub, two sessions, four stops: a minute or two. On the base about three, with a 30 s wait for each reply that doesn't come. Its limit is 40 minutes |
| `order.test.ts` | the CLI and deep-hook | Not measured. One hub, four sessions, 20 runs of four stops and four journeys: five to ten minutes on a quiet machine, several times that under load. It gives up after 60 minutes, naming how many runs it made; its limit is 90 |
| `unchanged.test.ts` | the CLI and deep-hook | Not measured. It runs #907's three files and #965's five, about 30 tests that each start a hub: half an hour or more on a quiet machine. It gives up after 3 hours |

Each wait inside a test has its own bound (180 s for a stop to be judged, a run to start or a run to end), and each
test's limit is above the sum of them, so a hang ends as a named failure and never as a bare timeout.

The hub-driving files start real hubs and real processes (the checks run through the command check kind, in its
sandbox), so the folder runs alone: `lane.json` says so, with its reason. `order.test.ts` and `unchanged.test.ts` take
over two minutes, so `scripts/lanes-lists.mjs`'s `slow` list needs `'tests/acceptance/3562/order.test.ts'` and
`'tests/acceptance/3562/unchanged.test.ts'`. This README is the instruction; the implementer makes that edit. The
unit lane's `node --test` command lists no file under `tests/acceptance/`, so `reply-hold.test.mjs` runs by this
README's command and in the proof lanes, which run a tagged `.test.mjs` themselves.

They need a machine the hub's fast lane can run on. Where a stop isn't judged within 180 s, where its 2 s check is
left to the slow lane because the snapshot and checkout used up the 10 s budget, or where a reply comes only after the
next session has stopped, the test says BLOCKED and names it: such a run says nothing about #3562 and is to be redone.
Nothing needs the network (the forge is a closed local port), a real `claude`, a sign-in or a model call. Folders are
under `/tmp/dh29-*` (made by `../29/h-d.ts`) and `<tmp>/dh3562-*`, and are removed after each test; every process a
test starts is stopped by its PID, never by name or port.

## The world every test drives

Criteria 1 to 3 each drive a running hub through its hook socket on a controlled clock, with two check slots, as the
issue's sentence above the criteria says. The hub, the sessions, the clock and the record's readers are #965's suite's,
imported from `../965/helpers.ts`, never copied; the home, the repository and the handed definitions are #29's
(`../29/h-d.ts`). What `helpers.ts` adds is several sessions on one hub and a stop that isn't waited on.

- **The hub.** `deep hub run` with `DEEP_HUB_TEST_CORES=4` (a `cpu.slot` pool of two, of which slow runs hold at most
  one, #907) and `DEEP_HUB_TEST_CLOCK_STEPS=1` (`test.clock`).
- **The sessions.** Up to four Claude Code sessions, `first` to `fourth`, each played through the real deep-hook
  binary as children of its own stand-in process (`../965/fixtures/agent.mjs`), each in a copy of the repository as
  its own folder. Each types one ask (`make the cart total round each line to cents`, `make the cart total show two
  decimal places`, `add a currency symbol to the cart total`, `fix the cart total of an empty cart`), which opens one
  task. Its handed definition (`DEEP_HUB_TEST_DRAFTS`) has R1 checked by `.deepbuild/checks/unit-<name>.sh` (unit
  depth) and R2 by `.deepbuild/checks/journey-<name>.sh` (journey depth), both `on_base: passes`. So each session has
  a journey of its own, and a failure can name the check.
- **Expected times.** Each requirement carries the time its check took when drafted (`expected_ms`): 2 s for the unit
  check, 300 s for the journey. So the 10 s budget admits the unit check to the fast lane and leaves the journey to
  the slow lane, and "a 300 s journey" is the gate runner's own expected time for it.
- **Real durations.** The unit check passes at once. A journey's run goes on until the test ends it: its suite waits
  for a file in the folder it runs in, which the run's `run.started` names (`cwd`), and passes when the test writes
  it. So a slot frees when a test says, never when a clock does, and "while a journey runs" and "before any slot
  frees" are things a test holds.
- **Turns.** A session's first turn is the one its ask opened; each later turn starts with a question you type
  (`does the cart total still hold after change <n>?`), which opens no task, so the turn works the ask already open.
  Every turn changes `src/cart.ts` through an `Edit` call, with a line no other turn writes, so each snapshot differs.
  No session loops and none has background work: every turn is one a person typed.
- **Stops.** A stop is sent and not waited on: its Stop hook's run goes on while the test reads the record. A test
  first waits for the stop to be judged and its fast lane to end, in the record. Only then does it wait for the
  reply: AC1 until the hook returns by itself; AC2 and AC3 for at most 30 s, after which they go on without it.
- **Readings.** Everything is read back through the hub's socket (`events.read`). A stop's line is its reply's
  `systemMessage`. A judged stop is the `claim.made` the stop rule made there (the one that carries the recomputed
  definition `hash`), its snapshot the commit its unit check's run names, its fast lane's end that run's
  `run.finished`, and its held time the `stop.held` naming the claim, stamped at its reply on the hub's clock. A
  journey run is a `run.started` of the session's journey check, on the snapshot its `commit` names, at its `ts` on
  the hub's clock. A place is the newest `check.held` for its check and snapshot, as #965's suite reads one.

Each test prints, for the Proof, each reply's time and each run's start.

## Criteria to tests

Each test's name starts with its criterion's ID and tag (`#3562.<first 8 hex of the SHA-256 of the criterion's text>`,
as `scripts/proof-change.mjs` computes it). #3562 is a fix, so the wrong program of criteria 1 to 4 is the merge base
(design: Wrong programs): each of those tests fails there at an assertion, for the reason its criterion names.

| ID | File | Test |
|---|---|---|
| AC1 `#3562.0a154c77` | `reply.test.ts` | the second session's reply comes when its fast lane ends, and its line names the journey as queued |
| AC2 `#3562.56d682a0` | `replaced.test.ts` | the second stop's snapshot takes the place: no run on the first, the record's queue shows it replaced, one run on the second |
| AC3 `#3562.cad82a22` | `order.test.ts` | the three start in the order they stopped, in each of 20 runs |
| AC4 `#3562.a7231f2c` | `reply-hold.test.mjs` | the script, run, reads 20 of 20 for each stop and for the order; both outputs are kept |
| AC5 `#3562.ff6e2a6d` | `unchanged.test.ts` | #907's and #965's folders hold the merge base's bytes, and every test of both passes |

### AC1, `reply.test.ts`

The first session's turn ends green with a slot free, and its journey starts and keeps running. The second session
changes `src/cart.ts` and stops. Once its fast lane has ended in the record, the test waits for its Stop hook to
return, which it does by itself: with the hub's reply, or with none when its hold is over. Asserted, naming
`the second session's stop`:

1. The reply came: the hook's output carries a line. A hook that returned with none fails here.
2. The stop was let through, not sent back.
3. No run of the second session's journey had started when the reply came, and the first session's journey was still
   running (a journey that ended by itself is BLOCKED: only the test ends one).
4. The stop's `stop.held` is in the record, after its unit check's `run.finished`: the reply comes once the fast lane
   has ended, not before.
5. The line contains `1 check queued`.

On the base it fails at 1. Before it fails, it ends the first session's journey and reads the record, so the message
says what the hub did: "The hub made its reply only once the first session's journey had ended", with the `stop.held`
and the `run.finished` it came after. A hook that returned with no line less than 15 s after the stop's fast lane
ended is BLOCKED instead: the machine left the hub no room to reply inside the hold.

### AC2, `replaced.test.ts`

AC1's two sessions. The second session stops green (S1), then again once the hub's clock is 60 s past that stop, with
`src/cart.ts` changed (S2). The first session's journey runs throughout: no slot has freed. Asserted, naming
`the first snapshot (<7 hex>)`:

1. Before the slot frees, no run of the second session's journey has started.
2. The test ends the first session's journey. The first run of the second session's journey to start is on S2, and
   none is on S1.
3. The test ends that run, and the first session stops again. Its journey is queued behind whatever still waits, so
   when it starts, nothing of the second session's can still be waiting. At that event: no run on S1, and exactly one
   run of the second session's journey, on S2. If neither that journey nor a second run starts within 180 s, the test
   fails, saying the event never came.
4. The record's queue: the place of the second session's journey on S1 is in the record, with `replaced_by` S2 and
   `started_at` null.

On the base both snapshots' runs wait in `admit` when the slot frees. Whichever asks first starts: if S1's, the test
fails at 2; if S2's, S1's run starts as soon as S2's ends and the test fails at 3. Either way the message names the
first snapshot and says a run started on it.

### AC3, `order.test.ts`

One hub and four sessions make 20 runs. A run: the first session's turn ends green and its journey starts. The
second, third and fourth sessions each change `src/cart.ts` and stop green, one after another: each stop's fast lane
has ended, and its reply is in or 30 s have been waited for it, before the next session stops. No waiting check may
have started. Then the test ends the first session's journey and each journey that starts, one at a time. At each
start the run that started must be the next in the order the sessions stopped; a slot that frees with nothing started
within 180 s fails too. After the last journey ends, the next run begins.

A check that starts out of turn fails the test, naming it: "run 3 of 20, …: `.deepbuild/checks/journey-third.sh`
started out of turn. Its session stopped second of the three, and it took the first slot to free, ahead of
`.deepbuild/checks/journey-second.sh`, whose session stopped first and still waited."

On the base the three runs wait in `admit` and the freed slot goes to whichever asks next, so a run of the scenario
is in order only by chance. With three waiting runs asking every 50 ms, that is about one run in six, and all 20 about
never. This is an estimate from the code, not a measurement: no run through a hub was made.

### AC4, `reply-hold.test.mjs`

One test, three readings, each by `reply-hold-reading.mjs`'s `problems`, which checks every count against the runs it
counts:

1. `node docs/spikes/3539/reply-hold.mjs --runs 20 --out <file>` is run in the checkout, into a temporary folder. It
   must exit 0 and its output must read 20 of 20 for each stop (`other`'s and the person's `turnEnded` had returned
   while its checks waited) and 20 of 20 for the order (`started_in_order` is `other:first`, `other:second`,
   `person:first`, `person:second` in every run).
2. `docs/spikes/3539/out/reply-hold.change.json`, the change's kept output, reads the same.
3. `docs/spikes/3539/out/reply-hold.json`, the merge base's kept output beside it, holds 20 runs and reads 0 of 20
   for each stop and 0 of 20 for the order.

On the base it fails at 1, naming each stop and the order: "other's stop: its turnEnded had returned while its second
check waited in 0 of 20 runs". Where the checkout has no `docs/spikes/3539/reply-hold.mjs`, as main has none until
the change brings the folder, it fails before that, naming the script.

### AC5, `unchanged.test.ts`

One test. Unchanged: `git diff --name-only <merge base with origin/main> -- tests/acceptance/907 tests/acceptance/965`
is empty and no file is added under either. Pass: every `*.test.ts` of the two folders, listed when the test runs, is
run by a child Vitest from the checkout's root, one file at a time; every file must report its tests and every test
must pass. A test of theirs that ends BLOCKED or INCONCLUSIVE, or is skipped, didn't run to a verdict: this test is
then skipped as `INCONCLUSIVE`, which the lanes count as no test, never as a pass. A child run that wrote no report is
BLOCKED.

It passes at the merge base, as it should: it is the criterion that keeps what works. So the merge base can't be its
wrong program, and it needs a planted one (below).

## Surfaces the implementation must provide

Each is the smallest the criteria need, spelled as the tests read it.

- **The line of a stop whose slow check waits for a slot** contains `1 check queued`: the count of the claim's slow
  checks that have a place and no run yet, as "`<n>` check queued" for one and "`<n>` checks queued" for more. The
  design's words are "each check still queued or running named with its expected time, such as "3 checks queued ·
  about 4 min"", and the base writes `1 check running` the same way. A well-formed line:
  `says done 1/2 · 1 check queued · about 5 min · 1 test · next: DeepBuild`. Only `1 check queued` is asserted.
- **The record of a place that waits for a slot** is a `check.held` event, the kind the record already holds a slow
  check's place in (`check.held@1`, unchanged): `data` is `{ session, claim, check, snapshot, held_at, reason,
  started_at, started_by, replaced_by }`. One is appended when a slow check takes its queued place and no slot is
  free for its run, and again, whole, each time it changes; the newest for a check and snapshot stands. When a newer
  snapshot of the same session takes the place, the older place's record gets `replaced_by: <the newer snapshot>` and
  keeps `started_at: null`. A well-formed record of the first snapshot's place after the second stop:

  ```json
  { "kind": "check.held", "subject": "claim:01K74G0A1B2C3D4E5F6G7H8J9K", "data": {
    "session": "session:0b1dba30f2e84a6d9c1e5a7b3d9f0c21", "claim": "claim:01K74G0A1B2C3D4E5F6G7H8J9K",
    "check": ".deepbuild/checks/journey-second.sh", "snapshot": "3f2a1c0d9e8b7a6f5e4d3c2b1a0f9e8d7c6b5a40",
    "held_at": 1795680000000, "reason": "a check slot", "started_at": null, "started_by": null,
    "replaced_by": "9b8a7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a00" } }
  ```

  The tests read `check`, `snapshot`, `replaced_by` and `started_at`, and nothing else of it: `reason`, `held_at` and
  what `started_by` says when such a place starts are the implementer's. A place that starts at once, with a slot
  free, gets no record, as today: #965's `cron.test.ts` asserts the journey that started at the stop has none.
- **`node docs/spikes/3539/reply-hold.mjs --runs 20 --out <file>`**, the script's command line at the base, still
  runs, exits 0 and writes its output to `<file>` as JSON with the base's fields: `runs`,
  `other_turn_end_returned_while_its_second_check_waited`, `person_turn_end_returned_while_its_checks_waited` and
  `started_as_asked` (each a count of runs), and `taken`, one entry a run, each with `readings` holding the two
  fields of the same names as booleans and `started_in_order`, the four checks in the order they started. A
  well-formed output of the change, cut to one run:

  ```json
  { "runs": 20, "other_turn_end_returned_while_its_second_check_waited": 20,
    "person_turn_end_returned_while_its_checks_waited": 20, "started_as_asked": 20,
    "taken": [ { "readings": { "other_turn_end_returned_while_its_second_check_waited": true,
      "person_turn_end_returned_while_its_checks_waited": true,
      "started_in_order": ["other:first", "other:second", "person:first", "person:second"] } } ] }
  ```
- **Two kept outputs**, side by side in the spike's folder: `docs/spikes/3539/out/reply-hold.change.json`, the
  script's output on the change, and `docs/spikes/3539/out/reply-hold.json`, its output on the merge base, which
  stays as #3539 left it or is taken again on the merge base. The first name is new: the criterion keeps two outputs
  beside each other, and the name the script's output already has holds the merge base's.
- **The base's test surfaces stay**: `DEEP_HUB_TEST_CORES`, `DEEP_HUB_TEST_CLOCK_STEPS` and `test.clock`,
  `DEEP_HUB_TEST_DRAFTS` with a requirement's `expected_ms`, `events.read`, and `run.started`'s `cwd`, `check`,
  `claim`, `commit` and `lane`.
- **A planted wrong program for AC5**, which the merge base can't be. A twin kept as files:
  `tests/acceptance/3562/twins/<name>/`, named under `#3562.ff6e2a6d` in `tests/acceptance/3562/twins.json`, holding a
  source file that undoes what one of the two suites holds. The smallest known is `packages/leases/src/index.ts` with
  slow runs let into every slot, as the lease table's `fills-every-slot` plant has it: `tests/acceptance/907/slots.test.ts`
  then fails, and so must this test, naming it. The implementing agent adds it once the fix exists; this job adds none.
  Criteria 1 to 4 need no plant: the merge base fails each.

## Open points (choices the issue and the design leave open; the tests assert the least they can)

1. **The words for a queued check.** The issue says the line "names the journey as queued"; the design gives a
   count, "3 checks queued · about 4 min". The tests take the count form, as #965's suite took "1 check waits for the
   loop", and assert `1 check queued`. The expected time beside it is printed, not asserted.
2. **"The record's queue."** The base records a slow check's place in one kind, `check.held@1`, whose fields are
   exactly a place's: when it was taken, what it waits for, what started it, or the snapshot that took it first. The
   tests read the queue there, so no new kind, field or digest is needed. What this asks of the implementer beyond
   the record: the line and the readings that count a loop's holds (`loopHolds`) now have to tell a place that waits
   for a slot from one held for a loop, by its `reason`. A new kind would have kept them apart, at the cost of a
   schema, fixtures and a frozen digest the criterion doesn't name. If that trade is wrong, it is a redraft's.
3. **"Comes when its fast lane ends"** is held by order, never by a number of ms: the reply reaches the hook before
   its hold is over; it comes after the fast-lane check's `run.finished`; the first journey is still running and the
   stop's own journey has not started when it comes. The 15 s of room is the only number, and it only tells a held
   reply from a machine too slow to make one.
4. **Each session in a folder of its own, with its own ask and checks.** The criteria say "a 300 s journey of its
   own" and ask a failure to name "the check that started out of turn", so each session's journey has its own path.
   #965's world has one session and one ask; this one is #29's world with the repository copied once a session.
5. **Expected times come from the handed definition** (`expected_ms`, as #2075's suite gives them), not from clean
   runs seeded in the record as #965's suite does: a journey here really runs for as long as the test lets it, so a
   median of its runs would not be 300 s. The unit check really takes no time; "2 s" is its expected time.
6. **A journey ends when the test writes a file into its run's folder.** The folder is the one `run.started` names
   (`cwd`), which the command check kind lets its run read and write on every sandbox. No run is ended by a signal.
7. **"60 s later"** is on the hub's clock, by `test.clock`: the second stop's turn starts once the clock is 60 s past
   the moment the first stop was sent, so the second stop comes 60 s later and the few real seconds its turn takes.
8. **A reply is waited for 30 s in AC2 and AC3, then the scenario goes on.** On a hub that replies when the fast lane
   ends, the reply is in long before; on the base it never comes while the slot is held, and those tests must reach
   their own criterion's failure. A reply that comes with its line after the 30 s is BLOCKED in AC3, where the order
   of the stops depends on it.
9. **"No run starts on its first snapshot" needs an event to read it at.** AC2 uses two: the first run to start when
   the slot frees, and the start of a journey queued after the second session's place. A run handed to `admit`
   asks for its slot every 50 ms, so it has started long before a later stop's fast lane can end.
10. **20 runs on one hub, in one test.** The same four sessions make every run, each with a new turn and a new
    snapshot. A hub a run costs minutes on a loaded machine, and one test that needs all 20 in order is harder to
    pass by chance than four tests of five. If the runs don't fit 60 minutes the test is BLOCKED, naming how many it
    made; it never passes on fewer. Splitting them, never to fewer than 20, is a redraft's.
11. **"Each with one slow check."** Each of the three stops has its journey as its one slow check, beside the 2 s
    check that makes the stop green.
12. **AC4's command line.** The criterion writes `node docs/spikes/3539/reply-hold.mjs --runs 20`; at the base the
    script refuses that (exit 2, its usage asks for `--out <file>`). The test runs the criterion's command with the
    base's `--out`, into a temporary folder, so it needs no new flag or default and writes nothing into the checkout.
    Nothing is asserted of a run without `--out`.
13. **"(0 of 20, and 0 of 20)"** is read as #3539's result has it: a stop's `turnEnded` had returned while its check
    waited in 0 of 20 runs, and the four runs started in the order they asked in 0 of 20. The merge base's kept
    output must read 0 for both stops and for the order.
14. **"The order they asked"** is the order the issue's table gives, `other:first`, `other:second`, `person:first`,
    `person:second`. The script's own `asked_in_order` is not read: with the fix a run asks for its slot only when
    one is free.
15. **AC5 runs the two suites.** Other suites hold a criterion of this shape with no test, the named suites being the
    proof. Then the trace lane lists the criterion open and the change can only say `Part of`. This suite takes the
    other way, a tagged test that holds the two folders to the merge base's bytes and runs them, at the cost of
    running about 30 hub tests a second time whenever this folder runs. Only the two folders are held to the merge
    base's bytes, not the helpers they import from other suites.

## Not asserted

- How long any reply takes, in ms; `stop.held`'s split (`queue_wait`, `slow`); the first session's line.
- The pump's count of the slots slow runs may hold, and `turnEnded` itself, other than through what a session and the
  record show and through AC4's script.
- The line once the queued journey starts, the verdict when it lands, and stale results.
- A held place (a loop's, or background work's) that also waits for a slot; `on_base: fails` checks taking slots
  first; a pool of other than two slots; an observed Codex stop and its 45 minutes; places across a hub restart.
- The slot kept for a held stop's quick checks and the 30-minute limit, beyond #907's and #965's own suites (AC5).
- Whether `reason` or `started_by` of a place that waited for a slot say anything in particular.
- Anything of `reply-hold.mjs`'s output but the fields named above; each run's `events` are not read.

## What this job could not do

No hub was started: the checkout had no build, and none came while the job ran. So `reply.test.ts`,
`replaced.test.ts`, `order.test.ts` and `unchanged.test.ts` have never run, on the base or anywhere, and what they do
on the base is read from the base's code, not seen (`BASE-FAILURE.txt`). Untried with them: several sessions on one
hub, each in a copy of the repository; a journey ended by a file written into its run's folder; and every expected
value, against a running fix. What was run: the type check, `node --check` on the two plain scripts,
`reply-hold.test.mjs` at the base, the world's repositories and checks with no hub (the unit check passes, the journey
runs until its file appears), the wait ratchet's reading of the folder, and each function that decides a criterion
from plain data (`readings.ts`'s `outOfTurn` and `notReplaced`, `reply-hold-reading.mjs`'s `problems`) against a
well-formed input and the wrong one its criterion names.
