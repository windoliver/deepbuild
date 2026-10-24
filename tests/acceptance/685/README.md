# Acceptance tests for #685: proof checks

Written first, from issue #685 (its text as rewritten on October 23 at 17:02 UTC: Lean through Lean 4.35's
`lake comparator` with exports built by the toolchain's `leanexport` and comparator run with
`--inadvisably-no-sandbox` on macOS, and Kani as the Rust runner), the design sections it links and those around
them (Checks for work beyond code, Proof, which still says Verus, where the issue is newer and wins; the Extension
API block with `deep.registerCheck`; the Hub slots table's `check.kind@1` row; How runs become one of five
verdicts, with Fail before, pass after, Failing on an assertion, Check health, Proof depth, Pinned to a commit and
Protection; the Check and Verdict primitives; How we know version 0 works, with Conformance tests, Kit hygiene,
Wrong programs and Dogfooding, all in `docs/technical-design.md`), the house pattern of `tests/acceptance/314/`
and `tests/acceptance/28/`, and base commit `e9c601b` (origin/main), by a job that never saw an implementation.
The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

## Environment

The toolchains are real, never mocked, and pinned. The tests find them through this environment and fail, naming
the toolchain, when it is missing; they never skip.

```sh
T=$HOME/.cache/deepbuild/toolchains
export ELAN_HOME=$T/elan                    # elan with leanprover/lean4:v4.35.0 (lake comparator, leanexport in its bin/)
export KANI_HOME=$T/kani-home               # Kani 0.68.0's bundle (CBMC 6.11.0, rust nightly-2026-08-21)
export PATH=$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$T/elan/bin:$T/kani/bin:$T/cargo-mutants/bin:$PATH
#   node 24.22.0 (the repo's .node-version), elan's lake/lean, cargo-kani and kani, cargo-mutants 27.1.0
```

Kani was installed with `cargo install --locked kani-verifier --root $T/kani` and `cargo-kani setup` with that
`KANI_HOME`; `cargo kani --version` prints `Kani Rust Verifier 0.68.0 (cargo plugin)` and `CBMC 6.11.0`. AC3
states the macOS path (no bubblewrap), so it runs on a Mac; the base run below was on darwin-arm64.

## Running

```sh
npm ci && npm run build --workspaces       # once, if node_modules is missing
npx vitest run --root tests/acceptance/685
node node_modules/typescript/bin/tsc -p tests/acceptance/685/tsconfig.json
```

With `--root` here, Vitest writes its cache to `tests/acceptance/685/node_modules/.vite/`; delete that folder
before committing. Every run happens in a temporary checkout under the OS temp folder, removed after each file, so
no `.lake` or `target` is left under `fixtures/`.

These are slow-lane tests. Each Lean check builds the package, exports two modules of about 330 MB each and runs
comparator: by hand on this Mac, comparator took 67 s to accept and 23 s to reject, and the two exports 16 s each.
A Kani run takes 4 to 15 s. Runs that several tests read are started once per file and shared (`once` in
`helpers.ts`); the ten files run in parallel, so the wall time is the longest file's, the Lean files' (about 10 to
15 minutes, more for the plug-in's kit, whose fixtures the plug-in chooses). Test time limits are 30 minutes for a
test that runs Lean and 15 for Kani. The repo's unit lane takes `tests/**/*.test.ts`, so these files are in it as
it stands; they need both toolchains and these minutes, so the implementing change places them (as `alone` files,
or by hand as #48's live tests are), which `scripts/lanes.mjs` decides and this job doesn't edit.

The tests import `packages/conformance/src/index.ts`, `packages/verdicts/src/index.ts`,
`packages/contracts/src/index.ts` and the new `packages/proof/src/index.ts` with their `.ts` extensions;
`tsconfig.json` here extends the root one with `noEmit` and `allowImportingTsExtensions`. They type-check with no
errors against a declaration-only copy of the surface below, kept outside the repo and placed at
`packages/proof/src/index.ts` only for that check, then removed (BASE-FAILURE.txt, header).

## The surface under test

The issue names a spec, run outcomes, a receipt line, a proposal, a base run, a mutation check, a drafting gate and
a kit, but no code API, so these tests define the smallest one they need: one new package entry,
`packages/proof/src/index.ts` (`@deepbuild/proof`, the plug-in), imported lazily so each test fails on its own at
the base. The core is reached only through public entries: `@deepbuild/conformance`'s `runKit`, `kitProblems` and
types; `@deepbuild/verdicts`' `verdict`, `selectReruns` and types; `@deepbuild/contracts`' `ERROR_CODES`. The
core's own surfaces carry what they already can: run outcomes (`RunOutcome`), the engine's depth rule, its
can't-fail row (`ClaimCheck.cant_fail`), `BaseResult` for a fix's base run, a missing run's cause, and the
verdict key's `tools`.

```ts
// @deepbuild/proof — packages/proof/src/index.ts
import type { CheckContext, CheckResult, CheckRunnerFill, CheckSpec, SlotKit } from '@deepbuild/conformance';
import type { BaseResult, Depth } from '@deepbuild/verdicts';

export type ProofRunner = 'lean4' | 'kani';
/** An approved statement, the bytes the locked definition holds: a Lean theorem's signature, from `theorem <name>`
 *  up to the ` :=` before its proof; a Lean axiom's whole declaration; a Kani harness whole, from its first
 *  attribute (`#[kani::proof]`) through its closing brace. `file` is where it lives in the checkout. */
export interface Statement { theorem: string; file: string; text: string }
/** check@1's spec for kind `proof`, with the issue's fields. `theorems` names Lean theorems, or Kani harnesses by
 *  their full names (`proofs::total_append`); `assumptions` names the Lean axioms the check permits beside propext,
 *  Quot.sound and Classical.choice, each with its statement among `statements`; `targets` are `file#symbol`;
 *  `toolchain` is `leanprover/lean4:v4.35.0` (a lean-toolchain line) or `kani 0.68.0`; `deadline` is in ms. */
export interface ProofSpec extends CheckSpec {
  kind: 'proof';
  runner: ProofRunner;
  toolchain: string;
  theorems: string[];
  assumptions: string[];
  targets: string[];
  deadline: number;
  statements: Statement[];
}
/** Protection's proposal for a statement a write changed: the theorem, the file, the approved and written bytes. */
export interface Proposal { theorem: string; file: string; approved: string; written: string }
/** A run's result: a closed run outcome, never a verdict (CheckResult), and beside it why, one line per theorem,
 *  harness or cause, each naming what it is about; the receipt line; Protection's proposals; the key's tool
 *  entries (the toolchain version the checker reported and the runner's flags); for a failed Kani run, the
 *  counterexample as the Rust test Kani's concrete playback prints, or null. `testsRun` counts the theorems or
 *  harnesses the checker judged; `read` the checkout files the run read; `evidence` names the checker's output and
 *  each export by sha256. */
export interface ProofResult extends CheckResult {
  reasons: string[];
  receipt: string;
  proposals: Proposal[];
  tools: Record<string, string>;
  smallest: string | null;
}
/** The check.kind@1 fill `deep.registerCheck('proof', fill.run)` registers. */
export interface ProofFill extends CheckRunnerFill {
  kind: 'proof';
  run(spec: ProofSpec, ctx: CheckContext): ProofResult | Promise<ProofResult>;
}
export function proofFill(): ProofFill;
/** A fix's base run, on the base checkout the core builds (the claim's proof files, the merge base's code): the
 *  core's BaseResult (on_assertion only when the checker refused a target's obligation there, failed_tests naming
 *  the harness or theorem), why in words, and the counterexample when there is one. */
export interface ProofBase { base: BaseResult; reason: string; smallest: string | null }
export function runBase(spec: ProofSpec, ctx: CheckContext): Promise<ProofBase>;
/** Each theorem re-checked on the mutants of its targets' lines (cargo-mutants for a Kani target): the mutants that
 *  kill it and those it still checks on, each listed with its place (`file:line`); and the check's can't-fail
 *  reason, naming each theorem no mutant kills, or null. The core takes it as the check's `cant_fail`. */
export interface MutantReport { theorems: { theorem: string; killed: string[]; survived: string[] }[]; cantFail: string | null }
export function mutants(spec: ProofSpec, ctx: CheckContext): Promise<MutantReport>;
/** The depth a proof check counts at: unit, whatever its spec says. */
export function proofDepth(spec: ProofSpec): Depth;
/** The runners the drafting job may propose a proof check with for a repo: lean4 for a lean-toolchain file, kani
 *  for Kani harnesses or [package.metadata.kani] in a crate; none otherwise. It installs nothing. */
export function draftable(checkout: string): ProofRunner[];
/** The plug-in's check.kind@1 kit for its kind, runnable by the conformance package's runKit and kitProblems. */
export function proofKit(): SlotKit<ProofFill>;
```

**An expected small core export.** A kit that `runKit` and `kitProblems` run is a `SlotKitImpl` (its `clean`,
`generate` and `judge`) whose judge throws the conformance package's `Finding` for a FAIL; the runner reads a
finding by `instanceof Finding`, so its message and codes survive. `Finding`, `fail`, `SlotKitImpl`, `SlotCase` and
`Judge` live in `packages/conformance/src/slot-types.ts` and are not exported from its public entry at this base,
so the implementing change exports them there. These tests don't import them.

### What the tests hold the pieces to

- **Runs through the core.** Each result becomes the run record the hub keeps (`runRecord` in `helpers.ts` copies
  its fields; #30's recording isn't at this base), on a claim whose one requirement one proof check covers, and the
  core's `verdict` gives the word the criterion names. A missing run's cause is its `reasons`, so the core's
  BLOCKED names it. The plug-in picks the run outcome; the tests hold the verdict it makes (an INVALID is a run
  that ran nothing, an INCONCLUSIVE one that can't decide, such as an uncounted run).
- **Naming.** "INVALID, naming X and Y" is the core's INVALID plus one line of the run's `reasons` holding both
  names, since the core's ran-nothing row names no theorem. A file and line reads `src/lib.rs:14` or
  `src/lib.rs line 14`.
- **PASS.** A passed run counts each theorem it judged (`testsRun` 2 for two Lean theorems, 1 for one harness), has
  no failures, and the core passes it.
- **Receipts.** Lean's names comparator and `4.35.0`, and on macOS says `unsandboxed` and `hermetic`; Kani's PASS
  says `bounded`, the unwind bound (`unwind` then `5`), the assumption `split <= 4`, and `0.68.0`.
- **Fix.** `runBase` on the fix's base checkout: `failed`, `on_assertion` true, `failed_tests` holding
  `proofs::total_append`, and `smallest` a `#[test]` calling `kani::concrete_playback_run(concrete_vals,
  total_append)` that, appended to `src/proofs.rs` and run with `cargo kani playback -Z concrete-playback --
  <name>`, panics at `src/proofs.rs:14` on the base and passes on the fix; with it the core passes the fix's
  requirement (`on_base: fails`). On the planted fix's base: `failed`, `on_assertion` false, `reason` containing
  `failed on the base before its obligation`, and the core's INVALID.
- **Mutants.** `mutantsOf(report, theorem)`: the trivial theorem kills none and survives at least one, and
  `cantFail` names it; the real theorem is killed by at least one, each killed mutant naming `src/lib.rs:<n>` or
  `Fixture/Total.lean:<n>`, and `cantFail` doesn't name it. The core, given `cantFail`, is INVALID, naming it.
- **Keys.** A Lean result's `tools` hold a value with `4.35.0` and one with `--inadvisably-no-sandbox`, a Kani
  result's one with `0.68.0`; keyed with them, `selectReruns` keeps every run, and a version in the claim's checks'
  `tools` that differs reruns exactly the checks of that toolchain.
- **Kit.** `proofKit()` has slot `check.kind@1`, a planted fill named `unfound-theorem` (breaking a rule it lists,
  with a non-shape code, its fill of kind `proof`), and a fixture whose id contains `unfound-theorem`, whose input is
  `{spec, checkout, deadline}` and whose spec names a theorem no file of its checkout contains. The planted runner
  answers `passed` there; `proofFill()` doesn't. `runKit` on `proofFill()` reads PASS on every case, fixed and
  seeded; on the planted runner (fixed part) a FAIL carries its message and codes; `kitProblems` is empty. The
  preflight's kit check drives each fill synchronously, so the runner answers synchronously, as the core's command
  runner does.

## Readings where the issue leaves a choice

- **Eleven criteria**, AC1 to AC11 in the issue's order.
- **Registration.** The extension host (#44) isn't at this base, so nothing calls `deep.registerCheck`; the tests
  hold the fill it would register and the kit the slot runs, not a `register` export.
- **The theorem is the spec.** The approved bytes travel in the spec's `statements`; the checkout's are the agent's.
  A Lean statement is the signature, a Kani statement the whole harness, and the approved harness files are the
  files the Kani statements name, so `kani::assume`, `#[kani::stub]` and the rest are refused only outside those.
- **Assumptions.** comparator compares each permitted axiom between challenge and solution (a permitted `cheat`
  absent from the challenge stops it with "Const not found in challenge"), so a declared assumption carries its
  statement among `statements`, and the runner puts it in the challenge. The cheat variant with `cheat` declared
  passes; the same commit with nothing declared is INVALID naming `cheat`.
- **`native_decide`'s axiom** is the name comparator reports on Lean 4.35.0,
  `total_example._native.native_decide.ax_1_1`, so the native variant closes `total_example` (a closed statement
  `native_decide` can decide), not `total_append`.
- **Harness names.** `cargo kani --harness total_append` also runs `total_append_never` and `total_append_short`
  (it matches by substring), and `--exact` needs the full name (`proofs::total_append`), so specs name harnesses in
  full.
- **The harness's own checks.** Every Kani run here reports some standard-library checks UNREACHABLE (3 on the
  PASS); only the harness's own assertions and covers decide "ran nothing". For an assumption no input satisfies,
  Kani 0.68.0 reports the cover UNREACHABLE (`0 of 1 cover properties satisfied (1 unreachable)`) and still
  `VERIFICATION:- SUCCESSFUL`; "naming its unsatisfied cover" accepts its description (`a split the assumption
  admits`) or its place (`src/proofs.rs:35`).
- **The loop and the bound** (AC5): the loop by its place, `src/lib.rs:14`, or Kani's name for it,
  `total.unwind.0`, and the bound `3`.
- **The forged export** (AC3) is leanexport's export of the proved fixture's `Fixture.Proofs`, built at test time
  (345 MB, too big to keep) and written as `Solution.ndjson` at the root of the `sorry` variant. "Never read" is held
  three ways: the verdict is the `sorry` variant's own (INVALID naming `sorryAx`), the read set leaves the file out,
  and no evidence hash is the forged file's. "Builds both exports" is held as two distinct export hashes in the
  evidence; the temporary checkout is the one the test hands the runner, as the core would, so the tests don't
  look for exports in it.
- **The base checkout** (AC6) is built by the test as the core builds it: the fixture (the claim's commit) with the
  merge base's `src/lib.rs` laid over it. Which counterexample is the smallest failing case is the one for the failed
  assertion (Kani prints one for the cover too); the replay shows it is.
- **Mutants** (AC7). On the Kani fixture, cargo-mutants 27.1.0 lists four mutants of `src/lib.rs`: `widen` with 0
  and 1, `total` with 0 and 1. `total` sums with `wrapping_add` so that no mutant panics: with `+=`, its `-=` mutant
  underflows, and Kani's overflow check fails even `total(x) == total(x)` on it, a real failure, so the trivial
  harness would not be trivial. Lean has no mutation tool; the plug-in mutates `Fixture/Total.lean`'s lines itself,
  and the tests hold only that one mutant kills `total_append` (by hand, `| [] => 1` fails its proof at
  `Fixture/Proofs.lean:5:8`) and none kills `total_self`. No criterion names a planted twin, so the surface has no
  twin field.
- **Depth** (AC8) is `proofDepth(spec)`, unit whatever the spec's `depth` says, so the core's depth rule makes the
  journey requirement INVALID, naming it and `journey`.
- **The missing toolchain** (AC9) is a check pinned to a version this machine lacks: `leanprover/lean4:v4.34.0`
  (with the checkout's `lean-toolchain` saying so too) and `kani 0.67.0`. "Never installs" is held as the elan
  toolchains folder and `KANI_HOME` unchanged by the run. A runner that let elan resolve `v4.34.0` would download it;
  the test then fails, and `elan toolchain uninstall leanprover/lean4:v4.34.0` removes it.
- **Drafting** (AC9) is `draftable(checkout)`; the bare repo is a plain Rust crate with tests and no Kani, so a
  rule that proposes Kani for any crate is the wrong program.
- **"Both versions"** (AC10) reads as the Lean and the Kani toolchain's versions, both in one verdict key; "changing
  the toolchain version in the environment" is the claim's checks keyed to another version than their runs (the
  core's `tools`, as the hub would fill them from the environment), which reruns every proof check of that
  toolchain; a change to the runner's flags alone reruns them too.
- **The kit** (AC11) is the plug-in's own `check.kind@1` kit over proof fixtures: the core's shipped
  `check.kind@1` kit runs the `command` kind's suites, which no proof runner serves.
- **Wrong programs.** Each criterion that names one feeds a stand-in to the same assertion and expects it to fail,
  in the same test as the plug-in, so the test fails at the base too: a runner that reads `lake build`'s exit status
  (AC1), one that reads only `VERIFICATION:- SUCCESSFUL` (AC4), a base reading that counts any base failure (AC6), a
  mutation check that runs no mutant (AC7), a plug-in that counts a proof at its spec's depth (AC8), a drafting rule
  that proposes Kani for any crate (AC9), a key with no toolchain version (AC10), and the kit's planted runner
  (AC11). AC2, AC3 and AC5 name none beyond the base.

## Fixtures, and what the real checkers printed

Run by hand on this Mac (darwin-arm64) with the environment above, each in a temporary copy.

- **`fixtures/lean/`**, a Lake package on `leanprover/lean4:v4.35.0`: `lakefile.toml` (lib `Fixture`),
  `lake-manifest.json` (written by `lake build`, no packages; comparator requires one), `Fixture/Total.lean`
  (`def total : List Nat → Nat`), `Fixture/Proofs.lean` with `total_append (a b) : total (a ++ b) = total a + total
  b` (by induction), `total_example : total [1, 2, 3] = 6` (by `decide`) and `total_self (a) : total a = total a`
  (`rfl`). `lake build`: `Build completed successfully (5 jobs)`. A challenge module of the two approved statements
  with `sorry` bodies, both modules exported with `lake env leanexport` (345,698,691 and 345,709,953 bytes, 16 s
  each) and `lake comparator --challenge-from-export … --solution-from-export … --inadvisably-no-sandbox` with
  `permitted_axioms` propext, Quot.sound, Classical.choice: `WARNING: Sandbox disabled, this run is not
  trustworthy.`, `Lean default kernel accepts the solution`, `Your solution is okay!`, exit 0, 67 s.
- **`fixtures/lean-variants/`**, each laid over the package (same challenge, same comparator call; `lake build`
  exits 0 on every one, the `sorry` one with `warning: Fixture/Proofs.lean:3:8: declaration uses 'sorry'`):
  `sorry/`: `error: Illegal axiom detected: 'sorryAx'`, exit 1, 23 s. `cheat/` (`axiom cheat` closes
  `total_append`): `error: Illegal axiom detected: 'cheat'`, exit 1; with `cheat` in the challenge and in
  `permitted_axioms`: `Your solution is okay!`, exit 0, 68 s. `native/` (`total_example` by `native_decide`):
  `error: Illegal axiom detected: 'total_example._native.native_decide.ax_1_1'`, exit 1. `restated/`
  (`total_append … : total (a ++ b) = total (a ++ b) := rfl`): `error: Challenge and solution theorem statement do
  not match: 'total_append'`, exit 1. `old-toolchain/` (`lean-toolchain` at `v4.34.0`): not built, since elan would
  download it; `elan toolchain list` prints only `leanprover/lean4:v4.35.0`.
- **`fixtures/kani/`**, crate `totals` (its own `[workspace]`, outside the repo's): `src/lib.rs` with `widen` and
  `total` (a u64 sum by `wrapping_add` over a `for` loop at line 14), `src/proofs.rs` (`#[cfg(kani)]`) with four
  drafted harnesses. `cargo kani --harness proofs::<name> --exact`:
  `total_append` (`#[kani::unwind(5)]`, four `kani::any()` readings and a split, `kani::assume(split <= 4)`,
  `kani::cover!(split == 2, …)`, `assert_eq!(total(&values), total(left) + total(right))`): cover SATISFIED, both
  harness assertions SUCCESS, `total.unwind.0` SUCCESS, `0 of 83 failed (3 unreachable)`, `1 of 1 cover properties
  satisfied`, `VERIFICATION:- SUCCESSFUL`, exit 0, about 4 s. `total_self` (`total(&values[..len]) ==
  total(&values[..len])`): SUCCESSFUL. `total_append_never` (`kani::assume(split <= 4 && split > 4)`): cover and both
  assertions UNREACHABLE, `0 of 1 cover properties satisfied (1 unreachable)`, `VERIFICATION:- SUCCESSFUL`, exit 0.
  `total_append_short` (`#[kani::unwind(3)]`, eight readings): `total.unwind.0` FAILURE, `unwinding assertion loop
  0`, `src/lib.rs:14:5 in function total`, the assertions UNDETERMINED, `VERIFICATION:- FAILED`, exit 1.
- **`fixtures/kani-variants/`**, each laid over the crate: `assume/` (`#[cfg(kani)] kani::assume(false);` at
  `src/lib.rs:14` in `total`): cover SATISFIED, both assertions UNREACHABLE, `VERIFICATION:- SUCCESSFUL`, exit 0.
  `stub/` (an agent's harness in `src/lib.rs` with `#[kani::stub(widen, widen_to_zero)]` at line 27): `total_append`
  SUCCESSFUL, exit 0. `base/` (the merge base: `total` sums in a u32 with `wrapping_add`): assertion 2 FAILURE,
  `Failed Checks: assertion failed: total(&values) == total(left) + total(right)`, `File: "src/proofs.rs", line 14`,
  `VERIFICATION:- FAILED`; with `-Z concrete-playback --concrete-playback=print` Kani prints a test for the cover and
  one for the assertion; the assertion's, appended to `src/proofs.rs` and run with `cargo kani playback -Z
  concrete-playback -- kani_concrete_playback_total_append_18374110093525357901`, panics `at src/proofs.rs:14:5:
  assertion 'left == right' failed` (left 1815370614, right 6110337910) on the base and passes on the fixture.
  `planted-fix/` (adds `total_wide` and the harness `total_wide_append` calling it): SUCCESSFUL on its own commit;
  with `base/`'s `src/lib.rs` over it, `error[E0425]: cannot find function 'total_wide' in the crate root --> 
  src/proofs.rs:26:23`, exit 1. cargo-mutants `--list --file src/lib.rs`: `src/lib.rs:8:5: replace widen -> u64 with
  0`, `… with 1`, `src/lib.rs:13:5: replace total -> u64 with 0`, `… with 1`; applied one at a time, `total_append`
  fails on `total -> u64 with 1` and checks on the other three, `total_self` checks on all four.
- **`fixtures/kani-metadata/`**, crate `readings` with `[package.metadata.kani.flags]` and no harness: `cargo test`
  0 tests, ok; `cargo kani`: `No proof harnesses (functions with #[kani::proof]) were found to verify.`
- **`fixtures/bare/`**, crate `plain` with a test and neither toolchain: `cargo test` `1 passed`; `cargo kani`: `No
  proof harnesses … were found to verify.`

## Criteria to tests

| Criterion | File | Tests |
|---|---|---|
| AC1 | `lean-escapes.test.ts` | PASS through comparator; `sorry` INVALID naming `total_append` and `sorryAx`; wrong program: `lake build`'s exit; `axiom cheat` INVALID naming `cheat`; `native_decide` INVALID naming its axiom; a declared assumption passes |
| AC2 | `lean-statement.test.ts` | restated INVALID naming `total_append`; a proposal naming `Fixture/Proofs.lean`; never PASS |
| AC3 | `lean-statement.test.ts` | receipt unsandboxed and hermetic on macOS; forged `Solution.ndjson` never read, INVALID on the commit's own build; two export hashes, neither the forged file's |
| AC4 | `kani.test.ts` | Kani PASS; receipt bounded with the bounds; unsatisfiable assumption INVALID naming harness and cover; wrong program: the success line; `kani::assume(false)` and `#[kani::stub]` INVALID naming file and line |
| AC5 | `kani.test.ts` | unwind bound too small INCONCLUSIVE naming the loop and the bound; never PASS |
| AC6 | `fix.test.ts` | base fails at the harness assertion; its counterexample; the replay fails on the base and passes on the fix; that proves the fix; the planted fix INVALID "failed on the base before its obligation"; wrong program: any base failure |
| AC7 | `mutants-kani.test.ts`, `mutants-lean.test.ts` | both theorems check on the fixture; `f x = f x` INVALID naming it; the real theorem's killing mutant listed; wrong program: no mutants |
| AC8 | `depth-toolchain.test.ts` | unit whatever the spec says; journey requirement INVALID naming it and `journey`; wrong program: the spec's depth |
| AC9 | `depth-toolchain.test.ts` | Lean 4.34.0 and Kani 0.67.0 BLOCKED naming toolchain and version, nothing installed; no proof check drafted for the bare repo; wrong program: any crate |
| AC10 | `keys.test.ts` | tools hold version and flags; unchanged environment keeps runs, key shows both versions; a Lean change reruns every Lean proof check; a Kani or flags change reruns; wrong program: no version in the key |
| AC11 | `kit.test.ts`, `kit-preflight.test.ts` | the kit and its planted `unfound-theorem` runner; the plug-in passes the kit; the planted runner reports passed, the plug-in doesn't; the kit fails the planted runner; `kitProblems` is empty |

50 tests in 10 files.
