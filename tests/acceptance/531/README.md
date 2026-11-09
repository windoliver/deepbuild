# Acceptance tests for #531: the logic module, logic@1, a logic item at a fixed step under sandbox@1

Written first, from issue #531 (its Scope, Fields, twelve acceptance criteria and Proof line: "A fuel trap and a stack
trap at the same place on two machines, the table and memory.copy program in headless Chrome, and sandbox@1's refusal
fixtures named as logic programs"), its Oracle page (`doneright/oracles/issues/531.md` in DeepBuildAI/deepbuild, branch
`doneright`), the design sections it names and base commit `dd83ac2f` ("Merge pull request #1692 …"), by a job that never
saw an implementation; none existed, and no other branch or worktree was read. The implementing agent doesn't edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue, live with `gh issue view 531 --repo windoliver/deepbuild`, and its Oracle page: upstream tests for criteria
  1, 4, 6 and 10 (wasmtime `3c8a3e79aa` `tests/all/fuel.rs` iloop and custom_variable_operator_cost, `tests/all/fuel.wast`
  assert_fuel 107, `tests/all/traps.rs:728-762` parse_dwarf_info; wasm-spec `fffc6e12fa` `test/core/call.wast` runaway);
  the rest have none.
- `docs/canvas-primitives.md`: Logic beside physics; Logic `logic@1` (fields, exports, region map and `regions_digest`,
  semantics: the read region's layout per control, the seed hash(the document's seed, the logic ID, k), `init` gets step 0's
  seed, a write region past memory refused at check, a trap freezes only its item); Logic: sandbox (the subset, the rewrite
  with fuel per block and per byte of memory.copy and memory.fill, stack per call at 8 bytes a slot plus 64, the start
  function as an export run once, the page bitmap, the trap kinds, the program roles); Logic: checkpoints and bake
  (checkpoint `{step, deep_hash, memory, globals}`, the step hash, the bake, restores into a fresh instance that never
  rerun the start function or `init`); Logic: readings; Input track; Tour; Check input: logic kinds (`logic.trap {item,
  step, t, kind, function, offset, inputs}`, `logic.budget`, logic.determinism's continuation probes); Phase.
- `docs/technical-design.md`: The logic module (Logic; Sandbox and budgets; Logic bake and checks); Dogfooding. AGENTS.md.
- At the base: `crates/deep-canvas-sandbox` (check, rewrite, trap kinds, kit and `kit/kit.json` with its refusal
  fixtures), `crates/deep-sandbox-wasmtime` (`deep-sandbox`, `service.rs`, `Runner::call`'s watchdog thread at
  `src/lib.rs:165-173`, `web/runner.mjs`), `crates/deep-canvas-input` (track, tour), `crates/deep-show/src/main.rs` (`run`
  calls; `eval`'s `arrays`), and the suites `tests/acceptance/238/` (the pattern this suite follows: its README, helpers.ts,
  its assembler crate), `497/`, `308/`, `387/`.

What the base already does, which these tests don't credit: sandbox@1 (#238) checks, rewrites and runs providers,
validators and registry programs, and `deep-sandbox` serves that; `KNOWN_MODULES` names `logic` in `full`, but no logic
module exists. There is no `deep-logic`, no logic role in sandbox@1, no page bitmap, no step runtime, no checkpoints, no
`logic.trap` or `logic.budget`, and none of this suite's calls or planted names.

## Run them

```sh
npm ci                          # once, if node_modules is missing
docker pull --platform linux/amd64 rust:1.99.1-slim-bookworm   # once: the Linux x86_64 host (the channel rust-toolchain.toml names)
export PATH=/opt/homebrew/opt/rustup/bin:$PATH                 # rustup's cargo (helpers.ts also adds it when present)
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/531 --no-file-parallelism
npx tsc -p tests/acceptance/531/tsconfig.json
rm -rf tests/acceptance/531/node_modules/.vite
```

What a run builds (all honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set):

- **The assembler** `tests/acceptance/531/wat/` (crate `acceptance-531-wat`, a copy of #238's with exports and the start
  function added to its listing; `wat =1.263.0`, `wasmparser =0.263.0`; outside the workspace by its empty `[workspace]`
  table, its own `Cargo.lock`), into `target/acceptance-531-wat/`. It turns the programs in `programs.ts` into bytes and
  lists each function body's operators with their module offsets, the exports and the start function.
- **The Rust program** `tests/acceptance/531/rules/` (crate `acceptance-531-rules`, no dependencies, outside the
  workspace), `cargo build --locked --release --target wasm32-unknown-unknown` (rust-toolchain.toml installs that target)
  into `target/acceptance-531-rules/`, release profile with `debug = 2`, `opt-level = 1`, `panic = "abort"`, and link
  arguments (build.rs) for one memory of two pages whose maximum is its minimum.
- **`deep-logic`** for this Mac: `cargo build --locked --bin deep-logic` in the checkout.
- **`deep-logic` for Linux x86_64**: the same command in `docker run --platform linux/amd64` with `rust:<channel>-slim-bookworm`
  (`<channel>` from `rust-toolchain.toml`, today `1.99.1`; `RUSTUP_TOOLCHAIN` set to it), the checkout mounted read-only,
  its target folder and cargo registry and git caches under `target/acceptance-531-linux/`. Nothing is pulled. The image
  is looked up per platform (`docker image inspect --platform linux/amd64`), so a tag that names a multi-platform index
  (Docker 29's containerd store) is found.
- **`deep-sandbox`** for this Mac (#238's runner): `cargo build --locked --bin deep-sandbox`.
- **Headless Chrome** at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` (or `CHROME_BIN`), as #238's suite
  runs it: a page on `127.0.0.1` imports the web runner's source and runs each request through its `bake`; Chrome runs
  with its own temporary profile and is stopped by its PID (its own process group).

Every test passes an explicit timeout (90 minutes: the Linux build runs under emulation). Temporary folders (binaries,
Chrome profiles, assembler output) are deleted. Node built-ins and vitest only. `scripts/lanes.mjs` needs
`'tests/acceptance/531/'` added to its `alone` list (the files build cargo binaries, start Docker and Chrome, and
criterion 12 counts a process's threads); this README is the instruction, and the implementer makes that edit.

Gates: a missing host is `BLOCKED:` (a failed test, never a pass): no Docker or no linux/amd64 image of the toolchain
names the `docker pull` command; no Chrome names `CHROME_BIN`; an assembler or Rust program that doesn't build names
cargo's error. Criterion 12 needs at least 20 thread readings during the run to step 1,000; with fewer it skips as
`INCONCLUSIVE` (a changed count still fails).

`BASE-FAILURE.txt` is the run at the base (see its first lines for the counts and why).

The harness was checked against real components before that run: every program in `programs.ts` and every refusal
fixture of sandbox@1's kit assembles; run unrewritten in Node's own WebAssembly, `quiz` gives `shuffleOf(seed)`, `lookup`
gives `lookupValue(lookupIndex(k))` with both counts 1, `table_copy` runs 1,300 steps without a trap, `nine_fills` fills to
the last byte of its 160 pages, and `recurse` overflows; the Rust program builds, its `.debug_*` sections split off into a
sidecar, `reads_at` and `writes_at` are exported immutable globals, and its step traps "divide by zero" at
`wasm-function[1]:0x30a`, the module's one `i32.div_u`, which its DWARF line table (`xcrun dwarfdump --debug-line`) puts at
rules.rs:42, with rules.rs:10, 20 and 30 on the three loops; headless Chrome serves the page and runs a throwaway runner's
`bake`; `docker run --platform linux/amd64 rust:1.99.1-slim-bookworm uname -m` answers `x86_64`.

## The surface under test

The issue names a canvas module, its fields, `logic.trap`, `logic.budget`, a sidecar on the item, an engine in the app
and the browser's own engine, and planted twins, but no command line. **Every name below that the issue or the design
doesn't give is this job's invention**, the smallest surface the criteria need; the implementer builds exactly these, or a
dispute goes to a blind redraft. As in #238's suite, "in the app" is the logic module's own code on wasmtime 49.0.2
through `deep-logic` (the code deep-show seals; no copy), and "headless Chrome's own WebAssembly engine" is the web
runner on the bytes the app rewrote.

### `deep-logic`: the logic module's runner

A binary target named `deep-logic` in a workspace crate of the implementer's choosing, built by `cargo build --locked
--bin deep-logic`, that runs the logic module's check, its per-step runtime, checkpoints, restores and reports on
sandbox@1's check, rewrite and engine (#238), and builds and runs on macOS arm64 and Linux x86_64 (glibc). It reads JSON
lines on stdin and answers each with exactly one JSON line, in order, then exits 0 at end of input. A line that isn't JSON
or lacks a required field answers `{"ok": false, "code": "bad_input"}`. `deep-logic --planted <name>` runs the same binary
with one planted twin (below); an unknown name writes one `{"ok": false, "code": "bad_input"}` line and exits 2. Within one
process, every layout a `check` (or `bake`, `open`, `web_plan`) has computed is the history the regions_digest check
names entries from (Layouts, below).

| Call | Reply |
|---|---|
| `{"call": "about"}` | `{"interface": "logic@1", "sandbox": "sandbox@1", "engine": {"name": "wasmtime", "version": "49.0.2"}, "arch", "os"}` |
| `{"call": "check", "piece": Piece}` | every item checked in the piece's item order: `{"ok": true, "items": {<logic ID>: Checked}}`, or the first refused item's `Refused` |
| `{"call": "bake", "piece", "track"?: [Entry] = [], "steps": n, "restores"?: [Restore], "probes"?: [Probe], "peek"?: [Peek]}` | the check first (a refusal answers as `check` does), then `Bake` |
| `{"call": "web_plan", …the fields of bake}` | `{"ok": true, "request": WebBake}`: the request the web runner takes for the same bake, holding the bytes the app rewrote (the browser checks and rewrites nothing) |
| `{"call": "web_runner"}` | `{"source": string}`: the web player's logic runtime as one self-contained ES module (no imports), exporting `async function bake(request: WebBake) → Bake`, which runs the rewritten bytes with the browser's own `WebAssembly` API and answers as `bake` does (`items` and `budgets` may be left out) |
| `{"call": "open", "piece", "track"?}` | a session: `{"ok": true, "session": string, "items": {<logic ID>: Checked}}` (or the check's refusal) |
| `{"call": "step", "session", "to": k}` | runs the session's steps up to and including step k: `{"ok": true, "step": k, "failed": [logic ID]}` (the items that have trapped so far) |

```text
Piece   = {"seed": integer (the document's seed), "controls"?: {<control ID>: {"kind": "slider"}},
           "tour"?: Tour, "items": {<logic ID>: {"kind": "logic@1", "params": LogicParams}},
           "assets": {<sha256 hex>: base64}}            // every program and sidecar the items name, by its bytes' sha256
LogicParams = logic@1's fields; these tests use program (asset ID), debug? (asset ID), step_rate? (Hz, 60),
           reads? ([control ID | "<logic ID>.<name>"]), writes ({name → {type, count?}}), budget? ({fuel?, memory? (MiB),
           stack? (KiB)}), checkpoint? ({every?, budget?})
Tour    = the Tour fields: {"keys": {<control ID>: [[t_s, value, "hold"]]}, "idle_after", "resume_after", "loop"}
Entry   = {"t": flick, "seq": u32, "control": control ID, "value": number, "writer": "you" | "tour", "player": 1}
Checked = {"program": sha256 of the program as given, "hash": sha256 of the rewritten bytes that run, "layout": Layout}
Layout  = {"digest": 16 lowercase hex digits (the layout digest, a u64),
           "entries": [{"region": "reads" | "writes", "name", "offset", "size", "type"}]}
Refused = {"ok": false, "code": "subset_refused" | "logic_refused", "item": logic ID, "refusals": [Refusal]}
Restore = {"from": c, "steps": n, "probe"?: {"entries": [Entry], "steps": m}}
Probe   = {"at": c, "entries": [Entry], "steps": m}
Peek    = {"item": logic ID, "at": byte address, "len": bytes}
Bake    = {"ok": true, "items": {<logic ID>: Checked}, "steps": [StepRecord], "checkpoints": {<logic ID>: [Checkpoint]},
           "traps": [LogicTrap], "budgets": [LogicBudget], "restores": [RestoreResult], "probes": [ProbeResult],
           "peeks": [{"item", "at", "len", "hex"}], "track": [Entry]}
StepRecord  = {"step": k, "t": flick, "items": {<logic ID>: {"hash": 16 hex | null, "fuel": integer, "failed": bool,
               "pages": [page index]}}, "arrays": {"<logic ID>.<name>": [value]}}
Checkpoint  = {"step": c, "deep_hash": 16 hex}
LogicTrap   = {"item", "step": k | null, "t": flick | null, "kind", "function", "offset", "inputs": [Entry], "source"?: "file:line"}
LogicBudget = {"item", "step": the worst step, "fuel": its fuel, "lines": [{"source": "file:line", "fuel"}]}
RestoreResult = {"from": c, "checkpoints": {<logic ID>: [Checkpoint]}, "steps": [StepRecord], "probe": ProbeResult | null}
ProbeResult = {"at": c, "steps": [StepRecord], "deep_hash": {<logic ID>: 16 hex}}
```

What each field means:

- **Steps.** A bake runs steps 0 to n − 1 of every item, step k at k × the item's step length (705,600,000 ÷ step_rate
  flicks). Step k reads the track's entries of each read control with `t` in ((k − 1) × length, k × length] (step 0:
  `t` ≤ 0); the tests put every entry exactly on a step's flick. A piece with a `tour` and no entries of yours plays its
  tour's keys as entries of writer `tour`, at `idle_after` + `t_s` (Tour; the input module's rule); `track` in the reply
  is the input track the bake read, the tour's entries included.
- **A step record** holds, per item, its step hash (`hash`, null once the item has failed), the fuel that step's call used
  (`fuel`, from the rewrite's counter), `failed` (it trapped at this step or before) and `pages` (the page bitmap once the
  step ended: every 64 KiB page index the step's stores, memory.fills and memory.copys touched, with the pages the logic
  module's own writes touched, ascending). `arrays` holds every item's arrays as that step left them, read as
  `<logic ID>.<name>`: a list of `count` values, each an i32 or f64 number, a bool, or a list of numbers for vec2, vec3
  and quat. A failed item's arrays keep the last good step's values.
- **Checkpoints** are the item's checkpoints (Logic: checkpoints and bake), the first once the start function and `init`
  have run, before step 0 (`step: 0` names the state before step 0 runs, `step: c` the state before step c), then every
  `checkpoint.every` steps up to and including step n (the state after the last step). `deep_hash` is the full state's
  hash over memory, globals, arrays and the input position; the rewrite's own counters and its page bitmap are in no
  checkpoint and no hash.
- **A restore** loads the straight run's checkpoint at step c into a fresh instance (never running the start function or
  `init` again) and runs steps c to c + n − 1 on the same track; its `checkpoints` are those it reaches from c (c itself
  first) to c + n. **A probe** feeds a state at checkpoint c the same next inputs: the track's entries at or after step c
  are replaced by the probe's `entries`, then m steps run; `probes` are from the straight run's states and a restore's
  `probe` from its restored state. `deep_hash` is each item's after the probe's last step.
- **A trap** stops only its item: `traps` holds one `LogicTrap` (the design's `logic.trap`) per trapped item: the step
  and its time (`null` for a trap in the start function or `init`, before step 0), the kind (Logic: sandbox's trap kinds),
  the function index and byte offset in the program as given (before the rewrite), the entries that step read, and, with
  the item's `debug` sidecar named, `source`: the program's own source line, read through the rewrite's offset map and the
  sidecar's DWARF (absent or null without it).
- **`budgets`** holds the design's `logic.budget` report per item: the bake's worst step (most fuel), its fuel, and with a
  sidecar the three source lines that spent the most fuel in that step, most first, each with its fuel from the rewrite's
  per-block counts (`[]` without a sidecar).
- **`peek`** reads an item's memory when the bake ended (for a failed item, as its trap left it), as lowercase hex.
- **Layouts.** `layout.entries` is the item's region map (Logic `logic@1`: Region map): its read region's entries in
  declaration order (each read control's slot, each read array, then the step's seed as the entry named `seed`, type
  `i64`), then its write region's entries in declaration order; offsets are from each region's start (`reads_at`,
  `writes_at`). Each read control's slot is laid out as the design gives it (a u32 count, 4 zero bytes, then up to 16
  entries, each a u32 player, 4 zero bytes and the value), and a slider's value is an f64. `digest` is the layout digest;
  a program exports it as the immutable i64 global `regions_digest` holding those 64 bits. A program whose
  `regions_digest` differs is refused (`logic_refused`) with a refusal holding `entry: {region, name}`: the first entry, in
  the item's declaration order, whose offset differs from the layout of the item's history whose digest the program
  exports. This suite's programs rely on the first read entry and the first write entry being at offset 0, and check
  that in the reply before relying on it.
- **Refusals.** `subset_refused` carries sandbox@1's report as `deep-sandbox check` gives it for the same bytes in the
  role `logic`, Refusal for Refusal. `logic_refused` carries the logic module's own refusals, each `{"rule", "what", …}`
  (rule and what are the implementer's and never compared) with the naming field the tests read: `write` (a declared
  write that isn't the item's own array, by its declared name), `region` (`"reads"` or `"writes"`: a region past the end
  of memory) or `entry` (above). The reply's `item` names the refused item.
- **Sidecars.** The item's `debug` names an asset: a WebAssembly module (header and custom sections only) holding the
  `.debug_*` custom sections of the build, whose program is that build's module with every `.debug_*` section taken
  out, so DWARF's code offsets stand for the program as given. The sidecar never changes `program`, `hash`, any step hash,
  deep hash or array.
- **Sessions.** `open` and `step` run the same steps as a bake, in one process, so a test can watch the process between
  and during calls; a step at run time starts no thread (fuel bounds it; no deadline watchdog).

### deep-sandbox: the logic role

sandbox@1 gains the program role a logic item names (Logic: sandbox, program roles): `deep-sandbox`'s `check` and
`rewrite` take `"role": "logic"` (exports `memory`, `init`, `step` and the immutable globals `reads_at` and `writes_at`),
and the logic module's `hash` is the sha256 `deep-sandbox rewrite` gives for the same program in that role.

### Planted twins of `deep-logic` (`--planted <name>`)

Each is one criterion's wrong program, reachable only through this argument, and changes nothing else:

| Name | Criterion | The wrong program |
|---|---|---|
| `tracker_skips_memory_copy` | 7 | the rewrite's page tracker doesn't mark the pages a memory.copy writes |
| `runs_unchecked` | 8 | the logic module hands an item's program to the engine as the agent built it, without sandbox@1's check and rewrite |
| `digest_compares_total_sizes` | 9 | on a `regions_digest` that differs, the check compares only the two layouts' regions' total sizes |
| `mapper_ignores_fuel_shift` | 10 | the source mapper looks up the rewritten program's offset in the DWARF directly, ignoring the shift the fuel rewrite adds |
| `budget_charges_function_first_line` | 11 | logic.budget charges each block's fuel to its function's first line |

## Programs

`programs.ts` holds this suite's logic programs as WebAssembly text (each comment says what it does and the item it is
built for); those that read a region entry past a first one are built against the item's layout as `check` reports it,
read first with `layout_probe` (a program built for no layout). `spin`, `tally`, `recurse` (frames of 8 × 3 + 64 = 88
bytes), `quiz` (a xorshift64 Fisher–Yates of five questions, mirrored by `shuffleOf`), `nine_fills`, `table_copy`, `lookup`,
`start_forever`, `write_past_memory`, `touch_pages` and `quiet_pages`, `logic_import`, `aim` and `levels`, `work`. The Rust
program is `rules/src/lib.rs` and `rules/src/rules.rs` (loops on rules.rs:10, 20 and 30 inside `work`, whose first line is
rules.rs:6; the division on rules.rs:42 inside `judge`). sandbox@1's refusal fixtures are read from
`crates/deep-canvas-sandbox/kit/` at the checkout under test (every `refuse.*` fixture in `kit.json`), `refuse.over_4mib`
padded from `pass_subset.wat` to 4,194,305 bytes as #238's kit pads it.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white
space collapsed. Each test's name starts with its criterion's ID.

| ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| 1 `#531.024523a2` | `ac01-fuel-stack.test.ts` (3) | `spin` (reads `go`) and `tally` in one piece, a `go` entry at step 10: one trap, `spin`'s, kind fuel at step 10 in function 2's body, its inputs the go entry, the same function and offset in two processes; `spin.k` keeps 9 from step 10 on and `tally.k` reads k at every step of 30. `recurse` at stack caps of 64 and 256 KiB traps kind stack in function 2 at a depth within 5% of cap ÷ 88 (peeked). On Linux x86_64 the same traps, offsets, entries and depths as macOS. Fails: wasmtime's own fuel or limit, a trap that stops the piece, arrays cleared or advanced after a trap, a host whose offsets or depths differ |
| 2 `#531.7cbe85cc` | `ac02-seed.test.ts` (2) | the quiz, a start entry at 2.0 s (step 120): played, restored from checkpoints 60, 120 and 180, and replayed by its tour (a key at 0.6 s after idle_after 1.4 s, the track holding that tour entry), the order is [0,1,2,3,4] before step 120 and `shuffleOf(step 120's seed)` after, the same at every step; three other document seeds each shuffle by their own seed and not all give the same order. Step k's seed is the same with the same document seed and ID at 30 Hz beside another item with another track, and differs with another ID, another document seed and another k (60 steps). Fails: a seed of the step's time, of the item's index or a run counter, a seek or tour replay that misses the entry |
| 3 `#531.cbdb60cc` | `ac03-writes.test.ts` (1) | writes declared as `items/badge/params/paint`, `world.positions`, `checks/score_check/expect` and `record/verdicts/score` are each `logic_refused` naming item `scorer` and the write; a write named `score` is admitted. Fails: a check that admits any write name |
| 4 `#531.f2a68f95` | `ac04-fill-fuel.test.ts` (1) | under fuel 10,000,000 and memory 16 MiB, step 1's nine 1 MiB fills record ≥ 9,437,184 and ≤ 10,000,000 fuel without a trap; steps 0 and 2 record more than 0 and under 1 MiB. Fails: fills charged per instruction, not per byte |
| 5 `#531.50a7adee` | `ac05-checkpoints.test.ts` (2) | `table_copy` with seeded nudges over 1,200 steps checkpoints at 0, 60, …, 1,200; restores from each of 0 to 600 run 600 steps with the straight run's deep hashes at each checkpoint, step hashes and arrays, and probes (a nudge at c + 3, 60 steps) equal from both states; Chrome's bake of `web_plan`'s request gives all of the app's values. Fails: a checkpoint missing globals or memory, a restore that reruns init, an engine whose call_indirect, memory.copy or hash differs in the browser |
| 6 `#531.8f04cd7e` | `ac06-start.test.ts` (3) | `lookup` (start function 2): a restore from step 0 gives the first checkpoint's deep hash and every step hash of the straight run, and every step reads `lookupValue(lookupIndex(k))` with start and init counts 1 in both; `start_forever` traps kind fuel with step null in function 2 (the start function) and the item stays failed; `write_past_memory` is `logic_refused` naming item `edge` and region `writes`. Fails: a first checkpoint before the start function, a restore that runs it or init again, a start function run without fuel, a write region checked only at run time |
| 7 `#531.8b2a1747` | `ac07-pages.test.ts` (3) | `touch_pages` marks exactly {0, 3}, {0, 3, 4}, {0, 5, 6}, {0, 1, 7} by k mod 4 over 16 steps; `quiet_pages` marks {0}; their deep hashes at every checkpoint (every 4) and restore and their step hashes are equal; Chrome marks the same pages; `tracker_skips_memory_copy` fails first at step 2, page 5, and only on memory.copy's pages. Fails: a bitmap that misses an instruction, a diff of memory in place of a bitmap, a hash or checkpoint that holds the bitmap or the fuel counter |
| 8 `#531.95fffd8f` | `ac08-admission.test.ts` (3) | each of sandbox@1's 15 kit refusal fixtures as item `prog_<fixture>`'s program is `subset_refused`, naming the item, with refusals equal to `deep-sandbox check`'s in the role logic; `logic_import` is refused naming `env.forbidden_fn` and item `imp`; `tally`'s `hash` is `deep-sandbox rewrite`'s and not its built bytes' sha256, in check and bake; `runs_unchecked` admits or runs `logic_import` and fails, naming item `imp`. Fails: a logic module with its own check, or one that runs programs unrewritten |
| 9 `#531.9a08f4d0` | `ac09-regions-digest.test.ts` (3) | v1, v2 (c2 added) and v3 (another order) have three digests; at v2 a program with no digest and one exporting v2's digest pass; one exporting v1's is `logic_refused`, naming item `aim` and the entry `c2` or `src.level` (never `c1`); at v1 one exporting v3's is refused naming `c1`, and `digest_compares_total_sizes` admits it and fails, naming c1. Fails: no comparison, a refusal that names nothing, a total-size comparison |
| 10 `#531.1b30f7a8` | `ac10-trap-source.test.ts` (3) | the Rust program, a boom entry of 0 at step 12: kind divide at step 12 in `judge` at its i32.div_u (the program as given), `source` ending `rules.rs:42` in two processes; with and without the sidecar the same `program`, `hash` and step hashes, and without it the same function and offset with no source; `mapper_ignores_fuel_shift` names another line, failing with the trap named. Fails: a sidecar hashed into the program, a mapper without the offset map |
| 11 `#531.6b6fc913` | `ac11-budget-lines.test.ts` (2) | the Rust program over 12 steps: step 7 is the worst; logic.budget names step 7 and its fuel and the lines rules.rs:10, 20, 30 in that order, each ≥ its iterations, in proportion 3 : 2 : 1 within 10%, together ≤ the step's fuel; `budget_charges_function_first_line` names one line and misses all three. Fails: lines by instruction count, by function, or out of order |
| 12 `#531.ff4975c5` | `ac12-threads.test.ts` (1) | ten `work` items at 60 Hz: `open`, `step` to 1, the thread count (`ps -M`) as baseline, `step` to 1,000 while reading it again and again, and after: every reading equals the baseline, every item ran (no failed); under 20 readings is INCONCLUSIVE. Fails: a watchdog thread per call, a thread per item started at run time |

Test count: 3 + 2 + 1 + 1 + 2 + 3 + 3 + 3 + 3 + 3 + 2 + 1 = 27.

## Oracle

The Oracle page pins upstream tests for criteria 1, 4, 6 and 10; each counts only by what it asserts on our output.
They are used as the programs and assertions they hold, written again here (no upstream file is copied in):
wasmtime `fuel.rs` iloop (a loop that never ends, in a step or a start function, stops with out-of-fuel): `spin` and
`start_forever`; wasm-spec `call.wast` runaway (exhaustion; the depth is ours): `recurse`; wasmtime `fuel.wast` assert_fuel
107 and `fuel.rs` custom_variable_operator_cost (memory.fill charged per byte, up front): `nine_fills` (the 9,437,184 is the
issue's); wasmtime `traps.rs` parse_dwarf_info (a Rust program built with debug info whose trap resolves through DWARF to
its line): the Rust program and rules.rs:42.

## Readings where the issue leaves a choice

- **The surface.** A runner binary of the logic module's own, as #238's `deep-sandbox` is the sandbox module's, because the
  criteria need Linux x86_64 (deep-show's `full` build pulls in the macOS app), the web runner, planted twins and a
  process whose threads a test counts; deep-show's documents, `eval` and the seal aren't asked by any criterion and aren't
  driven.
- **"Hash(document seed, logic ID, k)"** names the hash's inputs, not its function: tested as a function of exactly those
  three (equal across step rates, other items and tracks; different for another ID, document seed or k), and the quiz's
  order as a function of the seed a step read.
- **"Shows the same order when played, seeked and replayed by its tour"**: played is a bake with an entry of yours,
  seeked is a restore from a checkpoint before, at and after the entry's step, and the tour replay is the same piece's
  tour with no entry of yours, at the same flick.
- **"Another canvas module's array"** and the rest of criterion 3 are declared write names that name something else; the
  logic module's check refuses them by name, and the test reads the refusal's `write`.
- **"Naming the first entry whose offset differs"** when a control was added: `c2` has no offset in the old layout and
  `src.level` moved, so either is accepted; `c1`, which didn't move, never is. The check finds the old layout among the
  layouts it computed before in the same process (the item's history), since a digest alone can't name an entry.
- **"Before step 0, naming it"**: `step: null` and the start function's index.
- **"Before wasmtime's own stack limit"**: kind stack at the depth the rewrite's charge reaches (within 5% of cap ÷ 88).
- **"Each with its fuel from the rewrite's per-block counts"**: proportions and bounds the counts must give (above);
  the counts themselves aren't on the surface.
- **"Fails, naming …"** for each twin: the test's own judgement of the twin's output fails, and its message names the
  page, the item, the entry, the trap or the lines.
- **"The process's thread count"** is `deep-logic`'s, read from outside with `ps -M`, at step 1, during the run and at
  step 1,000.

## Not tested, because no criterion reaches it here

Saves and "the globals a save matches" (criterion 7's save clause: Logic: saves is its own task and no save surface
exists); deep-show's sealing of the logic module and its documents; readings, `fires`, assets, links, emits, preview,
pages, parallel, services, mirrors, the turn clock and interpolated writes; a read region past memory (kind bounds);
checkpoint spacing doubling past its byte budget; `logic.determinism`'s cross-machine golden; `init` getting step 0's seed.
