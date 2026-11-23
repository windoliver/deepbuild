# Acceptance tests for #959: sense.lib@1, sight that terrain blocks, radar, jammers, cloak and last-seen ghosts

Written first, blind, from issue #959 (its opening paragraph, Runs on line, Scope, five acceptance criteria, Proof line
and Oracle line; it has no comments), the design sections it links and those they lean on, and the base commit
`bba03bffe` (main at `3f02bf52b` with #552's branch merged in), by a job that never saw an implementation. No other
worktree, branch, pull request, plan or session was read, and nothing was fetched. The Oracle line says no upstream
test checks these criteria, so there is no Oracle lane and nothing is ported. The implementing agent doesn't edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

Lean: one file per criterion (criterion 4 has two, since its two clauses run through two binaries), each test's name
carrying its criterion's ID, and exactly the five planted twins the criteria name.

## What was read

- The issue, as saved for this job (`issue-959.md`, and its body byte for byte for the criteria's IDs).
- `docs/canvas-primitives.md`: Logic: library interfaces (its `sense.lib@1` sentences: "writes each side's `unseen |
  radar | seen` grid and its units' seen bits from sight that terrain heights block, radar, jammers, cloak and last-seen
  ghosts, rebuilt over a few steps. Every kit's fog writes a side's sight into the `seen` column at the bit of each of
  its players' `match.me`"), Logic: library interfaces: mods.lib@1 with its As built, Logic: linked libraries, Logic
  `logic@1`, Logic: sandbox, Logic: data layouts, Logic: work across steps, Check input: logic kinds (logic.budget),
  Builder plate: terrain, Builder plate: terrain overlays, Net `net@1`, Net: lockstep, Net: this copy's player, Mark
  set: logic columns (the `seen` column), Instance `instance@1`: logic columns, Pack: gridcore@1 grid game kit, the
  budget class table. `docs/technical-design.md`: the paragraph on a CPU reference counting as an oracle, Built to be
  hard to get wrong. `docs/parallel-proof.md` section 7 (a suite's own lane file). AGENTS.md, CONTRIBUTING.md.
- At the base, for surfaces only: the suites `953/` and `981/` (README, helpers, programs, tests: a first-party
  interface with a reference library, proved through `deep-logic`), `416/interfaces/` and `190/` (README, helpers, the
  assembler), `546/` (README, the web ceiling's test), `552/` with `549/` and `550/` (README, helpers, fixtures, the fog
  grid's and the taste tests), `537/` (README, helpers, fixtures, its taste test), `2014/` (README);
  `crates/deep-logic/src/` (`lib.rs`'s calls, `first_party.rs`, `links.rs`, `budget.rs`, `metering.json`, `fog.rs`,
  `piece/checks.rs`, `world/world_impl.rs`'s step, `play.rs`'s `piece_of`), `crates/deep-canvas/src/budget.rs`,
  `crates/deep-canvas-sandbox/src/rewrite.rs` (what a block charges), `crates/deep-show/src/{net.rs,matched.rs,logic.rs}`,
  `crates/deep-play/src/logic.rs`, `crates/deep-canvas-scene3d/src/{slots.rs,tints.rs}`, `packs/modslib-1.0.0/pack.json`,
  `scripts/{proof-change.mjs,proof-runs.mjs,lanes.mjs}`.

Code was read only to learn what a call takes and returns. Every expected value comes from the issue, the design and
this folder's `fixtures.ts` and `model.ts`.

## What the base already does, and these tests don't credit

- `deep-logic`'s `first_party` (three packs: `interfaces@1.0.0`, `lanes@1.0.0`, `modslib@1.0.0`), `check`, `bake`
  (with `arrays`), `pack_check`, `about` (`ns_per_fuel`), links by name and by interface, interface fixtures at link,
  and logic.budget as #546 left it: the step ceiling of the piece's class on each host in `on` from the bake's fuel,
  a pipelined 30 Hz item held to twice the table's value, and `BLOCKED` on the web's timed run when nothing fails.
- `deep-show`'s `match` (#549, #550, #552): every copy in one process, each copy's hashes and step rows; `views`; an
  instancer's `seen` column, a logic item's `fog` grid and an overlay's `player: "match.me"`.
- Nothing at the base knows `sense.lib@1`: no pack declares it, and no crate, pack or script names a sight grid, radar,
  a jammer, a cloak or a ghost row. Every test here calls `first_party` first and fails at its own assertion that a
  first-party pack declares `sense.lib@1` with a reference library (`BASE-FAILURE.txt`). None is a guard.

## Run them

```sh
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci && npm run build --workspaces      # once, in a fresh worktree
for f in ac1-ridge ac2-radar-jammer ac3-cloak-ghost ac4-budget ac4-copies ac5-taste; do
  NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 sh scripts/lease \
    node node_modules/vitest/vitest.mjs run --root tests/acceptance/959 --no-file-parallelism --testTimeout=600000 $f.test.ts
done
node node_modules/typescript/bin/tsc -p tests/acceptance/959/tsconfig.json   # type check
rm -rf tests/acceptance/959/node_modules                                      # vitest's cache after a --root run
```

| File | Builds | Starts |
|---|---|---|
| `ac1-ridge.test.ts`, `ac2-radar-jammer.test.ts`, `ac3-cloak-ghost.test.ts`, `ac4-budget.test.ts` | `deep-logic` (#190's `cargo build --locked --bin deep-logic`) and #416's assembler (into `target/acceptance-416-wat`) | `deep-logic` processes, each a few calls |
| `ac4-copies.test.ts`, `ac5-taste.test.ts` | the same, and `deep-show` (`full`, #549's `useBuilds`) | one `deep-logic first_party`, then one `deep-show run` with one `match` |

Every `it` and every build hook passes its own timeout (90 minutes), which `--testTimeout` doesn't shorten. Temporary
folders are deleted; every `deep-show` is stopped by its PID (#549's `useChildren`). Imports: Node built-ins, vitest,
and earlier suites' helpers read only (`../190/`, `../416/interfaces/`, `../467/`, `../552/`, which bring `../549/` and
`../550/`). No network: `https://relay.test/959` is declared by pieces that never join.

**Gates.** None is ever a pass. `BLOCKED:` when cargo or the assembler can't run (#190's, #416's and #549's). Criteria
1 to 4 are gated on nothing else: no macOS API, GPU, browser or clock (the issue's Runs on line; `match` without a
view draws nothing). Criterion 5 is `INCONCLUSIVE:` off macOS, where no frame is drawn, and until its taste call is
recorded. No test reads a time or the load.

**The lane file.** `lane.json` says the folder runs alone (its files build cargo binaries and play matches in
process), which needs no edit to `scripts/lanes.mjs`. No file is `timed`. There is no `twins.json`: every test fails on
the merge base at its own assertion, so the before lane needs no twin folder, and the planted libraries are this
suite's own (as #953's are), built from `programs.ts` at test time.

## The surface under test

The issue names `sense.lib@1`, "a first-party library interface with a reference library", `sight {sensors: rows
(position, height, range, kind: eye | radar | sonar | jam | detect), heights: plate grid, cell}`, the three cell states,
the `seen` bits by #954's convention, `ghost` rows, `spread` and its strong defaults, but no WebAssembly signature, no
memory and no encoding. As in #953's and #981's suites the surface is `deep-logic` (#190's, #416's, #531's and #546's
JSON-lines protocol, unchanged) and, for the two copies and the pictures, `deep-show run`'s `match` (#549's, #550's and
#552's, unchanged). **Every signature, layout, encoding, array, code, rule and name below that the issue or the design
doesn't give is this job's choice**: the least the criteria need, in the design's spellings where it has them. The
implementer builds exactly these, or a dispute goes to a blind redraft. **No new call, call field or reply field is
asked for.**

### The first-party pack (this job's reading of "a first-party library interface with a reference library")

- **`{"call": "first_party"}`** (#416's) lists a first-party pack, of any name, `origin: "first_party"`, whose
  `interfaces` hold **`sense.lib@1`** (#416's Interface: `exports`, `fixtures`, `planted`, `digest`) with `exports`
  exactly `[{"name": "sight", "params": ["i32", "i64"], "results": []}]` and at least one fixture. (The base's own rule
  also asks it for a planted library that fails one of its fixtures, or the pack is refused; no test here reads it.)
- The same pack's `libs` hold **exactly one library whose `implements` names `sense.lib@1`**: the reference library,
  under any `name@version`, with fixtures of its own (#190's rule); its object is among `first_party`'s assets under
  its entry's `asset`.
- A program imports the export as **`lib:sense.lib@1.sight`** and links the reference library by its name and hash
  (#416's surface). The link's receipt then lists every fixture of `sense.lib@1` run on it, each `PASS` (criterion 1
  reads it).

### The export (this job's)

| Export | Params → results | Does |
|---|---|---|
| `sight` | `(s: i32, k: i64)` → nothing | One call a step: `s` is the address of the state (below) in the caller's memory, `k` the step. It rebuilds the rows of the grids that step k's share holds, then writes every unit's `seen` and `blip` bits and place and every ghost row (One call, below) |

### The state (this job's)

2,097,152 bytes at `s` in the caller's memory. The program writes the first 256 bytes, the header, before its first
call and never changes them; the rest is zero before the first call and the library's alone, laid out as it likes. A
library keeps no state anywhere else (#190: a library object has no globals or memory of its own). The block is sized
for at most 1,025 × 1,025 height samples in sight cells of 8 or more samples and radar cells of 4 or more, 8 sides,
1,024 sensor rows and 1,024 unit rows; the tests stay inside that. Little-endian:

| Bytes | Field |
|---|---|
| +0 u32 | `heights`: the address of the plate's height samples in the caller's memory: binary32, `rows` rows along +z, each of `cols` samples along +x (sample (i, j) at `heights + 4 × (j × cols + i)`) |
| +4 u32, +8 u32 | `cols`, `rows`: the samples along x and along z |
| +12 u32 | `cell`: a sight cell's side, in height samples (the issue's default 8) |
| +16 u32 | `radar_cell`: a radar cell's side, in height samples (the issue's default 4); it divides `cell` |
| +20 u32 | `spread`: the steps a rebuild takes, 1 or more (the issue's default 3) |
| +24 u32 | S: the sides, 1 to 8 |
| +28 u32, +32 u32 | the address of the sensor rows, and N, how many |
| +36 u32, +40 u32 | the address of the unit rows, and U, how many |
| +44 u32 | `fog`: where the library writes the fog grid, i32 × (FC × FR) |
| +48 u32 | `seen`: where it writes each unit's seen bits, i32 × U |
| +52 u32 | `blip`: where it writes each unit's blip bits, i32 × U |
| +56 u32 | `blip_pos`: where it writes each unit's blip place, two f64 (x, z) × U |
| +60 u32 | `ghost`: where it writes each ghost row's bits, i32 × (U × S) |
| +64 u32 | `ghost_pos`: each ghost row's place, two f64 (x, z) × (U × S) |
| +68 u32 | `ghost_kind`: each ghost row's kind, i32 × (U × S) |
| +72 f64, +80 f64 | `x0`, `z0`: the place of sample (0, 0), in metres |
| +88 f64 | `spacing`: metres between samples |
| +96 i64 | `seed`: the blip jitter's seed |
| +104 u32 × 8 | `players[s]` for each side s < S: the side's player bits, bit p − 1 for player p (#954's convention: a side's bits are its players') |
| +136 to +255 | zero |

**A sensor row**, 40 bytes: `x` f64 at +0 and `z` f64 at +8 (metres), `height` f64 at +16 (metres above the unit's
ground; the issue's default eye height is 2), `range` f64 at +24 (metres), `kind` i32 at +32 (**0 none, 1 eye, 2
radar, 3 sonar, 4 jam, 5 detect**), `side` i32 at +36. A row of kind 0, of kind 3 (sonar isn't in this task), or of a
side outside 0 to S − 1 does nothing. The issue's "every sensor kind off except `eye`" is the kit's: a program gives
the library only the rows of the kinds its piece turned on.

**A unit row**, 40 bytes: `x` f64 at +0, `z` f64 at +8, `decloak` f64 at +16 (its decloak radius, in sight cells),
`side` i32 at +24 (**−1, or any side outside 0 to S − 1: no unit**), `kind` i32 at +28 (what a ghost of it keeps),
`flags` i32 at +32 (**bit 0 cloaked, bit 1 structure**), 0 at +36.

The program may rewrite any sensor or unit row between calls; a call reads the rows as they stand.

### The grids and the arrays (this job's, on #552's forms)

- **The sight grid**: GC = ⌊(cols − 1) ÷ cell⌋ by GR = ⌊(rows − 1) ÷ cell⌋ sight cells; cell (cx, cz) spans samples
  cx × cell to (cx + 1) × cell along x, and likewise along z. A 1,025 × 1,025 plate has 128 × 128 sight cells of 8
  samples.
- **The fog grid** is the grid the issue's `unseen | radar | seen` live in, one cell a radar cell: with q = cell ÷
  radar_cell, FC = GC × q by FR = GR × q cells, fog cell (fx, fz) inside sight cell (⌊fx ÷ q⌋, ⌊fz ÷ q⌋). `fog` holds
  it row by row (cell (fx, fz) at index fz × FC + fx), each value **#552's two bits a player: 0 unseen, 1 radar, 2
  seen, player p's in bits 2(p − 1) and 2(p − 1) + 1**; a side's state is written in each of its players' two bits. So
  a logic item declares it as #552's `fog: {grid, size: [FC, FR], origin: [x0, z0], cell: radar_cell × spacing}` and an
  overlay reads it through `match.me`.
- **`seen`**: for each unit row, #552's `seen` column: the player bits of every side that sees it. **`blip`**: the
  player bits of every side that holds it on radar without seeing it (a `seen` column for an instancer of blips).
  **`blip_pos`**: the unit's place with a jitter that is a pure function of the header's `seed`, the unit's row index
  and `k`, and stays in the unit's radar cell; which function is the implementer's, and no test reads the array (the
  two copies' hashes hold it).
- **Ghost rows**: one for each unit and side, row u × S + s. `ghost` holds side s's player bits while the row holds a
  ghost and 0 otherwise (a `seen` column for an instancer of ghosts); `ghost_pos` its last-seen place (x, z) and
  `ghost_kind` its last-seen kind. Where `ghost` is 0 the other two aren't read.

### The sight rule, in full (this job's; the issue: "a cell is seen when the line from the sensor's eye height to the cell's ground point stays above the heights it crosses, sampled on the coarse grid in pinned math")

Every number is a binary64, and every operation an IEEE 754 add, subtract, multiply, divide, floor, ceil, absolute
value or comparison, one rounding each, in the order written; no multiply and add is fused. JavaScript and WebAssembly
give the same bits for each, so `model.ts` and a library agree cell for cell (checked: Checked before the base run).

- **The coarse height** of sight cell (cx, cz), H(cx, cz): the height sample at its centre, sample (cx × cell + ⌊cell ÷
  2⌋, cz × cell + ⌊cell ÷ 2⌋), widened from binary32 (exact).
- **Sight-cell coordinates**: m = spacing × cell; a point (x, z) lies at ex = (x − x0) ÷ m, ez = (z − z0) ÷ m. It is on
  the grid when 0 ≤ ex < GC and 0 ≤ ez < GR.
- **An eye sees sight cell (tx, tz)** when all of these hold:
  1. the eye is on the grid;
  2. the cell's centre is within its range: with rc = range ÷ m, dx = (tx + 0.5) − ex and dz = (tz + 0.5) − ez,
     dx × dx + dz × dz ≤ rc × rc (a centre at exactly the range is inside);
  3. the line stays above the heights it crosses: the eye is at height he = H(⌊ex⌋, ⌊ez⌋) + height, over its own cell's
     ground; the cell's ground point is its centre at height H(tx, tz); with dh = H(tx, tz) − he and n = max(⌈|dx|⌉,
     ⌈|dz|⌉), for every whole i from 1 to n − 1, with t = i ÷ n, the line's height he + dh × t is **greater than**
     H(⌊ex + dx × t⌋, ⌊ez + dz × t⌋). A height equal to the line's blocks it. With n ≤ 1 nothing is crossed.
  The march takes one sample a cell along the longer axis, never the eye's or the cell's own point, so a cell's own
  ground never hides it and every row or column between the two is sampled.
- **A side sees a sight cell** when any of its eye rows does.
- **Radar** ignores the heights: with mr = spacing × radar_cell, a radar or jam row at (x, z) holds fog cell (fx, fz)
  when, with dx = (fx + 0.5) − (x − x0) ÷ mr, dz = (fz + 0.5) − (z − z0) ÷ mr and rr = range ÷ mr, dx × dx + dz × dz ≤
  rr × rr. A fog cell is under a side's radar when one of that side's radar rows holds it, and jammed for a side when a
  jam row **of another side** holds it.
- **A fog cell's state for a side**: seen (2) when the side sees its sight cell; else radar (1) when it is under the
  side's radar and not jammed for it; else unseen (0).

### One call (this job's; the issue: "a side's grid is rebuilt over `spread` steps")

`sight(s, k)` does, in order:

1. **Its share of the rebuild.** With p = k mod spread (k unsigned), it rebuilds sight rows ⌊GR × p ÷ spread⌋ up to,
   not including, ⌊GR × (p + 1) ÷ spread⌋, and the fog rows inside them: for every side, each of those cells' state
   from the sensor rows as they stand at this call, written into `fog`. Every other row keeps the state and the value
   its last rebuild gave it; a row never yet rebuilt reads 0. With `spread` 1 every row is rebuilt at every call.
2. **Every unit row, every call.** A row with no unit has `seen` 0 and `blip` 0. Else, with its fog cell (⌊(x − x0) ÷
   mr⌋, ⌊(z − z0) ÷ mr⌋) (off the grid: unseen for every other side): its own side always sees it. For every other
   side, with st that side's state at the unit's fog cell as the grid now stands: the unit is **hidden** from it when
   its cloaked flag is set and that side has no detect row within its decloak radius: with dx = (xs − x0) ÷ m − (x − x0)
   ÷ m and dz likewise, for a detect row at (xs, zs), within when dx × dx + dz × dz ≤ decloak × decloak (a detect row's
   own `range` and `height` aren't read). Not hidden, the side sees the unit when st is seen, and holds it as a blip
   when st is radar. `seen` and `blip` are the bits of the sides that do.
3. **Every ghost row, every call.** For unit row u and side s: when the unit is there, of another side, a structure,
   and s sees it at this call, s **knows** it, with its place (x, z) and kind as they are now, and the row holds no
   ghost. Else, when s knows it: if s's state at the fog cell holding the known place is seen, s knows it no longer and
   the row holds no ghost; otherwise the row holds a ghost of s's player bits at the known place and of the known kind.
   Else the row holds no ghost. A side never holds a ghost of its own unit.

### The documents (the base's forms; nothing new)

`docs.ts` writes the two pieces `deep-show` plays, in #391's envelope as #552's suite writes it. Their logic item
`sense` is this suite's driver with `step_rate: 30`, `links: [{name, asset}]` naming the reference library as
`first_party` gives it, `assets` (the script, then the heights), `budget: {fuel: 10000000, memory}`; the library's
object, like every asset, is put in the scenario's evidence store. The map's item adds #552's `fog: {grid: "sense.fog",
size, origin, cell}`. The net item: `{relay, players: 2, step_rate: 30, delay: 4, window: 0, hash_every: 10}`.

### Planted twins (this job's names; the programs are the issue's)

This suite carries its own wrong libraries rather than asking the implementation to ship four more: one WebAssembly
text (`programs.ts`: `libraryText`) with one flag each, in a pack of this suite's (`sensetwins@1.0.0`, origin
installed), each implementing nothing and linked by its own name (imported as `lib:<name>.sight`, #190), each with a
trivial own fixture any `sense.lib@1` library passes (a flat 16 m plate one eye sees whole). That is #953's choice, for
its reasons: the text with no flag is a `sense.lib@1` library by this README's rule, which the checks below ran before
any implementation existed. `model.ts` holds the same five flags, so each twin was checked against the reference with
its own flag.

| Name | Criterion | The wrong library, the rule's with exactly this changed |
|---|---|---|
| `sense_ignores_heights@1` | 1 | every coarse height reads 0: the eye's ground, the cell's ground point and every height the line crosses |
| `sense_jams_own_side@1` | 2 | a jam row jams the fog cells it holds for every side, its own included |
| `sense_cloak_ignores_radius@1` | 3 | a cloaked unit is hidden from every other side whatever detect row is near |
| `sense_ghost_clears_on_radar@1` | 3 | a known place's ghost clears when the side's state there is radar or seen, not only seen |
| `sense_rebuilds_in_one_step@1` | 4 | every call rebuilds every row, whatever `spread` says |

## Programs

`programs.ts` holds the WebAssembly text and the bytes; `helpers.ts` assembles it with #416's assembler.

- **The driver**, an ordinary logic program (a relocatable object importing `sight` from `lib:sense.lib@1`, or from
  `lib:<name>` for a library by its own name): `reads_at` 0, `writes_at` 65,536, the state at 1 MiB, the rows after it,
  `assets_at` 3,407,872; memory 64 pages, or 128 for a 1,025 × 1,025 plate. `init` writes the header from its script's
  own and empties every unit row. Each step it applies the step's ops, calls `sight(s, k)`, fills the arrays a piece's
  instancers read, then moves every row by its velocity (one f64 add a coordinate, so a place at step k is its start
  plus k adds, the same in `model.ts`).
- **Its script** (asset 0): a 128-byte header (`cols`, `rows`, `cell`, `radar_cell`, `spread`, S, N, U as u32 from +0;
  `x0`, `z0`, `spacing` and the height rows are drawn at as f64 from +32; the players' bits from +64; the seed at +96),
  then ops of 8-byte words: END (0) closes a step, SENSOR (1) and UNIT (2) carry a row index and a 40-byte row,
  SENSOR_VELOCITY (3) and UNIT_VELOCITY (4) an index and two f64, HALT (5) ends the script. **The heights** (asset 1):
  the plate's samples as the header's `heights` reads them.
- **Its writes**, declared in name order: the library's seven (`fog`, `seen`, `blip`, `blip_pos` as vec2, `ghost`,
  `ghost_pos` as vec2, `ghost_kind`), written by the library where the header points, into the write region; and the
  driver's own for instancers: `gen` and `ghost_gen` (1), `unit_live`, `live_a`, `live_b` (the row holds a unit; of
  side 0; of side 1), `ghost_live` (`ghost` ≠ 0), and `unit_pos`, `blip_at`, `ghost_at` as vec3 (x, the script's
  height, z).
- **This suite's library**: by the rule, straightforwardly: at its first call it copies the coarse heights; each call
  it clears its rows' sight bytes, marks each eye's cells in its range over a bounding box (marching every ray, and
  skipping none another eye already sees), marks each radar's and jammer's discs, then writes each fog cell of its rows.

## Fixtures (fixtures.ts), with their numbers

All plates have samples 1 m apart, centred on the origin (#2014: sample i at −size ÷ 2 + i), so a sight cell is 8 m and
a fog cell 4 m. Side 0 is player 1 and side 1 player 2 unless said.

- **The ridge plate** (criteria 1 and 4): 1,024 × 1,024 m, 1,025 × 1,025 samples, 128 × 128 sight cells, 256 × 256 fog
  cells. A ridge 40 m high from edge to edge across its middle, 16 m thick (−8 ≤ z ≤ 8: sight rows 63 and 64). Behind
  it a hill 120 m high, one row deep and four cells wide (−24 ≤ z ≤ −16, −16 ≤ x ≤ 16: row 61, columns 62 to 65).
  Flat at 0 elsewhere.
- **Criterion 1.** One eye of side 0 at (4, 300), the centre of sight cell (64, 101), 300 m in front of the ridge's
  line, 2 m above its ground, range 330 m (41.25 cells; no cell's centre lies at exactly that distance). Three units:
  its own; an enemy at (40, −12), on flat ground behind the ridge and inside the range; an enemy at (−20, 100) in
  front. The defaults: cells of 8 and 4, a rebuild over 3 steps; 4 steps are baked (rows 0 to 41, 42 to 84, 85 to 127,
  then 0 to 41 again). **The closed form, written by hand** (`ridgeSeen`): within the range, every cell on the eye's
  side of the ridge is seen (the line falls from 2 m to 0 over ground at 0); the ridge's front row (64) is seen (the
  line rises to 40 m over ground at 0) and its back row isn't (the line is under 40 m over the front row); every flat
  cell behind it is unseen (the line is under 2 m where it crosses the 40 m ridge); the hill's four cells are seen
  (the line to its top is over 110 m at the ridge). 4,587 sight cells in front are seen and 3,477 aren't; behind, 4
  are seen and 8,060 aren't.
- **The flat plate** (criteria 2 and 3): 128 × 128 m, 129 × 129 samples, 16 × 16 sight cells, 32 × 32 fog cells, flat.
  Both fixtures ask `spread` 1.
- **Criterion 2.** Side 0 is player 1; **side 1 is players 2 and 3** (bits 6), so a side's bits are seen to be its
  players'. Side 0's radar at (−20, 0), range 40 m. Side 1's jammer at (10, 0), range 24 m, live through step 5 and
  gone (its row of kind 0) from step 6; side 1's own radar at (20, 10), range 16 m. Unit 0 (side 1) at (6, 2), in fog
  cell (17, 16): inside the radar and inside the jammer. Unit 1 (side 1) at (−30, 20), cell (8, 21): inside the radar,
  outside the jammer. Unit 2 (side 0) at (20, 12), cell (21, 19): inside side 1's radar and side 1's jammer. 9 steps.
- **Criterion 3**, one bake of 402 steps. The cloak, in the west: side 0's eye at (−40, −40), range 40 m; a cloaked
  unit of side 1 (unit 0) at (−28, −36), decloak radius 4 cells (32 m); a plain unit of side 1 (unit 1) at (−36, −28);
  side 0's detect row starts at (−28, 11.5), 47.5 m from the cloaked unit, and comes 1 m a step nearer: 32.5 m (4.0625
  cells) at step 15, 31.5 m (3.9375 cells) at step 16; it stops at step 20. The ghost, in the east: a structure of side
  1 (unit 2, kind 7) at (36, 20), fog cell (25, 21); side 0's eye at (28, 28), range 42 m, placed at step 100, taken
  away at step 200, placed again at step 400; the structure's row emptied at step 250; side 0's radar at (36, 28),
  range 20 m, placed at step 300. The structure's ghost row for side 0 is row 2 × 2 + 0 = 4.
- **Criterion 4, the fleet.** The ridge plate. 300 units, each with an eye 2 m above its ground of range 27 m (3.375
  cells), on a lattice of 25 columns 40 m apart (x from −480) by 12 rows 80 m apart (z from −440), sides alternating
  like a chessboard, 150 a side; each drifts 0.5 m a step along ±x or ±z by its place in the lattice, its sensor with
  it. `spread` 3; the item steps at 30 Hz. **What it makes a library spend**: a rebuild has 9,600 to 12,000 eye-and-cell
  pairs in range (it varies as the units drift), whose rays take 13,200 to 18,000 samples, and 65,536 fog cells for
  each of two sides to write; a step of a rebuild over 3 has a third of each, and 300 units' and 600 ghost rows' bits. See logic.budget, under Readings, for
  the ceilings and for why the two runs fall on either side of the web's.
- **Criterion 5, the strategy map.** 256 × 256 m, 257 × 257 samples, 32 × 32 sight cells, 64 × 64 fog cells; a ridge
  12 m high across its middle (|z| < 8, the plate's field `12 * max(sign(8 - abs(position.z)), 0)`); `spread` 3. Side 0
  in the south (+z): eyes at (−40, 60) of range 90 m and at (20, 80) of range 70 m, each on a unit; a radar at (0,
  100) of range 170 m; a scout that starts at (100, 44) and goes west 2 m a step until step 80, carrying an eye of
  range 40 m and a detect row. Side 1: three units behind the ridge at (−50, −40), (10, −60) and (60, −30); a cloaked
  unit at (−80, 40), decloak radius 4 cells; a depot (a structure, kind 3) at (100, 20). 90 steps. By the reference:
  the units behind the ridge are blips and never seen; the depot is seen from step 1 and a ghost from step 19, once
  the scout has left; the cloaked unit is seen from step 75.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s `criterionId`: `#959.` and the first 8 hex digits of the SHA-256 of each
criterion's text, trimmed, white space collapsed, computed from the issue's body. Each `describe` and each test's name
starts `AC<n> #959.<h8>`; each file quotes its criterion in full.

| AC | ID | File (tests) | Surface | What it asserts | Fails |
|---|---|---|---|---|---|
| 1 | `#959.cff22b0c` | `ac1-ridge.test.ts` (2) | `deep-logic` `first_party`, `check`, `bake` | The reference gives the closed form at every cell, and a reference that ignores the heights doesn't; the grid holds seen and unseen cells in front of the ridge and behind it. The pack declares `sense.lib@1`; the reference library links through it with every interface fixture PASS; every fog cell at each of 4 steps (the rebuild's three shares and the next) equals the ray march's; player 1 sees the unit in front and not the one behind. The planted library: the same judgement fails, its first wrong cell one it marks seen where the ray march says unseen, behind the ridge, named as `sight cell (cx, cz)` | the base; a library that ignores the heights (the twin), marches another rule, rebuilds other rows or all at once |
| 2 | `#959.9f68d843` | `ac2-radar-jammer.test.ts` (2) | `first_party`, `bake` | Every fog cell, seen bit and blip bit at each of 9 steps equals the reference's; fog cell (17, 16) reads unseen for player 1 through step 5, the jammer's last, and radar from step 6; cell (8, 21) reads radar throughout; cell (21, 19) reads radar for players 2 and 3 throughout; unit 0's `seen` stays 6 and its `blip` is 0, then 1 from step 6. The planted library: every wrong cell is one of side 1's own radar's, unseen through step 5, the first named as `fog cell (fx, fz) … for side 1` | the base; a jammer that clears its own side (the twin) or no side, radar that the heights block, a jammer that lingers a step, a side's state in one player's bits only |
| 3 | `#959.7485f12b` | `ac3-cloak-ghost.test.ts` (3) | `first_party`, `bake` | Every fog cell, seen bit, blip bit and ghost row at each of 402 steps equals the reference's; player 1's bit of the cloaked unit is clear through step 15 and set from step 16, the plain unit's set throughout; player 1 sees the structure at exactly steps 100 to 199; ghost row 4 holds a ghost at exactly steps 200 to 399, player 1's, at (36, 20), of kind 7, through the structure's end at 250 and the radar from 300; no other row ever does. The planted cloak: the first miss is `seen`, unit 0, step 16, naming `unit 0` and `step 16`. The planted ghost: the first miss is ghost row 4 gone at step 300, naming `ghost row 4` | the base; a cloak no detect lifts (the twin) or one lifted at another radius; a ghost that clears under radar (the twin), follows the structure, forgets its kind, or outlives its cell's being seen |
| 4 | `#959.5f8a3deb` | `ac4-budget.test.ts` (2) | `first_party`, `about`, `bake`, `budget` | The fleet in a `data_view` piece at 30 Hz, 12 steps: every fog cell and seen bit equals the reference's; logic.budget on `[app, web]` with `fuel_share: 1` has no failure, a verdict of PASS or BLOCKED on the web alone, the item `pipelined` and held to twice ⌊1,500,000 ÷ ns per fuel unit⌋ on each host (from `about`); every step's fuel in the bake is at or under both. The planted rebuild: verdict FAIL, a `ceiling` failure of host `web` at step 0 naming the web ceiling, its fuel over it, and no `ceiling` failure of host `app` | the base; a library whose share of a rebuild passes the web ceiling; a rebuild in one step (the twin) |
| 4 | `#959.5f8a3deb` | `ac4-copies.test.ts` (1) | `first_party`; `deep-show run`: `deep show`, `match` | The fleet piece is presented; both copies run 41 match steps and end nowhere; each reports a full-state hash at steps 0, 10, 20, 30 and 40, equal on the two copies at each, all five different; every fog cell and seen bit in every step row of each copy equals the reference's; in the reference the grid differs between every two hash steps and seen bits between some | the base; a library whose state differs between copies, or whose grids stand still |
| 5 | `#959.3faaa651` | `ac5-taste.test.ts` (1) | `first_party`; `deep-show run`: `deep show`, `match` with `views` | By replies first: on the reference the ridge blocks player 1's sight, the three units behind it are blips, the cloaked unit is hidden at step 12 and seen at step 84, the depot is seen at step 12 and a ghost at (100, 20) of kind 3 at step 40; the map is presented, both copies play 90 steps, and every fog cell, seen bit, blip bit and ghost row of copy 1 equals the reference's. Then copy 1's frames after steps 12, 40 and 84 and a recording of every third step from 0 to 87 are written to `docs/evidence/959/`, and `TASTE.json` is read: none or a call on other pictures is INCONCLUSIVE, `looks_wrong` fails, `looks_right` on exactly these passes. It judges no picture | the base; a library that leaves the map's state off the reference; no recorded call |

Test count: 2 + 2 + 3 + 2 + 1 + 1 = 11. Each twin's test first holds the reference library to the same judgement (one
bake a file serves both tests), so the same check passes on the shipped library and fails on the twin.

**Tolerances.** None. A cell's state, a bit, a step, a ghost's place (the unit row's own f64s) and its kind are
compared exactly. `blip_pos` is not compared.

## The taste call (criterion 5)

The pictures are copy 1's own frames of the piece (`match`'s `views`, #552's: the panel as that copy draws it through
its `match.me`), 768 × 768 px over the 256 m plate, re-encoded so the same pixels give the same bytes:
`docs/evidence/959/ridge-and-blips.png` (after step 12), `last-seen-ghost.png` (after step 40),
`cloaked-unit-revealed.png` (after step 84) and `fog-changing.apng` (30 frames, every third step from 0 to 87, 10 a
second). The owner's answer goes in `tests/acceptance/959/TASTE.json`, in #552's and #537's form:

```json
{ "issue": 959, "criterion": "#959.3faaa651", "verdict": "looks_right", "who": "<name>", "when": "2026-11-21T10:00:00Z",
  "screenshots": { "ridge-and-blips.png": "<sha256>", "last-seen-ghost.png": "<sha256>", "cloaked-unit-revealed.png": "<sha256>", "fog-changing.apng": "<sha256>" } }
```

`verdict` is `looks_right` or `looks_wrong` (with an optional `note`); the SHA-256s are the ones the test prints. This
job writes no `TASTE.json`.

## Readings where the issue and the design leave a choice

- **"A first-party library interface with a reference library"**: a first-party pack of any name declares it and
  carries exactly one library that implements it, as #981's suite reads lanes@1.
- **`sight {sensors, heights, cell}`**: one export; the sensors, the heights and the cell are fields of the state it
  is given. **"heights: plate grid"**: nothing in the logic module reads a plate, so the program hands the library the
  plate's height samples as bytes in its own memory, which a piece gets there as a data asset its item names in
  `assets` (the plate's own samples: its field sampled at each sample, or its heightmap's values). binary32, as the
  plate's field and its collision are.
- **"Sampled on the coarse grid"**: a sight cell's coarse height is its centre sample, the cheapest that is exact, so a
  feature must cover a cell's centre to block. **"The cell's ground point"**: its centre at its coarse height. **"The
  sensor's eye height … above the unit's ground"**: the row's `height` over the coarse height of the eye's own cell.
  **"Stays above"**: strictly; a height equal to the line's blocks it. **Range**: the cell's centre within the range on
  the ground, the boundary inside.
- **"Sight cells of 8 × 8 height samples, radar cells of 4 × 4"**: both in height samples, so a radar cell is a quarter
  of a sight cell. One grid holds `unseen | radar | seen`, so it has the finer cell, the radar's, and each sight
  cell's seen covers its four fog cells. Criterion 1's cells are sight cells; "a decloak radius of 4 cells" is in sight
  cells, the library's `cell`.
- **"A side's grid is rebuilt over `spread` steps"**: the whole grid, radar and jamming with it, by rows; the units'
  bits and the ghost rows are written at every call from the grid as it stands, so a cloak lifts at the step the
  detect row comes near whatever the spread.
- **`spread` 1 in criteria 2 and 3.** With a rebuild over 3 steps a cell changes only at its row's step, so "the step
  after the jammer dies" would hold for one row in three, and no cell can change at steps 200 and 400 both (they leave
  different remainders by 3). Those fixtures ask `spread` 1, the value at which a cell's state at a step is the rows'
  at that step; criteria 1, 4 and 5 use the default 3.
- **"Becomes `radar` the step after the jammer dies"**: the jammer dies at its last live step, 5; the step after is 6,
  the first whose rows hold no jammer. **"Stays unseen on the radar side's grid"**: its fog cell reads unseen for the
  radar side's player; the unit is then that side's blip, never seen ("radar shows blips but not kinds").
- **"A cloaked unit is unseen unless a `detect` sensor is within its decloak radius"**: the cloak hides it from sight
  and from radar; a detect row of a side lifts it for that side and adds no sight of its own, so the fixture keeps the
  unit's cell in that side's sight. **"Seen at that step on every copy"**: at that step in the `seen` array, which is
  the same on every copy since logic never reads `match.me`; two copies' agreement is criterion 4's.
- **"A structure seen at step 100 and out of sight from step 200 stays a ghost at its step-100 position until its cell
  is seen again at step 400"**: seen at steps 100 to 199; a ghost at steps 200 to 399, at the place it was seen
  (structures don't move, so its step-100 place); the row is clear at step 400. The structure is destroyed at step 250,
  so the ghost is shown to keep a place and a kind no row holds any more, and the clearing at 400 to follow the cell,
  not the unit. **"A planted ghost that clears when a radar cell covers it"**: the watching side's own radar, from
  step 300.
- **logic.budget and the class.** A 30 Hz item is pipelined, held to twice its class's 60 Hz ceiling (#546). At the
  base's metering record (0.25 ns a fuel unit in the app, 0.391 on the web) that is 24,000,000 and 15,345,268 for the
  4 ms classes, both over the 10,000,000 fuel one step may spend, so no step could fail there; for the 2 ms classes it
  is 12,000,000 in the app and **7,672,634 on the web**. So the fleet's piece is a `data_view` (the class table's
  "flat maps"), the only frame CPU at which the criterion's planted rebuild can fail on the web; the test computes both
  ceilings from `about` and fails, saying so, if the web's isn't under 10,000,000.
- **"Pass logic.budget with `on: [app, web]` … at every step"**: no failure, and every step's fuel at or under both
  ceilings. From fuel alone the base answers `BLOCKED` on the web's timed run (#546's criterion 2 holds a PASS from
  fuel alone to be wrong), and the issue's Runs on line says this criterion needs no browser timing, so the verdict
  may be PASS or BLOCKED on the web alone. `fuel_share: 1`, as #546's and #953's suites pass it: the criterion names
  the step ceiling.
- **Why the two runs fall on either side of the web ceiling.** The planted run is this suite's own library, so its
  fuel is fixed and read off the base: 9,082,478 at step 0 and 8,559,721 to 8,760,121 at the eleven after, each over the web ceiling and under the 10,000,000 a step may spend, so it fails the ceiling and never traps. The reference library's run passes when its busiest step is at or under 7,672,634: this
  suite's library by the rule spends 3,510,301 at step 0 (with its one copy of the coarse heights) and 3,021,242 to 3,147,497 after, so a right library may cost up to 2.1 times as much a step and
  pass, and a faster one, or one that skips cells another eye already sees, passes with more room. No right library is
  asked to be slow: the failing side is never the shipped library's.
- **"Two copies agree on every grid and every seen bit at each hash interval"**: a `match` of the fleet piece with
  `hash_every: 10`; the copies' full-state hashes agree at every hash step, and both hold the reference's grid and seen
  bits at every step. **"Taken by the check run from the canvas's own frames"**: a copy's `views`, since the map's fog
  and rows are read through `match.me`.

## Not asserted, because no criterion reaches it

The assumption row for the strong defaults (#938 isn't on the base) and which sensor kinds a kit turns on; sonar; the
blip jitter's values; several player sides on one copy (#951's hot seat); the interface's own fixtures and planted
library beyond the fixtures' PASS at link; `deep_kinds`' listing; the fog gate on occurrences; a plate that isn't
centred or whose spacing isn't 1; cells of other sizes; units off the grid; more than two sides or a side with no
player; a check kind of its own (the issue rules it out); the web player; any time.

## What the implementer adds outside this folder

- A first-party pack declaring `sense.lib@1` (its entry, at least one fixture whose expected values come from a
  brute-force reference, never from a library, and a planted library that fails one), carrying its reference library,
  held in `deep-logic`'s binary and listed by `first_party`, as `packs/modslib-1.0.0` is.
- Nothing in `scripts/lanes.mjs` (`lane.json` is in this folder). `TASTE.json`, once the owner's call on the pictures
  is recorded, and the pictures under `docs/evidence/959/`, which the test writes.

## Checked before the base run

Temporary scripts and test files (deleted) held this suite's own pieces to real components before and beside the base
run. Until the base's builds were made and the build slot granted, a scratch assembler of this job's (not kept) wrote
the same WebAssembly text as whole modules and as relocatable objects; once the slot was
granted, one vitest run under it repeated the `deep-logic` and `deep-show` checks below through `helpers.ts` and #416's
assembler, with the same numbers.

- **The reference** (`model.ts`, in Node): on the ridge it gives the closed form at every one of 16,384 sight cells
  (4,587 seen and 3,477 unseen in front of the ridge, 4 seen and 8,060 unseen behind it); with the heights ignored it
  differs from the closed form at 344 fog cells, the first in sight cell (60, 60). It gives the criteria's steps: the
  jammed cell unseen through step 5 and radar from 6; the cloaked unit seen from step 16; the structure seen at 100 to
  199 and its ghost row 4 held at 200 to 399.
- **Node's WebAssembly**: the driver and this suite's library as one whole module, on every fixture (the ridge's 4
  steps, the jammer's 9, the cloak and ghost's 402, the fleet's 12, the map's 90): every fog cell, seen bit, blip bit,
  ghost row, ghost place and ghost kind equals `model.ts`'s, bit for bit, with no flag and with each twin's flag
  against the reference with the same flag; every blip place stays in its unit's radar cell. So JavaScript and
  WebAssembly agree on the rule as written.
- **The judgement** (`helpers.ts`: `misses`) on those rows: no miss for the library by the rule on any fixture; the
  library that ignores the heights first misses at step 1, sight cell (60, 60), seen where the reference says unseen;
  the jammer that clears its own side misses only side 1's radar cells through step 5, first fog cell (18, 15); the
  cloak that ignores the radius first misses unit 0's seen bits at step 16; the ghost that clears on radar first misses
  ghost row 4 at step 300.
- **The base's `deep-logic`** (the build this job was given): the whole module baked on every fixture gives the same
  arrays, and `check`'s layout of the sixteen writes equals `programs.ts`'s offsets. The driver and the library as
  relocatable objects, the library in `sensetwins@1.0.0` and linked by its own name: the own fixture passes for the
  rule's library and each twin, and the bakes give the same arrays. Fuel a step, read off those bakes: the ridge
  2,410,305, 3,834,070, 5,458,322 and 2,012,463; the jammer at most 157,433; the cloak and ghost at most 139,215; the
  map at most 358,063; the fleet 3,510,301 at step 0 and 3,021,242 to 3,147,497 after. logic.budget on the fleet in a
  `data_view` piece at 30 Hz: with the rule's library `BLOCKED` on the web's timed run with no failure, the item
  pipelined and held to 12,000,000 in the app and 7,672,634 on the web; with the one-step twin `FAIL`, a `ceiling`
  failure of host `web` at every step from 0 (9,082,478 fuel), a `frame` failure of the app, and no `ceiling` failure
  of the app.
- **The base's `deep-show`**, the two documents with the driver and the library as one whole module (no link): the
  fleet piece is presented with no issue, both copies run 41 steps, their five hashes agree and differ from each other,
  and every step row of each copy equals the reference; the map is presented, both copies run 90 steps on the
  reference's state, and copy 1's views after steps 12, 40 and 84 come back 768 × 768 px with `me` 1 (looked at: fog
  behind the ridge, three blips in the radar's grey, the depot's ghost, then the cloaked unit). A document whose logic
  item links a first-party library by name and hash (`mods.tree@1.0.0`, its object in the evidence store) is presented
  and its match plays, so `links` reaches a document's logic item as the two documents write it.

Not checked: anything of the implementation (none exists), so the tests' passing side; the pictures' and the
recording's files; the taste call.
