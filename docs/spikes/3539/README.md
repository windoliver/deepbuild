# #3539: what a session with a person at it waits behind other sessions' slow checks

The slow lane starts queued checks in the order they were placed, and nothing reads who is waiting. This folder runs
scripted sessions through the gate package's scheduler (`simulate`, `packages/gate/src/scheduler.ts`) on its virtual
clock: one session whose turns a person opened, alone and beside 1, 3 and 6 sessions whose turns nobody typed, each
stop queuing slow checks of 1, 5 and 20 minutes, on pools of 2, 4 and 9 slots. It reads the person's wait for a slot
and time to a verdict under today's order and under one changed order, places whose turn a person opened first and
then as today. It then runs one script through the hub's own gate runner and the package's, and names every place
that starts at a different time. It changes no code on main. The proof is `tests/acceptance/3539/`, written blind
from the issue before this spike.

**The answer.** The order matters only where slots are short, and there it matters a lot.

- On 9 slots nothing waits: the person's median and 95th percentile wait are 0 beside 1, 3 and 6 others.
- On 4 slots the person's median wait is 0 beside 1 and 3 others. Beside 6 it is 307 s, and 903 s at the 95th
  percentile. With the person's places first that is 149 s and 381 s, and the others' median wait goes from 278 s to
  296 s.
- On 2 slots, 3 others already ask for more than the pool can run. The person's places wait 1,531 s at the median, 9
  of 69 never start because the person's next stop takes their place first, and 3 of 23 stops get no verdict. Beside 6
  others, 48 of 69 never start and 18 of 23 stops get no verdict. With the person's places first all 69 start, at a
  median wait near 310 s, and every stop gets its verdict. The others pay: beside 6, their places that start fall
  from 248 to 189 of 360.
- The hub doesn't run the package's order, and what a person waits for there is the stop itself. `turnEnded` returns
  only once the checks its pump took have a slot, and `stop-reply.ts` awaits it before the reply. On the one script,
  the person's second green stop would get its reply 1,305 s after it stopped; in the package it replies at once. 12
  of that script's 15 places start at a different time.

What follows from this is in [What follows](#what-follows): #3562 and #3563 are filed.

## Files

- `harness.mjs`: the harness. `node docs/spikes/3539/harness.mjs --script <file> --order <today|person-first|hub>
  --out <file> [--plant <name>]` runs one script under one order and writes its places and green stops. Its header
  says what each flag does.
- `package.mjs`: a script through `simulate`, and the `Trace` read as rows. `person-first.patch`: the changed order,
  a diff to `packages/gate/src/scheduler.ts` that `load.mjs` applies to a copy in memory, so nothing under `packages/`
  is written. `git apply --check docs/spikes/3539/person-first.patch` shows it still applies.
- `hub.mjs`: a script through the hub's `GateRunner` on a virtual clock. Its header says what stands in for the host.
- `load.mjs`: this checkout's packages loaded from their TypeScript sources, as `scripts/lifecycle-sim.mjs` loads the
  record, so no run reads a stale build.
- `scripts.mjs`: the scripts, seeded. `run.mjs`: makes each script and runs the harness on it. `scripts/`: each script
  as it was run. `out/`: each run's output as `harness.mjs` wrote it, and `reply-hold.json`.
- `analyze.mjs`: works out `record.json` and this file's tables from `scripts/` and `out/` alone.
- `reply-hold.mjs`: the hub's gate runner with the real lease table and the gate package's `admit`, to read when
  `turnEnded` returns while slow checks wait for a slot.
- `record.json`: the table (`table`), the runs it is worked out from (`runs`), the script in which the person never
  stops (`neverStops`), the one script under both orders (`orders`), each kept file by its sha256, and the
  follow-up (`followUp`), which `analyze.mjs` takes from `tasks.json`.

## How to run

From the repository root, with Node 24.22 first on `PATH`, after `npm ci`. The packages' sources read two files a
build writes. `npm run build --workspaces` makes them; so do these two commands, which compile nothing:

```sh
(cd packages/evidence && node build-patterns.mjs)
node --import ./docs/spikes/3539/load.mjs packages/record/build-versions.mjs
```

Then:

```sh
node docs/spikes/3539/run.mjs                                      # scripts/ and out/: 28 runs, about 40 s
node docs/spikes/3539/reply-hold.mjs --runs 20 --out docs/spikes/3539/out/reply-hold.json
node docs/spikes/3539/analyze.mjs                                  # record.json and the tables below
```

Every run but `reply-hold.mjs` is on a virtual clock, so it gives the same rows on any machine. `reply-hold.mjs`
reads no clock either: it reads the order things happened in, and which waiting run gets a freed slot there can
differ from run to run and from machine to machine.

## What a time is

Every time is on the script's virtual clock, in ms in the kept files and in seconds below.

- A **place** is a session's slow check on one snapshot. It takes its place in the queue at its green stop's reply.
  A green stop is one whose reply ends the turn. No check here fits the fast lane, so a stop replies at its own time.
- A place's **wait for a slot** is its run's start less the time it took its place. A place that never starts has no
  wait and is counted apart: its session's next stop took its place before a slot came, as Latest snapshot wins says.
- A stop's **time to a verdict** is the end of the last run its claim's checks rest on, less the stop's time. A stop
  whose claim still reads pending when the script ends has none and is counted apart.
- The median and the 95th percentile are by nearest rank: the smallest sample with at least that share of the samples
  at or below it.

## The scripts

Each session is a list of turns: a prompt, then the green stop that ends it. Every stop changes every check's inputs,
so it queues all three checks. Each check takes the time it was drafted at and passes.

- **The person's session** (`person`): each prompt has origin `human`. The agent works 3 to 12 minutes to its stop,
  and the next prompt comes 25 to 45 minutes after it. 23 stops in 16 hours, one every 43 minutes on average.
- **A session nobody types in** (`other-1` to `other-6`): each prompt has origin `scheduled`. The agent works 5 to 25
  minutes, and the next prompt comes 25 to 45 minutes after the stop. 19 to 21 stops each, one every 49 minutes.

The times are drawn evenly from those ranges, to the second, from a fixed seed. The person's session is the same in
every script. The cadence is drafted, like the checks' times: a stop queues 26 slot-minutes of checks, so the person
asks for 0.6 of a slot and each other for 0.5. Beside 1, 3 and 6 others that is 1.1, 2.2 and 3.8 slots, against
pools of 2, 4 and 9. The scripts don't react: a session's next prompt comes when the script says, whether or not its
verdict has landed. `scheduled` is used because both the package and the hub start such a session's checks at its
stop when no wake-up or cron job is due.

**The changed order.** A place is a person's when the prompt that opened its stop's turn has origin `human`.
`person-first.patch` adds that as the first sort key of the scheduler's `dispatch`: a person's ready places first,
then `on_base: fails` first, then by the time they queued, then by number, as today. A run going is never stopped.
The prompts of the app and of an answer are left as today.

## The table

For each count of others and each pool, under each order: the person's session's wait for a slot, alone and beside
the others, with how many of its 69 places started; the other sessions' waits; and the longest wait of any place that
started.

<!-- waits -->
| Order | Others | Pool | Wait p50 alone s | Wait p95 alone s | Wait p50 beside s | Wait p95 beside s | Places started beside | Others wait p50 s | Others wait p95 s | Others started | Longest wait s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `today` | 1 | 2 | 0 | 60 | 60 | 360 | 69 of 69 | 60 | 475 | 60 of 60 | 635 |
| `person-first` | 1 | 2 | 0 | 60 | 35 | 360 | 69 of 69 | 60 | 475 | 60 of 60 | 582 |
| `today` | 3 | 2 | 0 | 60 | 1531 | 2461 | 60 of 69 | 1734 | 2624 | 175 of 180 | 2946 |
| `person-first` | 3 | 2 | 0 | 60 | 317 | 861 | 69 of 69 | 1717 | 2751 | 173 of 180 | 3130 |
| `today` | 6 | 2 | 0 | 60 | 2589 | 3241 | 21 of 69 | 2510 | 3290 | 248 of 360 | 4685 |
| `person-first` | 6 | 2 | 0 | 60 | 306 | 760 | 69 of 69 | 2623 | 3474 | 189 of 360 | 4565 |
| `today` | 1 | 4 | 0 | 0 | 0 | 0 | 69 of 69 | 0 | 60 | 60 of 60 | 60 |
| `person-first` | 1 | 4 | 0 | 0 | 0 | 0 | 69 of 69 | 0 | 60 | 60 of 60 | 60 |
| `today` | 3 | 4 | 0 | 0 | 0 | 206 | 69 of 69 | 0 | 115 | 180 of 180 | 363 |
| `person-first` | 3 | 4 | 0 | 0 | 0 | 206 | 69 of 69 | 0 | 115 | 180 of 180 | 363 |
| `today` | 6 | 4 | 0 | 0 | 307 | 903 | 69 of 69 | 278 | 758 | 360 of 360 | 1071 |
| `person-first` | 6 | 4 | 0 | 0 | 149 | 381 | 69 of 69 | 296 | 847 | 360 of 360 | 1216 |
| `today` | 1 | 9 | 0 | 0 | 0 | 0 | 69 of 69 | 0 | 0 | 60 of 60 | 0 |
| `person-first` | 1 | 9 | 0 | 0 | 0 | 0 | 69 of 69 | 0 | 0 | 60 of 60 | 0 |
| `today` | 3 | 9 | 0 | 0 | 0 | 0 | 69 of 69 | 0 | 0 | 180 of 180 | 0 |
| `person-first` | 3 | 9 | 0 | 0 | 0 | 0 | 69 of 69 | 0 | 0 | 180 of 180 | 0 |
| `today` | 6 | 9 | 0 | 0 | 0 | 0 | 69 of 69 | 0 | 0 | 360 of 360 | 33 |
| `person-first` | 6 | 9 | 0 | 0 | 0 | 0 | 69 of 69 | 0 | 0 | 360 of 360 | 33 |
<!-- /waits -->

The person's session's time to a verdict, alone and beside the others, with how many of its 23 stops got one.

<!-- verdicts -->
| Order | Others | Pool | Verdict p50 alone s | Verdict p95 alone s | Verdict p50 beside s | Verdict p95 beside s | Stops with a verdict beside |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `today` | 1 | 2 | 1260 | 1260 | 1260 | 1782 | 23 of 23 |
| `person-first` | 1 | 2 | 1260 | 1260 | 1260 | 1560 | 23 of 23 |
| `today` | 3 | 2 | 1260 | 1260 | 2889 | 3748 | 20 of 23 |
| `person-first` | 3 | 2 | 1260 | 1260 | 1717 | 2102 | 23 of 23 |
| `today` | 6 | 2 | 1260 | 1260 | 3662 | 4741 | 5 of 23 |
| `person-first` | 6 | 2 | 1260 | 1260 | 1771 | 2102 | 23 of 23 |
| `today` | 1 | 4 | 1200 | 1200 | 1200 | 1260 | 23 of 23 |
| `person-first` | 1 | 4 | 1200 | 1200 | 1200 | 1260 | 23 of 23 |
| `today` | 3 | 4 | 1200 | 1200 | 1200 | 1428 | 23 of 23 |
| `person-first` | 3 | 4 | 1200 | 1200 | 1200 | 1428 | 23 of 23 |
| `today` | 6 | 4 | 1200 | 1200 | 1621 | 2130 | 23 of 23 |
| `person-first` | 6 | 4 | 1200 | 1200 | 1455 | 1698 | 23 of 23 |
| `today` | 1 | 9 | 1200 | 1200 | 1200 | 1200 | 23 of 23 |
| `person-first` | 1 | 9 | 1200 | 1200 | 1200 | 1200 | 23 of 23 |
| `today` | 3 | 9 | 1200 | 1200 | 1200 | 1200 | 23 of 23 |
| `person-first` | 3 | 9 | 1200 | 1200 | 1200 | 1200 | 23 of 23 |
| `today` | 6 | 9 | 1200 | 1200 | 1200 | 1200 | 23 of 23 |
| `person-first` | 6 | 9 | 1200 | 1200 | 1200 | 1200 | 23 of 23 |
<!-- /verdicts -->

- **Alone**, the person waits for nothing on 4 and 9 slots. On 2 slots the 20-minute check waits 60 s for the
  1-minute check's slot, so the verdict lands at 1,260 s.
- **9 slots.** No place of the person's waits beside 6 others. The longest wait of any place is 33 s.
- **4 slots.** Beside 1 and 3 others the person's median wait is 0. Beside 6 it is 307 s and the verdict lands 421 s
  later than alone at the median. The changed order halves the wait (149 s) and takes 166 s off the verdict. The
  others' median wait rises 18 s and their 95th percentile 89 s; the longest wait of any place rises from 1,071 s to
  1,216 s.
- **2 slots.** Beside 1 other the median wait is 60 s under today's order and 35 s under the changed one. Beside 3
  and 6 the sessions ask for more than two slots
  can run, so the queue never empties and a place leaves it when its session stops again. Under today's order the
  person's places stand in that line like any other: beside 6, 21 of 69 start and 5 of 23 stops get a verdict. Under
  the changed order a person's place waits only for a run going to end, 306 s at the median. The others lose what
  the person gains: 59 fewer of their places start beside 6 others, and 2 fewer beside 3.

## The script in which the person's session never stops

`scripts/never-stops.json` is the script of 6 others on 2 slots with the person's session cut to its first prompt:
the person opens a turn and never stops, so no place is the person's. 360 places take the queue, 259 of them wait,
and 120 stops are green. `out/never-stops.today.json` and `out/never-stops.person-first.json` hold the same rows,
place for place and stop for stop: with no place of a person's to take first, the changed order is today's.

The harness's twin `--plant reports-a-gain` takes the first session that stops for the person's, whoever opened its
turns. On this script it starts `other-1`'s places first under `person-first` and so reports a gain where there is
none. The acceptance suite runs it and fails it, naming the script.

## The pool held full

The acceptance suite holds a pool full itself: its script gives `foreign`, the slots others hold, both slots of a
pool of 2 until an hour in, while a person's session stops at 60 s. The harness reads each of the three checks as
queued at 60 s and started no earlier than 3,600 s. Its twin `--plant times-from-start` reads the runs alone and never
the queue, so each place is queued when it starts and every wait is 0; the suite fails it, naming each check.

## The hub's order and the package's

`scripts/orders.json` is one script on 4 slots, made so that each rule the two differ by is met once:

- `other-1` (`scheduled`) stops at 5 s and fills three slots.
- `person` stops at 45 s, and again at 200 s while its first stop's 20-minute check still waits.
- `other-3` opens its turn by a `continuation`, lists its checks longest first, and stops at 50 s.
- `other-2` (`scheduled`) works on a fix, so its 5-minute check is `on_base: fails`; it stops at 60 s.

The package's starts are `simulate`'s (`out/orders.today.json`). The hub's are the hub's own `GateRunner`'s
(`out/orders.hub.json`): its `stop`, `turnEnded`, queue and `pump`, loaded from source and driven on the same clock.
What stands in is the host. It follows `core.ts` and `runs.ts`: `slots()` is the pool less the runs that hold a slot;
a slow run's `start` returns once it has a slot, and slow runs hold at most 3 of the 4; a run ends after its check's
drafted time. One thing is kinder than the hub: the real host polls the lease table, so a freed slot goes to
whichever waiting run asks next (below), and here it goes to the run that asked first.

12 of the 15 places start at a different time. Each is here with when it was queued and when the hub's pump handed
it to the host:

<!-- starts -->
| Session | Check | Snapshot | Queued s | Package start s | Hub handed s | Hub start s |
| --- | --- | --- | --- | --- | --- | --- |
| `person` | `check-1m` | `person-01` | 45 | 45 | 45 | 65 |
| `person` | `check-5m` | `person-01` | 45 | 105 | 45 | 125 |
| `person` | `check-20m` | `person-01` | 45 | - | 50 | 305 |
| `other-3` | `check-1m` | `other-3-01` | 50 | 405 | 125 | 1205 |
| `other-3` | `check-5m` | `other-3-01` | 50 | 365 | 200 | 1265 |
| `other-3` | `check-20m` | `other-3-01` | 50 | 305 | 200 | 1505 |
| `other-2` | `check-5m` | `other-2-01` | 60 | 65 | 60 | 425 |
| `other-2` | `check-1m` | `other-2-01` | 60 | 465 | 65 | 725 |
| `other-2` | `check-20m` | `other-2-01` | 60 | 525 | 110 | 785 |
| `person` | `check-1m` | `person-02` | 200 | 665 | 305 | 1565 |
| `person` | `check-5m` | `person-02` | 200 | 725 | 425 | 1625 |
| `person` | `check-20m` | `person-02` | 200 | 1025 | 785 | 1985 |
<!-- /starts -->

Why they differ:

1. **The hub keeps a slot back.** Slow runs hold at most all but one slot of a pool (`packages/leases/src/index.ts`,
   `SLOW_SLOT`, #907). The package's `dispatch` gives a slow place any free slot. So `person`'s 1-minute check
   starts at 45 s in the package, on the fourth slot, and at 65 s in the hub, when `other-1`'s 1-minute check ends.
2. **A place handed to the host is no longer in the queue.** The pump takes a place out of the queue before its run
   has a slot. `person`'s 20-minute check on `person-01` was handed over at 50 s. When `person` stopped again at
   200 s there was no queued place for the newer snapshot to take, so the hub ran the outdated snapshot for 20 minutes
   from 305 s. In the package the newer snapshot takes the place and the old one never starts.
3. **`on_base: fails` first.** The package starts `other-2`'s fix check at 65 s, ahead of the five places queued
   before it. The hub's queue is a `Map` walked in the order places were set, so the fix check starts at 425 s,
   in its turn. Once it passes, the hub runs it again on the merge base from 1,925 s to 2,225 s, on a slot `simulate`
   never counts.
4. **A continuation.** The hub counts a `continuation` among the prompts no fact foresees and holds `other-3`'s
   checks for the 60 s grace window; the package holds only `session` and `unknown` that way and queues them at the
   stop. The hub then places a stop's checks shortest first, the package in the definition's order: `other-3`'s
   start 20, 5, 1 minutes in the package and 1, 5, 20 in the hub.
5. **Everything behind them.** The rest start later in the hub because three slots, an outdated 20-minute run and a
   base run are ahead of them.

**The reply.** In the package a green stop replies when its fast lane ends, whatever the slow lane holds. In the hub
`turnEnded` awaits its pump (`packages/hub/src/gate-runner.ts:1156`), the pump awaits each run it took until that run
has started (`:1344`), and a run starts once it has a slot (`packages/hub/src/runs.ts:340`). `slots()` counts only
runs that hold a slot (`packages/hub/src/core.ts:509`), and slow runs never hold the last one, so the pump always
finds one free, takes the next place and waits. `stop-reply.ts:168` awaits `turnEnded` before it returns the reply.
On the one script:

<!-- replies -->
| Stop | Turn opened by | Stop at s | Hub `turnEnded` returned s | After the stop s |
| --- | --- | --- | --- | --- |
| `other-1#1` | `scheduled` | 5 | 5 | 0 |
| `person#1` | `human` | 45 | 125 | 80 |
| `other-3#1` | `continuation` | 50 | 305 | 255 |
| `other-2#1` | `scheduled` | 60 | 425 | 365 |
| `person#2` | `human` | 200 | 1505 | 1305 |
<!-- /replies -->

`reply-hold.mjs` reads the same on the real lease table, opened at 4 cores, with the gate package's `admit` taking
each run's slot (`out/reply-hold.json`, 20 runs). A session nobody types in stops with two slow checks; one starts
and one waits. In none of the 20 runs had its `turnEnded` returned once the table had refused the waiting run three
times; in all 20 it returned when that run started. A person's session then stopped with two slow checks, and in all
20 its `turnEnded` returned only when the second of them started.

The four runs asked for a slot in the order `other:first`, `other:second`, `person:first`, `person:second`. In all
20 runs they started `other:first`, `person:first`, `other:second`, `person:second`: the freed slot went to the run
that asked third, ahead of the one that asked second. `admit` asks again after a wait that doubles from 5 to 50 ms
(`packages/gate/src/exec.ts:108`), so the longer a run has waited, the less often it asks. Which run wins is a matter
of timing: an earlier single run of this script, with shorter waits, started them in the order they asked.

What a session sees of this was not run: no hub process was started and no Stop hook was held. The hook's own
timeout bounds it. Setup needs Claude Code's to be at least 65 s (`packages/hub/src/claude-settings.ts`) and sets
Codex's to 45 minutes (`packages/hub/src/codex-settings.ts:19`).

## The record's reading

There is no record to read the same from. The dogfood week (#43) has not run, and this machine's `~/.deepbuild` holds
no hub record. The record already has what the reading needs: a slow check's `run.started`, its stop's reply, and
the `from` of the `user.ask` that opened the turn.

## What follows

Two tasks are filed.

- **#3563, the slow lane starts a person's places first.** What the table justifies: no cost where slots are free,
  and a person's wait cut from 307 s to 149 s on 4 slots beside 6 others, and from 1,531 s to 317 s on 2 slots
  beside 3. It is this spike's follow-up, with six criteria of its own (`tasks.json`).
- **#3562, a green stop's reply doesn't wait for a slot.** What the one script and `reply-hold.mjs` found on the way.
  It comes first, and #3563 depends on it: while the reply waits for a slot, the order the places start in can't
  help the person.
