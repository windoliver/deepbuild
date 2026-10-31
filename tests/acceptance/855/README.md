# Acceptance tests for #855: typed values in the frame, canonical bytes for every typed result, coefficients from an optimized build, and hash@2

Written first, from issue #855 (its scope, its four acceptance criteria, its proof line and its Oracle note), the
design sections it names and those they lean on, and base commit `0b35e68e` ("Merge pull request #859 …
feat/806-deep-show-live"), read in a checkout at `0466575b`, which descends from it and adds only #104's
run-as-you work (no file this suite reads changed between them), by a job that never saw an implementation; none
existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of
this job (design: Dogfooding).

What was read:

- `docs/canvas-primitives.md`: The cost model (82: per-item terms, "Coefficients come from micro-benchmarks on the
  reference Mac and carry its environment fingerprint, so a refusal is the same on every machine"); Registry and
  seal (1035: "Any failure refuses startup … there's no warning level"); Phase (1094: the closed check and frame
  phase lists); Operator and read set (1112: `writes: [own array]`, "Equal keys always give byte-identical
  results"); Array and table (1130); Content key (5055: `key = hash@1(…)`, 128 bits, "over length-prefixed
  canonical fields", "Equal keys share one immutable result", a result living while a current or pending revision
  reads it).
- `docs/technical-design.md`: Rules every primitive follows, "Seeded and replayable" (884: "Results that feed a
  check replay the same way on another machine, as goldens prove on arm64, x86_64 and wasm32", "keys and seeds
  name their hash version (`hash@1`)") and "Universal rules are tested as properties"; Dirty classes and content key
  (1494: "Epochs decide only when to recompute and never enter a key"); How we know version 0 works, Dogfooding.
- At the base: AGENTS.md; `tests/acceptance/387/` (the scheduler's surface: `eval`, `frames` with `allocs` counted
  by the binary, `fixtures`, `registry.operators`, the 10,000-rect budget board, the reference-Mac gate and the
  judge), `tests/acceptance/379/` (the cost model: `registry.costs`, the `costs` call, `machine`), `tests/acceptance/305/`
  (the seal's startup refusal, `--planted`, builds per feature set, criterion IDs) and `tests/acceptance/822/`;
  `crates/deep-show` (`main.rs`: the counting allocator, `planted_arg`, the `seal_refused` line; `frames.rs`:
  `registry_reply`, `eval`, `frames`; `costs.rs`: the `costs` call's fit, its 1 ns floor; `planted.rs`; `Cargo.toml`'s
  test features); `crates/deep-canvas/src/schedule/mod.rs` (`Hasher`, `hash@1` as SHA-256 over length-prefixed
  fields cut to 128 bits; `Val::{Json, Any}`; `result_digest`, a SHA-256 over each written value's `bytes()`);
  `crates/deep-canvas/src/registry/`; `crates/deep-canvas/src/cost.rs` and `costs.json`; `crates/deep-canvas-marks/src/modules.rs`
  and `crates/deep-canvas-motion/src/module.rs` (where results take their digest bytes from `format!("{…:?}")`);
  `benchmarks/canvas.mjs` (`costs [--write]`, which runs `target/debug/deep-show`); the workspace `Cargo.toml`'s
  `[profile.dev.package.*]` overrides (deep-canvas, serde_json and sha2 at opt-level 3; deep-canvas-marks and
  deep-text not).

What the base already does and these tests don't credit: typed values exist (`Val::Any` with bytes), and
`text.shape`'s `text.run` and `cells.grid` carry hand-written bytes; the counting allocator counts every
allocation of a frame (`allocs`); keys are 128-bit `hash@1` (SHA-256) keys; the cost model reads committed
coefficients with a machine fingerprint. But frame-phase operators write `Val::Json` (`core.transform`,
`core.fields`, `core.world`, `core.status`, `motion.at`, `motion.fields`, `motion.next`, `text.counter`,
`text.animated`, `data.scale`, `graph.layout`, `record.level`, `sheet.placed`, `look.status`), and the seal can't
tell; `look.palette` and the frame-phase `text.status` and `marks2d.frame`, and the check-phase `motion.compile`,
digest their Debug text; `costs.json` records no build profile or toolchain and was measured from the dev build,
where deep-canvas-marks and deep-text aren't optimized; there is no hash@2, no `hash` on any reply, no migration
and no `keys` call. So these tests define the surface below.

## Run them

They build `deep-show` per feature set, profile and target, as #305's and #387's do, so they run with
`--no-file-parallelism`. `scripts/lanes.mjs` needs this folder in its `alone` list beside `tests/acceptance/387/`;
this README is the instruction, and the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/855 --no-file-parallelism
npx tsc -p tests/acceptance/855/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Every file first builds each build it uses, once, with `cargo build --locked [--release] [--target
x86_64-apple-darwin] --bin deep-show --no-default-features --features full[,<test feature>…]`, copies the binary
out of `target/{debug,release}` (or `target/x86_64-apple-darwin/debug`) under its own name into a temporary folder,
and fails each test that uses a build that failed. The x86_64 build is made only when rustup lists the
`x86_64-apple-darwin` target for the pinned toolchain and Rosetta 2 runs; otherwise the one test that needs it
skips with an `INCONCLUSIVE:` message naming why, after its native half has run (it never passes by skipping).
Every test writes into its own temporary folder and deletes it; processes are started by `spawnSync` and stopped
only by their own timeout. The release build takes several minutes the first time. A run with `--root
tests/acceptance/855` leaves Vitest's cache in `tests/acceptance/855/node_modules/.vite`; delete it.
`BASE-FAILURE.txt` is the run at the base (paths redacted): all 18 tests fail there, each at the missing surface,
never at a document the base refuses: no `build` in `costs.json` or the `costs` reply; `--costs` and `--planted
admits_frame_json` answer `bad_input`; `eval` has no `hash`; `frames` has no `json_values`; a scenario with
`migrate` or `keys` answers `bad_input`; and the `test-json`, `test-debug-alt` and `test-debug-digest` features
don't exist, so those builds fail. The x86_64 test fails at its native half (no `hash`) before its
availability check, and the two timing tests fail before their gate (no `build`, no `keys`).

Two tests are timing readings: the optimized build's measured coefficients (`costs.test.ts`) and the keying ratio
(`keying.test.ts`). Each takes its reading first, then, off a reference Mac (Mac15,7 or Mac15,12), on battery, with
Low Power Mode on or unknown, with a thermal warning, or with a 1-minute load average above half the cores, prints
it and skips as `INCONCLUSIVE (reading only)`; it never passes there (#387's gate, with the load added).
Everything else runs headless on the CPU, on any Mac.

## The surface under test

The issue names a seal refusal, an allocator count, two builds whose Debug output differs, a planted result, a
coefficient file with a profile and a toolchain, `hash@2`, a migration and a keying time, but no code API. These
tests extend the `deep-show` binary of #305, #387 and #379 and keep their conventions (JSON lines, one reply per
call, `bad_input`, `seal_refused` at startup and exit 2, `--planted`, Cargo features for test builds). What follows
is what this issue adds, kept as small as the criteria need.

### Startup arguments

`deep-show run [--planted <name>] [--costs <path>]`, each at most once, in either order; anything else stays
#305's `bad_input` and exit 2.

- `--planted admits_frame_json`: the seal that lets a frame-phase operator that writes JSON in, the wrong program
  reachable only there, beside #305's, #387's and #388's planted seals.
- `--costs <path>`: the cost model reads its coefficients from that file instead of the build's own
  `crates/deep-canvas/costs.json`, for this process (its check estimates and `registry.costs` alike).

### The seal: JSON in a frame phase

A canvas module whose operator in a frame phase (latch through feedback) writes a JSON value is refused at
startup with #305's line plus one field:

```json
{"ok": false, "code": "seal_refused", "reason": "json_in_frame",
 "modules": [canvas module…], "arrays": [array…], "operators": [operator…], "what": string}
```

`operators` names each offending operator as `registry.operators` names it, and only those; an operator in a check
phase may write JSON. How the seal knows what an operator writes (a declared value type, or its fixtures run at
the seal) is the implementer's.

### `frames`: `json_values`

Each entry of #387's `frames` reply gains `json_values`: the JSON values the frame allocated while the scheduler
ran its phases, counted by the binary's counting allocator: each JSON value an operator wrote, and each the core
built or copied to hand an operator, counted by the heap allocations it took. Reading the document's own JSON by
reference allocates nothing and counts nothing.

### `eval`: `hash`, `result` and `debug`

- The reply gains `hash`: the hash version its nodes' keys and result digests were computed with.
- A node's `result` is the node's result digest as the core computes it, with that hash, from the canonical bytes
  of what the node wrote (64 lowercase hex, as #387's form). #387's tests compare it only for equality.
- The call takes `debug_text: true`, which adds to every node `debug`: the SHA-256 (lowercase hex) of the Debug text
  (`{:?}`) of the typed values the node wrote, in the order it wrote them, or `null` when it wrote none. It is a
  diagnostic of the reply, never an input to any key or digest, in every build.

### Hash versions: `hash` and `migrate`

- Content keys and result digests are `hash@2` (BLAKE3; keys stay 128 bits, digests 256) unless the scenario says
  `"hash": "hash@1"`, which keys and digests the process as the base did, until a migration.
- `{"call": "migrate", "to": "hash@2"}` rekeys the process's content-key cache once, from the hash its entries
  were written under to `hash@2`, and keys and digests everything after it with `hash@2`. It answers `{"from",
  "to", "entries", "rekeyed"}`: the hash the process keyed with before the call, the hash after it, the entries
  in the cache after it and how many it rekeyed. A cache already under `hash@2` is rekeyed no more (`rekeyed: 0`).
  After it, a result written under `hash@1` is found by its `hash@2` key (`run: "hit"`).

### `keys`: keying a revision

`{"call": "keys", "doc", "runs": n}` computes, `n` times, every content key of the session's current revision afresh
(every node of its check and frame phases at time 0, from the canonical bytes up; no key reused from a cache or
an earlier pass), under the process's hash, and answers `{"hash", "nodes": integer, "ns": [n integers]}`: the
hash, the keys one pass computes, and each pass's nanoseconds, by the binary's own clock. Operators don't run.

### The cost model: `build`

- `crates/deep-canvas/costs.json` gains `"build": {"profile": string, "toolchain": string}`: the Cargo profile of
  the binary that measured the coefficients (Cargo's own name: `dev` for the debug build, `release`, or a profile
  the workspace's `Cargo.toml` defines) and its toolchain as `rustc -V` prints it.
- The `costs` call's reply (#379) gains the same `build` for the binary answering it, so `benchmarks/canvas.mjs costs
  --write` can record it.
- The cost model refuses a coefficient file whose profile isn't optimized, or that names none, before any
  scenario, with `{"ok": false, "code": "costs_refused", "profile": string | null, "what": string}` and exit 2. An
  optimized profile is `release` or `bench`, or a profile of the workspace's `Cargo.toml` that inherits one of them
  and doesn't set `opt-level = 0`; `dev` and `test` never are (helpers.ts `optimizedProfile`).

### The test builds (Cargo features of `deep-show`)

None is in a shipped build. A document that uses a test kind declares it in `requires.modules`.

| Feature | What it adds | For |
|---|---|---|
| `test-json` | Canvas module `test.json` 1.0.0: kind `test.json@1` {`box`}, drawn as `rect@1`; arrays `test.json.out` (item, phase items) and `test.json.audit` (item, phase check), each holding a JSON value, registered however the build registers a JSON value; operators `test.json.out` (items; reads `[self]`; writes `test.json.out`: a JSON object of its item's box) and `test.json.audit` (check; reads `[self]`; writes `test.json.audit`: a JSON value) | criterion 1: the seal refuses the first, admits the second; with `--planted admits_frame_json`, the counter's positive control |
| `test-debug-alt` | Changes the Debug output (`{:?}`) of every typed value any operator writes (shipped or test), and nothing else: a second build "whose Debug output for it differs" | criterion 2 |
| `test-debug-digest` | Canvas module `test.dbg` 1.0.0: kind `test.dbg@1` {`box`}, drawn as `rect@1`; array `test.dbg.out` (item, phase items); operator `test.dbg.out` (items; reads `[self]`) writing a typed value whose canonical bytes are its Debug text, the planted result | criterion 2 |

Builds the tests make: `full`, `full,test-json`, `full,test-debug-alt`, `full,test-debug-digest`,
`full,test-debug-digest,test-debug-alt`, `full` with `--release`, and `full` for `x86_64-apple-darwin` (where
available).

## Fixtures

- `fixtures/costs-base.json`: the base's `crates/deep-canvas/costs.json`, verbatim (no `build`).
- `fixtures/costs-dev.json`: the base's fingerprint and terms with `build: {profile: "dev", toolchain: "rustc
  1.99.1 (58cf8f9c3 2026-10-13)"}`: the planted coefficient file "marked with a debug profile".
- `fixtures/costs-release.json`: the same, marked `release`: the planted file's twin, which must be read.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace collapsed (#305's
command; criterion 4's text keeps the issue's backticks around `hash@2` and `hash@1`). Each test's name starts with
its criterion's ID. Where a criterion names a wrong program, a test runs it through a test feature, `--planted` or
`--costs` and asserts it fails the way the criterion says, naming what it says.

| ID | Criterion (the issue's text) | Tests, and the wrong program each fails on |
|---|---|---|
| `#855.f682f4c0` | The seal refuses a planted frame-phase operator that writes a JSON value, naming the operator; with every shipped operator typed, a 10,000-item board's frame with one item changed allocates no JSON value, counted by the allocator | `json.test.ts`. "The seal refuses a planted frame-phase operator that writes a JSON value, naming the operator": `full,test-json` refuses to start, `seal_refused`, `json_in_frame`, `operators` exactly `["test.json.out"]` (not the check-phase `test.json.audit`: "JSON stays at check phases"), naming module `test.json` and array `test.json.out`. "With every shipped operator typed, a 10,000-item board's frame with one item changed allocates no JSON value": on `full`, a board of 2,000 each of rect, circle, path, text and frame; five revisions, each changing one item of one kind; the frame after each runs operators (`ran > 0`) and has `json_values` 0, and so does the frame after it; and the same board with one rect sliding on a clip has `json_values` 0 in every frame after the first, each running operators. "Counted by the allocator": with `--planted admits_frame_json`, `full,test-json` starts, the frame after the planted item changes counts `json_values > 0`, and `eval` shows `test.json.out` in phase items and `test.json.audit` in check. Wrong programs: the base; a seal that admits the planted operator; one that refuses every JSON writer; a counter that never counts |
| `#855.4c02dddc` | A typed result's digest is the same from two builds whose Debug output for it differs; a planted result that digests its Debug text differs between them and fails, naming the operator | `debug.test.ts`. "A typed result's digest is the same from two builds whose Debug output for it differs": every fixture of `full` (`fixtures` call) evaluated clean at 0.5 s in `full` and `full,test-debug-alt` with `debug_text`: every node's key and `result` equal; every node with a non-null `debug` has another `debug` in the second build (its Debug output did differ); the typed nodes include `look.palette`, `marks2d.frame`, `motion.compile`, `text.shape` and `text.status`, and the frame-phase three write typed values. "A planted result that digests its Debug text differs between them and fails, naming the operator": a board with a `test.dbg@1` item in `full,test-debug-digest` and `full,test-debug-digest,test-debug-alt`: the comparison fails, and the operators it names are exactly `["test.dbg.out"]`, by its result digest. Wrong programs: the base (four operators digest their Debug text); the planted result; a `test-debug-alt` that changes nothing |
| `#855.1e8c7f85` | costs.json from an optimized build gives text.shape, text.status and marks2d.frame coefficients each lower than today's debug-built ones, and a planted coefficient file marked with a debug profile is refused by the cost model, naming the profile | `costs.test.ts`. "costs.json from an optimized build gives … coefficients each lower than today's debug-built ones": the committed `costs.json`'s `build.profile` is optimized and `build.toolchain` names a rustc; for each of the three operators every term the base declares above the fit's 1 ns floor is lower (text.shape 32,503.37 ns per glyph; text.status 322,833 ns per item; marks2d.frame 11,818 per item, 327.37 per vertex, 19.15 per glyph), and so is its cost at reference items (texts of 4, 13 and 120 glyphs; one status mark; a rect, a label, a 400-segment path, a 120-glyph text); the `costs` call reports `build`: `dev` from the debug binary, an optimized profile from the release one, each with `rustc -V`'s toolchain; and the release binary's own measurement is lower too (a timing reading, gated). "A planted coefficient file marked with a debug profile is refused by the cost model, naming the profile": `--costs fixtures/costs-dev.json` answers `costs_refused` naming `dev`; `costs-base.json` (no profile) is refused with `profile: null`; `costs-release.json` and the committed file start, and `registry.costs` holds their terms. Wrong programs: the base; a file marked optimized with debug terms; a cost model that reads any profile, or refuses every file |
| `#855.6df0cf9c` | Every content key and result digest computed with `hash@2` keys equal documents equally on two machines, a cache written under `hash@1` still hits after the migration's single rekey, and keying a 10,000-item revision takes under half its `hash@1` time | `hash.test.ts`. "Every content key and result digest computed with `hash@2`": `eval` says `hash@2` by default and `hash@1` under the scenario's `hash`, and every node's key and result digest differ between them. "Keys equal documents equally on two machines": the full build's fixtures and a small mixed board, each also spelled otherwise (every object's members, items among them, reversed), evaluated clean at 0.5 s by the debug binary here and by the release binary with another `TZ`, `LANG`/`LC_ALL`, `HOME`, `TMPDIR`, `RAYON_NUM_THREADS` and `machine`: every node's key and result equal across all four; and by an x86_64 build under Rosetta where one can be made (else INCONCLUSIVE). "A cache written under `hash@1` still hits after the migration's single rekey": under `hash: "hash@1"`, two sessions of one board are evaluated; `migrate` goes `hash@1` → `hash@2` with `rekeyed` equal to `entries` > 0, a second `migrate` rekeys 0 and keeps every entry; the first session's keys all change and none of its nodes reruns; a third session of the same content finds every node whose key the first holds as a `hit`, frame-phase results among them; and a fresh `hash@2` process keys the board as the migration did. `keying.test.ts`. "Keying a 10,000-item revision takes under half its `hash@1` time": on the release build, the 10,000-item mixed board keyed by `keys` (7 passes, the median) in a `hash@1` and a `hash@2` process, six pairs with the first discarded; the five ratios judged against 0.5 by the design's rule, gated. Wrong programs: the base; keys that read the machine, the environment, the build or the spelling; a migration that drops the cache, rekeys it wrongly or again; a hash@2 no faster than hash@1 |

## Readings where the issue and design leave a choice

- **One binary, more calls.** Everything is observed through `deep-show run`, the binary the scheduler's, the seal's
  and the cost model's suites drive; the issue's planted programs are its test features and startup arguments.
- **"Writes a JSON value"** is a `Val::Json`-like write, which the seal sees before the first document; "JSON stays
  at check phases" is read as the check-phase writer in the same module being admitted, so the refusal names only
  the frame-phase one.
- **"Counted by the allocator."** An allocator can't tell a JSON value from another allocation by itself, so the
  count is the binary's allocator counting the heap allocations of the JSON values the frame builds or copies for
  operators and the ones they write (the core knows where those are made). The planted writer, let in by
  `--planted admits_frame_json`, makes a zero mean something. JSON an operator body builds and drops inside itself
  is not asked of this count.
- **"A frame with one item changed"** is the frame after a revision that changes one item, for each of the five
  kinds of the board in turn, and the frames of a board whose one rect a clip moves.
- **"Two builds whose Debug output for it differs"** is `full` and `full,test-debug-alt`; `debug` shows the
  difference node by node, so a feature that changed nothing would fail. "Fails, naming the operator" is the
  comparison failing and naming `test.dbg.out`, as #387's planted programs fail its checks.
- **"Today's debug-built ones"** are the base's committed terms, recorded in `helpers.ts` (`BASE_TERMS`). A term
  at the fit's 1 ns floor (text.shape's per-item term) can't fall and is costed through its items instead. "Each
  lower" is every other term and the cost at each reference item.
- **"Marked with a debug profile"** is Cargo's name for it, `dev`. The cost model's input is the coefficient file;
  a process takes it from `--costs` or the build's own. A file naming no profile is refused too (nothing missing
  passes).
- **"On two machines."** No second machine is wired to this suite, so two processes stand in that differ in all a
  machine hands one: the build profile, time zone, locale, home, temp folder, thread count and the `machine`
  fingerprint, with the documents spelled otherwise; the design's arm64 / x86_64 goldens are the x86_64 build
  under Rosetta, run where rustup has the target. "Equal documents" are documents equal under the canonical form.
- **"A cache written under `hash@1`"** is the process's content-key cache written by sessions keyed with `hash@1`
  (no cache outlives a process at the base, and the issue adds none); "still hits" is a later session of the same
  content finding those results by their `hash@2` keys; "single rekey" is a second migration rekeying nothing.
- **"Keying a 10,000-item revision"** is computing every content key of its nodes from the canonical bytes up,
  timed by the binary, on the optimized build the product ships, as a ratio of two fresh processes so the machine's
  speed cancels.

Not tested, because no criterion asks or the surface can't reach it: the canonical encoding's rules themselves
(fields in declared order, integers and floats exactly, strings as UTF-8), beyond a digest being independent of
Debug output; that the trait is one trait; `hash@1` keys read from something outside a process; `benchmarks/canvas.mjs
costs --write` itself (it needs a reference Mac on mains and the GPU passes; the committed file is what it writes);
the shaping cache (not in this task).

## Upstream tests (the Oracle lane)

The issue says no upstream test checks these criteria: the seal's refusal, the canonical bytes, the cost model's
profile and the hash migration are our own rules. So these tests are the local proof for all four.
