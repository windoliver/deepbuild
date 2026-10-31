# Blind redraft of #27 AC3: the desktop app wakes, or the fallback is a known limit

AC3 `#27.f8331d25`: "The desktop app wakes too, or the fallback is recorded as a known limit." A fresh run of the
blind acceptance-test job (AGENTS.md, Proof; design, Dogfooding), with the same inputs, for this one criterion. It
never saw an implementation of #27. It edits nothing outside this folder; the earlier suite (`../`, from `859bc29e`)
is an input it imports from and doesn't change.

## What it read

- Issue #27 as of October 29, 2026 (the five criteria, Proof, the "Added Oct 9" and "Done when" lines).
- `docs/technical-design.md`: Week 2; How we know version 0 works (Dogfooding, Hook edge cases); An ask, and your
  answer getting back (the four delivery outcomes, steer and interrupt); the extension API's paragraph on routes
  ("a flag never seen working counts as absent and delivery takes the next route, and what a session has shown
  resets only when it starts again"); the Claude Code row of What each agent gives us (Known limits: "Waking from
  the desktop app is untested"); Hooks are evidence, not a state machine.
- AGENTS.md, CONTRIBUTING.md; base `38b7a1a5`'s `packages/hub` (core, plant), `crates/deep-hook`,
  `scripts/agent-harness.mjs`; `tests/acceptance/25/**` (`fallbacks/desktop.test.ts`, `live/MANUAL.md`); the earlier
  #27 folder (README, helpers, `fixtures/claude.mjs`, `desktop.test.ts`, `MANUAL.md`, BASE-FAILURE).

## How to run

Node 24.22 first on `PATH`, macOS, the Rust toolchain:

```sh
npm ci && npm run build --workspaces
cargo build --locked -q -p deep-hook
npx vitest run --root tests/acceptance/27/desktop-redraft --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/27/desktop-redraft/tsconfig.json
DEEP_HUB_PLANT=wake-assumed npx vitest run --root tests/acceptance/27/desktop-redraft --no-file-parallelism   # a wrong program
```

One test, no model and no network: about 3 minutes, most of it two of the hub's 60 s stop holds. It uses the earlier
suite's helpers as they are: temp folders under `/tmp/dh27-*`, `HOME` a temp home, only processes it started stopped,
by PID, no secrets passed on. With `--root` here Vitest writes `node_modules/.vite/` in this folder; delete it before
committing.

**Machine load.** deep-hook acts alone when the hub doesn't acknowledge within its budget (#315). On a badly loaded Mac
a UserPromptSubmit can miss: the check "must come with the session's next prompt" then fails and its message shows
DeepBuild's entry exiting 0 with empty stdout. That is a load miss, not a reading on the program; rerun it and keep the
load (`uptime`) with the result. A missed Stop goes through unheld, which this test doesn't depend on.

## Readings

1. **The two branches.** Whether the desktop app wakes is the earlier suite's `MANUAL.md` (a person runs it; no harness
   drives the app). This test proves the second branch wherever an app doesn't wake: the stand-in with
   `configure({ wake: false })` reports the waiter's exit 2 and starts no turn.
2. **"The fallback"** is the route the design gives when a session can't be woken: the answer waits for the next
   prompt ("wake an idle session when it can, and otherwise wait for the next prompt"; UserPromptSubmit "adds context
   as a fallback").
3. **"Recorded as a known limit"**, for the session in front of DeepBuild, is three things the record and the routes
   must show:
   - the delivery the app didn't take reads `stalled` (one of the four outcomes) and never `delivered`, since no turn
     showed it;
   - the record says, on the session, that it wasn't woken and the answer goes with its next prompt;
   - the limit is kept for the session: its later answers take the next route at once, never the waiter again (the
     design: a route never seen working counts as absent, and what a session has shown resets only when it starts
     again). A limit recorded and then ignored isn't a known limit.

   The design table's own Known limits cell ("Waking from the desktop app is untested") is what `MANUAL.md` updates
   with what a person saw; a fast test can't decide it.
4. **The bounds** are the test's, as the design names none: stalled within 60 s of the waiter's exit (the hold's
   length); a second answer not handed over within 15 s, and never in the test; delivered within 10 s of the prompt
   that carried it.
5. **A wake or a reply from one step never satisfies or fails another's check.** Answers are matched by the chosen
   option's label, which carries a fresh tag per ask, or by the ask's handle with the option's ID on the same line;
   never by the bare option IDs `blue` and `green`, which every ask shares. Waiter exits are read from the time the
   step's answer was given, and record events past a log position marked just before the step.
   This is where the earlier `desktop.test.ts` goes wrong: its step 3 looks for a waiter exit carrying the second
   answer with `carries()`, which matches the bare ID `green`, so step 1's own exit (`… Green header efa8a046
   (green).`, naming the first ask) fails step 3 at the base. Its run at base `38b7a1a5` on Oct 29:

   ```
   AssertionError: AC3 #27.f8331d25 session 7dc8d118-… showed its app doesn't wake, a known limit: your answer to
   ask:01M64YZ4AAR72GP50M18TJZSCE must not be handed to its waiter again (it exited 2 with it): expected { pid: 41014, …(5) } to be undefined
   + Received: { "at": 1793315530999, "code": 2, "dropped": true, "pid": 41014, "session": "7dc8d118-…",
     "stderr": "DeepBuild delivers your answers:\nYour answer to ask:01M64YXHRFMVS0BD3KRYEWE4NB (…): Green header efa8a046 (green).\n" }
   ```

   The exit it shows names the first ask (`…YXHR…`), not the second (`…YZ4A…`).

## The test, step by step

`desktop.test.ts`, one test, `#27.f8331d25 in an app that doesn't wake, …`:

1. A session in a git repo asks through `deep_ask` (two header colours with a fresh tag) and stops; the stop goes
   through with nothing answered and a waiter started at that stop is live (preconditions, else `BLOCKED`). You run
   `deep inbox answer <ask> green`. Preconditions: the waiter exits 2 carrying that answer, and the app starts no turn.
   Checks: the ask's delivery reads `stalled` within 60 s; the record holds a non-hook event on the session saying it
   wasn't woken and the answer goes with the next prompt; no `delivered` before a prompt.
2. You type a prompt. Checks: DeepBuild's reply to that UserPromptSubmit carries the first answer; a `delivered`
   outcome for it is recorded after that prompt.
3. In the same turn the agent asks again (fresh tag) and stops; the stop goes through and a new waiter is live
   (preconditions). You answer. Checks: no waiter exit carrying the second answer within 15 s; no `stalled` and no
   `delivered` for it before a prompt; your next prompt carries the second answer and not the first again; the second
   reads delivered after that prompt; and, at the end, no waiter ever exited with it and it never read stalled.

## Wrong programs it fails on

See `BASE-FAILURE.txt` for the full output of each run. **The base `38b7a1a5` passes** (233 s at load 69-111 on 12
cores): it already records `stalled` and a reading, carries the answer at the next prompt, and keeps the limit for the
session. So the base isn't the wrong program here. These two are:

| Program | Fails at |
|---|---|
| `DEEP_HUB_PLANT=wake-assumed` (merged plant: the waiter's hand-off is recorded delivered) | step 1, "its delivery must read stalled" |
| scratch mutant of base `38b7a1a5`: `offer()` without `r.wakes === false` (the session's limit forgotten), built in `/tmp/dh27-mut-known-limit` by copying the checkout and editing only its built `packages/hub/dist/core.js`; nothing kept | step 3, "must not be handed to its waiter" |

## Files

- `desktop.test.ts`: the test; it imports `../helpers.ts` (and through it `../fixtures/claude.mjs`) unchanged.
- `BASE-FAILURE.txt`: the run at the base and the wrong programs' runs.
- `tsconfig.json`: the root options with `noEmit`.
