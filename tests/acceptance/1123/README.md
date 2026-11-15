# #1123 — blind mechanism acceptance

Drafted against issue #1123, the designs and archive
`d13d25e077babd185912d09ef30845a44d931f86` only. No implementation was
available. Copy these files unchanged; disputes require the blind-redraft path.

## Run

With the repo's TypeScript/Vitest installed, Node 24.22+, Git, npm, Cargo and
rustc on PATH, and an installed Rust toolchain:

```sh
node --test --test-concurrency=1 tests/acceptance/1123/*.test.mjs
node scripts/affected.mjs tests/acceptance/1123/
```

Keep TMPDIR outside any Cargo-configured repository. The archive lacks `.git`,
so the second command was attempted but BLOCKED before selection. The first
was run as two targeted files after setup corrections: **6 tests, 4 expected
behavior failures, 2 passes**, no skips. Exact commands, actual failure excerpts
and invalid setup attempts are in `BASE-FAILURE.txt`. Cargo was found through a
local PATH prefix, not a path embedded in any test.

The archive had no dependencies. Only TypeScript 5.9.3 and Vitest 5.0.5 were
installed into disposable local tooling; no real-repository workspace
install/build or full preflight ran. Fixtures use offline, dependency-free Rust builds and real npm,
Git, Vitest, Node reporters, throttle, bays and scripts. No production component
is mocked. HOME, caches, throttle, bay and evidence writes stay in disposable
fixtures; their repositories alone receive fixture commits. No hooks or network
fetches are installed/run by tests. The copied scripts retain their notices.

## Requirement → check → proof

IDs are SHA-256(normalized criterion text), first eight hex digits, as the design
specifies. Fixture outputs `base-wrong`, `change-right`, `shell-wrong` and
`second-right` distinguish provenance; they are not product output requirements.

| Criterion | Check and assertions | Current proof / remaining work |
|---|---|---|
| `#1123.07de86fd`: tagged binary test fails on the base side; base/change never share binaries | `binaries.test.mjs` before case calls real `scripts/proof.mjs before`. Each bay's workspace build compiles its own Rust source. A shell decoy prints the change's answer. Require both consumers executed, words differ by source, two non-shell directories, and before's assertion-failure proof. | Base executes the decoy on both sides and reports “passed on the merge base”; outer source-provenance assertion rejects it. Distinct real bay builds ran. Post-fix PASS is unrun. |
| `#1123.cd6b3dd8`: shell value ignored by lanes/affected; explicit childEnv value survives | `environment.test.mjs` reaches exported `childEnv`. Reject inherited value; preserve explicit extra without mutation. Copied-script wrong program deletes after merging and runs **the identical explicit-value assertion**. | Base leaks the shell value. Explicit-value case passes base, and the planted delete-after-merge is rejected with `ERR_ASSERTION`, not a load/setup failure. This base does not itself contain the issue's described delete-after-merge code. |
| Same criterion, plus design §5's run-private build | `binaries.test.mjs` calls `runLanes` with the real unit definition and the `affected.mjs` CLI with only fixture test paths. Real parallel Vitest, alone Vitest and Node consumers require the run's source-built executable and one non-target, non-shell directory. Node replaces target/debug's executable and rereads the private copy. A second source revision/run must have fresh output and a different directory; the shell decoy remains unchanged. | Both runners on base reach all three consumers, which read `shell-wrong`. No scripts/lints are stubbed: affected's unrelated minimal-repo lint failures are **not** treated as its overall PASS. No WIDE/INCONCLUSIVE-prefixed lines were emitted. Isolation and second-run assertions beyond the first wrong-value assertion remain INCONCLUSIVE until unchanged post-fix execution. |
| `#1123.4ed9aa75`: up to 29 folders move only after each moved file rejects its wrong program in parallel | No universal folder count asserted. A fixture consumer exercises the existing parallel route but is **not migration proof** for any existing file. | **BLOCKED** for each proposed move until its cargo-spawning acceptance files' blind redrafts have merged (or need none), its sole alone reason is binary rewrite, and its wrong-program result in parallel is saved before moving. No folders moved here; no unrelated acceptance file redrafted. Load/timing files must remain timed and #236's shared log files alone. |
| `#1123.273f1f14`: alone-block before/after wall time is a reading | No synthetic timing threshold or automatic pass test. | **INCONCLUSIVE/unrun**: save real unit-lane before/after readings on one commit, with machine/load and measured block identified. Fixture durations and proof wall time above are not this reading. |

## Delivery limits

- The delete-after-merge proof is embedded, as this job permits; it is not a
  registered `twins.json` overlay. The positive per-side check passes this base,
  so automatic before/trace bookkeeping alone cannot credit that mutant run.
- Actual compiler validation **did run** for the minimal before-lane bays and shell
  decoys on this Mac. Full shipped-binary builds on Mac and Spark, an unchanged
  post-fix run on both, and each moved file's planted wrong-program run are still
  required. No Spark run or real-repository unit-lane timing was attempted.
- The before test exercises bays; temporary-copy fallback and all shipped binary
  names are not exhaustively covered. It does not count compiler invocations:
  exact once-per-run build-count proof is still **INCONCLUSIVE**.
- No acceptance assertion fixes an unspecified helper name, binary allowlist,
  cleanup path or migration count. The only script edit is the isolated
  `childEnv` wrong program required by the issue; original scripts are unchanged.
- The binary fixture layout was corrected only from base setup errors, before
  delivery, without changing its behavioral assertions. The saved setup errors
  are INVALID as acceptance proof. No tests were adjusted against implementation.
- New executable test/helper code is 226 lines. It is the smallest shared fixture
  for these three real entry paths; with documentation this leaves limited room
  under the approximate 400-handwritten-line PR target. If mechanism code pushes
  the total over, report this real-component proof depth rather than cutting
  assertions or folding separate migration jobs into this issue.
- Requirement/change/proof review leaves AC1 and AC4 open and post-fix validation
  unrun. This job supplies tests, not a claim that #1123 is closed.
