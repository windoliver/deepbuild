# #2495 closure: supplemental acceptance checks (drafted blind, immutable once frozen)

Inputs: the issue text, `AGENTS.md`, the design (The learned layer; Configuration evals; Criteria to tests) and base
`9c5b755ef`. Not read: any implementation, transcript or diff. Nothing was run (file tools only). Changes go through the
design's blind-redraft procedure.

## Run

```sh
npm ci && npm run build --workspaces        # the checks use @deepbuild/* dist and packages/cli/dist/main.js
node node_modules/vitest/vitest.mjs run tests/acceptance/2495/closure
# criterion 3, reused unchanged (#112's live.test.ts is a by-hand live-budget proof; it skips without DEEP_EVAL_LIVE=1):
node node_modules/vitest/vitest.mjs run tests/acceptance/112 tests/acceptance/1108 --exclude '**/live.test.ts'
```

No model, plan usage, network or sign-in. Loopback fixtures only; all tokens are #1108's made-up ones; temp folders are
under `/tmp` (`dh1108-*`) and removed after the file. The hub is started by PID and stopped by PID.

## Criteria to checks

IDs are `#2495.<first 8 hex of SHA-256 of the criterion text, trimmed, whitespace collapsed>`, computed in the test from
the exact text (`idOf`). Print them: `npx vitest run tests/acceptance/2495/closure --reporter=verbose | grep '#2495'`.

| Criterion | Check | Fails on the base as |
|---|---|---|
| 1. After an eval run the store holds the report's bytes and the printed handle resolves to them | `report-handle.test.ts` AC1: `deep hub run` in a throwaway `HOME`; `node scripts/config-eval.mjs run` (default launcher, #1108's stand-in `claude`); the printed `ev:<sha256>` must be in the store, hash to its bytes, hold the run's frozen plan and the same runs as the file under `evals/`, which must stay | the run prints no `ev:` handle and the store holds nothing (named assertion) |
| 2. A local-first `learn.widened` citing that handle passes on adopt, is refused naming the outcome otherwise | same file AC2: through the public record API, two widenings (`rule:localfirst`, session to repo). The printed handle (report INCONCLUSIVE) is refused with `INCONCLUSIVE` in its reason; a copy of the stored report with the change side cheaper (`compareReplay` reads adopt) is stored and its widening is `applied` | no handle to cite (same assertion); a program that stores a different shape reads "cites no replay the store holds" or can't read it, never INCONCLUSIVE |
| 3. #112's and #1108's suites pass unchanged | no new test; the command above | n/a (regression guard) |

One integrated test per criterion; the run is shared. `replayCheck` is reached only through the record's append (its
`learned_layer` row's `state` and `reason`), as #112's `widen.test.ts` does.

## Limitations and ambiguities (stated, not dropped)

- **Literal tag IDs are not hard-coded.** They are computed at run time because no hash could be run while drafting. If
  the trace lane scans source text for literal `#2495.xxxxxxxx`, the implementing job must confirm the printed IDs and
  that the lane reads them from test names; changing the file to literals needs the blind redraft.
- **"Through the hub" names no method, role or handle format.** The check starts a real hub whose root is the throwaway
  `HOME/.deepbuild` (the installed hub's address, which `hubAddress()` reads), runs the script against it, and reads the
  handle as `ev:<64 hex>` from stdout (the form `replayCheck` reads). An implementation that needs another start
  (autostart, a flag) fails here as BLOCKED/missing handle: that is a fact to settle, not assumed.
- **Adopt arm is derived.** #1108's stand-in agent reports equal tokens on both sides, so a real run can only read
  INCONCLUSIVE. The adopting report is the stored report with only the change side's `tokens` lowered, stored under its
  own handle; it proves the stored shape suffices for an adopt, not that a real adopting run prints a handle. The
  adopt arm alone passes on a program that stores the report; it fails on base because no handle exists to derive from.
- **Passing on base is not claimed anywhere**; if an implementation's check passes by storing any bytes under a printed
  handle, the plan/runs equality and the INCONCLUSIVE reason fail it. No planted twin is supplied: the base is the wrong
  program for both checks (fix, not new code).
- Imports `world`/`cleanup` from `tests/acceptance/1108/helpers.ts` and `startSession`/`learn`/... from
  `tests/acceptance/112/helpers.ts`, unmodified (those files import packages by relative path; this file uses
  `@deepbuild/*`). No `tsconfig.json`; type-check is not offered. The hub's unix socket needs a short root path (`TMPDIR=/tmp`
  is set for this).
