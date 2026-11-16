# Acceptance test for #184, criterion 7: blind redraft

Written first, blind, from issue #184 ("Playtests: …"), the design sections it names, base commit 0e5572731 and the
first blind suite's shared files, by a fresh run of the acceptance job for this one criterion (design: Dogfooding: a
disputed test goes to a fresh run with the same inputs and the criterion, never the work, the diff or the dispute). No
implementation existed in the checkout; no other worktree, branch, pull request, plan, session or dispute was read, and
the first suite's own test for this criterion (`tests/acceptance/184/ac07-bots-refused.test.ts`) was not opened. The
worktree stood at c58a6b361: 0e5572731, the first suite (0ae7a3977) and one `scripts/lanes.mjs` commit.

## What was read

- The issue, live (`gh issue view 184 --repo windoliver/deepbuild`): Scope, Fields, criterion 7.
- `docs/canvas-primitives.md`: Check input: playtest; Check input: plug-in reads; Input track; Replica `deep_drive`.
- `docs/technical-design.md`: Checks for work beyond code (the Playtest bullet); Extension API (TypeScript, in-process);
  Dogfooding. AGENTS.md.
- The first suite's `README.md`, `helpers.ts`, `programs.ts` and `tsconfig.json`; `packages/conformance` (`CheckResult`)
  and `packages/verdicts` (`Source`, `Verdict`) for the types those files use.

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node scripts/throttle.mjs build --wait 120 -- sh scripts/lease \
  npx vitest run --root tests/acceptance/184-redraft-ac7 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/184-redraft-ac7/tsconfig.json
```

It builds `deep-drive` (debug, `env-plants`) through the first suite's `driveBin`. **Add the folder to `alone` in
`scripts/lanes.mjs`** (`'tests/acceptance/184-redraft-ac7/'`), as the first suite's line does: it starts replicas and a
host. Off macOS each test fails `INCONCLUSIVE:` first (the first suite's `macOnly()`), never a pass; cargo that can't
run is `BLOCKED:`.

## The surface it uses

The first suite's, unchanged (its README: The surface): `deep-drive`'s `play` call with `bot_trap` and `trap`, the hub's
replica as a `Pool` whose log holds every play call a replica got, `packages/checks/playtest` loaded in an extension host,
`runCheck` of a `playtest` spec whose `play` is the input, failures tested `bot <b> run <i>`, a run made invalid by its
bot's trap saying `invalid`, and "a policy naming a control the piece doesn't declare is refused before any play". From
its programs: the clean maze (one control, `arrow`), the route bot and the trap bot (divides by k − 5, so it traps at
its step 5). It adds nothing.

**"Refused before any run"** is read as: the replica gets no play call at all for that check, for any of its bots, and
`testsRun` is 0. A run happens only in a replica (Check input: playtest: "Each run plays in a replica"), and `testsRun`
counts runs. The refused policy sits beside a valid bot, the route bot, so a refusal made only when the policy's runs
reach the replica, or by the replica itself, still shows plays in the log and fails. The control is named when a
failure's message holds `jump` as a word.

**"The check can't pass with it"** is read with the trap bot beside the route bot, on a 5 s span: the route bot reaches
won by step 40 and no run can stay 10 s unmoved, so neither goal_missed nor stuck can fail the check. The same input
with the route bot alone must pass, so the check's failure is the trap bot's. Fewer runs (3 a bot) and the short span
follow the first suite's reading for criteria that name no count.

## Criterion to tests

| ID | Clause | Test (`ac7-bots-refused.test.ts`), and the wrong program it fails on |
|---|---|---|
| AC7 #184.25600094 | a logic bot that traps makes its run INVALID, and the check can't pass with it | the route bot alone passes; with the trap bot beside it the check isn't `passed` and the verdict isn't PASS; each trap-bot run's play has `bot_trap` item `bot` at step 5 and `trap` null, and a failure for that run says invalid and isn't `playtest.trap`; no route-bot run fails. Fails on a plug-in that ignores `bot_trap` (the trap bot's runs end `ended`, the check passes), or calls it the piece's trap |
| AC7 #184.25600094 | a policy naming an undeclared control is refused before any run, naming it | route bot plus a policy picking `arrow` and `jump` on the maze (which declares only `arrow`): no play reaches the replica, `testsRun` 0, not `passed`, a failure names jump, the verdict isn't PASS. Fails on a plug-in that plays the route bot's runs first, lets the replica refuse the policy, or drops the unknown pick and plays on |

## Files

`README.md`, `BASE-FAILURE.txt`, `tsconfig.json`, `ac7-bots-refused.test.ts`.
