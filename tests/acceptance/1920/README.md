# Acceptance tests for #1920: the physics@1 seal and the runtime digest that keeps two backends' evidence apart

Written first, from issue #1920 (its Scope, its Fields for "Registry and seal: runtime digest", its two acceptance
criteria and its Proof line: "The runtime digest of two test implementations, with its planted twins"), its parent
#521 for what the sibling parts own, its Oracle page, the design sections it names and base commit `f28d8777`
("Merge pull request #2229 …"), by a job that never saw an implementation; none existed, and no other worktree,
branch or pull request was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes
to a blind redraft of this job (design: Dogfooding).

The Oracle page says no upstream test checks either criterion ("Our module's interface, queries, seal and output
rules; no upstream test checks them against our documents"), so there is nothing to port and no
`tests/acceptance/1920-oracle/` folder: these tests are the local proof.

## What was read

- The issue body, the parent issue #521 and the Oracle page, as handed to this job.
- `docs/canvas-primitives.md`: Canvas module; Canvas module: interface and implementation; Registry and seal;
  Registry and seal: runtime digest; Seam and backend; World and backend `physics.world@1` ("Rapier is the reference
  implementation of the physics interface, `physics@1`, declared `measured` with `backend_bytes` state"); Bake;
  Golden; Physics: behavior kit; Logic: saves and Logic: saves across changes (for what carries the digest).
- `docs/technical-design.md`: The canvas core, "Canvas modules."; The physics module; One canonical form before any
  hash (a `d1` digest is taken over RFC 8785 bytes); Criteria to tests, both ways; Criteria in a checked shape; Wrong
  programs; Dogfooding; Built to be hard to get wrong. AGENTS.md.
- At the base, for surfaces and conventions: the suites `tests/acceptance/185/` (README, helpers, the
  implementations and kit tests: the model for this one, with `deep-show` built per feature set, `schedule`'s
  `interfaces`, `--planted` and the test implementations A and B), `238/` (README: `test-sandbox-alt` and
  `digest_covers_pins`), `387/` (README: the `registry`, `fixtures` and `eval` calls), `388/` and `138/` (READMEs: the
  committed schedule snapshots, the kit's parts and its manifest), `305/` (README: `--planted`), `2010/` (README and
  helpers: `deep-physics`, its `runtime` call and its planted lockfile), `2009/`, `2012/` and `532/` (in part); the
  crates `deep-canvas` (`registry/mod.rs`, `canon.rs`), `deep-canvas-test-modules` (`sim.rs`), `deep-show`
  (`Cargo.toml`, `main.rs`, `frames.rs`, `kit/interface.rs`, `schedule/*.json`), `deep-canvas-physics` (README,
  `bake.rs`), `deep-physics-rapier` (`Cargo.toml`, `build.rs`, `lib.rs`, `runner.rs`, `main.rs`),
  `deep-canvas-sandbox` (`module.rs`) and `deep-logic` (the golden's own digest in `lib.rs`);
  `scripts/proof-change.mjs`, `scripts/lanes.mjs`, `scripts/throttle.mjs`. The base's own binaries (`full`,
  `core,test-sim-a`, `core,test-sim-b`, `deep-physics`) were run to read their replies.

What the base already does, which these tests don't credit: `deep-show run` with its `registry`, `schedule`,
`fixtures`, `deep_show` and `eval` calls; the plan's `set_digest` and `interfaces` (#185), every shipped
implementation bit and canonical; the test builds `core,test-sim-a` and `core,test-sim-b`, with B measured, keeping
backend bytes and pinning `test-sim-backend` 1.0.0 with the feature `f32`; the startup `--planted <name>`, an unknown
name answering `bad_input` with exit 2. The physics crates exist with no manifest and no `module()`, and no build
registers them; `deep-physics`'s `runtime` call answers a digest its own crate computes. The base has no physics
module in any build set, no `runtime_digest` in the published plan, none of this suite's four test features and
neither of its planted names.

## Run them

```sh
npm ci                          # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/1920 --no-file-parallelism
npx tsc -p tests/acceptance/1920/tsconfig.json
rm -rf tests/acceptance/1920/node_modules          # vitest's cache
```

On a machine other sessions share, run the vitest line through the throttle, as the base run did:

```sh
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node scripts/throttle.mjs build --wait 60 -- npx vitest run --root tests/acceptance/1920 --no-file-parallelism
```

Each file builds every feature set it uses once, before its tests (`cargo build --locked --bin deep-show
--no-default-features --features <set>[,<test feature>]`, honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0`
and `CARGO_PROFILE_DEV_DEBUG=0` unless set) and copies each binary out under its own name; a test that asks for a
build that failed fails at an assertion named "the binary builds", with cargo's error. That is seven builds:
`full` and `full,test-physics-rapier-patch`; `core,test-sim-a`, `core,test-sim-b`, `core,test-sim-a-1-0-1`,
`core,test-sim-b-1-0-1` and `core,test-sim-b-pin-feature`. Without cargo on PATH each of those assertions reads
`BLOCKED:` and the test fails; nothing passes unrun. Each test opens an evidence store root in a temporary folder and
deletes it; the binaries' copies are deleted too. Node built-ins and vitest only. No test is timed, gated on a
machine or skipped.

`BASE-FAILURE.txt` is the run at the base: 8 of 8 fail, each at a named assertion.

## The surface under test

Everything is `deep-show run` as #393, #305, #387, #388 and #185 left it: one scenario of calls in as a JSON line,
one reply per call; the build-set features and test canvas modules behind `test-*` features; the startup argument
`--planted <name>`. The calls these tests make are `registry`, `schedule`, `fixtures`, `deep_show` and `eval`, each as
its own suite defines it. No test imports the code under test, and `deep-physics` isn't entered: its `runtime` call
answers the stand-in digest the issue says the seal's replaces, and the criteria name the seal's.

This issue adds one field to that surface, and one interface to the full set's plan:

```json
{"call": "schedule"} → {"uri": "deep://schedule/<core version>", "core", "build_set", "set_digest",
                        "runtime_digest": d1 digest,
                        "interfaces": {"<name@major>": {"digest", "reference", "kit", "behavior", "module",
                          "implementation": {"name", "version", "pins": {crate → {"version", "features": [string]}},
                                             "equivalence", "state"}}},
                        "phases", "contributions"}
```

- **`runtime_digest`**, beside `set_digest`, is the seal's runtime digest (Registry and seal: `runtime_digest: d1
  digest`): 64 lowercase hex, in every build's plan.
- In the `full` build, `registry.modules` holds **`physics`** and `interfaces` holds **`physics@1`** in #185's shape:
  `module: "physics"`, an implementation that is the interface's `reference`, `equivalence: "measured"`, `state:
  "backend_bytes"`, and `pins.rapier3d.version` naming 0.36.1 (`0.36.1` or cargo's exact form `=0.36.1`).

What the digest is over is read off the same plan, which lists every implementation with its equivalence and state,
so the plan gains no second list (Readings).

### Names this suite chooses

The issue and the design don't give these; the implementer provides them as written.

| Name | What it is |
|---|---|
| `runtime_digest` | the field of the published plan that holds the runtime digest (the design's field name) |
| `test-physics-rapier-patch` | a test feature of `deep-show`: the full set with the physics implementation's record pinning `rapier3d` at another 0.36 patch than 0.36.1, and nothing else changed. Built as `full,test-physics-rapier-patch` |
| `test-sim-b-1-0-1` | B (`test.sim.b`) with its implementation's `version` at 1.0.1 and nothing else changed. Built as `core,test-sim-b-1-0-1`, without `test-sim-b`, as #185's `test-sim-b-*` features are |
| `test-sim-b-pin-feature` | B at 1.0.0 with one pin's `features` changed (the crate and its version unchanged) and nothing else. Built as `core,test-sim-b-pin-feature` |
| `test-sim-a-1-0-1` | A (`test.sim.a`) with its implementation's `version` at 1.0.1 and nothing else changed: still bit and canonical, still test.sim@1's reference by name, the same shapes and the same results. Built as `core,test-sim-a-1-0-1`, without `test-sim-a` |
| `--planted runtime_digest_omits_physics` | AC1's planted seal: the runtime digest leaves the physics implementation out |
| `--planted runtime_digest_hashes_only_shapes` | AC2's planted seal: the runtime digest hashes only registered shapes (each interface's shape digest), never an implementation's version or pins |

Each test feature is in no shipped build. Each planted seal is reachable only through the startup argument, as
#185's `digest_hashes_private` and #238's `digest_covers_pins` are, starts and seals the builds these tests give it,
and changes nothing the plan publishes but `runtime_digest`.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white
space collapsed, computed with that code from the issue body. Each test's name starts with its criterion's ID.

| ID | File (tests) | What each test asserts |
|---|---|---|
| AC1 `#1920.d626ec86` | `ac1-physics-seal.test.ts` (4) | **1.** `full` seals (`build_set: full`, `state: sealed`) and holds the module `physics`; the plan names `physics@1` with `module: physics`, an implementation that is its reference, measured, backend_bytes, pinning `rapier3d` at 0.36.1. **2.** `full`'s `runtime_digest` is a d1 digest; the implementations its plan declares measured or backend_bytes are exactly physics@1's; and the digest is the d1 digest of that one entry, `[{interface: "physics@1", implementation, version, pins}]`, as the plan names it. **3.** `full,test-physics-rapier-patch` pins another 0.36 patch; its plan differs from `full`'s in that pin's version and the digest, nowhere else; the two digests differ, and the judge names physics@1 and its implementation as what differs; the test build's digest is over its own entry. **4.** Under `--planted runtime_digest_omits_physics` both builds seal and publish their plans unchanged but for the digest, which is one digest for both; the judge that passes the real seal's two builds fails the planted seal's, naming physics@1 and its implementation |
| AC2 `#1920.73d8b8e7` | `ac2-test-implementations.test.ts` (4) | **1.** `core,test-sim-b` holds B at 1.0.0 and `core,test-sim-b-1-0-1` B at 1.0.1, both measured and backend_bytes; their plans differ in that version and the digest only; the two digests differ, naming test.sim@1 and B; each is the d1 digest of B's entry. **2.** `core,test-sim-b-pin-feature`: exactly one of B's pins changes its features, as a set; the plans differ there and in the digest only; the two digests differ, naming B; each is over its entry. **3.** `core,test-sim-a` holds A at 1.0.0 and `core,test-sim-a-1-0-1` A at 1.0.1, both bit and canonical, A the reference; the moved build lists the same kit fixtures, and on each every `test.sim` node gives the hash the reference's build gives; the plans differ in A's version only; the digest is the same, and is the d1 digest of the empty list in both. **4.** Under `--planted runtime_digest_hashes_only_shapes` the builds with B at 1.0.0 and 1.0.1 seal, publish their plans unchanged but for the digest, and give one digest; the judge that passes the real seal's two fails the planted seal's, naming test.sim@1 and B |

Test count: 4 + 4 = 8.

## Wrong programs and traps

Three judges are computed by the tests (`helpers.ts`). Each is run, in the file that uses it, on planted input it
must fail, so a judge that passes everything can't pass the file:

- **`judgeCovers`** (one build): the implementations the plan declares measured or backend_bytes are exactly the ones
  named, and the published digest is the d1 digest of their entries.
- **`judgeFollows`** (two builds): the digest differs exactly when a measured or backend_bytes implementation's entry
  differs between the two plans, and it names the interface and implementation that differ (or, when the digest moved
  with none, the bit, canonical ones that do).
- **`judgeReferenceHashes`**: on every kit fixture, each node of the module wrote the bytes the reference's build
  wrote.

The planted input is of three kinds: the criterion's planted seal, run through `--planted`; the digest a likely
wrong seal would publish, computed in the test from the real build's own plan (`WRONG_SEALS`), so no further planted
program sits in shipped code; and, for the hashes, B's real build.

| Wrong program | The test and trap that catch it |
|---|---|
| The shipped set has no physics module (the base) | AC1 test 1: `registry.modules` and the plan's `physics@1` |
| The physics module declared bit or canonical | AC1 test 1 reads `measured` and `backend_bytes`; AC1 test 2: `judgeCovers` fails the plan with physics@1 declared bit and canonical, naming physics@1 |
| The Rapier pin off 0.36.1, or an implementation that isn't the interface's reference | AC1 test 1 |
| A digest that leaves the physics implementation out (AC1's named plant) | AC1 test 4: `--planted runtime_digest_omits_physics` gives both builds one digest and `judgeFollows` fails it, naming physics@1's implementation, while the real seal's two differ. By formula too: AC1 tests 2 and 3 |
| A digest that hashes only registered shapes (AC2's named plant) | AC2 test 4: `--planted runtime_digest_hashes_only_shapes` gives B's two versions one digest and `judgeFollows` fails it, naming B, while the real seal's two differ. By formula too: AC1 tests 2 and 3, AC2 test 1 |
| A digest that covers every implementation, so a bit, canonical one moves it | AC2 test 3: A's moved version must leave the digest alone, and `judgeFollows` fails that seal's two digests, naming A; AC1 test 2: `judgeCovers` fails that seal's digest for `full`, whose other implementations are bit and canonical (18 at the base, sandbox with its wasmtime pin among them) |
| A digest over the implementation's name but not its version or pins | AC2 test 1 (one digest for B's two versions) and test 2; AC1 tests 2 and 3 |
| A digest without the pins | AC1 test 3 (one digest for two Rapier pins) and test 2; AC2 test 2 |
| A digest that reads pins' versions but not their features | AC2 test 2: one digest for both builds, and `judgeFollows` fails it, naming B; AC1 test 2 |
| A published digest that isn't over what the plan names (the module-set digest in its place, a digest salted with the build set or the feature list, another hash or encoding) | `judgeCovers` on every real seal read: AC1 tests 2 and 3, AC2 tests 1 to 3; AC1 test 2 runs it on the plan's own `set_digest` |
| A test build that changes more than the criterion says (another pin, the module's version, a shape) | the "nowhere else" comparison of the two published plans in AC1 test 3 and AC2 tests 1 to 3 |
| A planted seal that isn't the criterion's (it changes the plan, or gives two digests) | the unchanged-plan comparison and the one-digest assertion in AC1 test 4 and AC2 test 4 |
| A build with A whose kit fixtures don't give the reference's hashes | AC2 test 3: `judgeReferenceHashes` fails B's real build, measured, whose `test.sim.step` result is a hair off A's |

Checked before these files were frozen, outside the repo: with a stand-in for the binary that answers as an
implementation would (the base's binaries with their plans rewritten), all 8 tests pass; and with each of 25 wrong
stand-ins (the rows above, a missing or upper-case digest, a digest salted with the feature list, a plant that
answers the real digest or changes the plan, test builds that change more or nothing), at least one test fails, at
the assertion that names the fault. A stand-in that lists the digest's entries in another order passes: with one
entry there is no order to see (Not tested). The stand-in is not part of the suite.

## Readings where the issue and design leave a choice

- **Where the digest is read.** "Published with the sealed plan at deep://schedule" is the `schedule` reply, the
  plan as published, in a top-level `runtime_digest` beside `set_digest`: the design's two field names side by side.
- **"Covers the physics implementation and its pins and nothing else"** is read by the design's own formula on the
  plan's own records. The plan already names each implementation with its `equivalence` and `state`, so what the
  digest must cover is every `interfaces` entry that is measured or keeps backend bytes; in `full` that is physics@1
  alone (Registry and seal: runtime digest: "every other shipped canvas module is the bit, canonical reference of its
  interface"). The digest must then equal the d1 digest of the list `[{"interface": name@major, "implementation":
  its name, "version": its version, "pins": its pins as the plan publishes them}]`, sorted by `interface`. A d1 digest
  is the SHA-256, as 64 lowercase hex, of the value's RFC 8785 bytes (technical design: One canonical form before any
  hash); for an entry's strings, lists and objects those are the bytes the base's `d1` hashes. Checked at the base:
  the suite's `d1` reproduces the base's `set_digest` of `core,test-sim-a` from `registry`'s `modules`, `digests`
  and `versions`. The four key names are the design's list, `{interface@major, implementation, version, pins}`, and
  the ones the base's stand-in in `deep-canvas-physics` already uses "in the seal's shape".
- **A build with nothing to cover** publishes the d1 digest of the empty list
  (`4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`), never a missing field: a build with A.
- **Seam backends** aren't in the published plan (the base leaves them out), and the design leaves them out of the
  digest, so the formula over the plan's entries leaves them out too.
- **"Naming physics@1" and "naming B".** Nothing at the base compares two builds' digests; the design's places that
  do (a match's start, a golden's report, a save) belong to other tasks. So the name comes from the test's judge: it
  compares the two builds' published plans, names the interface and implementation whose entry differs, and its
  failure on a planted seal names them too. "B" is the implementation `test.sim.b` of `test.sim@1`.
- **"The shipped set"** is the `full` build set, which holds every canvas module and is the one the base's module
  table gives `physics`. **The module's name** `physics` and the crate `rapier3d` are the base's and the design's
  (`backend.name`); the implementation's own name is the implementer's, and the tests only require it to be the
  interface's reference, as the design says of Rapier.
- **"A test build that changes only Rapier's pinned patch version"** is a test feature whose implementation record
  pins `rapier3d` at another 0.36 patch, as #238's `test-sandbox-alt` pins another wasmtime patch. Cargo resolves one
  rapier3d 0.36 per lockfile and the crate requires `=0.36.1`, so a build can't link another patch beside it; whether
  the test build links the version it pins isn't observable here and isn't checked. **Which patch** neither the issue
  nor the design gives: any `0.36.x` other than 0.36.1, the implementer's choice.
- **"Only"** is read on the published plans: the two builds' `schedule` replies differ at the one path the criterion
  names (and in `runtime_digest`) and nowhere else, so the module set, its shapes, the module-set digest and the
  phases are the same.
- **"B's version"** and **"A's version"** are the implementation's `version`, the one the digest's entry holds, not
  the canvas module's own version, which stays.
- **"When one of its pins changes a feature."** Which feature neither the issue nor the design gives: one pin's
  `features` must differ as a set, the crate and its version unchanged. At the base B has one pin, `test-sim-backend`
  1.0.0 with `f32`.
- **"When A's version moves"** to 1.0.1, this suite's choice: the same move as B's, so the two builds differ from
  their 1.0.0 builds in the same way and only A's being bit and canonical tells them apart.
- **"Whose kit fixtures still give the reference hashes."** The kit fixtures are the ones the build's `fixtures` call
  lists for the module `test.sim` (#387; the kit's manifest holds each, #138). Each is presented with `deep_show` and
  evaluated clean at 0 s with `eval`, whose nodes carry `result`, the SHA-256 of the bytes the node wrote (#387). The
  reference's hashes are those of `core,test-sim-a`, A at 1.0.0, test.sim@1's reference. The `kit` call isn't the
  reading: at the base its `bit` part compares an implementation with its interface's reference only when their names
  differ, and A at 1.0.1 keeps A's name, while its `fixtures` part hashes pixels, which don't show `test.sim.pos`.
- **The planted seals change nothing else.** Under each, a build's plan equals its real plan but for the digest, so
  the judge's failure is about the digest alone.

## Not tested, because no criterion asks

Saves and matches, which the issue says carry the digest through their own tasks. Goldens recording the seal's
digest, never compared under another, their report naming both; export receipts naming it; the logic goldens' own
`runtime_digest` (#532) and the physics crate's stand-in (`deep-physics`'s `runtime` call, #2010) giving way to the
seal's. The physics interface's conformance kit: the canvas kit's parts, the behavior part (#191), the planted
implementation whose checkpoint keeps only poses and velocities failing the carried-state part, and a release build
refusing it. The order of the digest's entries, since no build here holds two measured implementations. The digest
never changing after the seal. A change to a seam's backend. The `core`, `r1` and `r2` sets' plans and the committed
schedule snapshots, which #387's and #388's suites compare. The physics pins beyond `rapier3d`.

## What the implementer adds outside this folder

This job edits nothing outside `tests/acceptance/1920/`.

- **The physics module in the full set**: a manifest and `module()` for the canvas module `physics`, implementing
  `physics@1`, its implementation the interface's reference, measured, backend_bytes, its pins naming `rapier3d` at
  0.36.1, held by `deep-show`'s `full` build (`crates/deep-show/src/main.rs`, `modules`).
- **The seal's runtime digest** (`crates/deep-canvas/src/registry/mod.rs`), by the formula under Readings, published
  by `Sealed::schedule` as `runtime_digest`.
- **Four test features** in `crates/deep-show/Cargo.toml`, as the table above defines them:
  `test-physics-rapier-patch`, `test-sim-a-1-0-1`, `test-sim-b-1-0-1` and `test-sim-b-pin-feature` (the three
  `test-sim-*` ones beside #185's in `crates/deep-canvas-test-modules/src/sim.rs`).
- **Two planted seals**: `runtime_digest_omits_physics` and `runtime_digest_hashes_only_shapes` in `planted_named`
  (`crates/deep-show/src/main.rs`), each a `Fault` of the registry beside `DigestHashesPrivate` and
  `DigestCoversPins`.
- **`scripts/lanes.mjs`**: `alone.push('tests/acceptance/1920/');` with its comment (the files build `deep-show`
  seven times, in the full and core sets), which also takes the folder off the parallel line.
- **The committed schedule snapshots** `crates/deep-show/schedule/{core,r1,r2,full}.json`: each gains
  `runtime_digest`, and `full.json` gains `physics@1` and whatever the physics module registers (with its module
  snapshot under `schedule/modules/`), since #387's and #388's suites compare a build's plan with them.
