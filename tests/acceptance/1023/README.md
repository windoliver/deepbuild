# Acceptance tests for #1023: a Codex CLI session ended with Ctrl-C is read as ended, with or without its SessionEnd

Written first, blind, from issue #1023 (its body as of November 8, 2026: What the record shows, Why it matters, the three
acceptance criteria, Proof), the design and base commit `f1e8736e` (main, "Merge pull request #1742"), by a job that never
saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to
a blind redraft of this job (design: Dogfooding).

What was read: `AGENTS.md`; `docs/technical-design.md`: What each agent gives us, and the limits we design around (the
Codex row: one shared app-server daemon since 0.157, identity from the payload, the daemon's process ID and start time
beside each SessionStart from R2), Hooks are evidence, not a state machine (Threads, not IDs: "An answer for a session that
has ended reaches only the same thread at SessionStart, a resume [...]; otherwise it waits on its task's line"; Unknown,
not finished), States people see, An ask, and your answer getting back (Tasks close themselves; the continue rules), How it
installs (process ownership); the issue's epic #5 and #39 (its AC7, the base's route for an ended Codex session's answer).
At the base: `packages/hub/src/{core,status,answers,plant,service,hub-command}.ts` (`goneSessions`, `bindSession`,
`waitsOnTask`, `hub.health`), `packages/record/src/projections.ts`, `adapters/codex-schemas/*.input.schema.json`,
`adapters/corpus/codex/0.160.0/tools`, and the suites `tests/acceptance/39` (helpers, `fixtures/daemon.mjs`), `992`,
`1546` and `1359` as models. #39's helpers are reused by import: temp homes, `deep hub run`, `deep setup`, `events.read`,
`deep inbox answer`, Codex threads, and its daemon stand-in.

## How to run

```sh
npm ci && npm run build --workspaces        # the CLI and the hub
cargo build --locked -p deep-hook            # the hook client (#39's helpers build it at load if it's missing)
npx tsc -p tests/acceptance/1023/tsconfig.json
npx vitest run --root tests/acceptance/1023 --no-file-parallelism
# by hand only, on the reference Mac (README: What stays BLOCKED):
DEEP_LIVE_1023=1 DEEP_LIVE_1023_SESSIONS=<id1>,<id2>,<id3> npx vitest run --root tests/acceptance/1023 live-ctrl-c.live.test.ts
```

Node 24. Temp folders are `/tmp/dh39-*` (#39's helpers; a socket path must fit in 104 bytes); `HOME` is a temp folder for
every process a test starts, so nothing reads or writes the real `~/.deepbuild` or `~/.codex`. Every process is stopped by
its PID. No test runs a live agent, spends plan usage or reaches the network. On the base the suite takes about six
minutes: each wait the criteria allow (60 s) runs out.

## The replay

- **The three ends** (`fixtures/ctrl-c-ends.json`) are reconstructed, not recorded: the session notes the issue cites
  aren't on this machine and the corpus holds no Ctrl-C end. Each payload is written from Codex 0.160.0's hook input
  schemas (`adapters/codex-schemas`) in the shapes of the corpus's 0.160.0 `tools` set. Each run is the turn the issue
  says the record ends on, SessionStart, UserPromptSubmit, one shell call (PreToolUse, PostToolUse) and Stop; run 2 then
  fires SessionEnd `{"reason": "other"}` (the schema's only reason), runs 1 and 3 nothing. Its process facts: each run's
  process ends by SIGINT after its last hook.
- **The Codex CLI process** is #39's daemon stand-in (`tests/acceptance/39/fixtures/daemon.mjs`), one per run, as one
  `codex --no-daemon` per terminal: every hook runs as its child (`deep-hook codex <event>`, the payload on stdin), and so
  does the run's one `deep mcp`, so the hub sees its PID as each hook's parent. Each session's identity is its payload's.
  **Ctrl-C** is SIGINT to that process by its PID; "its process ending" is that process's exit.
- **AC1** replays all three on one hub, each in its own process, and ends them in order, so a run still going is checked to
  stay open when another's process ends. **AC2** uses run 1 for `deep hub status` and run 3, with two `deep_ask`s in its
  turn before its Stop, for the answers. **AC3** uses run 1.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, white space collapsed
(`scripts/proof-change.mjs`, `criterionId`); `criteria.json` holds them. Each test's name starts with its ID.

| Criterion | Test | What it requires | A wrong program it fails |
|---|---|---|---|
| AC1 `#1023.f4fb4c83` | `ac1-three-ends.test.ts` | per session exactly one `session.end`; run 2's carries `reason: "other"`, its payload's, and its process's exit adds no second; runs 1 and 3 each get one after their process exits (log position past the log's end at the exit), not written as a hook's event, with a `session.reading` after the exit saying Codex fired no SessionEnd and the hub closed it from its process's exit, within 60 s; no session ends while its own process runs | the base (runs 1 and 3: no `session.end`, only `session.gone`); a hub that closes every Codex session when any process exits; one that adds an end to run 2; one that writes the end as if a hook had sent it |
| AC2 `#1023.6b9c173d` | `ac2-hub-status.test.ts` | run 1: `deep hub status` doesn't show the session closed while its process runs, and shows it closed within 60 s of its exit | the base (`deep hub status` prints `hub.health`, which lists no sessions); a status that shows every session closed |
| AC2 `#1023.6b9c173d` | `ac2-answer-by-task.test.ts` | run 3 with two asks open: one answered after its Stop while the session sits idle, before Ctrl-C, one answered after its process ended (once the record holds its end, or 60 s on); each gets `delivery.outcome` `{via: "on_task", outcome: "waiting"}` and none `delivered` | the base (an ended Codex session's answer waits on its task only after a hook's `session.end`, and only when answered after it) |
| AC3 `#1023.88d3d827` | `ac3-planted.test.ts` | the judge AC1 and AC2 use (`helpers.ts`, `judgeClosed`) passes the shipped hub on run 1, and fails a hub started with `DEEP_HUB_PLANT=leaves-codex-session-open`, every failure naming the session | the base (the shipped judge fails first; the plant is unknown, so the planted hub won't start) |
| AC1, AC2, live | `live-ctrl-c.live.test.ts` | by hand: three sessions ended with Ctrl-C in the real Codex CLI, read from your installed hub: each ends once, a SessionEnd's with `reason: "other"`, the rest closed by the hub with the reading, and shown closed in `deep hub status` | skips as BLOCKED unless run by hand |

## Assumed surfaces

The issue names `session.end`, "a reading", `deep hub status`, "closed", "goes by its task" and "a planted adapter", and
leaves their shapes open. Each pick below is the smallest next to an existing one; an implementation that differs
disputes through a blind redraft.

- **`deep hub status`** (#16: one JSON line, `hub.health`'s result) carries `sessions`, an array of objects each with the
  session's `id` and `closed`, a boolean; a session "shows closed" when its entry has `closed: true`. A session not listed
  doesn't show closed. (The base's `deep status` has no word for closed, and the design's States people see has none.)
- **The hub's end** of a session whose SessionEnd never fired is a `session.end` event under the session (`events.read`,
  its `session` field), appended after the process ended, whose `writer` isn't `hook`. Its `data.reason` isn't pinned.
- **The reading** is a `session.reading` under the session, appended after the process ended, whose `data.reading` names
  `SessionEnd`, the `process` (or `daemon`) and its exit (`exit`, `exited`, `ended`, `gone` or `closed`).
- **"Goes by its task, not by a resume"** is the base's record of it (#39 AC7, `answers.ts`, `waitsOnTask`): a
  `delivery.outcome` with `data.delivery` `ask:<id>`, `via: "on_task"`, `outcome: "waiting"`, and no `delivered`.
- **The plant** `leaves-codex-session-open`, selected by `DEEP_HUB_PLANT` and added to `Plant` and `PLANTS` in
  `packages/hub/src/plant.ts`: the hub as shipped, except that it records no end for a Codex session whose process exits
  without a SessionEnd and lists it in `deep hub status` as not closed.
- The hub watches the PID that each hook reports as its parent (the base's `meta.ppid`, `bindSession`), as it does for #992.

## What stays BLOCKED

- **The three live Ctrl-C ends** the Proof asks for: no real `codex` is installed here and the session notes the issue
  cites aren't on this machine. `live-ctrl-c.live.test.ts` skips as BLOCKED, never passes, until someone ends three
  sessions of a signed-in `codex --no-daemon` with DeepBuild's hooks trusted and runs it with their IDs. It reads the
  installed hub read-only and doesn't check the 60 s, which a by-hand run can't time. Whether Codex fires SessionEnd on
  SIGINT at all, which the issue says is the first thing to settle, is only settled by that run.
- The replayed payloads are reconstructed, so a field the real Ctrl-C ends carry and these don't is unseen.

## Ambiguities this job resolved (each a place a redraft may differ)

1. **"One `session.end` per session [...] or [...] closed by the hub"** is read as one `session.end` for every session:
   the payload's for run 2, the hub's for runs 1 and 3. A hub that closes the session some other way, such as the base's
   `session.gone` alone, fails AC1. `session.gone` beside the end is allowed.
2. **"The daemon's exit"**: the issue's runs were `--no-daemon`, so the process that ends is the CLI's own, the parent of
   its hooks; one process per session here. Several sessions on one shared daemon are not tested.
3. **"An answer waiting for it"** covers both an answer given while the idle session waits for its next message and one
   given after it closed. An answer given after it closed is given once the record holds its end, or 60 s after the exit.
4. **"Within one minute"** is measured from the stand-in's exit to the first `deep hub status` that shows it closed,
   polled once a second; AC1's record checks use the same 60 s.
5. The one-waiter and continue rules the issue's "Why it matters" names aren't criteria, and aren't tested.

## Registration

No `scripts/lanes.mjs` entry and no twins were added. The live file belongs in `byHand`; the other files take minutes
each and may belong in `alone`.

## Licenses

`fixtures/ctrl-c-ends.json` is written from openai/codex rust-v0.160.0's hook schemas (`adapters/codex-schemas`,
Apache-2.0, copyright OpenAI), which it doesn't copy.
