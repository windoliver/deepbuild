# Acceptance tests for #3218: a pool lease takes units, and a run that needs several kinds gets all of them or none

Written first, blind, from issue #3218 (its text as of November 23, 2026: the opening, Decided here, Scope, Fields, the
11 checkbox criteria, Proof and Depends on #237), the issues it names (#237, #3219, #3220, #1409, #1411, #1015,
#1016, #6, read for scope only), `docs/technical-design.md` (Lease; Budget, for "one append, decided on the log state it
read" and "hold every probe ... open until all competing requests are in, then release them in every order"; Scale
later; How we know version 0 works; Lifecycles), `AGENTS.md`, and the base commit `f8c6cff82` (`origin/main`):
`packages/leases/src/index.ts` (the table, `Plant`, `openLeases`, `cpu.slot`), `packages/hub/src/heavy.ts`
(`HeavyQueue`, `deep lease`, `HeavyOptions.plant`), `packages/hub/src/core.ts` and `hub-control.ts` (how the hub
opens the table and the queue, and `lease.wait`), `packages/contracts/schemas/lease.*`, `packages/record` (`readSince`,
`dist/versions.json`), `scripts/benchmark.mjs`, `scripts/lanes.mjs`, `scripts/proof-change.mjs` (criterion IDs), and
the suites `tests/acceptance/237`, `1015`, `1016`, `1411`, `2122`, `1352` and `3017` for conventions. The job never saw
an implementation of #3218 or #3220. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute
goes to a blind redraft of this job.

The issue has 11 checkbox criteria, AC1 to AC11 in the body's order.

## How to run

On macOS, with the repo's Node (24.22):

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # #237's suite (AC2) and the perf lane's benchmarks (AC11) use dist/;
                                         # the record's dist/versions.json lists lease.acquired@3 only once built
npx vitest run --root tests/acceptance/3218 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/3218/tsconfig.json
```

- `--no-file-parallelism`: AC11's timings only mean something with nothing else of the suite running.
- Every test makes its folders under `/tmp/dl3218-*`, sets `HOME` to a temp folder, removes the agent's own
  `CLAUDE_*` and `DEEP_*` variables first, and never touches the real `~/.deepbuild` or a hub. It starts no long-lived
  process: `git` reads of this checkout, `node benchmarks/lease-ask.mjs` (AC11), #237's suite under Vitest (AC2), the
  three doc lanes' scripts and `gh issue list` (AC10), each awaited to its end; nothing is stopped by name or port.
- The merge base is `git merge-base HEAD origin/main`. AC2 and AC9 run the merge base's own lease table and heavy
  queue: `helpers.ts` (`baseTree`) reads `packages/leases/src/index.ts` and `packages/hub/src/heavy.ts` with every file
  they import by a relative path from the merge base (`git show`) into a temp folder, pointing `@deepbuild/leases` at the
  merge base's copy and every other import at this checkout's packages, so the record and contracts are shared.
- With `--root` here, Vitest writes its cache under `tests/acceptance/3218/node_modules/`; delete it before committing.
- Rough times on the reference Mac at a load of 50 to 100: AC7's 1,000 sequences about 75 s (the planted fold's run
  stops at its first restart), #237's suite 10 s, AC3's twin 5 s, the rest a few seconds.

## The surface under test

The issue names `units: u32 = 1` on a pool lease, an ask for several `[{resource, mode, units}]`, a BLOCKED answer
naming the pool's size, the event that records a lease gaining `units` under a new version, `deep lease` taking its
kinds in one ask, and first-in-line in the heavy queue, but no code API. These tests define the smallest surface that
reaches every criterion, through `@deepbuild/leases`'s public entry (`packages/leases/src/index.ts`) and the hub's
`@deepbuild/hub/lease` (`packages/hub/src/heavy.ts`). Every call that works at the base works as it did:
`table.lease(caller, resource, mode)` with no units, `declare`, `tick`, `release`, `leases`, `openLeases`.

### `packages/leases/src/index.ts` (additions and changes only)

```ts
/** `units` is on a lease of a `pool(n)` kind only: k of the pool's n on its host, 1 when the ask named none. */
export interface Lease { id: string; resource: Resource; holder: string; mode: Mode; expires: number; units?: number }

/** One resource an ask names, with its mode and, on a `pool(n)` kind only, its units (1 when it names none). */
export interface Need { resource: Resource; mode: Mode; units?: number }

export type LeaseResult =
  | { status: 'granted'; lease: Lease }
  | { status: 'refused'; reason: 'held' | 'pool' | 'cooldown' | 'taken'; holders: Lease[]; message: string }
  // 'size': the units are past the pool's n, so it can never be granted; `message` names the pool and its size.
  | { status: 'BLOCKED'; reason: 'cap' | 'size'; holders: Lease[]; message: string };

/** An ask for several: granted whole, one lease per need in the ask's order, or refused whole, naming in `resource`
 *  the first need, in the ask's order, that couldn't be granted. */
export type AskResult =
  | { status: 'granted'; leases: Lease[] }
  | { status: 'refused'; reason: 'held' | 'pool' | 'cooldown' | 'taken'; resource: Resource; holders: Lease[]; message: string }
  | { status: 'BLOCKED'; reason: 'cap' | 'size'; resource: Resource; holders: Lease[]; message: string };

export type Plant = /* the base's fifteen */ | 'counts-holders' | 'queues-past-size' | 'one-kind-at-a-time' | 'fold-drops-units';

export interface LeaseTable {
  /** As at the base, with `units` on a pool(n) kind: `lease(caller, resource, mode)` is `units` 1. */
  lease(caller: Caller, resource: Resource, mode: Mode, units?: number): Promise<LeaseResult>;
  /** Every need decided on one read of the log, appended together or not at all: a refusal appends nothing. */
  ask(caller: Caller, needs: Need[]): Promise<AskResult>;
  // declare, kinds, tick, release, leases: as at the base. `leases()` shows each pool lease's units, 1 for a lease the
  // record holds from before units (a `lease.acquired@1` or `@2`).
}
```

- **A pool's refusal** (`reason: 'pool'`) names the pool and how many of its units are free, and its `holders` are the
  pool's leases on that host. A refusal that leaves no unit free still says "full", as #237's AC2 reads it.
- **Units on a kind that isn't a pool** (exact, glob, prefix), in `lease` or in an ask: the call rejects with an error
  naming the kind, as an undeclared kind does today, or resolves not granted with a `message` naming it; the tests read
  either. Nothing is appended. Units of 1 named on such a kind aren't tested either way.
- **A pool's read**: the kind's free check (`declare`'s `free`), which the base already asks before it grants a pool's
  lease. AC4's race holds it open.

### `packages/hub/src/heavy.ts` (additions only)

```ts
export interface HeavyOptions {
  // ...as at the base, and:
  /** The units of a pool kind a queued command takes, read by the hub (from its heavy.command@1 entry or a reading,
   *  #3220), never from the call's params; undefined (or no `unitsOf`) is 1. Asked when the command joins the queue,
   *  for each kind it names (not the cpu.slot the queue adds). */
  unitsOf?: (need: { kind: string; command: string; cwd: string }) => number | undefined;
  /** plant: the base's list, and 'serves-whichever-fits'. */
  plant?: string;
}
```

`deep lease [kind...] -- <command>` sends its kinds to `lease.wait` unchanged (`hub-control.ts` calls
`HeavyQueue.wait`); the queue takes its cpu.slot and every kind in one `table.ask`. The core passes no `unitsOf` until
#3220 gives it one, so every kind there takes 1. No `deep lease` argument names units: an agent's call can't.

### Events the table appends (writer `core`)

| Kind | Data the tests read | When |
|---|---|---|
| `lease.acquired@3` (new: @2's data plus `units`) | `resource`, `holder`, `mode`; `units`, an integer of at least 1, on a `pool(n)` kind's lease | one per lease granted, a whole ask's together |
| `lease.released` (the base's @2) | `resource`, `holder` | each lease's end |

A record written before @3 folds with each pool lease at 1 unit. `lease.acquired@3` is a published schema in
`packages/contracts/schemas/`, which the record's build lists in its `dist/versions.json`.

### The perf lane (AC11)

A task `lease-ask` in `benchmarks/budgets.json`, command `["node","benchmarks/lease-ask.mjs"]`, with an
`initialReason` naming #3218: a record and the table, 1,000 leases held, and asks for four resources. `lease-grant`
keeps its frozen definition. The file stays valid by `validateBudgets` against the merge base's.

## Criteria to tests

Each test's name starts with its criterion's number and ID, `#3218.<first 8 hex of the SHA-256 of its text>`
(`scripts/proof-change.mjs`'s `criterionId`). A test headed `(wrong program)` runs the same scenario on the planted twin
and expects it to fail at the step the criterion names; a plant that isn't built (the scenario passes) fails that test.

| ID | Criterion (short) | Tests | At this base |
|---|---|---|---|
| AC1 `#3218.8958c7b7` | `pool(1000)`: 400 and 500 granted, 200 refused naming the pool and the 100 free, granted once the 400 ends | `table.test.ts` AC1 (3) | the scenario fails (units ignored: the third is granted); both twins pass, as the base is a table that counts holders and has `pool-as-exact-key` |
| AC2 `#3218.da893eed` | no units takes 1; #237's tests pass unchanged; a merge-base record folds at 1 | `table.test.ts` AC2 (1), `compat.test.ts` AC2 (3) | no units shown, no `ask`, no @3; the merge-base record shows no units; #237's two pass (unchanged, and passing) |
| AC3 `#3218.86874d33` | 1,200 of the pool(1000) BLOCKED at once, naming the size | `table.test.ts` AC3 (2) | granted |
| AC4 `#3218.fe1eb34b` | cpu.slot + 600 with 500 free: neither, nothing appended; the race in both orders, one granted | `ask.test.ts` AC4 (5) | no `ask` |
| AC5 `#3218.94bd049e` | units on exact, glob, prefix refused naming the kind | `table.test.ts` AC5 (3) | granted |
| AC6 `#3218.d49806d0` | 1,000 units on `local` and on `h2` | `table.test.ts` AC6 (2) | no units shown, a unit past 1,000 granted |
| AC7 `#3218.82a6e5ee` | 1,000 seeded sequences vs a reference with one sum per host and pool; restart folds the same units | `sequences.test.ts` AC7 (4) | no `ask`; the restart scenario's 5 is granted, so its twin passes, as the base's fold has no units |
| AC8 `#3218.b4429bec` | heavy queue: 800 first in line with 300 free, a later 100 waits, one needing none starts | `queue.test.ts` AC8 (2) | the 800 starts (units ignored) |
| AC9 `#3218.44836290` | `deep lease` with two kinds, the second held: no grant for the first; the merge base appends a grant and a release | `queue.test.ts` AC9 (2) | a grant and a release of cpu.slot and the first kind; the merge-base test passes |
| AC10 `#3218.7172f4c8` | the Lease section states the rule, the decisions, the never list; the doc lanes pass | `design.test.ts` AC10 (2) | the section is the merge base's |
| AC11 `#3218.776b3d1a` | grant with units under 50 ms; ask for four decided under 1 ms with 1,000 held, vs the merge base | `budgets.test.ts` AC11 (4) | no `lease-ask` task or bench; units not granted; no `ask` |

### How each criterion is read

- **The test kind** is `test.mem`, `pool(1000)`, declared by a `test-units` plug-in; a `pool(n)` kind's key names
  nothing, and every lease of it on a host counts. Holders are sessions; a session's lease ends at the table's `tick()`
  after its `session.end` (the hook's), as #237 reads it.
- **AC1.** "Naming the pool and the 100 free": `reason: 'pool'`, the message holds `test.mem`, `100` as a number of its
  own and "free", and `holders` are the 400 and the 500. "Once the 400 has ended": its session ends, `tick()`. Statuses
  are checked before units, so each twin fails at the step the issue names: the holder-counting table grants the
  third, and the one-key table (#237's `pool-as-exact-key`, kept) refuses the 500.
- **AC2.** A pool(3) takes three leases that name no units, each with `units` 1, and refuses a fourth; an ask naming
  a cpu.slot with no units takes 1; each pool lease's `lease.acquired` is `v` 3 with `units` 1; an exact kind's lease has
  no `units`. "#237's acceptance tests pass unchanged": `tests/acceptance/237` has no change and no added file against
  the merge base, and its suite, run as its README says (`vitest run --root tests/acceptance/237
  --no-file-parallelism`), exits 0; its timing test skips as INCONCLUSIVE off the reference Mac, as it always has. "A
  record written on the merge base": the merge base's own table grants three leases of a pool(4) and a cpu.slot into a
  record (each `lease.acquired@2`), which is closed; the table as it ships opens the file and holds the same four with 1
  unit each, refuses 2 more units of the pool(4), naming the three, and grants 1.
- **AC3.** "At once": answered within 5 s (a table that waits never answers). BLOCKED with `reason: 'size'`, the message
  naming `test.mem` and `1000` or `1,000`, on an empty pool, so a table that only refuses for want of room fails; an ask
  naming a cpu.slot and the 1,200 is BLOCKED whole, its `resource` the pool. Nothing is appended.
- **AC4.** The asks name `[{cpu.slot, 'slot'}, {test.mem, units: 600}]` with `cores: 8`. "Appends nothing": the record
  gains no event. "Holding the read open": the pool's free check is held until both asks have asked it (a table that
  holds one ask behind the other's read fails here), neither is decided while it's open, and both are answered `true` in
  one turn of the event loop, in each order. Exactly one is granted, with its cpu.slot and its 600 units; the loser is
  refused naming the pool and the record holds no event naming its holder. "Naming the events": a failure lists each
  event appended, kind, version, subject and data.
- **AC5.** `test.exact` (key `rig-1`), `test.glob` (`src/**`) and `test.prefix` (`doc.fig`): 2 units alone, and 2 units
  beside a cpu.slot in an ask, are refused naming the kind, nothing appended, nothing held; the same lease naming no
  units is granted with none.
- **AC6.** "Declared on `local` and on a test host": one `pool(1000)` kind counts on each host; 1,000 units on `local`
  and on `h2` are granted, then one unit more on each is refused naming that host, its `holders` only that host's
  lease. #237's `pool-across-hosts`, kept, is the twin that sums across hosts.
- **AC7.** fast-check, seed `0x321807`, 1,000 sequences (README of the file, top): `test.p1` pool(10) and `test.p2`
  pool(6) on `local` and `h2`; asks of one to three distinct pairs with 1 to n units each, asks of one pair past its
  size, ends (each lease of one granted ask released; holders `ext:…`, which `release` ends), and one restart in each
  sequence's second half. At every step the result matches the reference (granted; BLOCKED `size` naming the pair; or
  refused `pool` naming the first pair in the ask's order without room) and the table's sum on each host and pool, read
  from `leases()`, is the reference's. The restart closes the record, opens it from its file and opens the table on it
  (as the hub's start does); it must hold the same lease IDs with the same resources and units. The run checks that
  granted, refused, BLOCKED, several-pair granted and several-pair refused asks are each at least 3% of the asks, and
  that at least half the restarts hold a lease of more than one unit. "Grants past n after the restart, naming the
  lease": a lease of 7 units of a pool(10), the restart, and an ask for 5 must be refused naming that lease and its 7.
- **AC8.** The queue runs in this process on the real table (as #2122's suite runs it), `cores: 8`, memory pressure
  normal, the disk free, `jobs: 'none'`. Another session holds 700 of `test.mem`; `unitsOf` gives `big build` 800 and
  `small build` 100. BIG joins and waits, its line naming `test.mem`; SMALL joins and waits, its line naming
  `session:BIG`, and still waits when asked again; NONE (no kinds) starts. Neither waiter holds anything. Once the 700
  ends, BIG starts, then SMALL, holding 800 and 100.
- **AC9.** `test.first` and `test.second`, exact kinds; another session holds `test.second`. The command joins naming
  both and asks three more times, a second of `deep lease`'s polling. It waits, its line naming `test.second` and the
  holder, and the record holds no event naming its holder; once the holder ends, it starts holding its cpu.slot and both
  kinds, three grants and no release. On the merge base's queue and table the same steps append a grant of
  `test.first` and a release of it.
- **AC10.** The Lease section is `#### Lease` to the next heading of level 4 or higher, outside fenced code, and must
  differ from the merge base's. It must hold the words below (any case unless shown capitalised), a floor for a text a
  person also judges, and say "Not taken" at least seven times, once per decision. The doc lanes are run as #1352's
  suite runs them: each lane's own commands from `scripts/lanes.mjs`, against one fetch of the open issues in
  `DEEP_OPEN_ISSUES`; design links and names and catalogue drift pass or print only findings the merge base's docs also
  give; public text must pass. Offline, signed out of `gh`, or with `packages/contracts/dist` missing: INCONCLUSIVE.

  | Item | Words the section must hold |
  |---|---|
  | The rule | `units`, `pool(n)`, `BLOCKED` |
  | k of n | `second table`, `one unit` |
  | n is the host's capacity | `capacity`, `declared`, `live reading` or `free memory` |
  | units fixed for life | `fixed`, `resize`/`resizing` |
  | all or none across kinds | `all or none` (or `all-or-none`), `one kind at a time` |
  | first in line holds | `first in line`, `whichever fits` |
  | job tokens stay a pipe | `tokens as units` (or `token as units`) |
  | one kind follows now | `mem`, `MB`, `GPU memory` |
  | never: sum past n on a host | `sum past` (or `sums past`) |
  | never: count units across hosts | `across hosts` |
  | never: units on a kind that isn't a pool | `isn't a pool` (or `is not a pool`, `not a pool`) |
  | never: granted in part | `in part` (or `partly`, `partial`) |
  | never: wait for more than its pool holds | `more than its pool` (or `the pool`) |
  | never: units named or raised by an agent's call | `raised`, `agent` |

- **AC11.** The timing rule is the perf lane's (`scripts/benchmark.mjs` `judgeLimit`): one warm-up and five runs, each
  the median of 20 calls, with the load read at each run's start and end; PASS, FAIL, or INCONCLUSIVE (off a reference
  Mac, at a load above the cores, or neither all within nor all over by the margin). INCONCLUSIVE fails the test with
  the runs, never a pass. "Granted": `lease(…, 7)` on a `pool(999999)` with 100 leases held, each grant checked to carry
  7 units. "Decided": with `cores: 4096` and 1,000 leases held (250 asks, each a cpu.slot, 10 units of `test.pa`
  pool(100000), 10 of `test.pb` pool(2500), which they fill, and a `test.port` exact key), an ask for a cpu.slot, 5 units
  of `test.pa`, a free `test.port` key and 1 unit of `test.pb`, refused on its fourth: so every resource is read and the
  ask appends nothing, and 1,000 stay held. "Compared with the merge base": the perf lane's task and manifest (above).

## Wrong programs

Each selected through the surface above. The issue names the twins of AC1 (two), AC3, AC4, AC6, AC7 and AC8, and the
merge base itself for AC9; AC2, AC5, AC10 and AC11 name none and fail on the merge base (`BASE-FAILURE.txt`).

| Plant | Where | Criterion | What it does | How the test fails on it |
|---|---|---|---|---|
| `counts-holders` | `Plant` | AC1 | a pool counts leases, not units | the third lease of 200 is granted |
| `pool-as-exact-key` (#237's, kept) | `Plant` | AC1 | treats the pool as one exact key | the lease of 500 is refused |
| `queues-past-size` | `Plant` | AC3 | an ask past the pool's size waits for room, and never answers | no answer within 5 s |
| `one-kind-at-a-time` | `Plant` | AC4 | `ask` takes its needs one at a time, giving back what it got when one is refused | the ask that doesn't fit, and the race's loser, append a `lease.acquired` and a `lease.released`, named in the failure |
| `pool-across-hosts` (#237's, kept) | `Plant` | AC6 | sums the pool across hosts | the 1,000 units on `h2` are refused |
| `fold-drops-units` | `Plant` | AC7 | the fold reads every lease from the record at 1 unit | after the restart the 5 is granted past n, naming the lease of 7; the sequences fail at their restart naming a lease whose units changed |
| `serves-whichever-fits` | `HeavyOptions.plant` | AC8 | a waiter isn't held by one ahead of it blocked on a kind it needs | the later 100 starts |
| the merge base | `baseTree` | AC9 | `deep lease` takes each kind in turn | (the merge-base test passes only while the merge base appends a grant and a release) |

## Readings of the issue this suite had to choose

- **The API** (above): `lease` gains an optional `units`; `ask` is the several-resource ask; the refusal of an ask
  names its first failing need in `resource`, which the heavy queue needs to hold later waiters on that kind.
- **"The event that records a lease gains `units` under a new version"** is `lease.acquired@3`, one event per lease.
- **Precedence**: an ask with a need past its pool's size is BLOCKED; the property test generates such a need only in
  an ask of one, so which of a BLOCKED and a refusal an ask of several reports first is left open.
- **Several needs on one pool and host in one ask** aren't generated; how they sum is left open.
- **"Holding the read open"** (AC4) is the pool kind's free check, the table's only read outside the log that a test
  can hold without fixing how the table reads its log (the base reads the log one read at a time, so two log reads are
  never open at once).
- **The heavy queue's units** come from the hub (`unitsOf`), since an agent's call may never name them; no `deep lease`
  argument names units. Driving `HeavyQueue.wait` in this process is driving `lease.wait`, which is all `deep lease` sends
  its kinds through; the CLI itself isn't started.
- **"Decided in under 1 ms"** (AC11) is timed on asks refused on their fourth resource; the grant's append is timed in
  the first number.
- **"Compared with the merge base"** (AC11) is the perf lane's, as #237's budget was: a new task, and the old ones frozen.
- **The heavy queue's line** keeps naming who a waiter waits behind and who holds what, as at the base.
- Not tested: `mem` and its callers (#3220), GPU memory, a check's width on cpu.slot, a lease's units staying fixed for
  its life (no call resizes one), and `units` of 1 named on a kind that isn't a pool.

## Files

- `helpers.ts`: IDs, temp folders, the test's clock, held promises, git on this checkout, the merge base's modules
  (`baseTree`), and the perf lane's timing judge.
- `world.ts`: the record and the table, a restart from the file, a hook-written `session.end`, the heavy queue on the
  table, the merge base's table and queue, and assertions.
- `table.test.ts` (AC1, AC2, AC3, AC5, AC6), `compat.test.ts` (AC2), `ask.test.ts` (AC4), `sequences.test.ts` (AC7),
  `queue.test.ts` (AC8, AC9), `design.test.ts` (AC10), `budgets.test.ts` (AC11).
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run and the typecheck on the base commit.
