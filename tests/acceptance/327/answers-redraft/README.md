# Blind redraft of #327 AC2: the answer reaches the agent's next input, delivered once the turn shows it

AC2 `#327.da06e3b1`: "A taste call with options A, B and C, B recommended and drawn first, answered by a hardware
click on C, records option C in `ask.answered`, and the agent's next input holds C's ID and label, with
`delivery.outcome` delivered and acknowledged; a card that maps the click to the record's index delivers B and fails,
naming the option". A fresh run of the blind acceptance-test job (AGENTS.md, Proof; design, Dogfooding) for this one
criterion, at base `a1707356` (origin/main, "Merge pull request #914 …"). It never saw an implementation. It edits no
test outside this folder; the earlier #327 suite (`../`) is an input it imports from and doesn't change.

## What it read

- AGENTS.md, CONTRIBUTING.md; issue #327 (its Scope, Fields and sixteen criteria) and issue #906 (an answer recorded
  delivered when the hub writes its reply, not when a turn shows it).
- docs/technical-design.md: An ask, and your answer getting back (the diagram's "confirm delivery from the
  transcript"; "Each delivery ends in one of four outcomes: delivered and acknowledged, when the agent's next prompt or
  turn shows it"); the hook protocol; the Claude Code row of What each agent gives us (a Stop hold returns
  `decision: block` with the answer; `transcript_path`, "which can lag the live turn"); Hooks are evidence; How we know
  version 0 works (Dogfooding, Criteria to tests, Wrong programs); Decided; States people see.
- The base's packages/hub/src/core.ts (`deliver`, `stopHold`, `waitingFor`, `answerText`, `woken`), server.ts and
  plant.ts; packages/hub/src/claude-settings.ts (the entries setup writes).
- The earlier #327 folder: README, helpers.ts, answers.test.ts, card.rs and planted.rs (their AC2 cases), fixtures;
  #34's and #16's helpers it builds on; tests/acceptance/25/fallbacks (helpers.ts and fixtures/claude.mjs, the Claude
  Code stand-in that writes transcripts); tests/acceptance/27/desktop-redraft (how a redraft is laid out and laned).

## The dispute

The earlier `answers.test.ts` AC2 case sends a raw Stop hook over the hub's socket, reads the held Stop's reply and
at once expects `delivery.outcome` delivered. No agent turn ever shows the answer there: nothing writes it into a
transcript. By the design a delivery is "delivered and acknowledged, when the agent's next prompt or turn shows it",
so a hub that follows it records delivered only once the session's transcript shows the answer, and that test fails
on it; the base, which records delivered when it writes the reply, passes it (issue #906's wrong program).

## How to run

Node 24 first on `PATH`, macOS, the Rust toolchain:

```sh
npm ci && npm run build --workspaces
cargo build --locked -q -p deep-hook
node node_modules/vitest/vitest.mjs run --root tests/acceptance/327/answers-redraft --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/327/answers-redraft/tsconfig.json
```

Two tests, no model and no network, about 25 s. Each starts a real `deep hub run` under a fresh `/tmp/dh16-*` home
(#16's helpers; nothing touches `~/.deepbuild` or `~/.claude`), a Claude Code stand-in in it, and stops only the
processes it started, by PID. With `--root` here Vitest may write `node_modules/.vite/` in this folder; delete it
before committing. scripts/lanes.mjs runs this folder with the rest of `tests/acceptance/327/`, one file at a time.

## What it does

`ac2.test.ts`, through `helpers.ts`:

1. A temp home with Claude Code's user settings holding DeepBuild's entries as setup writes them
   (`'<deep-hook>' claude-code <Event>` for SessionStart, UserPromptSubmit, PreToolUse, PostToolUse and Stop, and the
   Stop's background waiter), written by hand because `deep setup` would reach the Mac's launchctl from a test home.
2. The taste call seeded in a session before the hub starts (the earlier suite's `seedInSessions`): options in the
   record's order A, C, B with IDs `a-amber`, `c-cobalt`, `b-bone` (IDs no label contains, so "C's ID" is judged
   apart from its label), B recommended and the default.
3. A real hub; the app's key paired with the OS confirmation stubbed (#34's `Confirmer`).
4. The session, run by the Claude Code stand-in (`fixtures/claude.mjs`): SessionStart, your typed prompt, the
   assistant's words, and its Stop with the ask open, every hook through deep-hook. The hub holds the Stop.
5. Your click on C, drawn third (B, the recommended, first; then A, C in the record's order): the card sends the
   option it maps the click to, signed by the app's key (`ask.answer`).
6. Judged, every failure collected as one line naming what failed:
   - `ask.answered` records `c-cobalt`, once;
   - until the session's transcript shows the answer, `delivery.outcome` never reads delivered (outcomes are read
     first, then the transcript, so a delivered read while the transcript lacks the answer came before the turn
     showed it);
   - the agent's next input, the first input entry in the transcript after the Stop that names the ask or any of its
     options (a user entry such as the Stop hook's "Stop hook feedback:\n<reason>", or a hook_additional_context
     attachment), holds `c-cobalt` and "C: cobalt header" and neither `b-bone` nor "B: bone header";
   - the session goes on as a real one would (an Edit's PreToolUse and PostToolUse, its words, the Stop that ends the
     turn), and `delivery.outcome` reads delivered within 30 s of the transcript showing the answer.

## Readings

1. **"The agent's next input"** is what Claude Code gives the model next, read where Claude Code writes it: the
   session's transcript. Claude Code writes a Stop hook's block reason as a user entry
   `{"type":"user","message":{"role":"user","content":"Stop hook feedback:\n<reason>"}}` and a hook's
   `additionalContext` as a `hook_additional_context` attachment; the stand-in writes both so (it is #25's). The test
   doesn't fix the route: any input entry after the Stop that carries the answer counts, so a hub that delivers by the
   stop hold, the next prompt's context or the waiter's wake is judged the same.
2. **"Delivered and acknowledged"** is the design's one outcome "when the agent's next prompt or turn shows it": the
   record reads delivered, and not before the session's transcript shows the answer. Recording delivered when the
   hub writes its reply is the wrong program #906 names.
3. **The lag.** The stand-in writes the entries a hook's reply becomes 2 s after the hook ends (`configure({lag})`,
   the copy's one change): the design says `transcript_path` "can lag the live turn". It holds open the moment
   between the hub's reply and the turn showing it, which "delivered and acknowledged" is judged across; without it
   the two land a few milliseconds apart and no read could tell them apart.
4. **The bound.** The design names none; the dispute's: delivered within 30 s once the transcript shows the answer,
   with the session firing its next hooks as a real one would.
5. **The card.** The click's mapping in the app is the earlier suite's `card.rs` (ac2_…) and `planted.rs`
   (`Planted::ClickByRecordIndex`); here the card is the two mappings the criterion names, as functions from the
   record's options, the recommended option and the drawn position clicked: the right card sends the drawn option's
   ID, the planted one the record's option at the clicked index.

## Criterion → test → wrong programs

| ID | Test | Wrong programs |
|---|---|---|
| `#327.da06e3b1` | `ac2.test.ts`: "a taste call (A, C, B in the record; B recommended, drawn first) answered by a click on C …" | the base (records delivered when it writes the Stop hold's reply: fails, naming the ask, "delivered … while … transcript doesn't show the answer yet"); the planted card that maps the click to the record's index ("wrong program: …", which passes only when that run fails naming `b-bone (B: bone header)`) |

This test is AC2's hub-side test in place of the earlier `answers.test.ts` AC2 case (see `../README.md`); the card
side stays `card.rs` and `planted.rs`. See BASE-RESULTS.txt for the run on the base.

## Copied or imported

- `fixtures/claude.mjs`: a copy of `tests/acceptance/25/fallbacks/fixtures/claude.mjs` (same repo, same license),
  with the lag above as its one change, marked in its header.
- `helpers.ts`: the stand-in's driver adapted from #25's fallbacks `Claude` class; it imports #16's helpers (temp
  folders, the child environment, deep-hook's path and build, owned PIDs).
- `ac2.test.ts` imports the earlier #327 helpers as they are (`seedInSessions`, `tasteAsk`, the hub, pairing,
  signing, `eventsAbout`, cleanup).
