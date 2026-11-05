# Acceptance tests for #907: a check slot a held stop's quick checks can always take, and background work holds slow checks at most 30 minutes

Written first, blind, by a job that never saw an implementation of #907; none existed. The implementing agent doesn't edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- Issue #907 as of 2026-11-01T05:07:06Z: its two problems, Scope, the three acceptance criteria, Proof and Depends on.
- `docs/technical-design.md`: An agent says it's done (Fast and slow lanes, Held time is counted, Slow runs start when the
  turn ends, A loop's turn end isn't a hand-back, Latest snapshot wins), Lease (#237), the Concurrent runs threat row,
  What each agent gives us (prompt origins and loop facts), and Dogfooding. The design holds nothing yet of the kept slot
  or the 30-minute limit; the issue is the source for both.
- At the base (`2f43a669`): `packages/hub/src/gate-runner.ts` (`stop`, `turnEnded`, admission from `slots().free`),
  `packages/hub/src/core.ts` (the gate runner's `slots`, `launch` taking each run's `cpu.slot` through `slot()` with no
  lane, `runStart`, `enrich`, `loopAt`), `packages/hub/src/hookmap.ts` (`loopFact`), `packages/hub/src/wire.ts`
  (`HookMeta.loop`), `packages/hub/src/plant.ts`, `adapters/loops.facts.json`, `adapters/claude-code.facts.json` (prompt
  origins: `turnOrigin: task_notification` is `subagent`), the corpus's background `Bash` call
  (`adapters/corpus/claude-code/2.1.304/crash`) and task notification (`…/child-gates`), `packages/gate/src/exec.ts`
  (`slot`, `runHeavy`) and `scheduler.ts` (`simulate`, `LoopFacts`, held places), `packages/leases/src/index.ts` (the
  `cpu.slot` pool), `packages/record/src/projections.ts` (the `runs` table), and the blind suites `tests/acceptance/29`
  (lanes, loops, slots, held; helpers `helpers.ts`, `h-c.ts`, `h-d.ts`), `tests/acceptance/18/mapping` (loops, helpers),
  `tests/acceptance/237` and `tests/acceptance/411` for format.

What the base does: `openLeases` declares `cpu.slot` as a plain `pool(n)`: any holder takes any of its n slots, and
`slot()` and `runHeavy` take theirs the same way. The gate runner admits a check only when `slots().free` is above zero,
where the core's `slots` is half the cores less the check runs holding a slot, so with every slot held a 3 s typecheck
goes to the slow lane. `loopFact` reads `Agent`/`Task` with `run_in_background` and nothing else, so a background `Bash`
leaves the stop's `data.loop` unset. `simulate` holds slow checks only for a loop by prompt origin or by the wake-up,
heartbeat, cron and subagent facts, with no limit; it reads no background command.

## Run them

```sh
npm ci                            # once, if node_modules is missing
npm run build --workspaces        # slots.test.ts and background.test.ts start `deep hub run` from packages/cli/dist
cargo build --locked -p deep-hook # background.test.ts drives a session through deep-hook (its helper builds it if missing)
node node_modules/vitest/vitest.mjs run tests/acceptance/907/limit.test.ts
node node_modules/vitest/vitest.mjs run tests/acceptance/907/background.test.ts
node node_modules/vitest/vitest.mjs run tests/acceptance/907/slots.test.ts
node node_modules/typescript/bin/tsc -p tests/acceptance/907/tsconfig.json
```

Use the repo's Node (`.node-version`, 24.22.0). `limit.test.ts` is pure (under a second). `background.test.ts` (about
10 s) and `slots.test.ts` (about 25 s) start hubs and real processes, and `slots.test.ts` times a start to 1 s, so both
belong on the one-at-a-time line: `scripts/lanes.mjs` needs `'tests/acceptance/907/slots.test.ts'` and
`'tests/acceptance/907/background.test.ts'` added to its `alone` list beside `tests/acceptance/29/slots.test.ts`. This
README is the instruction; the implementer makes that edit. Nothing needs the network, a real `claude`, a sign-in or a
model call. Folders are under `/tmp/dh907-*`, `/tmp/dh29-*` and `/tmp/dh18m-*` and are removed after each file; every
process a test starts is stopped by its PID (or ends on its go file), never by name or port.

## Criteria to tests

Each test's name starts with its criterion's ID and tag (`#907.<first 8 hex of the SHA-256 of the criterion's text>`, as
`scripts/proof-change.mjs` computes it). Each criterion's wrong program runs through the same assertions and must fail
them, naming what the criterion says.

| ID | File | Tests |
|---|---|---|
| AC1 `#907.64d1cf68` | `slots.test.ts` | the criterion's scenario on the gate runner and lease table; its wrong program (`openLeases` plant `fills-every-slot`); the same through the hub; its wrong program (`DEEP_HUB_PLANT=fills-every-slot`) |
| AC2 `#907.707637ee` | `background.test.ts` | the recorded session's loop readings through deep-hook and the hub; its wrong program (`DEEP_HUB_PLANT=background-subagents-only`); the journey's hold in the scheduler; its wrong program (the facts an adapter counting only subagents gives) |
| AC3 `#907.9d0dd243` | `limit.test.ts` | 30 minutes from a stop, the row naming the command; a stop 20 minutes later gets 30 of its own; its wrong program (`simulate` plant `holds-background-without-limit`) |

### AC1, `slots.test.ts`

1. **The criterion's scenario.** The real record and the real lease table opened at 4 cores, so the core's `cpu.slot`
   pool is 2 ("check slots at 2"). The record holds three clean runs of `typecheck` at 3 s and of `journey:checkout` at
   300 s, so the gate runner's expected times are those. The hub's real `GateRunner` (`packages/hub/src/gate-runner.ts`)
   runs over it with the host's side done as the core's `launch` does it: a run's `cpu.slot` lease is taken first with
   `slot(table, <claim's session>, run, lane)` (the lane the gate runner hands `start`), then its process starts, and the
   lease is released when it ends; `slots` is the core's own reading at the base, half the cores (2) less the check runs
   holding a slot. Two sessions' green stops put their journey in the slow lane and `turnEnded` queues it; the agent's
   e2e is `runHeavy` on the same table. Then a third session's stop with its typecheck: the test asserts the typecheck
   is in the stop's `fast` list, ran as a fast-lane run, started (its own process's stamp) within 1000 ms of `stopAt`,
   and that the two journeys and the e2e never held more than 1 of the 2 leases at once (sampled every 15 ms from the
   table). The wrong program is the same with `openLeases({ …, plant: 'fills-every-slot' })`; it must fail, naming
   `typecheck`.
2. **Through the hub.** `deep hub run` (its pool is half this machine's cores, P). P `run.start` calls with
   `lane: 'slow'` for `journey:checkout`, each a process waiting on a go file, then one `run.start` with `lane: 'fast'`
   for `typecheck`: its `run.started` must come within 1000 ms, and at most P − 1 of the slow runs may have started. The
   wrong program is the same hub with `DEEP_HUB_PLANT=fills-every-slot`; it must fail, naming `typecheck`.

### AC2, `background.test.ts`

1. **The reading.** A Claude Code session through the real deep-hook into `deep hub run`, as #18's AC24 drives one: you
   ask (a question that opens no task, so nothing holds its stop) for the e2e suite in the background; the agent runs
   `Bash` `npm run lint` in the foreground and `Bash` `{ command: 'npm run e2e', run_in_background: true }` (its response
   carries `backgroundTaskId`), and stops. Then the command's end notice arrives as an automatic prompt: a transcript
   entry with `turnOrigin: task_notification` and a `<task-notification>` naming the task, the call's `tool_use_id`,
   `completed` and `Background command "npm run e2e" completed (exit code 0)`, as Claude Code queues one; the agent stops
   again. The first stop's `agent.stop` must read `data.loop.state` `looping`; the second's `none_left` (the foreground
   `npm run lint` never counted). The prompts' origins are `person`, then `subagent`. The wrong program,
   `DEEP_HUB_PLANT=background-subagents-only`, must fail, naming the call (`Bash \`npm run e2e\`` and its ID).
2. **The hold.** `simulate` on its virtual clock with the same session: a `human` prompt, a `facts` event
   `{ background: ['npm run e2e'] }`, a green stop at 2 s (unit 2 s in the fast lane, the 300 s journey in the slow), the
   end notice at 122 s (a `subagent` prompt, then `{ background: [] }`), an edit and a green stop at 125 s. No journey may
   start before 122 s; the first stop's held place never starts and is replaced by `S2`; the journey starts on `S2` when
   that stop's fast lane ends (127 s). The wrong program is the same session with the two `facts` events left out, which
   is what an adapter counting only subagents reports; the journey then starts at once and the test must fail, naming
   the call.

### AC3, `limit.test.ts`

`simulate` on its virtual clock (a tick is a millisecond), the default config but `slots: 2`:

1. A green stop at 2 s with `{ background: ['npm run e2e'] }` and no end notice ever: no journey starts before 30 minutes
   from the stop; it starts at 30 minutes from the stop, counted from the Stop hook's request or from the reply (the
   test accepts any start in `[at + 30 min, reply_at + 30 min]`; here 1,802,000 to 1,804,000 ms); its `held` record's
   `started_at` is that time and its `reason` names `npm run e2e`.
2. The same first stop; the end notice at 18 minutes (`subagent` prompt, `{ background: [] }`); the agent edits, reruns
   `npm run e2e` in the background (`{ background: ['npm run e2e'] }` at 19 minutes) and stops green at 20 minutes after
   the first stop (1,202,000 ms). The first snapshot's journey never starts, its held place goes to `S2`, nothing starts
   at 30 minutes from the first stop, and the journey starts on `S2` 30 minutes from the second stop, its row naming
   `npm run e2e`.
3. The wrong program, `simulate(…, { plant: 'holds-background-without-limit' })`, leaves the journey pending past 30
   minutes; it must fail, naming `journey:checkout` and "pending past 30 minutes".

## Surfaces and plants the implementation must provide

None exists at the base; each is the smallest the criteria need.

- **`slot(table, holder, run, lane)`** in `@deepbuild/gate` (`packages/gate/src/exec.ts`): a fourth argument,
  `'fast' | 'slow'`. Of the `cpu.slot` pool's n slots, leases that are not `'fast'` (slow-lane runs, and `runHeavy`'s
  heavy commands, which never pass `'fast'`) hold at most n − 1 at once; a `'fast'` lease may take any free slot, the
  kept one included, and when slots free, a waiting `'fast'` lease gets one before any waiting slow run or heavy command.
  The core's `launch` passes each run's lane, so a `run.start` with `lane: 'fast'` (the path the gate runner's fast-lane
  runs take: `runApproved` → `runStart` → `launch`) is a held stop's fast-lane check here.
- **The gate runner's `GateOptions` stay as at the base** (`raw`, `now`, `append`, `core`, `start`, `ended`, `slots`,
  `budget_ms`, `hold_ms`); this suite constructs `GateRunner` with them and `slots` as the core computes it at the base.
  A runner may read more than `slots` (the design's expected wait for a slot), but must still admit the scenario's
  typecheck when the kept slot is free.
- **Plant `fills-every-slot`**: `openLeases({ …, plant: 'fills-every-slot' })` (a `Plant` of `@deepbuild/leases`) and
  `DEEP_HUB_PLANT=fills-every-slot` (a hub `Plant`, which hands it to the core's `openLeases`): the pool keeps no slot
  for the fast lane, so slow-lane runs and heavy commands may hold all n, as at the base.
- **Loop facts for background shell commands**: `adapters/loops.facts.json` (and `loopFact`/`loopAt`) count Claude Code
  `Bash` with `tool_input.run_in_background: true`, so a stop with one still running reads `data.loop.state: 'looping'`
  until its end notice arrives as an automatic prompt (the hub maps the notice's prompt `from: 'subagent'`). This suite
  asserts only `state`; `due` is left open.
- **Plant `background-subagents-only`**: `DEEP_HUB_PLANT=background-subagents-only` reads loop facts as the base does,
  counting only background subagents.
- **`LoopFacts.background: string[]`** in `@deepbuild/gate`'s scheduler: the background commands (and subagents) the
  session started that still run, each as the row names it (`npm run e2e`); set by a `facts` event or
  `SessionScript.facts`, default `[]`. At a green stop whose reply ends the turn, a non-empty `background` holds each
  slow check in its queued place, whatever started the turn, until the facts empty it (or, as for any loop, a claim or
  your words), and for at most 30 minutes from that stop; then the check starts. A newer stop that takes the held place
  starts its own 30 minutes. The held record's `reason` names each command still running.
- **Plant `holds-background-without-limit`**: a `SchedulerPlant` with which background work holds slow checks with no
  limit.

## Open points (choices the issue leaves open; the tests assert the least they can)

1. **"Two slow journeys running" with check slots at 2.** With one of the 2 slots kept for the fast lane, two slow
   journeys can't both hold a slot; the tests read the phrase as two slow journeys started (one runs, one waits beside
   the e2e) and assert only that at least one runs and that the slow work holds at most 1 slot. Under the wrong program
   both run, as the issue describes.
2. **"Within 1 s of the stop"** counts from the gate runner's `stopAt` to the typecheck process's own first line, so the
   claim's snapshot and checkout are inside the second (about 0.3 s uncontended on this Mac).
3. **"The row".** The scheduler's `held` record for the check on that snapshot (`reason`, `started_at`); the stop's line
   and the hub's session row are not asserted.
4. **30 minutes from the stop.** Counted from the Stop hook's request or from the reply; both are accepted.
5. **The 30 minutes is not a config key**; the tests use the scheduler's defaults.
6. **The hub reading and the scheduler's hold are tested apart.** At the base the hub's gate runner applies no loop
   hold at all (`core.ts` calls `turnEnded` at every green stop whose reply ends the turn; loops live only in
   `simulate`), so AC2's "the journey waits" and AC3 are proven in the scheduler, given the facts the hub reads. That the
   hub's runs follow the scheduler's hold is not proven by this suite (a follow-up beside #29, not an AC of #907).
7. **Not covered**: the end of a background command by its process group ending, the matching tool of an agent other
   than Claude Code (the facts name only `claude`), a hung background subagent's 30 minutes, "a fast-lane check takes
   the next free slot ahead of every queued slow run" apart from the kept slot, and "DeepBuild never stops those
   processes". The criteria don't ask for them.
