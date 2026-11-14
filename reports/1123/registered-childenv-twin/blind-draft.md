# #1123 AC3: supplemental planted wrong program

Status: **INCONCLUSIVE — original acceptance execution is deferred to the main agent.** No acceptance PASS or twin-kill claim is made.

## Proposed additions

Copy only the `tests/` subtree of this output into the receiving repository:

- `tests/acceptance/1123/twins.json`
- `tests/acceptance/1123/twins/child-env-delete-after-merge/scripts/proof-runs.mjs`

If a registry already exists there, append `child-env-delete-after-merge` to the array for `#1123.cd6b3dd8` without removing any other entry. This output's registry is the additive fragment; the supplied base has no `tests/acceptance/1123/` directory.

The twin contains the **complete replacement module**, not a patch, wrapper or helper-only module. All base exports, signatures, imports, comments and source notices remain. It retains the repository's Apache-2.0 licensing (`base/LICENSE`); there is no per-file license notice in the original module to remove. The 887-line replacement is mechanically copied base code plus one handwritten line, not a new implementation.

## Requirement → change → proof

Criterion `#1123.cd6b3dd8`:

> An inherited `DEEP_BIN_DIR` in the shell is ignored by `lanes.mjs` and `affected.mjs`, and a per-side value passed to `childEnv` survives

The issue's Proof expressly requests a planted `childEnv` that deletes after merging. This twin covers **that complementary wrong case only**: `childEnv({ DEEP_BIN_DIR: side })` removes `side` instead of preserving it. It also removes an inherited shell value. It does not plant a shell-leak fault in `lanes.mjs` or `affected.mjs`, move folders, supply binaries, or prove the other acceptance criteria.

Inputs used: immutable archive `092754bb14a75cd07157e623e21b0d9e7a51677a`, `issues/1123.json`, base `AGENTS.md`, relevant design and base source/runner conventions. No working implementation, branch objects, sibling task contents/results or reports were read.

### Exact base delta

The supplied base's `childEnv` has **no** `DEEP_BIN_DIR` deletion, although the issue describes a then-current merge-then-delete version. Adding the following one line plants precisely the named behavior without assuming any later implementation:

```diff
 export function childEnv(extra = {}) {
   const environment = { ...process.env, ...extra };
+  delete environment.DEEP_BIN_DIR;
   delete environment.NODE_TEST_CONTEXT;
```

No other byte of `scripts/proof-runs.mjs` differs from the supplied base. No acceptance test, helper, golden, runner decision or production file is proposed for editing. The wrong program is reachable only as a test overlay, never through a runtime switch.

### Runner contract inspected in the base

- `scripts/proof-runs.mjs:457–469`: `twins.json` maps criterion tags to arrays of folder names, not paths or commands.
- `:556–596`: the runner enumerates files below `tests/acceptance/<issue>/twins/<name>/`, removes that prefix, and copies each file to the corresponding path in a prepared change copy. Thus this twin replaces **`scripts/proof-runs.mjs`**, whose relative imports still resolve beside the change copy's other scripts.
- It refuses replacements under test paths or `node_modules`. This twin has exactly one replacement, neither of those. Do not place documentation or extra support files inside the named twin folder: they would become replacements too.
- `:563` skips a twin for a test already failing at an assertion on the merge base. Registration alone therefore does **not** prove that this supplemental twin ran. Inspect the result for this twin explicitly, or do the direct supplemental execution below.
- `:603–605` counts an assertion failure, not an import failure, skipped test, setup failure or nonzero exit alone.

## Checks performed here

Environment: Node `v24.22.2`. No builds, installs, full suites, GUI, commits, signing or GitHub operations.

1. `node --check tests/acceptance/1123/twins/child-env-delete-after-merge/scripts/proof-runs.mjs` (under this output): exit 0.
2. Exact byte comparison against base: the added deletion is the only source difference. Registry shape and the criterion's normalized SHA-256 ID were checked.
3. An in-memory smoke invocation of the **unaltered extracted declaration** of `childEnv` observed: explicit `/per-side-bin` removed, inherited `/inherited-bin` removed, unrelated extra retained, input objects unchanged, and existing `NODE_TEST_CONTEXT` / `__STRYKER_ACTIVE_MUTANT__` removal retained. This was not an acceptance test or full-module import and is not criterion proof.
4. Full-module import prerequisite: **BLOCKED**. Importing the base module encountered `ERR_MODULE_NOT_FOUND` for `typescript` from `base/scripts/proof-change.mjs`. The archive has no `node_modules`; installation was forbidden. No dependency stubs were substituted.
5. Required affected-selection attempt, from `base`:

   ```sh
   node scripts/affected.mjs --list \
     tests/acceptance/1123/twins.json \
     tests/acceptance/1123/twins/child-env-delete-after-merge/scripts/proof-runs.mjs
   ```

   Exit 1: `ERR_MODULE_NOT_FOUND`, package `typescript` imported from `base/scripts/affected.mjs`. Selection never started. **WIDE:** none emitted. **INCONCLUSIVE lines:** none emitted. This is BLOCKED selection, not an empty/green selection; no affected tests ran.
6. Original acceptance execution / real reporter classification: **unrun**. The allowed archive contains no #1123 acceptance files. Main must supply the unchanged independently drafted originals. Full receiving-checkout import compatibility and absence of unrelated acceptance failures remain unverified.

## Exact validation instructions for the main agent

Use a dependency-ready **disposable copy of the intended change**, containing the unchanged original #1123 tests and all production dependencies. Do not execute the file in place inside `twins/`: its sibling imports are intentionally resolved only after overlaying it at `scripts/proof-runs.mjs`. Do not modify acceptance tests to accommodate this base-derived module. An absent export, missing dependency or setup exception is BLOCKED/INVALID evidence, never a kill.

### Normal registered proof

With the existing issue association and an offline issue-body directory already configured (`DEEP_PROOF_ISSUES/<n>.md`, containing the supplied JSON's `body`, not JSON), the existing entry is:

```sh
node scripts/proof.mjs before trace
```

Run only in the main agent's authorized proof phase: this entry prepares copies and can build/install; it was **not** run by this drafting job. Preserve its reports. Require an actual `child-env-delete-after-merge` result. A line saying only `failed on the merge base at its assertion` does not show the planted twin ran. There is no `--twin` option in the inspected runner; do not invent one or change its skip policy.

### Direct supplemental execution when the runner skips this twin

In the disposable dependency-ready copy, set `AC3_TEST` to the **existing original acceptance test file** that calls `childEnv` and verifies the explicit per-side value. Its filename is deliberately not guessed: it is absent from the allowed base. Set `EVIDENCE` to a fresh absolute evidence directory **outside** that checkout. Use the same unchanged file on both sides. Run a clean control first and retain its real reporter output, then overlay and repeat the exact command. For an original `.mjs`/`.js` file:

```sh
: "${AC3_TEST:?set to the unchanged original childEnv acceptance file}"
: "${EVIDENCE:?set to a fresh absolute evidence directory outside the checkout}"
mkdir -p "$EVIDENCE"
node --test --test-reporter=./scripts/proof-reporter.mjs \
  --test-reporter-destination="$EVIDENCE/clean.jsonl" "$AC3_TEST"
```

For an original `.ts` file, use instead:

```sh
DEEP_PROOF_VITEST_REPORT="$EVIDENCE/clean.jsonl" \
  node node_modules/vitest/vitest.mjs run --no-file-parallelism \
  --reporter=./scripts/proof-vitest-reporter.mjs "$AC3_TEST"
```

If the clean control is not runnable and passing at the required assertion, stop; this is not twin evidence. After that control, use a subshell to restore the original source even if the wrong program exits nonzero:

```sh
(
  set -eu
  cp scripts/proof-runs.mjs "$EVIDENCE/proof-runs.clean.mjs"
  trap 'cp "$EVIDENCE/proof-runs.clean.mjs" scripts/proof-runs.mjs' EXIT
  cp tests/acceptance/1123/twins/child-env-delete-after-merge/scripts/proof-runs.mjs \
    scripts/proof-runs.mjs
  node --check scripts/proof-runs.mjs
  node --input-type=module -e \
    'const m = await import("./scripts/proof-runs.mjs"); if (typeof m.childEnv !== "function") throw Error("missing childEnv");'
  case "$AC3_TEST" in
    *.mjs|*.js)
      node --test --test-reporter=./scripts/proof-reporter.mjs \
        --test-reporter-destination="$EVIDENCE/twin.jsonl" "$AC3_TEST"
      ;;
    *.ts)
      DEEP_PROOF_VITEST_REPORT="$EVIDENCE/twin.jsonl" \
        node node_modules/vitest/vitest.mjs run --no-file-parallelism \
        --reporter=./scripts/proof-vitest-reporter.mjs "$AC3_TEST"
      ;;
    *) echo 'BLOCKED: use the original test runner for this file'; exit 2 ;;
  esac
)
```

The expected result is a real assertion failure tagged `#1123.cd6b3dd8`, reporting the lost per-side `DEEP_BIN_DIR` (expected supplied value, actual absent/undefined), with the first assertion frame in the unchanged acceptance test. Verify test bytes are unchanged, imports/setup ran, no required test was skipped, and any other failure has not been misreported as this kill. If the full replacement loses an API or setup the receiving tests require, report the incompatibility; do not repair tests or claim proof.

After adoption, also run `node scripts/affected.mjs --list` with the two added paths above, then the corresponding affected invocation without `--list` in the authorized validation phase. Save and disclose all WIDE and INCONCLUSIVE lines. No full neighbouring suites are requested here.

## SHA-256

| Input/output | SHA-256 |
|---|---|
| `base/scripts/proof-runs.mjs` | `48da92cd833f86f1f302ee60dc1910d4dcff65025bf4dfda5ac90586e9201d96` |
| `tests/acceptance/1123/twins/child-env-delete-after-merge/scripts/proof-runs.mjs` | `be2aff56f2b0538274ebba077c8523a01ba1f24bb82e4e26d58efc09226d143c` |
| `tests/acceptance/1123/twins.json` (this fragment) | `d224f876a093e6ecd7502707480440b32e86a38d86257d1f73a6d590c5674b08` |
| `issues/1123.json` | `325b37aeba8c355f09ae4ce3b96740e7ba1c07a51ddb61f11dfecd1a22a994ea` |

No claim of `Closes #1123`: this is supplemental wrong-program material, not implementation or acceptance proof.
