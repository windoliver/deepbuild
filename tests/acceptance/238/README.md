# Acceptance tests for #238: the sandbox module, sandbox@1, the one subset's check, rewrite, linker and check-time runner

Written first, from issue #238 (its scope, its Fields, its nine acceptance criteria and its proof line: "The kit's
results on the three hosts side by side; each planted rewriter, engine and runner failing with what it names; the
build without the logic module running its provider and validator and refusing the logic item; and the pack's
program entry admitted and refused"), its Oracle page (`doneright/oracles/issues/238.md` in DeepBuildAI/deepbuild),
the design sections it names and base commit `960045da` ("Merge pull request #1027 …"), by a job that never saw an
implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to
a blind redraft of this job (design: Dogfooding).

## What was read

- The issue body and its Oracle page (as handed to this job).
- `docs/canvas-primitives.md`: Logic: sandbox (the subset, the rewrite with its fuel, stack and NaN rules, "A call
  charges the stack 8 bytes for each parameter, local and value-stack slot of its frame, plus 64 bytes", the trap
  kinds, the program roles, "the subset check takes its parser's features from an allowlist of exactly WebAssembly
  2.0 without vector instructions, and the kit holds one refusal fixture for each refusal and each proposal named
  here", "wasmtime's own fuel … isn't used"); Logic: linked libraries; Logic: library interfaces (`lib.interface@1`,
  declared by the sandbox module); Logic: data layouts (a validator exports `memory`, `validate(len: i64) → i64`
  (−1 when valid, else the first bad byte's offset) and `in_at`; "A layout is accepted only once its validator
  refuses every one of its twins, else its pack is refused, naming the twin"); Provider `gen@1` and its links,
  meshes and library form (exports `memory`, `gen(seed: i64) → i32`, `params_at`, `assets_at`, `out_at`; runs once
  per content key at check, never in a frame; a mesh in the builder's output shape); Canvas module; Canvas module:
  interface and implementation (`implementation: {name, version, pins, equivalence, state}`, bit implementations
  give the reference's hashes on every fixture); Registry and seal and its runtime digest and registries sections
  (an entry is data or a program under the logic subset, "which the sandbox module admits and runs"); Registries and
  closed lists (the subset, rewrite, linker and trap kinds closed: determinism); Pack (`assets`, `providers`,
  `layouts`, `entries`).
- `docs/technical-design.md`: The canvas core; Sandbox and budgets; Dogfooding. AGENTS.md.
- The Oracle page's pinned files fetched from `doneright/oracles/vendor/`: wasmtime `3c8a3e79aa`
  `tests/misc_testsuite/canonicalize-nan-scalar.wast` and `tests/all/fuel.wast`; wasm-tools `e22db44da4`
  `tests/cli/lime1.wast` and `tests/cli/missing-features/{missing-exceptions,v128-without-simd-feature}.wast`.
- At the base: `crates/deep-show` (`deep-show run`, its `test-*` features, `--planted`, the `registry`, `schedule`,
  `registries`, `install_pack`, `packs`, `kit`, `eval` and `frames` calls, the `seal_refused` line), `crates/deep-canvas`
  (`KNOWN_MODULES` names `sandbox` and `logic` in `full`; `module_missing`; packs in `document/packs.rs`), the kit in
  `crates/deep-show/src/kit/`, `scripts/lanes.mjs`, and the suites `tests/acceptance/185/`, `200/`, `305/`, `331/`
  (Docker, BLOCKED), `387/` (`frames`), `388/`, `398/`.

What the base already does, which these tests don't credit: `full` holds no logic module (`test-leave-out-logic`
exists and changes nothing yet), so a document with a `logic@1` item is already refused with `module_missing` naming
`logic`; the seal, `schedule`'s `interfaces` (#185), registries (#200), packs (#306) and the kit (#138) exist. There is
no WebAssembly engine in `Cargo.lock`, no sandbox module, no `deep-sandbox` runner, no web runner, and none of this
suite's features, calls or planted names.

## Run them

```sh
npm ci                          # once, if node_modules is missing
docker pull --platform linux/amd64 rust:1.99.1-slim-bookworm   # once: the Linux x86_64 host (the channel rust-toolchain.toml names)
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/238 --no-file-parallelism
npx tsc -p tests/acceptance/238/tsconfig.json
rm -rf tests/acceptance/238/node_modules/.vite
```

What each run builds (all honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0`
unless set):

- **The fixture assembler** `tests/acceptance/238/wat/` (crate `acceptance-238-wat`, `wat =1.263.0` and
  `wasmparser =0.263.0`, outside the workspace by its empty `[workspace]` table, its own `Cargo.lock`), built into
  `target/acceptance-238-wat/`. It turns `fixtures/*.wat` into bytes and lists each function body's operators with
  their module byte offsets (`<stem>.ops.json`), so a test knows where each trap fixture's instruction is. It shares
  nothing with the code under test. The first build fetches those two crates' sources.
- **`deep-sandbox`** for this host: `cargo build --locked --bin deep-sandbox` in the checkout.
- **`deep-sandbox` for Linux x86_64**: the same command in `docker run --platform linux/amd64` with the image
  `rust:<channel>-slim-bookworm` (`<channel>` from `rust-toolchain.toml`, today `1.99.1`; `RUSTUP_TOOLCHAIN` set to it so
  rustup installs nothing), the checkout mounted read-only at `/src`, its target folder and cargo registry and git
  caches kept under `target/acceptance-238-linux/` so later runs build warm (the first one fetches crates and the
  `.cargo/config.toml` patches' git sources). The binary then runs in that image, one container per batch of calls.
  Nothing is pulled: without Docker, or without that image for linux/amd64, a test that needs Linux fails `BLOCKED:`
  with the `docker pull` command; a build that fails fails the test with cargo's error.
- **Headless Chrome** at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` (or `CHROME_BIN`): each test
  that needs it serves a page on `127.0.0.1` that imports the web runner's source (below), runs each request through
  it and posts the replies back; Chrome is started with its own temporary profile and stopped by its PID (its own
  process group). Without Chrome the test fails `BLOCKED:`.
- **`deep-show`** per feature set: `cargo build --locked --bin deep-show --no-default-features --features <set>`,
  copied out under its own name, as #185's and #200's suites do. `budgets.test.ts` also builds the merge base's
  `full` (`git merge-base HEAD origin/main`, exported with `git archive` into `target/acceptance-238-base/<sha>/`
  and built there with its own target folder, kept so later runs build warm).

Every test passes an explicit timeout (one to two hours: the Linux build under emulation and fresh deep-show builds
take many minutes). Temporary folders (evidence stores, packs, binaries, Chrome profiles) are deleted. Node built-ins
and vitest only. `scripts/lanes.mjs` needs `'tests/acceptance/238/'` added to its `alone` list (the files build cargo
binaries, start Docker and Chrome, and `budgets.test.ts` times the rewrite), which also takes the folder off the
parallel line; that is how "in the local preflight" reaches these tests. This README is the instruction; the
implementer makes that edit.

Gates: `budgets.test.ts`'s rewrite timing runs only on a reference Mac (Mac15,7 or Mac15,12, Low Power Mode off,
thermal state nominal, a 1-minute load at most the core count; mains power never gates); elsewhere it skips as
`INCONCLUSIVE` after its structural checks, and a reading between the limit and the margin also skips as
`INCONCLUSIVE`. It never passes by skipping. A missing host is `BLOCKED` (a failed test), never a pass.

`BASE-FAILURE.txt` is the run at the base, on a clean `git archive 960045da` export with this folder copied in
(the checkout already held another session's uncommitted work): 26 of 26 fail. 25 fail for a missing surface (no
`deep-sandbox` bin target, no `test-*` feature of this suite, deep-show's `run` answering `bad_input` to the new calls
and kit part, no `--planted digest_covers_pins`, no wasmtime in `Cargo.lock`); `planted.test.ts`'s Linux test is
`BLOCKED` because this Mac has no linux/amd64 `rust:1.99.1-slim-bookworm` image yet.

The harness itself was checked against real components before that run, with a throwaway web runner that runs the
fixtures unrewritten: headless Chrome reports each trap fixture's function and offset (`wasm-function[1]:0x83` for
`trap_divide`'s `i32.div_s`, …) exactly where the assembler's listing puts the instruction, and the padded programs
are exactly 4,194,304 and 4,194,305 bytes. Without `--use-mock-keychain` and no background networking a fresh
Chrome profile waited about a minute here; `helpers.ts` passes both.

## The surface under test

The issue names a canvas module, an interface, a kit, an engine pinned in the app, the browser's own engine in the
web player, and test builds, but no command line. **Every name below that the issue doesn't give is this job's
invention**, the smallest surface the criteria need; the implementer builds exactly these, or a dispute goes to a
blind redraft.

### `deep-sandbox`: the sandbox module's runner

A binary target named `deep-sandbox` in a workspace crate of the implementer's choosing, built by `cargo build
--locked --bin deep-sandbox`, that calls the sandbox module's own check, rewrite and check-time runner (the code
deep-show seals; no copy) and builds and runs on macOS arm64 and Linux x86_64 (glibc). It reads JSON lines on stdin
and answers each with exactly one JSON line, in order, then exits 0 at end of input. A line that isn't JSON or lacks
a required field answers `{"ok": false, "code": "bad_input"}`. `deep-sandbox --planted <name>` runs the same binary
with one planted twin (below); an unknown name writes one `{"ok": false, "code": "bad_input"}` line and exits 2.

Programs are base64 in `program`. `role` is one of the design's program roles; these tests use `provider` (exports
`memory`, `gen(seed: i64) → i32`, immutable globals `params_at`, `assets_at`, `out_at`) and `validator` (`memory`,
`validate(len: i64) → i64`, `in_at`). A function index is in the program's function index space as given (imports
first), before any rewrite; an offset is a byte offset in the program as given (the linked program, before the
rewrite), as wasmparser reports an operator's offset and as wasmtime's `module_offset` and Chrome's
`wasm-function[i]:0x…` report one: the rewrite keeps whatever map it needs to report the program's own offsets.

| Call | Reply |
|---|---|
| `{"call": "about"}` | `{"interface": "sandbox@1", "implementation": {"name", "version", "pins": {"wasmtime": {"version": "=49.0.5", …}}, "equivalence", "state"}, "engine": {"name": "wasmtime", "version": "49.0.5"}, "arch": "aarch64" \| "x86_64", "os": "macos" \| "linux"}` (`arch` and `os` from the running process) |
| `{"call": "check", "program", "role"}` | `{"ok": true, "refusals": []}`, or `{"ok": false, "code": "subset_refused", "refusals": [Refusal]}` |
| `{"call": "rewrite", "program", "role", "budget"?}` | the check first (a refusal answers as `check` does), then `{"ok": true, "rewritten": base64, "hash": sha256 hex of those bytes, "ms": number}`; `ms` is the rewrite's own wall time, measured by the binary. `budget` is the run's (below) when the rewrite depends on it (the stack cap, say); the tests always pass the budget they then run with |
| `{"call": "run", "program", "role", "seed"?: 0, "budget": Budget, "read": [Read]}` | check, rewrite and one run in the role (a provider: its start export if any, then `gen(seed)`), off any frame, under the budget: `{"ok": true, "hash": sha256 of the rewritten bytes it ran, "trap": null \| Trap, "result": i32 \| null, "reads": [{"at", "len", "hex"}]}`. `result` is the entry's return value (null after a trap); `reads` are taken from linear memory after the run ends, returned or trapped, one per `read`, lowercase hex |
| `{"call": "kit"}` | sandbox@1's kit on this host (below) |
| `{"call": "kit_plan"}` | `{"fixtures": [{"fixture": name, "request": WebRun}]}`: for every kit fixture that runs, the web runner request that runs its reference-rewritten bytes as the kit does |
| `{"call": "web_runner"}` | `{"source": string}`: the web player's sandbox@1 implementation as one self-contained ES module (no imports), exporting `async function run(request: WebRun) → RunReply`, which runs the rewritten bytes with the browser's own `WebAssembly` API and maps its traps to sandbox@1's kinds |

```text
Budget  = {"fuel": integer, "stack"?: bytes (the per-call stack cap), "memory_mib"?: integer}   (defaults: the role's)
Read    = {"at": u32, "len": ≤ 4096}
Trap    = {"kind": "fuel" | "stack" | "grow" | "unreachable" | "divide" | "overflow" | "conversion" | "bounds" | "call" | …,
           "function": integer, "offset": integer}
WebRun  = {"rewritten": base64, "role", "seed": 0, "budget": Budget, "read": [Read]}
RunReply (web) = {"ok": true, "trap", "result", "reads"}   (as `run`'s, without `hash`)
Refusal = {"rule": string, "what": string,                     // rule and what are the implementer's; never compared to a value
           "import"?: {"module", "name"}, "instruction"?: text-format name ("v128.const", "return_call", …),
           "function"?: integer, "segment"?: {"kind": "data" | "elem", "index"}, "global"?: integer,
           "limit"?: {"name": "program" | "table" | "memory", "max": integer | null, "actual": integer | null},
           "proposal"?: "simd" | "threads" | "tail_call" | "exceptions" | "multi_memory" | "memory64" | "gc" |
                        "function_references" | "extended_const"}
```

A test reads a refusal by its naming fields only: it passes when some refusal holds every field the test names (a
nested object compared by the fields named). A trap is compared as `{kind, function, offset}` exactly.

### The kit: sandbox@1's fixtures and cases

`deep-sandbox`'s `kit` answers `{"interface": "sandbox@1", "verdict": "PASS" | "FAIL", "cases": [Case], "failures":
[Failure]}`. deep-show's `{"call": "kit", "modules": ["sandbox"], "parts": ["sandbox"]}` (#138's kit, a new part
`sandbox` that the `sandbox` module's interface lists) answers #138's shape with module `sandbox`, part `sandbox`,
whose `cases` are the same Case records and whose `verdict` the same.

```text
Case    = {"case": fixture, "fixture": fixture, "verdict": "PASS" | "FAIL",
           "hash": sha256 of the rewritten program | null (refused), "expected_hash": the reference's | null,
           "refusals": [Refusal], "trap": Trap | null, "expected_trap": Trap | null,
           "result": i32 | null, "reads": [{"at", "len", "hex"}], "failure"?: Failure}
Failure = {"fixture", "field": "hash" | "refusal" | "kind" | "function" | "offset" | "result" | "reads",
           "expected", "actual", "function"?: integer}
```

The kit holds at least these fixtures by these names; each carries the reference implementation's rewritten
program hash, trap function and offset (its expected values), and a case passes only when this host's result equals
them. What each must hold:

| Fixture | Holds |
|---|---|
| `refuse.import`, `refuse.vector`, `refuse.atomic`, `refuse.memory_grows`, `refuse.table_set`, `refuse.data_drop`, `refuse.mutable_funcref_global`, `refuse.over_4mib`, `refuse.table_65537` | the issue's refusal fixtures; each case is refused at check (`refusals` non-empty, `hash` null) and passes when the refusal names what the reference's does |
| `refuse.tail_call`, `refuse.exceptions`, `refuse.multi_memory`, `refuse.memory64`, `refuse.gc`, `refuse.extended_const` | one per proposal of criterion 8, the same way |
| `nan.f32`, `nan.f64` | NaNs from 0 ÷ 0, sqrt(−1) and inf − inf written to memory and read back (`nan.f64` holds f64 0 ÷ 0) |
| `fuel.loop` | an endless loop: function 0 is the export that calls function 1, which holds the loop; traps `fuel` |
| `fuel.fill` | a loop of 1 MiB `memory.fill` calls under a fuel budget of 10,000,000; traps `fuel` at the tenth fill |
| `stack.recursion` | an endless recursion; traps `stack` |
| `stack.small.65536`, `stack.small.262144`, `stack.large.65536`, `stack.large.262144` | the stack ladder: recursions of the smallest and the largest frames at caps of 64 KiB and 256 KiB; each traps `stack` at the reference's depth |
| `trap.unreachable`, `trap.divide`, `trap.overflow`, `trap.conversion`, `trap.bounds`, `trap.call`, `trap.grow` | criterion 9's seven traps; each traps with the kind its name gives |
| `pass.subset`, `pass.table_call` | a program built to the subset, and one calling through a table its active segments filled; neither traps |

The kit must finish under any planted twin (a twin can loop forever: judge what can be judged first, and stop a
run that can't end, as a failure).

### Planted twins of `deep-sandbox` (`--planted <name>`)

Each is one criterion's wrong program, reachable only through this argument, and changes nothing else:

| Name | Criterion | The wrong program |
|---|---|---|
| `rewriter_skips_back_edge_fuel` | 2 | the rewrite skips the fuel charge on one loop's back edge (at least the loop of `fuel.loop` and of this suite's `fuel_loop.wat`) |
| `meters_with_wasmtime_fuel` | 2 | metering by wasmtime's own fuel instead of the rewrite's |
| `runner_skips_nan` | 2 | the runner skips the NaN rewrite (no canonical NaN) |
| `rewriter_no_call_overhead` | 6 | each call charges its frame's slots but not the 64 bytes |
| `check_parser_defaults` | 8 | the subset check takes the parser's default features instead of the allowlist |
| `mapper_reports_unreachable` | 9 | every engine trap is reported with kind `unreachable` |
| `rewrite_grow_returns_minus_one` | 9 | `memory.grow` is left to return −1 instead of trapping |

### deep-show: the sandbox module and the test builds

`full` holds the canvas module `sandbox` (it is in `KNOWN_MODULES` at `full` already), implementing `sandbox@1`
with `implementation: {name: "sandbox", version, pins: {wasmtime: {version: "=49.0.5", …}}, equivalence: "bit",
state: "canonical"}`, depending only on core; `schedule`'s `interfaces["sandbox@1"]` (#185's shape) shows it, and
`Cargo.lock` holds wasmtime once, at 49.0.5. New calls of `deep-show run`:

- **`{"call": "sandbox"}`** → `{"module": "sandbox", "version", "checks", "links", "rewrites", "runs"}`: how many
  subset checks, links, rewrites and check-time runs (providers, validators, registry programs) the sandbox module
  made in this process.
- **`{"call": "provided", "doc"}`** → `{"doc", "provided": [{"item", "provider": "<pack>.<name>", "key": sha256 hex,
  "trap": null | Trap, "out": {"mesh": {"positions": [[x, y, z]], "normals": [[x, y, z]], "uv0": [[u, v]], "indices":
  [u32], "parts", "bounds": [[min x, y, z], [max x, y, z]]}}}]}`: the providers the document's current revision ran
  (or took by content key) at check, with their output.
- The `packs` rows (and `install_pack`'s reply) gain **`layouts: [{"name": "<pack>.<name>@<major>", "state":
  "admitted" | "refused", "twins": [{"asset": sha256, "valid": bool, "offset": integer | null}]}]`**, each twin as its
  validator judged it at pack check (`offset` the first bad byte's, from `validate`).
- `registries`' Entry (#200) gains, for a program entry, **`program: {"asset": sha256, "role", "hash": sha256 of the
  rewritten program}`**.
- **`--planted digest_covers_pins`**: the planted interface digest that also covers the implementation's pins.

**Test features of `deep-show`** (each in no shipped build):

| Feature | What the build holds |
|---|---|
| `test-leave-out-logic` | (exists) the full set's list without `logic` |
| `test-leave-out-sandbox` | the full set's list without `sandbox` (as `test-leave-out-logic`) |
| `test-mesh-item` | test module `test.mesh` (depends only on core) with kind `test.mesh@1`, param `mesh`: a mesh asset ID or `{"gen": "<pack>.<provider>", "params": {}}`; at check it takes the mesh through the sandbox module's check-time runner (gen@1) and draws nothing that any test reads |
| `test-prog-registry` | test module `test.prog` (no dependency on sandbox) declaring registry `test.prog@1`: owner `test.prog`, entry `{name: "<pack>.<name>", program: sha256}`, the program's role `validator`, `fill: [pack]`, `resolve: check`, `binds: all`, `since`, a kit whose rule is that the program passes sandbox@1's check and rewrite in its role, and a planted wrong entry (a program that imports a function). A pack's program entry needs the sandbox module: in a build without it the pack is refused with `module_missing` naming `sandbox`, whatever the pack's `requires.modules` says |
| `test-sandbox-needs-logic` | planted: the sandbox module's manifest declares `logic` among its required dependencies |
| `test-sandbox-alt` | the shipped `sandbox` implementation left out and the test implementation `sandbox.alt` in its place: the same canvas module `sandbox` and interface `sandbox@1`, `equivalence: bit`, `state: canonical`, whose `pins.wasmtime.version` names another exact wasmtime patch release (`=X.Y.Z`, not `=49.0.5`), passing sandbox@1's kit bit for bit |

Builds the tests make: `full`; `full,test-leave-out-logic,test-mesh-item,test-prog-registry`;
`full,test-leave-out-logic,test-sandbox-needs-logic`; `full,test-leave-out-sandbox,test-prog-registry`;
`full,test-sandbox-alt`; and the merge base's `full`.

### Packs (written by the tests, with their assets' sha256s)

A pack folder holds `pack.json` and its asset files, listed in `assets: [{path, sha256, size, license}]`; a program
or a twin is named by its sha256 (Pack: `assets`, `providers`, `layouts`, `entries`).

- `test/quadpack@1.0.0`: `requires.modules: {sandbox}`; `providers: {quad: {program: quad.wasm, params: {}, out:
  {mesh: {max_vertices: 4, closed: false}}}}`; `layouts: {"quadpack.grid@1": {validator: grid_validator.wasm,
  max_bytes: 4096, twins: [grid_twin.bin], doc}}`.
- `test/acceptpack@1.0.0` (planted): the same validator with the twin `grid_valid.bin`, which it accepts.
- `test/progpack@1.0.0`: `requires.modules: {test.prog}` only; `entries: {"test.prog@1": [{name: "progpack.ok",
  program: grid_validator.wasm}]}`. `test/badprog@1.0.0`: the same with `badprog.imports`, `prog_import.wasm`.
- Documents: a board (#200's form) with `packs: ["test/quadpack@1.0.0"]`, `requires.modules: {"test.mesh": "^1"}` and
  the item `{kind: "test.mesh@1", params: {mesh: {gen: "quadpack.quad", params: {}}}}`; the logic item is #305's
  (`{kind: "logic@1", params: {program, step_rate: 60, writes}}`, `requires.modules: {logic: "^1"}`).

**The mesh a provider writes** (the design names the fields, not the bytes; this suite's reading): at `out_at`, little
endian, `u32 vertex_count, u32 index_count, f32 positions[3 × vertex_count], f32 normals[3 × vertex_count], f32
uv0[2 × vertex_count], u32 indices[index_count]`; `parts` and `bounds` are the runner's (one part; the positions'
bounds). `gen` returns 0.

## Fixtures

`fixtures/*.wat`, written by this job (each file's comment says what it is and what it must do):

- Runs (providers; function 0 is `gen`, which calls function 1): `nan` (f32 and f64 0 ÷ 0, sqrt(−1), inf − inf from
  operands loaded from memory, stored at 0..40), `fuel_loop`, `fuel_fill` (177 pages; iteration i writes i + 1 at 0,
  then fills 1 MiB from 64 KiB + i MiB with 0xAB; at most 11), `stack_small` (no params or locals, value stack 3
  deep: 88 bytes a call; it counts its depth at 0), `stack_large` (1,000 i64 locals: 8,088 bytes a call),
  `pass_subset` (returns 5050), `table_call` (returns 4207 through a table its active segment filled), and
  `trap_{unreachable,divide,overflow,conversion,bounds,call,grow}`.
- Refusals: `refuse_{import,vector,atomic,memory_grows,memory_unbounded,table_set,data_drop,mutable_funcref_global,
  table_65537}`; proposals `refuse_{tail_call,exceptions,multi_memory,memory64,gc,extended_const}`; passing twins
  `table_65536`, and, generated, `pass_subset` padded by a custom section to exactly 4 MiB (passes) and 4 MiB + 1 byte
  (refused).
- Criteria 3, 4 and 7: `quad` (the provider), `grid_validator` (the layout's validator and progpack's entry),
  `prog_import` (the importing entry), `grid_twin.bin` (00 01 02 03 03 09 00: bad at offset 5), `grid_valid.bin`;
  and, generated, a 1,082,665-byte program of 1,000 functions of float multiply-adds (`budgets.test.ts`).

Expected values from the issue: 0x7FC00000 and 0x7FF8000000000000 (little-endian `0000c07f`, `000000000000f87f`);
0xFFF8000000000000 for 0 ÷ 0 on x86_64 without the NaN rewrite; a fuel budget of 10,000,000, the tenth 1 MiB fill
trapping before it runs (count 10, region 9 still zero, region 8 filled); 4 MiB + 1 byte; 65,537 table entries; caps
of 64 KiB and 256 KiB; wasmtime =49.0.5 (the issue's =49.0.2, moved by #2324); 200 ms for a 1 MB program; the trap kinds and their names; the design's 8
bytes a slot plus 64 a call.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace collapsed and the
leading `- [ ] ` dropped. Each test's name starts with its criterion's ID.

**`#238.6e920ef3`** (criterion 1, the kit on three hosts) — `kit.test.ts` (4):
1. `about` on macOS arm64 and Linux x86_64 names wasmtime 49.0.5, pins `=49.0.5`, and the host's `arch`/`os`;
   `Cargo.lock` holds wasmtime once, at 49.0.5. Wrong programs: another engine version; a "Linux" run that isn't
   x86_64.
2. `check` of every refusal fixture on both native hosts: each refused with a refusal naming the import
   (`env.forbidden_fn`), the instruction and function 1 (`v128.const`, `i32.atomic.load`, `table.set`, `data.drop` or
   `memory.init`, or the passive data segment 0), the limit (memory; table 65,536 / 65,537; program 4,194,304 /
   4,194,305) or the global (3); the 4 MiB program, `table_65536`, `pass_subset` and `table_call` admitted; both hosts'
   answers identical. Wrong programs: a check that misses one; one that refuses without naming it; a limit off by
   one (the 4 MiB and 65,536 twins).
3. `rewrite` + `run` of `nan`, `fuel_loop`, `stack_small`, `fuel_fill`, `pass_subset`, `table_call` on macOS arm64,
   Linux x86_64 (same rewritten hashes) and in headless Chrome (the macOS rewrite's bytes through the web runner):
   NaNs read `0000c07f`×3 and `000000000000f87f`×3; the loop traps `fuel` and the recursion `stack` in function 1, inside
   its body; the fill traps `fuel` at its `memory.fill`'s offset with count 10, region 8 filled and region 9 zero;
   5050 and 4207 returned; every host's trap, result and reads equal to macOS's. Wrong programs: no NaN rewrite (x86_64
   and its NaN sign), wasmtime's fuel or a charge after the fill, a host whose offsets differ.
4. The kit: PASS on macOS with every named fixture, refusals refused, every run fixture's hash the reference's and its
   trap of its named kind; deep-show's `full` kit part `sandbox` gives the same cases; Linux x86_64 too; every
   `kit_plan` request in headless Chrome gives macOS's trap, result and reads.

**`#238.a10d9b07`** (criterion 2, planted rewriter, engine, runner) — `planted.test.ts` (3):
1. `rewriter_skips_back_edge_fuel`: `fuel_loop.wat` rewrites to another hash than the reference rewrite; the kit FAILs,
   `fuel.loop` FAILs with a failure of field `hash` naming `function: 1`.
2. `meters_with_wasmtime_fuel`: the kit FAILs, `fuel.fill` with a failure of field `offset` whose `expected` is the
   reference kit's trap offset and `actual` another number.
3. `runner_skips_nan` on Linux x86_64: the reference writes `000000000000f87f` for f64 0 ÷ 0, the twin
   `000000000000f8ff` (0xFFF8000000000000); the kit FAILs naming `nan.f64` (or `nan.f32`), `nan.f64` FAIL.

**`#238.432c0da5`** (criterion 3, the build without logic) — `seal.test.ts` (4):
1. `full,test-leave-out-logic,test-mesh-item,test-prog-registry` seals with `sandbox` and without `logic`;
   `sandbox@1` is `sandbox`'s, bit, canonical, wasmtime `=49.0.5`; `quadpack` installs; the document naming
   `quadpack.quad` is presented without errors; `sandbox.runs` rises by one at that check; `provided` shows the quad
   (positions, normals, uv0, indices, bounds) under a content key; thirty frames change no count.
2. Pack check: `quadpack.grid@1` admitted, its twin refused at offset 5 (`valid: false`); `acceptpack` refused, naming
   its twin's hash. Wrong programs: a validator never run (no offset 5); a layout admitted whose validator accepts its
   twin.
3. The `logic@1` document: refused, an error `module_missing` naming `logic`.
4. `full,test-leave-out-logic,test-sandbox-needs-logic`: the seal refuses, its `modules` naming `logic` and `sandbox`.

**`#238.8cc7e4f7`** (criterion 4, program entries) — `registry.test.ts` (3):
1. Without logic: `progpack` installs; `test.prog@1` (owner `test.prog`) holds `progpack.ok`, origin `pack`, kit PASS,
   `program: {asset, role: "validator", hash}` with `hash` equal to `deep-sandbox`'s rewrite of the same program.
2. Without logic: `badprog` is refused, an error naming `env` and `forbidden_fn`.
3. `full,test-leave-out-sandbox,test-prog-registry`: `progpack` (which lists only `test.prog`) is refused with
   `module_missing` naming `sandbox`.

**`#238.46afd887`** (criterion 5, a second implementation) — `implementation.test.ts` (2):
1. `full` and `full,test-sandbox-alt`: implementations `sandbox` (`=49.0.5`) and `sandbox.alt` (another `=X.Y.Z`), both
   module `sandbox`, bit, canonical; `sandbox@1`'s digest equal; both kits PASS with every case equal. Wrong program: a
   digest over the implementation's pins.
2. `--planted digest_covers_pins`: `full` still seals; `full,test-sandbox-alt` exits 2, `interface_digest`, `interface:
   "sandbox@1"`.

**`#238.91f1b87c`** (criterion 6, the stack ladder) — `stack.test.ts` (2):
1. `stack_small` and `stack_large` at caps 65,536 and 262,144 in the app (macOS `deep-sandbox`) and headless Chrome:
   each traps `stack` in function 1 at a depth within 5% of cap ÷ 88 (or ÷ 8,088), and every trap and depth is equal
   in both. Wrong programs: no per-call charge or another charge; a browser engine's own overflow first.
2. `rewriter_no_call_overhead`: `stack_small` at 64 KiB recurses past the window's top (cap ÷ 24 deep); the kit FAILs a
   `stack.small.*` fixture.

**`#238.fb1edf47`** (criterion 7, budgets) — `budgets.test.ts` (3):
1. A ≥ 1,000,000-byte program passes the check and rewrites; on a fit reference Mac, five fresh processes after a
   warm-up each report `ms` < 200 (judged); elsewhere INCONCLUSIVE.
2. Two documents naming one provider, the first presented twice, then thirty frames: `rewrites` and `runs` rise by
   exactly one.
3. `full` here and the merge base's `full`, one document of two rects: `eval`'s nodes equal, each of thirty frames'
   `ran` equal, and `sandbox` reports zero checks, links, rewrites and runs.

**`#238.eaad3176`** (criterion 8, proposals) — `proposals.test.ts` (2):
1. `check` refuses each proposal fixture with one refusal holding `proposal`, `instruction` and `function: 1`
   (`tail_call`/`return_call`, `exceptions`/`try_table` or `throw`, `multi_memory`/`i32.load`, `memory64`/`i32.load`,
   `gc`/`struct.new`) or, for `extended_const`/`i32.add`, `global: 3`; the kit's six proposal fixtures are refused and
   pass.
2. `check_parser_defaults`: `refuse_tail_call.wat` is admitted; the kit FAILs, `refuse.tail_call` FAIL and named in a
   failure.

**`#238.a3fecb68`** (criterion 9, trap kinds) — `traps.test.ts` (3):
1. Each trap fixture traps `{kind, function: 1, offset: its instruction's}` on macOS arm64, Linux x86_64 and headless
   Chrome, all equal (`grow` traps before its result is stored).
2. `mapper_reports_unreachable`: the division by zero is reported `unreachable`; the kit FAILs, `trap.divide` FAIL with a
   failure of field `kind`, `expected: "divide"`, `actual: "unreachable"`.
3. `rewrite_grow_returns_minus_one`: `trap_grow.wat` runs on (no trap; memory reads −1 then 7); the kit FAILs,
   `trap.grow` FAIL and named in a failure.

Test count: 4 + 3 + 4 + 3 + 2 + 2 + 3 + 2 + 3 = 26.

## Oracle

The Oracle page pins upstream tests for criteria 1, 8 and 9; each counts only by what it asserts on our output. They
are used as the programs and assertions they hold, written again as this suite's fixtures (no upstream file is copied
into the repo):

- Criterion 1: wasmtime `canonicalize-nan-scalar.wast` reads f32 0 / 0 as 0x7fc00000 and f64 0 / 0 as
  0x7ff8000000000000 with NaN canonicalization on, and sqrt(−1) the same: `nan.wat` asserts those bits for 0 ÷ 0,
  sqrt(−1) and inf − inf on all three hosts. wasm-spec `f32.wast`/`f64.wast` fix the payload, not the sign; the exact
  bits are the issue's. wasmtime `fuel.wast` charges a memory.fill's bytes before it runs (assert_fuel 107 for 100
  bytes): `fuel_fill.wat` traps at its tenth fill with region 9 untouched. wasmtime `fuel.rs` iloop: `fuel_loop.wat`.
  wasm-spec `call.wast` runaway: `stack_small.wat` (the depth is ours). wasm-tools `v128-without-simd-feature.wast`:
  `refuse_vector.wat` (an instruction rather than a type, so the function is named).
- Criterion 8: wasm-tools `lime1.wast:72-102` and `missing-exceptions.wast`: `refuse_tail_call`, `refuse_multi_memory`,
  `refuse_exceptions`, `refuse_memory64`, `refuse_gc` (lime1's messages name the proposal; ours names it as
  `proposal`); lime1 admits extended constants, so `refuse_extended_const` is ours.
- Criterion 9: wasm-spec `traps.wast` (div_s by 0, div_s of 0x80000000 by −1, trunc_f32_s of NaN, a load at 65536 in
  a one-page memory), `unreachable.wast`, `call_indirect.wast` ("indirect call type mismatch"); wasmtime `traps.rs`
  reads a trap's function index and module offset: `trap_*.wat`, offsets read off the assembler's listing.

## Readings where the issue leaves a choice

- **"In the app"** is wasmtime 49.0.5 driven by the sandbox module's own code: `deep-sandbox` on macOS arm64 (the kit
  also through deep-show's `kit`, which the app's build seals) and the same binary built for Linux x86_64. **"Headless
  Chrome's own WebAssembly engine"** is the web runner's `run` on the native rewrite's bytes: the browser checks and
  rewrites nothing (the web player runs what the app checked), so the refusal fixtures are compared on the two native
  hosts.
- **Functions and offsets** are the program's own (before the rewrite), so they can be compared with the assembler's
  listing and across engines; a fuel or stack trap's offset is only required to lie in its function's body and to
  agree across hosts, except the fill's, which is its `memory.fill` ("at its tenth fill").
- **"The stack ladder … at 64 KiB and at 256 KiB"** reads the two sizes as the per-call stack cap (`budget.stack`); the
  largest frame is 1,000 i64 locals (8,088 bytes a call), so the ladder holds a few to tens of frames there and
  hundreds to thousands of the smallest.
- **"Rewriting a 1 MB program takes under 200 ms … as the logic module's rewrite does today"**: there is no logic
  module or rewrite at the merge base, so the comparison is the issue's 200 ms on the rewrite's own `ms`, read off the
  debug build as the suite runs it; "once at check" is the counts of test 2. **"Gains no work at check or per frame"**
  is a comparison with the merge base's `eval` nodes and `frames` counts and the sandbox module's own counters, so it
  holds on every machine.
- **"A test sandbox implementation that pins another wasmtime patch version"**: Cargo resolves one semver-compatible
  wasmtime per lockfile, so a test build can't link 49.0.5 and another patch; these tests read the pin from the
  implementation record and require the kit to pass bit for bit and the digest to stay. Since #2324, 49.0.5 is the only
  49.0 patch past every advisory published against 49.0.2, so the other patch may be of another release line (an exact
  `=X.Y.Z`); #2324's suite checks that it too is past those advisories. Whether the alt build links the
  version it pins isn't observable through these surfaces and isn't checked.
- **Naming**: an import as `{module, name}`; an instruction by its text-format name; a function by index; a global by
  index (the mutable funcref global and the extended constant are global 3, after the provider's three); a passive
  segment as `{kind: "data", index: 0}`; a limit as `{name, max, actual}`; a proposal by the names in the Refusal shape.
  `what` prose is never read.

## Not tested, because no criterion asks

`lib.interface@1` and `data.layout@1` as listed registries; linking (`lib:` imports, `needs`, the 16-library cap);
a role's missing export; the release gate on a kit ledger for `sandbox.alt`; the playtest plug-in's bot sandbox; the
logic module depending on sandbox (no logic module exists); a provider's content key naming the sandbox version; the
page bitmap and the rewrite's other counters; budgets per role.
