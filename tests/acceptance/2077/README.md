# #2077 blind acceptance draft

Inputs: issue #2077 as supplied, `docs/technical-design.md` (learned layer,
runner/reserve, configuration evals, Dogfooding), and this isolated base checkout,
nominated as `1c4d1f0e2aaad8c6a6573848823566d04ff73d17`. No other checkout,
implementation, GitHub, or session history was consulted. This filesystem has no
Git HEAD, so the nominated commit could not be independently verified.

## Requirement → check → proof

`removal.test.ts` has three installed CLI/hub scenarios, not direct calls to
`removeRule` or fabricated eval reports. `DEEP_HUB_TEST_EVAL` is explicitly absent.

- **AC1 / #2077.c76c4641:** one removal invocation creates exactly one runner job;
  the CLI returns the job/eval handle without waiting for completion. At the plan
  reserve no side runs. After a new window has room, the test boundary reads the
  committed record **at every agent entry** and requires the same frozen tasks,
  variants, models, repeats, measures and comparison rule. Both side checkouts
  receive the specified bytes; all planned repeats actually reach the agents and
  judge. The lesson remains listed while waiting and while running.
- **AC2 / #2077.d2415960:** all task grades improve from .2 to .8 (adopt), or
  regress from .8 to .2. The real comparison and recorded outcome decide. Adopt
  removes only the rule line, and a later decision names the eval. Regression
  preserves the entire CRLF/trailing-space file and the job's human-readable
  result/output names the broken tasks. No second `memory remove` finishes a job.
- **AC3 / #2077.c43a0799:** the agent outputs look like the adopt control, but
  the judge supplies **no grades**. The real eval must record INCONCLUSIVE,
  preserve bytes, explain the missing reading and keep the lesson listed.

**Proof status: BLOCKED**, not PASS and not a proven fails-before result. All
three scenarios collect, but no criterion assertion has run in this checkout.

## Fixtures and boundaries

A temporary HOME and git repo contain `legacy/AGENTS.md`. Twenty-four distinct
archive-shaped past Claude tasks are seeded through the record/evidence public
entries while the hub is stopped. None touched `legacy/**`, so the real rules
list offers its removal. This avoids depending on a guard install or deep-hook
build merely to form the lesson. No config or source file in this checkout is
modified; config/sign-in metadata is written only in the disposable HOME.

`boundary.mjs` is loaded only into the child hub with Node's module hook. It
supplies the existing public `EvalOptions.launcher` seam to the real `runEval`,
forwarding every other option unchanged. `launcher.mjs` scripts only external
agent outputs, judge grades and their plan-use reading. It does not supply a
plan, task selection, report, comparison, recorded event, removal or decision.
The runner, reserve, eval, checkouts and record are not mocked. The fake CLI
executables answer version probes and refuse any unexpected agent call, so no
real agent or paid call can escape the boundary. The OS confirmation uses #303's
existing seam. Process/CLI/socket/world helpers are reused from #303.

The boundary deliberately reuses `@deepbuild/config-eval`'s public package entry;
it does not prescribe a new production test setting or a new event schema.
Record inspection accepts a plan/report inline or as content-hashed evidence.
The async explanation is read through the existing `job.status` / `job.output`
surfaces. No new polling command, exact response prose, cutoff heuristic, fixed
repeat count, or new config key is demanded. The plan must use this repo's
archived task handles and the supplied before/after bytes.

## Commands and observed blockers

Requested verification:

```
node scripts/affected.mjs tests/acceptance/2077/removal.test.ts
```

Exit 1 before test selection: `cargo` is not on PATH; the affected runner's
`cargo metadata` error handling itself throws a TypeError. Saved verbatim in
`BASE-FAILURE.txt`. It emitted no WIDE or INCONCLUSIVE lines and ran no tests.
No checks or configuration were changed to get around it.

Diagnostic (not a substitute for affected verification):

```
node node_modules/vitest/vitest.mjs run --reporter=verbose tests/acceptance/2077/removal.test.ts
```

Exit 1: all three scenarios are BLOCKED at the explicit prerequisite check for
missing `packages/cli/dist/main.js`. Output: `DIRECT-PREREQUISITE.txt`. No product
imports, live hub, or criterion assertions were reached. This is **not** the
issue's required BLOCKED-with-no-job proof. The test job did not build outside
its allowed new-file directory or follow the checkout's external workspace
symlinks into another checkout.

`node --check` succeeded for `boundary.mjs` and `launcher.mjs`; both TypeScript
files had zero parser diagnostics. These are syntax checks, not behavior proof.
The final assertion/helper refinements were reviewed but not rerun: the unchanged
missing Cargo and CLI prerequisites still prevent affected/behavior verification.
Full typecheck, live hub execution, and before/after proof remain unrun. No files
were committed. Existing #344 seam tests were left untouched and not rerun.
