# Acceptance tests for #981: lanes@1, vehicles on a lane graph (criteria 1 to 8)

Written first, from issue #981 (live, `gh issue view 981 --repo windoliver/deepbuild --comments`: its Scope, Fields,
eight acceptance criteria and Proof line), the design sections it names and the base commit, by a job that never saw an
implementation; none existed, and no other branch, worktree, pull request, plan or session was read. The base is this
worktree's HEAD, `4bf2fc7ad` ("Merge pull request #2899 …"), whose first parent is `531da1ef0` ("Merge pull request
#2910 …"); nothing either touches lanes. There is no Oracle page for #981; nothing is ported. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue: its Scope (the lane graph built at check from the floor's paths, zones, routes, the loop break, motion,
  the lift, `lanes.clear` and `lanes.stuck`, a planted library that enters a held zone), Fields, criteria and Proof.
- `docs/technical-design.md`: Navigation, The logic module (Logic, Sandbox and budgets, Logic bake and checks, Linked
  libraries, Library interfaces, Data layouts and the rest), Dogfooding. AGENTS.md.
- `docs/canvas-primitives.md`: Logic: library interfaces (its `lanes@1` paragraph), Logic: linked libraries, Logic:
  sandbox, Logic `logic@1`, Logic: data layouts, Path `path@1`, Instance `instance@1`: logic columns, Geometry audit and
  Geometry audit: scenes, Pack, Pack: kind rules and the kind kit, Registry and seal: registries.
- At the base, for the surfaces used: `tests/acceptance/190/` (README, helpers, the assembler), `416/interfaces/`
  (README, helpers, programs, wat.ts and wat/), `531/` (README), `262-redraft-1830/budgets.test.ts` (the judgeLimit
  pattern), `crates/deep-logic/src/{lib.rs,first_party.rs,interfaces.rs,fixtures.rs,live.rs,world.rs,piece/checks.rs}`,
  `packs/interfaces-1.0.0/` (pack.json, a fixture, a program's text), `scripts/{proof-change.mjs,benchmark.mjs,lanes.mjs,
  throttle.mjs}`, `crates/deep-canvas/src/time.rs` (valid step rates).

At the base nothing knows lanes: `first_party` declares physics2d.lib@1, fsm@1 and nn.mlp@1 only; a piece's items may be
`logic@1` only ("only logic@1 items are stepped here"); a logic item has no field `lanes`; there is no `judge` call.

## Run them

```sh
npm ci && npm run build --workspaces                 # once, in a fresh worktree
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/981 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/981/tsconfig.json
rm -rf tests/acceptance/981/node_modules            # vitest's cache
```

What a run builds, honoring `CARGO_TARGET_DIR`: `deep-logic` for this host (#190's helpers, imported unchanged) and
#416's assembler arrangement (`../416/interfaces/wat.ts`: #190's assembler under #416's lockfile, built from the system's
temporary folder with `--locked --manifest-path` so no `[patch]` of the checkout's applies), into
`target/acceptance-416-wat`. Headless Chrome (criterion 7) is `CHROME_BIN` or the usual paths. Every test passes #190's
90-minute timeout. A whole run, once deep-logic is built, is estimated at 15 to 40 minutes on the reference Mac under
load: criterion 5's 57,600-step judge and criterion 7's Chrome bakes are most of it.

Gates: a missing host is `BLOCKED:`, never a pass (#190's). Criterion 8's timings are judged by
`scripts/benchmark.mjs`'s judgeLimit with the one-minute load at each run's start and end: off a reference Mac, under
load, or with readings neither all in nor all out of the limit, the test fails `INCONCLUSIVE:` with its readings, never
a pass; criterion 8's other test runs on any machine. **`scripts/lanes.mjs` pushes this folder to `alone`** (its files
build deep-logic, start Chrome and run eight simulated hours) and `ac8-budget.test.ts` to `timed` (it calls
judgeLimit). "In the local preflight" isn't something a test can see: it reads as this suite run on the reference Mac.

## The surface

The issue names `lanes@1`, its exports, its layout `lanes.state@1`, the `graph` and `vehicle` fields, the two kind rules
with `max_wait`, a reference library, fixtures and a planted library, but no command line. As in #190's and #416's
suites the surface is `deep-logic` (#531's, #532's, #190's and #416's JSON-lines protocol, unchanged where not named
here), and **every call, field, signature, array, state code, zone name, refusal field, rule field, number and planted
name below that the issue or the design doesn't give is this job's invention**: the smallest the criteria need, in the
design's spellings where it has them. The implementer builds exactly these, or a dispute goes to a blind redraft.

### The first-party pack

- `first_party` lists a first-party pack (any name) declaring `lanes@1`, #416's Interface with `layout:
  "lanes.state@1"`, `exports` exactly the eight below, at least one fixture, at least one planted library, and
  **`"rules": {"lanes.clear": {}, "lanes.stuck": {"max_wait": 60}}`**: the interface's kind rules, each with its
  params' defaults (the issue's "Kind rules (#202), in the interface's pack"; their logic is the judge's, below).
- The same pack's `libs` holds exactly one library whose `implements` names `lanes@1`: **the reference library** (any
  name@version), with fixtures of its own (#190's rule); its object is among `first_party`'s assets. A piece links it
  by that name and hash; first-party packs are always installed (#416).

### Pieces

```text
Piece.items gains floor paths:  {<path ID>: {"kind": "path@1", "params": {"verbs": ["M", "L", …], "pts": [x0, y0, x1, y1, …]}}}
                                one run of straight lines, points in metres on the floor plane (x, y); they step nothing
LogicParams gain "lanes":       {"graph": Graph, "vehicle": Vehicle}
Graph   = {"paths": [path ID], "two_way": [path ID] = [], "speed": {path ID: m/s}, "bays": {name: [x, y]}, "join": m = 0.05}
Vehicle = {"length": m, "width": m, "gap": m = 0.5, "speed": m/s, "accel": m/s², "decel": m/s², "lift"?: {"max": m, "speed": m/s}}
```

- Every vehicle of an item is of its one `vehicle` kind. An item with `lanes` exports `assets_at`: the lane graph the
  check builds is the item's **asset 0**, copied there (after its u32 length) before the start function, ahead of any
  asset it names. Its bytes are laid out as the check and a lanes@1 library agree (the pack documents them); the tests
  read them nowhere.
- **The lane graph** (at check): each path of `paths` is an edge from its first point to its last, both ways when in
  `two_way`, with its `speed` limit; path ends within `join` of each other are one node; each bay names the node at its
  point. Bays are numbered 0, 1, … in the order `bays` lists them (this suite lists them in name order, so either
  reading gives the same numbers).
- **Refusal at check**: a graph with a bay no other bay reaches is `{"ok": false, "code": "logic_refused", "item":
  <logic ID>, "refusals": [Refusal]}` with one refusal `{"rule", "what", "bay": <name>}` per such bay (`rule` and `what`
  are the implementer's). An edge shorter than length + gap is refused with `{"rule", "what", "path": <ID>}` (not
  tested here).

### Zones

- A **junction** is a node where three or more path ends meet. Its zone is named `junction:` followed by the IDs of the
  paths ending there, sorted, joined by `,` (`junction:a,b,c1`), and reaches **r = (length + gap) ÷ 2** along each.
- Each path's stretch between its junction zones (to its own end where that end is no junction) is cut into
  **max(1, ⌊stretch ÷ (length + gap)⌋)** equal zones, named `<path ID>.<i>` from its first point (`c1.0`, `c1.1`). A
  two-way path's zones serve both ways. Every scene here has stretches of at least length + gap.

### Exports of lanes@1

| Export | Signature | Does |
|---|---|---|
| `graph` | (s i32, g i32) → i32 | starts the lane state at `s` from the built graph at `g` (asset 0's bytes: `assets_at + 4`), zones cut, no vehicles; returns the state's size in bytes |
| `vehicle` | (s i32, bay i32) → i32 | places a vehicle of the item's kind at rest at bay `bay`, centre on the bay's node, forks at 0 m, no load, no route; returns its ID 0, 1, … in order, or −1 |
| `route` | (s i32, from i32, to i32) → f64 | the quickest time in seconds from bay `from` to bay `to` (each edge's length ÷ its limit, summed), or −1 when none; changes nothing |
| `go` | (s i32, dt f64, out i32) | advances the world `dt` seconds, one step (below), then writes the arrays at `out` |
| `lift` | (s i32, v i32, h f64) | sets vehicle v's forks moving toward height h (clamped to [0, max]) at its lift speed, from its next `go` |
| `carry` | (s i32, v i32) | vehicle v takes a load onto its forks |
| `set_down` | (s i32, v i32) | vehicle v sets its load down where its forks' point is; the load stays there |
| `park` | (s i32, v i32, bay i32) → f64 | sends vehicle v, at rest, along its quickest route from where it is to bay `bay` (ties by the paths' IDs), to park there; returns the route's time, or −1 (no route; nothing changes) |

**Memory**: the library keeps its state, zones and their holders, vehicle rows and routes, in the caller's memory from
`s`, laid out as `lanes.state@1` (which the pack documents; the tests read it nowhere), at most 1 MiB for up to 64
vehicles, 512 paths and 128 bays, and nothing else of the caller's but what `go` writes at `out`. This suite's programs
read at 0, write at 4096, keep data at 8192 and variables at 16384, export `assets_at` 65536 and put `s` at 1 MiB, in a
memory of 32 pages (2 MiB).

### Arrays

`go(s, dt, out)` writes at `out`, for the V vehicles placed, in this order, each array starting 8-aligned (the region
map's own layout for writes declared in this order with count V, so an item declares them first and `out` is
`writes_at`): `pos` vec2 ×V (the centre, m), `heading` f64 ×V (radians, the direction of travel along its route at
its centre, `atan2`; at rest the last one; at placement the direction from the bay into the first path, in `paths`
order, that ends there), `speed` f64 ×V (m/s, at the step's end), `state` i32 ×V, `fork` f64 ×V (m), `load` vec3 ×V.

- **States**: 0 parked (at rest at its goal, or with no route, forks still), 1 driving (moving at the step's end), 2
  waiting (at rest short of its goal), 3 lifting, 4 lowering (at rest, forks short of their height, rising or falling).
- **The forks' point** is the vehicle's front centre, its centre plus length ÷ 2 along its heading, at the fork height.
  `load` is the position of the load the vehicle carries or last set down, as an instancer's 3D point reads it, y up:
  `[x, height, y]` (x and y the floor's): while carried, the forks' point; after `set_down`, the forks' point then;
  before any `carry`, `[0, 0, 0]`.

### Steps, reservation and motion

- **Steps**: at logic step k a program gives its commands, then calls `go(s, dt, out)`, which advances the world from
  k·dt to (k + 1)·dt; so the arrays at step k are the world at (k + 1)·dt.
- **Within go**, vehicles in ID order each: ask for zones, break a loop if its ask closed one, move, release; then the
  forks move; then the arrays are written.
- **Reservation**: a vehicle with a route asks, in route order, for each next zone whose start lies within its
  **horizon H = speed·dt + speed² ÷ (2·decel)** (`speed` its own top speed) ahead of its front (centre + length ÷ 2
  along the route); a junction only together with the zone after it on its route, both or neither; it stops at the
  first it can't have because another vehicle holds it. A vehicle holds the zones it reserved and those its footprint
  covers (from placement on); it releases a zone in its own move once its rear passes the zone's end, so a vehicle after
  it in ID order may take it in the same step.
- **Waiting on, and loops**: from the step its ask fails, a vehicle waits on the holder of the zone it couldn't have.
  When an ask fails and closes a loop of vehicles each waiting on the next, the loop's lowest-ID vehicle at once takes its
  next quickest route that avoids the zone it waits for (from the end of the path it is on, to its goal); if that is the
  vehicle whose ask closed it, it asks again along the new route in the same turn; if it has none, nothing changes.
- **Motion**: a vehicle's stop point is the start of the first zone ahead it doesn't hold (for its front) or its goal
  (for its centre), whichever comes first. Within a step it follows the time-optimal motion toward its stop point:
  speeding up at accel to min(its speed, the edge's limit), cruising, slowing at decel to come to rest exactly on it,
  evaluated in closed form at the step's end (every route here keeps one limit). A stop learned while still past its
  braking distance is met exactly, as the horizon makes every stop be.
- **Forks**: each `go` moves them toward their height by lift speed × dt, never past it. This suite lifts only at rest
  and sends only with still forks.

### The judge

```text
{"call": "judge", "piece", "track"?: [Entry] = [], "steps": n}
 → {"ok": true, "items": {<logic ID>: Judged}}     (every logic item with `lanes`; the check's refusal as `check` gives it)
Judged = {"rules": {"lanes.clear": Rule, "lanes.stuck": Rule}, "audit": {"on_graph": {"max": m, "vehicle": i, "step": k}},
          "last": {<write name>: [value]}}          (last: the item's arrays at step n − 1)
Rule   = {"verdict": "PASS" | "FAIL", "steps": the steps evaluated, "fails": [Fail], the first 16, earliest step first}
```

The run is steps 0 to n − 1, as a bake runs them; the rules read the item's `pos`, `heading` and `state`, its `vehicle`
and its graph (README: Zones), so they hold any library, a planted one included.

- **lanes.clear**, at every step: a vehicle occupies a zone when the stretch of the graph within length ÷ 2 of the point
  of the graph nearest its centre, every way along the paths, overlaps the zone by more than 1e-6 m. A zone two or more
  vehicles occupy is a fail `{"step", "zone": <name>, "vehicles": [IDs ascending]}`; two footprints (length × width
  rectangles at `pos` along `heading`) overlapping by more than 1e-6 m are a fail `{"step", "zone": null, "vehicles":
  [i, j]}`; a step's zone fails come before its footprint fails.
- **lanes.stuck**: a vehicle's wait at step k is the number of steps in a row up to k it has been waiting, times the
  step length, counted in flicks (exactly); the first step it passes `max_wait` (the pack's 60 s) is a fail `{"step",
  "vehicle", "waited": s}`.
- **audit.on_graph**: the geometry audit's measure for lanes (the criterion's "as the geometry audit (#405) measures"): the
  largest distance, over every step and vehicle, from `pos` to the nearest point of the graph's paths, with that
  vehicle and the first step it is reached.

### Fixtures

#416's interface fixture and #190's library fixture may each carry **`"items": {<item ID>: item}`**: the other items
of the fixture's piece, here its floor paths, beside its own item `fixture`. This suite's fixtures (fixtures.ts) are
interface fixtures in that form with tolerance `{"abs": 1e-6}` and an `answer`; the tests run them on the reference
library themselves. Whether lanes@1 ships them is the implementer's choice; criterion 7 runs lanes@1's and these.

### The planted library

**lanes@1's planted library** (one of its `planted`) is the reference library with one change: a vehicle takes a
junction and the zone after it whether or not another vehicle holds them, as if none did. This suite carries it in its
own pack `plants` (origin installed) as **`planted_lanes@1`**, its exports the eight, with a fixture of its own (#190's
rule) that any lanes@1 library passes: the straight run, importing `lib:planted_lanes`, its state driving at step 0
and parked at step 125. No `--planted` flag of deep-logic's is added.

## Scenes and expected values

`scenes.ts` holds the graphs (vehicles 2 m × 1 m, gap 0.5 m, so r = 1.25 m and zones of at least 2.5 m; 2 m/s;
1 m/s² each way) and the zone, route and profile rules; `fixtures.ts` works each run's timeline from them and writes
it in its fixture's answer; `programs.ts` holds the WebAssembly text.

- **straight** (criterion 1, 10 Hz): path `e`, (0, 0) to (20, 0), two-way, 2 m/s; the vehicle's own top speed 3 m/s, so
  the limit is what holds it. Rest to rest: up 2 s over 2 m, 16 m in 8 s, down 2 s over 2 m: 12 s; pos at step k is
  (s((k + 1)·0.1), 0); at rest at rack.b from step 119.
- **merge** (criterion 2, and 6's planted run, 10 Hz): lanes `a` (from park.w, 20 m west) and `b` (from park.s, 20 m
  south) meet `c1` at J (0, 0); c1 runs to rack.m (6.25, 0), c2 on to dock.e (16.25, 0); all two-way. Horizon 2.2 m:
  both ask for J with c1.0 at step 88; vehicle 1 fails and rests from 10.875 s (step 108) at (0, −2.25), front at J's
  zone; vehicle 0's rear passes the end of c1.0 (3.75 m) at 13.375 s, inside step 133, and vehicle 1 goes in that step.
  Under the planted rule both run free and both centres come within 1 m of J's zone at step 98.
- **loop** (criterion 3, 10 Hz): the square N0 (−3, −3), N1, N2, N3 of one-way 6 m sides (one zone each), links l_i
  out along the diagonals to O_i, spurs p_i on to park.i, and the one-way ring o_i round the O_i. Vehicle i goes to
  park.(i + 2) by s_i and s_{i+1}; 1 to 3 sent at step 0, 0 at step 10. 1 to 3 hold their sides from step 48, ask at
  step 78 and fail on the next one's side, at rest from step 98 at their next junction's zone; vehicle 0 holds s0 from
  step 58, before 3 asks for it, and its ask for N1 at step 88 closes the loop. It reroutes at once, out by l1 and round
  o1 to park.2 (44.485 m), every zone free when asked, so it runs that profile unbroken and arrives at step 252; 3 goes
  at step 108, then 2 and 1, and each reaches park.(i + 2).
- **stuck** (criterion 3's wrong run): the straight edge, vehicle 0 parked at rack.b, vehicle 1 sent there: it rests at
  16.5 m (front at e.7, 17.5 m) at 10.25 s, waits from step 102 for good, and its wait passes 60 s (601 steps) at 702.
- **lift** (criterion 4, 10 Hz): park.p (0, 0), rack.r (10.1, 0, so arrival falls inside a step), dock.d (20, 0); the
  mast at 1 m/s rises 0.1 → 5.4 m in 5.3 s; the load set down sits at (11.1, 5.4, 0).
- **fleet** (criterion 5, 2 Hz, 57,600 steps): a one-way loop round a 75 m square, 20 junctions 15 m apart (at 7.5 m +
  15k), each with a 5 m two-way spur to a bay; park bays at spurs 0, 3, 7, 10, 13 and 17. 500 tasks from mulberry32 seed
  981 (scenes.ts: fleetLegs), two legs each between the 14 work bays, task t to vehicle t mod 6, then home. Each spur is
  one zone and the loop holds at least four zones between junctions, so no vehicle enters a held spur and none leaving
  a spur waits on one about to enter the next: no correct library can be stuck here.
- **refused** (criterion 6): m1, m2 two-way between park.1 (0, 0) and park.2 (20, 0), rack.7's spur `r` one way from
  (10, −5) to (10, 0): no bay reaches rack.7; with `r` two-way, all are reached.
- **grid** (criterion 8, 10 Hz): 6 × 32 nodes 10 m apart, one-way streets (rows east and west by turns from row 0
  east, columns south and north by turns from column 0 south, so the rim is one loop and every node reaches every
  other), and 54 two-way 5 m spurs to bays: 186 + 160 + 54 = 400 paths; 50 vehicles; route() asked for four far pairs
  (160 s and 170 s, by Dijkstra).

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white
space collapsed. Each test's name starts with its criterion's ID.

| ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| 1 `#981.9c475355` | `ac1-straight.test.ts` (1) | lanes@1's surface (exports, layout, rules, a reference library); the straight fixture: pos within 1e-6 m of the profile at every step, rest to rest in 12 s within one step. Fails: a library off the profile; shown failing in node on a semi-implicit Euler run and on one at 3 m/s past the limit |
| 2 `#981.c3385bed` | `ac2-junction.test.ts` (1) | the merge fixture; the two run the same distance until step 88; vehicle 0 never waits and is past J first; vehicle 1 waits at (0, −2.25) within 1e-6 m from step 109 to 132 and moves at step 133, the first step vehicle 0's rear is past c1.0; lanes.clear PASS over all 220 steps. Fails: a lower ID that waits, a stop off the boundary, a go a step early or late, a clear rule that fails a right run |
| 3 `#981.86bc7d66` | `ac3-loop.test.ts` (2) | the loop fixture; 1 to 3 waiting at their junctions' zones while the loop stands; vehicle 0 on its detour's profile within 1e-6 m at every step; all four parked at their goals; lanes.stuck PASS with 60 s. The stuck run: vehicle 1 waits from step 102 at 16.5 m and lanes.stuck FAILs, first naming vehicle 1 at step 702, past 60 s. Fails: a loop broken late (vehicle 0 brakes) or never (no goals, stuck fails), a stuck rule that can't fail |
| 4 `#981.2e8beefa` | `ac4-lift.test.ts` (1) | the lift fixture; forks from 0.1 m to 5.4 m in 5.3 s within one step, lifting meanwhile; the load at the forks' point within 1e-6 m at every carried step; from set_down on, at (11.1, 5.4, 0) at every step while the forks go down and the vehicle drives to dock.d. Fails: a slow or fast mast, a load off the forks, a load that follows the forks after set_down (shown far from the pose) |
| 5 `#981.78e60032` | `ac5-fleet.test.ts` (2) | the scene's guarantees and the 500 tasks; one judge over 57,600 steps: lanes.clear and lanes.stuck PASS at every step, audit.on_graph ≤ 0.05 m, every leg sent and every vehicle home and parked. The wrong program: vehicle 0 written 0.06 m off in x and y, whose audit is past 0.05 m naming vehicle 0. Fails: a rule or audit that misses, a run that doesn't do the tasks |
| 6 `#981.ba627540` | `ac6-refusals.test.ts` (3) | the refused graph is `logic_refused` naming the item and rack.7 alone; its twin with `r` two-way is admitted. lanes@1's planted library as planted_lanes@1 under the merge FAILs lanes.clear, first naming step 98, `junction:a,b,c1`, vehicles [0, 1]; the reference library on the same run passes. lanes@1's entry copied into `lanescopy@1.0.0` without planted libraries is `pack_refused` naming the interface; `lanescopy@1.0.1` with them installs. Fails: a graph admitted with an unreached bay, a refusal that names none, a clear rule blind to a held zone, a pack check that lets an interface ship no plant |
| 7 `#981.0e3bb315` | `ac7-hosts.test.ts` (2) | a piece linking the reference library: every lanes@1 fixture ran on it and PASS in the receipt; each planted library claiming lanes@1 is `link_refused` naming lanes@1 and a fixture. Each of lanes@1's fixtures and this suite's four: the same step hash at every step and the same checkpoints on this core and in headless Chrome, and for lanes@1's the receipt's deep_hashes. Fails: a link with fixtures unrun or failing, a web runner whose steps differ |
| 8 `#981.7c601cf2` | `ac8-budget.test.ts` (2) | the grid: 400 paths, 54 bays, strongly connected; route() equals the Dijkstra time for each pair within 1e-9; 60 steps of 50 vehicles without a trap. Timing: five runs of 60 interleaved one-step frames, step = median busy − median idle under 200 µs, search = median search − median idle under 100 µs, by judgeLimit with loads. Fails: a wrong route time, a slow step or search; INCONCLUSIVE off the reference Mac or under load |

Test count: 1 + 1 + 2 + 1 + 2 + 3 + 2 + 2 = 14.

## Planted twins

| Name | Criterion | The wrong program |
|---|---|---|
| lanes@1's planted library (first party), as `planted_lanes@1` | 6, 7 | takes a junction whether or not it is held |
| the stuck run (programs.ts: dispatchProgram on STRAIGHT) | 3 | a vehicle sent to a bay another vehicle holds for good |
| `fleetProgram(…, offGraph)` | 5 | vehicle 0's written position 0.06 m off its graph |
| `refused(true)` | 6 | the same graph with the rack reached (must be admitted) |
| `lanescopy@1.0.1` | 6 | the copied interface with its planted libraries (must install) |
| node-side runs (Euler, 3 m/s, a load kept on the forks) | 1, 4 | outputs a wrong library would give, against the same checks |

## Readings where the issue leaves a choice

- **The surface**: `deep-logic` again, as #190's and #416's suites, since the criteria need the web runner and the
  merge of libraries into logic items; `judge` is its new call.
- **"Built at check from the floor's path items a piece names"**: path@1 items in the piece and `lanes.graph` on the
  logic item, the built graph handed to the program as its asset 0. **"Bays (park, rack face, dock)"**: named nodes,
  their kind in their name only. **"A rack bay no park bay can reach"**: this suite's rack bay is reached by no bay at
  all, so a check that refuses a bay no other bay reaches (the Scope's rule) and one that asks only of park bays both
  refuse it.
- **"Reach one junction at the same step"**: both horizons reach its zone at one step, shown by the two having run the
  same distance until then. **"Stops at the zone boundary before the junction"**: its front at the junction zone's start,
  its centre half a length short. **"Goes at the step the first leaves the zone after the junction"**: its first step of
  motion is the first step at whose end the first vehicle's rear is past that zone's end.
- **"The loop is broken at the step it forms"**: the loop forms at the ask that closes it, and its lowest-ID vehicle
  reroutes in that turn, so it never brakes for the zone it waited for; read as its profile over the detour, unbroken.
- **"Rest to rest in 12 s within one step"**: from the first step it moves to the first step from which it is at the
  goal for good, counted by step ends. **"From 0.1 m … in 5.3 s"**: forks start at 0; the program lifts them to 0.1 m,
  then to 5.4 m, timed from the step that asks to the first step at 5.4 m. **"The load's pose"**: its position, at the
  forks' point while carried. **"Stays at the rack level's pose"**: where set_down left it, every step after.
- **"500 seeded random tasks between 20 bays"**: the graph has 20 bays; the tasks run between its 14 work bays, and
  each vehicle starts at and goes back to its own park bay, so no vehicle ever waits for a bay a vehicle with no task
  keeps. **"Over 8 simulated hours"**: 57,600 steps at 2 Hz; the tasks end in about 4 hours by this suite's model
  (below), the rest parked. **"As the geometry audit (#405) measures"**: the judge's `audit.on_graph`.
- **"Links only after every fixture passes on this core and in headless Chrome with the same step hashes"**: on this
  core, the link's receipt has every lanes@1 fixture PASS and a library that fails one is refused; in Chrome, every
  fixture's step and checkpoint hashes equal this core's. A link can't start Chrome, so the Chrome half is this suite's
  run of every fixture there.
- **Budget**: "50 vehicles … step in under 0.2 ms a step" is a step of `go` with 50 vehicles moving, less the frame's
  own work (an idle program's frame); "a route search" is one `route()`, less the same. Both are CPU time a frame reports
  (`eval_ns`), in the debug build the suite builds.

## Not covered, because no criterion reaches it

A vehicle as a `process@1` resource (#980, not built); a short edge's refusal and `join`'s tolerance; speed limits that
change along a route; ties broken by edge ID; `lanes.state@1`'s and the built graph's bytes, saves and layouts;
`max_wait` set by a piece; deep_kinds' listing of lanes@1; heading beyond footprints; instancers reading the arrays.

## Checked before the base run

Two temporary tests (deleted) held this suite's own pieces to real components. The suite itself was not run at the
base: `deep-logic` wasn't built here, its build waiting last of 17 behind the Mac's one build grant (`BASE-FAILURE.txt`
says so, with what each test calls first and what the base answers there).

- **Node's WebAssembly**, each program assembled from the same text as a whole module and run against a JavaScript
  stand-in for lanes@1's exports that records calls: the dispatch programs send at their steps; the lift program lifts
  at step 0, carries and sends at step 1 and walks its phases on the parked state; the fleet program sends each
  vehicle's 167 or 169 legs in order and writes them as `next`; the off-graph twin adds 0.06 m; the grid programs place
  50 vehicles, busy sends each once to a bay not its own, search asks the four pairs in turn. Every program also
  assembles as a relocatable object.
- **A reference model of README: Steps, reservation and motion** in TypeScript (zones, horizon, junction pairs,
  closed-form motion, releases, loop break with Dijkstra, lanes.clear by graph stretch and rectangle overlap): it gives
  every position fixtures.ts expects in the merge and the loop at every step it expects them; vehicle 1 of the stuck
  run waits from step 102; under the planted rule the merge's first lanes.clear fail is step 98, `junction:a,b,c1`,
  [0, 1]; and the fleet's 8 hours send every leg (the last at 3.98 h), end with every vehicle parked, pass lanes.clear
  at every step, and keep every wait to 5 s at most.

Not checked: the suite's run at the base; anything of the implementation (none exists); the scenes through a library
of the logic module's (none exists); Chrome and the timings (they need the implementation first).
