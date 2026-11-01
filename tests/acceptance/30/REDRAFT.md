# Blind redraft of the halves that waited on #29, #348 and #349 (2026-11-01, base `c9225aa3`)

The first draft (README, Readings) found that AC2, AC7, AC8, AC9, AC10, AC14, AC17 and AC19 end in a claim's verdict,
the gate runner's (#29), and that AC5's "installed with `replaces`" needs the extension host (#348) and the slots
(#349). Those had no surface at `2ccdfd6`, so each half failed BLOCKED in `blocked.test.ts`. The three have landed, so
a fresh run of this job, with the issue, the design, AGENTS.md, the suite as it stood and the public entries those
packages now publish, wrote the halves. It saw no implementation of them: none exists at this base, so the tests
define the smallest surface they need (README, The claim's surface) and an implementing agent builds to it.

## What changed

- `claims.test.ts` (new): the claim halves. Every test first runs the criterion's fixture for real through
  `@deepbuild/checks-command` (`runCommandCheck`, or `runAddedTests` for AC9), exactly as the run-half file beside it
  does, then hands those run records to `@deepbuild/gate`'s `claimVerdict` and asserts the verdict's words the
  criterion names: INVALID "ran nothing" naming the check (AC2); FAIL on an overrun and on a crash, INCONCLUSIVE on a
  stopped run (AC7); the real-users requirement INCONCLUSIVE naming `policies` and `scripts/seed.ts`, its twin PASS
  (AC8); INCONCLUSIVE naming "the trial is still open" with six counted runs and the failing run's output in the
  evidence, FAIL when every run fails (AC9); INVALID naming "exit status masked by `|| true`" and FAIL naming
  "applies the discount" (AC10); the FAIL's frame `src/cart.test.ts:30` (AC14); INCONCLUSIVE naming "settles the
  order" (AC17); INVALID naming `output out` for the sample and the silent report, the full one counts (AC19). Each
  criterion that names a wrong program has a `(wrong program)` twin, as the run halves do: the twin's record or plant
  goes through the same assertion, which must fail naming what the criterion says.
- `replaces.test.ts` (new): AC5's slot half. A release package, `fixtures/command-kind`, registers `command` with
  `replaces: ["command"]`; a fresh extension host on the world installs it (check.kind@1's kit must read PASS, as
  #349 AC4 installs a journey), loads it in the hub, and names it the holder of `command`. `runCheck('command', …)`
  on the escape fixture is refused the hub's socket and the outside write, and `sandbox.denied` names the path. The
  twin runs the same package on a supervisor planted `'sandbox-left-to-caller'`: the check then reaches both, so the
  confinement is the supervisor's and no sandbox was built inside the kind, the slot or its kit.
- `fixtures/command-kind/`: the test check kind. Its runner is the command check kind's own, imported from the built
  entry `command.json` names, started through the host@1 the hub hands it as `ctx.host`; `command.json` also names the
  variables the test passes (the hub's socket, the outside path).
- `helpers.ts`: `World.asks` exposed; `pkg`, `releaseEntry` and `openHostOn` (an extension host on a world, closed
  after the file), `CHECKS_COMMAND_DIST`; `claimOf` (a one-check, one-requirement claim from runs, which fails BLOCKED
  naming the run when a run never started) with `REQ` and `CLAIM`; `policiesCheck` and `POLICIES_TWIN_SRC`, moved
  from `standin.test.ts` because `claims.test.ts` needs the same check. `standin.test.ts` reads them from here and
  asserts what it did.
- `wrong.ts`: `scrubsEveryPassedValue` now scrubs each failure's file, message and stack too, as a scrub of every
  passed value would, so the claim's FAIL on its record points to `src/cart.[redacted].ts:30`. `privacy.test.ts`'s
  assertions on it are unchanged and still hold (the output is scrubbed as before).
- `blocked.test.ts`: only AC19's timing half (#87) is left, with the header saying so. The run-half files' headers
  now point at `claims.test.ts` and `replaces.test.ts` instead.
- `README.md`: "The claim's surface" (the `SURFACE-CLAIMS` block and what `claimVerdict` holds to, including the
  three things the verdict engine gains: `Run.attempts`, `Requirement.real_users` with `Run.stand_ins`, and the
  passed-and-failed reason naming the tests), AC5's `ctx.host`, the criteria table rows, the wrong-program rows, two
  Readings (the hub restart, "about what real users get"), What depends on other issues, Files.

## Why the surface is where it is

- The verdict is the core's: the design has the hub make it (An agent says it's done) from the gate's runs, and the
  core never imports an extension. So `claimVerdict` sits in `@deepbuild/gate`, beside `floor`, `claimsFor` and
  `executeClaim`, and takes the run record by its fields (`RecordedRun`, which a `CommandRun` is) rather than
  importing `@deepbuild/checks-command`. It is pure: every input, the time included, is an argument, as #29's
  surface reads.
- Three criteria say more than the engine's rows at this base can say: AC17 names the test that failed and passed on
  its attempts within one run; AC8 ties a stand-in to a requirement about real users; AC9 names the failing test on
  an INCONCLUSIVE. The design says every verdict rule is a row in the engine's one table, so those are stated as rows
  the engine gains (README, The claim's surface), not as something the gate works around.
- AC5's slot half needs the kind in the hub to start its process through host@1 and nothing else; the extension API
  hands a check kind only `(spec, ctx)`, so the smallest surface is one field, `ctx.host`, on the context a hub kind
  gets, from `runCheck` and from the kit at install alike.

## Readings this redraft made

- The hub-restart run (AC7) is made as `ending.test.ts` makes it, through `stop`: the hub signals it as it goes
  down, and the run ends `stopped`. No check runs in the hub through the command check kind at this base, so a built
  hub restarted mid-run isn't driven; the claim's verdict is the same.
- AC10 runs for pnpm and npm, as `mask.test.ts` does; the pnpm form fails BLOCKED where pnpm is missing.
- AC17 accepts either reading of `retries.test.ts`: both attempts listed (INCONCLUSIVE naming the test), or the
  tool's retries turned off (the run failed on the test, FAIL naming it).

## Type check

`node node_modules/typescript/bin/tsc -p tests/acceptance/30/tsconfig.json` at this base fails only on the names the
surface adds: 5 x TS2305 (`claimVerdict`, `ClaimedCheck`, `ClaimedRuns`, `ClaimRequirement`, `RecordedRun` missing
from `packages/gate/src/index.ts`) and 4 x TS7006 (implicit any on callbacks whose types come from `claimVerdict`'s
result). Against a scratch mirror of the repo (never inside it) whose `packages/gate/src/index.ts` is the real entry
plus a declaration-only copy of the `SURFACE-CLAIMS` block, the same command exits 0.

## Run on this machine

See `BASE-FAILURE-claims.txt`. This box is Linux, where the supervisor refuses every start ("no platform sandbox
backend for linux yet (#70)"), `packages/checks-command/dist` isn't built, and pnpm is missing. So nothing here could
run to a verdict: every claim test fails BLOCKED naming the run that never started (or on `claimVerdict` missing),
`replaces.test.ts` fails BLOCKED on the unbuilt entry, and the pnpm tests fail BLOCKED on pnpm. Nothing passes. The
run on the reference Mac, with `npm run build --workspaces` done, is the one that counts.
