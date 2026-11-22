# Evidence for #2764: a Codex subagent's prompt starts no turn of a proceed's

Criterion `#2764.d93a7447`: in a turn a proceed started, a Codex subagent's prompt followed by a call that deletes on a
remote service holds the call with one authority ask naming the proceed; a planted query that counts a subagent's
prompt lets the call run and fails, naming the call.

| File | What it shows |
| --- | --- |
| `tests/acceptance/2764/BASE-FAILURE.txt` | The blind suite at the base 58b4a8cb2: the main test fails naming `gh release delete v1.2.0 --yes` (let through at PreToolUse, no ask); the plant test is BLOCKED (the base names no `proceed-ends-at-subagent-prompt`). |
| `unit-before-fix.txt` | `packages/hub/test/holds.test.ts`'s #2764 test at the base: the delete after the Codex subagent's prompt is let through. |
| `acceptance-branch-{1,2,3}.txt` | The blind suite on the branch, three runs at load 76–80 on 20 cores: the main test passes each time; the plant test passes in runs 1 and 3 and is INCONCLUSIVE in run 2 (the planted hub's let-through came after deep-hook's 50 ms wait, so the hub never decided it; the suite reads that as INCONCLUSIVE, never a pass). |
| `e2e-branch.txt` | Hand run on a real `deep hub run` (the branch): a scripted Codex session through the real `deep-hook codex <event>`: your prompt, a patch, a stop the planted sorter answers "proceed", the subagent's SubagentStart and prompt (`user.ask` from `subagent`), then `gh release delete v1.2.0 --yes` twice. Both calls held (exit 2), one `ask.created` of kind authority naming the proceed, and `deep inbox` (Needs you) shows that one ask. The hub's record follows. |
| `e2e-planted.txt` | The same hand run on a hub with `DEEP_HUB_PLANT=proceed-ends-at-subagent-prompt` (the base's query): both calls run (exit 0, `tool.before` not late, so the hub decided), no ask, and `deep inbox` says nothing needs you. |

The app's Needs you page isn't shown here: the app (`deep-app`) builds on macOS only, and this run was on Linux, so
`deep inbox`, the CLI view of the same asks, stands in for it.

Temp paths are written `<tmp>`.
