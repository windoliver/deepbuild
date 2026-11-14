# Acceptance tests for #2064: the Closes rule reads every pull request command and the body it will carry

Written blind from `issue.json`, `docs/technical-design.md` (What done means; Threats; Criteria to tests; Dogfooding), `AGENTS.md` and the base `1c4d1f0e2`. Tags follow `acceptance.ts`: `#2064.` plus the first 8 hex of the SHA-256 of the criterion text (whitespace collapsed). Do not edit; a dispute goes to a blind redraft.

## Files
- `helpers.ts`: a hub (`deep hub run`, temp HOME) with #322's world (`../322/helpers.ts`, `work.ts`: repo, issue 7's handed definition R1 + R2, trust), the session's hooks as lines on the hub socket (`../1881/helpers.ts`), a real git checkout of `acme/shop` on branch `b` (origin set, `origin/main` = main). The **only stand-in is the forge** (#1881's `startForge`, via `DEEP_HUB_TEST_FORGE`). The state "R1 passed, R2 has no PASS" is the hub's own `test.verdict` facility (`DEEP_HUB_TEST_VERDICT`, as #83 uses it) after the session's real edit and stop made a claim.
- `gate.test.ts`: AC1, AC2, AC3, AC4 (Part of twins), AC5. `passed.test.ts`: AC4 (Closes once every requirement passed). `record.test.ts`: AC6, AC7.
- `zdebug.test.ts`: a scratch stub the job could not delete. Delete it; do not copy it.

## Requirement -> test -> proof (base result in `BASE-FAILURE.txt`)
| Criterion | Test | Asserts | On the base |
|---|---|---|---|
| AC1 joined `git push -u origin b && gh pr create ... "Closes #7"` denied naming R2 | gate: AC1 | that command denied, words name R2; then `;`, joined `gh pr edit`, a second PR command of a joined line, body heredocs (alone/joined/`--body-file -`) all denied naming R2 | FAIL at the issue's command (gate.test.ts:56) |
| AC2 body file / `--fill` (`Fixes #7`) / `gh pr edit 3 --body-file` | gate: AC2 | each denied naming R2 (also body file after a push) | FAIL, four lines name each command |
| AC3 `Closes acme/shop#7` | gate: AC3 | denied naming R2; `Closes acme/other#7` is not held (guard) | FAIL at the owner/repo form |
| AC4 twins | gate: AC4 (`Part of #7. Left open: R2` in every form, incl. `Part of acme/shop#7`), passed: AC4 (`Closes #7` in every form once R1 and R2 have PASS) | all run | both PASS on the base (guards: they stop an over-eager denier) |
| AC5 missing body file | gate: AC5 | denied, words contain `missing.md` (alone and joined) | FAIL |
| AC6 error inside the rule | record: AC6 | the record's `tasks` table renamed under the running hub, so the rule's own read throws; denied, words match `no such table` | FAIL (allowed) |
| AC7 PR of a joined command recorded | record: AC7 | a second session's `git push -u origin b && gh pr create ... "Part of #7"` (no task for 7 in that session, so only the lookup is under test); the forge holds the PR; PostToolUse output holds only a decoy link; a `session.reading` holds the forge's PR URL, not the decoy; the hub did GET `/repos/acme/shop/pulls...` | FAIL: no reading |

Denials are asserted by decision plus naming R2 / the file / the error, never by message wording.

## Gaps and notes
- **Repeated-send rule's own error (#85, Scope bullet 4, second sentence) is NOT covered.** `delivery.resent` catches its forge/record reads itself, so no error can be planted inside it through a public surface (env, plants, record) without in-process access to an internal. Needs a blind redraft with an agreed planting hook, or the implementer must show the proof another way.
- AC6's plant is real record damage (not a mock). It needs the hub's `tasks` table name to stay; if the implementation reads another table first, the plant still throws on any read of `tasks`.
- AC7's command has no R2 list under `Part of #7` (as the issue words it), so it runs in a session with no task for issue 7.

## Run
Environment needed (the export lacked them): `npm run build --workspaces`, links in `node_modules/@deepbuild/` for every `packages/*` (the export missed `channels checks-host checks-journey github jobs routing-replay sources`), and a `target/debug/deep-hook` file (hub start requires one; cargo was unavailable, a no-op shell script stood in for it, which these tests never run).
```sh
node node_modules/vitest/vitest.mjs run tests/acceptance/2064 --no-file-parallelism --testTimeout=600000
```
`node scripts/affected.mjs tests/acceptance/2064` is the repo entry; the export has no `.git`, so it was not run here.
