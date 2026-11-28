# #3235: the skill audit's third reason, written blind

Inputs: issue #3235 (its text on 2026-11-27, no comments), the design sections it links (`node scripts/design-section.mjs --issue 3235`: first-party extensions on by default, the learned layer, what each agent gives us, threats), and base `254bdc87c7f2fc34676193463ee2e685b67a43df`: `packages/hub/src/agents.ts` (the audit), `packages/record/src/learned.ts` (the loosening read), `adapters/*.facts.json`, and the suites of #148, #2121 and #723. No implementation, branch or other worktree was read. Don't edit these tests to make an implementation pass; a dispute goes to a blind redraft.

## Run

```sh
npm ci && npm run build --workspaces
PATH=/opt/homebrew/opt/rustup/bin:$PATH cargo build --locked --offline -p deep-hook
node scripts/throttle.mjs test --wait 60 -- node node_modules/vitest/vitest.mjs run --testTimeout=600000 tests/acceptance/3235
node node_modules/typescript/bin/tsc -p tests/acceptance/3235/tsconfig.json
```

`lane.json` runs the folder alone and lists `ac9-budget.test.ts` as timed.

## The surface

Every criterion but AC8's learned half and AC9's lane check goes through the real hub this checkout builds, started as `deep hub run` in a temporary HOME, and the `deep` CLI: `agents.propose` with a skill `{repo, commit, path}` from a local git repository, the authority ask it raises (its `ask.created` event read through `events.read`), `deep inbox answer`, and `agents.read` (the Agents page's model). Nothing stands in for the hub or the audit.

- **The card** is the ask the install raises. A test reads every string in its `ask.created` data, so a finding may sit in the question or in a field beside it.
- **Stopped** means the card holds the reason `switches approval or checks off`, the line's text verbatim, and its file followed within a few characters by its line number (`run.sh line 3`, `run.sh:3` and `run.sh, line 3` all read). As today, an install or update waits until you answer `apply`.
- **No finding** for prose means the card doesn't quote the sentence. The card may still say in a line that the audit reads code.
- **AC5** puts a stub `cursor-agent` that answers `--version` with `2026.10.1` on the hub's login PATH and syncs the skill to Cursor, whose facts at base list `2026.10.1` as their only version and name no prompt-skipping mode. The card must name Cursor and `2026.10.1`, say its facts name no (or none, or nothing) such flag, and never say `clean`.
- **AC7's record of before** is `fixtures/before/`: the `skills.json` and the sync record the base hub wrote when it installed this exact skill, captured from a base run, with the temp HOME, the temp folder and the commit as `{home}`, `{tmp}` and `{commit}`. The installed files are written beside it. The Agents page must show the line outside `syncs` (the old sync's diff already carries the file's text), and no `ask.*` event and no event kind naming a notification may be recorded.
- **AC8** finds the table as the one source file under `packages/`, `adapters/` or `contracts/` that holds `GIT_SSL_NO_VERIFY`, a flag the learned layer already holds. It copies the checkout to `/tmp` (no `.git`, `target` linked, `node_modules` linked with `@deepbuild/*` pointed at the copy), adds one row by copying that flag's line with the flag renamed `DEEP_AC3235_CHECKS_OFF`, and rebuilds only the package that holds the file. Then the learned layer must hold a learned step change adding `run: DEEP_AC3235_CHECKS_OFF=1 npm test` (`fixtures/learned-state.mjs`, #723's flow on the copy's built record), and the copy's hub must stop a skill whose script runs that line. Controls on the unchanged checkout: the learned layer applies the same change and the audit doesn't quote the line. A failure names the reader that missed the row.
- **AC9** follows #3220's form: `benchmarks/budgets.json` holds a task whose criteria name AC9, with a margin and an `initialReason` naming #3235, that passes the lane's validator against the merge base's budgets and runs. The second test proposes a 200-file skill five times after a warm-up and judges the times with the lane's `judgeLimit` against the merge base's median plus 50%. That median, 44,009 ms, was read on the base at a one-minute load of 173 (`BASE-FAILURE.txt`), so it is a best-effort pin, and off a reference Mac or under load the judge reads INCONCLUSIVE, which fails as INCONCLUSIVE and never passes.

## Requirement → test → base result

| AC | Tag | Test | Base (`BASE-FAILURE.txt`) |
|---|---|---|---|
| 1 | `#3235.85af5de8` | `audit.test.ts` AC1 | FAIL: the card holds no reason, text or `run.sh` line 3 for `claude --permission-mode bypassPermissions …`; waits and installs on approval as required |
| 2 | `#3235.7eeb122b` | `audit.test.ts` AC2 | FAIL: SKILL.md line 9 `git commit --no-verify …` in fenced code not stopped; the prose sentence holds |
| 3 | `#3235.72ad896b` | `audit.test.ts` AC3 | FAIL: SKILL.md line 10 not stopped, and the line above it not shown |
| 4 | `#3235.9456c23d` | `audit.test.ts` AC4 | FAIL for each of `git config core.hooksPath /dev/null`, `git -c core.hooksPath= commit …`, `curl -k …`, `deep off` |
| 5 | `#3235.ab296727` | `audit.test.ts` AC5 | FAIL: the card names no `2026.10.1` and says nothing of the facts |
| 6 | `#3235.cfb2d4cf` | `update.test.ts` AC6 | FAIL: the update's card doesn't stop run.sh line 4 `git push --no-verify origin main`; held and byte-equal hold |
| 7 | `#3235.56171bb6` | `before.test.ts` AC7 | FAIL: the Agents page doesn't show the line; no ask, no notification, files untouched hold |
| 8 | `#3235.27b56b06` | `table.test.ts` AC8 | FAIL naming the audit: the learned layer holds the added row, the audit doesn't stop the line |
| 9 | `#3235.8aac6e47` | `ac9-budget.test.ts` | FAIL: no budgets.json task names AC9; the timed reading is in `BASE-FAILURE.txt` |

Tags use `scripts/proof-change.mjs`'s normalization: the checkbox text, trimmed and with white space collapsed, SHA-256, first eight hex digits.

## Planted twins

AC2, AC3, AC5 and AC8 name planted wrong programs. With no implementation to plant them in, this job wrote a throwaway third reason over the base, which it kept nowhere, and four twins of it, each one fault. `TWINS-RUN.txt` describes the throwaway and each fault, and has the throwaway's run (every test of AC1 to AC8 passes on it) and each twin's failure. Neither the throwaway nor the twins are kept, and there is no `twins.json`: a twin is the throwaway's file with one fault, which can't be laid over another implementation. Every criterion already fails on the merge base, so the lanes don't need one.

## Files

- `helpers.ts`: worlds, the hub from a chosen checkout, the card, the stopped and prose checks, tags.
- `audit.test.ts` (AC1 to AC5), `update.test.ts` (AC6), `before.test.ts` (AC7), `table.test.ts` (AC8), `ac9-budget.test.ts` (AC9).
- `fixtures/before/`: AC7's record of before. `fixtures/learned-state.mjs`: AC8's learned-layer reader on a checkout's built record.
- `BASE-FAILURE.txt`, `TWINS-RUN.txt`: run records, with temp folders as `<tmp>` and home folders as `~`.
