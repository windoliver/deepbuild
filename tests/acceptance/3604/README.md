# Acceptance tests for #3604: circuit@2, breakers, RCDs, changeovers, parts the piece's own logic drives, and a transformer (criteria 1 to 16)

Written first, blind, from issue #3604 (its body as given to this job: the opening paragraph, Epic and Design lines,
Runs on, Scope, Fields, sixteen acceptance criteria, Proof, Not in scope and Depends on; no comments), the design
sections it names and the base commit `d303e2b64` ("Merge pull request #3643 …"), by a job that never saw an
implementation; none existed, and no other branch, worktree, pull request, plan, session or GitHub page was read. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding).

## What was read

- The issue, whole. Its own spellings are kept: `circuit@2`, its parts `breaker`, `rcd`, `changeover` and
  `transformer` with the fields in Fields, the inputs `closed_by`, `on_by`, `reset_by`, `test_by` and `at_b_by`, an
  input's `{array: <name>[<index>]}`, a number field's `{set_by, range}`, the layout `circuit.state@2` and its new
  arrays `heat`, `residual`, `i2_rms` and `i2`, the rules `circuit.breaker`, `circuit.rcd` and `circuit.range` beside
  `circuit.kcl {tolerance = 1e-9 A}`, `circuit.power {tolerance = 1e-6 relative}` and `circuit.fuse`, the constants
  (θ 1.69 at opening, τ 60 s, magnetic multiples B 4, C 7.5, D 15, an RCD's 0.2 s and its 0.01 s floor), the caps (64
  nodes, 128 parts) and every number in the criteria.
- `docs/technical-design.md`: Library interfaces; How we know version 0 works (criteria to tests, wrong programs);
  Dogfooding. AGENTS.md.
- `docs/canvas-primitives.md`: Logic: library interfaces (its `circuit@1` sentences and the As built (#1181) and
  (#1255) paragraphs); Logic: linked libraries; Logic `logic@1`; Pack: kind rules and the kind kit; Units and axes;
  Honest numbers. All through `node scripts/design-section.mjs --issue 3604`, which printed them offline.
- At the base, for call shapes only: `tests/acceptance/1181/` (README, helpers, programs, circuits, model, every test,
  lane.json, twins.json, BASE-FAILURE.txt: the closest model, followed throughout and imported where it fits),
  `packs/circuit-1.0.0/` (pack.json, LAYOUT.md, a fixture and a program's text), `crates/deep-logic/src/circuit.rs`
  (the as-built table, refusals and judge), `crates/deep-logic/src/interfaces.rs` and `fixtures.rs` (an interface
  fixture's refusal, `pack_check`'s `judged` and `kit`), `tests/acceptance/416/interfaces/` (README, wat.ts, the layout
  probe), `tests/acceptance/190/helpers.ts`' exports, `tests/acceptance/535/helpers.ts`' exports,
  `crates/deep-canvas-marks/src/scene.rs` (a format's unit), `crates/deep-canvas/src/time.rs` (step rates),
  `crates/deep-show/src/{main.rs,frames.rs,time.rs}` (eval's `t`), `scripts/{proof-change,proof-runs,lanes,lanes-lists,benchmark}.mjs`.

## What the base already does, and these tests don't credit

Read from the base's source (not run: BASE-FAILURE.txt): `first_party` lists seven packs (`crates/deep-logic/src/first_party.rs`), `circuit@1.0.0` among them; none declares `circuit@2`, and nothing under `crates/`, `packs/` or `scripts/` names it. circuit@1 is as
#1181 built it: its eleven builders and `solve`, `circuit.state@1`'s ten arrays, its three rules and its three planted
twins. A `breaker`, `rcd`, `changeover` or `transformer` part is refused as a kind circuit@1 can't model, and an input
or number field that is an object is refused. Everything else these tests drive is on the base: links by name and by
interface (#190, #416), an interface fixture's refusal naming its step and array, bakes with step hashes and
checkpoints, `playback`, `judge`, `web_plan` and the web runner, `view` and `frame`, the layout probe, deep-show's
`eval` and honest numbers (#406), and `pack_check`'s refusal of an interface with no planted library. No test passes
because of any of it: each one first needs the first-party pack that declares `circuit@2`, and fails there
(BASE-FAILURE.txt). circuit@1 staying byte for byte as it is (Scope) is `tests/acceptance/1181/`'s to hold, not this
suite's.

## Run them

```sh
npm ci --no-audit --no-fund                          # once, in a fresh worktree
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node scripts/throttle.mjs test --wait 300 -- sh scripts/lease nice -n 10 \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/3604 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/3604/tsconfig.json
rm -rf tests/acceptance/3604/node_modules            # vitest's cache
```

What a run builds, honoring `CARGO_TARGET_DIR`: `deep-logic` (#190's helpers, imported unchanged), #416's assembler
arrangement (`../416/interfaces/wat.ts`, into `target/acceptance-416-wat`), and for criterion 14 `deep-show`, the full
set (`../535/helpers.ts`, imported unchanged), built inside that file's first test after circuit@2 is found, so a base
run doesn't build it. Criterion 13 starts headless Chrome (`CHROME_BIN` or the usual paths). Every test has #190's
90-minute timeout.

The long runs: `hours.test.ts` plays 3,600 s once, 28,801 logic steps of 125 circuit steps each (3,600,000 solves),
and its three tests (criteria 1, 6 and 7) read that one run; `ac05-reset.test.ts` plays and judges 122,100 steps on
the reference library and 151,300 on its planted twin; `ac02-overload.test.ts` 61,000. Nothing else passes 4,300.

Gates: a missing host (Chrome) is `BLOCKED:`, never a pass (#190's). Criterion 15's timing is judged by
`scripts/benchmark.mjs`'s judgeLimit with the one-minute load at each run's start and end: off a reference Mac, under
load, or with readings neither all in nor all out of the limit it fails `INCONCLUSIVE:` with its readings, never a
pass; that file's other test, that the board really solves, runs on any machine. Nothing else depends on the machine.

**Lanes.** `lane.json` puts the folder in the alone block with the reason `binary` (its files build cargo binaries,
one builds deep-show, one starts Chrome, one runs 3.6 million steps). `ac15-budget.test.ts` calls judgeLimit, so it
belongs in the `timed` list, which a lane file can't set: the implementer adds
`timed.push('tests/acceptance/3604/ac15-budget.test.ts')` in `scripts/lanes-lists.mjs`, beside #1181's (README: What
the implementer adds). `twins.json` maps criteria 3, 5, 6, 8 and 12 to the planted libraries' names, as #1181's does;
every test fails on the merge base at its own assertion, so no twin folder is needed or read.

## The surface

The issue names an interface, its parts' fields, its inputs and number fields, its layout's new arrays and its rules,
but no command line, WebAssembly signature, memory or encoding. As in #1181's suite the surface is `deep-logic`
(#531's, #532's, #190's and #416's JSON-lines protocol and #981's `judge`, unchanged where not named here), and for
criterion 14 `deep-show run`. **Every signature, array, code, document key, call field, reply field, refusal field,
kit field, pack name, fixture name and planted name below that is marked *(mine)* is this job's invention**: the least
the criteria need, in the issue's and the design's spellings where they have them, and circuit@1's as built (#1181)
wherever the issue doesn't say otherwise. The implementer builds exactly these, or a dispute goes to a blind redraft.

### The first-party pack

`{"call": "first_party"}` lists a first-party pack (any name; `packs/circuit-2.0.0`, `circuit@2.0.0`, beside
`circuit-1.0.0`, as #1181 placed its own) whose `interfaces` hold **`circuit@2`**, #416's Interface, with:

- `exports`: exactly the sixteen below with their signatures: circuit@1's twelve as built and `breaker`, `rcd`,
  `changeover`, `transformer` *(their signatures mine)*;
- `layout: "circuit.state@2"`; fixtures; `planted`; `digest` (#416's);
- **`"rules": {"circuit.kcl": {"tolerance": 1e-9}, "circuit.power": {"tolerance": 1e-6}, "circuit.fuse": {},
  "circuit.breaker": {}, "circuit.rcd": {}, "circuit.range": {}}`**: the issue's six kind rules with their params'
  defaults, as circuit@1's entry carries its three;
- **`"twins"`**: its kind kit, exactly one twin a rule (README: The kind kit);
- **`"plants": {"no_magnetic", "cold_reset", "one_pole", "both_ways", "primary_current"}`** *(mine: the field and the
  names)*: each the asset ID of one of `planted`, the five wrong programs the issue's Proof names (README: Planted
  libraries). Other planted libraries (the kit's twins for circuit.kcl and circuit.fuse, say) may be listed there too.
- **A fixture named `stair`** *(mine: the name)*, #416's fixture shape with its `name`, a stair light of changeovers
  whose expected arrays hold the lamp's current at a step where one of its inputs changes (criterion 8).

The same pack's `libs` holds exactly one library whose `implements` names `circuit@2`: **the reference library** (any
name@version), with fixtures of its own; its object is among `first_party`'s assets. A piece links it by that name and
hash and imports the exports as `lib:circuit@2.<export>`. The constants the issue lists are the pack's, each with its
source (where and how is the implementer's: no test reads them; they read the values they give).

### Pieces

As #1181's: a logic item's params gain `"circuit": {"nodes": [name], "parts": [Part]}`, a part is `{"id", "kind",
…the kind's fields}`, node `j` is `nodes[j]` and part `i` is `parts[i]` everywhere, node 0 is the reference at 0 V.
circuit@1's kinds and fields are as built (packs/circuit-1.0.0/LAYOUT.md). circuit@2's, with the issue's fields:

| Kind | Fields |
|---|---|
| `breaker` | `from`, `to`, `rating` (A), `curve`: `B` \| `C` \| `D` = `B`, `reset_by` (an input) |
| `rcd` | `live: [from, to]`, `neutral: [from, to]`, each from the supply side to the load side; `rating` (A) = 0.03; `test_r` (Ω, optional): a path from `live`'s load side to `neutral`'s supply side; `test_by`, `reset_by` (inputs) |
| `changeover` | `common`, `a`, `b` (nodes), `at_b_by` (an input) |
| `transformer` | `primary: [from, to]`, `secondary: [from, to]`, `turns: [n1, n2]` |

- **An input** (`closed_by`, a fault's `on_by`, `reset_by`, `test_by`, `at_b_by`) is a control ID, as built, or
  **`{"array": "<name>[<index>]"}`**, one element of an i32 (or bool) array of the item's own `writes`, nonzero while
  it says so. This suite's programs write such an element before each `solve` of a circuit step (README: Programs),
  and the library reads it from the item's write region in memory at that solve, where the region map puts it (how
  the built table points there is the check's and the library's; the tests read the table nowhere). **An array of
  another item is spelled by its path, `{"array": "<logic ID>.<name>[<index>]"}`** *(mine)*, and is refused at check
  (below), as is one the item doesn't write.
- **A number field** (`r`, `p_rated`, `v_rated`, `v`, `v_rms`, `f`) is a number, as built, or **`{"set_by": <control ID
  | {"array": "<name>[<index>]"}>, "range": [min, max]}`**, read at each solve; a control reads 0 before its first
  entry (as built), so this suite's controls get an entry at step 0. A value outside its range is held to the nearer
  end before the solve, and the resistor's `r` (and a load's, from its set `v_rated`) reads the value it solved at.
- **The changeover** joins `common` to `a` while its input is 0 and to `b` while it is nonzero, never both, never
  neither. **The transformer** is ideal: the secondary's volts are the primary's × n2 ÷ n1, its primary's current the
  secondary's × n2 ÷ n1, and it takes no power. Its secondary may sit on nodes nothing joins to node 0 (the doorbell's
  do): the tests read only the difference of their volts.
- **Refusals at check** are `{"ok": false, "code": "logic_refused", "item": <logic ID>, "refusals": [Refusal]}`, each
  refusal `{"rule", "what", "part": <its ID>}` as built. An input naming another item's array: a refusal whose `part`
  is the part. **A DC source on a network a winding joins: a refusal whose `"parts": [<ID>, <ID>]` holds both the
  source's and the transformer's IDs** *(mine: `parts`)*. No other refusal is asserted.
- **More than one solve a logic step**, as #1181's: a program may solve several circuit steps in one logic step, in
  order, each of length `1 ÷ per`; the hour does (125 a step). The judge reads only pieces that solve once a step
  with `per` the item's step rate.

### Exports of circuit@2 *(the four new signatures mine)*

`s` is the address of the state in the caller's memory, `g` that of the built table (asset 0's bytes: `assets_at + 4`).

| Export | Signature | Does |
|---|---|---|
| `node` | (s i32, g i32, i i32) → i32 | as built |
| `source_dc`, `source_ac`, `resistor`, `load`, `switch`, `connector`, `fuse`, `meter`, `wire`, `fault`, **`breaker`, `rcd`, `changeover`, `transformer`** | (s i32, g i32, i i32) → i32 | adds part i of the table, which must be of the export's kind; i, or −1 |
| `solve` | (s i32, r i32, k i64, per i64) → i32 | as built: solves the circuit's step k, at t = k ÷ per s, reading control inputs from the read region at r and own-array inputs and set values from memory; 1, or 0 with no single solution |

### Memory, and the state and its arrays

#1181's memory (`programs.ts`): reads at 0, writes at 4,096, 8 bytes of data at 49,152, `assets_at` 262,144, `s` at 1
MiB, 32 pages; the state at most 1 MiB. **The state's head is `circuit.state@2`'s arrays** *(mine: the order, types
and counts of the four new ones)*: circuit.state@1's ten as built, in their order, then four, each 8-aligned, for N
nodes and P parts:

| Array | Type × count | Unit | Holds, at the step solved |
|---|---|---|---|
| `v` … `drift_x` | as circuit.state@1 | | as built. `i_rms`, `i` and `p` hold an RCD's live pole and a transformer's primary; `i` runs from the pole's or the winding's first node to its second, and a changeover's from `common` to the way it joins. `on` reads 1 for a closed breaker or RCD and 0 for an open one, and 1 for a changeover at `a` and 2 at `b`. `p` is 0 for a breaker, an RCD, a changeover and a transformer; `r` is a set resistor's or load's value as solved |
| `heat` | f64 × P | | a fuse's or a breaker's θ; 0 for the rest |
| `residual` | f64 × P | A | an RCD's residual, the rms of the sum of its two poles' currents; 0 for the rest |
| `i2_rms` | f64 × P | A | the rms current of an RCD's neutral pole or a transformer's secondary; 0 for the rest |
| `i2` | f64 × P | A | its instantaneous current, from the pole's or winding's first node to its second |

A program publishes them with one copy of the head over its write region after its calls; a bound value reads each
by the item's path, `<logic ID>.<name>[<index>]`. For 64 nodes and 128 parts the head is 512 + 13 × 1,024 = 13,824
bytes.

### Programs, and their tallies

This suite's programs (`programs.ts`: `circuitProgram`), not the surface the implementer builds, but what the tests
read: at init each adds nodes 0 … N − 1 and then each part with its kind's builder; at each circuit step j it writes
its own arrays (an i32 `run[0]` 1 at steps 100 to 199, say), calls `solve(s, 0, j, per)`, and then **tallies**, in
arrays of its own writes after the state's head: for each part it watches, `first_off` (the first step its `on` read
0, −1 while none), `last_off` (the latest step `on` turned 0), `off_steps` (the steps `on` read other than 1) and
`was_on`; for each element it follows, `peak`, the largest |x| of all the steps it solved. So an hour solved 125 steps
a logic step still shows what every one of its 3,600,000 steps did.

### The breaker, the RCD and their constants

The issue's, with nothing added. **A breaker's thermal element** heats as θ' = ((i_rms ÷ rating)² − θ) ÷ τ, τ = 60 s,
at every step, open ones included (carrying 0), and opens it at the start of the first step θ has reached 1.69;
**its magnetic element** opens it at the start of the step after one whose rms reached 4 (B), 7.5 (C) or 15 (D) times
its rating; it stays open until its `reset_by` input turns on, which closes it with the heat it has. **An RCD's count**
rises at a step whose residual is at or above its rating by the step's length ÷ max(0.01 s, 0.2 s × rating ÷
residual) and returns to 0 at any other; both poles open at the start of the first step it has reached 1, until
`reset_by`. A test path of `test_r` conducts while `test_by` says so.

### The judge

#1181's `{"call": "judge", "piece", "track", "steps"}`: for every logic item whose library implements circuit@2, its
reply's rules hold all six *(mine: that circuit@1's items keep their three)*, each `{"verdict", "steps", "fails"}` as
built, each reading the library's arrays at every step with the item's topology, ratings and inputs and the pack's
constants, never the library's own verdict. circuit.kcl, circuit.power and circuit.fuse are as built, over the new
parts too (an RCD's poles and a transformer's windings at their nodes by `i` and `i2`, a changeover's way by `on`).
The new rules' fails *(mine: the fields)*:

- **`circuit.breaker`**: for each breaker, the step its elements give it open, from its `i_rms` and its own heat kept
  by the rule (a reset keeps it), against the step its `on` turns 0: more than one step apart, or opened with no cause,
  is `{"breaker": <its part ID>, "step": <the step it opened, or null>, "expected": <the step its elements give, or
  null>}`; an open breaker carrying past 1e-9 A is `{"breaker", "step", "current"}`.
- **`circuit.rcd`**: for each RCD, its count from the residual its poles' currents give, against the step its `on`
  turns 0: more than one step from the step its count gives, or while its count is under 1, is `{"rcd": <its part
  ID>, "step": <the step it opened, or null>, "expected": <the step its count gives, or null>}`; an open RCD carrying
  past 1e-9 A on either pole is `{"rcd", "step", "current"}`.
- **`circuit.range`**: at each step, each set value its range had to hold, or one that wasn't finite, is `{"part": <its
  ID>, "field": <the field, such as "r">, "step"}`.

### The kind kit

#1181's, moved to six rules. A twin is `{"planted", "example", "expect"}`: one of the interface's `planted`
libraries, a fixture the pack carries and the rule's code; on its example the planted library raises `expect` and no
other rule, and the reference library raises none. **circuit.range's twin may be `{"example", "expect"}` with no
`planted`** *(mine)*: a set value outside its range fails circuit.range on every library, the reference included, so
its planted thing is the example itself (#202's own twin shape), run on the reference library, raising circuit.range
alone. **`pack_check`** of a pack whose interface carries `twins` runs each; its reply's entry for the interface gains
`"kit": [{"planted"?, "example", "expect", "raised": [<rule code>]}]`, and a twin whose `raised` lacks its `expect`
refuses the pack: `{"ok": false, "code": "pack_refused", "pack", "refusals": [{"rule", "what", "interface", "planted"
or "example", "expect", "raised"}]}` (as built).

### Planted libraries *(names mine)*

| Name in `plants` | The wrong program (the issue's Proof) | Fails |
|---|---|---|
| `no_magnetic` | a breaker with no magnetic element | circuit.breaker (criterion 3), the kit's twin for it |
| `cold_reset` | a reset closes a breaker cold (θ 0) | circuit.breaker (criterion 5) |
| `one_pole` | an RCD's residual from its live pole alone | circuit.rcd (criterion 6), the kit's twin for it |
| `both_ways` | a changeover joins `a` and `b` for the step its input changes | the interface's `stair` fixture (criterion 8) |
| `primary_current` | a transformer's primary carries the secondary's current, and it still takes no power | circuit.power (criterion 12), the kit's twin for it |

Each is the reference library with one change, shipped by the first-party pack and named in `plants`; #416's rule
also holds each to failing one of the interface's fixtures. This suite links each by its own name (`no_magnetic@1`
…) from a pack `plants` of its own (origin installed), with a fixture of its own that any circuit@2 library passes (a
lamp straight on the mains, `on` `[1, 1]` at step 0), as #1181's suite does; and `both_ways` once more with
`"implements": ["circuit@2"]`, so linking it runs the interface's fixtures. The kit's twins for circuit.kcl and
circuit.fuse (circuit@1's `kept_current` and `late_fuse` as circuit@2 libraries, say) are the implementer's.

### One example of each, as the tests write and read them

```text
part     {"id": "main", "kind": "breaker", "from": "live", "to": "load", "rating": 16, "curve": "B", "reset_by": "reset"}
part     {"id": "rcd", "kind": "rcd", "live": ["live", "l_load"], "neutral": ["neutral", "n_load"], "rating": 0.03,
          "test_by": "test", "reset_by": "reset", "test_r": 3000}
part     {"id": "top", "kind": "changeover", "common": "live", "a": "strap_a", "b": "strap_b", "at_b_by": "x1"}
part     {"id": "bell_tx", "kind": "transformer", "primary": ["live", "neutral"], "secondary": ["bell_a", "bell_b"], "turns": [115, 6]}
input    {"id": "relay", "kind": "switch", "from": "live", "to": "lamp_in", "closed_by": {"array": "run[0]"}}
set      {"id": "dimmer", "kind": "resistor", "from": "live", "to": "mid", "r": {"set_by": "knob", "range": [0, 2000]}}
writes   {"v": {"type": "f64", "count": 3}, … "i2": {"type": "f64", "count": 3}, "run": {"type": "i32", "count": 1}}
refusal  {"ok": false, "code": "logic_refused", "item": "doorbell_dc", "refusals": [{"rule": …, "what": …, "parts": ["battery", "bell_tx"]}]}
judge    {"call": "judge", "piece", "track", "steps": 300} → {"ok": true, "items": {"short": {"rules": {…,
           "circuit.breaker": {"verdict": "FAIL", "steps": 300, "fails": [{"breaker": "main", "step": 223, "expected": 101}]}, …}}}}
rcd      {"verdict": "FAIL", "steps": 100, "fails": [{"rcd": "rcd", "step": 24, "expected": null}]}
range    {"verdict": "FAIL", "steps": 300, "fails": [{"part": "dimmer", "field": "r", "step": 200}, …]}
link     {"ok": false, "code": "link_refused", "item": "stair", "refusals": [{"rule": "interface", "interface": "circuit@2",
           "library": "both_ways@1", "fixture": <the stair fixture's ID>, "step": …, "array": "i_rms", "index": <the lamp>, …}]}
readout  {"text": {"counter": {"source": "residual_ma", "tabular": true, "format": {"unit": "mA", "precision": 0, "group": "none"}}}}
         with the driver {"target": "data/residual_ma", "expr": "x * 1000", "vars": {"x": "board.residual[1]"}}
```

## Fixtures

`circuits.ts` holds them with the values worked by hand; `model.ts` computes each from the issue's constants and the
tests hold it to the hand-worked numbers first. Every source is 230 V rms, 50 Hz, phase 0, no internal resistance, at
1,000 steps a second unless said; a load is its rated power at 230 V. The 60 W lamp is 230² ÷ 60 = **881.67 Ω** and
takes 6 ÷ 23 = **0.26087 A**.

**The breaker's thermal time.** With x the rms over the rating and θ from θ0, θ(t) = x² − (x² − θ0) e^(−t/τ), so θ
reaches 1.69 at t = −60 ln((x² − 1.69) ÷ (x² − θ0)); at 1 ms, moving θ by the closed form each step, it opens at
the start of step ⌈t × 1,000⌉ after the current began (`thermalSteps`). The criteria's times, each held within one
step of the issue's figure:

- **The hour** (criteria 1, 6, 7; `HOURS`): 2,000 ÷ 230 = **8.6957 A**, x² = **0.295369**; 4,158.4 ÷ 230 = 18.08 A =
  **1.13** × 16, x² = **1.2769** < 1.69, so neither opens and each settles at x² (at 3,600 s, 60 τ, e^(−60) is 9 ×
  10⁻²⁷). The lamp's RCD: 0.26087 A on each pole, sum 0. The 101 kΩ fault: 230 ÷ 101,000 = **2.2772 mA** < 30 mA.
  8 logic steps a second of 125 circuit steps each: logic step 28,800 leaves circuit step 3,600,000 (3,600 s).
- **The overload** (criterion 2; `THREE`, `HEAVY`): 6,000 ÷ 230 = **26.087 A**, x = **1.6304**, t = **60.5933 s**
  (issue 60.593), the step-by-step heat opens it at 60,594, the Euler form at 60,593; 9,384 ÷ 230 = 40.8 A = **2.55**
  × 16, t = **18.0582 s** (issue 18.058), step 18,059.
- **The short** (criterion 3; `SHORT`): 230 ÷ 0.5 = **460 A** = **28.75** × 16 ≥ 4: the magnetic element opens it at
  k + 1 (k = 100). Without it, the breaker carries 460.26 A (with the lamp), x² = 828.4, t = 0.12266 s (0.12280 s at
  460 A): step k + 123 either way, the issue's **0.123 s**.
- **The curves** (criterion 4; `CURVES`): 18,400 ÷ 230 = 80 A = **5** × 16: ≥ B's 4, so B opens at step 1; under C's
  7.5 and D's 15, so x² = 25, t = −60 ln(1 − 1.69 ÷ 25) = **4.1996 s**, step **4,200**.
- **The reset** (criterion 5; `RESETS`): the trip at 60,594 leaves θ = 1.690011; open, θ falls at τ for 30,000 steps:
  1.690011 × e^(−0.5) = **1.025044** (the issue's 1.0250 within 1e-4; 1.69 e^(−0.5) = 1.025037). Reset at 90,594 with
  that heat: t = −60 ln((2.658318 − 1.69) ÷ (2.658318 − 1.025044)) = **31.3669 s** (issue 31.367), step 90,594 +
  31,367; cold, it would take 60.593 s again: 90,594 + 60,594. The criterion's "within one step" is held to the
  issue's 31,367 and 60,593. Runs: 122,100 steps (reference), 151,300 (planted).

**The RCD's count.** At a steady residual R ≥ rating, the time is max(0.01, 0.2 × rating ÷ R) and the count reaches 1
after ⌈time ÷ 1 ms⌉ steps (`rcdSteps`). At its rating 0.2 s, at twice 0.1 s, five times 0.04 s: the issue's.

- **One pole** (criterion 6; `RCD_LAMP`): the live pole alone reads 0.26087 A, so 0.2 × 0.03 ÷ 0.26087 = **23 ms**;
  the count's 23 rises of 1 ÷ 23 sum to 0.99999…, so it opens at step 23 or 24: within 0.03 s.
- **The leak** (criterion 7; `LEAKING`): 230 ÷ 2,000 = **0.115 A** = **3.8333** × 0.03 leaves by the earth (the lamp's
  0.26087 A comes back on the neutral pole); time 0.2 × 0.03 ÷ 0.115 = **52.17 ms**; 52 rises make 0.9967 and 53 make
  1.0158, so it opens at k + 53 (k = 100), within one step of k + 52.17. **The test** (`TESTED`): 230 ÷ 3,000 =
  **76.667 mA**, **78.26 ms**, k + 79.
- **The readout** (criterion 14): the same leak at 1,000 steps a second, closed by the item's own `leak[0]` from step
  100; 0.115 A × 1,000 shown to no places with unit mA is **"115 mA"**, at steps 100, 102 … 138, all before 152.

**The rest.**

- **The stair and the hall** (criterion 8): a path from live reaches the lamp exactly when the last changeover's way
  is the strap the first one feeds: x1 = x2 on the stair; on the hall the middle pair joins s1a–s2a and s1b–s2b at 0
  and s1a–s2b and s1b–s2a at 1, so x2 = x1 ⊕ x3, lit exactly when x1 ⊕ x2 ⊕ x3 = 0. The stair runs 00, 01, 11, 10, 00
  (steps 0, 100 … 400); the hall the Gray code 000, 001, 011, 010, 110, 111, 101, 100 (steps 0 … 700), each one flip.
  `both_ways` on the stair at step 100 (x2 0 → 1, x1 0): `bottom` joins both straps, one of them live, and the lamp
  lights where it should be dark; at 200 and 400 joining both lights it where it should be lit anyway.
- **The own array** (criterion 9; `OWNED`): `run[0]` 1 at steps 100 to 199, so the lamp's 0.26087 A at exactly those.
- **The dimmer** (criterion 10; `DIMMER`): `knob` 0, 881.67 (52,900 ÷ 60 as an f64) and 2,500 from steps 0, 100, 200.
  At 0 Ω, 60 W; at 881.67 Ω, 230 ÷ 1,763.33 = **0.13043 A** and 115² ÷ 881.67 = **15 W** each; 2,500 held to 2,000 Ω,
  230 ÷ 2,881.67 = 0.079815 A.
- **The settings** (criterion 11; `SET`): 120² ÷ 60 = 240 Ω, 120 ÷ 240 = **0.5 A**; at step 5 the 60 Hz wave is at 0.3
  turns: 0.5 √2 sin(0.6π) = **0.672499 A** (issue 0.67250).
- **The doorbell** (criterion 12; `DOORBELL`): 230 × 6 ÷ 115 = **12 V**; 12² ÷ 6 = 24 Ω, **0.5 A**; the primary 0.5 × 6
  ÷ 115 = **0.026087 A**; 230 × 0.026087 = **6 W**. With the primary carrying 0.5 A the source gives 115 W against the
  bell's 6: a gap of **109 W**. The secondary's rms is √(mean of (v[bell_a] − v[bell_b])²) over 20 steps, a whole 50
  Hz cycle, which is the rms exactly. `DOORBELL_DC` adds a 12 V `battery` from neutral to `aux` and 1,000 Ω from `aux`
  to live.
- **The board** (criterion 15; `GRID`): 64 nodes, 128 parts: the source, two RCDs, four B16s behind each; behind
  `cb_a1` the hall's four changeovers and its lamp; behind `cb_b4` the doorbell; behind the other six a ladder of 0.1
  Ω resistors with a 100 W load at each node and 18 heaters of 200 W. `model.ts`' nodal solve (ideal transformer, a
  floating secondary held at 0 V at its lowest node) gives 37.066 A from the source, 6.49 A in the busiest breaker
  (under 64 A, so no magnetic trip), 0.43087 A in the farthest load, 0.5 A in the bell; held by a scratch check to kcl
  (1.8 × 10⁻¹² A) and the power balance (2.8 × 10⁻¹⁴ relative).
- **The plants' own fixture**: the source and the 60 W lamp neutral ↔ live, no inputs, one step.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s, checked against the issue's text. Each `describe` and test name starts with its
criterion's ID.

| ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| 1 `#3604.078b075a` | `hours.test.ts` (1 of 3) | The hour: both B16s carry 8.6957 A and 18.08 A within 1e-9 at eight logic steps, heat 0.29537 and 1.2769 within 1e-5 at 3,600 s, the 1.13 times one's heat never past 1.2769, and on 1 at all 3,600,000 circuit steps (tallies). Fails: the base; another τ, curve or limit, heat that isn't θ, a breaker that opens at 1.13 times |
| 2 `#3604.25e37a8c` | `ac02-overload.test.ts` (1) | 26.087 A at step 0; opens at 60,593 within one step; open and 0 A in every part from then to step 60,999; 9,384 W opens at 18,058 within one; kcl, power and breaker PASS at every step of both. Fails: the base; fuse's τ, instantaneous current, θ 1 or past 1.69, current through an open breaker, rules blind to the new parts |
| 3 `#3604.7de81c1e` | `ac03-short.test.ts` (2) | (a) k = 100 is the first step carrying the fault, 460 A; from k + 1 on 0 and every part 0 A; breaker, kcl, power PASS. (b) `no_magnetic` opens at k + 123 within one step and circuit.breaker FAILs naming `main`, that step and k + 1. Fails: the base; a magnetic element a step late or on peak current, the planted twin, a rule that reads only the heat |
| 4 `#3604.455db5a3` | `ac04-curves.test.ts` (1) | 80 A in each at step 0; B opens at step 1 (C and D still closed there), C and D at 4,200 within one step; circuit.breaker PASS. Fails: the base; one multiple for all curves, multiples in A, a B that waits for its heat |
| 5 `#3604.60102bcb` | `ac05-reset.test.ts` (2) | (a) First trip at 60,593 within one; open until 90,594 and closed by the reset; heat 1.0250 within 1e-4 at 90,593 and 90,594; open again at 90,594 + 31,367 within one; circuit.breaker PASS over 122,100 steps. (b) `cold_reset` opens again at 90,594 + 60,593 within one and circuit.breaker FAILs naming `main`, that step and 90,594 + 31,367 within one. Fails: the base; heat kept or lost while open, a reset that zeroes it or doesn't close, the planted twin, a rule that starts a reset cold |
| 6 `#3604.ff1304f0` | `hours.test.ts` (2 of 3), `ac06-rcd.test.ts` (1) | The hour: both poles and the lamp 0.26087 A within 1e-9, residual within 1e-12 A at every circuit step, on 1 at every one. `one_pole` opens by step 30 and circuit.rcd FAILs naming `rcd` and that step; the reference passes. Fails: the base; a residual from one pole or rms taken wrong, the planted twin, a rule that trusts the library's residual |
| 7 `#3604.e20080d5` | `ac07-leak.test.ts` (2), `hours.test.ts` (3 of 3) | (a) The leak from step 100: residual 0.115 A within 1e-9 until it opens, opens within one step of k + 52.17, lamp and fault 0 A after; rcd, kcl, power PASS. (b) The test path: 76.667 mA, opens within one of k + 78.26. (c) The hour: 101 kΩ gives 2.2772 mA within 1e-9 and on 1 at every circuit step. Fails: the base; a count that doesn't scale, opens at once or on the load, a test path through the neutral pole, current through an open RCD |
| 8 `#3604.9e3754a5` | `ac08-stair.test.ts` (2) | (a) Stair and hall at every step: 0.26087 A exactly when lit (equal inputs; parity 0), 0 A within 1e-12 otherwise, each changeover's on 1 or 2 by its input; the lamp changes at all seven hall flips; kcl, power PASS. (b) `both_ways` on this stair first differs at step 100, lit where dark; linked as a circuit@2 library, `link_refused` naming the `stair` fixture, a step where one of its inputs changes and the lamp's `i_rms` or `i`. Fails: the base; a changeover that joins both or neither while moving, on not 1 or 2, a check that runs no fixture |
| 9 `#3604.806e872b` | `ac09-own-array.test.ts` (2) | (a) No controls, empty track: `run[0]` and the lamp's 0.26087 A at exactly steps 100 to 199, 0 A elsewhere. (b) `lights` closed by `pump.run[0]`: `logic_refused` naming `lights` and `relay`; closed by its own `run[0]`, admitted. Fails: the base; a step of lag, reading the copied-out arrays, a check that lets another item's array close a part |
| 10 `#3604.6b0e4105` | `ac10-dimmer.test.ts` (1) | Steps 0–99: r 0, lamp 60 W; 100–199: r 881.67 Ω, 0.13043 A within 5e-6, 15 W each within 1e-9; 200–299: r 2,000, 0.079815 A; circuit.range FAILs, first fail `dimmer`, `r`, step 200, none before. Fails: the base; a set value read once or late, not held or held to the wrong end, a range rule blind to it |
| 11 `#3604.8a2d3993` | `ac11-set.test.ts` (1) | At every step the lamp is 240 Ω and carries 0.5 A rms; at step 5 `i` 0.67250 within 1e-5 A. Fails: the base; set values ignored, 50 Hz kept, 230 V kept for the lamp |
| 12 `#3604.1a449f4f` | `ac12-doorbell.test.ts` (3) | (a) Secondary 12 V rms within 1e-9, bell and `i2_rms` 0.5 A, primary 0.026087 A, source 6 W, transformer 0 W at every step; kcl, power PASS. (b) `primary_current`: circuit.power FAILs, first fail step 0, gap 109 W. (c) `DOORBELL_DC`: `logic_refused`, a refusal's `parts` holding `battery` and `bell_tx`; the doorbell admitted. Fails: the base; turns the wrong way round, the planted twin, a transformer solved on DC |
| 13 `#3604.56962e6a` | `ac13-hosts.test.ts` (3) | (a) circuit@2's own fixtures and six of this suite's pieces: the same step hashes and checkpoints on this core and in headless Chrome (BLOCKED without Chrome). (b) The six baked by two processes: the same hashes, arrays as text and checkpoints. (c) `circuitcopy@1.0.0` with no planted library: `pack_refused` naming the interface; with them `circuitcopy@1.0.1` installs. Fails: the base; engine-dependent floats, a clock or kept state, a pack check that lets an interface ship no plant |
| 14 `#3604.5cb1ae24` | `ac14-readout.test.ts` (2) | (a) deep-show's `eval` gives "115 mA" at steps 100, 102 … 138; `playback` gives the RCD 0.115 A and the lamp 0.26087 A there; no `number_unsourced`. (b) The readout typed "115 mA": `number_unsourced` naming `residual`. Fails: the base; a readout of another array, the wrong unit or precision, a check blind to a typed number |
| 15 `#3604.8683c04d` | `ac15-budget.test.ts` (2) | (a) The board: nine currents (source, both RCDs' poles, a breaker, the hall lamp, both windings, the farthest load) the nodal solve's within 1e-9 at steps 0 and 19; all six rules PASS. (b) Timing as #1181's criterion 9, by judgeLimit with loads. Fails: the base; a solve that skips the work; a slow solve; INCONCLUSIVE off the reference Mac or under load |
| 16 `#3604.726c5f11` | `ac16-kit.test.ts` (2) | (a) One twin a rule, six; `circuitcopy@1.0.0` installs and `kit` reads each raising exactly its rule; turned one place round, `circuitcopy@1.0.1` is `pack_refused` naming the interface, a twin and the rule it didn't raise. (b) Each example on the reference library, baked twice in two processes: the same bytes; judged: every rule PASS (the range twin's own example: circuit.range alone FAILs). Fails: the base; a kit that isn't run or takes any rule for a twin's; an example that differs or that the reference fails |

Test count: 3 (hours) + 1 + 2 + 1 + 2 + 1 + 2 + 2 + 2 + 1 + 1 + 3 + 3 + 2 + 2 + 2 = 30.

## Planted wrong programs, and who carries them

| Wrong program | Criterion | Carried by |
|---|---|---|
| `no_magnetic`, `cold_reset`, `one_pole`, `both_ways`, `primary_current` | 3, 5, 6, 8, 12, 16 | circuit@2's first-party pack (`planted`, `plants`, and three of them in `twins`): the design ships each interface's planted libraries and its kit's twins; this suite links each by its own name |
| the kit's twins for circuit.kcl and circuit.fuse, and circuit.range's example | 16 | circuit@2's first-party pack (the implementer's) |
| `circuitcopy@1.0.0`: the entry with no planted library; the kit turned round | 13, 16 | this suite (pack_check) |
| another item's array closing a part; a DC source on a winding's network | 9, 12 | this suite (circuits.ts) |
| the readout typed "115 mA" | 14 | this suite (show.ts: `typed`) |

## Readings where the issue leaves a choice

- **Pieces, exports, memory, the judge and the kit**: circuit@1's as built (#1181), extended, never changed.
- **"Read at the solve of the step that wrote it"**: the program writes the element, then calls `solve` for that
  step; the library reads it there, from memory, not from the arrays the logic module copies out after the step.
  "No input entry on the track": the piece has no controls and its track is empty.
- **"An array of another item"**: named by its path, `<logic ID>.<name>[<index>]`, the way a bound value reads it.
- **"Naming both"** (a DC source and a transformer): one refusal with both IDs in `parts`.
- **"Its heat then reads 1.0250"**: `heat` at the last open step and at the reset's step; the 1e-4 holds either reading
  of a step's heat (before or after its own change, 1.7 × 10⁻⁵ apart). **"Settles at"**: `heat` at 3,600 s.
- **"At every step of 3,600 s"**, **"stay closed"**, **"holds for 3,600 s"**: the program's tallies, over all 3,600,000
  circuit steps it solved, not only the 28,801 published. **"`residual` reads 0 within 1e-12 A"**: at every one of them
  (`peak`).
- **"Opens at 60.593 s, within one step"** (and 18.058, 4.200, 0.123, 31.367, 60.593 after the reset): the step `on`
  first (or next) reads 0, within one step of the issue's figure at 1,000 steps a second. **"52.17 ms later"** and
  **"78.26 ms later"**: within one step of k + 52.17 and k + 78.26, k the first step that carries it. **"Within
  0.03 s"**: by step 30.
- **"From then no part carries current"** (criterion 2): from the opening step to the end of the 61,000-step run, read
  at every step there. **"After that the lamp and the fault carry 0 A"**: from the opening step to step 299.
- **"Closed together from step 0"** and **"closed from step 0"**: loads wired in from step 0, no switch.
- **"Fails the stair fixture at that step, naming the lamp's current"**: #416's link refusal of an interface fixture,
  `fixture` the interface's `stair`, `step` a step where one of its inputs changes, `array` the lamp's `i_rms` or `i`
  at its `index`; and on this suite's own stair, the first wrong step is the flip at 100.
- **"The secondary reads 12 V rms"**: from its nodes' volts over a cycle, since no array holds a winding's volts.
- **"A gap of 109 W"**: |gap| 109 W within 1e-6 × 115 W, the larger sum, circuit.power's own tolerance.
- **"Shows 115 mA at 20 sampled steps of its fault"**: the fault on from step 100, sampled every 2 ms to 138, inside
  the 52 ms before the RCD opens; the logic item at 1,000 steps a second in a 60 fps film, `eval` at each step's time.
  Its fault is closed by the item's own `leak[0]` (an input, criterion 9's kind), so the document needs no track.
- **Budget**: as #1181's criterion 9: a busy frame (a step that solves) less an idle one (the same circuit added, no
  solve), the CPU time a frame reports, on a board whose inputs don't change, so it doesn't time a re-solve.
- **"Every clean example passes"**: each twin's example with a planted library, on the reference library; the range
  twin's example is the planted one.

## Not asserted, because no criterion says so

A breaker's or RCD's reset by `reset_by` beyond criterion 5's breaker; the 0.01 s floor (no criterion's residual
reaches 20 times a rating); a set value that isn't finite; a set value from an f64 own array; `p_rated` and `v` set;
the changeovers' `i`; the transformer's `on`, polarity and `v` on its secondary's nodes (only their difference); the
constants' place and sources in the pack; `deep_kinds`' listing; the built table's bytes; the caps' refusals; other
refusals at check; circuit@1's own behavior (#1181's suite holds it).

## What the implementer adds outside this folder

- `scripts/lanes-lists.mjs`: `timed.push('tests/acceptance/3604/ac15-budget.test.ts')` (it calls judgeLimit). The
  folder is already alone by `lane.json`.
- The first-party pack with circuit@2's entry, its reference library, its fixtures (`stair` among them, and one each
  planted library fails, #416), its planted libraries named in `plants`, its twins and their examples, with the
  design's As built.

## Files

- `circuits.ts`: the fixtures and the values worked by hand. `model.ts`: the constants, the closed forms, the count
  and a nodal solve with ideal transformers. `programs.ts`: circuit.state@2's layout and the programs' text and
  tallies.
- `helpers.ts`: the first-party pack's reader, pieces, the `plants` pack, the tallies' reader; `playback`'s and the
  judge's readers re-exported from #1181's. `show.ts`: criterion 14's document.
- `hours`, `ac02-overload`, `ac03-short`, `ac04-curves`, `ac05-reset`, `ac06-rcd`, `ac07-leak`, `ac08-stair`,
  `ac09-own-array`, `ac10-dimmer`, `ac11-set`, `ac12-doorbell`, `ac13-hosts`, `ac14-readout`, `ac15-budget`,
  `ac16-kit` (`.test.ts`).
- `lane.json`, `twins.json`, `tsconfig.json`, `BASE-FAILURE.txt`.

## Checked before the base run

Scratch scripts (outside the checkout, deleted) held this suite's own numbers to first principles: the criterion IDs
from the issue's text; every figure above from the issue's constants, by the closed forms and step by step (the
Euler form too, within one step of each); `model.ts`' nodal solve on the board, the doorbell, the hour and the leak,
each held to kcl and the power balance; the board's counts (64 nodes, 128 parts, 8, 2, 4, 1), every node used and
every named node there; the tracks' steps. The type-check ran clean. The programs' text was generated (a scratch
vitest file under `target/blind-3604/`, deleted) and read by hand against the layout: each array's offset, the
state's head (1,176 bytes for the hour, 328 for the switch on `run[0]`), the tallies' and own arrays' addresses.

Not checked: anything of the implementation (none exists); the programs assembled by #416's assembler and run
against a stand-in, and the suite's run on the base, which waited an hour behind other sessions' test grants and were
stopped (BASE-FAILURE.txt); Chrome; deep-show drawing the readout; the timing.
