# Acceptance tests for #3014: a run writes a fixture's assets only when it needs them

Written first and blind, at base `b6b99ad8c` ("Merge pull request #3003 …"), where the issue's bug is present, from the
issue, the design and the base, before any implementation. The drafting job saw no fix, diff, other branch, other
worktree, pull request or git history after the base. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). There is no taste criterion.

## Sources

- **The issue**, #3014: its cause (`crates/deep-show/src/answer.rs`, the `run` arm, writes every listed fixture's
  assets into the scenario's evidence store before it plays any call), its two scope lines and its two criteria.
- **The design**: `node scripts/design-section.mjs --issue 3014` (Render-back, `docs/canvas-primitives.md`), and
  `docs/technical-design.md`'s Dogfooding, Tests written first, Wrong programs and Failing on an assertion.
- **#2363 and #393, issue text only**: #2363's scope ("the vector module's fixtures present wherever the `fixtures`
  call's reader shows them") and its note that #387's suite shows each listed fixture into a fresh store; #393's
  criterion 4 ("a deep_show call bound to no session is refused").
- **AGENTS.md.**
- **The base, for surfaces only**: `answer.rs` (`run`), the `fixtures` call (`Hub::fixtures_reply` in `frames.rs`),
  `Fixture.assets` and `planted` (`crates/deep-canvas/src/registry/mod.rs`), the modules that carry fixture assets
  (vector, logic, loop; net's and logic's planted ones are not listed), `evidence.rs` (`<2 hex>/<62 hex>`), the hub's
  vector import (`inline_vectors`: an SVG the store doesn't hold is `asset_missing`), the kit (`kit/mod.rs` `KitCall`,
  `judge_part`; `kit/fixtures.rs`; `kit/catalog.rs` `issues_of`) and `scripts/canvas-kit.mjs`, the record and sheet
  modules' fixtures (`crates/deep-canvas-record/src/module.rs`, `crates/deep-canvas-sheet/src/module.rs`), suites 393
  (`helpers.ts`, `writer.test.ts`, README) and 387 (`helpers.ts`, `perturb.test.ts`), the layouts of suites 2874 and
  2870, `scripts/proof-change.mjs` (`criterionId`, `tagsIn`), `scripts/proof-runs.mjs` (how twins are laid and built),
  `scripts/lanes.mjs` (`testGlobs`), `vitest.config.ts` and `tests/vitest-setup.ts`.

## Run

From the repository root, on macOS with Node 24.22:

```sh
npm ci
npm run build --workspaces          # the root Vitest config imports scripts/lanes.mjs, which needs the workspaces' dist
export PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
scripts/lease nice -n 10 cargo build --locked --bin deep-show
NO_COLOR=1 nice -n 10 node node_modules/vitest/vitest.mjs run tests/acceptance/3014 --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/3014/tsconfig.json
```

- Each file runs `cargo build --locked --bin deep-show` (the default, full build, as suite 393 and the kit build it)
  once before its tests; run Vitest with the same `CARGO_*` variables as the leased build so that build is a no-op.
- On November 21, 2026 the whole suite took 8.4 s on the base (its load wasn't recorded; 47 at the next reading): AC1's
  writer.test.ts run 6.4 s, its direct check 0.4 s, AC2's fresh-store opens 6.3 s, AC2's kit 0.2 s. At loads of 110
  to 200 the same suite took 20 to 65 s on the other programs below, no test more than 43 s. Each test sets its own bound (10 to 30 minutes),
  each `deep-show run` is bounded at 5 minutes and stopped by SIGKILL to that child alone, and the nested Vitest run at
  25 minutes.
- **Parallel-safe, no `scripts/lanes.mjs` entry.** Every evidence store is a fresh `$TMPDIR/dh3014-*` folder, removed
  after its test. No port, no daemon, no GPU, no timing assertion. Both files share `target/debug/deep-show` with suite
  393 (cargo's lock serializes their builds). The AC1 test runs `tests/acceptance/393/writer.test.ts` with this
  checkout's Vitest and root config, Vitest's own variables taken out of the child's environment; it writes nothing
  under suite 393's folder.

## The surface under test

The issue names its surfaces: `deep-show run` and its scenario line, the scenario's evidence store, the `fixtures` call,
suite 393's `writer.test.ts`, and the canvas kit's record and sheet fixtures. The tests drive the binary with one JSON
scenario per run, as suites 393 and 387 do, and read the store's files in its `<2 hex>/<62 hex>` layout.

- **A fresh store** is a new empty folder no run touched before the run under test.
- **A fixture's assets** are read from what the store holds; **the hashes a fixture names** are every 64-hex string in
  a listed document (`helpers.ts` `hashesNamed`). At the base the 8 objects a fixture-free run leaves are exactly 8 of
  the 9 hashes the 52 listed documents name (loop's `shading-unreadable` names one it carries no bytes for).
- **The kit** is the `kit` call with `modules: ["record", "sheet"]` and `parts: ["fixtures"]`, in a fresh store, with
  no `ledger`, so the run writes nothing in the checkout (`scripts/canvas-kit.mjs` writes `kit-ledger.json`; these tests
  don't run it).

## Criteria to tests

Each ID is `#3014.` and the first 8 hex digits of the SHA-256 of the criterion's text, trimmed, white space collapsed
(`criterionId` in `scripts/proof-change.mjs`); each test's name starts with its ID.

| Criterion | ID | Test (file) | What it asserts | Wrong programs it fails on | At the base |
|---|---|---|---|---|---|
| AC1 | `#3014.2c886ba2` | `ac1-unbound.test.ts`: *tests/acceptance/393/writer.test.ts, run unchanged, passes every test, its unbound-call test among them* | Vitest's JSON report of writer.test.ts holds its unbound-call test once, every test passed, and Vitest exits 0 | the base; `writes-every-fixture` | **fails** at line 22: writer.test.ts's unbound-call test failed at its line 63, "no evidence was attached: expected [ …(8) ] to deeply equal []"; its other tests passed |
| AC1 | `#3014.2c886ba2` | `ac1-unbound.test.ts`: *a run that lists and opens no fixture writes no fixture's asset: an unbound deep_show leaves its fresh store empty, and a bound deep_show of a plain board leaves none of the hashes the listed fixtures name* | the unbound call is refused with `no_session` and its fresh store holds no object; a bound deep_show of a three-item board is presented and its fresh store holds none of the hashes the listed fixtures name | the base; `writes-every-fixture`; `skips-unbound-only` | **fails** at line 36: the unbound run's store holds 8 objects, the fixtures' assets |
| AC2 | `#3014.2d0d5e25` | `ac2-fixtures.test.ts`: *every fixture the fixtures call lists opens in a reader's fresh store, one no run listed fixtures in, among them one that names an asset by its hash* | the `fixtures` call lists fixtures, some naming an asset by hash; each, shown by deep_show from an agent's session in a fresh store with no `fixtures` call (one run per record, fixtures with the same record together), is presented | `never-writes` | passes: 52 listed, all presented |
| AC2 | `#3014.2d0d5e25` | `ac2-fixtures.test.ts`: *the canvas kit's fixtures part, run over the record and sheet modules in a fresh store, passes each module and every case of their fixtures* | the kit runs both modules, each with one fixtures part; every case of it, each part and each module is PASS, and so is the kit | `record-sheet-regressed` | passes: record 2 cases, sheet 3, all PASS |

AC2 passes on the base because the base is the program #2363 left; it proves itself on its twins.

## The wrong programs

`twins.json` maps each criterion's ID to its twins. A twin holds whole files at their repo paths, laid over the program
by the proof lane before it builds (`scripts/proof-runs.mjs`); each file rebuilds into `target/debug/deep-show` through
the tests' own `cargo build`.

- **The base**, for AC1: every run writes every listed fixture's assets first, so a run of one unbound call leaves 8
  objects (BASE-FAILURE.txt).
- **`writes-every-fixture`** (AC1), for a merge base that no longer shows the bug: the base's `answer.rs`, its write
  loop marked by a comment. Laid over a fix in `answer.rs`, it brings the bug back.
- **`skips-unbound-only`** (AC1): a fix special-cased to #393's test. A scenario holding a deep_show call bound to no
  session writes nothing; every other scenario still writes every listed fixture's assets. Suite 393 passes on it, so
  the first AC1 test does too; the second fails at its plain-board assertion, naming each of the 8 hashes and the
  fixtures that name it.
- **`never-writes`** (AC2), the over-correction: `answer.rs` with no fixture write at all, so a listed fixture whose
  document draws from a stored asset is refused in a fresh store: vector's `stored-paint` (the vector import reads its
  SVG from the store) and logic's `counter` and `readers` (their program). The first AC2 test fails, naming each
  refused fixture with its errors.
- **`record-sheet-regressed`** (AC2): the record and sheet modules with their fixtures' sidecars naming no code, though
  each still raises `unknown_kind` (their kinds aren't registered in the full build), so the kit's fixtures part fails
  their `#codes` cases. It stands for any change that stops those fixtures passing as #2363 left them; no plausible
  fix to the run arm touches them, so the kit test can't fail on the other twins.

Each twin replaces whole files as they are at the base, so a twin may need a blind redraft when main moves them. A fix
that writes fixture assets outside `answer.rs` (in the hub's `fixtures` or deep_show handling, say) isn't undone by
`never-writes` or `writes-every-fixture`; that twin then passes where it should fail, and needs a redraft that reaches
the file the fix changed.

## Readings where the issue leaves a choice

1. **"Its unbound-call test finding no object"** is held two ways: suite 393's `writer.test.ts` run as it stands (the
   criterion's own words; its other tests must pass too), and, with the issue's first scope line ("a run writes a
   fixture's assets only when the run needs them … not every scenario"), a direct check that a run which neither
   lists nor opens a fixture's document writes no fixture asset: the unbound call, and a bound call presenting a board
   that names no asset. A fix that only spares the unbound call (`skips-unbound-only`) fails the second.
2. **"A fixture the `fixtures` call lists opens in a reader's fresh store"** is a run that shows the listed document,
   with no `fixtures` call of its own, in a store nothing was written to before: #2363 notes that #387's suite shows
   each listed fixture into a fresh store, and that suite's fuzzed test shows fixture documents in stores where no
   listing ran. So a fix that writes assets only when a run lists fixtures fails it, while one that writes a fixture's
   assets when a run opens its document (by any means) passes. "Opens" is deep_show from an agent's session presenting
   the document, as #387's suite reads it; the fixture's record goes in the scenario when it has one.
3. **"Still pass as #2363 left them"** is the kit's `fixtures` part over the two modules, all PASS, as at the base.
   The kit's other parts (10,000 clean rebuilds and patch sequences each) aren't run by the suite; run once outside it,
   the whole default kit over record and sheet passed every part at the base in 279 s.
4. Neither test asserts where a fix writes or that the asset is in the store after an open: a fix may read a listed
   fixture's asset without storing it.

## Checked once, outside the suite

On the base, before the suite was written: a lone `fixtures` call wrote the same 8 objects; each of the 52 listed
fixtures, shown alone in its own fresh store, was presented (about 1 to 3 s a run, 17 s for `graph/over_budget`); all
50 fixtures with no record, shown together in one fresh store, were presented in one 18 s run; the whole default kit
over record and sheet passed (279 s at a load of about 200).

Then each program was laid over the base in this worktree, never committed, built through `scripts/lease`, and the
suite run once on it, on November 21, 2026, at a load of 110 to 200:

| Program | What it is | Result |
|---|---|---|
| right program A | the `run` arm writes a listed fixture's assets only when the scenario holds a `fixtures` or `kit` call, or a call whose `document` is that fixture's document (`answer.rs` only) | 4 of 4 pass (65 s) |
| `writes-every-fixture` over A | the twin's `answer.rs` laid over A | both AC1 tests fail as on the base (line 22: writer.test.ts's unbound-call test finds 8; line 36: 8 objects); both AC2 tests pass (42 s) |
| `skips-unbound-only` | its `answer.rs` | the writer.test.ts test passes; the direct AC1 test fails at line 42, the plain-board run leaving the 8 hashes, each named with its fixture; both AC2 tests pass (40 s) |
| `never-writes` | its `answer.rs` | both AC1 tests pass; the fresh-store AC2 test fails at line 44, naming `logic/counter` (`logic_refused`), `logic/readers` (`logic_refused`, `ref_unresolved`) and `vector/stored-paint` (`asset_missing` at `items/mark/params/src`); the kit test passes (27 s) |
| `record-sheet-regressed` over A | its two module files, with A's `answer.rs` | AC1's tests and the fresh-store test pass; the kit test fails at line 65: `parity/record/level.board#codes` and `parity/sheet/variants.board#codes` raise `unknown_kind`, expected none, each part and module FAIL (20 s) |

- `skips-unbound-only` and `never-writes` replace `answer.rs` whole, so laid over A they are the same programs as over
  the base. The AC2 file's header comment was rewrapped after the base run and before these; no test file changed
  after them, and the line numbers above are the files' as committed.
- Afterwards the three base files were put back with `git checkout --`, and `git status` showed only
  `tests/acceptance/3014/`. No `dh3014-*` folder was left after any run. `target/debug/deep-show` was last built from
  `record-sheet-regressed`; the next `cargo build` rebuilds it from the checkout.
- Not run: Linux, and the proof lane itself (`scripts/proof.mjs`); the twins were laid by hand as the lane lays them.

## Files

- `helpers.ts`: the binary built once per file and run on one scenario, fresh stores and their objects, the scenario's
  world (one agent session, its process table, one panel, documents the hub minted), the plain board, the `fixtures`
  listing, `hashesNamed`, and suite 393's file run through Vitest with a JSON report.
- `ac1-unbound.test.ts` (AC1), `ac2-fixtures.test.ts` (AC2).
- `twins.json` and `twins/writes-every-fixture/`, `twins/skips-unbound-only/`, `twins/never-writes/`,
  `twins/record-sheet-regressed/`: the wrong programs above.
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`, twins left out.
- `BASE-FAILURE.txt`: the run on the base.
