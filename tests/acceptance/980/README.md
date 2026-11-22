# Acceptance tests for #980: process@1, process models with conservation and Little's law (criteria 1 to 10)

Written first, from issue #980 (live, `gh issue view 980 --repo windoliver/deepbuild --comments`: its Scope, Fields, ten
acceptance criteria, Proof and Not in scope; no comments), the design sections it links and the base commit, by a job
that never saw an implementation; none existed, and no other branch, worktree, pull request, plan or session was read.
The base is this worktree's HEAD, `7a256fd4b` ("Merge pull request #2947 …"), whose first parent is `3f02bf52b`
("Merge pull request #2885 …"); nothing either touches process models. There is no Oracle page for #980; nothing is
ported. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this
job (design: Dogfooding).

## What was read

- The issue: Scope (entities, sources, sinks, queues, resources, conveyors, batches, statistics, the three kind rules,
  fixtures and a planted library), Fields, criteria, Proof, Not in scope.
- `docs/technical-design.md`: The logic module (Logic, Sandbox and budgets, Logic bake and checks, Linked libraries,
  Library interfaces, Data layouts), Dogfooding. AGENTS.md.
- `docs/canvas-primitives.md`: Logic: library interfaces (its `process@1` paragraph is the design of the interface),
  Logic: linked libraries, Logic: sandbox, Logic `logic@1`, Logic: data layouts, Pack, Pack: kind rules and the kind kit,
  Registry and seal: registries, Honest numbers, Bound value, Status binding, Text `text@1`: keyed copy, Text animator and
  counter, Mark set: logic columns.
- At the base, for the surfaces used: `tests/acceptance/981/` (README, helpers, programs, ac6 to ac8: the closest
  sibling, whose arrangement this suite follows), `416/interfaces/` (README, helpers, `wat.ts`), `190/helpers.ts`,
  `953/README.md`, `535/` (README, helpers, fixtures, ac7: deep-show documents with logic columns and the taste call),
  `538/README.md` and fixtures (texts and rects), `406/README.md` and `392/README.md` (honest numbers), `2691/` (the
  taste call); `crates/deep-logic/src/{lib.rs,judge.rs,first_party.rs,piece.rs (write region layout, step_seed)}`,
  `crates/deep-canvas/src/{time.rs,template.rs,document/rules.rs}`, `crates/deep-canvas-marks/src/{check.rs,copy.rs}`,
  `crates/deep-play/src/{logic.rs,read.rs,access.rs}`, `crates/deep-show/src/{logic.rs,interfaces.rs,frames.rs (eval
  texts, a counter on a driver),main.rs (calls)}`, `crates/deep-canvas-motion/src/array.rs` (a driver var on one logic
  element), `packs/lanes-1.0.0/pack.json`, `scripts/{proof-change.mjs,benchmark.mjs,lanes.mjs,throttle.mjs}`.

At the base nothing knows process@1: `first_party` lists `interfaces`, `lanes` and `modslib` packs only; a logic item has
no field `process` (piece/checks.rs refuses unknown fields); `judge` reads only items with `lanes`.

## Run them

```sh
npm ci && npm run build --workspaces                 # once, in a fresh worktree
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node scripts/throttle.mjs test --wait 240 -- sh scripts/lease \
  npx vitest run --root tests/acceptance/980 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/980/tsconfig.json
rm -rf tests/acceptance/980/node_modules            # vitest's cache
```

What a run builds, honoring `CARGO_TARGET_DIR`: `deep-logic` (#190's helpers, imported unchanged), #416's assembler
arrangement (`../416/interfaces/wat.ts`: #190's assembler under #416's lockfile, built from the system's temporary folder
with `--locked --manifest-path`) into `target/acceptance-416-wat`, and for criteria 7 and 10 `deep-show` (the full set,
`../535/helpers.ts`, imported unchanged). Headless Chrome (criterion 8) is `CHROME_BIN` or the usual paths. Every
deep-logic test passes #190's 90-minute timeout. A whole run, once the binaries are built, is estimated at 30 to 60
minutes on the reference Mac under load: criterion 2's three runs of about 12 million ticks, criterion 8's Chrome bakes
and criteria 7 and 10's 36,000-step document are most of it.

Gates: a missing host is `BLOCKED:`, never a pass (#190's). Criterion 9's timing is judged by `scripts/benchmark.mjs`'s
judgeLimit with the one-minute load at each run's start and end: off a reference Mac, under load, or with readings
neither all in nor all out of the limit, the test fails `INCONCLUSIVE:` with its readings, never a pass. Criterion 10 is
`INCONCLUSIVE:` until a taste call is recorded on exactly its pictures. **`scripts/lanes.mjs` pushes this folder to
`alone`** and `ac09-budget.test.ts` to `timed`.

## The surface

The issue names `process@1`, its ten exports, its layout `process.state@1`, the fields' shapes, the three kind rules
with `tolerance`, a reference library, fixtures and a planted library, but no signature, memory, array or command line.
As in #190's, #416's and #981's suites the surface is `deep-logic` (#531's, #532's, #190's, #416's and #981's
JSON-lines protocol, unchanged where not named here), and for criteria 7 and 10 `deep-show run` (#393's, as #535's suite
drives it). **Every call, field, signature, header offset, array, rule field, number, refusal field and planted name
below that the issue or the design doesn't give is this job's invention**: the smallest the criteria need, in the
design's spellings where it has them. The implementer builds exactly these, or a dispute goes to a blind redraft.

### The first-party pack

- `first_party` lists a first-party pack (any name) declaring `process@1`, #416's Interface with `layout:
  "process.state@1"`, `exports` exactly the ten below, at least one fixture, **at least two planted libraries, among
  them `drop` and `over` (README: Planted)**, and **`"rules": {"process.conserve": {}, "process.busy": {},
  "process.little": {"tolerance": 0.02}}`**: the interface's kind rules with their params' defaults, as lanes@1's pack
  declares its own (#981).
- The same pack's `libs` holds exactly one library whose `implements` names `process@1`: **the reference library** (any
  name@version), with fixtures of its own (#190's rule), its object among `first_party`'s assets.
- Its fixtures and its planted libraries are the implementer's; each planted library fails at least one of them
  (#416's pack check).

### Pieces

```text
LogicParams gain "process": {"kinds": [name]}      1 to 16 kind names, unique; a kind is its index in this list
```

The item writes process@1's arrays first, in README: Arrays' order, so `out` is `writes_at`; a program may write its own
arrays after them. `kinds` names the kinds in the judge's fails; it is the only model fact the document holds (README:
Readings: "the model in memory").

### The header

The library keeps its state, `process.state@1`, in the caller's memory from `s`, at most 4 MiB, and touches nothing else
of the caller's but the tables `source` reads and the arrays `stats` writes. The program writes the state's first 64
bytes before its first call and never changes them; the rest starts zeroed and is the library's alone:

| Offset | Type | Field |
|---|---|---|
| +0 | f64 | `tick`: the model's time step, s, > 0 |
| +8 | i64 | `seed`: the seed `init` got |
| +16 | i32 | `rows`: entity rows E, 1 to 4,096 |
| +20 | i32 | `kinds`: K, 1 to 16 (as `process.kinds`) |
| +24 | i32 | `ring`: M, the sink records kept and each station's departures kept, 1 to 4,096 |
| +32 | f64 | `window`: the statistics' window, s (the issue's `stats {window = 3600}`; 0 reads as 3,600) |
| +40 | f64 | `warmup`: s (the issue's `warmup = 0`) |

Limits: at most 128 stations and 64 resources. This suite's programs read at 0, write at 4096, keep variables at 256 KiB
and data at 320 KiB (a library's data is linked after it), put `s` at 1 MiB, and have 8 MiB of memory (128 pages,
`budget.memory` 8).

### Exports of process@1

Every export takes `s` (i32) first. The model is built by the builders, called in `init`, each returning the new
element's ID, or −1 for a bad argument (a kind past K, a `to` naming no station built so far, a schedule given none or
twice, a resource range past those built, a capacity out of range) or after the first `stats`. **Stations** (sources,
queues, requests, conveyors, packs, unpacks and sinks) are numbered 0, 1, 2, … in build order across all of them;
**resources** 0, 1, … in `resource` call order. A `to` names a station already built, or −1: nowhere, which never takes
an entity, so whatever leads there stays (a blocked end).

| Export | Signature | Does |
|---|---|---|
| `source` | (s, kind i32, every f64, mean_gap f64, at i32, until f64, to i32) → i32 | a source of `kind`: `every` > 0 makes one at 0, every, 2·every … s; `mean_gap` > 0 one after each exponential gap of that mean (README: Random draws), the first after the first gap; `at` ≥ 0 one at each time of the table at address `at` (u32 count n, 4 zero bytes, n f64 times in s, ascending); exactly one of the three is given (the others 0, 0, −1). None after `until` s (−1: no end). Its `to` must be a queue with no capacity |
| `queue` | (s, order i32, capacity i32, to i32) → i32 | a queue: `order` 0 first in, first out by (the tick it came, ID); 1 ordered by the column `made`, oldest first, then (tick, ID). `capacity` −1 none, else at most that many |
| `resource` | (s, capacity i32) → i32 | a resource of `capacity` units, 0 to 65,535 |
| `request` | (s, r i32, n i32, hold f64, mean_hold f64, to i32) → i32 | a request station: an entity there holds one unit of any of the n resources r … r + n − 1 (the lowest-numbered with a free unit) for `hold` s (`hold` ≥ 0, `mean_hold` 0), an exponential time of mean `mean_hold` (> 0, `hold` 0), or until released (`hold` −1, `mean_hold` 0); then it may move to `to`, and gives the unit back as it leaves |
| `release` | (s, e i32) → i32 | entity row e's hold ends at the next tick the model runs; 1 if e is live and holds a unit, else 0 and nothing changes |
| `conveyor` | (s, length f64, speed f64, spacing f64, to i32) → i32 | a belt: m, m/s, m |
| `pack` | (s, n i32, into i32, to i32) → i32 | a pack station: it takes one carrier of kind `into` at a time, then loads n entities of other kinds onto it, one by one; the full carrier may move to `to`, its members riding with it |
| `unpack` | (s, members i32, carrier i32) → i32 | an unpack station: it takes one entity at a time; its members leave to `members`, by (ask tick, ID), then the empty carrier leaves to `carrier` |
| `sink` | (s) → i32 | takes an entity out and records it; a carrier taken out takes its members out with it, each recorded before it in load order |
| `stats` | (s, n i32, out i32) | runs n ticks (README: The step contract), then writes the arrays at `out` |

### Entities

An entity is a row 0 … E − 1 with a kind, a generation and where it is. A new entity takes the **lowest free row**, and
its generation is the row's last plus 1 (a row's first entity is generation 1), so a stale (row, generation) never finds
the new entity. A model that needs a row when none is free traps. An entity is at exactly one station that holds
entities (a queue, a request, a conveyor, a pack or an unpack station), or in a batch (packed on a carrier), or out.

### Time

The model's clock counts **ticks**; tick τ is the interval [τ·tick, (τ + 1)·tick), its events at its start. Every time
the model is given in seconds becomes ticks by rounding to the nearest: an arrival at t at tick round(t ÷ tick), a hold
of h s round(h ÷ tick) ticks (an exponential draw too, so 0 is possible), a belt of P = round(length ÷ (speed·tick))
ticks end to end with S = round(spacing ÷ (speed·tick)) ticks of spacing, the window round(window ÷ tick) and the warm-up
round(warmup ÷ tick) ticks. Every time and every cumulative time the arrays hold is kept in ticks and written as ticks ×
tick, in f64 (a time in system as (out tick − made tick) × tick), so a share of two of them is exact. After c ticks the
model's time, `now`, is c × tick.

### Random draws

A draw for station `stream` (the source's or request's station ID), its n-th (0, 1, 2 … in the order that station
draws), is `−mean × ln(1 − u)`, with `u = (x >> 11) × 2⁻⁵³` and `x` SplitMix64's finalizer of `seed + 0x9E3779B97F4A7C15
× (stream × 2³² + n + 1)` (wrapping u64): `x ^= x >> 30; x *= 0xBF58476D1CE4E5B9; x ^= x >> 27; x *= 0x94D049BB133111EB;
x ^= x >> 31`. A source's arrival i is at t_i = t_{i−1} + draw_i (f64, t_0 = 0). Nothing else is random, and nothing
reads a clock.

### The step contract

`stats(s, n, out)` runs ticks c, c + 1, … c + n − 1 (c the ticks run so far, 0 at the first call), each as follows, then
writes the arrays.

1. **Holds end**: an entity at a request station whose hold has ended (its end tick ≤ τ, or released for this tick)
   becomes ready to leave, its **ask tick** the end tick.
2. **Sources**: in station order, each source makes the arrivals due at τ, in order, each into its queue (its made tick
   τ).
3. **Settle**: of the entities ready to move, take the one with the smallest (ask tick, entity ID) whose target takes
   it now, and move it; repeat until none moves. Ready, with its ask tick and target: a queue's head (first in its
   order), from the tick it became the head, to the queue's `to`; an entity at a request station whose hold has ended,
   to its `to`; a conveyor's lead at the end (progress P), from the tick it got there, to its `to`; a full carrier at a
   pack station, from the tick its last member loaded, to its `to`; each member of the carrier at an unpack station,
   from the carrier's arrival, to `members`, and the empty carrier, from when its last member left, to `carrier`.
   Takes it now: a queue with no capacity or fewer than its capacity; a request station with a free unit among its
   resources; a conveyor that is empty or whose last entity's progress is ≥ S; a pack station an entity of its `into`
   kind while it has no carrier, another kind while its carrier has fewer than n members; an unpack station while it has
   none; a sink always; nowhere never. An entity that moves leaves its station (giving back its unit, counting a
   departure with its time there) and arrives at the target at τ.
4. **Count**: every station's count, the live count and every resource's busy count are added to their areas for this
   tick.
5. **Belts move**: on each conveyor, from the lead back, each entity's progress p becomes min(p + 1, P) for the lead and
   min(p + 1, p_ahead − S) behind it (p_ahead the one ahead, already moved), never less than it was. d = p × speed ×
   tick.

So an entity can pass several stations in one tick (an empty queue, then a free resource), and step k of a program that
runs n ticks a step shows the model at now = n·(k + 1)·tick, belts already moved through it.

### Arrays

`stats` writes at `out`, in this order, each array starting 8-aligned (the region map's own layout for writes declared in
this order, so an item declares them first and `out` is `writes_at`). E rows, K kinds, N stations (index N of a
per-station array is **all**: the system), R̂ = max(R, 1) resources (a model with none writes one, of capacity 0, never
busy), M records.

| Name | Type × count | Holds |
|---|---|---|
| `kind` | i32 × E | the row's kind, −1 if free |
| `gen` | i32 × E | its generation (0 if never used; kept when freed) |
| `at` | i32 × E | the station it is at, −1 if free or packed |
| `batch` | i32 × E | the row of the carrier it is packed on, else −1 |
| `holds` | i32 × E | the resource it holds a unit of, else −1 |
| `rank` | i32 × E | its place at its station from 0: a queue's order; a conveyor's from the lead; in a batch its load order; elsewhere by (the tick it came, ID); 0 if free |
| `made` | f64 × E | the time it was made, s (0 if free) |
| `d` | f64 × E | its distance along its conveyor, m (0 elsewhere) |
| `made_n`, `out_n` | i32 × K | made and taken out so far, by kind |
| `count` | i32 × (N + 1) | entities at each station now (work in progress); [N]: live entities |
| `left` | i32 × (N + 1) | departures so far (a source's: what it made; a sink's: what it took); [N]: taken out |
| `area` | f64 × (N + 1) | ∫ count dt so far, entity·s |
| `dwell` | f64 × (N + 1) | the departed entities' times at the station, summed, s (0 at sources and sinks); [N]: their times in system |
| `busy`, `cap` | i32 × R̂ | units held now; capacity |
| `busy_area` | f64 × R̂ | ∫ busy dt so far, unit·s |
| `thru`, `mean`, `p90`, `wip` | f64 × (N + 1) | over the window (below): departures an hour, their mean and 90th-percentile (nearest rank) time at the station (in all, in system), and the mean count |
| `clock` | f64 × 3 | now, window, warm-up (s) |
| `rec_n` | i32 × 1 | sink records so far |
| `rec_t`, `rec_w` | f64 × M | record i at index i mod M: its out time and its time in system, s (0 where none yet) |

**The window**, at now = c ticks: from a = max(c − W, U) to c (W, U the window and warm-up in ticks); before the warm-up
ends every statistic is 0. Its departures are those out at ticks a … c − 1. thru = departures × 3,600 ÷ ((c − a) ×
tick); mean and p90 over their times there (0 with none); wip = (∫ count dt from a to c) ÷ ((c − a) × tick). When the
window reaches back to the warm-up (c − W ≤ U), the library has these from its cumulative counts, exact at any length;
otherwise from the departures it keeps, the last M per station and the last M records in all, exact while they hold the
window's (this suite's do). p90 reads the kept departures.

### The judge

#981's `judge` call, unchanged for `lanes`, also judges every logic item with `process`:

```text
{"call": "judge", "piece", "track"?: [Entry] = [], "steps": n}
 → {"ok": true, "items": {<logic ID>: Judged}}
Judged = {"rules": {"process.conserve": Rule, "process.busy": Rule, "process.little": Rule}, "last": {<write name>: [value]}}
Rule   = {"verdict": "PASS" | "FAIL", "steps": the steps evaluated, "fails": [Fail] (the first 16, earliest first),
          "values"?: [Value] (process.little's)}
```

The run is steps 0 to n − 1, as a bake runs them; the rules read only the item's arrays (`kind`, `at`, `batch`, `holds`,
`made_n`, `out_n`, `busy`, `cap`, `left`, `area`, `dwell`, `clock`) and `process.kinds`, so they hold any library, a
planted one included. An item with `process` missing one of them, by name and type, is `bad_input`.

- **process.conserve**, at every step, for each kind i: held = the live rows of kind i that are at a station (0 ≤ `at` <
  N) or packed on a live carrier; gap = `made_n[i]` − held − `out_n[i]`; a nonzero gap is a fail `{"step", "kind":
  <name>, "gap", "made", "held", "out"}`.
- **process.busy**, at every step, for each resource j: holders = the live rows with `holds` = j; `busy[j]` ≠ holders,
  or either past `cap[j]`, is a fail `{"step", "resource": j, "busy", "holders", "capacity"}`.
- **process.little**, once, at step n − 1 (now T): over the window from the last step whose `clock[0]` is ≤ max(T −
  window, warm-up), or from 0 with every count 0 if none is, to T: for each station s and in all, L = Δarea ÷ Δt, λ =
  Δleft ÷ Δt, W = Δdwell ÷ Δleft (0 with no departure); a fail where |L − λW| > tolerance × max(|L|, |λW|), tolerance the
  pack's 0.02: `{"step", "station": s | "all", "wip": L, "throughput": λ × 3,600, "time": W}`; `values` lists the same
  for every station and all, failing or not. steps = 1.

### Fixtures

#416's interface fixtures. This suite's four (fixtures.ts: steady, belt, grant, pallet) have tolerance `{"abs": 1e-9}`
and an `answer`; the tests run them on the reference library themselves. Whether process@1 ships them is the
implementer's choice; criterion 8 runs process@1's own and these.

### Planted

process@1's first-party pack ships, among its `planted`, these two (each the reference library with one change):

- **`drop`**: in step 5 of a tick, a conveyor's lead that is at the end and was not taken in that tick's settle is
  removed from the belt and its row freed, with no sink and no record.
- **`over`**: a request station takes an entity while a resource among its own has busy ≤ capacity (one unit past it).

This suite carries each in its own pack `plants` (origin installed) as **`planted_process@1`**, its exports the ten,
with a fixture of its own (#190's rule) that both pass: criterion 1's model for three steps, importing
`lib:planted_process`, one record of 45 s a step. Without `implements` it links by its own name (criterion 6's judges);
with `implements: ["process@1"]` it must be refused at link (criterion 8). No `--planted` flag of deep-logic's is added.

### The warehouse (criteria 7 and 10)

A #391 film envelope (warehouse.ts), seed 980, 720 × 300 u, span 600 s at 60 frames a second: the logic item `wh` (the
warehouse scene, linking the reference library through process@1, its program writing `x`, `y` (f64 × E), `tile` (i32 ×
E) and `show` (bool × E) after process@1's arrays from `at`, `rank` and `d`); an atlas set `cases` whose free rows read
them (#535's logic columns); rects and labels for the inbound queue, the conveyor, the dock queue and two forklifts; and
the readout `rate`: `text: {counter: {source: "thru", tabular: true, format: {group: "none"}}}` with the driver `thru:
{target: "data/thru", expr: "x", vars: {x: "wh.thru[6]"}}` (#1183's driver var on one logic element; 6 is all). Nothing
new is asked of deep-show but that its logic items link first-party libraries and carry `process` (README: Readings).

## Scenes and expected values

scenes.ts holds each model as the builder calls its program makes; fixtures.ts works each run out in closed form and
writes it in its fixture's answer; programs.ts holds the WebAssembly text.

- **steady** (criterion 1): sink, a resource of capacity 1, a request holding 45 s, a fifo queue, a source every 60 s;
  tick 1/60 s, 3,600 ticks (a minute) a step, 600 steps (10 hours), step rate 1 Hz. Each minute: an order at its first
  tick, through the empty queue at once, held 2,700 ticks, out. After step k: k + 1 records of 45 s, busy area 45(k + 1)
  s of 60(k + 1) s: 27,000 ÷ 36,000 = 0.75 exactly at the end; the queue's dwell 0; every station's thru 60; the
  request's and all's wip 0.75 = (1/60) × 45; row 0 reused each minute (generation k + 1).
- **mm1** (criterion 2): a source of exponential gaps of mean 120 s, a queue, a request of exponential holds of mean
  60 s, a sink; tick 1 s, 3,600 ticks (an hour) a step, 3,400 steps, window 10⁹ s (the whole run). W = 1/(μ − λ) = 120
  s, L = λW = 1. 100,000 arrivals come after about 12.0 million s (σ ≈ 38,000 s), so 3,400 hours pass them.
- **belt** (criterion 3): belt A (10 m, 0.5 m/s, 0.6 m) to a sink, fed one case; belt B the same to nowhere, fed 18 at
  once; tick 1/60 s, a tick a step, 1,500 steps. P = 1,200 ticks (20 s), S = 72 ticks; case i of belt B enters at tick
  72i and stops at 1,200 − 72i (10 − 0.6i m) from step 1,199; ⌊1,200 ÷ 72⌋ + 1 = 17 ride; the 18th waits. The lone
  case: 10 m at step 1,199, out at tick 1,200 after 20 s.
- **grant** and **grant2** (criteria 4 and 6): three sources at t = 0 (rows 0, 1, 2) into three queues built in the
  reverse order, all into one request for either of two resources of capacity 1 (grant) or one of capacity 2 (grant2),
  held until released at steps 30 (entity 1), 50 (0) and 70 (2); tick 1/60 s, a tick a step, 100 steps. grant: 0 and 1
  granted at 0, 2 at 30. grant2 under `over`: all three at step 0.
- **pallet** (criterion 5): three cases straight out at t = 0, a blocker holding the forklift 40 s, then six cases (rows
  0, 1, 2 at generation 2; 4, 5, 6 at generation 1) and a pallet (row 7) at t = 1 s: packed at step 60, waiting in a
  queue until 2,400, held 30 s, unpacked at 4,200 into a queue that leads nowhere; 4,300 steps.
- **budget** (criterion 9): ten lines of source (200 at t = 0) → queue → conveyor (3 m, 0.6 m/s, 0.12 m: 300 and 12
  ticks) → queue → request (capacity 20, 3 s) → queue → request → queue → request → one shared sink; tick 1/60 s, a tick
  a step. 91 stations, 30 resources; nothing out before tick 840.
- **warehouse** (criteria 7, 10): exponential gaps of mean 6 s into an inbound queue, a 10 m belt into a dock queue of
  six, two forklifts (one resource of capacity 2, exponential holds of mean 10.8 s: ρ = 0.9), shipped; tick 0.2 s, a
  tick a step at 60 Hz, 128 rows, 1,024 records.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white
space collapsed. Each test's name starts with its criterion's ID.

| ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| 1 `#980.9b7dca8c` | `ac01-steady.test.ts` (1) | process@1's surface (exports, layout, rules, two plants, one reference); the steady fixture at steps 0, 1, 59, 60, 599; busy area ÷ (capacity × now) = 0.75 exactly at 36,000 s; the queue's dwell and count 0 at every step; all 600 records 45 s; process.conserve and process.busy PASS over 600 steps; process.little PASS with wip 0.75 at the request and in all. Fails: a share summed tick by tick (shown in node: 0.7499999999858871), a hold a tick long, a wait of a tick, a Little check that fails a right run |
| 2 `#980.042465a7` | `ac02-mm1.test.ts` (1) | at the first step with 100,000 made, `mean[N]` within 5% of 120 s and `wip[N]` within 5% of 1; two runs of seed 980 in two processes equal in every array at every step; seed 981 differs. Fails: a wrong mean or a draw that isn't exponential, a quantization biased past 5%, a run that reads the clock or an unseeded draw, a library that ignores the seed |
| 3 `#980.dc043458` | `ac03-belt.test.ts` (1) | the belt fixture; the lone case at 10 m at step 1,199, out at step 1,200 after 20 s; from step 1,199 belt B holds 17 at 10 − 0.6i m and the 18th is the infeed's head; process.conserve PASS over 1,500 steps. Fails: another speed, spacing ignored or overrun, a lead let off a blocked end, a case made or lost |
| 4 `#980.20657dee` | `ac04-grant.test.ts` (1) | the grant fixture; entities 0 and 1 hold units at step 0, entity 2 waits at its queue's head and is granted at step 30, the step entity 1 is released, not before; process.busy PASS over 100 steps. Fails: grants in station or queue order (entity 2 first), a grant a step late or early, busy counts apart from holders |
| 5 `#980.dd638207` | `ac05-pallet.test.ts` (1) | the pallet fixture; the six rows at the same kinds and generations (2, 2, 2, 1, 1, 1) unpacked as packed, in the out queue; batch 7 for all six from step 60 to 4,199; the pallet in the middle queue from 60 to 2,399; process.conserve PASS over 4,300 steps. Fails: an unpack that makes new entities or generations, members dropped, added or counted nowhere |
| 6 `#980.764570b6` | `ac06-planted.test.ts` (3) | under belt, a planted library of process@1 (as planted_process@1) FAILs process.conserve, first naming step 1,200, kind `case`, gap 1, and the reference passes; under grant2 one FAILs process.busy, first naming resource 0 and step 0, and the reference passes; process@1's entry copied into `processcopy@1.0.0` without planted libraries is `pack_refused` naming the interface, `processcopy@1.0.1` with them installs. Fails: a conserve or busy rule blind to the plant, a pack check that lets an interface ship no plant |
| 7 `#980.2ee8b80a` | `ac07-throughput.test.ts` (2) | the warehouse presented with no `number_unsourced`; at 20 steps (18,000 + 900j) the readout's drawn text, by deep-show's `eval`, equals the count of sink records out in the last 3,600 s by deep-logic's `playback` of the same item (and `thru[6]`), the counts not all equal; the document with `rate` typed "46" raises `number_unsourced` naming `rate`. Fails: another window or unit, a stale or stuck readout, a check blind to a typed number |
| 8 `#980.0e3bb315` | `ac08-hosts.test.ts` (2) | a piece linking the reference library: every process@1 fixture ran and PASS in the receipt; each planted library claiming process@1 is `link_refused` naming process@1 and a fixture. Each of process@1's fixtures and this suite's four: the same step hash at every step and the same checkpoints on this core and in headless Chrome, and for process@1's the receipt's deep_hashes. Fails: a link with fixtures unrun or failing, a web runner whose steps differ |
| 9 `#980.238de3e1` | `ac09-budget.test.ts` (2) | the budget model: 40 queues, 30 resources, 10 conveyors, 2,000 live at each of 420 steps without a trap, resources busy, conserve and busy PASS. Timing: five runs of 60 interleaved one-step frames, step = median busy − median idle under 300 µs, by judgeLimit with loads. Fails: a slow step; INCONCLUSIVE off the reference Mac or under load |
| 10 `#980.755cceac` | `ac10-taste.test.ts` (1) | three screenshots by `eval` (model 30, 60, 90 min) and a 180-frame recording by `frames`, all from deep-show's own frames, written to `docs/evidence/980/` with their hashes, the screenshots differing; then TASTE.json: none or on other pictures INCONCLUSIVE, `looks_wrong` FAIL, `looks_right` on exactly these PASS |

Test count: 1 + 1 + 1 + 1 + 1 + 3 + 2 + 2 + 2 + 1 = 15.

## Planted twins

| Name | Criterion | The wrong program | Carried by |
|---|---|---|---|
| `drop` | 6, 8 | a blocked belt end's lead is freed, no sink | process@1's first-party pack; linked here as `planted_process@1` |
| `over` | 6, 8 | a resource grants one unit past its capacity | process@1's first-party pack; linked here as `planted_process@1` |
| `processcopy@1.0.0` | 6 | process@1's entry with no planted library (must be refused) | this suite (pack_check) |
| the label typed "46" | 7 | the readout's text typed over (must fail honest numbers) | this suite (warehouse.ts: `typed`) |
| the seed-981 run | 2 | must differ from seed 980's | this suite |
| node-side runs | 1 | a share summed tick by tick; a 2,701-tick hold | this suite (ac01) |

## Readings where the issue leaves a choice

- **"The model in memory"**: the builders are the exports with the issue's Fields' shapes (`source {kind, every |
  at | mean_gap, until}` as `source`'s parameters, and so on), called in `init`; the model's wiring is each station's
  `to`, which the Fields leave out and a flow needs. `stats {window, warmup}` and the seed, rows and ring sit in the
  header, since `stats` is also what advances the model: the ten exports hold no other place to run a step. `at: table
  ID` is the address of the table in memory (a program copies it from an asset or holds it as data; this suite's hold
  it as data). `path: path ID` is drawing's, not the library's: the library writes `d`, a document draws it on a path
  (the warehouse draws on a straight line, its program mapping d). Only `kinds` is in the document, for the judge.
- **"At a 1/60 s step"**: the model's tick; a logic step may run many ticks. Criterion 1's 10 hours run 2,160,000 ticks
  in 600 steps; a step a tick would be 2.16 million bakes' steps.
- **Criterion 2's run**: the tick is 1 s and a step an hour (3,334 steps to 100,000 arrivals), times rounded to the tick.
  The reference model of the step contract (Checked, below) gave, for seeds 980, 981 and 7, W = 118.7, 120.1 and 119.8 s
  and L = 0.988, 0.998 and 0.997: the rounding costs about 1%, well inside 5%, and every event stays on integer ticks,
  so the same seed gives the same bytes everywhere. A step a tick of 1 s would be 12 million steps; exact event times
  within a step were not needed. "Over 100,000 arrivals": read at the first step whose end has 100,000 made.
- **"Busy share"**: `busy_area` ÷ (capacity × now). **"Nothing ever waits"**: the queue's dwell is 0 at every step
  (no entity spent a tick there) and it holds none at a step's end. **"Time in system"**: a sink record's `rec_w`.
- **"Station"** for Little's law: every station, and the system as "all"; a source's and a sink's are trivially 0 = 0.
  **"A declared window past the warm-up"**: the header's window and warm-up, judged once at the run's last step.
- **"Two resources … three requests … the two lowest entity IDs"**: one request station takes either resource, so "the
  first release" frees a unit the third can take; requests ask when they reach their queue's head, and the settle grants
  by (ask tick, ID). Releases are the program's `release` calls, so the step of the first release is exact.
- **"Carried through a queue"**: the packed pallet waits in a queue (for a forklift a blocker holds), then is held by the
  forklift; conserve is read at every step it is packed. **"With their generations"**: three of the six reuse rows, so
  their generations are 2.
- **"Never make or drop an entity outside a source or a sink"**: a pack loads members onto a carrier a source made; it
  makes nothing.
- **"Drops a case when the belt end blocks"**, **"grants a third request on a resource of capacity 2"**: README:
  Planted. "Naming the resource" is its ID, `resource: 0`.
- **"A bound value reading throughput over the last hour"**: a bound value's sources are the record's handles, and a
  logic array is the document's own: the readout is a text counter on a driver reading `wh.thru[6]`, "computed in the
  document" in Honest numbers' first form. "The count of sink records in that window": records out at ticks in [c −
  18,000, c) at now = c ticks, read from deep-logic's `playback` of the same item. "A planted label typed as 46": the
  readout's text typed as "46", `number_unsourced` (#406's code) naming `rate`.
- **"Links only after every fixture passes on this core and in headless Chrome"**: as #981 read it: on this core, the
  receipt; in Chrome, every fixture's step and checkpoint hashes equal this core's.
- **Budget**: "steps in under 0.3 ms a step" is a step of the busy program less an idle frame, both with 2,000 live, CPU
  time a frame reports (`eval_ns`), in the debug build the suite builds.

## Not covered, because no criterion reaches it

`order: 1` queues; `until`; `unpack` of an entity with no members; a carrier into a sink; `p90`'s values; sliding
windows past M departures; per-station windowed statistics beyond the steady run's; `kinds` past one or two; rows
exhausted; builders' −1; `path`; deep_kinds' listing of process@1; process@1 as lanes@1's resource; the state's bytes.

## Checked before the base run

A temporary test (deleted) held this suite's own pieces to real components, with a reference model of README: The step
contract in JavaScript (sources and draws, the settle by (ask tick, ID), holds, releases, belts, pack and unpack, the
counters, the windowed statistics, the judge's three rules, and both planted changes) standing in for process@1's
exports: each program assembled as a relocatable object by #416's assembler and, from the same text, as a whole module,
which Node's WebAssembly ran with those exports as its imports, its header and builder calls recorded, its arrays
decoded from its write region.

- steady, belt, grant and pallet: every fixture array at every listed step equals the decoded arrays; conserve, busy
  and little hold; the share is 0.75 exactly. The model's little values: 0.75 at the request and in all.
- belt under `drop`: process.conserve's first fail is step 1,200, `case`, gap 1. grant2 under `over`: process.busy's is
  step 0, resource 0. Both plants pass their own fixture (records 1 and 3, busy area 45 and 135).
- mm1: the wiring and the draws (the model gave the W and L above); budget: 2,000 live at all 420 steps, resources busy,
  rules hold, nothing out; idle: the same model built, nothing stepped. warehouse: every row's x, y, tile and show as
  programs.ts maps them, for 4,000 steps; over the model's 20 sampled steps the counts run 567 to 617 a window, the
  ring holds them, `thru[6]` equals each, and the belt fills to 17 at times.

Not checked: the suite's run at the base (BASE-FAILURE.txt: the build grant didn't come; it records what each test
calls first and what the base answers there); anything of the implementation (none exists); deep-show
drawing this document (its logic links a library nothing implements yet); Chrome and the timings.

## The taste call

`tests/acceptance/980/TASTE.json` is the one file anyone adds to this folder after this commit, and only to record the
owner's call on exactly the pictures criterion 10 writes: `{"issue": 980, "criterion": "#980.755cceac", "verdict":
"looks_right" | "looks_wrong", "who", "when" (ISO 8601), "screenshots": {<file name>: <sha256>} for the four files,
"note"?}`.
