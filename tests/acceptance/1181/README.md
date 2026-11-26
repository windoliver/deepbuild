# Acceptance tests for #1181: circuit@1, sources, loads, plugs, fuses, earth and meters (criteria 1 to 10)

Written first, blind, from issue #1181 (its body as given to this job: the opening paragraph, Epic and Design lines,
Runs on, Scope, Fields, ten acceptance criteria, Proof, Not in scope and Depends on; no comments, no Oracle line, so
nothing is ported), the design sections it names and the base commit `ae1566b5a` ("Merge pull request #3047 …"), by a
job that never saw an implementation; none existed, and no other branch, worktree, pull request, plan, session or
GitHub page was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind
redraft of this job (design: Dogfooding).

## What was read

- The issue, whole. Its own spellings are kept: the exports `node`, `source_dc`, `source_ac`, `resistor`, `load`,
  `switch`, `connector`, `fuse`, `meter`, `wire`, `fault` and `solve`; the layout `circuit.state@1` and what it holds;
  the part shapes in Fields; the rules `circuit.kcl {tolerance = 1e-9 A}`, `circuit.power {tolerance = 1e-6 relative}`
  and `circuit.fuse`; the carrier densities; every number in the criteria.
- `docs/canvas-primitives.md`: Units and axes; Honest numbers (both); Logic: linked libraries; Logic: library
  interfaces (its `circuit@1` sentences, how `process@1`, `lanes@1` and `separation@1` and their kind rules are stated,
  and the As built (#1255) paragraph); Pack: kind rules and the kind kit; Text animator and counter; Bound value.
- `docs/technical-design.md`: Library interfaces; How we know version 0 works (Criteria to tests, Criteria in a checked
  shape, Wrong programs, Dogfooding, "A CPU reference counts as an oracle only once…", Built to be hard to get wrong).
  AGENTS.md.
- At the base, for call shapes only: `tests/acceptance/1255/` (README, helpers, programs, ac1, ac5, ac7, lane.json,
  twins.json, BASE-FAILURE.txt: the closest model, followed throughout), `980/` (README, helpers, ac06 to ac08,
  warehouse.ts), `190/helpers.ts`, `416/interfaces/` (`wat.ts`, `helpers.ts`' asset reader, `programs.ts`' layout
  probe), `535/helpers.ts` (deep-show's scenario); `crates/deep-logic/src/` (`lib.rs`' calls, `first_party.rs`,
  `judge.rs`, `fixtures.rs`' and `interfaces.rs`' fixture pieces, `piece.rs`' read slots, `piece/checks.rs`' item
  fields, `live.rs`' frames, `bake.rs`' arrays), `crates/deep-canvas/src/time.rs` (step rates),
  `crates/deep-canvas-marks/src/scene.rs` (a format's unit and precision); `packs/separation-1.0.0/` (pack.json,
  LAYOUT.md); `scripts/{proof-change,proof-runs,lanes,benchmark}.mjs`.

## What the base already does, and these tests don't credit

At the base `first_party` lists six packs (interfaces, lanes, modslib, process, separation, sense); none declares
`circuit@1`. A logic item's `circuit` is refused (`logic_refused`, "logic@1 has no field circuit": piece/checks.rs
lists the fields it knows), at `check` and at `judge` alike; `judge` judges only items with `lanes`, `process` or
`separation`. Everything else these
tests drive is on the base: links by name and by interface (#190, #416), bakes with step hashes and checkpoints,
`playback`'s arrays at chosen steps, `web_plan` and the web runner, `view` and `frame`, the layout probe, deep-show's
`eval` and honest numbers (#406), and `pack_check`'s refusal of an interface with no planted library. No test passes
because of any of it: each one first needs the first-party pack that declares `circuit@1`, and fails there
(BASE-FAILURE.txt).

## Run them

```sh
npm ci --no-audit --no-fund                          # once, in a fresh worktree
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node scripts/throttle.mjs test --wait 300 -- sh scripts/lease nice -n 10 \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/1181 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1181/tsconfig.json
rm -rf tests/acceptance/1181/node_modules            # vitest's cache
```

What a run builds, honoring `CARGO_TARGET_DIR`: `deep-logic` (#190's helpers, imported unchanged), #416's assembler
arrangement (`../416/interfaces/wat.ts`, into `target/acceptance-416-wat`), and for criterion 8 `deep-show`, the full
set (`../535/helpers.ts`, imported unchanged), built inside that file's first test after circuit@1 is found, so a base
run doesn't build it. Criterion 7 starts headless Chrome (`CHROME_BIN` or the usual paths). Every test has #190's
90-minute timeout.

The one long run is `ac03-drift.test.ts`'s second test: 3,600 s at 1 ms are 3,600,000 circuit steps, solved 125 to a
logic step (README: Pieces), 28,801 logic steps in one `playback`; nothing else runs past 18,000 steps.

Gates: a missing host (Chrome) is `BLOCKED:`, never a pass (#190's). Criterion 9's timing is judged by
`scripts/benchmark.mjs`'s judgeLimit with the one-minute load at each run's start and end: off a reference Mac, under
load, or with readings neither all in nor all out of the limit it fails `INCONCLUSIVE:` with its readings, never a
pass; that file's other test, that the grid really solves, runs on any machine. Nothing else depends on the machine.

**Lanes.** `lane.json` says the folder runs alone (its files build cargo binaries, one builds deep-show, one starts
Chrome, one runs 3.6 million steps). `ac09-budget.test.ts` calls judgeLimit, so it belongs in `scripts/lanes.mjs`'s
`timed` list, which a lane file can't set: the implementer adds `timed.push('tests/acceptance/1181/ac09-budget.test.ts')`
(README: What the implementer adds). `twins.json` maps criteria 2, 4, 5 and 10 to the planted libraries' names, as
#1255's does; every test fails on the merge base at its own assertion, so no twin folder is needed or read.

## The surface

The issue names an interface, its exports, its layout and its parts' shapes as data, but no command line, WebAssembly
signature, memory or encoding. As in #1255's and #980's suites the surface is `deep-logic` (#531's, #532's, #190's and
#416's JSON-lines protocol and #981's `judge`, unchanged where not named here), and for criterion 8 `deep-show run`
(#393's, as #980's suite drives it). **Every signature, array, code, document key, call field, reply field, refusal
field, kit field and planted name below that is marked *(mine)* is this job's invention**: the least the criteria need,
in the issue's and the design's spellings where they have them. The implementer builds exactly these, or a dispute
goes to a blind redraft.

### The first-party pack

`{"call": "first_party"}` lists a first-party pack (any name) whose `interfaces` hold **`circuit@1`**, #416's
Interface, with:

- `exports`: exactly the twelve below with their signatures *(mine)*, such as
  `{"name": "solve", "params": ["i32", "i32", "i64", "i64"], "results": ["i32"]}`;
- `layout: "circuit.state@1"`; at least one fixture; `planted`; `digest` (#416's);
- **`"rules": {"circuit.kcl": {"tolerance": 1e-9}, "circuit.power": {"tolerance": 1e-6}, "circuit.fuse": {}}`**: the
  issue's kind rules with their params' defaults, as #1255's entry carries its own;
- **`"twins": [{"planted": <asset ID>, "example": <asset ID>, "expect": <rule code>}]`**: its kind kit, exactly one
  twin for each rule (#1255's field; README: The kind kit).

The same pack's `libs` holds exactly one library whose `implements` names `circuit@1`: **the reference library** (any
name@version), with fixtures of its own (#190's rule); its object is among `first_party`'s assets. A piece links it by
that name and hash and imports the exports as `lib:circuit@1.<export>`. The carrier densities and the fuse curves'
constants are the pack's, each with its source (the issue's Fields; where and how is the implementer's: no test reads
them, they read the values they give).

### Pieces

```text
LogicParams gain "circuit": {"nodes": [name], "parts": [Part]}                               (mine: the key, nodes, parts)
Part = {"id": string, "kind": <a kind below>, …the kind's fields}                                     (mine: id, kind)
```

Node `j` is `nodes[j]` and part `i` is `parts[i]` everywhere: in the arrays, in the builders and in the judge's fails.
**Node 0 is the reference, at 0 V.** The kinds and their fields, as JSON, are the issue's; *(mine)* where it gives
none:

| Kind | Fields |
|---|---|
| `source_dc` | `from`, `to`, `v` (V), `r_internal` (Ω) = 0 |
| `source_ac` | `from`, `to`, `v_rms` (V), `f` (Hz), `phase` (deg) = 0, `r_internal` (Ω) = 0 |
| `resistor` | `from`, `to`, `r` (Ω) ≥ 0 *(mine)*; `r` 0 is a plain conductor, as a closed switch is |
| `load` | `from`, `to`, `p_rated` (W), `v_rated` (V): a resistance of `v_rated² ÷ p_rated` |
| `switch` | `from`, `to`, `closed_by` (an input) *(mine: the same fields as a connector's)* |
| `connector` | `from`, `to`, `closed_by` (an input) |
| `fuse` | `from`, `to`, `rating` (A), `curve`: `fast` \| `slow` = `fast` |
| `meter` | `on` (a part ID) |
| `wire` | `part` (a part ID), `length` (m), `area` (mm²), `material`: `copper` \| `aluminium` = `copper` |
| `fault` | `from`, `to`, `r` (Ω), `on_by` (an input) |

- `from` and `to` are node names. A source holds `to` above `from` by its voltage: `v`, or `v_rms × √2 × sin(2π f t +
  phase)` at the step's time t. A part's current runs from `from` to `to` through it; a source's is positive while it
  gives power. A switch, a connector and a fuse have no resistance while closed.
- **An input** is a control the item reads (its `reads`; the piece's `controls`, sliders here). It **says so** while
  its latest entry's value is nonzero: a connector or switch is closed, a fault on. Before its first entry it reads 0
  *(mine)*. The library reads it from the item's read region (README: Exports: `solve`).
- **Refusal at check**: a part of a kind circuit@1 can't model, such as `diode`, is `{"ok": false, "code":
  "logic_refused", "item": <logic ID>, "refusals": [Refusal]}` with a refusal **`{"rule", "what", "part": <its ID>}`**
  *(mine: `part`; `rule` and `what` are the implementer's)*. No other refusal is asserted.
- An item with `circuit` exports `assets_at`: the table the check builds from `circuit` (and the item's step rate and
  read slots, as the library needs them) is the item's **asset 0**, copied there after its u32 length before the start
  function, as #1255's is. Its bytes are the check's and the library's to agree on; the tests read them nowhere.
- **More than one solve a step** *(mine)*: a program may solve several of the circuit's steps in one logic step, in
  order (`solve`'s `k`), each of length `1 ÷ per`. Criterion 3's hour does (125 a step): 3.6 million steps don't fit a
  bake's record one a logic step. The judge reads only pieces that solve once a step with `per` the item's step rate.

### Exports of circuit@1 *(signatures mine)*

`s` is the address of the state in the caller's memory, `g` that of the built table (asset 0's bytes: `assets_at + 4`).

| Export | Signature | Does |
|---|---|---|
| `node` | (s i32, g i32, i i32) → i32 | adds node i of the table to the circuit; returns i, or −1 for an index out of range or added before |
| `source_dc`, `source_ac`, `resistor`, `load`, `switch`, `connector`, `fuse`, `meter`, `wire`, `fault` | (s i32, g i32, i i32) → i32 | adds part i of the table, which must be of the export's kind; returns i, or −1 when part i is of another kind, out of range or added before. A part not added is out of the circuit |
| `solve` | (s i32, r i32, k i64, per i64) → i32 | solves the circuit's step k, at t = k ÷ per s, each step 1 ÷ per s long, reading the inputs from the read region at r (the item's `reads_at`); writes the state's arrays; returns 1, or 0 for a circuit with no single solution. A program solves k = 0, 1, 2 … in order with one `per` |

`init` adds nodes 0 … N − 1, then each part in order; a library may rely on that order. The state at `s` starts
zeroed (the program's memory).

### Memory, and the state and its arrays

The library keeps its state in the caller's memory from `s`, at most 1 MiB. **The state's head is `circuit.state@1`'s
arrays** *(mine: every name, type, count, order and unit; the issue gives what they hold and that each has a unit)*,
for the table's N nodes and P parts, each array 8-aligned in this order, which is the region map's own layout for
writes declared in this order. An item declares them first; a program publishes them with one copy of the head over
its write region after its calls. A bound value reads each by the item's path, `<logic ID>.<name>[<index>]`.

| Array | Type × count | Unit | Holds, at the step solved |
|---|---|---|---|
| `v` | f64 × N | V | each node's instantaneous volts above node 0 |
| `i_rms` | f64 × P | A | each part's rms current, ≥ 0; 0 for a meter, a wire, an open part |
| `i` | f64 × P | A | its instantaneous current, from `from` to `to`: for AC, the rms × √2 × the sine at the step's time, in closed form |
| `p` | f64 × P | W | its mean power: a source's given to the circuit at its terminals, any other part's taken |
| `r` | f64 × P | Ω | its resistance as the library models it: a load's `v_rated² ÷ p_rated`, a resistor's or a fault's `r`, a source's `r_internal`; 0 for the rest |
| `on` | i32 × P | | 1 while the part conducts: its input closed or on, a fuse not open, always for sources, resistors and loads; 0 while open, and for meters and wires. A fuse's state is its `on` |
| `energy` | f64 × P | J | a meter's energy: the sum, over steps 0 … k, **this step's included**, of its part's `p` × 1 ÷ per; 0 for other parts |
| `kwh` | f64 × P | kWh | the same ÷ 3,600,000 |
| `drift` | f64 × P | m/s | a wire's electrons' rms drift speed, its part's `i_rms` ÷ (n × area × e), area in m², n the material's carrier density, e = 1.602176634 × 10⁻¹⁹ C; 0 for other parts |
| `drift_x` | f64 × P | m | their displacement from rest: ∫ from the run's start of its part's `i` ÷ (n A e) dt, in closed form (no sum of steps); either sign, the same at every step; 0 for other parts |

For the lamp with its meter and flex (3 nodes, 5 parts) the arrays start at 0, 24, 64, 104, 144, 184, 208, 248, 288 and
328, 368 bytes in all; for the grid's 64 nodes and 128 parts, 9,216 bytes (`programs.ts`: `offsets`; the tests hold
`check`'s region map to them).

This suite's programs (`programs.ts`: `circuitProgram`) read at 0, write at 4,096, keep 8 bytes of data at 49,152 (the
libraries' data follow it), export `assets_at` 262,144 and put `s` at 1 MiB, in a memory of 32 pages (2 MiB). Every
item gives `budget.fuel` 10,000,000, the cap.

### The fuse curve *(mine)*

The issue gives a fuse a rating and a melt curve, `fast` or `slow`, and no numbers. The criterion needs one number,
the curve's time at 230 A on a 3 A fast fuse, so this suite states the curve as the heat balance of the fuse element,
from first principles: an element heated by i² and cooling in proportion to its temperature rise, with time constant
τ, melts at the rise its rating holds at steady state, so at a steady rms current I past the rating Iₙ it opens after

    t(I) = τ · ln(I² ÷ (I² − Iₙ²))      (never at or under the rating)

with **τ = 1 s for `fast` and 10 s for `slow`**. Why these: they put the curves inside the quick-acting and time-lag
bands of the IEC 60127-2 miniature-fuse sheets (fast at 2.1, 2.75, 4 and 10 × Iₙ: 257 ms, 142 ms, 64.5 ms and 10.05
ms; slow: 2.57 s, 1.42 s, 645 ms and 100.5 ms), and the issue asks only that a fuse open on its curve. A fuse reads its
**rms** current, so a sine's zeros don't reset it. With the current past its rating from step a and steady, it opens
at the first step k with (k − a) ÷ per ≥ t(I), and it stays open (no criterion resets it). The issue's "a named input
resets it" is the implementer's (`reset_by`, say); nothing here asserts it.

### The judge

```text
{"call": "judge", "piece", "track"?: [Entry] = [], "steps": n}
 → {"ok": true, "items": {<logic ID>: {"rules": {"circuit.kcl": Rule, "circuit.power": Rule, "circuit.fuse": Rule}}}}
Rule = {"verdict": "PASS" | "FAIL", "steps": <steps it read> (mine), "fails": [Fail] (the first 16, earliest first) (mine)}
```

#981's call, for every logic item with `circuit`. The run is steps 0 to n − 1, as a bake runs them; each rule reads
the item's arrays at every step, with the item's `circuit` (its topology, ratings and curves), never the library's
own verdict, so it holds any library, a planted one included. Each rule's params are the pack's defaults (a call's
`rules` may set them, as #1255's).

- **`circuit.kcl {tolerance}`**: at every step, for each node, the sum over the parts with `from` and `to` of `i`, +
  for a part whose `to` it is and − for one whose `from` it is. Past the tolerance is a fail **`{"step", "node": <its
  name>, "sum": A}`** *(mine: the fields)*.
- **`circuit.power {tolerance}`**: at every step, the sources' `p` summed against every other part's: a gap past the
  tolerance × the larger sum is a fail **`{"step", "gap": W}`**; and for each meter, its `energy` against the judge's
  own sum of its part's `p` × the item's step length over steps 0 … k: past the tolerance × the larger is a fail
  **`{"step", "meter": <its part ID>, "gap": J}`** *(mine: the fields)*. Both sums 0 is no gap.
- **`circuit.fuse`**: for each fuse, the step its curve gives from the library's `i_rms` and the pack's curve (README:
  The fuse curve), against the step its `on` turns 0: more than one step apart, or opened with no cause, is a fail
  **`{"fuse": <its part ID>, "step": <the step it opened, or null>, "expected": <the step its curve gives, or
  null>}`**; an open fuse whose `i_rms` or `i` is past 1e-9 A is a fail **`{"fuse", "step", "current": A}`** *(mine:
  the fields)*.

### The kind kit

"Kind rules (#202), in the interface's pack" and criterion 10's "the kind kit": as #1255 carries separation@1's. The
rules can't be #202's 64-op expressions (they sum over nodes and steps), so they are named with their defaults on the
interface's entry and read by `judge`; the kit is #202's, moved to an interface, run at pack check.

- A twin is `{"planted", "example", "expect"}`: one of the interface's `planted` libraries, a fixture the pack carries
  (#416's fixture shape, with its controls and track), and the rule's code. On its example the planted library raises
  `expect` and no other rule, and the reference library raises none.
- **`pack_check`** of a pack whose interface carries `twins` runs each one; its reply's entry for the interface gains
  **`"kit": [{"planted", "example", "expect", "raised": [<rule code>]}]`**, and a twin whose `raised` lacks its
  `expect` refuses the pack: `{"ok": false, "code": "pack_refused", "pack", "refusals": [{"rule", "what", "interface",
  "planted", "expect", "raised"}]}` (#1255's fields). An interface with no planted library is refused, naming it (#416).

### Planted twins *(names mine)*

Three libraries the interface's pack ships in `planted` and names in `twins`, each the reference library with one
change; #416's rule also holds each to failing one of the interface's own fixtures. This suite links each by its own
name from a pack `plants` of its own (origin installed), with a fixture of its own that any circuit@1 library passes
(#190's rule): a lamp straight on the mains (`OWN_CIRCUIT`), importing the library by its own name, `on` `[1, 1]` at
step 0. No `--planted` flag of deep-logic's is added; the suite builds no wrong library of its own.

| Name here | The twin for | The wrong program |
|---|---|---|
| `kept_current@1` | `circuit.kcl` (criteria 2, 10) | at a step where a connector is open, every part but the open connectors keeps the `i_rms`, `i` and `p` the step before left (the lamp stays lit); each open connector writes 0 |
| `rated_meter@1` | `circuit.power` (criteria 4, 10) | a meter on a load adds the load's `p_rated` × 1 ÷ per at every step instead of its `p`, so it counts while the load's switch is open |
| `late_fuse@1` | `circuit.fuse` (criteria 5, 10) | a fuse opens at 10 times its curve's time |

### One example of each, as the tests write and read them

```text
item     {"kind": "logic@1", "params": {"program": <sha>, "step_rate": 1000, "reads": ["plug_in"],
          "writes": {"v": {"type": "f64", "count": 3}, "i_rms": {"type": "f64", "count": 5}, …},
          "circuit": {"nodes": ["neutral", "live", "pin"], "parts": [
             {"id": "mains", "kind": "source_ac", "from": "neutral", "to": "live", "v_rms": 230, "f": 50},
             {"id": "plug", "kind": "connector", "from": "live", "to": "pin", "closed_by": "plug_in"},
             {"id": "lamp", "kind": "load", "from": "pin", "to": "neutral", "p_rated": 4.6, "v_rated": 230},
             {"id": "meter", "kind": "meter", "on": "lamp"},
             {"id": "flex", "kind": "wire", "part": "lamp", "length": 2, "area": 0.75, "material": "copper"}]},
          "budget": {"fuel": 10000000}, "links": [{"name": <the reference library's>, "asset": <sha>}]}}
piece    {"seed": 1181, "controls": {"plug_in": {"kind": "slider"}}, "packs": [], "items": {"cycle": item}, "assets": …}
track    [{"t": 0, "seq": 1, "control": "plug_in", "value": 1, "writer": "you", "player": 1}]
program  init: node(s, g, 0..2); source_ac(s, g, 0); connector(s, g, 1); load(s, g, 2); meter(s, g, 3); wire(s, g, 4)
         step(k): solve(s, 0, k, 1000); memory.copy(writes_at, s, 368)
refusal  {"ok": false, "code": "logic_refused", "item": "rectified", "refusals": [{"rule": …, "what": …, "part": "rectifier"}]}
playback {"call": "playback", "piece", "track", "steps": 21, "at": [5]} → arrays at step 5: "cycle.i": [0.028284…, 0.028284…, 0.028284…, 0, 0], …
judge    {"call": "judge", "piece", "track", "steps": 3000}
       → {"ok": true, "items": {"replugged": {"rules": {"circuit.kcl": {"verdict": "FAIL", "steps": 3000,
           "fails": [{"step": 2003, "node": "pin", "sum": -0.016625…}, …]}, "circuit.power": {"verdict": "PASS", …}, …}}}}
power    {"verdict": "FAIL", "steps": 18000, "fails": [{"step": 0, "meter": "meter", "gap": 20}, …]}
fuse     {"verdict": "FAIL", "steps": 3000, "fails": [{"fuse": "fuse", "step": 1171, "expected": 1018}]}
kit      {"call": "pack_check", "assets": …, "pack": {"name": "circuitcopy", "version": "1.0.0", "origin": "installed",
           "libs": {}, "interfaces": {"circuit@1": <the first-party entry>}}}
       → {"ok": true, "pack": "circuitcopy@1.0.0", "installed": true, "interfaces": [{"label": "circuit@1", …,
           "kit": [{"planted": <sha>, "example": <sha>, "expect": "circuit.kcl", "raised": ["circuit.kcl"]}, …]}]}
plants   {"name": "plants", "version": "1.0.0", "origin": "installed",
          "libs": {"kept_current@1": {"asset": <sha>, "exports": [the twelve], "fixtures": [<sha>]}}}
readout  {"id": "current", "kind": "text@1", "params": {"text": {"counter": {"source": "i_lamp", "tabular": true,
          "format": {"unit": "A", "precision": 2, "group": "none"}}}, …}}, with the driver
          {"target": "data/i_lamp", "expr": "x", "vars": {"x": "mains.i_rms[1]"}}
```

The tests find the interface in `pack_check`'s reply by its `label`, and take a refusal's `interface` as `circuit@1` or
`circuitcopy.circuit@1`.

## Fixtures

`circuits.ts` holds them with the values worked by hand; `model.ts` computes each from the issue's constants and the
tests hold it to the hand-worked numbers first. Every source is 230 V rms, 50 Hz, phase 0, no internal resistance.

- **The lamp** (criteria 1, 2, 3, 6, 7): `mains` neutral → live, `plug` (a connector on `plug_in`) live → pin, `lamp`
  (4.6 W at 230 V) pin → neutral: criterion 1's circuit as it says it (`PLAIN_CIRCUIT`); with `meter` on the lamp for
  criteria 2 and 7 (`LAMP_CIRCUIT`); with `flex` (2 m of 0.75 mm² copper) on the lamp too for criterion 3
  (`FLEX_CIRCUIT`).
  R = 230² ÷ 4.6 = 52,900 ÷ 4.6 = **11,500 Ω**; I = 230 ÷ 11,500 = **0.02 A**; P = 0.02 × 230 = **4.6 W**. At t = 5 ms
  the sine is sin(2π × 50 × 0.005) = sin(π/2) = 1, so i = 0.02 × √2 = **0.0282843 A**; steps 4 and 6 are sin(0.4π) and
  sin(0.6π) of it.
  - *plugged* (criterion 1): `plug_in` 1 at step 0, 1,000 steps a second, steps 0 to 10,000 (10 s).
  - *replugged* (criterion 2): `plug_in` 0 at step 0, 1 at step **1,005** (t = 1.005 s, a crest: i = 0.0282843 A),
    0 at step **2,003**, 3,000 steps. Closed for 998 steps the meter reads 998 × 4.6 W × 1 ms = **4.5908 J** at step
    2,002, and the same from 2,003. Under `kept_current` step 2,003 keeps step 2,002's 0.02√2 × sin(0.2π) =
    0.016625 A in the lamp and the source while the plug carries 0, so the plug's two nodes are off by that much.
  - *cycle* and *hourly* (criterion 3): v = 0.02 ÷ (8.5 × 10²⁸ × 0.75 × 10⁻⁶ × 1.602176634 × 10⁻¹⁹) = 0.02 ÷ 10,213.876
    = **1.958120 × 10⁻⁶ m/s** (the issue's 1.9581 × 10⁻⁶ is it to 1.1 × 10⁻⁵). The displacement from rest is ∫₀ᵗ √2 v
    sin(2π·50·t) dt = A (1 − cos 2π·50·t), A = √2 v ÷ (2π × 50) = **8.814639 × 10⁻⁹ m** (the issue's 8.8146 × 10⁻⁹ to
    4.4 × 10⁻⁶): 0 at step 0, A at 5, 2A at 10, 0 at 20; it swings with amplitude A. Summed step by step at 1 ms it
    would swing 8.742 × 10⁻⁹ m, 0.8% short. *hourly*: 8 logic steps a second, 125 circuit steps of 1 ms each, so logic
    step k is at t = 0.125k s, A (1 − cos(πk/2)): A, 2A, A, 0 at k = 1 to 4; at k = 28,800, t = 3,600 s, 3,600,000
    circuit steps and 180,000 whole cycles: **0**. The meter there reads 3,600,001 × 4.6 mJ = 16,560.0046 J.
- **The kettle** (criterion 4): `mains`, `switch` (on `kettle_on`) live → element, `kettle` (2,400 W at 230 V)
  element → neutral, `meter` on the kettle; 120 steps a second (at 100 the 50 Hz wave would be sampled at its zeros
  only). On at step 600 (5 s), off at step 16,800 (140 s): 16,200 steps = **135 s**. 230² ÷ (230² ÷ 2,400) = 2,400 W;
  2,400 W × 1/120 s = **20 J** a step; 16,200 × 20 = **324,000 J** = 324,000 ÷ 3,600,000 = **0.09 kWh**, from step
  16,799 on. Under `rated_meter` step 0 (switch open, 0 W) reads 20 J: a gap of 20 J.
- **The fault** (criterion 5): `mains` neutral → live, `fuse` (3 A, fast) live → fused, `lamp` fused → neutral,
  `fault` (1 Ω, on `fault`) fused → case, `earth` (a resistor of 0 Ω: the earth wire, earth and neutral bonded at the
  supply) case → neutral; 100,000 steps a second (10 µs); the fault on at step 1,000 (10 ms); 3,000 steps. Before it,
  the earth wire carries 0 A and the fuse the lamp's 0.02 A. From it, the fault takes 230 ÷ 1 = **230 A** and the fuse
  **230.02 A**. The fast curve gives 1 s × ln(230.02² ÷ (230.02² − 9)) = **170.117 µs** (170.147 µs at 230 A): 17.01
  steps, so it opens at step **1,018** (the same at 230 A); within one step is 1,017 to 1,019. Ten times the curve's
  time, 1,701.17 µs, is step **1,171**. A 1 ms step couldn't tell them apart: both would fall within the fault's first
  two steps.
- **The diode** (criterion 6): the lamp's circuit with `rectifier`, a `diode` from pin to neutral.
- **The readout** (criterion 8): `mains`, `lamp` (4.6 W) and `heater` (2,300 W, 10 A) live → neutral, 60 steps a
  second: the lamp takes **0.02 A**, the source 10.02 A, so a readout of the wrong part shows another number. Shown
  with unit A to two places: **"0.02 A"**.
- **The grid** (criterion 9): 64 nodes n0 … n63 and 128 parts: `mains` n0 → n1, a 100 A fast fuse n1 → n2, 61
  resistors of 0.5 Ω n2 → n3 … n62 → n63, 62 loads of 100 W at 230 V from each of n2 … n63 to n0, a 1 Ω fault n32 → n0
  (off: no entry), a meter on the source and a wire on the fuse. Its currents come from `model.ts`' nodal solve (13.731
  A from the source, 0.12837 A in the farthest load); the solve was held to kcl (1.9 × 10⁻¹² A) and the power balance
  (7.9 × 10⁻¹⁴ relative) by a scratch check.
- **The plants' own fixture**: `mains` and `lamp` neutral ↔ live, no inputs, one step.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white
space collapsed, checked against the issue's text. Each `describe` and test name starts with its criterion's ID.

| ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| 1 `#1181.08b7e139` | `ac01-mains.test.ts` (1) | The lamp plugged in at 1 ms: at six steps the lamp's `r` 11,500 Ω, `i_rms` 0.02 A and `p` 4.6 W to 1e-12 relative; `i` at step 5 0.028284 A to 1e-9 A, at 4 and 6 the sines either side; circuit.kcl and circuit.power PASS over steps 0 to 10,000. Fails: the base; another resistance formula, a current from the rating alone, an instantaneous value a step off or at another phase, a judge that fails a right run |
| 2 `#1181.44ca3e33` | `ac02-plug.test.ts` (2) | (a) Plug out, in at 1,005, out at 2,003: at every open step the lamp's `i`, `i_rms`, `p` are 0 and the meter's `energy` is the step before's; the plug's `on` 0/1/0; step 1,005 carries 0.02 A, 4.6 W, 0.028284 A; the meter reads 4.5908 J at 2,002. (b) `kept_current@1` on the same piece: circuit.kcl FAILs, its first fail at step 2,003 naming live or pin with a sum past 1e-3 A; the reference passes. Fails: the base; current through an open plug, a meter that counts while open, a current a step late, the planted twin, a kcl rule blind to it |
| 3 `#1181.9a9ac998` | `ac03-drift.test.ts` (2) | (a) One cycle at 1 ms: the flex's `drift` 1.958120 × 10⁻⁶ m/s within 1e-4 relative at every step; `drift_x` A (1 − cos 2π·50·t) within 1e-4 of A at every step, either sign; its swing (max − min) ÷ 2 = 8.8146 × 10⁻⁹ m within 1e-4. (b) The hour, 125 solves a logic step: A, 2A, A, 0 and A at 0.125 s … 0.5 s and 3,599.875 s within 1e-4 of A; at 3,600 s 0 within 1e-15 m; the meter shows the 3.6 million steps ran. Fails: the base; another density, area or charge; a displacement summed by steps (0.8% short), centred on 0, grown from the speed, or on a drifting clock |
| 4 `#1181.5880f671` | `ac04-meter.test.ts` (2) | (a) The kettle at 120 Hz: the switch's `on`; `energy` 0 before, 20 J at the first closed step, 324,000 J and 0.09 kWh to 1e-9 relative at steps 16,799, 16,800 and 17,999; circuit.power PASS over 18,000 steps. (b) `rated_meter@1`: circuit.power FAILs, its first fail step 0, meter `meter`, gap 20 J. Fails: the base; a meter that counts while open, counts a step twice or not at all, or in other units; the planted twin; a power rule that reads no meter |
| 5 `#1181.d116aeee` | `ac05-fuse.test.ts` (2) | (a) The fault at 10 µs: the earth wire 0 A at steps 0 to 999 and the fuse shut at 0.02 A; the fuse opens at 1,018 within one step, carrying 230.02 A (the fault 230 A) until then; from then no part carries current past 1e-9 A and it stays open; circuit.fuse, kcl and power PASS. (b) `late_fuse@1`: circuit.fuse FAILs naming `fuse`, `step` 1,171 and `expected` 1,018, each within one step. Fails: the base; a fuse on instantaneous current, another curve or clock, one that opens early or late, current through an open fuse, a leaking earth, the planted twin, a rule that reads no curve |
| 6 `#1181.9ae37d13` | `ac06-diode.test.ts` (1) | The lamp's circuit with a diode: `logic_refused` naming the item and, in a refusal, `part: "rectifier"`, and no other part; the same circuit without it admitted. Fails: the base; a check that admits it, or names another part |
| 7 `#1181.eb06b860` | `ac07-hosts.test.ts` (3) | (a) circuit@1's own fixtures and this suite's replugged and fault pieces: the same step hash at every step and the same checkpoints on this core and in headless Chrome (BLOCKED without Chrome). (b) The two pieces baked by two processes: the same step hashes and arrays as text at every step, the same checkpoints. (c) circuit@1's entry in `circuitcopy@1.0.0` with no planted library: `pack_refused` naming the interface; with them `circuitcopy@1.0.1` installs. Fails: the base; an engine-dependent float path, a run that reads a clock or keeps state, a pack check that lets an interface ship no plant |
| 8 `#1181.9b64dca3` | `ac08-readout.test.ts` (2) | (a) The readout's text by deep-show's `eval` is "0.02 A" at steps 30, 60 … 600, deep-logic's `playback` of the same item gives the lamp 0.02 A and the source 10.02 A there, no `number_unsourced`. (b) The readout typed as "0.02 A": `number_unsourced` naming `current`; the counter's document none. Fails: the base; a readout of another part, without its unit, or at another precision; a check blind to a typed number |
| 9 `#1181.c7d086b8` | `ac09-budget.test.ts` (2) | (a) The grid, 64 nodes and 128 parts: the source, the farthest load and the fuse carry the nodal solve's currents within 1e-9 relative at steps 0 and 19; kcl, power and fuse PASS. (b) Timing: five runs of 60 interleaved one-step frames, the median busy frame less the median idle frame under 0.1 ms, by judgeLimit with loads. Fails: the base; a solve that skips the work; a slow solve; INCONCLUSIVE off the reference Mac or under load |
| 10 `#1181.726c5f11` | `ac10-kit.test.ts` (2) | (a) One twin for each rule, three planted libraries, each example a fixture the pack carries; `circuitcopy@1.0.0` installs and its `kit` reads each twin raising exactly its rule; with the rules turned one place round, `circuitcopy@1.0.1` is `pack_refused` naming the interface, the twin and the rule it didn't raise. (b) Each example, on the reference library, baked by two processes: the same step hashes, arrays and checkpoints; judged: all three rules PASS. Fails: the base; a pack check that runs no kit or takes any rule's failure for a twin's own; an example that differs between runs, or that the reference library fails |

Test count: 1 + 2 + 2 + 2 + 2 + 1 + 3 + 2 + 2 + 2 = 19.

## Planted wrong programs, and who carries them

| Wrong program | Criterion | Carried by |
|---|---|---|
| `kept_current`, `rated_meter`, `late_fuse` | 2, 4, 5, 10 | circuit@1's first-party pack (`planted`, `twins`): the design ships each interface's planted libraries and its kind kit's twins; this suite links each by its own name |
| `circuitcopy@1.0.0`: the entry with no planted library | 7 | this suite (pack_check) |
| the readout typed "0.02 A" | 8 | this suite (show.ts: `typed`) |
| the diode | 6 | this suite (circuits.ts) |
| a displacement summed step by step; a 1 ms fuse step | 3, 5 | this suite, in node (the model shows each misses its bound) |

## Readings where the issue leaves a choice

- **How the circuit reaches a library, and what "refused at check" sees**: #1255's way. The item declares the circuit,
  the check validates it and builds asset 0, and the builders add each node and part from it; so a diode is something
  the check reads and names. The builders are the issue's exports, each taking the table and an index.
- **"Closed while a named input says so"**: a control the item reads, nonzero; the library reads it from the read
  region the program passes `solve`, so every program gives it the same way.
- **"A step of any valid length"**: `solve` takes the step's index and `per`, so the phase is k × f ÷ per, exact for a
  whole f, never a time summed in floats. Criterion 3's hour runs 125 of the circuit's steps a logic step (README:
  Pieces), the only way 3.6 million steps fit one test; the judge never reads such a piece.
- **"Its rms current 0.02 A and its power 4.6 W"**: `i_rms` is a magnitude and `p` a mean; `i` carries the sign.
  **"Displacement from rest"**: from where the electrons were when the run began; that is what is 0 after whole
  cycles (a displacement about its centre would be −A there). Its sign is left open.
- **"The meter doesn't move"**: `energy` at each open step equals the step before's, which with a meter that counts
  this step's power (`energy`) holds from the first open step. **"Reads 324,000 J"**: from the first step after the
  135 s, and after.
- **The fuse's curve and its time at 230 A**: README: The fuse curve. **"Opens within one step"**: the step `on` turns
  0, within one of the curve's. **"Before the fault the earth wire carries 0 A"**: the earth wire is a part, a 0 Ω
  resistor from the case to neutral, read at every step before the fault, within 1e-9 A (the kcl tolerance), as is
  "no part carries current".
- **"Naming the step and the node"** (kcl), **"naming the step"** (power), **"naming the fuse and the step"** (fuse):
  the fails' fields above. A late fuse names the step it opened and the step its curve gives.
- **"The same outputs byte for byte twice"**: the arrays as JSON text, every f64 written to round-trip, and the step
  hashes, from two processes. **"The same fixtures"**: circuit@1's own and two of this suite's.
- **"A bound value reading the load's current"**: as #980 read it, a text counter on a driver reading
  `mains.i_rms[1]`, computed in the document from the logic array; "shows 0.02 A" is its drawn text, the unit and two
  places its format's.
- **Budget**: "solves in under 0.1 ms a step" is a busy frame (a step that solves) less an idle one (the same circuit
  added, no solve), CPU time a frame reports (`eval_ns`), in the debug build the suite builds.
- **"Every example builds to the same bytes twice"**: each twin's example, on the reference library, baked twice in
  two processes; **"every clean example passes"**: those examples judged on the reference library.

## Not asserted, because no criterion says so

`v` (node volts); `source_dc`, `phase`, `r_internal`, `aluminium`, a slow fuse, a fuse's reset; a wire's `length` and
whether it adds resistance (only criterion 3's circuit has a wire, and 2 m of 0.75 mm² copper, 0.045 Ω, would move its
0.02 A by 4 × 10⁻⁶ relative, inside 1e-4); the builders' −1 and `solve`'s 0; other refusals at check
(an unknown node, an input the item doesn't read, a meter on a meter); the carrier densities' and curves' place and
sources in the pack; units on the arrays' declarations; deep_kinds' listing; the built table's bytes; the state past
its head.

## What the implementer adds outside this folder

- `scripts/lanes.mjs`: `timed.push('tests/acceptance/1181/ac09-budget.test.ts')` (it calls judgeLimit). The folder is
  already alone by `lane.json`.
- The first-party pack with circuit@1's entry, its reference library, its fixtures (one each planted library fails,
  #416), its three planted libraries and its twins' examples, with the design's As built.

## Files

- `circuits.ts`: the fixtures and the values worked by hand. `model.ts`: the constants, the fuse curve, the drift and
  displacement, and a nodal solve. `programs.ts`: the arrays' layout and the programs' text.
- `helpers.ts`: the first-party pack's reader, pieces, the `plants` pack, `playback`'s and the judge's readers.
  `show.ts`: criterion 8's document.
- `ac01-mains`, `ac02-plug`, `ac03-drift`, `ac04-meter`, `ac05-fuse`, `ac06-diode`, `ac07-hosts`, `ac08-readout`,
  `ac09-budget`, `ac10-kit` (`.test.ts`): one file a criterion.
- `lane.json`, `twins.json`, `tsconfig.json`, `BASE-FAILURE.txt`.

## Checked before the base run

Scratch scripts (outside the checkout, deleted) held this suite's own numbers to first principles: the criterion IDs
from the issue's text; each hand-worked value above from the issue's constants; `model.ts`' nodal solve on every
fixture (the lamp open and closed, the kettle, the fault on and off, the readout's circuit, and the grid's kcl and
power balance); the fuse's steps (1,018 at 230.02 A and at 230 A, 1,171 at ten times) and the curve's times at 2.1,
2.75, 4 and 10 × its rating; the step-summed displacement's 0.8% shortfall; the long run's energy sum. The type-check
ran clean.

A scratch vitest file under `target/blind-1181/` (deleted) held the suite's programs to real components: each of the
eleven (plugged, replugged, cycle, kitchen, faulty, grid, hourly with 125 solves a step, the grid's idle twin, the
plants' own, the readout's, the diode's) assembled by #416's assembler as a relocatable object and, from the same
text, as a whole module that node's WebAssembly ran against a recording stand-in for the twelve exports: `init` calls
`node` for each node and each part's own builder in order with `s` 1 MiB and `g` 262,148, and no call for the diode;
each step calls `solve` with the read region at 0 and the fixture's `per`, at k for one solve a step, at 125(k − 1) + 1
… 125k for the hour and never for the idle twin; and the step copies exactly the state's head to the write region.
11 passed. A probe of the base's `deep-logic` gave the refusals in BASE-FAILURE.txt.

Not checked: anything of the implementation (none exists); a working stand-in for circuit@1 (none was written, unlike
#1255's, so `playback`'s arrays, the judge's fails and the kit's reply are read only as this README states them);
Chrome; deep-show drawing the readout; the timing.
