# #375 binary-consumer blind redraft — Part of #1123

Drafted only from the two issue texts, design and archive **092754bb1**. No implementation,
parent diff/transcript/review/results were read. Existing tests/helpers/goldens/lane lists are
untouched. This is a new consumer suite, not a tooling implementation or migration approval.

**Status: BLOCKED for behavioral proof.** No Rust compilation, Vitest execution, typecheck,
red/green or lane run was possible here: no cargo on PATH, no node_modules or .git. Recipes
below identify real-source wrong programs; **their compilation and intended assertion failures
are UNRUN**, not inferred PASS. Parent must run these exact tests unchanged before moving #375.

## Files and preserved contract

- `column.test.ts`, `row.test.ts`, `grid.test.ts`, `never.test.ts`, `scope.test.ts`: byte-identical
  copies of `../375/`. All 12 tests, fixture checks, messages, tolerances and property generators
  remain; `never` still uses seed **375**, **1,000 cases per property**, and shrinking.
- `fixtures/{column,row,grid}.doc.json`, `tsconfig.json`: byte-identical copies; `./helpers.ts`
  imports and helper-relative fixture reads resolve inside this new folder.
- `helpers.ts`: only binary ownership/setup changed. `DEEP_BIN_DIR` when defined selects exactly
  its `deep-layout` / `deep-text` (platform suffix retained), with no build, copy, overwrite or
  shared-target fallback. Empty/missing/non-executable inputs fail before behavior assertions.
  Without it, a per-file mkdtemp target is built using `--target-dir` after dropping inherited
  `CARGO_TARGET_DIR`, used directly and removed by `afterAll`. Build failure is BLOCKED.
  Every box reader, JSON-lines assertion, shaper comparison, metadata check and TOL=0.5 is unchanged.
- `plant.mjs`: exact, fail-on-drift source mutations, only for disposable copies of the base.
- `prove.sh`: executable recipe (invoke with bash) for real compiled twins, binary-selection and
  no-build checks, missing inputs and a concurrent private-build hand run. No installs or lane edits.

Ported material remains Apache-2.0 under repository `LICENSE`; original comments are preserved.
No separate copyright/license notice was present in the copied tests/helper. See `../375/README.md`
for the original surface and generator specifications, **not** its historical execution claims.
The original `BASE-FAILURE.txt` is not new proof and is not copied.

## Requirement → check → wrong program

All numeric observations enter through **`deep-layout solve`**, JSON lines with `{doc, readings?}`;
text sizes enter through **`deep-text fit`**, and scope through real **`cargo metadata`**. These are
#375's existing acceptance surfaces, not new tooling APIs. No helper computes expected layouts.

| Requirement / preserved checks | Wrong real-source program (`plant.mjs` name) | Intended behavior failure (not setup failure) |
| --- | --- | --- |
| AC1 column: three texts; gap **12**, padding **8**, origin **(40,32)**, shaper width/height, padded widest width and summed height, all **0.5 u** | `padding`, `gap`, `shape` | `column.test.ts`: `title starts at the left padding`, `status sits 12 u below title`, or `title's width is the shaper's` |
| AC1 one-line growth: shaper counts +1 line; status gains the shaper's height delta, note moves by exactly it and stays 12 below new bottom; title stays; frame grows and still hugs the wider text | `growth` (use one-line height for every shaped leaf) | `column.test.ts`: `the second item grows by one line's height (the shaper's)` |
| Original surface: malformed JSON and missing doc each return exactly `{ok:false,code:'bad_input'}`, one line out per line in | All mutants retain real stdin parsing; unchanged column test still checks it on green | No stub/protocol crash qualifies as geometric red proof |
| AC1 row: original six fixed widths **40,120,64,96,52,80**, heights **30,56,44,72,24,60**; order keys, gap **24**; fixed sizes, shared bottoms within **0.5 px**, sum **452 + 5×24 = 572 u** | `row` forces cross alignment start; `gap` drops gaps | `row.test.ts`: `the six bottoms are on one line within 0.5 px` (spread 48); gap mutant fails `apple ... sits 24 u right of kiwi` |
| AC1 grid: same six, 2 hug rows, 3 hug cols, column flow; every fixed box stays in its cell, child 2 row 2/col 1 | `grid` flows by row | `grid.test.ts`: `child 2 (apple) sits in row 2, column 1` |
| AC1 grid column 3 end alignment: date/lime east sides agree and equal the track east edge within **0.5 px** | `east` centers aligned columns | `grid.test.ts`: `column 3's east sides are on one line within 0.5 px` (14 u apart) |
| Never overlap: all generated row/column/grid/nested trees, fixed/fill, hug/fixed roots, wrap, gaps per axis, track types, reversal/alignment; preserve fixed sizes | `overlap` discards relative child positions while reading actual Taffy sizes | `never.test.ts`: `flow children ... overlap`, not missing boxes or zero-size acceptance |
| Never depend on own result: sample order then reverse in same process, repeat bytes equal | `history` adds an increasing solve-count translation to actual boxes | `never.test.ts`: `the same document solved again ... byte for byte` |
| Never resize with a live number: all boxes equal for 2–4 readings 0–9999; leaf sized by **8,888,888** with tabular numerals, sizes 11/13/16/20 and weights 400/500/600 | `widest` measures the bound leaf's placeholder instead | `never.test.ts`: `the bound text is as wide as its widest, 8,888,888, as the shaper measures it` |
| Scope: exactly one workspace bin owner, canvas-module name, normal dependency closure includes **taffy** and **deep-text** | `scope` moves the real `deep-layout` main target from deep-canvas-marks to existing deep-motion (already depends on the same solver, shaper and serde_json) | `scope.test.ts`: `deep-motion is a canvas module crate (deep-canvas…)`; metadata succeeds, owner count stays one, program remains real |
| Supplied **deep-text**, not a locally rebuilt shaper | `text` makes real fit report shaped width +4 (layout library unchanged) | `column.test.ts` leaf-width and `never.test.ts` widest-width assertions |

`all-files` combines **padding + row + grid + widest + scope**. One build then refutes **every
redrafted .test file** in the same ordinary file-parallel Vitest invocation. It has no fixture-ID
special case, env-selected production fault, fake executable or altered test. Individual variants
isolate each cause. `scope.test.ts` intentionally still calls real cargo **metadata**, never build;
it describes the source workspace, not the externally supplied binary's provenance. Do not claim
this scope test proves base/change binary separation; the two-directory behavioral runs do that.

## Parent recipe and prerequisites (UNRUN here)

Use a pristine base copy with this redraft overlaid and dependencies **already provisioned**:
Node >=24.22, pinned Vitest/fast-check/TypeScript, Rust **1.99.1**, cached locked Cargo dependencies
and bundled fonts. No install/fetch is part of this recipe. Need enough disk for disposable sources
and private targets, and an ordinary Mac or Spark CPU test slot. No GPU, budget window, signing,
external service or full application build is needed. Run on both hosts before a cross-host claim.

Provide **disposable pre-provisioned** `HOME`, `CARGO_HOME`, `RUSTUP_HOME`, and a private `TMPDIR`;
do not point them at the real home or writable shared toolchain caches. `prove.sh` uses offline
Cargo and disables wrappers (so no shared sccache server writes). Its source argument must be a
base-only tree, not the parent's implementation checkout. Its second argument must not exist and
must be outside the source tree. All paths below are placeholders, not personal paths.

```sh
bash tests/acceptance/375-binary-redraft/prove.sh "$BASE_WITH_REDRAFT" "$NEW_SCRATCH"
```

The script builds only **deep-layout + deep-text** per source variant, into variant-private targets,
then copies completed binaries to separate, read-only-file `bin` directories. It runs:

1. RED `all-files` against its own binaries and metadata, all five files parallel (2 workers).
2. RED on **clean source** with wrong binaries supplied: four binary consumers must fail while
   scope passes. This catches rebuilding clean source instead of consuming `DEEP_BIN_DIR`.
3. GREEN same tests on clean source/binaries, plus simultaneous independent red and green sides.
4. RED clean source with `text`-only wrong binary build: proves selection of deep-text too.
5. Absent / partial (layout only) / non-executable text / empty `DEEP_BIN_DIR`: all must fail before
   assertions, not invoke cargo build or run a shared binary.
6. With `DEEP_BIN_DIR` absent, row and grid run concurrently, build in private targets, and leave
   an inherited `CARGO_TARGET_DIR` decoy unchanged.

A PATH guard logs cargo attempts and **delegates metadata to real cargo**, rejecting anything else
in supplied mode. No owned component is mocked. Hashes before/after each supplied-mode run must
match. A nonzero status alone is **not a mutant kill**: review verbose logs for every mapped
assertion above. Setup/build/import/timeout failures are BLOCKED/INVALID, never red proof. Keep
logs until reviewed, redact scratch/home paths before sharing, then remove only that scratch tree.
The script deliberately leaves logs for inspection and does not issue a PASS or change lane lists.

For individual mutants, make a fresh disposable base copy for each, then:

```sh
node tests/acceptance/375-binary-redraft/plant.mjs "$COPY" growth # or any table name
(cd "$COPY" && cargo build --offline --locked --target-dir "$PRIVATE_TARGET" \
  --bin deep-layout --bin deep-text)
(cd "$COPY" && DEEP_BIN_DIR="$PRIVATE_TARGET/debug" \
  node node_modules/vitest/vitest.mjs run tests/acceptance/375-binary-redraft/ \
  --fileParallelism --maxWorkers=2 --reporter=verbose)
```

Never build into that target while tests use it. For direct green consumption, use the same Vitest
command with the side's own prebuilt directory. For a hand run, unset `DEEP_BIN_DIR`; do not use
`--no-file-parallelism`. Typecheck: `node node_modules/typescript/bin/tsc -p
 tests/acceptance/375-binary-redraft/tsconfig.json` (one line).

Parent integration must additionally run `node scripts/affected.mjs` for these new paths, retain
its **WIDE / INCONCLUSIVE** lines, and prove the actual parallel lane before removing #375 from
alone. This redraft does not implement #1123's childEnv merge order, inherited-env scrubbing in
lanes/affected, per-bay publication, other folder redrafts or wall-time readings. Those remain
parent proof, and #1123 cannot be closed on this artifact alone.

## Preserved bytes and local validation

Node's byte comparison against `../375/` succeeded for all nine copied files; JSON parsing succeeded
for the three fixtures and tsconfig. SHA-256 (original **equals** redraft):

```text
dc3ca39eb599909ca6dd52798b316a37d888938e702e16a51c8bb696373c1bcc  column.test.ts
5caf242fdcf742b77a8b01ae0e1a69ab95ad527346c2f426ecf904b91515d255  grid.test.ts
fc3e3043351c649339940d05c3fe5e12f8aaaa678f2d380fccbb59dbe67edecc  never.test.ts
e1508a9814c5f530c705636a3cca50fbf761b4aa17053754ab242ba289a318e0  row.test.ts
7f10a543f55e15bbbe188287e8b616e990b2dde7aeb1ed0c87a8eb7edffb5274  scope.test.ts
c5b0031dc2191959d86202363d79087b03e941d881587792b08e308dc9e69c0a  tsconfig.json
f6c0666e2f4f18f4438ace56b85f74b29ea2c9336376ae431839b56fd438e90f  fixtures/column.doc.json
5ea3c74609d1e15e9af23c6ac1375818c03c3fcd493c9309be71e25c58186e0d  fixtures/grid.doc.json
2acc6ab303c3048b419ca449099b2d75f8bca0bb500db32f452b30ff38d646d7  fixtures/row.doc.json
```

Recheck with `cmp ../375/<file> <file>` from this folder. `node --check` accepted all six TS files
and `plant.mjs`; `bash -n prove.sh` accepted the recipe. All 13 source-mutation recipes matched
unique anchors in small disposable copies of base files. These are syntax/fixture checks only,
**not** a TypeScript typecheck, Rust compile, real component execution or behavioral proof.

Attempted `node scripts/affected.mjs --list tests/acceptance/375-binary-redraft/helpers.ts` exited 1:
`ERR_MODULE_NOT_FOUND: Cannot find package 'typescript' imported from <BASE>/scripts/affected.mjs`.
A separate byte comparison also confirmed the helper's tolerance, fixture/box/JSON functions,
protocol assertions, shaper measurements and metadata/closure logic match the original unchanged.
Only binary ownership/setup differs. The new handwritten helper delta and recipes/docs total under
400 lines; the larger delivered line count is the explicitly requested unchanged behavior copies.

The affected command reached no selection; **no WIDE or INCONCLUSIVE lines were emitted**. Full affected execution,
all red/green runs, failure locations, both platforms and release property count remain **BLOCKED /
UNRUN**. No acceptance criterion is claimed PASS from source review.
