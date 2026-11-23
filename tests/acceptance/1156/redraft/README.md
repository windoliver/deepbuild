# Blind redraft of #1156's fast tests, after the Scope's amendment of 2026-11-22

Written by a job that saw only the inputs below, after the issue's owner amended its Scope: the scripted session's
prompt asks it to fix the coupon test and commit the fix, and no longer names the push. Under #84 a push that a prompt
you typed names is authorized by your words and held by no proceed, so the first draft's prompt ("commit the fix and
push it") let `git push origin main` through once #84 merged, and AC3, AC4 and AC7 could not hold. The seven criteria
are unchanged; all seven share the one session, so every criterion's tests are redrafted here. The implementing agent
doesn't edit these files (AGENTS.md, Proof).

## Inputs

- Issue #1156 as amended (`gh issue view 1156 --repo windoliver/deepbuild`): Scope, the amendment note, the seven
  criteria, Proof. Criterion IDs: `#1156.` + the first 8 hex of SHA-256 of each trimmed line: db084f91 (AC1), ab43aba4
  (AC2), 4ce23e29 (AC3), 5a63f2db (AC4), 42037a34 (AC5), e1b9237a (AC6), 281bd100 (AC7).
- `docs/technical-design.md` by `node scripts/design-section.mjs docs/technical-design.md#<anchor>`: Before each
  command, Plans before acting, Threats and what stops each one (`--issue 1156` is BLOCKED: the issue is closed, and the
  script reads open issues only), and the Dogfooding paragraph (found by search; it has no anchor of its own).
  AGENTS.md, Proof.
- The base commit `83b82f94a` (origin/main), read for its surfaces only: `packages/hub/src/{holds,named,plant,confirm,
  trusted-actions,server}.ts`, `scripts/{agent-harness,lanes,design-section}.mjs`, the root `vitest.config.ts` and
  `tsconfig.json`.
- The first draft in `../`: `README.md`, `helpers.ts`, `fast.test.ts`, `fixtures/`, `twins.json`, `twins/`,
  `BASE-FAILURE.txt`.

## How to run

On macOS, with Node 24.22 first on `PATH`, the Rust toolchain, `cc` and `codesign`; the TS workspaces built
(`npm ci && npm run build --workspaces`). Build the two deep-hooks first, so no cargo build runs inside the vitest run
(the suite's own `cargo build` is then a no-op):

```sh
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -q -p deep-hook
# the pre-#1097 reader, as ../helpers.ts `oldReader` builds it, under target/base-1156/fad1c4cb4e9c/
node node_modules/vitest/vitest.mjs run tests/acceptance/1156/redraft/fast.test.ts
node node_modules/typescript/bin/tsc -p tests/acceptance/1156/redraft/tsconfig.json
```

The file runs alone (it starts hubs and uses `/tmp/dh1156r-*`, about 1.4 GB for the padded record); the proof lands
in `/tmp/deep-1156-redraft-proof/`. It takes longer than 10 minutes on a loaded machine, so run it in a terminal, not a
background job with a 10-minute cap. Delete any `.vitest` folder it leaves.

## From the first draft

`helpers.ts` is a copy of `../helpers.ts`, since the session's prompt must differ and that file can't be edited. It
differs only here:

1. **The prompt**: `Fix the coupon test: read README.md, run \`npm test\`, fix the bug in src/coupon.js, run \`npm test\`
   again, then commit the fix.` No spelling of push and no pull request (`NAMES_A_PUSH`), no remote.
2. **No proceed**: the stop "Want me to push to main?" and its planted sorter (`DEEP_HUB_TEST_SORTER`) are gone. The
   pushes follow `clean.sh` in the same turn. AC3's main reading adds `unpromptedProblems`: the prompt names no push and
   the record holds no `question.proceeded` row for the session, so a hold that needs a proceed can't pass for this one.
3. **The 10 s hold**: after your signed yes the session waits `HOLD_MS` (10 s, design: Plans before acting, "A hold
   before what can't be undone") plus 2 s before running the push again, as the hold's reply tells it to. The first
   draft retried at once, which the base now denies until the hold is over.
4. The fixtures are `../fixtures/`, unchanged; temp folders `/tmp/dh1156r-*`; proof `/tmp/deep-1156-redraft-proof/`.
5. The live session, the harness scenario and the transcript reader are left out (out of scope here).
6. New: AC4's two refusals read against planted hubs (`exitZeroCountedProblems`, `replayCountedProblems`), and AC7's
   check as a function of a report reader (`reportProblems`) with a planted twin of the reader (`reportByProblems`).

Every other reading is the first draft's, word for word.

| First draft (`../fast.test.ts`) | Redraft (`fast.test.ts`) | Wrong program it must fail on |
|---|---|---|
| AC1 main | AC1 main (same check; the session's prompt changed) | deep-hook from before #1097 (`fad1c4cb`), planted in the AC1 wrong-program test |
| AC1 (wrong program) old reader | same | itself: must fail naming the call |
| AC2 main | same | twin `stages-without-copy` (`../twins.json`) |
| AC2 (wrong program) copy-less stager | same | `DEEP_HUB_PLANT=stages-without-copy`: must fail naming `bash clean.sh` |
| AC3 main | AC3 main, plus no push named and no proceed | the all-`repo` matcher (asks core `push-target-as-repo`), planted in the AC3 wrong-program test; also a base-before-#84-style hold (see Ambiguities 2) |
| AC3 (wrong program) all-`repo` matcher | same | itself: must fail naming the URL |
| AC4 main | same | none the issue names for the yes itself (see Ambiguities 3); `../twins.json`'s `proceed-covers-turn` no longer reaches it |
| AC4 (wrong program) exit-0 helper refused | same | **new**: on `DEEP_HUB_PLANT=answer-on-token` the same check must fail naming the helper's path |
| — | AC4 (wrong program) exit-0 check on a hub that counts the answer without the signature | `answer-on-token` (base plant) |
| AC4 (wrong program) replayed signature refused | same | **new**: on `DEEP_HUB_PLANT=signature-covers-anything` the same check must fail naming the ask |
| — | AC4 (wrong program) replay check on a hub that verifies whatever the helper says it signed | `signature-covers-anything` (base plant) |
| AC5 main | same | twin `env-loads-by-value` |
| AC5 (wrong program) by-value environment | same | `DEEP_HUB_PLANT=env-loads-by-value`: must fail naming an evidence file |
| AC6 main | same | twin `trust-read-per-call` |
| AC6 (wrong program) per-call trust reader | same | `fixtures/core.mjs per-call`: must fail naming the extension |
| AC7 main | same check, as `reportProblems(steps, reportOf)` | **new** planted twin `reportByProblems` |
| — | AC7 (wrong program) a report that reads a step by its problems alone | `reportByProblems`: must fail on every step, naming it |

## Ambiguities

1. **The run's report** (AC7). No surface on the base gives one per step: the harness's run line has one verdict for
   the run. As the first draft did, the report is `report.json` in the proof folder, written by this suite's `reportOf`
   from the run's hook replies and record rows. So AC7 holds this suite's reader to the criterion, not a product
   surface; the new planted twin shows the check can fail. If the owner means a product report, AC7 needs one.
2. **What holds the push.** The design (Your written rules, enforced) says a push goes ahead only when the thread's ask
   names it or a rule covers it. The base holds it in #84's push default (`namedDefaults`, "no request in this thread
   names that"), with no proceed. The test reads only the hold, its one authority ask and its plan; it doesn't care
   which rule raised it, but it does fail if the session's record holds a proceed.
3. **AC4's main test has no named wrong program.** The issue names two for AC4, the exit-0 helper and the replayed
   signature, and both are scripted on the world and must be refused. The first draft's lane twin for AC4,
   `proceed-covers-turn`, made the push go unheld because a proceed covered the turn; with no proceed in the session
   (by reading `holds.ts`: `covered` needs a proceeding turn, and `namedDefaults` still holds the push) it no longer
   changes anything this suite reads, so it is no longer a wrong program for AC4 (nor AC3). Not run as a twin here.
   A twin for AC4's yes (for example one where the call doesn't run on your yes) would be the proof lane's to add.
4. **The planted hubs for AC4's refusals** are the base's closest plants, not the issue's words: `answer-on-token`
   counts a CLI answer with no confirmation at all (so the exit-0 helper is never even run), and
   `signature-covers-anything` (#880's) verifies the signature over what the helper says it signed. Each makes the
   check fail at its first assertion (exit 3), and its message names the path or the ask.
5. **The prompt names no remote**, as in the first draft, so `origin` is placed `repo` under #1098, not `you`.
6. Hub stopped, timing, the deadline, `clean.sh`'s `OUT=out`, and "earlier ask": as the first draft's README says.

## Files

- `fast.test.ts`: one main test per criterion and each wrong program, titles starting with the criterion's ID.
- `helpers.ts`: the world, the session, the readings, the report, the wrong programs.
- `tsconfig.json`: the type check.
- `BASE-FAILURE.txt`: the run at the base.
