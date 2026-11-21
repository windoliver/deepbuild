# Acceptance tests for #953: mods.lib@1, modifier trees (criteria 1 to 5)

Written first, blind, from issue #953 (live, `gh issue view 953 --repo windoliver/deepbuild --comments`; no comments),
the design sections it links and the base commit `86b99ac36` ("Merge pull request #2932 …"), by a job that never saw
an implementation; none existed, and no other branch, worktree, pull request, plan or session was read. The Oracle
lane's port of the upstream tests for criteria 1 and 4 is `../953-oracle/`. The implementing agent doesn't edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue: its Scope, Fields (`mods.lib@1`'s exports, the modifier row, It can never), five acceptance criteria,
  Proof line and Oracle line.
- `docs/canvas-primitives.md`: Logic: library interfaces (its `mods.lib@1` sentence: "(base + adds) × (1 + percents ÷
  100), then the last set and the lowest cap, ties by source node and row, rounded once at the end, and recomputes only
  the totals a change marks, so a read is never stale; its fixtures come from a full recompute"), Logic: linked
  libraries, Logic: sandbox, Logic `logic@1`, Logic: data layouts, Asset: tables, Asset: tables: catalogs
  `table.layout@1` with its As built (#194), Pack, Pack: programs, Registry and seal: registries.
  `docs/technical-design.md`: The logic module (Logic, Sandbox and budgets, Logic bake and checks, Linked libraries,
  Library interfaces, Data layouts), "Where each layer runs", "Universal rules are tested as properties" (1,000
  generated cases per change, 100,000 at release, from recorded seeds), Dogfooding. `docs/parallel-proof.md` 12a (the
  budget window), for criterion 5's reading. AGENTS.md.
- The Oracle page (`doneright/oracles/issues/953.md`, branch `doneright` of DeepBuildAI/deepbuild) and the upstream
  test file it pins (`../953-oracle/README.md`).
- At the base, for the surfaces used: the suites `tests/acceptance/416/interfaces/` (README, helpers, programs,
  `wat.ts`), `190/` (README, helpers, the assembler), `531/` (README: bakes, steps, layouts), `546/` (README, helpers:
  logic.budget, the ceiling formula, `about.ns_per_fuel`) and `194/` (README: catalogs); `crates/deep-logic/src/`
  (`lib.rs` calls, `first_party.rs`, `links.rs`, `interfaces.rs`' planted check, `budget.rs`, `metering.json`, the
  piece's default class), `crates/deep-canvas/src/budget.rs` (the classes and their frame CPU),
  `crates/deep-canvas-sandbox/src/layouts.rs` (table.layout@1's doc), `crates/deep-catalog/src/lib.rs` (how a pack lays
  the bytes out), `scripts/proof-change.mjs` (criterion IDs), `scripts/lanes.mjs`, `scripts/preflight.mjs` (the
  release switch), `packs/interfaces-1.0.0/pack.json`.

At the base `first_party` lists one pack, `interfaces@1.0.0` (#416's physics2d.lib@1, fsm@1 and nn.mlp@1): no
`modslib`, no `mods.lib@1`, no `mods.tree` (BASE-FAILURE.txt). Everything else these tests drive is on the base:
`deep-logic`'s `check`, `bake`, `pack_check`, `budget`, `about`, links by name and by interface, interface fixtures at
link, `pack_refused` for an interface with no planted library, and #546's step ceilings.

## Run them

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:/opt/homebrew/opt/rustup/bin:$PATH"
npm ci && npm run build --workspaces          # once, in a fresh worktree
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  npx vitest run --root tests/acceptance/953 --testTimeout=600000 --no-file-parallelism
DEEP_PREFLIGHT=release ...the same...         # the release preflight: 100,000 cases and 100 large trees (criterion 1)
npx tsc -p tests/acceptance/953/tsconfig.json
rm -rf tests/acceptance/953/node_modules
```

What a run builds, honoring `CARGO_TARGET_DIR`: `deep-logic` for this host (#190's helpers, `cargo build --locked
--bin deep-logic`) and #416's assembler (`../416/interfaces/wat.ts`, used unchanged: #190's assembler built from the
system temporary folder with `--locked --manifest-path`, into `target/acceptance-416-wat`). Each test passes #190's
90-minute timeout (`--testTimeout` is only the default), and criterion 1's under `DEEP_PREFLIGHT=release` 72 hours.
Nothing needs Docker, Chrome or a GPU. On this shared Mac, run it as a test grant: `node scripts/throttle.mjs test
--wait 240 -- sh scripts/lease npx vitest run …`. **`scripts/lanes.mjs`
pushes this folder and `../953-oracle/` to `alone`**: the files build cargo binaries and run many `deep-logic` bakes.

How long, measured on this Mac under a load average of about 200 on 18 cores with this suite's own correct library
standing in for the reference (README: Checked before the base run), after the builds: 100 of criterion 1's cases took
95 s in one `deep-logic` process (about 24 s a piece of 25 trees, 51 steps each), so its 1,000 cases take about 16
minutes, the brute-force recompute 30 to 45 s of it; its planted library fails in the first process, about a minute;
criteria 2 to 4 and the Oracle lane, seconds each. Criterion 5's 500-node bake wasn't timed (this suite's library
traps on it: Checked before the base run); its recompute takes 10 to 16 s. The reference library's own speed changes
all of these. The release run is about a hundred times criterion 1's, plus the large trees (about half a minute of
recompute each).

## The surface

The issue names `mods.lib@1`, its exports by their parameters, a modifier row's fields, the pack `modslib@1`, the
reference library `mods.tree` and a planted library, but no WebAssembly signatures, no memory and no encoding. **Every
signature, layout, encoding, rule and reading below that the issue or the design doesn't give is this job's
invention**: the smallest the criteria need, in the design's spellings where it has them. The implementer builds
exactly these, or a dispute goes to a blind redraft. `deep-logic`'s calls and shapes stay as #190's, #416's, #531's and
#546's READMEs define them.

### modslib@1, mods.lib@1 and mods.tree

- **`{"call": "first_party"}`** (#416's) lists, beside `interfaces@1.0.0`, a pack named **`modslib`** whose version is
  1.x (`modslib@1`), `origin: "first_party"`, and every asset it names in `assets`.
- Its `interfaces` hold **`mods.lib@1`** (#416's Interface: `exports`, optional `layout`, `fixtures`, `planted`,
  `digest`) with exactly the six exports below, at least one fixture (each an interface fixture in #416's shape, its
  expected values from a brute-force recompute over the whole tree, never from a library) and at least one planted
  library that fails one of them.
- Its `libs` hold the reference library **`mods.tree@<version>`** (the tests take the entry whose name starts with
  `mods.tree@`), with `implements: ["mods.lib@1"]` and its own fixtures (#190), so a piece links it like any library.
- A program imports an export as **`lib:mods.lib@1.<export>`** and links `mods.tree@<version>` by name and hash
  (#416's surface); a library of this interface linked by its own name is imported as `lib:<name>.<export>` (#190).

### The exports

`t` is always the address of the tree (below) in the caller's memory. Every parameter is an i32 but `total`'s result.

| Export | Params → results | Does |
|---|---|---|
| `attach` | (t, node, parent, row) | puts `node` under `parent` (−1: at the top, a side of its own), with the catalog row whose ID hashes to `row` (the u32 FNV-1a hash's bits); a hash no row of the node table holds gives it no row. Attaching an attached node moves it, its subtree with it, and its row becomes `row`. Changes nothing when node or parent is outside 0 to 511 (parent −1 aside), or parent is node or one of its descendants |
| `detach` | (t, node) | takes an attached node out of the tree; its descendants stay under it, out with it, and attaching it again brings them back. Changes nothing for a node not attached |
| `add` | (t, row) → i32 | copies the 104-byte modifier row at address `row` and returns its id: 0 for the tree's first add, then 1, 2, … in add order, never reused; −1, adding nothing, for a row with a field out of range or past the tree's 4,096th add |
| `remove` | (t, id) | the row is gone; an id never returned, or removed, changes nothing |
| `tick` | (t, boundary) | a boundary passes: 0 a turn's, 1 a round's (any other value changes nothing). Each row whose duration is in that unit counts it, and at the count-th such boundary after its add it is gone, rows ending in id order. A turn boundary never counts for a rounds row, nor a round's for a turns row |
| `total` | (t, node, stat) → i64 | the node's total for the stat, by the rule below, never stale: every change before the call is in it. 0 for a node outside 0 to 511 or a stat outside 0 to S − 1 |

`exports` in the pack lists them so: `attach` `["i32","i32","i32","i32"] → []`, `detach` `["i32","i32"] → []`, `add`
`["i32","i32"] → ["i32"]`, `remove` `["i32","i32"] → []`, `tick` `["i32","i32"] → []`, `total` `["i32","i32","i32"] →
["i64"]`.

### The tree

1,048,576 bytes at `t` in the caller's memory. The program writes the first 128 bytes, the header, before its first
call and never changes them; the rest is zero before the first call and the library's alone, laid out as it likes. A
library keeps no state anywhere else (#190: a library object has no globals or memory of its own). Little-endian:

| Bytes | Field |
|---|---|
| +0 u32 | the address of the catalog's first byte in the caller's memory: a `table.layout@1` asset the item names in `assets`, which the logic module copied to memory |
| +4 u32 | the FNV-1a hash of the name of the catalog table that holds the nodes' rows (the node table) |
| +8 u32 | the FNV-1a hash of the node table's ID column's name (#194's As built: an i32 column holding each row's ID hash, rows sorted by it, unsigned) |
| +12 u32 | S, the stats the tree totals, 1 to 16 |
| +16 u32 × 16 | for each stat s < S, the FNV-1a hash of the name of the node table's column holding its base |
| +80 to +127 | zero |

At most 512 nodes (IDs 0 to 511), 16 stats (0 to S − 1) and 4,096 adds in a tree's life.

### A modifier row

104 bytes at the address `add` is given, little-endian; a row with zeros past `value` has the strong defaults (reach
down, no duration, no filters):

| Bytes | Field |
|---|---|
| +0 i32 | source: a node |
| +4 i32 | stat, below S (the issue's u16) |
| +8 i32 | op: 0 add, 1 percent, 2 set, 3 cap |
| +12 i32 | reach: 0 down, 1 side, 2 all |
| +16 i64 | value; a percent's in whole percent points (20 is 20%) |
| +24 i32 | duration: 0 none, 1 turns, 2 rounds |
| +28 i32 | its count, 1 to 65,535 (the issue's u16) |
| +32 i32 | how many filters, 0 to 4 |
| +36 i32 | 0 |
| +40 4 × 16 | the filters, each a column (u32, the FNV-1a hash of a column name of the node table) at +0, cmp (i32: 0 eq, 1 ge, 2 le) at +4 and a value (i64) at +8 |

### The rule

- **In the tree**: a node attached whose every ancestor is attached, up to a node attached at the top. A node's
  **side** is that top node. A node outside the tree (never attached, detached, or under a detached node) takes no
  modifier, and its rows reach nothing; its total is its base.
- **Base**: the node's row's value in the stat's base column, an i32 read sign-extended; 0 for a node with no row (or
  never attached), a column the table lacks, or a column not of type i32 (0). A detached node keeps its row.
- **Reach**, for a row whose source is in the tree: `down`, every descendant of the source (not the source); `side`,
  every node under the source's side (its descendants, the side itself not; the source among them unless it is the
  side); `all`, every node in the tree, sides included.
- **Filters**: each holds when the receiving node's own row's value in the column (an i32, sign-extended) is equal to,
  at least or at most the filter's value; a filter on a node with no row, or on a column the node table lacks or that
  isn't i32, doesn't hold. A node takes a row only when every one of its filters holds; the source's row plays no part.
- **Total**: of the rows of that stat reaching the node whose filters all hold, x = 100 × the last set's value when
  any set is among them, the last by the tie rule (sets ordered by source node ID, then by id, the greatest last); else
  x = (base + Σ add) × (100 + Σ percent). Then, when a cap is among them and 100 × the lowest cap is below x, x = 100 ×
  that cap. The total is x ÷ 100 rounded toward zero (i64's `div_s`), the only rounding. In whole numbers: base 10, add
  5, percent 20 and cap 16 give x = 1,800, capped to 1,600, total 16; without the cap, 18.

### What a program writes, so a test can read totals

This suite's **driver** (programs.ts: `driver`) is an ordinary logic program, a relocatable object importing the six
exports from `lib:mods.lib@1` (or a library's own name): one memory of 64 pages, `reads_at` 0, `writes_at` 4,096, the
tree at 131,072, `assets_at` 1,245,184, the item's assets the script, then the catalog. `init` copies the script's
first 128 bytes to the tree's header and writes the catalog's address (the script's address + its length + 4) at +0.
Each step runs the script's ops to the step's END, then writes `totals` (f64 × R: each total read, `f64.convert_i64_s`,
in read order), `reads` (i32: how many it read) and `last_id` (i32: what the latest `add` returned, −1 before any).
Items give it `budget.fuel` 10,000,000. The script (programs.ts: `scriptBytes`), i32 words: the header, then ops,
END (0) closing each step and HALT (8) the script: ATTACH (1) node parent row-hash, DETACH (2) node, ADD (3) and the
104-byte row (passed to `add` where it lies), REMOVE (4) id, TICK (5) boundary, READ (6) node stat, READ_NODES (7)
first count (every stat of each node in turn).

### The catalog

catalog.ts packs one table, `pieces`, ID column `id`, i32 columns `kind`, `level`, `player`, `attack`, `defense`,
`morale` and `speed`, laid out by table.layout@1's doc and #194's As built as `deep-catalog`'s packer lays one table
out (columns, the ID column among them, in order of their name hashes; rows by ID hash; `pool_at` the end of the
values, `pool_count` 0): named rows (`archer` attack 10, `swordsman` 12, `pikeman` 8, `hero` 5, sides, an item, the
Oracle lane's rows) and 24 kinds `k00` to `k23` the seeded trees draw. Filters read `kind`, `level`, `player`, `attack` and a column no table holds (`rarity`).

## Generated cases

model.ts's `seededCase` (mulberry32; case i of a recorded seed is `seed + (i + 1) × 0x9e3779b1`): a tree of 2 to 64
nodes (1 to 3 sides, each other node under an earlier one, or left out, with a seeded row or none), 0 to 128 rows
(add 40%, percent 30%, set 10%, cap 20%; reach down 60%, side 25%, all 15%; 0 to 4 filters), and 50 edits: moves (an
attached node to another parent outside its subtree, or to the top), attaches of nodes outside the tree, detaches,
adds and removes (no ticks: the criterion lists none). seeds.json records the seeds: `edits` (criterion 1: 1,000
cases, or 100,000 with `DEEP_PREFLIGHT=release`, the release preflight's switch), `large` (100 trees of up to 500
nodes and 2,000 rows, 1,000 edits each, release only), `order` (criterion 4: 25 trees, no two sets sharing a source and
a stat) and `budget` (criterion 5: 500 nodes, 2,000 rows, 60 edits). A failure names the case's seed, so it replays.
Shrinking a failure to its smallest case isn't done here (no criterion asks for it).

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: `#953.` and the first 8 hex digits of the SHA-256 of each criterion's text,
trimmed, white space collapsed. Each test's name starts with its criterion's ID.

| ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| 1 `#953.ab5c01d3` | `ac01-seeded-edits.test.ts` (2) | modslib@1 declares mods.lib@1 with the six exports and carries mods.tree, which links through the interface with every fixture of mods.lib@1 PASS. 1,000 seeded trees (25 a piece, 10 pieces a process), each edited by 50 seeded edits, one a step: every node's total for every stat, read after each step, equals model.ts's recompute from the whole tree; each step reads N × 4 totals and `last_id` is the rule's. Release: 100,000 cases, then the 100 large trees. mods_stale@1 fails: its first wrong read follows an attach or a detach, at a descendant of the node that moved, equal to that node's total before the edit; the failure names the edit, the node and the stat. Fails: a stale total after any edit, totals off the rule, ids not in add order |
| 2 `#953.cfdaeec8` | `ac02-filters.test.ts` (2) | The item's row (attack +2, kind = archer) on holder A: A's archers (2, 3 and 5, one under another) read 12, every other node its base; after the item moves to B, A's archers read 10 and B's archer 12. mods_on_source@1 fails at archer stack 2 (12 expected, 10 read), naming it. Fails: a filter on the source, a filter ignored, a holder's archers keeping the +2 after the move |
| 3 `#953.a587d88d` | `ac03-stacking.test.ts` (2) | The archer (base 10) with add 5, percent 20 and cap 16 reads 16, without the cap 18 (the rule gives both). mods_pct_first@1 reads 17 without the cap, failing naming the stat attack. Fails: percent before add, a cap applied before the percent, rounding before the cap |
| 4 `#953.e5d20c0f` | `ac04-reach-order.test.ts` (3) | An aura with reach side from archer 2 raises nodes 1 to 6 (everything under side red) by 3 and none of side blue's; a 3-round add of 5 reads 15 after rounds 1 and 2 and before round 3's boundary (turn boundaries between), 10 after it. 25 seeded trees, each built with its rows as generated, reversed and shuffled: every total equal to the recompute in all three. mods_round_each@1 differs on at least one of the 25, failing naming the tree (its seed) and the node. Fails: side reaching the other side or missing a node, a duration counting turns or ending a boundary late or early, order-dependent totals, rounding per row |
| 5 `#953.7fa9a285` | `ac05-planted-budget.test.ts` (2) | Each planted library of mods.lib@1, carried as planted_mods@1 claiming it, on the item of its first fixture: `link_refused`, naming mods.lib@1 and a fixture of it. A copy of the interface's entry with `planted: []` (modscopy@1.0.0) is `pack_refused` naming the interface; with its planted libraries (modscopy@1.0.1) it installs. A 500-node tree with 2,000 rows in a `figure` piece: 60 steps of one edit and 2,000 reads (every node, four stats), each the recompute's; logic.budget on [app] PASS with no failure; the item held to an app ceiling equal to ⌊4,000,000 × 0.75 ÷ the merge base's ns per fuel⌋, `about`'s ns per fuel equal to the merge base's, every step's fuel within it; then INCONCLUSIVE off macOS arm64. Fails: a planted library that passes, a pack with none installed, reads that pass the ceiling, no ceiling, a ceiling moved by the change |

Test count: 2 + 2 + 2 + 3 + 2 = 11, and the Oracle lane's 1.

## Planted twins

This suite writes its own wrong libraries rather than naming `deep-logic --planted` twins: one WebAssembly text
(programs.ts: `library`) with one flag each, which a pack of this suite's (`modstwins@1.0.0`) carries implementing
nothing, linked by its own name, each with a trivial own fixture (a lone archer's attack, 10), as #416 carried
planted_fsm@1. That is the smaller choice: four flags on one text this suite needs anyway, which run before an
implementation exists (README: Checked before the base run), against four planted names and four libraries the
implementation would otherwise ship only for these tests. The text with no flag is a mods.lib@1 library by this
README's rule (every change marks every cached total).

| Name | Criterion | The wrong library |
|---|---|---|
| `mods_stale@1` | 1 | an attach or a detach of node n leaves n's descendants' cached totals as they were |
| `mods_on_source@1` | 2 | tests a row's filters on its source's catalog row, not the receiving node's |
| `mods_pct_first@1` | 3 | base × (1 + Σ percent ÷ 100) + Σ add |
| `mods_round_each@1` | 4 | rounds each percent row's share of (base + Σ add) toward zero on its own, then sums |
| mods.lib@1's own planted libraries | 5 | whatever the implementation ships; read from the pack |

## Readings where the issue leaves a choice

- **`modslib@1`**: the pack named `modslib`, version 1.x. **The reference library `mods.tree`**: the pack's library
  `mods.tree@<version>` implementing mods.lib@1.
- **Signatures**: every export takes the tree's address first, as #416's interfaces take theirs (a library keeps no
  state of its own); `attach` also takes the node's catalog row, since a filter reads the receiving node's row and the
  issue's exports give no other way to name it. `add`'s row is in memory at a pointer (104 bytes), as a row with four
  filters doesn't fit in parameters. `total` returns i64 (the issue's); a program writes it as an f64 (logic@1 has no
  i64 write).
- **A node's base**: its catalog row's value of the stat's base column, named in the tree's header. The issue names a
  base and says the library reads only its tree and the catalog by hash, so the base is the catalog's.
- **"Down (the source's descendants)"**: the source itself not. **A node's side**: the node at the top of its tree (a
  node attached with parent −1); **"every node under the source's side"**: the side's descendants, the side itself not.
  **`all`**: every node in the tree, sides included.
- **"An item on a holder … after the item moves to another holder"**: reach down from the item would reach only the
  item's own descendants, which carry no stack, so the item's row names its holder as source; the item moving is the
  item node moving to the other holder and its row removed and added with that holder as source. The read after it is
  the one the criterion holds.
- **The tie rule's "modifier row"**: the row's id, which counts adds; so a total may depend on add order only between
  sets of one source on one stat. **"The same rows listed in another order"**: rows with no two sets of one source and
  stat, added in other orders.
- **"Rounding toward zero happens once, at the end"**: the exact integer rule above, x ÷ 100 by `div_s`.
- **Durations**: a row counts boundaries of its own unit from its add; turn and round boundaries are counted apart, a
  round's never a turn's. **"Removed in a fixed order"**: id order. "Present at the read before the 3rd round's
  boundary and gone at the read after it": reads after each round's and turn boundaries.
- **Calls that make no sense** (a cycle, an unknown id, a node out of range) change nothing; no test calls one.
- **"Until #194 lands"**: #194 has landed; the catalog is a `table.layout@1` asset the item names by SHA-256.
- **"technical-design.md:885"**: at this base, "Universal rules are tested as properties" (line 943): 1,000 cases a
  change, 100,000 at release, from recorded seeds. The release switch is `DEEP_PREFLIGHT=release`, scripts/preflight.mjs's.
- **"The casual class"**: no budget class is called casual (`core_view`, `data_view`, `figure`, `work_product`,
  `showpiece`, `export`); it is read as `figure`, the class `deep-logic` holds a piece that names none to, and a game
  piece's. Its step ceiling is #546's, in fuel (⌊4 ms × 0.75 ÷ ns per fuel⌋ at 60 Hz: 12,000,000 at the base's 0.25 ns
  per fuel, above the fuel budget's 10,000,000 cap), so a step under it is under it on any machine; the test gates on
  macOS arm64 ("on a reference Mac") only after the fuel has been judged. **"Against its merge base"**: the ceiling is
  the one the merge base's metering record gives (`git merge-base HEAD origin/main`, then its
  `crates/deep-logic/metering.json`), so the change can't move it. **"2,000 total reads a step over a 500-node tree"**:
  every one of the 500 nodes' four stats, after a seeded edit, each of 60 steps; the tree carries 2,000 rows, the size
  criterion 1 gives a 500-node tree. The steps that build it (attaches, then adds 250 a step, then the first reads 100
  nodes a step) are held to the ceiling too, as logic.budget holds every step.
- **"Measured in the scheduled budget window … until that window closes the issue"**: the window runs only
  `benchmarks/budgets.json`'s tasks (docs/parallel-proof.md 12a); a test can't see it. This test is the fuel judgement
  at the commit it runs on; the window's record is the window's.

## Not covered, because no criterion reaches it

deep_kinds' listing of mods.lib@1, its exports and the pack (Scope, no criterion); the strategy and tactics kits; the
interface fixtures' contents (they are the implementation's, checked by criterion 5's planted run); a node's row
changing on a move; calls that make no sense; shrinking a failing generated case; the budget window's record and a
`benchmarks/budgets.json` task; the web player's ceiling; saves and layouts of the tree.

## Checked before the base run

Two temporary test files (deleted) held this suite's own pieces to real components, in the same vitest run as
`BASE-FAILURE.txt`:

- **Node's WebAssembly**, the driver and the library text (with no flag, and with each twin's) assembled as whole
  modules by #416's assembler, the script and the catalog copied to `assets_at` as the logic module copies them: on
  every scene (the archers, both stacks, the side aura, the 3 rounds) and on 200 of criterion 1's seeded cases (50
  edits each) and the 25 order trees in two orders, the library reads exactly model.ts's totals, ids and read counts,
  and so does it on criterion 5's 500-node tree. mods_on_source@1 reads archer 2's attack as 10 (12 expected);
  mods_pct_first@1 gives 17 without the cap and 16 with it; mods_stale@1 first reads a stale total on case 0 at edit 1
  (an attach), node 20's attack 42, the total before the edit, where the recompute gives 61; mods_round_each@1 differs
  on order case 0. model.ts gives the issue's 16 and 18, the archers' 12s, the aura's +3 and the rounds' 15, 15, 15, 15,
  10, and the Oracle lane's upstream values (its own check passed at the base before it reached `first_party`).
- **The base's `deep-logic`**, the same library as a relocatable object linked by its own name (#190) from a pack of
  this suite's: the scenes bake exactly the rule's values; each twin's pack (`modstwins@1.0.0`) installs, its own
  fixture PASS; 100 of criterion 1's cases (four pieces of 25 in one process, through `bakeAndJudge`) read every total
  right in 95 s; mods_stale@1 fails as above, in 54 s. On criterion 5's 500-node tree this suite's library traps `fuel`
  at step 9 (its first 400 fresh totals, each scanning all 2,000 rows): it marks every total on any change and indexes
  nothing, which the reference library mustn't do to pass that criterion.

Not checked: anything of the implementation (none exists); the catalog's bytes against `deep-catalog pack`'s output
or table.layout@1's validator (they are written from the packer's source and the layout's doc, and this suite's
library reads them right); criterion 5's 500-node bake on a library that fits it, and so its time; the release run.
