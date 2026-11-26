# Acceptance tests for #2662: a logic step copies only what it changes and a program compiles once

Written first, from issue #2662 (its five findings, its scope, its six acceptance criteria and its proof line), the
design sections it links (canvas primitives: Logic `logic@1`, Checkpoint ring, The cost model), the audit write-up it
cites (`reports/hillclimb-audit-2026-11-09/05-rust-runtime.md`: F8, F10, F12, F13, F17) and base commit `3c500c0c8`
("Merge pull request #3097 …", origin/main), by a job that never saw an implementation; none existed. The implementing
agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read at the base: `crates/deep-logic/src/world.rs` (`Record`, `Live`, `report`, `Stored`) and
`world/world_impl.rs` (`World::new`, `run_while` and its `self.published.clone()`, `step`, `checkpoint`, `seek`,
`restore`, `revive`, `load`, `fork`, `array`, `peek`, `deep_hashes`); `live.rs` (`View`, `build`, the render worker,
which keeps its session's record for `baked`, and the pipelined view's logic thread, which steps with
`&mut Record::default()`); `bake.rs` (`ranges`, `Record::whole`); `budget.rs` (`pipelined`, `RATES`); `planted.rs`;
`track.rs`; `lib.rs`'s calls (`bake`, `golden`, `golden_verify`, `view`); `src/tests.rs` (how a piece is written);
`crates/deep-sandbox-wasmtime/src/lib.rs` (`Runner::sized`, `call`, `Faults`); `crates/deep-canvas-sandbox/src/`
`rewrite.rs` (`rewrite_as` and its function validator) and `check.rs` (`check`, `check_role`, `Limits`, `Refusal`);
`scripts/proof-change.mjs`, `proof-runs.mjs`, `lanes.mjs` (what the lanes run and judge); and the suites
`tests/acceptance/2657/`, `3024/`, `2661/` (Rust acceptance tests a crate's `[[test]]` runs, a counting global
allocator, a base run with a reverted probe), `531/`, `532/`, `546/` and `238/` (READMEs and fixtures).

## Run them

Six files are Rust integration tests of `deep-logic` and one of `deep-canvas-sandbox`, the crates the issue changes;
they reach them, and `deep-sandbox-wasmtime`, through their public entries. **The implementer adds these entries**
(this job may write only here):

```toml
# crates/deep-logic/Cargo.toml
# Issue #2662: the acceptance tests, written blind in tests/acceptance/2662.
[[test]]
name = "acceptance_2662_step_bytes"
path = "../../tests/acceptance/2662/step_bytes.rs"

[[test]]
name = "acceptance_2662_seek_compiles"
path = "../../tests/acceptance/2662/seek_compiles.rs"

[[test]]
name = "acceptance_2662_forks"
path = "../../tests/acceptance/2662/forks.rs"

[[test]]
name = "acceptance_2662_forks_planted"
path = "../../tests/acceptance/2662/forks_planted.rs"

[[test]]
name = "acceptance_2662_live_record"
path = "../../tests/acceptance/2662/live_record.rs"

[[test]]
name = "acceptance_2662_goldens"
path = "../../tests/acceptance/2662/goldens.rs"
```

```toml
# crates/deep-canvas-sandbox/Cargo.toml
# Issue #2662: the acceptance tests, written blind in tests/acceptance/2662.
[[test]]
name = "acceptance_2662_check_allocations"
path = "../../tests/acceptance/2662/check_allocations.rs"
```

```sh
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node scripts/throttle.mjs build --wait 120 -- \
  cargo test --locked -p deep-logic --no-fail-fast \
  --test acceptance_2662_step_bytes --test acceptance_2662_seek_compiles --test acceptance_2662_forks \
  --test acceptance_2662_forks_planted --test acceptance_2662_live_record --test acceptance_2662_goldens
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node scripts/throttle.mjs build --wait 120 -- \
  cargo test --locked -p deep-canvas-sandbox --no-fail-fast --test acceptance_2662_check_allocations
```

Each file is its own test binary, so a surface one criterion needs and the base lacks fails that file's build alone.
`common.rs` (the logic files) and `forks_common.rs` (the two fork files) are shared by `mod`. No test reads a timing,
needs a GPU, a network or `--test-threads=1`, or starts a process. The two heap counts are per thread (a counting
global allocator that counts only the thread that turned it on); the two process-wide counters
(`deep_sandbox_wasmtime::compiles()`, `deep_logic::world::record_values()`) are each read by a file that holds one
test. They ran here under a load of 13 to 34 with the same counts each time. No lanes entry is needed: they run where
`cargo test --workspace` runs (no vitest file, so no `lane.json`, and no `twins.json`: the lanes' before and trace
runs read `.test.ts`/`.test.mjs` files only, as with #2657 and #3024).

The sixth criterion's suites and budgets are run as they stand, unchanged; this job ran none of them:

```sh
npm ci   # once, if node_modules is missing
docker pull --platform linux/amd64 rust:1.99.1-slim-bookworm   # once, as those suites' READMEs say
for s in 532 546; do
  NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node scripts/throttle.mjs build --wait 120 -- \
    npx vitest run --root tests/acceptance/$s --testTimeout=600000 --no-file-parallelism
done
```

`canvas-logic-budgets` and `logic-between-steps` are judged where every task of `benchmarks/budgets.json` is: by
`scripts/perf.mjs` against the merge base, in a budget window on a reference Mac (`scripts/budget-window.mjs`), whose
`judgeTask` reads each side's instructions retired and judges them by `judgeInstructions` (a rise over 2% FAILs; PASS
needs the rise ruled out). "Retire no more instructions than on the merge base" is that verdict for the two tasks. No
test here repeats it: on the merge base both sides are one program, so a test of it could fail on no wrong program
this job can name (AGENTS.md, Proof), and the tasks take a budget window.

## Surfaces

Three names are this job's; the issue gives none. Each is the smallest that lets its criterion be read, and none
changes a step's bits, a hash, a golden or a trap. At the base the three files that use them don't build, each error
naming the missing surface (`BASE-FAILURE.txt`, run 1).

1. **`deep_sandbox_wasmtime::compiles() -> u64`**, at the crate root (native targets): how many WebAssembly modules
   this process has compiled, one for each `wasmtime::Module::new` (or any other call that compiles a module's code),
   whoever asked; process-wide, monotonic. Instantiating a compiled module doesn't count. (AC2: "compiles its module
   once, counted by the test".)
2. **`deep_logic::world::record_values() -> u64`**: how many step rows this process's worlds have built for a
   `Record`: one each time a step of an item builds its row (at the base, each call of `world.rs`'s `report`, which
   builds the row's JSON value and each write's hash value); process-wide, monotonic. A step that builds nothing for
   its record adds nothing. (AC5: "builds no record value, counted by the test".)
3. **`deep_logic::Planted::forks_share_store: bool`**: AC2's wrong program, "a planted runner that shares one store
   between two forks": the forks made from one world (`World::fork`) run each item on one store (one instance: its
   memory, globals and fuel), the one the world's first fork of that item was given, so a step of either fork writes
   the other's memory. The tests set the field directly; a `--planted` name for it is not needed here.

How a live step says it keeps no record (the scope's "a live step can say it keeps no record") is the implementer's;
the tests never name it. `live_record.rs` reads only what the view's steps built.

Existing surfaces read: `deep_logic::piece::{check, History, Piece, Item::{layout, write, step}}`,
`world::{World::{new, run, run_through, seek, fork, array, peek, failed, deep_hashes, checkpoint_steps}, Record::{rows,
deep, traps}, track_of, Entry, Given}`, `live::{View::{open, frame}, Latched}`, `budget::pipelined`, `Logic::{new,
handle}` (the calls `bake`, `golden`, `golden_verify`), `Planted::replay_changes_step_37`,
`deep_canvas_sandbox::{check::{check, check_role, Limits, Refusal::to_json}, rewrite::{rewrite_as, hash, Faults,
Mode}}`, and the crates' own `wat`, `wasm-encoder`, `wasmparser`, `serde_json`, `sha2` and `base64`.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s `criterionId` (the first 8 hex digits of the SHA-256 of the criterion's text,
trimmed, white space collapsed), computed from the live issue. Each test's name starts `ac<N>_`, each is a top-level
test, and each failure message starts with the ID (an `INCONCLUSIVE:` one with `INCONCLUSIVE: ` and then the ID).

| ID | Criterion | Test | What it reads and asserts | Wrong programs it fails |
|---|---|---|---|---|
| `#2662.bce5379f` | AC1, bytes a step | `step_bytes.rs`: `ac1_a_step_of_one_item_among_100_allocates_no_copy_of_every_items_arrays` | 99 items at 30 Hz and `z` at 120 Hz, each with 65,536 bytes of arrays; `z` reads `a00.small` and writes two elements. One world on one record, stepped by time as a live view steps it. `z`'s step 5 (no other item steps then) asks this thread's heap for under 262,144 bytes. Guards: 100 items of 64 KB each; the call ran one step, of `z` alone, which wrote; `z` read `a00.small` as 0, 7, 7, 7, 7, 8 at its steps 0 to 5 (as earlier steps left it, also at steps 0 and 4, which `a00` runs first at the same time); nothing trapped | the base (6,757,909 bytes: a copy of every item's arrays); any step that copies arrays of items that don't write; a step that reads another item's arrays as its own group just wrote them, or that stops publishing what it wrote (the read guard) |
| `#2662.a74c0d37` | AC2, compiles | `seek_compiles.rs`: `ac2_a_seek_across_100_restores_of_one_item_compiles_its_module_once` | One item, a checkpoint every 4 steps, run to step 402; 100 `World::seek`s back to steps 396 … 0, two steps after each. `compiles()` across the world's start and the 100 restores rises by exactly 1. Guards: each restore's full-state hash is the straight run's at that checkpoint, and the two steps after it leave the straight run's rows (hash, fuel, pages) | the base (101: 100 in the restores); a restore that compiles; a restore from a shared module that doesn't start from the checkpoint's state |
| `#2662.a74c0d37` | AC2, the planted runner | `forks.rs`: `ac2_two_forks_of_one_item_each_keep_their_own_memory`; `forks_planted.rs`: `ac2_planted_forks_share_store_fails_naming_the_fork_whose_memory_changed` | Two forks A and B of one item at step 10. A steps five times: B's whole memory (65,536 bytes) is unchanged; B steps three times: A's is unchanged; the forked world's is unchanged; each fork's own steps change its own. The planted test runs the same check with `forks_share_store` and needs the problem "fork B's memory changed while fork A stepped" | `forks_share_store` (probe, BASE-FAILURE.txt run 2: it names fork B, then fork A); any runner whose forks share an instance |
| `#2662.393785f9` | AC3, forks' limits | `forks.rs`: `ac3_a_fork_run_to_its_fuel_traps_and_the_other_steps_on`, `ac3_a_fork_run_to_its_memory_limit_traps_and_the_other_steps_on`, `ac3_a_fork_that_traps_stays_failed_and_the_other_steps_on`; `forks_planted.rs`: `ac3_planted_forks_share_store_fails_the_fork_that_steps_on` | Fork A's track holds an entry at step 12 that sends its step to a limit: an endless loop (trap `fuel`), a `memory.grow` (trap `grow`), an `unreachable`. Fork B's holds none. Stepped in turn: A traps once, at step 12, with that kind, is failed and stays failed; its steps 10 and 11 and every step 10 to 19 of B leave the rows (hash, fuel, failed, pages) a straight run of the item leaves; B never traps. The planted test needs a problem about fork B's steps | `forks_share_store` (probe: every step of fork B from step 10 differs); forks that share fuel, a trap flag or memory; a fork whose trap fails the other |
| `#2662.5dd46ae5` | AC4, the check's allocations | `check_allocations.rs`: `ac4_a_check_of_a_1_mb_program_with_2000_functions_makes_2000_fewer_allocations` | A logic program of 1,071,102 bytes and 2,000 functions, built in the test. A check (`check::check` under the shipped limits, then `rewrite_as(.., Logic)`) makes at least 2,000 fewer allocator calls on this thread than the base's 2,670,020 (fixture). Guards: 2,000 function bodies, 1.0 to 1.15 MB, a logic item's exports, the program's SHA-256 is the fixture's (else `INCONCLUSIVE:`), two checks count alike; the admitted program's rewrite is the base's by SHA-256; five refused programs (a memory that grows, an import, a vector instruction in function 1,500, a type mismatch in function 1,000, a drop from an empty stack in function 1,999) each get the base's refusals and the base's answer from the rewrite, word for word | the base (0 fewer); a reuse that changes a stack height (the rewrite's hash) or a validation answer (the refusals) |
| `#2662.671c059c` | AC5, a live view's record | `live_record.rs`: `ac5_a_live_view_stepped_1000_times_with_no_reader_builds_no_record_value` | A `live::View` of one item at 30 Hz (pipelined: its steps run on the view's logic thread), 1,000 frames, one a step. `record_values()` rises by 0 across them. Guards: the item is pipelined; the last frame is at step 1,000, not stale, with no trap; the view's full-state hash after step 899 is the bake's checkpoint at step 900. Then `bake` of the same piece and 1,000 steps: its 1,000 step hashes, its checkpoints, and the SHA-256 of its steps, checkpoints, traps and ranges less their times are the base's (fixtures/live-bake.json) | the base (1,001 rows built and dropped); a view that steps nothing (the guards); a record that keeps nothing for a bake too, or a bake whose record differs by a bit |
| `#2662.7a6f9cf9` | AC6, suites, goldens, budgets | `goldens.rs`: `ac6_a_golden_recorded_on_the_merge_base_matches_step_for_step`, `ac6_planted_replay_changes_step_37_fails_the_merge_bases_golden_naming_step_37`; 532, 546 and the two budget tasks as they stand (Run them) | Three items at 60 Hz in one group (`b` reads `a.x`; `c` reads `a.x` and `b.y`; `a` reads a control with four entries), 240 steps, a checkpoint every 30. This build's `golden` has the base's step hashes and checkpoints for each item (fixtures/golden.json), and `golden_verify` of the base's golden reads PASS. The planted test runs the comparison on `replay_changes_step_37` and needs "a's step 37" named | any change of a step's bits, a hash or a checkpoint; `replay_changes_step_37` at the base (it names a's step 37, then b's and c's step 38, which read `a.x` one step later) |

## Readings where the issue leaves a choice

- **"A step … in which one item steps and writes" (AC1)** is one call of `World::run_through` that runs one step of
  one item, on a world built as a live view builds one (its ring kept) and on the one record its earlier steps used,
  as the view's worker steps. The other 99 are at a slower rate, not on a turn clock, so none steps or is passed then.
  A call that runs no step comes first: `run_while` begins by giving the record each item's arrays where it stands
  (`Record::whole`, the bake's whole arrays), which is the record's cost, kept as the base has it, not the step's.
  The heap is the bytes each allocation and reallocation asks for on the test's thread, as `2657/copies.rs` counts.
- **What the base allocates for AC1.** 6,757,909 bytes in 349 allocations: the 6,553,600 of `self.published.clone()`
  and about 204 KB of the stepping item's own (its fresh arrays, their published copy, the step hash's buffer). With the
  audit's change for F8 alone (probe, run 3) the same step asks for 136,373 bytes: the item's fresh arrays and the
  buffer its step hash is taken over, 64 KB each. The limit is the issue's (under 256 KB, drafted): it leaves room for
  one more copy of the stepping item's own arrays, not two.
- **`z` reads one f64 and writes two.** The criterion's item "steps and writes"; a step that changed all 8,192
  elements would add a bake range of 64 KB to the record, again the record's. The world's bytes are the criterion's.
- **"A seek across 100 restores" (AC2)** is 100 calls of `World::seek`, the call a live view's scrub back makes, each
  to another checkpoint of one world of one item. "Compiles its module once" is read over the world's whole life: one
  compile, wherever it happens, and none in the restores. The issue's "on the merge base it compiles 100 times" is the
  restores' count there; with the world's own start the base's total is 101, and the failure names both.
- **"A planted runner that shares one store between two forks"** is read by what it does: two forks of one item on
  one instance. In wasmtime a `Store` alone holds no memory; an instance in it does, so the plant shares the instance.
  The criterion's "naming the fork whose memory changed" is the problem line the check returns: fork B's, after fork
  A alone stepped.
- **AC3's three limits** are the three the sandbox gives a logic item's step: its fuel (trap `fuel`), its memory,
  which can't grow past its limit (trap `grow`), and a trap of the program's own (`unreachable`). "The other steps
  on" is ten steps whose rows equal a straight run's, so a fork that steps on with another's fuel, memory or globals
  fails. On the base these three pass, since each fork compiles and instantiates its own; their wrong program is the
  planted runner.
- **"A check" (AC4)** is the sandbox module's check of one program as a logic item's check runs it: the subset check
  and then the rewrite in `Logic` mode, where F13's validator is. An allocation is one call of the allocator
  (`alloc`, `alloc_zeroed` or `realloc`) on the checking thread. The base makes 2,670,020, the same in five readings
  of three processes; with the audit's change for F13 (probe, run 3) 2,658,887, which is 11,133 fewer.
- **"Refuses what it refuses there"** is the check's refusals (`Refusal::to_json`) and the rewrite's own answer for
  five programs with one defect each, compared with the base's as recorded. The rewrite's answer is recorded for
  programs the check refuses too (it rewrites two of them and refuses three), since the reused validator is the
  rewrite's.
- **"A live view … with no reader" (AC5)** is a pipelined view: its logic thread steps the world with a record
  nothing reads (`live.rs`'s `&mut Record::default()` per step, the issue's second site) and answers `baked` with
  "a pipelined view keeps no session bake". A view that isn't pipelined keeps its session's record for `baked`
  (#548), so it has a reader whenever one asks; this suite doesn't hold it to building none. A dispute on that
  reading goes to a redraft.
- **"A record value"** is a step's row in a record (surface 2). The base builds 1,001 for 1,000 frames: the logic
  thread runs one step past the one a frame draws, so the last frame's next step may or may not have ended when the
  count is read (1,000 or 1,001 at the base; 0 either way once a live step keeps no record).
- **"A bake of the same steps writes the record the merge base writes"** is `deep-logic`'s `bake` call of the same
  piece for 1,000 steps: its `steps`, `checkpoints`, `traps` and `ranges`, with every time a run took removed (`ns`,
  `ms`, `*_ns`, `*_ms`, `compares`), since a time is no part of a record's bits.
- **"Every logic golden hashes the same" (AC6)**: the repository holds no committed logic golden; #532's and #546's
  suites record one and verify it in the same run, on two machines. So one golden recorded at the base is kept here.
  Its `machine` names the Mac that recorded it; the comparison reads step hashes, checkpoints and the occurrences
  hash, which are CPU-independent, and `golden_verify`'s verdict.

## Not tested

F10 (the call's channel made only when the call has a deadline): the issue's scope names it and no criterion counts
it; `tests/acceptance/238/` (its deadline cases) and `531/ac01-fuel-stack.test.ts` cover the behavior. The step's
own remaining copies (AC1 holds the total under 256 KB, not each copy). Compiles on `restore`, `fork`, a counted
rewrite or a preview's spare instance (AC2 counts a seek's). A non-pipelined view's record (Readings). The web
player's runner. Times, peak memory, and the two budget tasks' instructions (Run them). `tests/acceptance/531/`,
whose `ac03-writes` and `ac05-checkpoints` the audit names as proof for F8 and F12, is not in the criterion; running it
unchanged beside 532 and 546 costs one more vitest run.

## Base runs

`BASE-FAILURE.txt` holds three runs at the base, `3c500c0c8`, with the seven `[[test]]` entries above added for the
runs and removed after. Run 1, the base as it stands: `step_bytes.rs` and `check_allocations.rs` fail their
assertions, naming the bytes and the allocations; `seek_compiles.rs`, `forks_planted.rs` and `live_record.rs` fail to
build, each naming its missing surface; `forks.rs` and `goldens.rs` pass (their wrong programs are the planted
runner and `replay_changes_step_37`). Run 2, with the three surfaces added to the base with its behavior unchanged
and the planted runner wired (a probe this job reverted; its diff is in the file): `seek_compiles.rs` fails at its
assertion with 101 compiles, `live_record.rs` with 1,001 record values, and both planted tests see the plant fail as
they need. Run 3, the audit's own changes for F8 and F13 on top of the probe (reverted too): `step_bytes.rs` and
`check_allocations.rs` pass, so both limits can be met, and `forks.rs` and `goldens.rs` still pass. The fixtures were
recorded from the base's runs of these tests (`DEEP_2662_PRINT=1` makes a test print what it compares; it writes
nothing) and are checked by the runs in the file.
