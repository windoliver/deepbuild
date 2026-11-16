# #1123 — one blind executable-origin redraft

**Status: BLOCKED; no behavioral PASS and no demonstrated wrong-program rejection.**

Inputs read: the supplied issue JSON, and the `d13d25e077babd185912d09ef30845a44d931f86`
base archive (including AGENTS.md and both design documents). No working checkout,
parent history, earlier capture check/output, or review/dispute was read. Existing
checks and drafts remain untouched. This is the one redraft, not an implementation.

## Files and intended placement

- `origin.test.mjs`: three outer regression cases, through `lanes.mjs`'s existing
  public `runLanes` entry, `affected.mjs`'s CLI, and `proof.mjs before`.
- `consumer.mjs`: a real Node test copied into the scratch repository. It executes
  `deep-hook --version` from the runner-provided `DEEP_BIN_DIR` and saves an observation
  before assertions. It has no binary-path fallback.
- `cargo-wrapper.cjs`: forwards to real Cargo without changing its arguments, results,
  stdout or exit status. It delays a successful build/test return while two other real
  Cargo invocations publish distinct versions into the fixture's shared target.

If approved for integration, keep these three files together under
`tests/acceptance/1123/capture-redraft/`. Run the outer file only; the consumer is input
for the nested runners, not a standalone check. No acceptance-criterion tags are
claimed for the outer regression: this does not prove every condition of any whole
criterion. The nested `#9001.12345678` tag belongs only to the miniature before fixture.

## Requirement → observation → assertion

| Required behavior | Mechanism and proof |
| --- | --- |
| lanes' consumer gets its own build despite shared-target rewrites | A small real lane builds the owned deep-hook/deep-contracts workspace and runs the consumer. `assertOrigin` requires successful own Cargo, both competing versions, the final competing executable still running from the shared target, and the consumer executing version `1.0.1123`. |
| affected's consumer gets its own build despite shared-target rewrites | Run the actual affected CLI selecting the new consumer file. Require one consumer observation, the same origin assertions, and its non-skipped pass in affected's Node report. |
| before's base and change never share a binary | Run the real before CLI with a scratch merge base at version `0.0.1123` and an uncommitted change at `1.0.1123`. Require both consumer observations to match their own source side despite each shared binary being `9.9.1123`. Both consumers assert `1.0.1123`; base must fail only after origin assertions, on `BASE_PROGRAM_IS_WRONG`, and before must report failure on the merge base at its assertion. |
| shell `DEEP_BIN_DIR` is not the source | Seed it with a real Cargo-built executable returning `9.9.1123`. All consumer-origin assertions reject it. This is not a dedicated childEnv merge-order check. |

Only package versions in test-owned copies of `deep-hook/Cargo.toml` change; the owned
Rust sources are copied unchanged and their Apache-2.0 license is retained. The fixture
workspace has just deep-hook and deep-contracts (no registry dependencies), not the
whole application. No fake Cargo, fake npm, fake reporter or replacement owned module
answers a call. The scripts under test are copied unchanged.

The interleaving is independent of private capture layout: no private path is
constructed, scanned, checked for existence early, or compared to a guessed spelling.
A private Cargo target, Cargo's hashed artifact, early capture of an artifact message,
or another safe capture strategy may all satisfy the same consumer assertion. The
shared path is only the issue's stated adversary. Its two real rewrites complete before
the wrapped successful tool invocation returns; a late copy of the shared executable
therefore gets the wrong version. The wrapper waits on its own children; it neither
stops nor signals any process by PID, name or port. It refuses to race outside the
current test-owned sandbox. There is no sleep-based race window.

## Proof commands (Mac and Spark)

From the root of the checkout to be checked, with its existing TypeScript dependency
and a working Rust toolchain already available on PATH:

```sh
node --check /tmp/deep-1123-capture-redraft/origin.test.mjs
node --check /tmp/deep-1123-capture-redraft/consumer.mjs
node --check /tmp/deep-1123-capture-redraft/cargo-wrapper.cjs
node --test /tmp/deep-1123-capture-redraft/origin.test.mjs
```

The test resolves Cargo from PATH and preserves CARGO_HOME/RUSTUP_HOME only as tool
locations. It hardcodes no machine toolchain path. All build targets, HOME, grant
records, before checkouts and fixture Git objects are temporary. The before fixture
needs a scratch Git base, so the *test code* creates a commit there with hooks disabled;
no commit was made by this drafting job, and none is made in the checkout under test.
It does not install npm dependencies. All Cargo fixture calls are offline. No full
application build, preflight, hook installation or budget window is run.

After integration, use the mandated selector too:

```sh
node scripts/affected.mjs tests/acceptance/1123/capture-redraft/origin.test.mjs
```

Run the **unchanged** file on the base first and preserve failure output. A prerequisite
failure, missing race record, missing consumer, or skipped test is not the required red
proof. For the late-capture regression, a valid red result must have completed the real
own-build and rival-build interleaving and show foreign executable origin at consumption
(`RUN_PRIVATE_ORIGIN`). Then run unchanged on the candidate on both machines. No such
red/green pair was possible in this job.

## Checks actually run

- `node --check` on all three files: successful (syntax only).
- `node --test .../origin.test.mjs`: exit 1, all three cases **BLOCKED** before setup:
  `cargo` and `rustc` unavailable on PATH, and archive lacks `node_modules/typescript`.
  Saved in `base-run.txt`. Its test-runner failure count is not a reproduced regression.
- `node scripts/affected.mjs /tmp/deep-1123-capture-redraft/origin.test.mjs`: exit 1,
  import blocked by missing TypeScript. Saved in `affected-run.txt`. It never selected
  tests; no WIDE or INCONCLUSIVE lines were emitted. Their absence proves nothing.

Static review corrected the nested tag to a literal so before's source discovery can
see it, and split the outer report comparison's string so it does not tag the outer
regression as fixture issue #9001. Both edited files passed syntax checks afterward.
No behavioral rerun was attempted while prerequisites remained missing.

## Limits / open proof

- The affected CLI also runs its real repository-specific lints against the miniature
  fixture. Their output remains visible; the origin regression asserts its consumer's
  report, not a green whole-fixture lint exit. This is not an affected-lint acceptance
  test and must not be reported as a full affected-lane PASS.
- Test-started before runs use temporary copies as the design specifies. This does not
  separately validate bay reuse, sealing or physical bay placement.
- No folders are moved; no moved-file wrong-program proof or alone-block timing reading
  is supplied. Direct childEnv merge-order proof and unit-lane timing remain separate.
- Real-Cargo race execution, base rejection at the required assertion, candidate success,
  and Spark execution are all **UNRUN / BLOCKED**. No dependencies were installed to
  bypass this restriction. The intended regression remains unproven until those run.
