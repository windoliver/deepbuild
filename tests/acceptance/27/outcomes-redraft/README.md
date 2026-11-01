# Blind redraft of #27 AC4's Oct 9 cases: the four delivery outcomes, a waiter that outlives its session, a held stop

AC4 `#27.e6116d56`: "Fixtures show each ask, hold, check run and agent command reaching a recorded outcome by its
deadline", with the issue's "Added Oct 9" line: "Also cover: the four delivery outcomes in scripted sessions, a waiter
that outlives its session, and a stop held while a Claude subagent is still running. Done when: each case reports the
right outcome and none reads as finished." A fresh run of the blind acceptance-test job (AGENTS.md, Proof; design,
Dogfooding) for the cases `../outcomes.test.ts` held. It never looked at an implementation on another branch or
worktree. It replaces `../outcomes.test.ts` in `scripts/lanes.mjs`; that file is kept as written and runs by hand
only. The ask, hold, check-run and agent-command cases stay `../waits.test.ts`'s, which this redraft doesn't touch.

## What it read

- Issue #27 (the five criteria, Proof, the "Added Oct 9" and "Done when" lines), as the dispute quoted it.
- `docs/technical-design.md`: An ask, and your answer getting back (its sequence ends "confirm delivery from the
  transcript"; the four outcomes: "delivered and acknowledged, when the agent's next prompt or turn shows it; stalled;
  timed out; or the session was replaced. A timeout doesn't prove nothing arrived, so a retry reads the session
  first"); the hook protocol; the Claude Code row of What each agent gives us ("A Stop hold returns `decision: block`
  with the answer", "UserPromptSubmit and SessionStart add context as a fallback", "A waiter can outlive a headless
  session, so it watches its parent process", "Subagents fire the same hooks with an `agent_id`"); Hooks are evidence,
  not a state machine (Who is calling; Unknown, not finished; Threads, not IDs); How we know version 0 works
  (Dogfooding, Criteria to tests, Wrong programs).
- AGENTS.md, CONTRIBUTING.md; the base `a1707356` (origin/main): `packages/hub/src/{core,server,plant}.ts`,
  `crates/deep-hook`; `../` (README, helpers, `fixtures/claude.mjs`, `outcomes.test.ts`, `desktop-redraft/`,
  `twins.json`, `twins/`); `tests/acceptance/25/fallbacks/fixtures/claude.mjs`; `scripts/lanes.mjs`,
  `scripts/proof-runs.mjs`.

## The dispute

`../outcomes.test.ts`'s stand-in (`../fixtures/claude.mjs`) never writes a hook reply's `additionalContext` into the
transcript, which Claude Code does (an `attachment` entry of type `hook_additional_context`, as
`tests/acceptance/25/fallbacks/fixtures/claude.mjs` writes it), and its timed-out case reads `delivered` (length 1)
at once after the next prompt's reply, its replaced case at once after the new session's SessionStart reply, and its
subagent case at once after the held stop's reply. A hub that confirms delivery from the transcript, as the design
says, records `delivered` only once the transcript shows the answer, after the hook returns, and may read it at the
turn's next hook. So those cases can fail on a program that follows the design.

This redraft keeps every expectation and changes how sessions are driven and read:

- **The stand-in** (`fixtures/claude.mjs`) is `../fixtures/claude.mjs` with three changes, listed in its header: added
  context written into the transcript as Claude Code does, before the hook's answer returns; a held stop's reason as
  the user entry `Stop hook feedback:\n<reason>` (marked `isMeta`); a transcript it can't write to skipped, never a
  crash (the timed-out case makes one unreadable).
- **A turn ends with its Stop**, as a real session's does; the new session after `/clear` gets a typed prompt and a
  turn, since an idle session's next hook is the next prompt.
- **`delivered` is read with a bounded wait**, within 30 s of the turn that showed it, and read again 3 s later for
  "once".

## How to run

Node 24 first on `PATH` (or `fnm exec --using=24`), macOS, the Rust toolchain:

```sh
npm ci && npm run build --workspaces          # run the build twice if the first fails on ordering
cargo build --locked -q -p deep-hook
npx vitest run --root tests/acceptance/27/outcomes-redraft --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/27/outcomes-redraft/tsconfig.json
DEEP_HUB_PLANT=<plant> npx vitest run --root tests/acceptance/27/outcomes-redraft --no-file-parallelism   # a wrong program
```

Four tests, no model and no network: about 6-8 minutes. It uses `../helpers.ts` as it is (temp folders under
`/tmp/dh27-*`, `HOME` a temp home, only processes it started stopped, by PID, no secrets passed on), and `standin.ts`,
a copy of `../desktop-redraft-2/standin.ts` (from `../helpers.ts`'s `Claude` class and `beginAsk`) pointed at this
folder's stand-in, so a redraft of either folder never moves the other. Delete `node_modules/.vite/` here before
committing. On a badly loaded Mac a hook can miss the hub (#315): the subagent case then says `BLOCKED` (its stop
went through unheld), and a missed UserPromptSubmit fails "your next prompt carries it" showing an empty reply.
Rerun and keep `uptime` with the result.

## Readings

1. **Scripted sessions.** A real Claude Code can't be made to stall, time out or be replaced on cue, so each case runs
   on the stand-in. Delivered by a wake is AC1's (`../wake.test.ts`) and stalled AC3's (`../desktop-redraft-2/`).
2. **Timed out**: the waiter took the answer and exited 2, the app started no turn, and the session's transcript can't
   be read, so nothing proves whether a turn carried it: `timed_out` within 60 s, never `stalled` or `delivered`.
   Once it can be read ("a retry reads the session first"), the next prompt carries it, and once that turn shows it,
   it reads delivered, once, and never stalled.
3. **Replaced**: the waiter took the answer and exited 2, the app started no turn, and the session was cleared at once
   (SessionEnd reason `clear`, then SessionStart source `clear` with a new ID in the same process): `replaced` within
   30 s, never `stalled`; the new ID's SessionStart reply carries the answer (Threads, not IDs); its first prompt
   doesn't carry it again; once its turn ends, it reads delivered, once.
4. **A waiter that outlives its session**: an idle headless session's Claude Code is killed (no SessionEnd); its
   waiter's process group is gone within 10 s; your answer then reads no `delivered` for 30 s (nothing runs to take
   it and no turn shows it); the session isn't `finished`.
5. **A stop held while a Claude subagent still runs**: the subagent's PreToolUse and PostToolUse carry its `agent_id`
   on the parent's session before, during and after the parent's held stop. They don't end the hold; the session isn't
   `finished` during it; your answer continues the parent's held stop; no subagent hook reply carries it; the continued
   turn's Stop isn't sent back with it again; no wake carries it; it reads `delivered via stop_hold` within 30 s, and
   nothing else.
6. **"None reads as finished"**: each case checks its own outcome and never answered, delivered or `finished` where it
   isn't. A session whose answer was delivered and whose turn ended may read finished; the cases don't read that.
7. Every bound is the test's, as the design names none.

## Criteria to tests, and wrong programs

All four tests carry AC4's ID, `#27.e6116d56`. `../twins.json` maps it to `skip-default-at-deadline` (`../waits.test.ts`),
`waiter-outlives-session`, `answer-skips-held-stop` and, added by this redraft, `wake-assumed`, whose twin folder
already exists for AC3: no new twin folder is needed.

| Case | Wrong program | Fails at |
|---|---|---|
| timed out | `wake-assumed` (and the merged plant `delivered-on-waiter-exit`, the same code path): the waiter's hand-off recorded delivered | "its delivery must read timed_out within 60 s" |
| replaced | `wake-assumed` | "its delivery must read replaced" |
| waiter outlives its session | `waiter-outlives-session` (the twin also replaces `setup.ts`) | "its waiter … must not outlive it" |
| stop held while a subagent runs | `answer-skips-held-stop` | "must continue the parent's held stop" |

See `BASE-RESULTS.txt` for the runs. All four pass on the base `a1707356`, which already holds #27's implementation
(PR #816): the base is not their wrong program; the twins are.

## Files

- `outcomes.test.ts`: the four cases.
- `standin.ts`: the stand-in's client and the asking session (see How to run).
- `fixtures/claude.mjs`: the Claude Code stand-in (a copy of `../fixtures/claude.mjs` with the three changes above).
- `BASE-RESULTS.txt`: the runs on the base and on the wrong programs, with the load.
- `tsconfig.json`: the root options with `noEmit`.
