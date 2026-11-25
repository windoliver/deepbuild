# Acceptance tests for #3309

Written blind, from issue #3309 (its Scope, three acceptance criteria and Proof), `docs/technical-design.md` (Hook
protocol, deep-hook and the hub; An ask, and your answer getting back; Sessions that know about each other),
AGENTS.md, CONTRIBUTING.md and the base commit `33075a35a` (head of PR #3308, #3305), read only to learn how to drive
the hub. Prior art read: `tests/acceptance/3305/` (the closest: the lost prompt and the count), `906/` (the planted
late reply), `352/` (sibling sessions and their notices), `340/` and `1577/` (a note from the app), `120/` (promised
checks), `1342/` (a forge the test runs) and `83/`. None of those is edited; their helpers are imported by path. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft by this job.

| Criterion | File | What it proves |
|---|---|---|
| `#3309.5263c09a` | `sibling.test.ts` | A notice from sibling session B, handed in the reply to session A's prompt after A's deep-hook was already gone while that reply was being built, reaches A exactly once over the run, with A's next hook (its next prompt). |
| `#3309.c730ec7c` | `note.test.ts` | A note you sent from the app (`session.note`, #340), carried in a prompt reply deep-hook never read (the planted late reply), reaches the agent exactly once over the run, with the next prompt that reaches the model. |
| `#3309.c1997961` | `promise.test.ts` | A promised check (#120) that came due and waits for the next prompt, carried in a prompt reply deep-hook never read (the planted late reply), reaches the agent exactly once over the run, with the next prompt that reaches the model. |

## Run

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.0/bin:$HOME/.cargo/bin:$PATH"
npm ci && npm run build --workspaces && cargo build --locked -p deep-hook
node node_modules/vitest/vitest.mjs run --root tests/acceptance/3309 --no-file-parallelism   # about 45 s
node node_modules/typescript/bin/tsc -p tests/acceptance/3309/tsconfig.json                    # type-check
```

With `--root` here, Vitest writes its cache to `tests/acceptance/3309/node_modules/.vite/`. Delete it before committing.

## What's real

The hub (`deep hub run`), deep-hook and `deep mcp` are real in every file. `note.test.ts` and `promise.test.ts` run
as `../3305/` does: `deep setup`'s entries, run by #83's Claude Code stand-in (`../83/fixtures/claude.mjs`) with its
hook log, and the hub started with #906's plant through `../3305/helpers.ts` (`lateHub`, `lostPrompt`, `reached`).
`sibling.test.ts` runs in #352's world through `../352/helpers.ts`: one git repo, two worktrees, the projects trusted
as #348 records it, each session's own agent process (`../352/fixtures/agent.mjs`) starting deep-hook as Claude Code
does, and the hub as #352 starts it, with two more variables: `DEEP_HUB_TEST_FORGE` naming this test's forge and a
`GH_TOKEN` that only that forge sees. The forge (`HeldForge` in `helpers.ts`) is GitHub's REST API as far as an issue
link's read reaches it, on 127.0.0.1: every path answers 404 at once, except the one issue it holds. The note is sent
as the app sends it: `session.note {session, text, request}` on an `app` connection with the control token. Every home
is a temporary folder; nothing touches the real `~/.deepbuild`, `~/.claude`, the Keychain or LaunchAgents. Processes
are stopped by PID only, and only ones the test started.

## Defined here

**The lost reply, for the note and the promised check.** #906's planted late reply, as `../3305/README.md` defines it:
while `DEEP_HUB_TEST_LATE_REPLY`'s file exists, the hub writes a prompt's reply 1 s past the 2 s hold, after deep-hook
has let the prompt through with nothing printed. The core still builds the reply at the usual time, so the note or the
check goes into it then. If deep-hook let the prompt through in under 1 s, the hold was never reached (machine load),
and `lostPrompt` stops the run as BLOCKED.

**The lost reply, for the sibling notice.** The issue says the plant can't lose a notice: the reply is built before
deep-hook gives up, so `Siblings.gone` already gives it back. So this test holds the reply's build itself and makes
deep-hook gone during it, before the hub's deadline for handing notices (`until`, the 2 s hold less 500 ms):

1. A's prompt names an issue link, `https://github.com/acme/shop/issues/7`. The hub reads it from the forge before it
   builds the prompt's reply (the reply waits on the prompt's intake, `PromptItems`). The forge holds that read open.
2. As soon as the forge has the read, the test stops A's deep-hook for that prompt by its PID (`SIGKILL`), as Claude
   Code stops a hook it has given up on; the PID is the deep-hook child of A's agent process, read from `ps`. Its
   connection closes, so the hub hears the hook is gone while the reply is still being built.
3. 200 ms later the forge answers 404: the read ends with nothing read, and the reply is built, with the notice, for a
   deep-hook that is gone. The prompt itself reached the model without it (the agent saw no reply).

Killing by PID rather than shortening the entry's `timeout` keeps setup's entries as setup writes them, and puts the
moment exactly inside the held read. The run is BLOCKED, never a failure, when the timing it relies on wasn't met: the
forge never got the read, the one deep-hook process wasn't found and stopped, or deep-hook was gone more than 600 ms, or
the read let go more than 800 ms, after the forge had the read (inside the hub's own 1 s limit on that read and its
hold's deadline).

**The notice.** A edits `src/cart.js` and stops; then B edits the same file and stops, so the hub keeps a notice for A,
"session <B's short ID> (claude-code) also changed src/cart.js …", for A's next hook. The test checks first that no
`notice.delivered` from B reached A and that nothing A was told named it. It is matched by B's short ID and
`also changed src/cart.js`.

**The note.** Sent from the app while A's first turn runs, before any stop: no waiter is there to take it, so it waits
for the session's next prompt (#340). Its words carry a random tag; the test checks the record holds it
(`session.note`) and that no hook printed it before the lost prompt.

**The promised check.** The agent stops saying "I'll check the deploy again in 5 seconds." (#120). Claude Code started
the waiter at that stop, as setup's entries say, so when the check comes due the hub hands the waiter its wake-up. This
stand-in starts no turn from a wake (`../3305/README.md`: How the continue comes to wait), so after the wake's grace
the record says the check waits for the next prompt or stop (`promise.due` with route `next_hook`); were it never
handed to the waiter, the record says the same at once. The test waits for that event and checks no prompt but the
first reached the model. The check is matched by its promise's token in the hub's words for it, `promise:<id>:`, which
only the check's own text carries.

**"Reaches the agent".** As #3305's suite counts it, over the whole run: every hook reply whose stdout carries the
item's words, except a prompt's reply that blocked the prompt (Claude Code drops that prompt). A waiter's wake is its
exit 2 with the text on stderr, which this stand-in starts no turn from, so it isn't counted. In #352's world the same
reading is each hook's `told` (what its reply told the agent), a blocked prompt left out. Counting over the whole run
makes a duplicate fail as well as a loss.

## Readings where the issue leaves a choice

1. "The next hook that reaches the agent" for the sibling notice is A's next hook after the lost prompt, here a prompt
   you type with no link. The test asserts the notice comes with that prompt and nowhere else.
2. The lost prompt reaches the model without the item: each test checks that deep-hook printed nothing carrying it
   (for the sibling, deep-hook was stopped before printing anything), and the stand-in logged a model line for it.
3. Where the item waits after the lost reply is the implementation's. The tests assert only that it comes with the
   next prompt, once.
4. What the record already says about the lost reply (`notice.delivered`, the note's `user.ask`, `promise.woken`) is
   out of the issue's scope; the tests show it in their failure messages and assert nothing about it.

## Base run

`BASE-FAILURE.txt` holds the run on `33075a35a` at a 1-minute load near 70 on 12 cores (other sessions' runs). Each
test fails at its count assertion with 0 replies carrying the item, naming it:

- `sibling.test.ts`: the notice by its ID and words; the record shows it `notice.delivered` via `UserPromptSubmit`, in
  the reply no one read.
- `note.test.ts`: the note by its words, request ID and `session.note` ID; the record shows the lost prompt took it
  (`user.ask` with its request).
- `promise.test.ts`: the check by its ID and quote; the record shows `promise.woken` via `next_prompt`, at the lost
  prompt. In the first run this file was BLOCKED by its own precondition under that load (deep-hook let the prompt
  through in 250 ms); its immediate rerun alone is the second run in the file, failing at the count.

`tsc` reports no errors.

## Files

- `helpers.ts`: the criteria's IDs, the note sent from the app, the forge that holds one issue read, and the deep-hook
  children of an agent process by PID.
- `sibling.test.ts`: `#3309.5263c09a`, 1 test.
- `note.test.ts`: `#3309.c730ec7c`, 1 test.
- `promise.test.ts`: `#3309.c1997961`, 1 test.
- `lane.json`: runs alone (real binaries, the plant timed against deep-hook's hold, and the held read's timing).
