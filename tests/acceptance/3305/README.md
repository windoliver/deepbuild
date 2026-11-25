# Acceptance tests for #3305

Written blind, from issue #3305 (its Scope, two acceptance criteria and Proof), `docs/technical-design.md` (Hook
protocol, deep-hook and the hub; An ask, and your answer getting back), AGENTS.md, CONTRIBUTING.md and the base
commit `a8f65eefb` (head of PR #3303, which adds `Routes.notices` for #2669), read only to learn how to drive the hub.
Prior art read: `tests/acceptance/906/` (the planted late reply), `tests/acceptance/2669/` (the late-landing workspace
notice and how "reaches the agent" is counted), `tests/acceptance/85/` and `85/hub/` (automatic continues) and
`tests/acceptance/83/helpers.ts`. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to
a blind redraft by this job.

| Criterion | File | What it proves |
|---|---|---|
| `#3305.bc1fc765` | `continue.test.ts` | A transient stop's automatic continue, waiting for the session's next prompt, goes into a prompt reply deep-hook never read (the planted late reply). It reaches the agent exactly once over the run, with the next prompt that reaches the model. |
| `#3305.d2dd0332` | `notice.test.ts` | #2669's late-landing workspace notice goes into a prompt reply deep-hook never read. It reaches the agent exactly once over the run, with the next prompt that reaches the model. |

## Run

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.0/bin:$HOME/.cargo/bin:$PATH"
npm ci && npm run build --workspaces && cargo build --locked -p deep-hook
node node_modules/vitest/vitest.mjs run --root tests/acceptance/3305 --no-file-parallelism   # about 11 s
node node_modules/typescript/bin/tsc -p tests/acceptance/3305/tsconfig.json                    # type-check
```

With `--root` here, Vitest writes its cache to `tests/acceptance/3305/node_modules/.vite/`. Delete it before committing.

## What's real

The hub (`deep hub run`), `deep setup`, deep-hook as setup's entries run it, and `deep mcp` are all real. Claude Code
is #83's stand-in (`../83/fixtures/claude.mjs`) with its hook log, imported through `../83/helpers.ts`. #2669's
late-landing helpers come from `../2669/helpers.ts`. Every process gets HOME in its own temporary folder, made by #83's
`makeHome` under `/tmp/dh83-*`, so the hub's socket path fits macOS's 104 bytes. Processes are stopped by PID only.
Nothing touches the real `~/.deepbuild`, `~/.claude`, the Keychain or LaunchAgents.

## Defined here

**The lost reply.** This is #906's planted late reply (`tests/acceptance/906/README.md`, Defined here). The hub is
started with `DEEP_HUB_TEST_LATE_REPLY=<tmp>/late`. The test makes that file just before a prompt's `UserPromptSubmit`
and removes it once the hook has run. While the file exists, the hub writes its reply to that prompt 1 s past the 2 s
hold, after deep-hook has let the prompt through with nothing printed. The core still composes the reply at the usual
time, so the continue or notice goes into it then. This is the deterministic way to lose a reply, never machine load.
If deep-hook let the prompt through in under 1 s, the hold and the plant were never reached (the hub didn't
acknowledge in time, as on a loaded machine). The test then stops as BLOCKED, naming the load.

**"Reaches the agent".** As #2669's suite counts it: every hook reply in the hook log, over the whole run, whose stdout
carries the item's words. A prompt's reply that blocked the prompt doesn't count, since Claude Code drops that prompt.
Counting over the whole run makes a duplicate fail as well as a loss. The items' words are the hub's own:
`this is its one automatic continue` (the transient continue's text, #85) and `this session is outside any repo`
(#2669's notice).

**How the continue comes to wait.** The turn you typed ends with Claude Code's `StopFailure` (`error: server_error`).
The core reads that as a dropped connection the service owns and records `session.continued` with
`because: transient`. Claude Code starts the waiter at a StopFailure, as setup's entries say, and the hub hands it the
continue (exit 2, the text on stderr). This stand-in never starts a turn from a waiter's wake: the hook log shows no
model line after it, so the wake's text reaches no model and isn't counted. The hub's own rule then applies: a
continue a waiter took that no turn has shown goes with the session's next prompt (#85). The test also accepts the
other way a continue waits, parked with no route open, which the record states as a `session.reading`. It checks
that no prompt reached the model since the stop and that no reply carried the continue before the lost prompt.

**The next prompt that reaches the model.** A work prompt you type after the lost one, never a status question. It
must reach the model (a model line in the hook log) and carry the item, and no other reply may.

## Readings where the issue leaves a choice

1. The lost prompt is a prompt you typed that reaches the model without the item. Each test checks this as a
   precondition: deep-hook printed nothing carrying the item, and the stand-in logged a model line for the prompt.
2. "Exactly once" is read over every hook reply of the session in the run, from its start to the next prompt.
3. Where the item goes after the lost reply is left to the implementation. The test asserts only that it comes with
   the next prompt that reaches the model, once.

## Checked by hand, not in the suite

The run was repeated with the plant switched off by a temporary edit, then reverted. Each test then stopped at its
precondition: the reply deep-hook printed for the "lost" prompt carried the continue, and in the other test the
notice. So on the base the item really goes into the reply the plant makes deep-hook miss. A test that passes on the
base can't sit in this suite, so this control isn't one of its tests.

## Base run

`BASE-FAILURE.txt` holds the run on `a8f65eefb`. Both tests fail at their count assertion with 0 replies carrying the
item, each message naming it (the continue by its words and its `session.continued` ID, the notice by its words).
`tsc` reports no errors.

## Files

- `helpers.ts`: the criteria's IDs, the hub with the plant named, the lost prompt, a usual typed prompt and the count.
- `continue.test.ts`: `#3305.bc1fc765`, 1 test.
- `notice.test.ts`: `#3305.d2dd0332`, 1 test.
- `lane.json`: runs alone (binaries and the plant's timing against deep-hook's hold).
