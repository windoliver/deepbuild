# Acceptance tests for #237: leases, one table for ports, accounts, screens, GPUs, paths and document IDs

Written first, blind, from issue #237 (its text as of October 24, 2026: Scope, Fields, the 12 checkbox criteria,
Proof and Depends on #14, #16, #236), the issues it names (#3, #29, #36, #52, #91, #236, read for scope only),
`docs/technical-design.md` (Lease; Budget, for "one append, decided on the log state it read" and "hold every probe
open ... then release them in every order"; Extension API, `deep.lease(resource, mode)`; the record's `leases`
table; Lifecycles; Sessions that know about each other; the env-local row of First-party extensions; Scale later;
How we know version 0 works), `AGENTS.md`, the acceptance tests of #16, #86, #236 and #318 for their conventions,
and the base commit `8b98570` (`origin/main`), by a job that never saw an implementation of #237. The implementing
agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

The issue has 12 checkbox criteria, AC1 to AC12 in the body's order.

## How to run

On macOS, with the repo's Node (24.22.0):

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the supervisor's native helper (AC5) and benchmarks/lease.mjs use dist/
npx vitest run --root tests/acceptance/237 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/237/tsconfig.json   # needs packages/leases
```

- `--no-file-parallelism`: AC7's timing only means something with nothing else running.
- Every test makes its folders under `/tmp/dl237-*`, sets `HOME` to a temp folder, removes the agent's own
  `CLAUDE_*` and `DEEP_*` variables first, and never touches the real `~/.deepbuild` or a hub. The only processes it
  starts are `/bin/sleep 600` children (AC10) and the supervisor's run of `/bin/sleep 600` (AC5); it stops them by PID
  only, never by name or port.
- With `--root` here, Vitest writes its cache to `tests/acceptance/237/node_modules/.vite/`; delete that folder
  before committing.
- The typecheck fails at this base: `packages/leases` doesn't exist (`BASE-FAILURE.txt`). Against the declaration
  below it is clean: this job checked that in a scratch copy with the declaration as the module, outside the repo.

## The surface under test

The issue names `deep.lease(resource, mode)`, `lease.kind@1` `{name, match, cap, cooldown, cost}`, a resource
`{host, kind, key}`, a holder, a mode, an expiry, the core's `cpu.slot`, one kernel overlap function, a stale
reading and a release that cites the supervisor's proof, but no code API. These tests define the smallest surface
that reaches every criterion, with those names:

1. **`@deepbuild/leases`, a new core workspace package, through its public entry `packages/leases/src/index.ts`.**
   The table must be reached by the hub (#16), which serves `deep.lease` to extensions, and by the supervisor
   (#236), which leases for the runs it starts; the hub imports the supervisor, so a table inside the hub would
   give the supervisor an import cycle, and one inside the supervisor would put granting in a ring part that no
   plug-in extends, while any plug-in must be able to add a kind. A package of its own, below both and depending
   only on the record (#14), is one table both reach through one entry, and the core never imports an extension:
   env-local (#36) and any other plug-in only hand it `lease.kind@1` data.
2. **The record (#14)**, as it is at the base: `openRecord`, `append`, `read`, `close`. Grants, stale marks and
   releases are its events; a holder's end (`session.end`, written by the hook) and the supervisor's proofs
   (`process.tracked`, `process.ended`) are read from it.
3. **The supervisor (#236) and the asks core (#318)**, as they are at the base, for AC5: `openSupervisor` with the
   base's options, `start`, `cleanup`. Whatever #237 adds to `SupervisorOptions` must be optional.

`deep.lease(resource, mode)` in the hub is `table.lease(caller, resource, mode)` with the caller filled from the
extension's connection and session. The hub's `deep` object for in-process extensions isn't at this base; that
binding is tested where it lands.

### `packages/leases/src/index.ts`

```ts
import type { RecordStore } from '@deepbuild/record';

/** lease.kind@1: a resource kind, as data a plug-in's manifest (or the core) declares. */
export interface LeaseKind {
  name: string;          // 'port', 'cpu.slot', 'device.rig'
  match: string;         // closed: 'exact' | 'glob' | 'prefix' | 'pool(<n>)', such as 'pool(2)'; anything else is refused when declared
  cap: number;           // at most this many leases of the kind held at once on a host; a request past it is BLOCKED, naming the cap
  cooldown: number;      // ms after a key's lease ended before that key is leased again
  cost: number;          // the kind's cost estimate (not read by these tests)
}
export interface DeclaredKind extends LeaseKind { plugin: string }   // 'core' for the core's own kinds, or the plug-in's name
/** `host` is 'local' in R1; any other name is another machine, and leases on two hosts never overlap. */
export interface Resource { host: string; kind: string; key: string }
export type Mode = 'exclusive' | 'shared';
export interface Lease {
  id: string;            // the lease's own ID
  resource: Resource;
  holder: string;        // `session:<id>`, or a writer as the record writes one, such as a document prefix's
  mode: Mode;
  expires: number;       // ms since the epoch; past it the lease is only stale
}
/** Who asks: in the hub, `deep.lease(resource, mode)` fills this from the caller's connection and session. */
export interface Caller {
  holder: string;
  run?: string;                              // the run whose processes the supervisor records hold the lease open until proven gone
  agent?: { pid: number; start: string };    // the holder session's agent process, by ID and start time (`ps -o lstart=`, LC_ALL=C)
}
export type LeaseResult =
  | { status: 'granted'; lease: Lease }
  // held: another holder's lease could match the same key, and not both are shared; `holders` has it.
  // pool: the kind's pool on that host is full; `holders` has the leases filling it.
  // cooldown: the key's last lease ended less than the kind's cooldown ago.
  // taken: the kind's free check said something outside the table holds the key.
  // `message` names what refused it: the holder, the pool and its host, the cooldown.
  | { status: 'refused'; reason: 'held' | 'pool' | 'cooldown' | 'taken'; holders: Lease[]; message: string }
  | { status: 'BLOCKED'; reason: 'cap'; holders: Lease[]; message: string };   // `message` names the cap
/** A lease the table holds now. `reading` is set while stale, and names each process recorded for it that still runs. */
export interface LeaseView { lease: Lease; state: 'held' | 'stale'; reading?: string }

/** The kernel's one overlap function over the two match forms; symmetric. */
export type Overlap = (form: 'glob' | 'prefix', a: string, b: string) => boolean;
export const overlap: Overlap;
/** The planted wrong program of AC11 (tests only): tests A against B but not B against A. */
export const plantedOverlap: { 'one-way': Overlap };

/** The planted wrong programs the acceptance tests select (tests only; Wrong programs, below). */
export type Plant =
  | 'ignores-mode' | 'pool-as-exact-key' | 'pool-ignores-n' | 'any-match-form' | 'redeclare-replaces' | 'fixed-kinds'
  | 'releases-at-expiry' | 'ignores-cooldown' | 'ignores-cap' | 'checks-held-mode-only' | 'await-before-append'
  | 'pid-only-liveness' | 'host-blind' | 'pool-across-hosts';
export interface LeasesOptions {
  record: RecordStore;   // grants, stale marks and releases are appended here, written as `core`; ends and proofs are read from it
  now: () => number;     // the clock of grants, expiries and cooldowns
  cores?: number;        // the cores `cpu.slot` is half of, on each host; this machine's (os.availableParallelism()) unless given
  plant?: Plant;
}
export interface LeaseTable {
  /** Declares a kind. Rejects, naming the form, a match outside the closed four, and, naming its holder, a name already declared. */
  declare(plugin: string, kind: LeaseKind, free?: (key: string) => Promise<boolean>): Promise<void>;
  /** Every declared kind, the core's included. */
  kinds(): Promise<DeclaredKind[]>;
  /** One grant or refusal, decided on the log state it read, with no await between that read and its append. */
  lease(caller: Caller, resource: Resource, mode: Mode): Promise<LeaseResult>;
  /** Reads what the record gained and acts on it: marks leases past their expiry stale, and ends each lease whose
   *  holder has ended and whose processes are proven gone. */
  tick(): Promise<void>;
  /** The leases held now, stale ones included; an ended lease is not among them. */
  leases(): Promise<LeaseView[]>;
}
/** Opens the table on the record; its state is a function of the log. The core declares `cpu.slot` before it resolves. */
export function openLeases(options: LeasesOptions): Promise<LeaseTable>;
```

Nothing else is needed: no option, flag or export beyond these. `free` is the kind's free check (env-local's port
probe); it is asked before a key nobody in the table holds is leased, and the table doesn't wait on one request's
probe to ask another's. `cores` exists because the issue's tests need `cpu.slot` as `pool(2)` and the core derives
it from the host's cores.

### Events the table appends (writer `core`)

| Kind | Data the tests read | When |
|---|---|---|
| `lease.acquired@1` (the base's) | `resource` `{host, kind, key}`, `holder`, `mode` | each grant: exactly one per grant (AC1, AC9) |
| `lease.stale` (the base's @1, or a later version) | the lease's `resource` | the lease went past its expiry with its holder still on it |
| `lease.released` (a new version: @1's `data` takes no more fields) | `resource`, `holder`, and `proof`: the IDs of the events that prove it ended | once the holder has ended and every process recorded for it is proven gone |
| the core's record that an agent is gone (kind the implementer's) | names the agent's PID; cited in `proof` | a holder's agent PID no longer runs, or runs with another start time (AC10) |

`proof` holds the holder's end (its `session.end`, or the core's record that its agent is gone) and each
`process.ended` the supervisor appended for the lease's run; never a `lease.stale`. Each is a published schema in
`packages/contracts/schemas/` (the record refuses a kind it doesn't know).

## Criteria to tests

Each test's name starts with its criterion's number, and each `describe` carries the criterion's ID,
`#237.<first 8 hex of the SHA-256 of its text>` (trimmed, whitespace collapsed, `- [ ] ` dropped). A test headed
`(wrong program)` runs the same scenario against the planted twin and expects it to fail at the step the criterion
names; a plant that isn't built (the scenario passes) fails that test.

| ID | Criterion (short) | Tests | At this base |
|---|---|---|---|
| AC1 `#237.acb97f9b` | exact kind: exclusive refuses B naming A, other key granted, two shared granted | `exact.test.ts` AC1 (2) | fails (no package) |
| AC2 `#237.01b91df6` | `cpu.slot` as `pool(2)`: three at once get two, the third refused naming the pool full; granted after one ends | `pool.test.ts` AC2 (4): the scenario, two wrong programs, and the core's default of half the cores (Scope) | fails (no package) |
| AC3 `#237.bbccc379` | a planted `regex` form refused naming the form; a second declaration refused naming the holder | `kinds.test.ts` AC3 (4): each half and its wrong program | fails (no package) |
| AC4 `#237.64161c59` | a test plug-in's `device.rig` leased to one session at a time | `kinds.test.ts` AC4 (2) | fails (no package) |
| AC5 `#237.635d92b7` | 20 minutes past expiry: stays, reads stale; ended holder with a running process keeps it, reading names it; released on proof, citing it | `life.test.ts` AC5 (2) | fails (no package) |
| AC6 `#237.9e8099b5` | 10-minute cooldown: ended 12:00, refused 12:05 naming the cooldown, granted 12:11; cap of two: third run BLOCKED naming the cap | `life.test.ts` AC6 (4) | fails (no package) |
| AC7 `#237.5459ad56` | a lease granted in under 50 ms, vs the merge base, on the reference Mac | `budgets.test.ts` AC7 (3): the perf lane's `lease-grant` task valid against the merge base; the bench runs; the number | fails (no package, no task); the number is skipped INCONCLUSIVE off the reference Mac or on a loaded one |
| AC8 `#237.f102d9a8` | A shared on 5173: B's exclusive refused naming A | `exact.test.ts` AC8 (2) | fails (no package) |
| AC9 `#237.7ebfc24e` | port probe held until three requests are in: exactly one granted in each of six release orders | `race.test.ts` AC9 (7) | fails (no package) |
| AC10 `#237.e6aa8a25` | agent killed with SIGKILL reads ended by PID and start time, lease released citing it; a reused PID keeps nothing | `life.test.ts` AC10 (3) | fails (no package) |
| AC11 `#237.a10e760d` | one symmetric overlap function, ≥1,000 seeded pairs per form in both orders vs a brute-force reference; the one-way plant fails on (`fig.axis`, `fig`) | `overlap.test.ts` AC11 (6) | fails (no package) |
| AC12 `#237.eb9f1f5f` | two hosts never overlap: port 5173 on `local` and `h2`; `pool(2)` per host, third on `local` refused naming the pool on `local` | `exact.test.ts` AC12 (4) | fails (no package) |

### How each criterion is read

- **The kinds.** The port kind is declared by the test as env-local's manifest declares it today
  (`{name: 'port', match: 'exact', cap: 1000, cooldown: 0, cost: 0}`, plug-in `env-local`); env-local itself isn't
  loaded. Test kinds are named `test.*` and declared by `test-*` plug-ins.
- **Ending a lease.** A holder has ended when its `session.end` is in the record (written by `hook`), or when the
  agent process its caller named no longer runs with that PID and start time (AC10). A lease ends at the table's
  next `tick()` once its holder has ended and every process the supervisor recorded for its run
  (`process.tracked`) has a `process.ended`. A lease with no run has no process to wait for. "Its attempt was
  replaced" isn't tested: the base has no record of a replaced attempt; that path is tested where it lands.
- **AC1, AC8.** "Refused naming A's lease": `reason: 'held'`, A's lease among `holders`, and A's holder in
  `message`. AC1 also checks each grant is one `lease.acquired` in the record and shows in `leases()`. AC8 also
  grants a second shared lease, so a table that refuses everything on a held key fails.
- **AC2.** "At once": three `lease` calls in one `Promise.all`; which one is refused isn't fixed. All three ask
  for the same key (`slot`): every lease of a pool kind on a host counts toward n, whatever its key, so a table that
  treats the pool as one exact key refuses the second. "After one of the two ends": its session ends, `tick()`.
- **AC3.** The four closed forms (`exact`, `glob`, `prefix`, `pool(3)`) declare; `regex` is refused when
  declared, the error naming `regex`, the kind isn't listed and a lease on it isn't granted. A second declaration
  of `test.dup` by another plug-in is refused naming `test-first`, and so is a plug-in's `cpu.slot`, naming the core.
- **AC4.** "No change to env-local or the kernel": the plug-in reaches the table only through `declare` and
  `lease`, and env-local isn't loaded. "One session at a time": B is refused `rig-1` while A holds it, gets
  `rig-2`, and gets `rig-1` once A has ended.
- **AC5.** A's lease is for a real run the supervisor started (`/bin/sleep 600`). The clock is set to the lease's
  own `expires` plus 20 minutes; the lease is still A's, reads `stale` with a reading, a `lease.stale` is in the
  record, B is refused naming A, and nothing is released. A's session then ends while the process runs: still
  held, the reading names its PID. `cleanup(run)` on the supervisor proves the process gone (`process.ended`); at
  the next `tick()` exactly one `lease.released` follows it, whose `proof` holds the `session.end` and the
  `process.ended` IDs and no `lease.stale` ID, and B gets the screen.
- **AC6.** The clock is the test's: 11:50, 12:00, 12:05, 12:11 on 2026-10-24 UTC. "Ended at 12:00": A's session
  ends at 12:00 and the `lease.released` carries `ts` 12:00. At 12:05 the key is `refused`, `reason: 'cooldown'`,
  the message saying cooldown, while another key of the kind is granted; at 12:11 it's granted. The cap is the
  number of the kind's leases held at once on a host, across holders ("a third run"): three runs, each its own
  holder and run, ask for three keys; the third is `BLOCKED`, `reason: 'cap'`, its message naming the cap and 2.
- **AC7.** "Granted": the time of one `lease` call that grants, on an exact kind with no free check (the probe's
  time is the plug-in's), on a record already holding 100 leases; the median of 20 grants is one run, five runs
  after a warm-up, judged by the timing rule (PASS when all are under 50 ms, FAIL when all are over by more than
  the margin, otherwise INCONCLUSIVE). The runs are always measured and printed; they count only on a reference
  Mac (Mac15,7 or Mac15,12) on mains power, Low Power Mode off, no thermal warning and a 1-minute load at or under
  the core count; elsewhere they are skipped as INCONCLUSIVE with the reading, never passed. "Compared with the
  merge base" is the perf lane's: a task `lease-grant` in `benchmarks/budgets.json`, command
  `["node","benchmarks/lease.mjs"]`, with an `initialReason` naming #237, valid by `validateBudgets` against the
  merge base's file.
- **AC9.** The port kind's free check is the test's: each call is held open until it has been called three times,
  once per request (a table that holds one request behind another's probe fails here), and no request is decided
  while its probe is open. The three are then answered `true` in the order under test, all in one turn of the event
  loop. Exactly one is granted, the other two are refused naming its lease, and the record holds one
  `lease.acquired` for port 5173.
- **AC10.** The agent is a `/bin/sleep 600` the test starts; its caller names its PID and `ps -o lstart=` start
  time. Before the kill the lease stays; after `kill -9` (by PID) and `tick()` it is released, no `session.end` is
  in the record, and the release's `proof` cites a `core` event naming the PID, recorded before the release. The
  reused PID is simulated by the start-time comparison: a live process's PID with another start time
  (`Thu Jan  1 00:00:00 2026`). The table may refuse that caller's lease or grant and release it at `tick()`; either
  way the holder holds nothing after `tick()`, and a granted lease's release cites the core's record of its PID.
- **AC11.** `overlap('prefix', a, b)` and `overlap('glob', a, b)`, checked with fast-check (seed `0x23711`,
  1,000 pairs per form plus fixed examples) against a brute-force reference over the fixtures' names `fig`,
  `axis`, `label`, `title`: every path of one to four segments, or every ID of one to four parts. Both orders of each
  pair must equal the reference. ID prefixes are `.`-separated parts; a prefix matches an ID whose parts start with
  its parts (the names are prefix-free, so a character-wise reading agrees). Path globs are `/`-separated and
  relative to the repo root, each segment a name, `*` (exactly one segment) or `**` (zero or more segments,
  wherever it stands, trailing too), with at most two segments that aren't `**`: two such globs that share any
  path share one of at most four segments, so the reference decides every generated pair. The generators draw half
  their pairs independently and half related (a shorter prefix; a glob with one segment widened), and a test
  checks both answers are at least 10% of the pairs before the property is trusted. A disagreement names the pair
  and the order; the one-way plant must fail naming the pair (`fig.axis`, `fig`) and one of its orders.
- **AC12.** Port 5173 exclusive on `local` and on `h2` are both granted; a third holder is still refused on each
  host, naming that host's holder. With `cores: 4`, `cpu.slot` reads `pool(2)`; leases go `local`, `h2`, `h2`,
  `local` (all granted), then a third on `local` is refused, `reason: 'pool'`, naming `cpu.slot` and `local`, with
  only `local`'s leases in `holders`. The order makes the pool-across-hosts plant refuse the second lease on `h2`,
  as the criterion says.

## Wrong programs

Each criterion has a planted twin, selected through the surface above. The issue names the twins of AC1, AC2, AC4,
AC6, AC8, AC9, AC11 and AC12; for AC3, AC5 and AC10, which name none, this suite plants the nearest wrong program.

| Plant | Criterion | What it does | How the test fails on it |
|---|---|---|---|
| `ignores-mode` | AC1 | treats every lease as exclusive | the second shared lease on 5175 is refused |
| `pool-as-exact-key` | AC2 | treats the pool as one exact key | three at once get one lease, not two |
| `pool-ignores-n` | AC2 | never fills the pool | three at once get three leases |
| `any-match-form` | AC3 | takes any match form | the `regex` kind is declared |
| `redeclare-replaces` | AC3 | a later declaration replaces the first | the second declaration of `test.dup` resolves |
| `fixed-kinds` | AC4 | leases only a fixed list of resource kinds | the first `device.rig` lease isn't granted |
| `releases-at-expiry` | AC5 | releases a lease once it's past its expiry | the lease is gone 20 minutes past its expiry |
| `ignores-cooldown` | AC6 | leases a key again at once | the key is granted at 12:05 |
| `ignores-cap` | AC6 | never BLOCKs on the cap | the third run is granted |
| `checks-held-mode-only` | AC8 | refuses only when the held lease is exclusive | B's exclusive lease on A's shared one is granted |
| `await-before-append` | AC9 | awaits between its check and its append | more than one of the three is granted |
| `pid-only-liveness` | AC10 | reads a holder live while its PID runs, whatever its start time | the reused PID's holder keeps its lease |
| `plantedOverlap['one-way']` | AC11 | tests A against B but not B against A | the property fails on (`fig.axis`, `fig`) in one order, naming both |
| `host-blind` | AC12 | leaves the host out of the key | B's lease on 5173 on `h2` is refused |
| `pool-across-hosts` | AC12 | counts the pool across hosts | the second lease on `h2` is refused |

AC7 has no twin: it fails at the base (no table, no `lease-grant` task), and past that the timing judge is its check.

## Readings of the issue this suite had to choose

- **Where the table lives** and its API: above (The surface).
- **`cap`** counts the kind's leases held at once on one host, across holders ("a third run is BLOCKED"); `pool(n)`
  is a match form and refuses (`reason: 'pool'`), while a cap BLOCKs (`status: 'BLOCKED'`).
- **`cooldown`** is in milliseconds, counted from the lease's release.
- **A pool's key** names nothing in particular; every lease of a pool kind on a host counts toward its n.
- **`cpu.slot`'s n per host** comes from one `cores` value for every host here; R3's hosts, with their own core
  counts, bring theirs when they land.
- **Glob syntax and the reference's bound** (AC11, above): the issue doesn't fix glob syntax; `**` is read as zero
  or more whole segments everywhere, and partial-segment wildcards (`f*`) aren't generated.
- **"The release event cites that proof"** is `data.proof` on `lease.released`, a list of event IDs, which needs a
  new version of that schema; "never the expiry" is checked as no `lease.stale` in it and no release before the proof.
- **"The stale reading names that process"** is read from the table's `leases()` view; the record must hold a
  `lease.stale` for the lease, but which event carries the process name is the implementer's.
- **"Its attempt was replaced"** and the glob and prefix kinds in the table itself (their fixtures "land with their
  first callers", #52 and #91) aren't tested here; the overlap function they rest on is (AC11).
- **The hub, env-local, the gate runner and hosts leasing through the table** (Scope) are not criteria; nothing
  here tests them.

## Files

- `helpers.ts`: IDs, temp folders, the test's clock, the sleepers this suite starts and kills by PID, `ps` start
  times, permutations, held promises, and the reference-Mac and load gate with the timing judge.
- `world.ts`: the record, the table opened on it with the test's clock (and, for AC5, the supervisor and asks
  core), a hook-written `session.end`, the port kind as env-local declares it, and assertions for grants and
  refusals.
- `exact.test.ts` (AC1, AC8, AC12), `pool.test.ts` (AC2), `kinds.test.ts` (AC3, AC4), `life.test.ts` (AC5, AC6,
  AC10), `race.test.ts` (AC9), `overlap.test.ts` (AC11), `budgets.test.ts` (AC7).
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run and the typecheck on the base commit.
