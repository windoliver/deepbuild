# Acceptance tests for #189, Oracle lane: upstream snapshot tests, pinned by commit, run against our saves

Written first, blind, from issue #189 (`gh issue view 189 --repo windoliver/deepbuild`), its Oracle page
(`doneright/oracles/issues/189.md` on branch `doneright` of DeepBuildAI/deepbuild), the upstream file that page pins
(read from its vendor copy under `doneright/oracles/vendor/`), the logic-saves suite's surface
(`tests/acceptance/189/saves/README.md`, written by the same job) and base commit `531da1ef0`, by a job that never saw
an implementation of #189; none existed, and no other worktree, branch, pull request or plan was read. #136's rule
applies: a linked test counts only when run against our output, so every case here is a logic program of our own whose
state a save keeps and reopens, and every assertion is on what `deep-logic` answers, never on an engine called
directly. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this
job (design: Dogfooding).

Scope: criterion 5, the one the page links upstream tests to (use: port). The other twelve have none (the page's "No
upstream test" table) and stay with `tests/acceptance/189/` and its sibling folders, as do the parts the page calls
ours: the full-state hash a save records and the refusal of a save that lacks a page, which this lane checks only on
the cases' own programs.

## Sources

| Criterion | Upstream, pinned | File (cases) | Use | License |
|---|---|---|---|---|
| 5 | wasmtime, commit `3c8a3e79aa3188a1a12b3aebbaa097abccceac92` | the upstream snapshot tool's `tests/all/tests.rs` (in its crate under `crates/`), lines 136-153 (basic_memory), 486-509 (data_segment_at_end_of_memory), 921-948 (mixture_of_globals) | port | Apache-2.0 WITH LLVM-exception |

No upstream code is copied: each case's state and expected value are written as a logic program in the receiving file,
which names the upstream file, its commit and its license, and keeps upstream's numbers.

## Run

```sh
npm ci                      # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  npx vitest run --root tests/acceptance/189-oracle --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/189-oracle/tsconfig.json
rm -rf tests/acceptance/189-oracle/node_modules/.vite
```

`helpers.ts` re-exports the logic-saves suite's helpers (`../189/saves/helpers.ts`) and its region map, so both lanes
build its assembler and `cargo build --locked --bin deep-logic` the same way; every test passes a 90-minute timeout.
**`scripts/lanes.mjs` needs `'tests/acceptance/189-oracle/'` in its `alone` list** (the saves suite's README says so
too); the implementer makes that edit. No cargo is `BLOCKED:`, never a pass; nothing here is timed. `BASE-FAILURE.txt`
records what ran at the base.

## The surface under test

The logic-saves suite's (its README: The surface under test): `bake` with `saves_dir`, `open_save`, a save header's
`deep_hash`, `open_save`'s `refused`, and the planted twin `save_drops_a_page`. Nothing new is named here.

## Upstream's cases as ours

Upstream runs a module's initializer, snapshots the instance keeping the nonzero regions of each 64 KiB page and its
mutable globals, instantiates the snapshot from zeroed memory and reads values back. Ours: one 60 Hz logic item whose
step 0 is the initializer and which asks for a save of slot 1 at its end (a save at step 1); another process opens the
save into a fresh instance at the full-state hash the save recorded, and steps 1 and 2 read the values into an array.

- **basic_memory**: step 0 stores the i32 42 at byte 1337 of a one-page memory; read back: 42.
- **data_segment_at_end_of_memory**: step 0 stores the byte 42 at the last offset of a two-page memory (131,071), the
  only nonzero byte of page 1; the save holds two pages, and the value reads back 42.
- **mixture_of_globals**: mutable globals 1 and 3 beside immutable 2 and 4; step 0 sets them to 42 and 43; read back
  as upstream's sum, 91, and each value (42, 2, 43, 4).
- Each case's save holds exactly the pages that hold a nonzero byte (its file is at least that many pages and under one
  more) and records its full-state hash in its header.
- **The planted save** (`save_drops_a_page`) on data_segment_at_end_of_memory: a second save at step 2, written by a
  process with the twin, leaves out page 1, whose one nonzero byte is at its last offset. A process without the twin
  refuses it by the hash it recorded, naming it and the module `logic`, and opens the slot's save at step 1 instead,
  which reads 42 back.

## Tests

| Criterion | File (tests) | What it asserts |
|---|---|---|
| 5 `#189.43b8fb06` | `snapshot-cases.test.ts` (4) | The three cases: the save at step 1 holds its pages, records its full-state hash, reopens in a fresh process at that hash and reads upstream's values back; under `save_drops_a_page`, the save without its last page is refused naming the save and the module, and the slot's other save opens and reads 42 |

Test count: 4.
