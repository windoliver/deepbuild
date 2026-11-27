# 0004: The gate's lanes, holds and slots

Status: accepted. Moved from comments in `packages/gate` by #3454's first pass ([0001](0001-code-carries-no-comments.md)). The design states the rules these serve under Fast and slow lanes, Stale results stay stale, Concurrent runs and Stalled claims; the decisions below are the ones written nowhere else.

## The scheduler

- **A slot a fast-lane check is counted on stays its own.** `packages/gate/src/scheduler.ts`, `Sim.dispatch`. A fast-lane check admitted for a later moment keeps its slot until then, so a slow run doesn't take it in between.
- **A stop that starts things starts the session's held places too.** `packages/gate/src/scheduler.ts`, `Sim.atFastEnd`. When a stop starts slow checks for your words, a claim or the loop's pause, the places the session already holds start with them.
- **An observed Codex stop is held for slow checks only when they can land.** `packages/gate/src/scheduler.ts`, `Sim.atFastEnd`. They must start at this stop and end inside the time the hold has.
- **No check fits before background work.** `packages/gate/src/scheduler.ts`, `Sim.loopFit`. Work in the background reports when it ends, which nothing foresees.
- **A result inside a hold not yet replied goes with that reply.** `packages/gate/src/scheduler.ts`, `Sim.landed`. It is not delivered on its own first.
- **A late result for an older snapshot is named on the newest claim's line.** `packages/gate/src/scheduler.ts`, `Sim.landed`. It sits beside that check, read as stale.
- **A delivery queued for the next tool call goes out at a stop, checked as it goes.** `packages/gate/src/scheduler.ts`, `Sim.stop`. A stop is the last moment before the agent waits.

## Stalled claims

- **A stalled claim gets no second decision.** `packages/gate/src/stalls.ts`, `judgeStop`. It stays with you until new evidence comes: no further send-back, and the rule that stalled it isn't raised again.

## Slots and memory

- **Memory used outside DeepBuild holds a run back only while the pool has room for it.** `packages/gate/src/exec.ts`, `admit`. When the pool itself is short, the run waits on the pool, and the kernel's reading isn't asked.
- **A heavy command reuses its last verdict only while its inputs and evidence stand.** `packages/gate/src/exec.ts`, `runHeavy`. When none of its declared inputs changed and its evidence is kept, it doesn't run again. Otherwise it waits for a `cpu.slot` lease and runs through the repo's `scripts/lease` where there is one, and a failed timing run records the machine's load.
- **Only the first failure under load is set aside.** `packages/gate/src/exec.ts`, `runTiming`. The run after it goes alone, so its result counts whatever the load reads.
