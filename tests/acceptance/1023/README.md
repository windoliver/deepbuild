# Acceptance tests for #1023: a Codex CLI session ended with Ctrl-C is read as ended

Written first, blind, by a job that never saw an implementation of #1023; none existed. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

The issue has three checkbox criteria, AC1 to AC3 in the body's order. Each test's name carries its criterion's ID
(`#1023.` and the first 8 hex digits of SHA-256 of the criterion's text, white space collapsed, as
`scripts/proof-change.mjs` reads it):

| AC | ID | File |
|---|---|---|
| AC1 | `#1023.f4fb4c83` | `ends.test.ts` |
| AC2 | `#1023.6b9c173d` | `ends.test.ts` (two tests: closed in time, the answer by its task) |
| AC3 | `#1023.88d3d827` | `plant.test.ts` (two tests) |
| Proof (live) | AC1, AC2 | `live.test.ts`, skipped unless run by hand |

## What was read

- Issue #1023 as of 2026-11-09: What the record shows, Why it matters, the three criteria, Proof.
- `docs/technical-design.md`: What each agent gives us, and the limits we design around (the Codex row; Hooks are
  evidence, not a state machine, with Threads, not IDs: an ended session's answer "waits on its task's line"), the
  Lease paragraph naming the core's `session.gone` (the holder's agent process gone by ID and start time with no
  SessionEnd), Dogfooding. `AGENTS.md` (Proof).
- At the base `6042ef5a` (main), for surfaces only: `packages/hub/src/service.ts` (`deep hub status` prints
  `hub.health` as one JSON line), `status.ts` (`status.read`'s states), `answers.ts` and the contracts'
  `delivery.outcome@2` (`via: on_task`, `outcome: waiting`), `session.end@1` (writer `hook`), `session.gone@1` and
  `session.reading@1` (writer `core`), `plant.ts` (`DEEP_HUB_PLANT`, an unknown name stops the hub),
  `packages/hub/test/gone-watch.test.ts` (an agent process is the hooks' parent, `ppid`), the corpus
  `adapters/corpus/codex/0.160.0/tools`, and the suites `tests/acceptance/39` (helpers, its AC7 on an ended session's
  answer) and `1024` (this suite's form).
- Imported by path, not copied: `../39/helpers.ts` (the temp home with its codex stand-in, the hub as a process,
  `deep setup`, the control calls, `deep inbox answer`, cleanup by PID) and `../39/fixtures/daemon.mjs` (run as each
  session's Codex process).

## The replay (`replay.ts`)

The issue's record (session notes `issue39-live-codex-*-2026-11-01.md`) isn't in the repo; the replay rebuilds its
three ends on real components: the built CLI's hub, the real `deep-hook`, `deep mcp`, `deep hub status`.

- **Each run's hooks and rollout** are the corpus recording `tools` (SessionStart, UserPromptSubmit, three tool calls,
  Stop), re-keyed per run: a fresh dashed UUID, the run's own folder, the rollout at Codex 0.160.0's path. The rollout's
  `session_meta` says `originator: codex_cli_rs`, `source: cli`, as the runs were in the Codex CLI.
- **The process facts.** Each run has its own Codex process, as `codex --no-daemon` does: a real node process running
  #39's daemon fixture, spawned with `argv[0]` the home's `codex` (so `ps` shows a codex command), the parent of every
  `deep-hook codex <event>` of its session and of its `deep mcp`. Ctrl-C is SIGINT to that PID; the process ends.
- **The runs**, all on one hub after `deep setup`:
  1. Run 1: the whole turn to Stop, then Ctrl-C. No SessionEnd.
  2. Run 2: the whole turn, then SessionEnd `{reason: "other"}` (no recorded payload has one: the SessionStart's fields
     with the event's name and the reason the issue shows), then Ctrl-C.
  3. Run 3: the turn's tool calls, then a `deep_ask` (its PreToolUse, then the call on the session's `deep mcp`) left
     waiting; the rollout ends at the last tool output. Ctrl-C mid-turn. No SessionEnd.
- **After Ctrl-C**: `deep hub status` every 2 s, for 60 s after the last process ended or until runs show closed. Then
  run 3's ask is answered (`deep inbox answer ask:<id> green`), and the record is read through `events.read`.
- **Preconditions** (BLOCKED, never a pass): the recording re-keys; every hook exits 0; `deep setup` and `deep hub
  status` exit 0; the record holds each run's `session.start`; run 3's `deep_ask` makes an `ask.created`.

## How each criterion is read

- **AC1** (`endRead`): each session has exactly one end on record, `session.end` or `session.gone`. Run 2's is its
  SessionEnd's `session.end` with `reason: "other"`. Runs 1 and 3's is the hub's (not written by a hook), and the
  session has a `session.reading` after the Ctrl-C whose text names the process, its exit or the missing SessionEnd
  (`/SessionEnd|process|exit/i`).
- **AC2, closed** (`closedInTime`): `deep hub status` before Ctrl-C doesn't show the session closed, and a poll within
  60 s of its process ending does: an object in its JSON naming the session (by `id` or `session`, dashed or not) with
  `state` or `status` `closed`, `ended`, `gone` or `exited`, or `closed: true` / `ended: true`. `finished` doesn't
  count: it is a stopped turn's state while the session lives.
- **AC2, by its task** (`byTask`): the answer to run 3's waiting ask is taken (`deep inbox answer` exits 0), and its
  `delivery.outcome`s say it waits on its task (`via` naming the task, `outcome: waiting`), with none delivered and
  none by another route (a resume's `next_prompt` among them).
- **AC3**: the same checks (`leftOpen`) must fail, naming the session ID in each message, (a) on a record whose
  session has only the turn's events and a `deep hub status` that never shows it closed, and (b) on a planted hub.

## The plant (AC3)

The base has no fitting plant. The planted test starts the hub with `DEEP_HUB_PLANT=codex-exit-leaves-session-open`
and replays run 1. **An implementation of #1023 registers that name** in `packages/hub/src/plant.ts`, as a hub that
reads a Codex session's process ending the way the issue's runs 1 and 3 were read: it records no end for the session
and shows it open. Until it does, the hub refuses to start with that name and the test fails BLOCKED. The plant must
make `leftOpen` fail; a plant that still closes the session fails the test.

## Run them

```sh
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
npm ci && npm run build --workspaces        # the hub and CLI run from packages/cli/dist/main.js
cargo build -p deep-hook                    # target/debug/deep-hook
npx vitest run tests/acceptance/1023 --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1023/tsconfig.json
```

Temp homes under `/tmp/dh39-*`, removed at the end; every process is stopped by its PID. No model is called.

## The live runs (the issue's Proof)

`live.test.ts` is skipped unless `DEEPBUILD_1023_LIVE_SESSIONS` names three sessions run by hand on the reference Mac:

1. With DeepBuild set up and your hub running, in a throwaway repo: `codex --no-daemon` (0.160.0), run one turn with a
   tool call, note the session ID (`/status`), and press Ctrl-C until Codex exits. Do this three times.
2. In one of them, ask Codex to call `deep_ask` with a choice and press Ctrl-C while it waits; once Codex has exited
   and the session shows closed, answer it: `deep inbox answer ask:<id> <option>`.
3. A minute after the last exit:
   `DEEPBUILD_1023_LIVE_SESSIONS=<id1>,<id2>,<id3> DEEPBUILD_1023_LIVE_ASK=ask:<id> npx vitest run tests/acceptance/1023/live.test.ts`

It reads your hub (`~/.deepbuild`) through `events.read` and `deep hub status` and changes nothing: AC1's check on each
session (a hook's `session.end` on record marks a run where Codex fired SessionEnd), AC2's closed state for each run
without one, and AC2's by-its-task on the named ask. The one-minute bound is checked only in the replay. This job has
never run it.

## What the base does

BASE-FAILURE.txt has the run. Four tests fail, one passes: the base records `session.gone` (#992) for runs 1 and 3
and run 2's one `session.end`, but no reading says the end was read from the process; `deep hub status` names no
session; the waiting answer has no `delivery.outcome`; the plant is unknown. The fabricated open record fails every
check, naming its session.

## Known limits

- Run 3 is ended mid-turn with its ask open, runs 1 and 2 after Stop; the issue doesn't say where each run's turn was.
- Codex's interrupt on the first Ctrl-C (an `Interrupt` hook) isn't replayed; the process just ends on SIGINT.
- The SessionEnd payload of run 2 is built, not recorded.
- The live run has never been run by this job.
