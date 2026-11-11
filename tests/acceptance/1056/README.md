# Acceptance tests for #1056: Second-GPU index records: a pixel look's per-frame index hashes from a second GPU, read by "same on two GPUs" criteria

Written first, from issue #1056 (its body and its two acceptance criteria), the design sections it rests on, and the
base commit, by a job that never saw an implementation; none existed. The base asked for was `3c36f9180` ("Merge pull
request #2232 …"); this worktree's HEAD, where the suite was written and run, is `3962d5281` ("Merge pull request #2235
…"), which is `3c36f9180` plus #485's 3D light merge and touches none of what this suite reads (`film.rs`,
`indexed.rs`, `effects.rs`'s `exact` and `cross_gpu`, `golden.rs`, `tests/acceptance/464/`). The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean:
one file per criterion, one test per clause that needs its own run, plus the one plant the criteria name.

## What was read

- Issue #1056; for vocabulary only, #464 (its criteria AC3, AC6 and AC7, each "the same indices on two GPUs"), #921
  (its two-GPU clause and its #1056 criterion) and #380 (its "identical bits on two GPUs … BLOCKED with one unblock ask").
- `docs/canvas-primitives.md`: Determinism class (exact operators give the same bits on every GPU; a same-machine
  result carries the run's environment fingerprint; a golden under another fingerprint reads INCONCLUSIVE, naming
  both). `docs/parallel-proof.md` for "tree hash": the hash of what is on disk, uncommitted and untracked files too, so
  a clean checkout's is `HEAD^{tree}` (`scripts/lanes.mjs`'s `exactTree`).
- At the base, for call shapes only: `crates/deep-gpu-layer/src/main.rs` (the call table), `effects.rs` (`exact`
  writes a record `{gpu: {name, family}, operators, …}`; `cross_gpu` compares records: one family alone is `BLOCKED`
  with one `{kind: "unblock", ask, needs, gpu}` ask, else `PASS` or `FAIL` with `differs`), `golden.rs` (the
  fingerprint `{os, gpu, driver, wgpu}`), `film.rs` and `indexed.rs` (`film2d`'s `targets: ["indices"]`: each captured
  frame's index target `<sha256>.u16`); `scripts/proof-change.mjs` (`criterionId`), `scripts/lanes.mjs`.
- For conventions: `tests/acceptance/1976/README.md`; `tests/acceptance/380/cts-exact.test.ts` (the record from another
  machine and its twins); `tests/acceptance/464/` (README, `helpers.ts` with `sameOnTwoGpus`, `indexed.test.ts`,
  `see-through.test.ts`, `tables.test.ts`); `tests/acceptance/140/gpu/exact.test.ts`.

## What the base already does, which these tests don't credit

#464 is merged: `film2d` under an indexed look writes each captured frame's index target, and #464's two-GPU tests
write `index-record-<fixture>-<family>.json` (`{issue, gpu: {family, chip}, indices: {<fixture>: <frame 0's hash>}}`)
and compare it with the file `DEEPBUILD_SECOND_GPU_464` names, BLOCKED without one. That record has no tree hash, no
fingerprint and one hash per fixture, not per frame. There is no `index_record` and no `cross_index` call, so every test
here fails at the base on its first `index_record` (`BASE-FAILURE.txt`).

## Run them

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1056 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1056/tsconfig.json
```

Each file builds `deep-gpu` once with `cargo build --locked --bin deep-gpu` (`CARGO_INCREMENTAL=0`,
`CARGO_PROFILE_DEV_DEBUG=0`, cargo from PATH or `/opt/homebrew/opt/rustup/bin` or
`~/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin`), copies it out of the target folder (`CARGO_TARGET_DIR`
honoured), and fails each test that uses a build that failed. `records.test.ts` also runs three of #464's tests,
read-only, which build `deep-gpu` again (a no-op after the first). So the files run one at a time: `scripts/lanes.mjs`
needs this line beside #464's, which this README asks for and the implementer adds:

```js
// #1056's files build deep-gpu and draw #464's pixel fixtures; records.test.ts runs #464's two-GPU tests.
alone.push('tests/acceptance/1056/');
```

Each test writes into its own temporary folder and deletes it, except the second-GPU test, which leaves this GPU's
records in `deep-1056-records` under `DEEPBUILD_EVIDENCE_DIR` (else `$TMPDIR`) for a second Mac's run to be compared
with. A run with `--root` leaves Vitest's cache in `tests/acceptance/1056/node_modules/.vite`, and the runs of #464's
tests leave one in `tests/acceptance/464/node_modules/.vite`; both are ignored by git, delete them. Off macOS each test
fails `INCONCLUSIVE:`, never passing. Nothing is timed or gated on load or power.

## What runs on this Mac, and what needs the second Mac

This Mac is an Apple M5 Max (Metal family apple10); no other Apple GPU is reachable.

- **Here:** the record (its file, fingerprint, tree hash and per-frame hashes) and the whole comparison, on twins of this
  Mac's own records standing in for another family's, as #380's and #140's suites prove theirs: equal hashes pass both
  `cross_index` and #464's own two-GPU tests; the planted index fails naming its frame and pixel; another tree hash is
  refused naming both; no second record is BLOCKED with one ask, asked once.
- **Needs the second Mac:** one test, `records.test.ts`'s "on a second Apple GPU". It reads the folder
  `DEEPBUILD_SECOND_GPU_1056` names, holding `index-record-<fixture>-<family>.json` for `grid`, `tables` and `puff`
  (with their `.u16` index targets beside them) made on a Mac of another GPU family at this tree. Without it, the test
  fails with a message starting `BLOCKED:` and its one unblock ask: on a Mac whose GPU is another family than apple10
  (the other reference Mac, or an M1), at this tree, run
  `node node_modules/vitest/vitest.mjs run --root tests/acceptance/1056 --no-file-parallelism records.test.ts`, bring
  the folder it prints (`deep-1056-records` in its `DEEPBUILD_EVIDENCE_DIR`, else its `$TMPDIR`) here and name it in
  `DEEPBUILD_SECOND_GPU_1056`. With it, `cross_index` must PASS for each fixture and #464's two-GPU test must pass with
  that Mac's record named in `DEEPBUILD_SECOND_GPU_464`. A record of another tree reads BLOCKED there too, with the ask.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, the leading `- [ ] `
dropped (`criterionId` in `scripts/proof-change.mjs`), from the live issue. Each test's name starts with
`AC<n> #1056.<id>`.

| ID | File (tests) | What it asserts |
|---|---|---|
| AC1 `#1056.77c08347` | `records.test.ts` (4) | (1) `index_record` writes, for `grid`, `tables`, `puff` and `flash`, `index-record-<fixture>-apple10.json` in `out` with `gpu.family` this Mac's, `gpu.chip` and `fingerprint.gpu` naming its M5, `fingerprint.{os, gpu, driver, wgpu}` set, `tree` equal to this checkout's tree hash, one `frames[i] = {frame: i, indices}` per frame, each `<sha256>.u16` beside the record hashing to its name, and `indices.<fixture>` frame 0's hash; `flash`'s frames hold hero-body's flash index on frames 100–104 and body's on the other 101; twins of `grid`, `tables`, `puff` relabelled to another family give `cross_index` `PASS` and make #464's two-GPU test for that fixture pass. (2) The planted twin, `puff`'s frame 12 changed at pixel (61, 50), gives `FAIL` with one `differs` entry, `frame: 12`, `pixel: [61, 50]`. (3) A twin carrying another tree hash gives `BLOCKED` with one unblock ask, and the reply names both tree hashes. (4) On a second Apple GPU: that Mac's records of `grid`, `tables` and `puff` (the folder `DEEPBUILD_SECOND_GPU_1056` names) give `cross_index` `PASS` beside this Mac's and pass #464's two-GPU tests; without them the test fails `BLOCKED:` with its one unblock ask. |
| AC2 `#1056.c717b851` | `no-record.test.ts` (1) | `cross_index` over this Mac's records of `grid`, `tables` and `puff` alone is `BLOCKED` with exactly one ask, `kind: "unblock"`, naming a machine (`apple<n>`, an M chip or the reference Mac); each fixture alone is `BLOCKED` with one ask whose `ask` text is the same. None is `PASS`. |

The planted program the criteria name, "a planted index differing in one pixel of one frame", is a planted record (the
twin), not a `--planted` flag: the criterion plants the index the comparison reads.

## Surfaces this suite picked where the issue leaves them open

The issue names the record's contents (a GPU fingerprint as in the same-machine rule, a fixture's tree hash, per-frame
index hashes), a command that writes it on the second machine, a comparison the criteria read, and, for #464's
fixtures, #464's file (`index-record-<fixture>-<family>.json` with `gpu.family`, `gpu.chip`, `indices`). It names no
call, entry point or other field. This suite's picks follow the base's nearest pattern, `deep-gpu`'s `exact` (writes a
record) and `cross_gpu` (compares records), with #464's file and `golden.rs`'s fingerprint. The implementer provides
exactly these.

1. **The command: `deep-gpu run`'s call `index_record`**, in a scenario `{out, calls}` as every `deep-gpu` call:

   ```json
   {"call": "index_record", "fixture": "<name>", "doc": {}, "look": {}, "frames": 38, "fps": 24}
   ```

   `doc`, `look`, `frames` and `fps` (60 when absent) are `film2d`'s, the look an indexed `look@1`. It draws every frame
   0 … `frames` − 1 as `film2d` does, reads back each frame's index target, and writes into `out`:
   - each frame's index target as `<sha256>.u16`, `film2d`'s `indices` format (one little-endian u16 per target pixel,
     rows top-down), named by its SHA-256;
   - the record `index-record-<fixture>-<family>.json`, `<family>` this GPU's Metal family (`apple7` for an M1, `apple8`
     M2, `apple9` M3 and M4, then `apple<n + 5>`, as `effects.rs`'s `family` and #464's suite read it).

   The reply is answered (no `code`); its fields are not read.
2. **The record's fields** (others may be added):

   ```json
   {"gpu": {"family": "apple10", "chip": "Apple M5 Max"},
    "fingerprint": {"os": "…", "gpu": "Apple M5 Max", "driver": "…", "wgpu": "…"},
    "tree": "<tree hash>",
    "frames": [{"frame": 0, "indices": "<sha256>"}, …],
    "indices": {"<fixture>": "<frame 0's sha256>"}}
   ```

   - `gpu.family`, `gpu.chip`, `indices`: #464's, so #464's two-GPU test reads the file unchanged. `gpu.chip` names the
     chip (it must contain this Mac's `M<n>`).
   - `fingerprint`: `golden.rs`'s fingerprint fields `os`, `gpu`, `driver`, `wgpu`, each set; `gpu` names the chip.
   - `tree`: the tree hash of the checkout `deep-gpu` runs in (its working folder): what is on disk, uncommitted and
     untracked files too, `HEAD^{tree}` on a clean checkout, as `scripts/lanes.mjs`'s `exactTree` writes it.
   - `frames`: every frame in order, `frame` its index from 0, `indices` its index target's SHA-256, the `.u16` file
     beside the record.
3. **The comparison: `deep-gpu run`'s call `cross_index`**, as `cross_gpu`:

   ```json
   {"call": "cross_index", "records": ["<path>", …]}
   ```

   `records` are record files; they may hold several fixtures (named by the file name, `index-record-<fixture>-…`), and
   each fixture's records are compared across GPU families, frame by frame. A frame's index targets are read from the
   `<sha256>.u16` files in the folder of the record that names them. The reply:
   - `result`: `PASS` when every fixture has records from two families of one tree hash with equal hashes on every
     frame; `FAIL` when a frame's hashes differ; `BLOCKED` when a fixture has no record from a second family, or the
     records name different tree hashes (stale: refused, never compared). Never `PASS` from one family.
   - `asks`: on `BLOCKED`, exactly one `{kind: "unblock", ask, …}` for the whole comparison, however many fixtures or
     frames lack a second record; its `ask` text is the same whichever of the fixtures are compared (it names the
     machine and what to run, not a fixture), so the clauses reading these records ask a person once.
   - On a tree mismatch the reply names both tree hashes (anywhere in it).
   - `differs`: on `FAIL`, one entry per differing frame, `{frame, pixel: [x, y], …}`, `pixel` the first differing
     target pixel in row-major order (x right, y down, from the top left).
4. **Env vars:** `DEEPBUILD_SECOND_GPU_1056`, the folder of a second Mac's records (this suite's); `DEEPBUILD_SECOND_GPU_464`
   (#464's, set only on the runs of #464's tests); `DEEPBUILD_EVIDENCE_DIR`, where the second-GPU test leaves this
   GPU's records (`deep-1056-records` under it).

## Readings where the issue leaves a choice

- **"Tree hash"** is the project's (docs/parallel-proof.md): a git tree hash of what is on disk. "A fixture's tree hash"
  is the tree the fixture's frames were drawn at, so a record made at another tree is stale. The tests read it equal to
  the checkout's (`checkoutTree` in `helpers.ts`, the same steps as `exactTree`).
- **"Refused, naming both hashes"** is `BLOCKED` with the one unblock ask, as the body says of a stale record ("Missing
  or stale, it is BLOCKED with one unblock ask naming the machine, never PASS"), never `PASS` or `FAIL`; the twin's
  hashes are equal, so a comparison that ignored the tree would pass it.
- **"Read by its two-GPU criterion"** is #464's own two-GPU test for that fixture, run unchanged with the record named in
  `DEEPBUILD_SECOND_GPU_464`, passing; and "equal hashes pass" is that and `cross_index`'s `PASS`.
- **"#464's fixture"** is each of #464's three fixtures with a two-GPU clause: `grid` (AC6's stroke and circle),
  `tables` (AC3's tables), `puff` (AC7's dithered puff, 38 frames at 24 fps). #464's keyed `flash` (AC9, 106 frames at
  100 fps) is added only to hold the per-frame hashes to frames that differ; the three two-GPU fixtures are still, so every
  frame of each has one index target.
- **"A planted index differing in one pixel of one frame"** is a twin of this Mac's `puff` record relabelled to another
  family whose frame 12 (not frame 0, which #464's file reads) has pixel (61, 50) moved between the wall's index and
  the smoke's, its hash and `.u16` changed with it. "Naming the frame and pixel" is `differs` holding frame 12 and
  pixel [61, 50] and no other frame.
- **"One unblock ask, asked once"** is one ask for a comparison of all three fixtures (40 frames), and the same question
  for each fixture compared alone, so a person sees it once (invariant 4). "Naming the machine" is the ask naming a GPU
  family, an M chip or the reference Mac.
- **The twins** stand in for an M1 (`apple7`, "Apple M1"), or an M3 on an M1, with `gpu.family`, `gpu.chip` and
  `fingerprint.gpu` relabelled, as #380's and #140's twins do.

## Not asserted, because no criterion says so

- The reply fields of `index_record`; `differs` entries' other fields (fixture, families); a record's other fields.
- Two records of one family (a second M5) staying BLOCKED, and a planted comparison that passes one family: true of
  `cross_gpu`'s suite, not named by these criteria.
- #464's two-GPU tests with no record: BLOCKED at the base already (#464's own suite), so not credited here.
- #921's film and its records: #921's suite reads `cross_index` when it exists.

## Fixtures

None on disk. `helpers.ts` builds #464's documents and looks exactly as #464's `helpers.ts`, `indexed.test.ts`,
`see-through.test.ts` and `tables.test.ts` build them, reading #464's base look `tests/acceptance/464/fixtures/look.json`
in place (read-only), so the records are of #464's own fixtures. Checked once at this HEAD through `film2d`: each
fixture's frame 0 index hash, written into a hand-made record, makes #464's two-GPU test pass, and a wrong hash makes it
fail (a temporary check, not kept).
