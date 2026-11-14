# #374 binary-consumer blind redraft (part of #1123)

Inputs: issue #374, tooling issue #1123, the named designs, and archive `092754bb1` only.
No implementation checkout, parent results, or original `BASE-FAILURE.txt` was read.
This is a separate consumer redraft, not a tooling implementation or lane migration.
All original files, goldens, lists and decisions remain untouched. No criterion is retired.

## Files and preserved bytes

- `paint.test.ts`, `stroke.test.ts`, `steps.test.ts`: byte-identical copies of
  `../374/` (7 + 2 + 2 tests). Their sole import remains `./helpers.ts`, which resolves here.
- `helpers.ts`: copied from `../374/helpers.ts`; only binary location/build lifecycle and
  its imports changed. JSON fixtures, PNG decoder, numeric oracles, and all helpers from
  `batch` onward are unchanged. Fixture data is inline; no fixture imports to relocate.
- `wrong-program.json`: three exact source mutations, applied together in a disposable
  copy; one intended behavior-assertion failure per test file, no test edits.
- `prove-consumer.mjs`: executable parent-run recipe consuming real clean/mutated binaries.
  It builds nothing and runs all three files together, with file parallelism and 3 workers.
- `VALIDATION.txt`: local observations and explicit unrun checks.

SHA-256 of **both** original and copy, verified by byte comparison here:

| File | SHA-256 |
|---|---|
| `paint.test.ts` | `97aaf1863c4bc8d120c5f209db9396f47cf5823463f7add7391b25cc18e4fa2c` |
| `stroke.test.ts` | `057c5176506b35e091a991ca85e144ee9b7771f1d986c16145b06e007144b1b6` |
| `steps.test.ts` | `4b0f2d4b954bcac24b0a964122a8079155efae3fa001ac460673a0a8128b2de5` |

Recheck from the repository root:

```sh
for f in paint stroke steps; do
  cmp "tests/acceptance/374/$f.test.ts" "tests/acceptance/374-binary-redraft/$f.test.ts" || exit 1
  shasum -a 256 "tests/acceptance/374/$f.test.ts" "tests/acceptance/374-binary-redraft/$f.test.ts"
done
diff -u tests/acceptance/374/helpers.ts tests/acceptance/374-binary-redraft/helpers.ts
```

Copied base files have no per-file license notice to remove. They remain under the repository's
Apache-2.0 license (`LICENSE`). No third-party source is ported.

## Binary contract

`DEEP_BIN_DIR` supplied: execute precisely its `deep-canvas-render` (`.exe` on Windows),
without cargo, copying, or writing to that directory. An empty value, missing file, directory
in place of a file, or non-executable file throws `BLOCKED` in `beforeAll`; it cannot fall
back to a checkout binary. A relative directory resolves from the test process's cwd.
A binary that fails to start or serve JSON fails; it never becomes a pass.

Variable absent: each isolated Vitest file creates a unique OS-temp target, builds directly
there using `cargo build --locked --bin deep-canvas-render --target-dir <private-target>`,
and consumes only `<private-target>/debug/deep-canvas-render`. Inherited `CARGO_TARGET_DIR`
is removed for that build. The target is removed in `afterAll`, including on build failure.
No shared `target/debug` reader and no build-to-copy race. Keep Vitest's default file isolation.
The existing PNG scratch directories are already per-file and unchanged.

## Requirement → unchanged check → wrong program

All behavior enters the original `deep-canvas-render check` / `raster` JSON-lines surfaces;
colors, alpha, widths and lengths come from actual Vello CPU PNG pixels, not metadata or mocks.
`check` must accept each valid document; status violations must have the original exact code,
item count and path, and `raster` must refuse the invalid along stroke.

| Requirement | Preserved check, expected values / refuter |
|---|---|
| AC1 sw→ne | `paint`: seven samples of the 200 u square, computed OKLab ramp, ≤1 code value. Default w→e misses the diagonal. |
| AC1 parent span | `paint`: 3 squares over 341 u; middle centre ≤0.001 ΔEOK from midpoint; left/right/edge samples ≤1 code value from the shared ramp. **P** below leaves the midpoint correct but fails the left sample. |
| AC1 independent opacity | `paint`: fill 0.5 ±0.01, stroke centre on both ground and fill ≥0.99; stroke 0.5 leaves fill full, and paint 0.5 multiplies both (alpha error ≤0.01, full fill ≤1 code value). Coupling fill/stroke opacity or ignoring stroke opacity is wrong. |
| AC1 scope: stop opacity, along | `paint`: 16 columns of opacity-0→1 ramp and 8 arc-length samples on a 400 u bent stroke, all ≤1 code value. Dropping opacity or using a box-wise gradient is wrong. |
| Paint status rule | `paint`: steps, opacity stops and along each produce exactly `status_color_unbound`, one item and the expected path prefix; raster refuses along, corrected data-role twin passes. Accepting status paint or refusing every new field is wrong. |
| AC2 scale | `stroke`: 4 ±0.1 u with omitted/false, byte equality omitted=false; 12 ±0.1 with true, both crossings; geometry centre x=240 ±0.3. **S** below keeps geometry but leaves true at 4. |
| AC2 fitted dashes | `stroke`: circle r=100, 12 dashes/12 gaps, 24 half-coverage crossings sampled every 0.25 px; each length within 0.5 px of 2π100/24; exactly 12 ink intervals, alternating. Wrong count or unfitted gaps fails. |
| AC3 steps | `steps`: 5 squares, endpoints exactly roles a/b; third ≤0.001 ΔEOK, quarters ≤1 code value; 4 corners per member equal its centre; shuffled keys read ranks [2,0,4,1,3]. **R** below assigns the last t=4/5 instead of 1. Position/ID rank and gradients inside members remain refuted by unchanged checks. |

The executable combined mutant's mappings (not just a numerical oracle self-check):

| Mutation | Real source changed only in disposable copy | Required red assertion |
|---|---|---|
| **P**, `paint.test.ts` | `paint.rs`: `span: parent` parses as `Span::Item` | `the left sample (70, 70) reads the one gradient` (code error >1); the middle-only assertion cannot kill this mutant |
| **S**, `stroke.test.ts` | `scene.rs`: scale factor √\|sx×sy\| becomes `1.0` | `with scale_stroke true the stroke is` (width error >0.1, after the geometry check) |
| **R**, `steps.test.ts` | `scene.rs`: rank/(n−1) becomes rank/n | `the last square reads exactly the last role` (pixel inequality) |

There are no separate property/scope-only files: all three `.test.ts` files have a concrete
source-mutant mapping; the status/scope assertions in `paint.test.ts` remain intact. These
three mutants are a per-file migration gate, **not** a claim to have killed a mutant for every
individual assertion. Compilation and the named red failures are **BLOCKED/unrun here**.

### Existing coverage boundaries (not silently promoted to proof)

The original sw/ne test compares corner *pixel centres* against their ramp t, not against
bare endpoint roles (its comment says the difference is two code values). This interpretation
is preserved, not newly approved as proof of the issue's literal endpoint wording.
The base suite also has no direct checks for steps by x/y/distance, collection ID, span ID,
item-only scaling, √\|sx×sy\| under anisotropic scaling, or dash counts on multiple/open
subpaths. Those scope fields remain unproven here; this binary-only redraft neither drops
requirements nor claims all #374 criteria/scope complete. Original `../374/README.md` records
these same fixture choices/boundaries. No failing check or tolerance was weakened to fill them.

## Parent-run prerequisites and commands

Needs Node ≥24.22, the repository's already-installed Vitest 5 dependencies, its pinned Rust
and native dependencies/cached crates, and a host capable of building `deep-marks-render`.
Do not install anything as part of these recipes. Provide **test-private**, already populated
`CARGO_HOME` and `RUSTUP_HOME`, not real home paths; builds use `--offline`, wrappers disabled.
Only the renderer binary is built, never the full application/workspace. A build failure is
BLOCKED, never red evidence. Run on Mac and Spark as the tooling issue requires; do not infer
one platform from the other.

For a lane-provided binary, the ordinary parallel run is:

```sh
DEEP_BIN_DIR="$RUN_PRIVATE_BIN" node node_modules/vitest/vitest.mjs run tests/acceptance/374-binary-redraft --fileParallelism --maxWorkers=3
```

To prepare the wrong program, run the following **in a disposable exact snapshot** of the side
being tested, with this redraft overlaid and existing dependencies. Never mutate the working
checkout or a producer's `DEEP_BIN_DIR`. No git history beyond that side is needed.

```sh
set -eu
: "${CARGO_HOME:?test-private cached cargo home required}"
: "${RUSTUP_HOME:?test-private cached rustup home required}"
RUN=$(mktemp -d)
export RUN
mkdir "$RUN/home" "$RUN/good" "$RUN/wrong"
export HOME="$RUN/home" RUSTC_WRAPPER= CARGO_BUILD_RUSTC_WRAPPER=
unset CARGO_TARGET_DIR DEEP_BIN_DIR
cargo build --offline --locked --bin deep-canvas-render --target-dir "$RUN/target"
cp "$RUN/target/debug/deep-canvas-render" "$RUN/good/"
# Sole writer owns RUN/target; no consumer starts until both completed builds are copied.
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const mutations = JSON.parse(readFileSync('tests/acceptance/374-binary-redraft/wrong-program.json', 'utf8'));
const sources = new Map();
for (const {file, from, to} of mutations) {
  const text = sources.get(file) ?? readFileSync(file, 'utf8');
  assert.equal(text.split(from).length, 2, `BLOCKED: mutation anchor drift: ${file}`);
  sources.set(file, text.replace(from, to));
}
for (const [file, text] of sources) writeFileSync(file, text);
NODE
cargo build --offline --locked --bin deep-canvas-render --target-dir "$RUN/target"
cp "$RUN/target/debug/deep-canvas-render" "$RUN/wrong/"
node tests/acceptance/374-binary-redraft/prove-consumer.mjs "$RUN/good" "$RUN/wrong"
# Discard this mutated snapshot after saving redacted evidence. Do not commit its sources.
```

`prove-consumer.mjs` runs red then green **unchanged**, through normal file-parallel Vitest.
It restricts PATH to real Node and `/bin/ps` (needed by the unchanged cleanup setup): no cargo,
no fake cargo and no fake renderer. Each red file must fail at its mapped behavior assertion,
not merely exit nonzero. Green requires all 11 tests passed. Both binary SHA-256/size/mtime
seals must remain unchanged. Empty and missing bin directories must then BLOCK all behavior.
JSON reports remain in a fresh `deep-374-proof-*` temp directory, with private paths redacted.
A missing report, setup failure or compile failure is not a successful wrong-program kill.

Hand-run fallback, in a fresh **unmutated** disposable snapshot with the same private cached
Rust homes and private HOME (retains ordinary helper behavior; no new test flag):

```sh
unset DEEP_BIN_DIR
export CARGO_NET_OFFLINE=true RUSTC_WRAPPER= CARGO_BUILD_RUSTC_WRAPPER=
node node_modules/vitest/vitest.mjs run tests/acceptance/374-binary-redraft --fileParallelism --maxWorkers=3
```

The parent must additionally run `node scripts/affected.mjs` after approved integration and
report its WIDE/INCONCLUSIVE lines. This archive has no git metadata, node_modules, target or
cargo on PATH; it cannot provide that proof. No lane edits, before-lane per-side proof, inherited
shell-value sanitization proof, or alone-block timing reading is supplied by this consumer job.
Do not move the original folder or claim `Closes #1123` until the parent's remaining gates run.
