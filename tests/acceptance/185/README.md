# Acceptance tests for #185: canvas interfaces, one implementation of each sealed per build

Written first, from issue #185 ("Canvas interfaces: each canvas module implements one, and a build seals one
implementation of each": its scope, its Fields, its five acceptance criteria and its proof line), the design
sections it links, and base commit `c9225aa3` ("Merge pull request #976 … worktree-github-issue-140-0cfedc"), by
a job that never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). The issue's Oracle line says no
upstream test checks these criteria, so there is nothing to port and these tests are the local proof.

## What was read

- The issue, read live with `gh issue view 185`.
- `docs/canvas-primitives.md`: Replica `deep_drive`; Canvas module (fields, "It implements one canvas interface,
  and a build seals one implementation of each"); Canvas module: interface and implementation (the fields; "an
  array marked private is the implementation's own, read only by its owner, refused at the seal when another
  canvas module reads it, naming the array and both modules, and left out of the digest"; "An implementation whose
  registered shapes hash to anything but its interface's digest is refused at the seal, naming the interface and
  the first shape that differs"; "two of one interface in a build are refused, naming the interface and both";
  bit and measured; "an interface with no behavior part accepts only its reference and `bit` implementations"; "A
  release build refuses an implementation that hasn't passed its interface's conformance kit"; Cost "O(interfaces)
  once at startup … nothing per frame"); Registry and seal (build sets, the sealed plan at `deep://schedule/<core
  version>`, "Any failure refuses startup"); Registry and seal: runtime digest (R6, not this task); Array and table
  (`visibility: public | private = public`); Seam and backend ("Each seam is a canvas interface and each backend one
  implementation of it … the seal's one-implementation rule … cover backends"); Golden.
- `docs/technical-design.md`: Composition; The canvas core.
- At the base: `crates/deep-canvas/src/registry/mod.rs` (the manifest's `implements`, the seal's
  `two_implementations` and `private_read` refusals, `module_digest` leaving private arrays out, `SealError`),
  `crates/deep-show` (`deep-show run`, `--planted`, the `seal_refused` line, the `registry`, `schedule` and `kit`
  calls, the build-set and `test-*` features, `build.rs` embedding `DEEP_KIT_LEDGER`, `kit-ledger.json`),
  `crates/deep-canvas-seams`, `scripts/canvas-kit.mjs`, `scripts/lanes.mjs`; the earlier blind suites
  `tests/acceptance/305/` (builds per feature set, the refusal line, `registry.seal`, the budgets pattern),
  `388/` (build sets), `138/` (the kit, its ledger and the release gate) and `140/` (seams, the merge-base build).

What the base already does and these tests don't credit: each shipped canvas module's manifest carries
`implements: "<name>@1"`; the seal refuses two modules with one `implements` (`two_implementations`, naming the two
modules) and a read of another module's private array (`private_read`, naming the two modules); a module's digest
leaves out its private arrays. There is no interface record (digest, reference, kit, behavior part), no
implementation record (name, version, pins, equivalence, state), no refusal of a module whose shapes miss its
interface's digest, no `interface` or `implementations` on a refusal, no interfaces in the published plan, no
behavior part in the kit, and none of this suite's test features.

## Run them

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/185 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/185/tsconfig.json
```

Every file builds each feature set it uses once (`cargo build --locked --bin deep-show --no-default-features
--features <set>[,<test feature>…]`, honoring `CARGO_TARGET_DIR`), copies the binary out under its own name, and
fails each test that uses a build that failed. `kit.test.ts` also makes two release builds (`--release`, with
`DEEP_KIT_LEDGER` naming the ledger the kit just wrote, #138), so it is slow. Each test opens an evidence store
root in a temporary folder and deletes it; ledgers go to a temporary folder too. Node built-ins and vitest only.

`scripts/lanes.mjs` needs `'tests/acceptance/185/'` added to its `alone` list (the files build cargo binaries and
`budgets.test.ts` times the seal), which also takes the folder off the parallel line; that is how "in the local
preflight" reaches these builds. This README is the instruction; the implementer makes that edit.

Gates: `budgets.test.ts`'s startup timing runs only on a reference Mac (Mac15,7 or Mac15,12) on mains power,
Low Power Mode off, thermal state nominal and a 1-minute load at most the core count; elsewhere it skips as
INCONCLUSIVE after its structural checks, and a reading between the limit and the margin also skips as
INCONCLUSIVE. It never passes by skipping. It builds the merge base (`git merge-base HEAD origin/main`) exported
by `git archive` into `target/acceptance-185-base/<sha>/` (kept so later runs build warm) with its own target
folder. The GPU-seam test in `shipped.test.ts` runs only on macOS (the backends are macOS backends) and skips as
INCONCLUSIVE elsewhere.

`BASE-FAILURE.txt` is the run at the base.

## The surface under test

Everything is `deep-show run` as #393, #305, #388 and #138 left it: JSON lines in, one reply per call, the
`registry`, `schedule` and `kit` calls, the startup `--planted <name>` argument (an unknown name answers
`bad_input`, exit 2), the build-set features `core`, `r1`, `r2`, `full`, test canvas modules behind `test-*`
features, and the `seal_refused` startup line with exit 2. These tests add what follows. **Bold** names are names
this suite chooses (the issue leaves them open); the implementer provides them as written.

### Names this suite chooses

| Name | What it is |
|---|---|
| **`test.sim@1`** | the test interface (the issue's name) |
| **`test.sim`** | the canvas module name both implementations register under, so their arrays are named `test.sim.*` and their shapes can hash alike |
| **`test.sim.a`** | implementation A: `equivalence: bit`, `state: canonical`, test.sim@1's `reference` |
| **`test.sim.b`** | implementation B: `equivalence: measured`, `state: backend_bytes` |
| **`test.sim.pos`** | B's (and A's) one public array, type `f32` |
| **`test.sim.scratch`** | B's array marked private (`visibility: "private"`) |
| **`test.sim.pos2`**, **`test.sim.scratch2`** | the renamed public and private arrays |
| **`test.c`** | test module c (implementing its own interface), which reads `test.sim.scratch` |
| **`seam.gpu@1`** | the GPU seam's interface (the issue's name) |

**Test features of `deep-show`** (each in no shipped build; each `test-sim-b-*` feature is B with one change and is
built without `test-sim-b`):

| Feature | The test canvas module(s) |
|---|---|
| **`test-sim-a`** | A |
| **`test-sim-b`** | B |
| **`test-sim-b-f64`** | B with `test.sim.pos` registered as `f64` |
| **`test-sim-b-private-renamed`** | B with `test.sim.scratch` renamed `test.sim.scratch2` (still private) |
| **`test-sim-b-public-renamed`** | B with `test.sim.pos` renamed `test.sim.pos2` (still public) |
| **`test-sim-b-false-bit`** | planted: B declaring `equivalence: bit` while one kit fixture's `test.sim.pos` differs from A's |
| **`test-sim-b-off`** | planted: B (measured) landing 2% off the behavior answer whose tolerance is 1% |
| **`test-sim-behavior`** | gives test.sim@1 its behavior part: three fixtures with analytic answers and tolerances, at least one answer with a 1% tolerance |
| **`test-sim-c`** | test module `test.c`, depending on `test.sim` and reading `test.sim.scratch` |
| **`test-gpu-second-backend`** | a second macOS GPU backend implementing `seam.gpu@1` beside the shipped one |

**Planted startup argument**: **`--planted digest_hashes_private`**, the digest that hashes private arrays too
(criterion 5's wrong program), beside #305's and #388's.

### The startup refusal

#305's line gains two fields where an interface is involved:

```json
{"ok": false, "code": "seal_refused", "reason", "modules", "arrays", "operators", "what",
 "interface"?: "name@major", "implementations"?: [implementation name]}
```

Reasons these tests read: **`two_implementations`** (the base's word) with `interface` and both implementations in
`implementations`; **`interface_digest`**, new, an implementation whose shapes hash to anything but its interface's
digest, with `interface` and the first shape that differs in `arrays` when it is an array; **`private_read`** (the
base's word) with the private array in `arrays` and both the reader and the owner's implementation named in
`modules` or `implementations` (for c and B: `test.c` and `test.sim.b`). A release build's refusal of an
implementation its interface's kit doesn't admit carries `interface`; its reason isn't read.

### `deep://schedule`: the `schedule` reply's `interfaces`

The published plan (`{"call": "schedule"}`, `uri: deep://schedule/<core version>`) gains, per the issue's scope
("deep://schedule names each interface with its digest and the implementation the build chose") and Fields:

```json
"interfaces": {"<name@major>": {
  "digest": d1 digest, "reference": implementation name, "kit": [part], "behavior": part | "none",
  "module": canvas module name,
  "implementation": {"name", "version": semver, "pins": {crate → {"version", "features": [string]}},
                     "equivalence": "bit" | "measured", "state": "canonical" | "backend_bytes"}}}
```

One entry per interface in the sealed set; `module` is the canvas module implementing it; a `behavior` other than
`"none"` is also in `kit`. An interface's `digest` equals its module's digest in `registry.digests` (Canvas module:
"digest: d1 digest (of its registered shapes: its interface's digest)"). The committed schedule snapshots change
with it; that is the implementer's to update.

### `registry` additions

- `arrays[name].visibility: "public" | "private"` (Array and table's field).
- `seal.interfaces: {"ms", "runs"}`: the time the seal spent in its interface checks (inside `seal.ms`) and how
  many times they have run in this process.

### The kit's behavior part

`kit` (#138) runs an interface's behavior part on its implementation as a part named by the interface's `behavior`
(e.g. **`behavior`**), one case per behavior fixture: `{"case", "verdict", "fixture", "answers": [{"answer":
string, "expected": number, "got": number, "tolerance": number}]}`, `tolerance` relative (0.01 is 1%). A failure
there names `fixture`, `answer` and `tolerance` (with `expected` and `got`). A `bit` implementation whose hash
differs from the reference's on a kit fixture fails with a failure naming `fixture` and `field` (the first field
that differs; for the planted B it lies in `test.sim.pos`), in whichever part compares them. The tests read
failures from the module, its parts and their cases' `failure`.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace collapsed and the
leading `- [ ] ` dropped (#305's command, over the live issue's criterion lines). Each test's name starts with its
criterion's ID.

**`#185.f6c38595`** — "Two test implementations of a test interface test.sim@1, A (bit and canonical, the
reference) and B (measured with backend_bytes state), each seal alone in a test build with the same interface
digest; a build with both is refused at startup, naming test.sim@1, A and B; and a B whose one registered array
changes type from f32 to f64 is refused at the seal, naming test.sim@1 and that array, though the same B with the
array unchanged seals"

`implementations.test.ts` (3):
1. `core,test-sim-a` and `core,test-sim-b` each seal; the plan names `test.sim@1` with A (bit, canonical) and B
   (measured, backend_bytes), A the reference in both, the same digest, equal to `registry.digests["test.sim"]`.
   Wrong programs: a digest that covers the implementation's manifest (two digests); an interface record that
   doesn't follow the build's choice.
2. `core,test-sim-a,test-sim-b` exits 2, `two_implementations`, `interface: "test.sim@1"`, implementations
   `["test.sim.a", "test.sim.b"]`. Wrong programs: a build that starts with both; a refusal that names the modules
   but not the interface (the base's).
3. `core,test-sim-b-f64` exits 2, `interface_digest`, `test.sim@1`, `arrays: ["test.sim.pos"]`; `core,test-sim-b`
   seals with `test.sim.pos` as `f32`. Wrong programs: a seal that never compares shapes with the interface's digest
   (the f64 B starts); one that refuses every B (the unchanged B is refused).

**`#185.da9aab76`** — "While test.sim@1 holds no behavior part, a release build refuses B, declared measured,
naming the interface; with a behavior part of three fixtures with analytic answers and tolerances, B passes and
seals; a planted B that declares bit while one kit fixture's hash differs from A's fails the kit, naming the
fixture and the first field; and a planted B that lands 2% off an answer whose tolerance is 1% fails, naming the
fixture, the answer and the tolerance"

`kit.test.ts` (4):
1. `core,test-sim-b`: the plan shows B measured and `behavior: "none"`; the kit over the build writes a ledger; the
   release build embedding it exits 2 with `interface: "test.sim@1"`. Wrong program: an interface with no behavior
   part that admits a measured implementation (the release build starts).
2. `core,test-sim-b,test-sim-behavior`: `behavior` names a kit part; the kit runs it on B with three fixtures, every
   answer within its tolerance by the reply's own numbers, the part and B PASS; the release build embedding that
   ledger seals with B chosen. Wrong programs: a behavior part with fewer fixtures or none; a release gate that
   refuses B anyway.
3. `core,test-sim-b-false-bit`: B declares bit; the kit over `test.sim` FAILs with a failure naming a fixture the
   kit ran and a `field` in `test.sim.pos`. Wrong program: a kit that takes bit on trust and never compares B's
   hashes with A's.
4. `core,test-sim-b-off,test-sim-behavior`: the kit FAILs B in the behavior part, with a failure naming a behavior
   fixture, one of its answers and `tolerance: 0.01`; that case lists the answer 1.5%–2.5% off and fails. Wrong
   programs: a kit that doesn't compare answers, or compares them against a wider tolerance than the interface's.

**`#185.2a8a1971`** — "Every canvas module the R2 build holds here names its interface and implementation, and
that set seals: those the canvas modules task (#137) lays out, scene3d's Map's 3D and effects' shipped operators
(#64), and cells (#95); and a test build with two GPU backends for macOS, two implementations of seam.gpu@1, is
refused at the seal, naming the interface"

`shipped.test.ts` (2):
1. `r2` seals and holds at least cells, data, effects, graph, look, marks2d, motion, record, scene3d, sheet and
   text; every module it holds is the `module` of exactly one interface in the plan, whose implementation has a
   name, a semver version and pins, is its interface's reference, is bit and canonical, and whose digest is the
   module's. Wrong programs: a shipped module with no interface or implementation named; a shipped module declared
   measured; a published digest that isn't the module's.
2. macOS only: `core,test-gpu-second-backend` exits 2, `two_implementations`, `interface: "seam.gpu@1"`, two
   implementations named. Wrong program: seam backends outside the one-implementation rule (the build starts).

**`#185.5d087cb0`** — "Budgets, on the reference Mac in the local preflight, compared with the merge base: the
seal's interface checks add under 5 ms at startup; and nothing runs per frame"

`budgets.test.ts` (2):
1. The R2 build's `seal.interfaces` ran once and within `seal.ms`; then, on a fit reference Mac, five fresh
   processes after a warm-up here and on the merge base: each `seal.ms` here within the merge base's median plus
   5 ms, and each `seal.interfaces.ms` under 5 ms, judged by the design's rule. Wrong program: interface checks
   that cost more than 5 ms at startup (FAIL), or that the reply can't time.
2. Six frames at six times between two `registry` calls: `seal.runs` and `seal.interfaces.runs` stay 1 and both
   times unchanged. Wrong program: interface checks run per frame (or per document).

**`#185.ade96791`** — "A test implementation B of test.sim@1 that renames one of its arrays marked private seals
with test.sim@1's digest unchanged, while the same rename of a public array is refused at the seal, naming
test.sim@1 and the array; a test module c that reads B's private array is refused at the seal, naming the array, B
and c; and a planted digest that hashes private arrays refuses the first B and fails this, naming the array"

`private.test.ts` (4):
1. `core,test-sim-b` registers `test.sim.scratch` private; `core,test-sim-b-private-renamed` seals, registers
   `test.sim.scratch2` private and not `test.sim.scratch`, chooses B, and test.sim@1's digest and the module's are
   unchanged. Wrong program: a digest over private arrays (refused, or another digest).
2. `core,test-sim-b-public-renamed` exits 2, `interface_digest`, `test.sim@1`, naming `test.sim.pos` or
   `test.sim.pos2`. Wrong program: a digest that leaves public arrays out too, or a seal that doesn't compare.
3. `core,test-sim-b,test-sim-c` exits 2, `private_read`, `arrays: ["test.sim.scratch"]`, naming `test.c` and
   `test.sim.b`. Wrong programs: a private read admitted; a refusal that names the module but not B (the base's
   names `test.sim`, which A and B share).
4. `--planted digest_hashes_private` on `core,test-sim-b-private-renamed` exits 2 naming `test.sim@1` and the
   private array (old or new name): the planted digest refuses the first B, so test 1 fails on it. Wrong program: a
   planted twin that doesn't hash private arrays (it starts).

Test count: 3 + 4 + 2 + 2 + 4 = 15.

## Readings where the issue leaves a choice

- **"Names the interface"** is a field of its own on the refusal line, `interface`, since the base's refusal carries
  only modules and arrays and an interface name isn't a module. "A and B" are implementation names, in
  `implementations`. Wording (`what`) is never read.
- **One canvas module name for A and B.** Arrays are named `module.x` for their owner (the base's rule), and A and
  B must hash to one digest over their public arrays, so both register as the canvas module `test.sim` and differ by
  implementation name. A different layout that still names these arrays and implementations passes as well.
- **"The first shape that differs"** for an array is that array in `arrays`. For a public rename either name is
  accepted: the interface's (missing) or the implementation's (unknown).
- **"A release build refuses B … naming the interface"** reads the release gate #138 built (the ledger embedded at
  build time), on a ledger the kit wrote over the same features with 100 patch sequences and 50 param sets per
  module (fewer than the kit's defaults, so the suite runs in minutes; the behavior and bit comparisons don't
  depend on them). Whether the refusal comes from the kit's verdict or the seal's own rule is the implementer's.
- **"Hash differs from A's"** is compared by the kit in a build that holds B alone, since a build can't hold both;
  where A's hashes come from (the interface's record, a committed reference run) is the implementer's.
- **Tolerances** are relative: "2% off an answer whose tolerance is 1%".
- **"Every canvas module the R2 build holds here"** is `registry.modules` of the `r2` build, at least the eleven the
  criterion names; vector (#94) isn't in this repo yet and isn't required. "Bit and canonical" for every one
  follows the scope ("the physics module declares itself measured …, and every other shipped module bit and
  canonical"); physics isn't in R2.
- **"Adds under 5 ms … compared with the merge base"** is the seal's startup time against the merge base's median
  plus 5 ms, and the interface checks' own time under 5 ms; the merge base is built from `git archive`, so an
  uncommitted implementation is still compared.
- **"Nothing runs per frame"** is a count, so it runs on every machine.

## Not tested, because no criterion asks

`deep_kinds` listing interfaces (#135); the runtime digest and the trial (#97, #191); each shipped module's own
kit and planted wrong implementation (their tasks); seam interfaces in the published plan beside canvas modules;
the full `pins` contents of shipped modules beyond their shape; `Composition`'s use/provider wiring (the hub's, not
the canvas's).
