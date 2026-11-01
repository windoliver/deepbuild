# Second blind redraft of #27 AC3: the desktop app wakes, or the fallback is a known limit

AC3 `#27.f8331d25`: "The desktop app wakes too, or the fallback is recorded as a known limit." A fresh run of the
blind acceptance-test job (AGENTS.md, Proof; design, Dogfooding) for this one criterion, with the same inputs. It
never looked at an implementation on another branch or worktree. It replaces `../desktop-redraft/` as AC3's test in
`scripts/lanes.mjs`; that folder and `../desktop.test.ts` are kept as written and run by hand only.

## What it read

- Issue #27 (the five criteria, Proof, the "Added Oct 9" and "Done when" lines), as the dispute quoted it.
- `docs/technical-design.md`: An ask, and your answer getting back (its sequence ends "confirm delivery from the
  transcript"; "Each delivery ends in one of four outcomes: delivered and acknowledged, when the agent's next prompt or
  turn shows it; stalled; timed out; or the session was replaced"); the hook protocol; the Claude Code row of What
  each agent gives us ("UserPromptSubmit and SessionStart add context as a fallback"; Known limits: "Waking from the
  desktop app is untested"); Hooks are evidence, not a state machine; How we know version 0 works (Dogfooding,
  Criteria to tests, Wrong programs).
- AGENTS.md, CONTRIBUTING.md; the base `a1707356` (origin/main): `packages/hub/src/{core,server,plant}.ts`,
  `crates/deep-hook`; `../` (README, helpers, `fixtures/claude.mjs`, `desktop-redraft/`, `outcomes.test.ts`,
  `twins.json`, `twins/`); `tests/acceptance/25/fallbacks/fixtures/claude.mjs`; `scripts/lanes.mjs`,
  `scripts/proof-runs.mjs`.

## The dispute

`../desktop-redraft/`'s stand-in (`../fixtures/claude.mjs`) never writes a hook reply's `additionalContext` into the
transcript, which Claude Code does (as an `attachment` entry of type `hook_additional_context`, as
`tests/acceptance/25/fallbacks/fixtures/claude.mjs` already writes it), and its step 2 reads `delivered` within 10 s of
the UserPromptSubmit reply with no turn after it. A hub that confirms a delivery from the transcript, as the design
says, records `delivered` only once the transcript shows the answer, which can only happen after the hook returns,
and may read it at the turn's next hook. So that test can fail on a program that follows the design.

This redraft keeps every expectation of AC3 and changes how the session is driven and read:

- **The stand-in** (`fixtures/claude.mjs`) is `../fixtures/claude.mjs` with three changes, listed in its header: the
  added context is written into the transcript as Claude Code does, before the hook's answer returns; a held stop's
  reason is the user entry `Stop hook feedback:\n<reason>` (marked `isMeta`, as 25/fallbacks' is); and a transcript it
  can't write to is skipped.
- **A turn ends with its Stop**, as a real session's does: after the prompt that carries an answer, the agent's
  words and the turn's Stop follow.
- **`delivered` is read with a bounded wait**: within 30 s of the turn that showed it, never at once after a hook.

## How to run

Node 24 first on `PATH` (or `fnm exec --using=24`), macOS, the Rust toolchain:

```sh
npm ci && npm run build --workspaces          # run the build twice if the first fails on ordering
cargo build --locked -q -p deep-hook
npx vitest run --root tests/acceptance/27/desktop-redraft-2 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/27/desktop-redraft-2/tsconfig.json
DEEP_HUB_PLANT=wake-assumed npx vitest run --root tests/acceptance/27/desktop-redraft-2 --no-file-parallelism   # a wrong program
```

One test, no model and no network: about 3-4 minutes, most of it two of the hub's 60 s stop holds. It uses `../helpers.ts`
as it is (temp folders under `/tmp/dh27-*`, `HOME` a temp home, only processes it started stopped, by PID, no secrets
passed on), and `standin.ts`, which copies `../helpers.ts`'s `Claude` class and `beginAsk` so they start this folder's
stand-in and stop the process groups it started. With `--root` here Vitest writes `node_modules/.vite/` in this
folder; delete it before committing.

**Machine load.** deep-hook acts alone when the hub doesn't acknowledge within its budget (#315). On a badly loaded Mac
a UserPromptSubmit can miss, and "must come with the session's next prompt" fails showing DeepBuild's entry exiting 0
with empty stdout: a load miss, not a reading on the program. Rerun it and keep `uptime` with the result.

## Readings

1. **The two branches.** Whether the desktop app wakes is `../MANUAL.md` (a person runs it). This test proves the
   second branch wherever an app doesn't wake: the stand-in with `configure({ wake: false })` reports the waiter's
   exit 2 and starts no turn.
2. **"The fallback"** is the route the design gives a session that can't be woken: the answer goes with the next
   prompt ("UserPromptSubmit and SessionStart add context as a fallback").
3. **"Recorded as a known limit"**, for the session in front of DeepBuild: the delivery the app didn't take reads
   `stalled`, never `delivered`; the record says, on the session, that it wasn't woken and the answer goes with its
   next prompt; the next prompt carries it once and it then reads delivered; and the limit is kept for the session:
   its next answer goes straight to its next prompt, never the waiter (the design: a route never seen working counts
   as absent). The design table's Known limits cell is what `../MANUAL.md` updates.
4. **Delivered** is read once the turn that carried the answer has shown it: the prompt's reply, Claude Code's
   transcript entry for it, the agent's words and the turn's Stop. The test waits up to 30 s from that Stop. It
   accepts a hub that records `delivered` earlier (the base records it as it replies); a hub that records it before
   anything shows it is a different criterion, not this one's.
5. **Bounds** are the test's, as the design names none: stalled within 60 s of the waiter's exit; a second answer not
   handed over within 15 s, and never in the test; delivered within 30 s of its turn; "once" read again 3 s after.
6. **A step's checks read only what it caused**: answers matched by the chosen option's label, which carries a fresh
   tag per ask (never the shared option ID `green` alone), waiter exits by time, record events past a mark taken just
   before the step.

## The test, step by step

`desktop.test.ts`, one test:

1. A session in a git repo asks through `deep_ask` and stops; the stop goes through and a waiter started at it is live
   (preconditions, else `BLOCKED`). You run `deep inbox answer <ask> green`. Preconditions: the waiter exits 2 with it;
   the app starts no turn. Checks: `stalled` within 60 s; a non-hook event on the session says it wasn't woken and the
   answer goes with the next prompt; no `delivered`.
2. You type a prompt. Checks: DeepBuild's UserPromptSubmit reply carries the first answer (precondition: Claude Code
   wrote it into the transcript); the turn's Stop isn't sent back with it again; `delivered` within 30 s of that Stop.
3. You type again (that prompt doesn't carry the first answer again); the agent asks again and stops; the stop goes
   through and a new waiter is live. You answer. Checks: no waiter exit carrying it within 15 s; no `stalled` or
   `delivered` for it before a prompt; your next prompt carries it and not the first; `delivered` within 30 s of that
   turn's Stop; 3 s on, each answer reads delivered exactly once, the second never went by a waiter and never read
   stalled.

## Criteria to tests, and wrong programs

| ID | Test | Wrong programs it fails on |
|---|---|---|
| AC3 `#27.f8331d25` | `desktop.test.ts` | `wake-assumed` (the twin `../twins/wake-assumed`, `../twins.json`): the waiter's hand-off recorded delivered, so no `stalled`, at "its delivery must read stalled within 60 s"; `delivered-on-waiter-exit` (merged plant, the same code path) at the same assertion; both run here. A hub that forgets the session's limit (offer() without `r.wakes === false`, the mutant `../desktop-redraft/` used) is meant to fail at step 3, "must not be handed to its waiter"; not run by this job |

The base passes (`BASE-RESULTS.txt`): it records `stalled` and the reading, carries the answer with the next prompt,
records `delivered` when it replies to that prompt (before the test's wait starts), and keeps the limit. The base is
not this criterion's wrong program; the twin is.

## Files

- `desktop.test.ts`: the test.
- `standin.ts`: the stand-in's client and the asking session, copied from `../helpers.ts` and pointed at this folder's
  stand-in; it imports the rest of `../helpers.ts` unchanged.
- `fixtures/claude.mjs`: the Claude Code stand-in (a copy of `../fixtures/claude.mjs` with the three changes above).
- `BASE-RESULTS.txt`: the run on the base and on the wrong program, with the load.
- `tsconfig.json`: the root options with `noEmit`.
