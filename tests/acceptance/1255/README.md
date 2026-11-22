# Acceptance tests for #1255: separation@1, movers that must keep apart (criteria 1 to 7)

Written first, blind, from issue #1255 (its saved body: the opening paragraph, Runs on, Scope, Fields, seven
acceptance criteria, Proof and Not in scope; it has no comments and no Oracle line, so nothing is ported), the design
sections it names and the base commit `9f97c35ef` ("Merge pull request #3039 …"), by a job that never saw an
implementation; none existed, and no other branch, worktree, pull request, plan or session was read. The implementing
agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue, whole. Its own spellings are kept: the exports `mover`, `minima`, `closest`, `conflicts`,
  `next_conflict`, `delay` and `apply`; the layout `separation.state@1` and what it holds; the `mover` and `minima`
  shapes; a row's `basis`; the three controls; the rules `separation.clear {span}` and `separation.exact {tolerance: s
  = 0.5}`; the order `delay` tries; position linear between fixes; every number in the criteria.
- `docs/canvas-primitives.md`: Units and axes; Honest numbers (both); Logic: library interfaces (its `separation@1`
  sentences, and how `lanes@1`, `process@1` and `circuit@1` and their kind rules are stated); Logic: library
  interfaces: mods.lib@1 with its As built; Logic: linked libraries; Logic `logic@1`; Logic: sandbox; Logic: data
  layouts; Logic: saves across changes; Input track; Input track entries; Control; Bound value; Check input: logic
  kinds; Pack; Pack: kinds in any pack; Pack: kind rules and the kind kit; Registry and seal: registries.
- `docs/technical-design.md`: The logic module (Logic, Sandbox and budgets, Logic bake and checks, Linked libraries,
  Library interfaces, Data layouts); Criteria to tests; Criteria in a checked shape; Wrong programs; Dogfooding; "A CPU
  reference counts as an oracle only once…"; Built to be hard to get wrong. `docs/parallel-proof.md` section 7.
  AGENTS.md, CONTRIBUTING.md.
- At the base, for call shapes only: `tests/acceptance/981/` and `953/` (README, helpers, programs, tests), `190/`
  (README, helpers, the assembler), `416/interfaces/` (helpers, programs, `wat.ts`), `531/` (README: bakes, steps,
  checkpoints), `202/`, `1217/`, `2874/` and `2898/` (`twins.json`, `lane.json`); `crates/deep-logic/src/` (`lib.rs`' calls,
  `first_party.rs`, `interfaces.rs`, `fixtures.rs`' pack check, `judge.rs`, `piece/checks.rs`' item fields, `live.rs`'
  frames); `packs/lanes-1.0.0/` (pack.json, LAYOUT.md); `scripts/{proof-change,proof-runs,proof-guard,lanes,benchmark,
  throttle,studied-names}.mjs`.

## What the base already does, and these tests don't credit

Run at the base (README: Checked before the base run): `first_party` lists `interfaces@1.0.0` (physics2d.lib@1, fsm@1,
nn.mlp@1), `lanes@1.0.0` (lanes@1) and `modslib@1.0.0` (mods.lib@1). Nothing names `separation@1`. A logic item's
`separation` is refused (`logic_refused`, "logic@1 has no field separation"). `judge` answers `{"ok": true, "items":
{}}` for an item without `lanes`. `pack_check` reads no `twins` and runs no kit: an interface's entry carrying an
unknown `twins` installs. Everything else these tests drive is on the base and passes there for a program of this
suite's linked to a do-nothing library: links by name and by interface, bakes with step hashes and a checkpoint at
every step, `web_plan`, `view` and `frame`, the layout probe. No test passes because of any of it: each one first
needs the first-party pack that declares `separation@1`, and fails there (BASE-FAILURE.txt).

## Run them

```sh
npm ci && npm run build --workspaces                 # once, in a fresh worktree
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node scripts/throttle.mjs build --wait 180 -- sh scripts/lease \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/1255 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1255/tsconfig.json
rm -rf tests/acceptance/1255/node_modules           # vitest's cache
```

What a run builds, honoring `CARGO_TARGET_DIR`: `deep-logic` for this host (#190's helpers, imported unchanged) and
#416's assembler (`../416/interfaces/wat.ts`, into `target/acceptance-416-wat`). `ac5-hosts.test.ts` also builds
`deep-logic` for linux/amd64 in Docker (#190's `onLinux`: it pulls nothing; hours when cold under emulation) and
starts headless Chrome (`CHROME_BIN` or the usual paths). Every test passes #190's 90-minute timeout.

Gates: a missing host is `BLOCKED:`, never a pass (#190's). The timing is judged by `scripts/benchmark.mjs`'s
judgeLimit with the one-minute load at each run's start and end: off a reference Mac, under load, or with readings
neither all in nor all out of the limit it fails `INCONCLUSIVE:` with its readings, never a pass; its structure is the
other test of that file and runs on any machine. Nothing else depends on the machine's load. `lane.json` says the
folder runs alone (its files build cargo binaries). `twins.json` maps criteria 1, 4 and 7 to the planted libraries'
names (without the `@1`, which a twin's name can't hold), as #202's and #1217's do; every test fails on the merge base
at its own assertion, so no twin folder is needed.

## The surface

The issue names an interface, its exports, its layout and its shapes as data, but no command line, WebAssembly
signature, memory or encoding. As in #981's and #953's suites the surface is `deep-logic` (#531's, #532's, #190's and
#416's JSON-lines protocol and #981's `judge`, unchanged where not named here), and **every signature, array, code,
document key, call field, reply field, refusal field, kit field and planted name below that is marked *(mine)* is this
job's invention**: the least the criteria need, in the issue's and the design's spellings where they have them. The
implementer builds exactly these, or a dispute goes to a blind redraft.

### The first-party pack

`{"call": "first_party"}` lists a first-party pack (any name) whose `interfaces` hold **`separation@1`**, #416's
Interface, with:

- `exports`: exactly the seven below with their signatures *(mine)*, such as
  `{"name": "closest", "params": ["i32", "i32", "i32", "f64", "f64"], "results": ["f64"]}`;
- `layout: "separation.state@1"`; at least one fixture; `planted`; `digest` (#416's: exports, layout and fixtures);
- **`"rules": {"separation.clear": {}, "separation.exact": {"tolerance": 0.5}}`**: the interface's kind rules, each
  with its params' defaults, as #981's entry carries `lanes.clear` and `lanes.stuck` (`span` has no default);
- **`"twins": [{"planted": <asset ID>, "example": <asset ID>, "expect": <rule code>}]`** *(mine)*: its kind kit's
  planted twins, exactly one for each rule (README: The kind kit).

The same pack's `libs` holds exactly one library whose `implements` names `separation@1`: **the reference library**
(any name@version), with fixtures of its own (#190's rule); its object is among `first_party`'s assets. A piece links
it by that name and hash and imports the exports as `lib:separation@1.<export>`.

### Pieces

```text
LogicParams gain "separation": {"movers": [Mover], "minima": Minima}                                    (mine: the key)
Mover  = {"id", "class", "route": [{"fix": name, "at": [x, y, z]}], "speed": [{"from_fix": name, "speed": m/s}],
          "band": [{"fix": name, "min": m/s, "max": m/s}], "start": s}
Minima = {"lateral": m, "vertical": m, "by_pair": [Row]}
Row    = {"leader": class, "follower": class, "min": m, "at": <fix name> | "always", "basis": Basis}
Basis  = {"cited": {"source": string, "section": string}} | "invented"
```

- The issue's shapes, as JSON. *(Mine)*: the key `speed` for the number the issue gives only by its unit in
  `speed: [{from_fix, m/s}]`; `at` as a fix's name or the word `"always"`; a basis as the tagged form above. Example:
  `{"leader": "heavy", "follower": "light", "min": 11112, "at": "threshold", "basis": "invented"}`.
- **`at: [x, y, z]`** is a point in metres with +Y up (design: Units and axes), so `y` is the altitude and (x, z) the
  lateral plane. Bare numbers, in the field's unit. Times are seconds on the piece's clock.
- A mover's `speed` entry holds from its fix until the next entry's fix; this suite gives one for every fix but the
  last, and a `band` entry for every fix. Movers and fixes are known by index: mover `i` is `movers[i]`, fix `j` of a
  mover is `route[j]`.
- An item with `separation` exports `assets_at`: the table the check builds from it is the item's **asset 0**, copied
  there (after its u32 length) before the start function, ahead of any asset it names, as #981's lane graph is. Its
  bytes are the check's and the library's to agree on (the pack documents them); the tests read them nowhere.
- **Refusal at check**: a `by_pair` row with no `basis` is `{"ok": false, "code": "logic_refused", "item": <logic ID>,
  "refusals": [Refusal]}` with one refusal **`{"rule", "what", "row": <its index in by_pair>}`** per such row *(mine:
  `row`; `rule` and `what` are the implementer's)*.

### Exports of separation@1 *(signatures mine)*

`s` is the address of the state in the caller's memory. Every result but `closest`'s is an i32.

| Export | Signature | Does |
|---|---|---|
| `minima` | (s i32, g i32) → i32 | starts the state at `s` from the built table at `g` (asset 0's bytes: `assets_at + 4`): the minima and their rows, no movers; returns the state's size in bytes |
| `mover` | (s i32, i i32) → i32 | adds mover `i` of the table as its document data give it; it is mover `i` everywhere; returns `i`, or −1 for an index out of range or added before. A mover not added is in no pair |
| `closest` | (s i32, a i32, b i32, t0 f64, t1 f64) → f64 | the smallest distance between movers `a` and `b` over [t0, t1] (README: Closest), also written with its pair and time as the state's closest pair; −1, writing nothing, when the two share no time in the span |
| `conflicts` | (s i32, t0 f64, t1 f64) → i32 | every window over [t0, t1] (README: Windows), written as the state's windows; returns how many |
| `next_conflict` | (s i32, t f64) → i32 | the first window `conflicts(s, t, ∞)` would list, written as the state's one window; 1, or 0 with none. No criterion reads it |
| `delay` | (s i32, m i32, seconds f64, t f64, c i32) → i32 | the control that delays mover `m` by `seconds`, asked at time `t` (README: The delay rule), written as a control record at `c`; returns its kind, or 0 for a refusal, whose record says why |
| `apply` | (s i32, c i32) → i32 | applies the control record at `c` to its mover as given (it reads no band) and writes the mover's slots again; 1, or 0, changing nothing, for a refusal's record |

`delay` takes `t` because "its next named fix" and "not yet started" need a time and a library reads no clock: a
program passes its step's time, or any other.

### Memory, and the state and its arrays

The library keeps its state in the caller's memory from `s`, at most 1 MiB, and nothing else of the caller's but the
control record `delay` writes at `c`. **The state's head is `separation.state@1`'s arrays** *(mine: every name, type,
count, order and code; the issue gives what they hold and that each has a unit)*, for the M movers of the table, each
array 8-aligned in this order, which is the region map's own layout for writes declared in this order. So an item
declares them first, and a program publishes them with one copy of the head over its write region after its calls.
What the library keeps past the head is its own.

| Array | Type × count | Unit | Holds |
|---|---|---|---|
| `fix_count` | i32 × M | | how many slots mover i flies: its route's fixes, and the off-route point a stretch adds; 0 until `mover` adds it |
| `fix_ref` | i32 × 8M | | slot q of mover i is entry 8i + q, in the order flown: the fix's index in the mover's document route, or −1 for a stretch's point |
| `fix_pos` | vec3 × 8M | m | the mover's position at the slot, `[x, y, z]` |
| `fix_speed` | f64 × 8M | m/s | its speed on the leg leaving the slot (its last slot's isn't read) |
| `fix_time` | f64 × 8M | s | its time at the slot |
| `delay_s` | f64 × M | s | the delay asked of mover i whose control was applied; 0 with none |
| `delay_fix` | i32 × M | | the fix where that delay was asked, by its index in the mover's document route; −1 with none |
| `win_count` | i32 | | how many windows the last `conflicts` (or `next_conflict`) found |
| `win_a`, `win_b` | i32 × 64 each | | window k's pair, by mover index, a < b |
| `win_from`, `win_to` | f64 × 64 each | s | its start and its end |
| `win_min` | f64 × 64 | m | the minimum that applied: the table's `lateral`, or a row's `min` |
| `win_row` | i32 × 64 | | that row's index in `by_pair`, or −1 for the table's `lateral` |
| `win_basis` | i32 × 64 | | that row's basis: **0** no row, **1** cited, **2** invented |
| `closest_a`, `closest_b` | i32 each | | the pair the last `closest` was asked of, a < b |
| `closest_dist` | f64 | m | their smallest distance |
| `closest_time` | f64 | s | when |

Eight slots a mover and 64 windows written (`win_count` may be more; this suite's largest is 9). For M = 3 the arrays
start at 0, 16, 112, 688, 880, 1072, 1096, 1112, 1120, 1376, 1632, 2144, 2656, 3168, 3424, 3680, 3688, 3696 and 3704,
3,712 bytes in all; for M = 40, 17,320 bytes (`programs.ts`: `stateWrites`, `offsets`; the tests hold `check`'s region
map to them). `apply` sets `delay_s` and `delay_fix` from the mover's last `delay` that gave a control: the seconds
asked, and the far end of the leg it was asked on (README: The delay rule), for a hold too. A bound value or a readout
reads each array by the item's path, `<logic ID>.<name>`, as any logic array.

This suite's programs (`programs.ts`: `script`) read at 0, write at 4,096, keep their data at 49,152 (the libraries'
data follow it), export `assets_at` 262,144 and put `s` at 1 MiB, in a memory of 32 pages (2 MiB). `init` calls
`minima`, then `mover` for 0 to M − 1; each step makes its calls, then copies the head to `writes_at`. Every item gives
`budget.fuel` 10,000,000, the cap.

### The control record *(mine)*

48 bytes at `c`, six fields of 8 bytes each (an item may declare them as six arrays of count 1 in this order):

| At | Field | For `speed` | `stretch` | `hold` | a refusal |
|---|---|---|---|---|---|
| +0 i32 | kind | 1 | 2 | 3 | 0 |
| +8 i32 | mover | its index | | | |
| +16 i32 | from | `from_fix` | `leave_fix` | −1 | with why 1: the fix whose band forbids the speed; else −1 |
| +24 i32 | to | `to_fix` | `rejoin_fix` | −1 | −1 |
| +32 f64 | value | m/s | `offset`, m | s | with why 1: the speed the delay needs, m/s |
| +40 i32 | why | 0 | 0 | 0 | **1** the band, **2** no leg left |

Fixes are indexes in the mover's document route. These are the issue's three controls, `speed {mover, from_fix,
to_fix, m/s}`, `stretch {mover, leave_fix, rejoin_fix, offset: m}` and `hold {mover, s}`, as data a piece can carry:
criterion 1's piece carries a hold in its data segment and applies it. A script of this suite that asks a delay
declares, after the state's arrays, `<name>_kind`, `<name>_mover`, `<name>_from`, `<name>_to`, `<name>_value` and
`<name>_why` (the record `delay` writes there), then its own `<name>_ret` and `<name>_did`: what `delay` and `apply`
returned for it. Example, criterion 3's speed control as the bake shows it: `given_kind [1]`, `given_mover [1]`,
`given_from [0]`, `given_to [1]`, `given_value [71.2307…]`, `given_why [0]`, `given_ret [1]`, `given_did [1]`.

### The judge

```text
{"call": "judge", "piece", "track"?: [Entry] = [], "steps": n, "rules"?: {<rule code>: params}}        (mine: rules)
 → {"ok": true, "items": {<logic ID>: {"rules": {"separation.clear": Rule, "separation.exact": Rule}}}}
Rule = {"verdict": "PASS" | "FAIL", "fails": [Fail]}
```

#981's call, for every logic item with `separation` (the check's refusal as `check` gives it). `rules` gives each
rule's params; one left out takes the pack's default. This suite always gives `{"separation.clear": {"span": [t0,
t1]}}` and leaves `separation.exact`'s tolerance at the pack's 0.5 s. The run is steps 0 to n − 1, as a bake runs
them, and **both rules read the item's arrays as the last step left them**, with the item's `separation`: the movers
as the library says they fly (`fix_count`, `fix_ref`, `fix_pos`, `fix_speed`, `fix_time`), never its `win_*` arrays.
So they hold any library, a planted one included.

- **`separation.clear {span}`**: the windows of README: Windows over the span, worked by the judge in closed form
  from those slots and the item's minima. None is PASS. Each is a fail **`{"pair": [<mover id>, <mover id>],
  "window": [from, to], "min": m, "row": <index> | null}`** *(mine)*, the pair in index order, in `conflicts`' order.
- **`separation.exact {tolerance}`**: for each mover with `delay_fix` f ≥ 0, its time at the slot whose `fix_ref` is f,
  less its time at that fix by its document data, less `delay_s`: more than `tolerance` either way is a fail
  **`{"mover": <id>, "fix": <name>, "time": <seconds off>}`**. And for every mover, each leg's `fix_speed` against the
  band at the leg's first fix (a stretch's second leg: the fix it left): under `min` or over `max` is a fail
  **`{"mover": <id>, "fix": <the band's fix>, "speed": m/s}`** *(mine)*. No fail is PASS. This suite applies at most one
  control to a mover.

### The kind kit

The issue says "Kind rules (#202), in the interface's pack" and criterion 7 "the interface's kind kit". #202's rules
are expressions of at most 64 ops over a recipe's values, which can't solve a pair's quadratic, so the rules are
carried as #981 carries `lanes@1`'s: named with their defaults on the interface's entry, read by `judge`. The kit is
#202's, moved to an interface: "each rule's planted twin fails with that rule's code", run at pack check, a kit that
fails refusing its pack.

- A twin is `{"planted", "example", "expect"}`: one of the interface's `planted` libraries, a fixture the pack
  carries (#416's fixture shape, with whatever it needs to name its span; the tests read only that the pack carries
  it), and the rule's code. Run on its example, the planted library raises `expect` and no other rule, and the
  reference library raises none.
- **`pack_check`** of a pack whose interface carries `twins` runs each one. Its reply's entry for the interface gains
  **`"kit": [{"planted", "example", "expect", "raised": [<rule code>]}]`** *(mine)*, `raised` the rules that failed. A
  twin whose `raised` lacks its `expect` refuses the pack: `{"ok": false, "code": "pack_refused", "pack", "refusals":
  [{"rule", "what", "interface": <name>, "planted": <asset ID>, "expect": <code>, "raised": [<code>]}]}` *(mine: the
  last three)*. The interface's `digest` stays #416's, so changing `twins` doesn't change it.

### Planted twins *(names mine)*

Both are libraries the interface's pack ships in `planted` and names in `twins`; #416's rule also holds each to
failing one of the interface's fixtures. Each is the reference library with one change, and nothing else of it
differs. This suite links each by its own name from a pack `plants` of its own (origin installed), with a fixture of
its own that any separation@1 library passes (#190's rule): the approach loaded, importing the library by its own
name, `fix_count` `[3, 3, 2]` at step 0. No `--planted` flag of deep-logic's is added.

| Name here | The twin for | The wrong program |
|---|---|---|
| `once_a_second@1` | `separation.clear` (criterion 1) | `conflicts` and `next_conflict` test each pair only at the whole seconds k, t0 ≤ k ≤ t1, at which both movers are on their routes. Each run of seconds in a row at which the pair is under the table's lateral and vertical minima is one window, from its first second to its last. What it does with rows measured at a fix isn't read |
| `leaves_band@1` | `separation.exact` (criterion 4) | `delay` reads no band: whenever the mover has a leg left it gives `speed {mover, from: the leg's first fix, to: its far end, the leg's length ÷ (its time + seconds)}` |

### One example of each, as the tests write and read them

```text
item     {"kind": "logic@1", "params": {"program": <sha>, "writes": {"fix_count": {"type": "i32", "count": 3}, …},
          "budget": {"fuel": 10000000}, "links": [{"name": <the reference library's>, "asset": <sha>}],
          "separation": {"movers": [{"id": "follower", "class": "light",
              "route": [{"fix": "entry", "at": [-37040, 600, 0]}, {"fix": "final", "at": [-18520, 600, 0]}, {"fix": "threshold", "at": [0, 600, 0]}],
              "speed": [{"from_fix": "entry", "speed": 92.6}, {"from_fix": "final", "speed": 92.6}],
              "band": [{"fix": "entry", "min": 60, "max": 100}, {"fix": "final", "min": 60, "max": 100}, {"fix": "threshold", "min": 60, "max": 100}],
              "start": 100}, …],
            "minima": {"lateral": 5556, "vertical": 300, "by_pair": [{"leader": "heavy", "follower": "light", "min": 11112, "at": "threshold",
              "basis": {"cited": {"source": "tests/acceptance/1255/README.md", "section": "Fixtures: approach: the rule sheet"}}}]}}}}
refusal  {"ok": false, "code": "logic_refused", "item": "approach", "refusals": [{"rule": …, "what": …, "row": 1}]}
arrays   a bake's step: "approach.win_count": [1], "approach.win_a": [0, …], "approach.win_b": [1, …], "approach.win_from": [400, …],
         "approach.win_to": [400, …], "approach.win_min": [11112, …], "approach.win_row": [0, …], "approach.win_basis": [1, …],
         "approach.fix_count": [3, 3, 2], "approach.fix_ref": [0, 1, 2, -1, …], "approach.fix_time": [0, 200, 400, …],
         "crossing.closest_a": [0], "crossing.closest_b": [1], "crossing.closest_dist": [2400], "crossing.closest_time": [107.2]
judge    {"call": "judge", "piece": …, "track": [], "steps": 2, "rules": {"separation.clear": {"span": [0, 400]}}}
       → {"ok": true, "items": {"breach": {"rules": {
           "separation.clear": {"verdict": "FAIL", "fails": [{"pair": ["east", "north"], "window": [100.2, 100.8], "min": 5556, "row": null}]},
           "separation.exact": {"verdict": "PASS", "fails": []}}}}}
exact    "separation.exact": {"verdict": "FAIL", "fails": [{"mover": "follower", "fix": "entry", "speed": 71.2307…}]}
twins    "twins": [{"planted": <sha>, "example": <sha>, "expect": "separation.clear"}, {"planted": <sha>, "example": <sha>, "expect": "separation.exact"}]
kit      {"call": "pack_check", "assets": …, "pack": {"name": "sepcopy", "version": "1.0.0", "origin": "installed", "libs": {},
           "interfaces": {"separation@1": <the first-party entry>}}}
       → {"ok": true, "pack": "sepcopy@1.0.0", "installed": true, …, "interfaces": [{"name": "sepcopy.separation@1", "label": "separation@1", …,
           "kit": [{"planted": <sha>, "example": <sha>, "expect": "separation.clear", "raised": ["separation.clear"]}, …]}]}
         the same with the two `expect`s swapped, as 1.0.1
       → {"ok": false, "code": "pack_refused", "pack": "sepcopy@1.0.1", "refusals": [{"rule": …, "what": …,
           "interface": "sepcopy.separation@1", "planted": <sha>, "expect": "separation.exact", "raised": ["separation.clear"]}, …]}
plants   {"name": "plants", "version": "1.0.0", "origin": "installed",
          "libs": {"once_a_second@1": {"asset": <sha>, "exports": [the seven names], "fixtures": [<sha>]}}}
         its program imports `lib:once_a_second.<export>` and its item links {"name": "once_a_second@1", "asset": <sha>}
```

The tests find the interface in `pack_check`'s reply by its `label`, and take a refusal's `interface` as
`separation@1` or `sepcopy.separation@1`.

## The distance, window and delay rules

Everything below the issue's own sentences is this job's reading, stated so a library matches these windows to 1e-6 s.

- **Where a mover is.** Its time at its first fix is `start`; each leg takes its straight-line length (altitude
  included) ÷ the speed given from its first fix. Its position is linear in time between slots. It is **on its
  route** from its first slot's time to its last's, both included; outside that it has no position and is in no pair.
- **Distances.** At a time when both are on their routes, a pair's **lateral distance** is the length of the (x, z)
  part of the vector between them and its **vertical distance** the size of the y part. `closest` measures the
  straight line between them, all three parts.
- **Under its minimum.** A pair is under its minimum at t when its lateral distance is below the lateral minimum that
  applies **and** its vertical distance is below `vertical`. Both are strict: at equality the pair is not under it.
- **Closest.** Over the times in [t0, t1] at which both are on their routes, cut wherever either passes a slot: on
  each stretch both keep one velocity, the squared distance is a quadratic in time, and its least value is at its
  vertex, held to the stretch. The smallest of them is the answer, the earliest time on a tie.
- **Windows.** For each pair a < b and the table's `lateral`: the set of times in [t0, t1], both on their routes, at
  which the pair is under its minimum. On each stretch that is between the two roots of the lateral quadratic and
  between the two crossings of the vertical line. Each maximal stretch of time in that set is one window, from its
  first time to its last: pieces that meet at a slot's time are one window, and a window the span or a route cuts
  ends there. Windows are listed by start, then a, then b; the tests compare them as a set.
- **A row measured at a fix** (`at: <fix name>`). For movers i of class `leader` and j of class `follower` whose
  routes both hold that fix, i passing it before j: at the time i passes it, if that is in [t0, t1] and j is on its
  route, and the pair's lateral distance is below the row's `min` and its vertical distance below `vertical`, the row
  gives one window of that instant: `from` and `to` both that time, `min` the row's, `row` its index, `basis` its
  code. It is a window of its own.
- **The delay rule**, `delay(m, seconds)` asked at t. The mover's **next leg** runs from the first fix it has not left
  at t (the first slot whose time is at or after t; its start while it hasn't started) to the fix after it, where the
  delay is wanted: "its next named fix". With no such leg it refuses, why 2. Else, in the issue's order:
  1. **speed**: the leg's length ÷ (its time + seconds), when the band at the leg's first fix holds it: `speed
     {m, from: that fix, to: the next}`;
  2. **stretch**, unless the leg is the route's last (a stretch rejoins at a fix the mover flies on from): `stretch
     {m, leave: the leg's first fix, rejoin: the next, offset}`, the leg's midpoint moved `offset` to the left of
     travel in the lateral plane, both halves flown at the leg's speed, so `offset` = ½√((length + speed × seconds)² −
     length²);
  3. **hold**, for a mover not yet started (t before its `start`): `hold {m, seconds}`;
  4. else it **refuses**, why 1, naming the band: the mover, the leg's first fix, and the speed the delay needs.
- **Apply.** A speed holds from `from` to `to` and the speeds after stay as they were; a stretch adds its point as a
  slot between the two (`fix_ref` −1); a hold moves the start, so every time, by its seconds.

## Fixtures

`scenes.ts` holds them; `model.ts` works every expected value in closed form, and the tests hold it to the values
worked by hand here. Its wrong twin, a sampler at whole seconds (`sampledClosest`, `sampledConflicts`), fails them.
Every scene's minima are lateral 5,556 m and vertical 300 m.

- **crossing** (criterion 1). Before a turn by the 3-4-5 angle (so neither route lies along an axis), `east` flies +x
  from (−20,000, 0) at 200 m/s and `north` +z from (0, −18,000) at 150 m/s, both from t = 0, level at 3,000 m, over
  [0, 200] s. North from east is (20,000 − 200t, 150t − 18,000); its squared length is least where −400(20,000 − 200t)
  + 300(150t − 18,000) = 0, at t = 13,400,000 ÷ 125,000 = **107.2 s**, where it is (−1,440, −1,920): **2,400 m**. That
  is inside the span and not zero. They close at 250 m/s, so the pair is under 5,556 m for √(5556² − 2400²) ÷ 250 =
  20.0436 s either side: 87.1564 s to 127.2436 s. A sampler's closest is 2,400.52 m at 107 s, and its window seconds
  88 to 127.
- **breach** (criterion 1). `east` flies +x at 200 m/s from t = 0 and `north` +z at 150 m/s from t = 10 s, level,
  closing at 250 m/s and placed to pass √(5556² − 75²) = 5,555.4938 m apart at 100.5 s. Their distance is
  √(5555.4938² + (250(t − 100.5))²), under 5,556 m while 250 × |t − 100.5| < 75: **100.2 s to 100.8 s**, 0.6 s strictly
  between the seconds 100 and 101, so a sampler finds nothing. The piece's own fix, a hold of north by 120 s, puts
  north 18,000 m back along its route at every time; they then pass at 143.7 s, 14,400 − 5,555.4938 = 8,844.5 m apart,
  and no window is left. Span [0, 400] s.
- **approach** (criteria 2, 3, 4 and 6). A straight approach along +x, level at 600 m (no criterion gives a slope):
  `entry` (−37,040, 600, 0), `final` (−18,520, 600, 0), `threshold` (0, 600, 0), two legs of 18,520 m at 92.6 m/s,
  200 s each. `leader` (class heavy, band 60 to 100 m/s) starts at 0 and passes the threshold at **400 s**. `follower`
  (class light) starts at 100 s, so it is 100 s × 92.6 m/s = **9,260 m** behind then, and passes the threshold at
  500 s. `departure` (class light, band 90 to 100 m/s) starts at 300 s on one leg of 9,260 m, `runway` to `exit`,
  30,000 m to the side. Span [0, 700] s.
  - *The rule sheet* (the basis the fixture cites, of this suite's own making): a light mover behind a heavy one
    keeps 11,112 m, measured when the heavy one passes the threshold. As a row: `{leader: heavy, follower: light,
    min: 11112, at: threshold}`. 9,260 m is under it and not under 5,556 m, so the row alone makes the window, at
    400 s; without the row there is none.
  - *The band that allows 60 s*: the follower's is 60 to 100 m/s at every fix. Asked at time 0, entry to final in
    260 s needs 18,520 ÷ 260 = **71.2308 m/s**: a speed control. Applied, the follower is at final at 360 s and at the
    threshold at **560 s**; at 400 s it is 40 s × 92.6 = 3,704 m past final, 14,816 m behind the leader: no window.
  - *The band too narrow*: 80 to 100 m/s, the piece's only difference. 71.23 m/s is under 80. Asked at time 0 the leg
    entry to final isn't the route's last: a stretch. The departure, asked at time 0, has not started and its one leg
    is its last (9,260 ÷ 160 = 57.9 m/s, under 90): a hold. The follower asked at 250 s has started and only final to
    threshold is left: no speed, no stretch, no hold, so a refusal naming the band at final.
- **forty** (criterion 5). `model.ts`: `forty`, mulberry32 seed 1255: forty movers of two legs each, in from a ring
  90 km out, through a point within 12 km of the centre, out to the ring, each fix at 3,000, 3,350 or 3,700 m, at 150
  to 250 m/s, starting in the first 100 minutes; whole metres, metres a second and seconds. Over [0, 7200] s the model
  gives **9 windows of 9 pairs** among 780, two with an end set by the vertical minimum, and 5 more pairs that pass
  inside 5,556 m and stay clear by level. `fragile` lists nothing: no pair within a metre of a minimum at a slot's
  time, no window or gap under a second, no end crossed slowly, so two right libraries agree far inside 1e-6 s. Over
  [0, 2700] s it gives 4 windows and over [2700, 7200] s 5, none cut by a span's end.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white
space collapsed, checked against the issue's body. Each `describe` and test name starts with its criterion's ID.

| ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| 1 `#1255.34150321` | `ac1-crossing.test.ts` (2) | (a) The model gives 2,400 m at 107.2 s and its sampler twin doesn't. The crossing on the reference library: `closest` 2,400 m within 1e-6 m at 107.2 s within 1e-6 s, pair (0, 1); the same run's `conflicts` gives the 40 s window. Fails: the base; a library that samples or measures on another plane. (b) The breach: the reference library's `conflicts` gives 100.2 to 100.8 s within 1e-6 s, the piece holds north, `conflicts` is then empty and `separation.clear` PASSes. `once_a_second@1` on the same piece returns none at both steps and `separation.clear` FAILs with one fail: pair `["east", "north"]`, that window within 1e-6 s, row null. On the crossing it gives seconds 88 to 127. Fails: the base; the planted twin; a rule that trusts the library's windows or samples; a planted library that finds nothing anywhere |
| 2 `#1255.6e2a9493` | `ac2-by-pair.test.ts` (1) | The approach with its one row: one window, pair (0, 1), `win_row` 0, `win_basis` 1, `win_min` 11,112, at 400 s within 1e-6 s; the row it names holds the cited source and section. The same piece with `by_pair` empty: none. Fails: the base; a library that ignores rows, or applies one without its pair's order |
| 3 `#1255.cfaf0d3e` | `ac3-delay.test.ts` (2) | (a) Wide band: one window before; `delay` returns kind 1 for the follower from entry to final; applied, its time at the threshold is 560 s within 0.5 s, every leg's speed is inside its band, `separation.exact` PASSes, `conflicts` is empty. (b) Narrow band, the pieces differing in that band alone: a stretch (kind 2, entry to final), a hold (kind 3, the departure), a refusal (kind 0, why 1, the follower, final); the stretch and the hold applied, `separation.exact` PASSes. Fails: the base; `leaves_band@1` (a speed where a stretch is due); a control that doesn't give its delay |
| 4 `#1255.32464096` | `ac4-solver.test.ts` (1) | Narrow band: `leaves_band@1` returns a speed, 71.2308 m/s within 1e-6, applied; `separation.exact` FAILs with one fail: mover `follower`, fix `entry`, that speed. The reference library on the same piece returns a stretch and PASSes. Fails: the base; the planted twin; a rule that doesn't read bands |
| 5 `#1255.a22f4ff6` | `ac5-budget.test.ts` (2) | The forty movers' windows on this host equal the model's, 9 of 9 pairs, within 1e-6 s, at three steps without a trap. Timing: five runs of 60 interleaved one-step frames, the median busy frame less the median idle frame under 20 ms, by judgeLimit with loads. Fails: the base; a wrong or slow `conflicts`; INCONCLUSIVE off the reference Mac or under load |
| 5 | `ac5-hosts.test.ts` (1) | A piece checkpointing every step asks `conflicts` over the whole span, the first 45 minutes and the rest: 9, 4 and 5 windows, three step hashes and four full-state hashes, no two alike; headless Chrome and linux/amd64 give the same step hash at every step and the same full-state hash at every checkpoint. BLOCKED without Docker or Chrome, and where this machine isn't macOS. Fails: the base; a library or runner whose state differs on a host |
| 6 `#1255.eba2ab94` | `ac6-basis.test.ts` (1) | Two rows, row 1 with no basis: `logic_refused` naming the item and row 1 alone. Row 1 `invented`: admitted, one window with `win_row` 1 and `win_basis` 2, read as `approach.win_basis`. Fails: the base; a check that admits the row or names another; a library that drops the basis |
| 7 `#1255.fcafb56d` | `ac7-kit.test.ts` (1) | The entry holds one twin for each rule, each a planted library of its own with a fixture the pack carries. Copied into `sepcopy@1.0.0` it installs and its `kit` reads each twin raising exactly its rule; with the two rules swapped (`sepcopy@1.0.1`) it is `pack_refused`, naming the interface, the twin and the rule it didn't raise. Fails: the base; a pack check that runs no kit, or takes any rule's failure for a twin's own |

Test count: 2 + 1 + 2 + 1 + 2 + 1 + 1 + 1 = 11.

## Readings where the issue leaves a choice

- **How movers and minima reach a library, and what "refused at check" sees**: #981's way, not #953's. The item
  declares them, the check validates them and builds asset 0, and `minima` and `mover` load from it; so a row with no
  basis is something the check reads, and a readout finds a row's cited source and section in the piece.
- **"`conflicts` returns one window naming the row and its basis"**: arrays hold numbers, so the window names the row
  by its index and the basis by its code; a cited row's source and section are that row's in the piece. **"Reaches
  the layout so a bound value can show it"**: the code is in the item's array `win_basis`, read by path.
- **"Each mover's position, speed and time at its fixes"**: the three at each fix, from which every frame and every
  check reads the same place, linear between.
- **`separation.clear` reads the movers, not the library's windows**: the criterion has the planted library return
  none and still fail. To give the kit an example the reference library passes and the twin fails, criterion 1's piece
  acts on what `conflicts` tells it: it holds north when a window is found.
- **`separation.exact` needs the delay asked**, which no control carries: `delay_s` and `delay_fix` record it.
- **"A stretch … with neither possible"**: a stretch can always be made longer, so something must rule one out. The
  least rule that gives all four of criterion 3's cases is that the route's last leg can't be stretched. **"Naming the
  band"**: the mover and the fix whose band forbids the speed, with why 1.
- **Measured "when the leader passes a named fix"**: one instant, so a window of no length.
- **`delay` returns the control; a piece applies it.** The issue's "a control is data the piece writes as an input
  entry" isn't driven here: no criterion names the track.
- **The budget**: "`conflicts` over the whole span" is one call of `conflicts(s, 0, 7200)` on the forty movers, all
  780 pairs. It is timed as the CPU time of a one-step frame of a live view (`frame`'s `eval_ns`) whose step makes
  that call and publishes the state, less the same frame of a program that loads the same forty movers and only
  publishes, so the frame's own copying and hashing are left out; in the debug build the suite builds.
- **Hosts**: nothing here needs a macOS API (the issue's Runs on line), so no test but the timing is gated on a Mac.
  Yet the criterion names macOS as one of three hosts, and an unrun host can't pass (invariant 2). So the hosts test
  compares this machine with headless Chrome and linux/amd64 wherever it runs, and only where this machine isn't
  macOS does it then end `BLOCKED:` for that one host.
- **Tolerances**: 1e-6 m and 1e-6 s for distances, times and window ends, the forty movers' and the judge's included;
  0.5 s for a delay; 1e-6 m/s for the planted solver's speed, which is the leg's length ÷ 260 s; 1e-9 s for the
  planted sampler's whole seconds. Pairs, rows, bases, kinds, reasons, fixes and verdicts are exact.

## Not asserted, because no criterion says so

`next_conflict`'s answer; an `always` row and what it changes (accepted as a row's form; how it reads leader and
follower is the implementer's to document); several rows fitting one pair; a row's window meeting a table window;
`closest` for movers at different altitudes or with no shared time; a stretch's `offset` and where its point lies; a
hold's seconds; values of slots, windows and records past their counts; the built table's bytes; the state past its
head; units on the arrays' declarations; other refusals at check (an unknown fix, a speed outside its band); more than
one control on a mover; a control as an input entry and its replay; `deep_kinds`' listing; `process@1` and
`circuit@1`, which the base doesn't have.

## What the implementer adds outside this folder

- `scripts/lanes.mjs`: `timed.push('tests/acceptance/1255/ac5-budget.test.ts')` (it calls judgeLimit). The folder is
  already alone by `lane.json`.
- The first-party pack, its reference library, its fixtures (one each planted library fails, #416), its two planted
  libraries and its twins' examples, with the design's As built.

## Files

- `model.ts`: the closed-form model, its sampler twin, the delay rule, the forty movers and `fragile`.
- `scenes.ts`: the fixtures and the values worked by hand. `programs.ts`: the arrays' layout and the programs' text.
- `helpers.ts`: the first-party pack's reader, pieces, the `plants` pack, the judge's and the arrays' readers.
- `ac1-crossing`, `ac2-by-pair`, `ac3-delay`, `ac4-solver`, `ac5-budget`, `ac5-hosts`, `ac6-basis`, `ac7-kit`
  (`.test.ts`): one file a criterion, criterion 5's timing and hosts apart.
- `lane.json`, `twins.json`, `tsconfig.json`, `BASE-FAILURE.txt`.

## Checked before the base run

Scratch files under `target/blind-1255/` (deleted) held the suite's own pieces to real components:

- **The model in node**: the values worked by hand above, the sampler twin's, and the forty movers' counts.
- **The base's `deep-logic` and assembler**, built for this job: what "What the base already does" lists. Every
  program of this suite assembles as a relocatable object and as a whole module.
- **A stand-in for the implementation**, so the tests themselves ran before one exists: each program run in node's
  WebAssembly against a separation@1 written in JavaScript on the model, behind #190's `onHost`, with the `judge` and
  the kit answered as this README says. All eleven tests passed but the timing, which read `INCONCLUSIVE:` under this
  Mac's load. Then one wrong stand-in at a time, each failing the tests of its criterion at their own assertions: a
  reference library that samples (1, 2, 3, 5, 6); one that leaves the band (3, 4); a judge that trusts the library's
  windows, or samples (1); a judge that reads no band (4); a check that admits the row, or names row 0 (6); a pack
  check that takes any rule's failure, or runs no kit (7); a Linux or a Chrome whose hashes differ (5); a host that
  isn't macOS (5, `BLOCKED:`).

Not checked: anything of the implementation (none exists); the Linux build and Chrome on real hashes; the timing.
