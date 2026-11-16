# Acceptance tests for #184, criterion 7: third blind draft

Written blind, a third draft of criterion 7's second clause, on the owner's ruling, by a fresh run of the acceptance job
for this one criterion (design: Dogfooding). The owner's ruling, in their words:

> "The replica's refusal is 'before any run': the play is refused before its first step and the check counts no run."

So a call reaching the replica is allowed; what must hold is that the replica refuses the play before playing any step,
no run of the policy is counted, the check doesn't pass, and the refusal names the control. At the coordinator's
request this file also holds the criterion's first clause, read as the criterion says, so it runs in place of the
earlier drafts' files: one test a clause, each titled with the tag `#184.25600094`.

No implementation existed in the checkout (96e678581: base 0e5572731, the first suite, the first redraft and two
`scripts/lanes.mjs` commits). No other worktree, branch, pull request, plan or session was read, and neither earlier
draft's test for this criterion (`tests/acceptance/184/ac07-bots-refused.test.ts`,
`tests/acceptance/184-redraft-ac7/ac7-bots-refused.test.ts`) was opened.

## What was read

- The issue, live (`gh issue view 184 --repo windoliver/deepbuild`): Scope, Fields, criterion 7, its comments.
- `docs/canvas-primitives.md`: Check input: playtest; Check input: plug-in reads; Replica `deep_drive`.
- AGENTS.md. The first suite's `README.md` ("The surface"), `helpers.ts`, `programs.ts`, `tsconfig.json` and, for its
  style only, `ac04-trap.test.ts` and `ac09-agent-bot.test.ts`; `packages/verdicts` (`Source`) for a type. The first
  redraft's README's opening lines.

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node scripts/throttle.mjs build --wait 120 -- sh scripts/lease \
  npx vitest run --root tests/acceptance/184-redraft-ac7-2 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/184-redraft-ac7-2/tsconfig.json
```

It builds `deep-drive` (debug, `env-plants`) through the first suite's `driveBin`. **Add the folder to `alone` in
`scripts/lanes.mjs`** (`'tests/acceptance/184-redraft-ac7-2/'`), as the first suite's line does: it starts replicas and a
hub and runs minutes. Off macOS each test fails `INCONCLUSIVE:` first (the first suite's `macOnly()`), never a pass.

## The surface it uses

Only the first suite's, imported read-only from `../184/helpers.ts` and `../184/programs.ts`: `Pool` (every replica call
logged with its reply), `openHub` with the playtest plug-in loaded, `playInput`, `runPlaytest`, `runsOf`, `played`,
`judge`, the clean maze, `logicBot` and `trapBotProgram` (divides by k − 5, so its own step 5 traps). From "The surface":
a play answers `bot_trap` apart from `trap`; an error answers `{"ok": false, "t", "error": {"code", "message"}}` and
nothing else; a run's failure is `bot <b> run <i>`, one made invalid by its bot's trap saying `invalid`; `testsRun`
counts runs. Nothing new is invented here.

## Clause to test

| Clause | Test | Read as, and the wrong program it fails on |
|---|---|---|
| "A logic bot that traps makes its run INVALID, and the check can't pass with it" | first `it` | 3 runs of the trap bot on the clean maze: each run's play answers ok with `bot_trap` at step 5 and `trap` null; each `bot 0 run <i>` failure says invalid and doesn't start `playtest.trap`; the check isn't `passed` and the verdict isn't PASS. Fails on a program that ignores the bot's trap and passes, ends the run with no failure, or reports it as the piece's trap |
| "a policy that names a control the piece doesn't declare is refused before any run, naming the control" | second `it` | 3 runs of a policy picking `arrow` and `jump` on the clean maze (which declares `arrow` only): every reply the replica gave this check is `ok: false`, its error names jump, and it holds only `ok`, `t`, `error` (no track, entries, steps, values, checkpoints or frames); `testsRun` 0; no failure is a run's (`run <i>`, or a run outcome code); a failure names jump; not `passed`; the verdict isn't PASS. Then the policy on `arrow` alone (1 run of 2 s) is played (its run 0 answers ok) and counted (`testsRun` 1). Fails on a program that plays the policy's runs and fails afterwards (ok replies, testsRun 3), one that drops the `jump` pick and plays on (ok replies), one that passes, one whose refusal doesn't name jump, and one that refuses every play |

## Readings

- **No call to the replica** is allowed too: then the refusal is the plug-in's, before any step, and the clause's other
  facts are read from the check's result.
- **Fewer runs**, as the first suite's README reads criterion 7: 3 runs a playtest; the contrast plays 1 run of 2 s.

## Files

`README.md`, `BASE-FAILURE.txt`, `tsconfig.json`, `ac7-bots-refused.test.ts`.
