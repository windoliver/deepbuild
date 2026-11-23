# Acceptance tests for #2669

Written blind: from the issue, the design (States people see) and the base commit only. Every test runs the real
hub, `deep setup` and #83's Claude Code stand-in with its hook log (`../83/helpers.ts`).

| Criterion | File | What it proves |
|---|---|---|
| `#2669.3a6c6d5b` | `late.test.ts` | A session outside any repo whose first task lands after the first prompt's reply: `still going?` typed next is blocked with the answer from the record, and the hook log has no model line for it. |
| `#2669.8fb05bc5` | `late.test.ts` | The workspace notice reaches the agent exactly once: in the late run across the first prompt, the status question and a work prompt (at the next prompt that goes to the model), and in a usual run across the first prompt and a work prompt. |
| `#2669.6995f057` | `status83.test.ts` | `tests/acceptance/83/status.test.ts` run once through the repo's vitest exits 0. |

## What holds the landing

Claude Code's own order (#567): its transcript entry for a prompt can be written after the prompt's hook fires. The
test fires the first `UserPromptSubmit` before writing the entry, so the hub can't read who typed it, sets the prompt
aside and replies with no task opened. Only after that reply does the test write the entry and fire the session's next
hook (an Edit's), which places the prompt: the task opens then and lands in a workspace. The test waits for the
record to show `workspace.created` for that task before the stop and the status question, so the order is fixed by
the hooks, not by a sleep. Each late run checks its precondition: the first prompt's reply carried no notice.

"Reaches the agent" counts every hook reply in the hook log that carries the notice, except a prompt's reply that
blocks the prompt (Claude Code drops that prompt, context and all).

## Base run

`BASE-FAILURE.txt` holds the run on the base commit.
