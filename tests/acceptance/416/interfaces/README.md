# Acceptance tests for #416: library interfaces (criteria 1 to 4, and 7's interface half)

Written first, from issue #416 (live, `gh issue view 416 --repo windoliver/deepbuild`), the design sections it names
and the base commit `3c124dee5`, by a job that never saw an implementation; none existed, and no other branch,
worktree, pull request, plan or session was read. Another blind job writes `../layouts/` (criteria 5 and 6, and
criterion 7's layout half) at the same time; nothing here touches it. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue: its Scope, Fields, seven acceptance criteria and Proof line ("The three interfaces with their fixtures,
  the planted libraries refused, deep_kinds' reply, and the INCONCLUSIVE claim beside the counted one").
- `docs/canvas-primitives.md`: Logic: library interfaces, Logic: linked libraries, Logic: sandbox, Logic `logic@1`,
  Logic: checkpoints and bake, Logic: data layouts, Physics: behavior kit (the slide: v² ÷ 2μg, geometric 3.186 m,
  average 2.548 m, within 3%, g = 9.81 m/s² at 120 Hz and 4 substeps; "Friction combines by the geometric mean by
  default ... and every world declares it"), Pack, Pack: programs, Pack: kind rules and the kind kit, Registry and
  seal (registries, runtime digest). `docs/technical-design.md`: The logic module (Linked libraries, Library
  interfaces, Data layouts), the canvas modules paragraph on registries, Dogfooding. AGENTS.md.
- The oracle page, `doneright/oracles/issues/416.md` in DeepBuildAI/deepbuild (branch `doneright`), and the copy of
  the WebAssembly core tests' `float_exprs.wast` it pins at `fffc6e12fa`. Criterion 1's upstream tests (an upstream
  physics engine's combine-rule unit tests) back the formula only and are not ported: the slide's answers are worked
  here from v² ÷ 2μg.
- At the base, for the surfaces used: `tests/acceptance/190/` (its README, helpers, programs, libs, assembler; the
  calls `check`, `bake`, `query`, `pack_check`, `claim`, `web_plan`, `web_runner`, `view`, `frame`), #531's and #532's
  READMEs (the deep-logic protocol), `crates/deep-logic/src/{lib.rs,links.rs,fixtures.rs,bake.rs,piece.rs,piece/checks.rs}`,
  `crates/deep-canvas-sandbox/src/{link.rs,layouts.rs}`, `crates/deep-canvas/src/canon.rs` (the d1 digest),
  `crates/deep-show/src/{sandbox.rs,hub.rs}` (vet_libs, install_pack), `scripts/proof-change.mjs`, `scripts/lanes.mjs`.

At the base nothing reads `implements` or `interfaces`: a pack's entry with them is linked as #190 links it, by the
library's own name, and an import `lib:<name>@<major>` resolves to nothing. There is no `first_party` call, no
interface record in a receipt and no `interface` on a claim (`BASE-FAILURE.txt`).

## Run them

```sh
npm ci && npm run build --workspaces                                 # once, in a fresh worktree
docker pull --platform linux/amd64 rust:1.99.1-slim-bookworm         # once: the Linux x86_64 host
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/416/interfaces --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/416/interfaces/tsconfig.json
rm -rf tests/acceptance/416/interfaces/node_modules
```

What a run builds, honoring `CARGO_TARGET_DIR`: `deep-logic` for this host and for Linux x86_64 in `docker run
--platform linux/amd64` with `rust:<rust-toolchain.toml's channel>-slim-bookworm` (criterion 3 and the oracle), with
#190's helpers (`../../190/helpers.ts`, imported unchanged); and `deep-logic` at the merge base (criterion 7) with
this suite's `baseBin` (helpers.ts): `git merge-base HEAD origin/main`, as the repo's scripts take it, exported with
`git archive` and built into `target/acceptance-416-base`. #190's `baseBin` takes the local `main`, which can lag: in
this worktree it is 998 commits behind HEAD, from before #190's links, and criterion 7's piece links a library.
Headless Chrome runs the web runner (criterion 3 and the oracle). Every test passes #190's 90-minute timeout; a whole
run is about two to three hours on the reference Mac under load, most of it the Linux build under emulation (each file
builds what it needs once; cargo's caches make later builds no-ops).

**The assembler** is #190's (`../../190/wat/src/main.rs`, used in place) under this folder's `wat/Cargo.toml` and
`wat/Cargo.lock` (`wat.ts`). #190's own `assemble` reads BLOCKED on this base: its lockfile's `[[patch.unused]]`
list predates patches the checkout's `.cargo/config.toml` has since gained, so `cargo build --locked` there wants to
rewrite it. Cargo reads `.cargo/config.toml` from its working directory's ancestors, so this suite builds the assembler
with `--locked --manifest-path` from the system's temporary folder, under rust-toolchain.toml's channel
(`RUSTUP_TOOLCHAIN`), into `target/acceptance-416-wat`: no `[patch]` of the checkout's applies, today's or a later one,
and the lockfile holds none. Nothing of #190's that assembles is called here.

Gates: a missing host is `BLOCKED:` (a failed test, never a pass), as in #190's suite: criteria 3 and 7 and the oracle
need macOS arm64 ("the reference Mac"); the Linux leg needs Docker, the linux/amd64 image and amd64 emulation; Chrome
is `CHROME_BIN` or the usual paths. Each test calls first what the base lacks, so the base fails fast. **`scripts/lanes.mjs`
pushes this folder to `alone`**: its files build deep-logic here, at the merge base and in Docker, start Chrome, and
time checks and frames. "In the local preflight" (criterion 7) isn't something a test can see: it reads as this suite
run on the reference Mac.

## The surface

The issue and the design name interfaces, `implements`, fixtures with tolerances and answers, planted libraries,
`lib.interface@1`'s binding rule, claims, swaps, receipts and deep_query, but no command line. As in #190's suite, the
surface is `deep-logic` (#531's, #532's and #190's JSON-lines protocol, which stays as their READMEs define it), and
**every call, field, rule, refusal field, fixture name, export and planted name below that the issue or the design
doesn't give is this job's invention**: the smallest the criteria need, in the design's spellings where it has them.

### Packs, interfaces and first-party packs

```text
Pack       = #190's {"name", "version", "origin", "libs"} plus "interfaces"?: {"<name>@<major>": Interface}
             origin: "first_party" (only as first_party lists it) | "installed" | "agent" (#190's)
LibEntry   = #190's {"asset", "exports", "fixtures", "needs"?} plus "implements"?: [interface name]
Interface  = {"exports": [{"name", "params": [type], "results": [type]}], "layout"?: "<name>@<version>",
              "fixtures": [asset ID], "planted": [asset ID], "digest": d1 digest}      type: "i32" | "i64" | "f32" | "f64"
```

- **`{"call": "first_party"}`** → `{"ok": true, "packs": [Pack], "assets": {sha256: base64}}`: the first-party packs
  this build ships, each `origin: "first_party"`, and every asset they name (interface fixtures and the programs and
  data assets those name, planted libraries). They declare `physics2d.lib@1`, `fsm@1` and `nn.mlp@1` (the issue puts
  them in one pack; the tests find each by name, whatever pack holds it), each with fixtures and at least one planted
  library.
- **First-party packs are always installed**: every piece, check, bake, plan, claim and pack check sees them, and a
  piece's `packs` lists only outside packs (`installed`, `agent`); their assets come from the build (a piece may carry
  them too).
- **Names** (Registry and seal: registries): a first-party pack's interface is its bare name, `fsm@1`; an outside
  pack's is `<pack name>.<name>@<major>` (its registry name), whatever name the pack declares, a first-party one
  included: pack `mine` declaring `fsm@1` holds `mine.fsm@1`. `implements` names interfaces by these names.
- **Digest**: the design's, covering the exports, the layout and the fixtures. This suite never computes one: an
  outside interface here copies a first-party interface's entry with its digest.

### Interface fixtures, imports and links

```text
Interface fixture = the asset's bytes, UTF-8 JSON:
  {"name": string, "item": {"kind": "logic@1", "params": LogicParams with no links}, "controls"?: {<control ID>: control},
   "track": [Entry], "steps": n, "expect": {"arrays": {"<step>": {<write name>: [value]}},
   "tolerance": "exact" | {"abs"?: number, "rel"?: number}}, "answer": string}
```

- **A program imports an interface's export as `lib:<name>@<major>.<export>`**, the interface's name as its declaring
  pack declares it (`lib:fsm@1.step`, also for `mine.fsm@1`). The linker resolves it to the item's one linked
  library whose `implements` names an interface declared under that name; `<export>` is one of its `exports`.
  `lib:<name>.<function>` (no `@`) stays #190's import of a library by its own name.
- **Running an interface fixture on a library**: as #190 runs a library's fixture: a piece of seed 0 whose one item,
  `fixture`, is the fixture's item with that library as its one link (and what its needs reach), the fixture's
  `controls` as the piece's, on its track for `steps` steps, with logic.determinism's comparisons. An element passes
  `exact` as #190's fixtures compare; `{rel}` within rel × |expected| of it; `{abs}` within abs.
- **Linking**: a library whose entry names `implements` links only once every fixture of each interface it names has
  passed on it on this core, besides its own fixtures (#190's rule, unchanged), each interface's run once per library
  hash and interface digest in a process. A failure refuses the link: `link_refused` at check, bake, plan and golden.
- **Receipts**: #190's LibRecord gains `"interfaces": [{"interface": name as implements gives it, "fixtures":
  [FixtureRun]}]` (#190's FixtureRun: `fixture`, `verdict`, `ran`, `ns`, `deep_hashes`); `[]` for a library that
  implements nothing. `ran` is true at the check that ran them, false after; `ns` is that run's time.
- **Refusal of an interface fixture's failure**: `{"rule", "what", "interface", "library", "fixture" (asset ID),
  "step", "array", "index", "expected", "actual", "tolerance"}`: the first difference, as #190 names one (the earliest
  step, the first array in the fixture's order, its first element), with the fixture's tolerance.
- **`pack_check`** (#190's call) also runs each interface's fixtures on each of its planted libraries, linked as the
  library under test with the interface's export names as its exports; an interface one of whose planted libraries
  passes every fixture refuses the pack (`pack_refused`), naming it: `{"rule", "what", "interface" (declared or
  registry name), "planted": asset ID}`.
- **`{"call": "claim", "piece", "library": "<name>@<version>", "interface": "<interface name>"}`** →
  `{"ok": true, "verdict": "PASS" | "FAIL" | "INCONCLUSIVE", "asks": [{"kind": "approval", "interface", "why"}]}`:
  the claim "this library implements this interface", decided from the interface's fixtures run on the library, as the
  piece's packs carry both: FAIL when one fails; PASS when they pass and the interface is a first-party pack's (binds
  all); INCONCLUSIVE with exactly one approval ask naming the interface when it comes from an outside pack the working
  agent wrote (binds author), as its own checks do.
- **Planted** (`deep-logic --planted <name>`, as #190's): `outside_interface_binds_all`: the resolver gives an outside
  pack's interface a first-party pack's binding, so it binds every claim.

### physics2d.lib@1

Axis-aligned boxes that never rotate and never touch each other, over flat ground (the line y = 0), y up, SI units.
The world lives in 8,192 bytes of the caller's memory at `w`, laid out as the library likes; at most 64 bodies.

| Export | Signature | Does |
|---|---|---|
| `world` | (w i32, gravity f64, substeps i32, ground_friction f64) | starts an empty world: gravity in m/s² toward −y, each step cut into `substeps` equal substeps, the ground's friction coefficient |
| `body` | (w i32, x f64, y f64, half_w f64, half_h f64, vx f64, vy f64, friction f64) → i32 | adds a box: centre (m), half extents (m), velocity (m/s), friction coefficient; returns its index 0, 1, … in order, or −1 past 64 |
| `step` | (w i32, dt f64) | advances every body dt seconds |
| `x`, `y` | (w i32, b i32) → f64 | body b's centre |

Each substep of h = dt ÷ substeps: gravity takes g·h off vy; a body whose bottom (y − half_h) is at or below the
ground while it moves down meets it: the ground stops its downward motion (an impulse per unit mass jn = −vy, then
vy = 0) and friction takes at most μ·jn off its sideways speed, never reversing it, with μ = √(friction ×
ground_friction), the geometric mean (the behavior kit's default rule); then the body moves by its velocity × h, and a
bottom left below the ground is set on it. A library integrates as it likes within this; the fixtures hold it to the
kit's answers within their tolerances (this suite's does semi-implicit Euler in the order above).

The tests read of the first-party pack: physics2d.lib@1's exports are exactly these; a fixture named `slide` (the
kit's box from 5 m/s with friction 0.2 against the ground's 0.8, g = 9.81 m/s², 120 Hz, 4 substeps) whose item writes
`distance` (f64, one value: the box's x less its starting x) and which expects `distance`, at its last listed step,
a step after the box has stopped, as 3.186 (or v² ÷ 2μg unrounded), tolerance `{"rel": 0.03}`; and a planted library.

### fsm@1

A table-driven state machine whose timers count steps. The machine lives in 16 bytes of the caller's memory at `m`,
laid out as the library likes; the table is at `table`.

| Export | Signature | Does |
|---|---|---|
| `start` | (m i32, table i32, s i32, k i64) | the machine enters state s at step k |
| `step` | (m i32, table i32, k i64, e i32) → i32 | the machine at step k: first every timer due, then event e (−1: none); returns its state |

The table, little-endian i32s: S (states), E (events); then next[s][e] for s = 0..S−1, e = 0..E−1, row by row (−1: the
event leaves the state as it is); then, for each state, its timer in steps (0: none) and the state its timer enters.
Entering a state at step a arms its timer at a: with timer T > 0 the machine leaves it for that state at step a + T,
entering the next state at a + T. `step(…, k, e)` first takes, in turn, every timer whose a + T ≤ k, then, when e ≥ 0
and next[state][e] ≥ 0, enters next[state][e] at step k. So a state's timer counts from the step it was entered at,
whatever steps `step` is called at.

The tests read of the first-party pack: fsm@1's exports are exactly these; a fixture named `door` (the door: states
closed 0, opening 1, open 2; event open 0 takes closed to opening, whose 30-step timer enters open; fed open at step
10) whose item writes `state` (i32) and which expects, tolerance `"exact"`, the state at steps that include 39
(opening) and 40 (open), each the rule's; and a planted library, one of which takes the timer from the step it was
read, the first `step` call after the state was entered (so the door opens at 41).

### nn.mlp@1

A multilayer perceptron in binary32, bit for bit on every host.

| Export | Signature | Does |
|---|---|---|
| `forward` | (net i32, input i32, out i32, scratch i32) | runs the network at `net` on the n[0] inputs at `input` (binary32), writing the n[L] outputs at `out` (binary32); it may use 8 × the widest layer bytes at `scratch` |

The network, little-endian, 4-byte aligned: u32 L (weight layers, at least 1); u32 n[0], …, n[L] (sizes, input
first); then for each layer l = 1..L its n[l] × n[l−1] weights, row o holding output o's weight for each input in
order, then its n[l] biases, all binary32. Each output o of layer l starts at its bias and adds w[o][i] × x[i] for
i = 0, 1, … in order, the product rounded to binary32 and then the sum (`f32.mul`, then `f32.add`: round to nearest,
ties to even, never fused); every layer but the last keeps a sum above 0 and +0 otherwise; the last layer's sums are
the outputs.

The tests read of the first-party pack: nn.mlp@1's exports are exactly this; a fixture named `4-8-2` whose item's
`assets` are, first, a 4-8-2 network in these bytes and, second, its 4 inputs (binary32), whose item writes `out` (f64,
two values: each output widened from binary32), and which expects `out`, tolerance `"exact"`, as the network's outputs
by the rule (the interface's table), its weights such that fusing each multiply and add changes at least one output by
exactly one unit in the last place and none by more; and a planted library.

## Programs and libraries

`programs.ts` holds the WebAssembly text and works out every expected value from the rules above; `floats.ts` rounds
exactly (BigInt rationals, once per operation, binary32 or binary64); `helpers.ts` puts libraries in packs with their
own fixtures (#190's rule: each ships one, which it passes) and reads the first-party packs. All libraries keep no data
of their own.

- **`phys2d@1`** (physics2d.lib@1 by the rule above) and **`phys2d_avg@1`** (the same with μ = (friction +
  ground_friction) ÷ 2: the planted library). Own fixture: the kit's slide through a driver importing `lib:phys2d`
  (or `lib:phys2d_avg`), expecting the distance at step 239 that `slideRun` gets, operation for operation (3.1803 m and
  2.5432 m, within 0.2% of v² ÷ 2μg).
- **`fsm_table@1`** (keeps the step a timer was armed at) and **`fsm_switch@1`** (keeps the step it ends at): fsm@1
  written two ways. Own fixture: the door through a driver, every step's state by `fsmRun`. **`planted_fsm@1`** is
  the first-party fsm@1's planted library carried by this suite under that name, its own fixture the door by the
  planted (lazy) rule.
- **`mlp@1`** (nn.mlp@1) and **`mlp_fused@1`** (each weight × input added with one rounding: the product exact in
  binary64, the binary64 sum rounded to odd through TwoSum's error, then to binary32, which is the exact sum rounded
  once). Own fixture: this suite's seeded 3-5-2 network through a driver importing `lib:mlp` (`lib:mlp_fused`).
- Drivers (relocatable programs): the slide, the door (the door's table in its data, open at step 10), a network on
  its item's two data assets, and the oracle's cases; a counter (a whole module) and the layout probe.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white
space collapsed. Each test's name starts with its criterion's ID.

| ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| 1 `#416.8421965e` | `ac01-physics2d.test.ts` (2) | v² ÷ 2μg gives 3.186 m (geometric 0.4) and 2.548 m (average 0.5); physics2d.lib@1 has the exports above and its `slide` fixture expects `distance` 3.186 within `{rel: 0.03}`; phys2d@1, claiming it, links, every physics2d.lib@1 fixture PASS in its receipt, and its box lands within 3% of the expected value in the slide fixture's bake. phys2d_avg@1, claiming it, is `link_refused`, a refusal naming physics2d.lib@1, the slide fixture, the library, `distance`, 3.186, `{rel: 0.03}`, and an actual distance within 3% of 2.548. Fails: a fixture that takes its answer elsewhere, a link with interface fixtures unrun, a refusal missing a name |
| 2 `#416.cdd4134d` | `ac02-fsm.test.ts` (3) | fsm@1's exports; its `door` fixture expects, exactly, the rule's states at steps including 39 (opening) and 40 (open). fsm_table@1 links (all fsm@1 fixtures PASS) and the fixture's bake is opening at 39, open from 40. The first-party planted library, carried as planted_fsm@1, opens the door at 41 (its own fixture worked by the lazy rule, then its bake read); claiming fsm@1 it is `link_refused` naming fsm@1, the door fixture, `state`, step 40, open expected, opening found. doorlike@1.0.0, whose `door@1` copies fsm@1's exports, fixtures and digest with fsm_table@1 as its planted library, is `pack_refused` naming `door@1` (or `doorlike.door@1`) and that planted library; doorlike@1.0.1, with fsm@1's own planted library, installs. Fails: a link on fixtures unrun, a planted library that passes, a pack check that doesn't run planted libraries |
| 3 `#416.6ca0cd2d` | `ac03-nn-mlp.test.ts` (2) | nn.mlp@1's export; the `4-8-2` fixture's network and input decode, and its expected `out` equals, bit for bit, the network worked with each multiply and add rounded on its own; fused, the outputs differ in the last bit (each at most one unit, one exactly one). mlp@1 links (PASS) and the fixture's bake gives the table bit for bit on macOS arm64, Linux x86_64 (its own check and bake) and headless Chrome (`web_plan`'s request). mlp_fused@1 claiming nn.mlp@1 is `link_refused` on both native hosts, naming nn.mlp@1, the fixture, the library, `out`, the first differing index and both values; implementing nothing, linked by name on the fixture's network, it gives the fused outputs on all three hosts. Fails: a host that fuses or widens, a table worked from a library, a refusal that names no output |
| 4 `#416.9dfa9973` | `ac04-claims-swap.test.ts` (3) | The claim that fsm_table@1 (from an installed pack) implements `mine.fsm@1` (fsm@1's entry copied into mine@1.0.0, origin agent) is INCONCLUSIVE with one approval ask naming `mine.fsm@1`; implementing `fsm@1` (first party) it is PASS with no ask. Under `outside_interface_binds_all` the first is PASS and the judgement fails naming the interface. Swapping fsm_table@1 for fsm_switch@1 under the same door program (`lib:fsm@1`): the same program, linked again (another merged module), libraries `[fsm_switch@1]`; the interface fixtures run at the swap's check are exactly fsm@1's, on fsm_switch@1, PASS (nn.mlp@1's on the brain item's unchanged mlp@1 ran before and don't again); the door's bake key and deep_query's library hash change; `plain` (a counter) beside each pack version keeps its hash and bake key. Fails: an outside interface binding the agent's claim, a first-party one not counting, a swap that reruns other interfaces' fixtures or keeps the key |
| 7 `#416.0e66795c` | `ac07-budgets.test.ts` (2) | (macOS arm64) phys2d@1, fsm_table@1 and mlp@1 in one piece: each interface's fixtures run at the first check (PASS), their times summed under 5 s per interface; a second piece linking the same libraries runs none again. A piece naming no interface (`plain`, and `door` linking fsm_table@1 by name from an entry that implements nothing): no interface run in its receipts, every step's fuel the merge base's, 40 checks' median wall time over 7 alternating rounds within the merge base's + 5% + 5 ms, the median frame's `eval_ns` over 300 frames within + 5% + 20 µs. Fails: fixtures rerun per check, slow fixtures, interface work added to pieces that name none |

Test count: 2 + 3 + 2 + 3 + 2 = 12, and the oracle's 1.

### Oracle lane (criterion 3)

`oracle/no-fma.test.ts` (1): float_exprs.wast's five f32.no_fma, five f64.no_fma and five f64.no_contraction cases
(their inputs and expected results, ported as data; no upstream code). First, floats.ts shows each case's expected
result is two roundings and differs from one fused rounding. Then one program runs them on our code: each f32 case as
a one-input network (weight x, input y, bias z) through nn.mlp@1's `forward` from mlp@1, linked by the interface, each
f64 case as `f64.add(f64.mul(x, y), z)` in the program's own code, every input read from its data: on macOS arm64,
Linux x86_64 and headless Chrome every result is upstream's bits. The wrong program shown failing: the same program
linking mlp_fused@1 by name, whose f32 results are the fused ones and miss upstream's in every case. f32.wast isn't
ported (its per-operation bit tables need no interface; the oracle page lists it as context).

## Planted twins

| Name | Criterion | The wrong program |
|---|---|---|
| `phys2d_avg@1` (a library) | 1 | combines friction by the average, (0.2 + 0.8) ÷ 2 |
| fsm@1's first-party planted library | 2 | counts a state's timer from the first `step` call after it was entered |
| doorlike's `door@1` with fsm_table@1 as its planted library | 2 | a planted library that passes every fixture |
| `mlp_fused@1` (a library) | 3, oracle | each multiply and add in one rounding |
| `--planted outside_interface_binds_all` | 4 | an outside pack's interface binds every claim |

## Readings where the issue leaves a choice

- **The surface**: `deep-logic` again, because the criteria need Linux x86_64, the web runner, planted values and the
  merge base's binary; deep_query's row for a logic item is #190's `query`.
- **"A 2D physics library built under the subset"**: a relocatable object that the check admits (the merged program
  passes the subset check, or the item would be `subset_refused`). **"Lands within it"**: its distance in the slide
  fixture's own bake is within the fixture's 3% of its expected value. **"Lands at 2.548 m"**: the refusal's `actual`
  is within the kit's 3% of v² ÷ 2μg with μ = 0.5.
- **"The interface's own planted library"**: one of the first-party fsm@1's `planted`, read through `first_party`;
  "reaches open at step 41": its door, through this suite's driver, is opening at 40 and open at 41; "must fail": it
  can't link claiming fsm@1.
- **"An outside pack whose fsm-like interface ships a planted library that passes every fixture"**: fsm@1's exports,
  fixtures and digest under another name, `door@1`, with a sound fsm@1 library as its planted one; refused by
  `pack_check`, the check of a pack's version.
- **"Bit for bit"**: outputs written as f64 widened from binary32 and compared by their binary32 bits (so +0 and −0
  differ); "differs in the last bit": at least one output one unit in the last place off the table, none more.
  "On every host" for the planted library: its outputs on the fixture's network on all three hosts, and its refusal on
  the two that check (the web player checks nothing).
- **"Rests on an interface"**: a claim that names the interface; "the same interface": fsm@1's entry, copied whole
  into a pack the working agent wrote, where it is `mine.fsm@1`; the library comes from an installed pack in both claims,
  so only the interface's origin differs. "Fails, naming the interface": the test's judgement of the planted run fails
  and its message names `mine.fsm@1` (#190's pattern).
- **"Swapping one fsm@1 library for another"**: the door item's link changes from fsm_table@1 to fsm_switch@1 (a new
  pack version), its program unchanged; "reruns exactly fsm@1's fixtures": the interface fixtures that run at that
  check are fsm@1's, all of them, on the new library, and no other interface's; "a piece that links neither": `plain`,
  beside each pack version, as #190's criterion 1.
- **"An interface's fixtures run once per library hash in under 5 s"**: the receipts' `ns` of one interface's fixtures
  on one library, summed, at the first check; no rerun for a second piece in the same process. **"Compared with the
  merge base"**: the merge base with origin/main; **"gains no work"**: #190's allowances (5% + 5 ms for 40 checks,
  5% + 20 µs a frame) and equal fuel.

## Not covered, because no criterion of this job reaches it

An interface's `layout` and data layouts, deep_kinds and the registry's listing (`../layouts/`); a digest that doesn't
match its entry; an interface that ships no planted library; deep_query naming the interfaces a library implements; a
library or item whose two links implement one interface; how an installed (not agent-written) outside interface binds;
`lib.interface@1`'s declaration at the seal; crowd@1, bt@1, script.vm@1 and the other interfaces the design lists.

## Checked before the base run

Two temporary tests (deleted) held this suite's own pieces to real components before `BASE-FAILURE.txt` was run:

- **Node's WebAssembly**, every library and driver assembled as a whole module from the same text: the slide gives
  `slideRun`'s distances bit for bit (3.1803186 m under the geometric mean, the box stopped at step 153; 2.5432139 m
  averaged, step 123); both fsm@1 libraries give `fsmRun`'s door (closed to step 9, opening 10 to 39, open from 40);
  mlp@1 and mlp_fused@1 give `mlpRun`'s outputs bit for bit on 301 random networks (fused differs on 141); mlp_fused@1's
  one-input networks equal floats.ts's exact single rounding on 200,000 random triples and the five f32 no_fma cases;
  floats.ts gives every float_exprs.wast case's expected result by two roundings and another by one.
- **The base's `deep-logic`**, each library as the tests ship it (a relocatable object, 284 to 630 bytes) linked by its
  own name through #190's linker, sandbox and fixtures: all six pass their own fixtures (60 to 121 ms each) and bake
  exactly the arrays `slideRun`, `fsmRun` and `mlpRun` give; the oracle program, linked to mlp@1 or mlp_fused@1 by
  name, gives upstream's f32 and f64 bits or the fused ones; item IDs with underscores, the counter and the probe check;
  and at the base a program importing `lib:nn.mlp@1.forward` is `link_refused` naming that import.

Not checked: anything of the implementation (none exists), the Linux x86_64 and Chrome legs (they need the
implementation's first-party packs first), and the merge base's timing comparison.
