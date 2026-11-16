# #2359 — held dependency security fixes

Blind draft against `1c4d1f0e2aaad8c6a6573848823566d04ff73d17`, using only the issue, this snapshot, `AGENTS.md`, and the relevant technical design (How it installs; Threats; evidence, acceptance and Dogfooding rules). No fix, manifest, existing test, golden, decision or engine change is included.

## Run the new checks

```sh
node --test --test-reporter=spec tests/acceptance/2359/dependencies.test.mjs
```

Node built-ins only. The suite reads `Cargo.lock`, checks dependency edges, and runs **`cargo metadata --format-version 1 --locked --offline`**, without `--no-deps`. This is resolution, not a build; it can detect the RSA feature mismatch that lock-text checks cannot. It requires the installed toolchain and populated dependency cache. No network or rustup auto-install is allowed; missing Cargo/cache/toolchain, timeout, malformed lock, or missing path fails rather than skipping. Cargo must leave the lock byte-identical. No test writes a fixture, lock, or golden.

The graph assertions inspect **all versions reachable through each affected path**, not the maximum version of a crate anywhere in the lock:

- `deep-app` and `deep-panel-host` → `gpui-shell` → `quickjs-jit-stdlib` → `llrt_crypto` → `rsa >= 0.10.0` (RCs below the final release fail).
- `deep-typeset` → … → `citationberg` → `quick-xml >= 0.41.0`. The base has unrelated 0.41.0 and 0.42.0 copies; they do not satisfy this condition. Both Typst entry branches are traversed.
- `deep-typeset` → … → `mitex-spec` → `rkyv >= 0.8.17`. This includes the MiTeX parser and the direct `mitex-spec-gen` branch.

The metadata assertion repeats these checks on Cargo's resolved graph, excluding dev-only edges but including build edges. It uses the normal workspace features, not an invented feature set. The lock check also covers entries for other targets. If an upstream update removes one of these named paths entirely, a blind redraft is needed to judge that different remediation; absence is not automatically proof.

### Negative controls and their limit

For each held version, copy the actual lock graph in memory, set affected endpoints to the issue's fixed releases for an isolated positive control, then plant **only** that crate's old version back on its real edges. Leave an additional fixed-version decoy disconnected. The same assertion must reject the planted copy with that crate, old version and every associated advisory ID:

| Plant | Required diagnostics |
|---|---|
| `rsa 0.10.0-rc.18` | `rsa`, `RUSTSEC-2023-0071` |
| `quick-xml 0.38.4` | `quick-xml`, `RUSTSEC-2026-0194`, `RUSTSEC-2026-0195` |
| `rkyv 0.7.46` | `rkyv`, `RUSTSEC-2026-0235` |

These are **lock-graph negative controls**, not Cargo-valid rewritten lockfiles, compiled exploits, or runs of an advisory tool. Promoting version fields is never evidence that those dependencies resolve. The unmodified base supplies the real old-version lock/path failure; only successful Cargo metadata on the candidate supplies resolver proof. No RustSec database, advisory API, or #2298 implementation is invented here. When that lane exists, also run its own negative controls against real retained-old dependency snapshots and retain its crate/advisory diagnostics. Failure merely to resolve an inconsistent hand-edited lock is not advisory evidence.

## Requirement → test → remaining proof

Criterion IDs are SHA-256 prefixes of the issue's checkbox text with whitespace collapsed.

| Criterion | New check or reused proof | What remains mandatory |
|---|---|---|
| AC1 `#2359.74e0b9bf` | Three path/version tests; three isolated old-version negative controls; offline locked Cargo metadata and resolved-path assertion | Successful metadata with complete caches; review actual manifest/pin and lock diff, not only version fields. Preserve reasons/licenses. |
| AC2 `#2359.45470c45` | **Reuse**, do not duplicate: panel dependency's existing crypto tests; `cargo test --locked --offline -p deep-typeset --lib`; `tests/acceptance/220/{parts,morph,issues}.test.ts` | Before **and** after runs with unchanged tests/fixtures; compare actual fixture outputs as below; build provenance; golden approval if applicable. None run by this drafting job. |
| AC3 `#2359.4f887837` | Suppression-config portion: checks conventional Cargo audit/deny files for active IDs, with comments ignored; includes prohibition on an RSA ignore | Review the actual lane's effective configuration, including nonstandard files/CLI ignores. #2298 lane absent here: advisory result is **BLOCKED**, not proved by this small floor assertion or by absent config files. |
| AC4 `#2359.abff4209` | Reuse `node scripts/affected.mjs`; preserve actual exit code, summary, **every WIDE and INCONCLUSIVE line**, and BLOCKED/INVALID/known-failure details | Real affected run on implementation diff; selection-only is not execution. No test here substitutes a fabricated result/report. |

Passing this fast file alone does **not** satisfy AC2, the advisory portion of AC3, or AC4. A missing/unrun required check never passes. The config test's success on a snapshot with no suppression config means only “none found at these paths,” not “security lane passed.” It does not ban advisory IDs in historical docs, tests, or issue descriptions. An active ID in a suppression file is flagged for removal/review, not treated as exploit evidence.

## Reusing the existing behavioral checks (implementation/proof job)

These instructions are **not permission for the drafting job to build or fetch**. On an authorized, provisioned machine run on the base and on the candidate, using the same toolchain, fonts, fixtures and target. Keep separate target/output directories and record both revisions and lock hashes; no stale base WASM may serve as the candidate build. Keep evidence outside the repo with personal paths redacted.

### Panel crypto

The panel crypto implementation is not the repo's vendored JIT engine and is not Node's `node:crypto`. It is the locked upstream `quickjs-jit-stdlib`/`llrt_crypto` chain. Their sources/tests are not included in this snapshot. Locate the actual resolved packages from successful Cargo metadata, identify their existing crypto test targets/fixtures and **list their cases before running**. Use their documented existing test entry with the same patched `rquickjs` facade and dependency resolution the panel uses. Record the exact command, case counts/names and test-source digests; a filter running zero cases, another independent upstream lock, or only passing `deep-panel-host` tests is not this proof.

Run unchanged tests on both pins, compare deterministic vector outputs and expected crypto outcomes. For randomized tests compare the tests' specified validation outcomes, not random key/ciphertext bytes. If upstream updates change test sources, retain and run the base cases unchanged too; otherwise this criterion stays unproved. No exact upstream target/filter is guessed here, and no new crypto test duplicates theirs. Missing cached sources or a runnable entry is **BLOCKED**.

### Typeset/document/SVG

Reuse the native unit tests, including `five_parts_are_five_groups_of_outlines`, `issues_stop_the_job`, and the existing MiTeX parts tests. Rebuild the job's WASM from each side's lock before running its existing integration tests. The public build entry in this snapshot is `scripts/typeset-wasm.mjs` (writes the generated tool artifact; use only in the authorized proof environment):

```sh
cargo test --locked --offline -p deep-typeset --lib
CARGO_NET_OFFLINE=true RUSTUP_AUTO_INSTALL=0 node scripts/typeset-wasm.mjs
CARGO_NET_OFFLINE=true RUSTUP_AUTO_INSTALL=0 node node_modules/vitest/vitest.mjs run \
  --root tests/acceptance/220 parts.test.ts morph.test.ts issues.test.ts \
  --testTimeout=600000 --no-file-parallelism
```

These existing tests build their required hub/hook/show components. They must report their actual case results; missing Node packages, Rust, fonts, WASM, sandbox or the second-target container are BLOCKED/INCONCLUSIVE, not a pass. Do not run the whole neighbouring suite or its timing/taste tests merely to cover this dependency update.

The existing files emit proof under the process's temp directory, in `deep-220-proof/`. Preserve each side immediately, without overwriting the other. Compare these **existing** outputs:

- `ac1-five.svg`, `ac1-one.svg`, `ac2-a.svg`, `ac2-b.svg`: byte comparison and hashes, then report any difference; `ac1-five-linux.svg` too when the existing second-target case runs.
- `ac2-pieces-0.json`, `ac2-pieces-0.5.json`, `ac2-pieces-1.json`: exact parsed arrays, including IDs, centers and opacities.
- `ac3-unknown-command.json`, `ac3-parts-apart.json`: compare status/check/reason, absence of successful outputs, and the diagnostic command/range/part fields, retaining original responses.
- `ac3-alt.json`: compare the wrong/right outcomes and issue codes, IDs and severities. Keep raw responses; identify any nondeterministic receipt metadata separately, never erase a behavioral difference.

The reused tests compare repeat/partition outputs within one revision; that is **not** a substitute for this before/after comparison. A missing artifact is BLOCKED. Report any changed bytes/fields for review; do not regenerate expected results to make the comparison green. Existing golden/fixture changes require their protected approval and a recorded decision. Capture proof that the existing tests and fixtures stayed unchanged. These formula fixtures do not claim to exploit inline CSL XML or deserialize attacker-controlled MiTeX archives; no such exploit result is inferred from source reachability.

### Advisory and affected lanes

There is no #2298 lane or suppression file in this base. When available, run its **actual public entry**, recording its advisory database revision/freshness, effective ignores and result; it must not report these three crates for the four listed advisories. Do not invent a command or scanner here. Remove quick-xml/rkyv ignores as soon as no locked version matches, and never add an RSA ignore to dodge its feature mismatch. Absent or unrun lane remains BLOCKED, explicitly outside this task's implementation scope.

Run `node scripts/affected.mjs` on the candidate's real diff when authorized. This base's selector marks root `Cargo.lock`/`Cargo.toml` changes as feeding every suite and can leave an INCONCLUSIVE preflight obligation. Disclose that rather than silently running whole suites or claiming PASS. `--list` is only a selection diagnostic. Keep #2324's engine update separate; review dependency reasons, license notices/compatible licensing, and absence of a runtime fallback in the implementation diff.

## Drafting run

See `BASE-FAILURE.txt`: one fast test run, expected old-version failures, Cargo unavailable; affected selection blocked before emitting WIDE/INCONCLUSIVE lines. No dependencies fetched, builds run, or existing tests/goldens changed. Overall acceptance remains **unproved**, not PASS.
