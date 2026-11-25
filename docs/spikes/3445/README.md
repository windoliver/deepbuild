# #3445: what a sandboxed program costs that the fuel doesn't count

Issue #3445 asks for three costs that sit outside a step's fuel, each read on a reference Mac in a release build:
compiling on the way to the canvas core's first reply, the epoch checks every program carries and no live step arms,
and the page tracker's call after every store in a logic item's program. The spike changes no shipped code and no
ceiling: what it tried is kept here as patches, applied only to scratch copies of the tree. The proof is
`tests/acceptance/3445/`, written blind from the issue before this spike; it recomputes `record.json` from the kept
run outputs in `out/`.

<!-- conditions -->
| Run | Output | Mac | Power | Low Power Mode | Thermal state | Lease | 1-minute load at its start and end | Counts as |
|---|---|---|---|---|---|---|---|---|
| The first reply | `out/first-reply.json` | Mac17,10, Apple M5 Max, macOS 26B8119 | ac | on | nominal | `timed:f521613098c85ede` | 10.42, 8.83 | a reading: Low Power Mode is on |
| The compile table | `out/compile.json` | Mac17,10, Apple M5 Max, macOS 26B8119 | ac | on | nominal | `timed:f521613098c85ede` | 8.83, 8.08 | a reading: Low Power Mode is on |
| The checks in | `out/epochs-in-again.json` | Mac17,10, Apple M5 Max, macOS 26B8119 | ac | on | nominal | `timed:f521613098c85ede` | 6.46, 6.55 | a reading: Low Power Mode is on |
| The checks out | `out/epochs-out-again.json` | Mac17,10, Apple M5 Max, macOS 26B8119 | ac | on | nominal | `timed:f521613098c85ede` | 6.37, 6.46 | a reading: Low Power Mode is on |
| The twin that mostly writes | `out/tracker/writes-logic.json` | Mac17,10, Apple M5 Max, macOS 26B8119 | ac | on | nominal | `timed:f521613098c85ede` | 6.41, 6.37 | a reading: Low Power Mode is on |

**5 of the 5 runs are readings, not results.** The numbers below are what those runs gave; none of them settles a criterion until the runs are taken again under the issue's `Runs on:` line.
<!-- /conditions -->

## The three answers

<!-- answers -->
- The first reply waits more than 1 s on compiling: yes, 2106.6 ms inside the calls the compile counter counts (109 compiles, pid 25601). No task is filed yet.
- The checks cost a live step more than 5%: no, 0.3745 ns per fuel unit with them in and 0.3736 with them out, 0.24% more.
- A step that mostly writes costs more than twice the record's ns per fuel unit: yes, 0.8867 against the record's 0.25, 3.55 times. No task is filed yet.
<!-- /answers -->

## Files

- `build.sh`: one release build of the binaries a reading runs, in a scratch copy of the tree, with the patches it
  is given applied and `tracker.rs` laid in as an example of `deep-logic`. It builds the canvas core as the release
  does (`scripts/release-stage.mjs`) and `deep-logic` as the metering benchmark does (`benchmarks/logic.mjs`), and
  writes a `build.json` beside the binaries: the commit, the patches by hash, the cargo command and the profile cargo
  printed. `out/builds/` keeps each one.
- `patches/timing.patch`: the canvas core says on stderr when it started, sealed, read a line, answered and checked a
  pack, and for every call the compile counter counts, the sha256 of the bytes `Module::new` was handed, the time
  inside it, the rest of `Program::new` around it, and the pack, fixture and item in scope.
  `patches/epochs-out.patch`: `epoch_interruption(false)`. `patches/parallel-compilation.manifests.patch`: wasmtime's
  `parallel-compilation` feature in the two manifests that take it (the lock's one new edge is in
  `out/builds/parallel.Cargo.lock.patch`).
- `kit-ledger.json`: the kit ledger the canvas cores here embed (How a reading was taken says why).
- `measure.mjs`: every reading (its head lists the commands). `readings.sh`: all the timed ones, one after another
  under one timed grant of `scripts/throttle.mjs`. `tracker.rs`: the tracker's reading. `analyze.mjs`: `record.json`
  and this file's tables, from `out/`.
- `out/`: each run's output as it was written. `first-reply.json`, `compile.json`, `parallel.json` and
  `parallel-compile.json` are the canvas core's runs, with the timing builds' own lines beside them
  (`*.marks.jsonl`); `epochs-*.json` are the benchmark's outputs, each with its `.run.json`; `tracker/` holds a file
  a program and rewrite; `golden-*.json` are the two goldens as the build with the checks out records them, and
  `golden-2662.test.txt` that build's run of #2662's golden test; `staged.json` lists the packs as staged.

## How a reading was taken

- **Main.** Every binary was built from `aafef3131` (origin/main when the spike started; the issue was read on
  `7e7029a78`, 83 commits earlier), in scratch copies of the tree that no session works in. `record.json` names it.
- **The builds.** `build.sh` built five sets, each in release with `--locked` and no compiler wrapper
  (`out/builds/<label>.json`): `stock` (the base), `timing` (with `patches/timing.patch`), `parallel` and
  `parallel-timing` (with `parallel-compilation`; `--offline` in place of `--locked`, since the lock gains one edge),
  and `epochs-out` (with `patches/epochs-out.patch`, `deep-logic` only, in a copy of its own). Each canvas core says
  `release` of itself in its `costs` reply, which the harness asks after the reply it timed.
- **The base's canvas core doesn't start in release, so every canvas core here embeds another ledger.** A release
  canvas core seals only the canvas modules its embedded kit ledger holds at their digests
  (`crates/deep-show/src/kit/ledger.rs`). At `aafef3131` the tree's ledger holds `scene3d` at `68337736…` and the
  build's `scene3d` is `919d7004…`: the base's last merge (#3394, the struct layout lane of #3256) changed the
  module's shapes and the ledger wasn't written again, so `cargo build --release -p deep-show` at the base gives a
  core that answers every world with `seal_refused`, `kit_failed`, naming `scene3d`. Main's ledger holds the record
  again from #3388 (`f425875cb`, merged 23 minutes after the base). `kit-ledger.json` here is the base's ledger with
  that one record,
  `scene3d`'s, as `f425875cb` holds it; `build.sh` names it through `DEEP_KIT_LEDGER`, which is how a build is given
  its ledger (`crates/deep-show/build.rs`), and each `build.json` says so. The core checks the record against its own
  digest when it starts, and it sealed. No source file differs from the base's for it, and the ledger is read only
  at the seal, before the first line. A debug build doesn't check the ledger, which is why the tests didn't see it.
- **The shipped packs** are staged by the hub's own code (`packages/hub/dist/packs.js`: `readPack`, `stage`,
  `admit`), and the world lists them in the order a hub started again holds them (`out/staged.json`).
- **A canvas core's run** (`measure.mjs core`): one process that fills the evidence store and is not kept, then five
  more. Each is a fresh `deep-show canvas`, sent what `packages/hub/src/canvas.ts` sends: the world with the 21
  packs, then `deep_kinds` with `op: list`, the call #3108 waited on. The first reply's clock starts just before the
  harness starts the process and stops when it has the whole reply line. Then the same call again (a warm process: a
  reading), `costs` and `packs`, whose rows say each of the 21 was installed by that process's own check.
- **The epoch checks** are read by `node benchmarks/logic.mjs` itself, unchanged, in a copy of main and in a copy
  with `patches/epochs-out.patch` applied (`git diff` there is the patch, byte for byte). Each copy was built
  beforehand by the benchmark's own cargo command, so under the timed grant that command finds `deep-logic` built and
  compiles nothing. The outputs are kept as the benchmark printed them; the lease and the load of each run are in
  the `.run.json` beside it.
- **The lease.** `readings.sh` takes every timed reading under one `timed` grant of `scripts/throttle.mjs`, which is
  exclusive of every other grant on the machine.

## Compiling on the way to the first reply

### The first reply, five fresh processes a build

<!-- first-reply -->
| Build | First reply, ms, five fresh processes | Median | A warm process's reply, ms | Load at start and end | Inside the counted calls, ms (compiles) |
|---|---|---|---|---|---|
| the base (the result) | 5273.2, 5235.0, 5291.5, 5264.1, 5302.5 | 5273.2 | 27.0, 27.1, 27.4, 26.9, 27.1 | 10.42, 8.83 | not read: no timing |
| the base with `patches/timing.patch` | 5489.2, 5443.4, 5409.3, 5409.7, 5415.0 | 5415.0 | 27.6, 27.1, 27.1, 27.4, 26.5 | 8.83, 8.08 | 2096.3, 2112.1, 2106.6, 2115.1, 2102.0 (109) |
| with `parallel-compilation` (the unmerged branch) | 4293.1, 4268.0, 4351.2, 4409.6, 4304.9 | 4304.9 | 25.3, 27.3, 27.0, 27.2, 27.6 | 8.08, 7.06 | not read: no timing |
| with `parallel-compilation` and `patches/timing.patch` | 4350.6, 4418.8, 4392.8, 4431.5, 4354.7 | 4392.8 | 27.7, 27.1, 26.6, 31.5, 27.4 | 7.06, 6.21 | 1111.0, 1107.0, 1106.5, 1111.5, 1111.4 (109) |
<!-- /first-reply -->

### Each shipped pack's programs

<!-- compile -->
| Pack | Program (sha256 of the bytes compiled) | From | Bytes | Compiles | ms inside `Module::new` |
|---|---|---|---|---|---|
| art@1.0.0 | none | | | 0 | 0 |
| blender@1.0.0 | none | | | 0 | 0 |
| chrome-fx@1.0.0 | none | | | 0 | 0 |
| circuit@1.0.0 | `85957103aae6` | `objects/plug.wasm` | 247408 | 3 | 75.578 |
|  | `77c6cbe0aabe` | `objects/plug.wasm` | 243307 | 2 | 49.333 |
|  | `3b3f4006df6f` | `objects/plug.wasm` | 243260 | 2 | 49.287 |
|  | `5f23dc00389e` | `objects/kettle.wasm` | 243260 | 2 | 49.237 |
|  | `1b682633c496` | `objects/fault.wasm` | 243402 | 3 | 73.978 |
|  | `8f0879811b45` | `objects/kettle.wasm` | 243307 | 1 | 24.590 |
|  | `95480581c8bd` | `objects/plug.wasm` | 243136 | 2 | 49.348 |
|  | `31783c49de2c` | `objects/kettle.wasm` | 243136 | 2 | 49.163 |
|  | `f371f25ba239` | `objects/fault.wasm` | 243277 | 2 | 49.331 |
|  | `e752daed45ec` | `objects/battery.wasm` | 243192 | 2 | 49.175 |
|  | `a71459469192` | `objects/phase.wasm` | 242904 | 2 | 49.158 |
|  | `18b16ee708b5` | `objects/lamp_own.wasm` | 242904 | 2 | 49.481 |
| | **circuit@1.0.0 in all** | 12 programs | | 25 | **617.660** |
| composites@1.0.0 | none | | | 0 | 0 |
| explain@1.0.0 | none | | | 0 | 0 |
| familiar@1.0.0 | none | | | 0 | 0 |
| familiar@1.1.0 | none | | | 0 | 0 |
| foley@1.0.0 | none | | | 0 | 0 |
| fx@1.0.0 | none | | | 0 | 0 |
| godot@1.0.0 | none | | | 0 | 0 |
| godot@1.1.0 | none | | | 0 | 0 |
| interfaces@1.0.0 | `260c9d5993ef` | `objects/door.wasm` | 4778 | 2 | 2.769 |
|  | `db724e63f479` | `objects/net.wasm` | 6652 | 2 | 3.149 |
|  | `1ce4365e2603` | `objects/slide.wasm` | 9331 | 2 | 3.906 |
| | **interfaces@1.0.0 in all** | 3 programs | | 6 | **9.824** |
| lanes@1.0.0 | `e35645383260` | `objects/straight.wasm` | 235382 | 2 | 45.706 |
|  | `f9e8cf292f16` | `objects/merge.wasm` | 235827 | 2 | 44.053 |
|  | `aa1fec63db53` | `objects/straight.wasm`, `objects/straight_own.wasm` | 235254 | 4 | 87.800 |
|  | `2dd2b94e040c` | `objects/merge.wasm` | 235715 | 2 | 43.809 |
|  | `3943cd29bc9d` | `objects/lift.wasm` | 238496 | 2 | 43.995 |
| | **lanes@1.0.0 in all** | 5 programs | | 12 | **265.363** |
| math@1.0.0 | none | | | 0 | 0 |
| modslib@1.0.0 | `b0491e694ed4` | `objects/stack.wasm` | 126831 | 2 | 29.659 |
|  | `391487587801` | `objects/edits.wasm` | 126831 | 2 | 29.318 |
|  | `b2ea3fb5c27b` | `objects/stack.wasm` | 123750 | 2 | 28.964 |
|  | `e50c8a5f133c` | `objects/edits.wasm` | 123750 | 2 | 28.555 |
|  | `896f8c8d83b5` | `objects/archer_own.wasm` | 123750 | 2 | 28.503 |
| | **modslib@1.0.0 in all** | 5 programs | | 10 | **144.999** |
| process@1.0.0 | `ef049b2c23eb` | `objects/steady.wasm` | 278942 | 2 | 55.688 |
|  | `a1c46d3ff9ce` | `objects/blocked.wasm` | 279018 | 2 | 55.916 |
|  | `9febdc8f3f07` | `objects/steady.wasm` | 275876 | 2 | 55.229 |
|  | `d858d5c52212` | `objects/blocked.wasm` | 275952 | 2 | 54.942 |
|  | `92dc30c7da6d` | `objects/grant.wasm` | 276358 | 2 | 54.705 |
|  | `d596f8e76f1f` | `objects/steady.wasm`, `objects/steady_own.wasm` | 275876 | 4 | 108.968 |
|  | `05e422159ec2` | `objects/blocked.wasm` | 275952 | 2 | 55.049 |
|  | `d0e0d07579c2` | `objects/grant.wasm` | 276358 | 2 | 55.694 |
| | **process@1.0.0 in all** | 8 programs | | 18 | **496.191** |
| sense@1.0.0 | `f1244d523ed6` | `objects/driver.wasm` | 70207 | 2 | 20.382 |
|  | `07f0f4832a83` | `objects/driver.wasm`, `objects/driver_own.wasm` | 71181 | 10 | 102.014 |
| | **sense@1.0.0 in all** | 2 programs | | 12 | **122.396** |
| separation@1.0.0 | `d69b261178ed` | `objects/crossing.wasm` | 119763 | 2 | 25.097 |
|  | `082143b30374` | `objects/crossing.wasm` | 162845 | 2 | 34.758 |
|  | `8170ed9e174b` | `objects/wide.wasm` | 161885 | 2 | 35.207 |
|  | `caef2ceb7d15` | `objects/breach.wasm` | 162813 | 2 | 35.080 |
|  | `a3c6e180b963` | `objects/delayed.wasm` | 162787 | 2 | 34.904 |
|  | `9d4d605fdfb5` | `objects/narrow.wasm` | 163288 | 3 | 52.571 |
|  | `7300ee90bb93` | `objects/breach.wasm` | 119735 | 1 | 12.457 |
|  | `3c82376c8ac5` | `objects/crossing.wasm` | 172499 | 2 | 38.861 |
|  | `31cbd4e0d221` | `objects/wide.wasm` | 171539 | 2 | 36.639 |
|  | `66ad77c23fd0` | `objects/breach.wasm` | 172467 | 2 | 36.635 |
|  | `7439d30e7ad7` | `objects/delayed.wasm` | 172441 | 2 | 36.091 |
|  | `9b584ab0caa6` | `objects/narrow.wasm` | 172942 | 2 | 36.099 |
|  | `d6f3605160e3` | `objects/approach_own.wasm` | 171539 | 2 | 35.809 |
| | **separation@1.0.0 in all** | 13 programs | | 26 | **450.208** |
| unreal@1.0.0 | none | | | 0 | 0 |
| verbs@1.0.0 | none | | | 0 | 0 |
| **The table** | | | | 109 | **2106.643** |
| **The run's own total** (pid 25601) | every call the compile counter counts | 0 outside a pack's check | | 109 | **2106.643** |
<!-- /compile -->

<!-- repeats -->
109 counted calls compiled 48 different programs: 61 calls compiled a program this process had already compiled, 1155.9 ms of the 2106.6 ms.
<!-- /repeats -->

### Where the first reply's time goes

<!-- where -->
| Where | ms |
|---|---|
| From `main` to the seal | 68.8 |
| From the seal to the world line's answer | 0.1 |
| The first call: its line read to its reply written | 5326.7 |
| … of it, the pack checks (`check_ms`, 21 packs) | 5283.9 |
| … of them, inside `Program::new` | 2152.0 |
| …… `Module::new` (the calls the counter counts) | 2106.6 |
| …… `Engine::new` | 0.9 |
| …… the offset map and the memory's size | 44.4 |
| The harness's clock for the same reply (from before the process starts) | 5409.3 |
<!-- /where -->

The harness's clock also holds what comes before `main` and the pipe each way. Each pack's share:

<!-- checks -->
| Pack, in the order checked | Its check, ms | Inside `Module::new`, ms | Compiles | Different programs |
|---|---|---|---|---|
| composites@1.0.0 | 0.5 | 0.0 | 0 | 0 |
| modslib@1.0.0 | 240.3 | 145.0 | 10 | 5 |
| chrome-fx@1.0.0 | 22.5 | 0.0 | 0 | 0 |
| godot@1.0.0 | 0.3 | 0.0 | 0 | 0 |
| art@1.0.0 | 6.0 | 0.0 | 0 | 0 |
| fx@1.0.0 | 13.6 | 0.0 | 0 | 0 |
| lanes@1.0.0 | 475.7 | 265.4 | 12 | 5 |
| process@1.0.0 | 1397.0 | 496.2 | 18 | 8 |
| godot@1.1.0 | 0.4 | 0.0 | 0 | 0 |
| circuit@1.0.0 | 966.5 | 617.7 | 25 | 12 |
| familiar@1.1.0 | 12.2 | 0.0 | 0 | 0 |
| familiar@1.0.0 | 8.1 | 0.0 | 0 | 0 |
| separation@1.0.0 | 691.4 | 450.2 | 26 | 13 |
| verbs@1.0.0 | 14.6 | 0.0 | 0 | 0 |
| blender@1.0.0 | 0.3 | 0.0 | 0 | 0 |
| explain@1.0.0 | 143.7 | 0.0 | 0 | 0 |
| foley@1.0.0 | 990.2 | 0.0 | 0 | 0 |
| unreal@1.0.0 | 0.2 | 0.0 | 0 | 0 |
| interfaces@1.0.0 | 37.9 | 9.8 | 6 | 3 |
| sense@1.0.0 | 253.5 | 122.4 | 12 | 2 |
| math@1.0.0 | 8.9 | 0.0 | 0 | 0 |
| **All 21** | **5283.9** | **2106.6** | 109 | 48 |
<!-- /checks -->

### Whether a compiled module can be kept across starts

Read in wasmtime 49.0.5's source and the design; nothing here was run.

- **What the engine gives.** A config has no cache unless one is set, and `Config::cache` exists only with the
  `cache` feature, which we don't take: "Every call to `Module::new(my_wasm)` will recompile `my_wasm`, even when it
  is unchanged" (`wasmtime-49.0.5/src/config.rs`, at `Config::cache`). A compiled module can be written out with
  `Module::serialize` and read back with `Module::deserialize`, which is `unsafe`: the bytes are "only lightly
  validated", and changed bytes can "replace valid compiled code with any other valid compiled code"
  (`src/runtime/module.rs`, "Unsafety"). Reading one back runs it as native code in the process that reads it, with
  no sandbox.
- **What the engine checks when it reads one back** (`src/engine/serialization.rs`, `check_compatible`): the wasmtime
  version, the target's architecture and operating system, the compiler's shared and ISA flags, the tunables (epoch
  interruption and fuel among them) and the WebAssembly features. It doesn't check which program the code was
  compiled from, or that the bytes are the ones written.
- **So a key would have to cover** the sha256 of the bytes `Module::new` is handed (the rewritten program, with its
  memory sized where `Program::new` sizes it), every setting `Program::new` gives the engine, the pinned version
  (`=49.0.5`), the target, and the build that wrote the entry, since the cache manifest never reads "an entry another
  build wrote". The key says which entry to read. It says nothing about whether the entry's bytes are still the ones
  written, and that is the part the engine leaves to us.
- **Which store could hold one.**
  - *Process memory*, as now: a thread's `PROGRAMS` (#1172) and an item's `compiled` (#2662). Nothing is read back,
    so no threat row is touched. It ends with the process.
  - *The evidence store or the pages store*, as a kind in the cache manifest (Carried state: the cache manifest):
    after a restart an entry is read "only when its key, the build its environment fingerprint names and the sha256
    of its bytes all match". That holds against a stale entry and a cut one. It doesn't hold against a writer, since
    the hash it compares against is kept in the same place as the bytes. The threat rows say who can write there:
    a command's children "run as you" and "the guards are a first refusal" (What a command's children do), and the
    rule that denies an agent's write under `~/.deepbuild/` is one of those guards (Agents switching off what
    watches them). Today such a write changes data: a bake that no longer matches is rebuilt. With compiled code
    kept there, the same write runs code in the hub or the app, outside `sandbox@1`, which the row Code in a piece
    says never happens. Neither store can hold one as the design stands. It would take the entry's hash kept where
    a process running as you can't write it, which is a design decision and not this spike's.
  - *The signed release*, for the shipped packs only: their programs compiled when the release is built and read
    back only after the release's signature has passed (Tampered updates). That is no weaker than the binaries the
    release already carries. It covers no pack you install later and no logic item an agent writes, and until the
    app is a signed download (R2) there is no release to carry them.

## The epoch checks

`Program::new` sets `epoch_interruption(true)` for every program, and wasmtime leaves it off unless it is set
(`wasmtime-environ-49.0.5/src/tunables.rs`). With it on, Cranelift puts a check at each function's entry and each
loop's head (`wasmtime-internal-cranelift-49.0.5/src/func_environ.rs`); the project's guide says it "has been
measured at around a 10% slowdown". A live step passes no deadline, so nothing ever arms the checks it runs.

The benchmark was run twice a side under the one grant: in, out, then out, in. The pair read is the first whose two
runs each keep their five readings within 5% of their median, since a run that spreads further can't settle a 5%
question. That rule was written after the first set of readings, whose first run with the checks in spread 24.5%
while its three neighbours spread under 1.5%; it is in `analyze.mjs` and holds for every set taken after it.

<!-- epochs -->
| Epoch checks | Output | ns per fuel unit in the app, five runs | Median | Spread of the five | The benchmark's own (3 places) | Fuel: the benchmark, its twin | Steps |
|---|---|---|---|---|---|---|---|
| in | `out/epochs-in.json` | 0.5907, 0.6480, 0.5164, 0.5032, 0.5919 | 0.5907 | 24.5% | 0.591 | 4800007, 47 | 20 |
| out | `out/epochs-out.json` | 0.3737, 0.3745, 0.3785, 0.3736, 0.3736 | 0.3737 | 1.3% | 0.374 | 4800007, 47 | 20 |
| out (read) | `out/epochs-out-again.json` | 0.3735, 0.3736, 0.3736, 0.3736, 0.3736 | 0.3736 | 0.0% | 0.374 | 4800007, 47 | 20 |
| in (read) | `out/epochs-in-again.json` | 0.3763, 0.3752, 0.3738, 0.3745, 0.3744 | 0.3745 | 0.7% | 0.375 | 4800007, 47 | 20 |
| the record (`crates/deep-logic/metering.json`), with them in |  | 0.2499, 0.2499, 0.2503, 0.2517, 0.2507 | 0.2503 | 0.7% | 0.25 | 4800007, 47 | 20 |

The pair read is `out/epochs-in-again.json` and `out/epochs-out-again.json`: with the checks in, a fuel unit costs 0.24% more than with them out.
<!-- /epochs -->

## The page tracker

`tracker.rs` reads each program as `deep_logic::budget::metered` reads the record's: the least CPU time of ten
steps, less the least of ten of the program's one-iteration twin, over the fuel between them, six times, the first
left out as the benchmark leaves its first out. It runs the shipped rewrite and the shipped engine settings through
`deep_sandbox_wasmtime::Runner`, as a plain program (`Mode::Plain`) and as a logic item's (`Mode::Logic`). The
rewrite charges the tracker no fuel, so both forms of a program are charged the same.

- `metering` is the benchmark's own program, from `deep_logic::budget::meter()`: one store in the 40 instructions
  of an iteration. As a logic item's it is what the benchmark reads, and it reads the same here.
- `writes` is the twin that mostly writes: an iteration stores an i64 at 64 addresses 8 bytes apart, then moves on
  512 bytes through the first MiB of its 2 MiB, 64 stores in 203 instructions. A store takes an address and a value
  from the stack, so no program stores more often than once in three instructions; "once every two instructions" is
  read as two other instructions a store.
- `writes-marked-inline` is `writes` with the tracker's mark written after each store as the program's own
  instructions, for a memory of one bitmap word (up to 64 pages): what an inlined tracker would run. Its ten more
  instructions a store are charged fuel here, which a rewrite's own would not be, so its row is read by its ns an
  iteration.

<!-- tracker -->
| Program | Rewritten as | Fuel a step | ns per fuel unit, five runs | Median | Against the record's 0.25 | ns an iteration |
|---|---|---|---|---|---|---|
| metering | a logic item's (the tracker after each store) | 4800007 | 0.3750, 0.3740, 0.3773, 0.3743, 0.3761 | 0.3750 | 1.50× | 15.00 |
| metering | a plain program | 4800007 | 0.3733, 0.3733, 0.3733, 0.3733, 0.3275 | 0.3733 | 1.49× | 14.93 |
| writes | a logic item's (the tracker after each store) | 4790807 | 0.8912, 0.8842, 0.8885, 0.8867, 0.8859 | 0.8867 | 3.55× | 180.00 |
| writes | a plain program | 4790807 | 0.0696, 0.0693, 0.0693, 0.0693, 0.0693 | 0.0693 | 0.28× | 14.07 |
| writes-marked-inline | a plain program | 5351307 | 0.0278, 0.0278, 0.0278, 0.0279, 0.0278 | 0.0278 | 0.11× | 25.20 |
<!-- /tracker -->

## What each change would return, what it would put at risk, and the recommendation

<!-- returns -->
- **A program compiled once a process.** 61 of the 109 counted calls compiled bytes the same process had already compiled. Without them the run would have spent 950.7 ms inside the counted calls in place of 2106.6 ms: 1155.9 ms back, 21.4% of that process's first reply.
- **`parallel-compilation`.** The first reply's median went from 5273.2 ms to 4304.9 ms, 968.3 ms back; the time inside the counted calls, by the timing builds, from 2106.6 ms to 1111.0 ms. The same 109 calls are still made.
- **What isn't compiling.** Of the 5283.9 ms the 21 checks took, 3131.9 ms were outside `Program::new`: linking, rewriting and running each fixture, and the checks of packs that hold no program.
- **The epoch checks.** 0.3745 ns per fuel unit with them in, 0.3736 with them out: taking them out would return 0.24% of a step that runs like the benchmark.
- **The tracker.** In the twin that mostly writes, a store costs 0.22 ns as a plain program and 2.81 ns as a logic item's, so the tracker's call is 2.59 ns a store, 92.2% of the step. With the same mark written inline, for a bitmap of one word, a store costs 0.39 ns: 2.42 ns a store back. In the benchmark's own program, which stores once in 40 instructions, the tracker is 0.5% of a fuel unit.
<!-- /returns -->

### Compiling: compile a program once a process

- **The change.** `World::runner` compiles an item's program once for that item (`Item.compiled`, #2662), and the
  pack check makes the same item more than once: for a fixture's bake and again for its `logic.determinism` run
  (every fixture's program is compiled twice, by the marks in `out/compile.marks.jsonl`), and again where two
  fixtures link the same program. `Runner::sized` already keeps what a thread compiled by its bytes (#1172); a logic
  item's program would be kept the same way.
- **What it puts at risk.** No hash, golden or step: the same bytes go to the same engine settings, and a runner is
  still a fresh instance. A kept program holds its compiled code until the thread's list is cleared (256 programs
  today), so the canvas core's memory after its first reply needs reading before and after.
- **`parallel-compilation`** returns about as much, on other grounds: the same calls, each compiled on every core.
  It adds a thread pool to a process that checks packs on one thread, a dependency edge the lock doesn't hold, and
  cores taken from whatever else the machine runs while a core starts. It isn't recommended while the calls it
  speeds up are mostly repeats.
- **A kept module** isn't recommended: see above. No store of ours can hold one as the design stands.
- **Recommendation: file the first.** The rest of the first reply isn't compiling, and this spike doesn't size a
  change for it: the pack checks run again in every process, and one pack with no program takes about a second of
  them.

### The epoch checks: leave them in

- **What taking them out would put at risk.** A call that carries a deadline is stopped only through them
  (`Call.deadline`, the check-time runner in `service.rs`): the planted rewrites the kit runs, whose loops charge no
  fuel, would never end. Keeping them for those calls alone means two engines' settings and a program compiled for
  each. Every golden kept its step hashes with them out (`out/golden-2324.json`, `out/golden-2662.json`).
- **Recommendation: no task.** The readings give no cost a live step would get back.

### The page tracker: mark pages without a call

- **The change.** The rewrite writes the mark after each store inline where the bitmap is one word, and keeps the
  call for `memory.fill`, `memory.copy` and larger memories; or the tracker marks a page only when the store's page
  differs from the last one marked.
- **What it puts at risk.** The rewritten bytes change, so every logic item's hash and bake key change with them:
  goldens are recorded again by your decision, once, and saves and bakes made before are rebuilt. The web player
  runs the same bytes, so its engine's cost has to be read too. Fuel doesn't move, since the rewrite's own code is
  charged none. Turning on the engine's own inlining instead leaves the bytes alone, but it is the app's alone, and
  wasmtime says of it that "backtraces may omit inlined stack frames", which is how `Runner` names the function a
  trap is in.
- **For the ceiling (#3442).** The step ceiling divides by the ns per fuel unit of a program that stores once in 40
  instructions. A step that mostly writes costs several times that a fuel unit, so a ceiling can pass a step the
  frame can't hold. That is #3442's to weigh, with this reading.
- **Recommendation: file it.**

## What this spike doesn't hold

- Every timed run above was taken with Low Power Mode on, so each is a reading and no criterion is settled (the
  table at the top). Nothing else about the runs was off: one timed grant, loads of 6 to 10 on 18 cores.
- The base's canvas core doesn't seal in release (How a reading was taken). The spike read around it with a ledger
  of its own; the base itself needs its ledger written again, which main already has.
- No task is filed. The two the readings point to are drafted, and wait for results.
- The web player's engine, the engine's version, step blocks and the ceiling's formula are other tasks' (#2324,
  #212, #3442).

