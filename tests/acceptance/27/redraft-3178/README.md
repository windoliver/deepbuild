# Blind redraft of #27 AC2 and AC4, for #3178: a question that waits on you

A fresh run of the blind acceptance-test job (AGENTS.md, Proof; design, Dogfooding) for these of #27's criteria, as
the issue states them:

- AC2 `#27.6e863673`: "The repeated question is answered by the resolver and appears under decided for you"
- AC4 `#27.e6116d56`: "Fixtures show each ask, hold, check run and agent command reaching a recorded outcome by its
  deadline": the ask, the hold, the check run and the agent command.

It never looked at an implementation on another branch or worktree. `repeat.test.ts` stands in for `../repeat.test.ts`
(AC2) and `waits.test.ts` for `../waits.test.ts` (AC4), whose fixtures ask a provisional question (The dispute).
AC3 `#27.f8331d25` stays `../desktop-redraft-2/`'s, which passes on the base and stands in for it; an AC3 test this
folder once held duplicated it and was removed (BASE-RESULTS.txt). The Oct 9 cases stay `../outcomes-redraft/`'s.

## What it read

- Issue #27's body (Scope, the five criteria, Proof, References, Depends on, "Added Oct 9", "Done when"); no comments.
- `docs/technical-design.md`: An ask, and your answer getting back (Every ask ends, Asks stay current, the four
  delivery outcomes); the ask's shape ("With a provisional ask, work goes on with the recommended option, and only
  steps that leave the machine wait"); "A question holds the send-back" ("a taste call or choice that isn't
  provisional leaves the agent waiting on you"); the Claude Code row of What each agent gives us; Hooks are evidence,
  not a state machine; How we know version 0 works (Dogfooding, Criteria to tests, Wrong programs).
- AGENTS.md; the base `37dd3c0c` (origin/main): `packages/hub/src/mcp-operations.ts` (`askFor`, `waitFor`),
  `packages/hub/src/plant.ts`, `answer-delivery.ts` (`releases`), `core.ts` (the asks tick), `crates/deep-hook`
  (`hub_plant`), `crates/deep-hook/Cargo.toml` (`env-plants`); `../` (README, `helpers.ts`, `repeat.test.ts`,
  `waits.test.ts`, `twins.json`, `twins/`), `../outcomes-redraft/` and `../desktop-redraft-2/` (READMEs, tests,
  `standin.ts`, `fixtures/claude.mjs`).

## The dispute

Every earlier fixture asks through `../helpers.ts`'s `question()`, a choice with `recommended: 'blue'`. At the base a
taste call or a choice with a recommendation is provisional (#84, the design's ask shape): `deep_ask` answers at once
`{status: "provisional", answer: "blue"}` and work goes on with blue, and no stop is held for it ("a choice that isn't
provisional leaves the agent waiting on you"). So the earlier tests no longer reach the world the issue names, a
"headless Claude Code session goes idle with a question": A's deep_ask never hears your answer, a stop held "for an
open ask" isn't held, an idle session isn't waiting on you. The fault is the fixture's question, not the program.

This redraft keeps every expectation and changes one thing: the sessions ask a choice with **no recommendation**
(`world.ts`, `waitingQuestion()`), which the design and the base keep waiting on you, its first option the default at
its deadline. Each file checks that as a precondition (`deep_ask` says `waiting`, or, for AC2's A, comes back with
your answer), so a hub that made it provisional again would read BLOCKED or fail the precondition, not pass.

### The check run: two more things the earlier fixture missed, neither of them the question

`../waits.test.ts`'s check run reads BLOCKED at this base, "the check run to start" within 60 s. Running it here showed
why, in two steps (BASE-RESULTS.txt), and neither is the question:

1. **The repo isn't trusted.** `deep_run` refuses with `unconfirmed`: "isn't a project you trust, so forever didn't
   run: its spec checks run only once you trust it, by your answer in the app or by Claude Code's or Codex's own trust
   of it" (#322, `mcp-operations.ts`, `stop-judging.ts` `projectTrusted`). So no `run.started` is ever recorded. This
   redraft trusts the repo the way Claude Code does, `projects[<repo>].hasTrustDialogAccepted: true` in the temp
   home's `~/.claude.json` (a file Claude Code owns, so a boundary DeepBuild doesn't).
2. **`sh -c 'sleep 600'` is an untraced program.** Once trusted, that run ends at once as `uncounted` ("untraced
   program sh", `packages/checks-command/src/shell.ts`), never reaching its deadline. The check is now a Node program
   that never ends, `node -e 'setTimeout(() => {}, 600000)' <marker>`, which the tracers see into. The run then
   reaches `overran` by its 1-minute deadline and its processes are gone.

The agent command passes as brought over. The first 1.5 s run of it is started by the test, not by the stand-in,
because `../outcomes-redraft/`'s `Claude` has no `exec`. The hub reads the call's time from its hooks.

## How to run

From the clone root, Node 24 first on `PATH`, macOS, built (`npm ci`, `npm run build --workspaces`,
`cargo build --locked -p deep-hook`):

```sh
npx vitest run tests/acceptance/27/redraft-3178/repeat.test.ts --reporter=verbose     # ~5 s
npx vitest run tests/acceptance/27/redraft-3178/waits.test.ts --reporter=verbose      # ~5 min: two 1 min deadlines, a 60 s hold
npx tsc --noEmit -p tests/acceptance/27/redraft-3178
DEEP_HUB_PLANT=<plant> npx vitest run tests/acceptance/27/redraft-3178/<file> --reporter=verbose   # a planted wrong program
bash tests/acceptance/27/redraft-3178/mutants.sh <built checkout> <scratch> <hold-end-unrecorded|run-without-deadline|overrun-dropped>   # ~5-10 min each
```

One file at a time (each starts hubs). No model, no network. `world.ts`'s `setupHome` runs `deep setup` and never
builds: unlike `../helpers.ts`'s `setup`, it doesn't run `cargo build --features env-plants`, and it says BLOCKED if a
deep-hook an entry names is missing. All four plants these files are run on are read by the hub (TypeScript), so
`DEEP_HUB_PLANT` at the base is the same program as laying the twin's `plant.ts` over a copy; a deep-hook-side plant
(`waiter-outlives-session`'s waiter part) needs an `env-plants` build and isn't what these files test. The three
cases no plant reaches (the unanswered hold, the check run, the agent command) have a one-line mutant each of the
hub's built dist in `mutants.sh`, which clones the checkout (`cp -cR`, APFS), checks its text is found exactly once and
changed, keeps the diff, and runs `waits.test.ts` in the clone. Temp folders,
`HOME`, PIDs and secrets as `../helpers.ts` keeps them (`/tmp/dh27-*`, a temp home, only processes started here
stopped, by PID, no billing key or `DEEP_*` passed on except a `DEEP_HUB_PLANT` you set). Machine load: deep-hook acts
alone when the hub misses its 50 ms (#315); a stop that went through unheld then reads BLOCKED or fails the "held"
precondition. Rerun alone and keep `uptime` with the result.

## The surface and what the implementation must provide

The hub (`deep hub run`) and its socket (`events.read`, `inbox.read`), `deep setup`'s entries in
`~/.claude/settings.json` (the Stop hold, the waiter), the session's own `deep mcp` and its `deep_ask` (kind `choice`,
`recommended: null`, `subject {point}` for AC2), `deep inbox answer <ask> <option>` and `deep inbox`, your settings'
`asks.deadline`, and the record (`ask.created`, `ask.defaulted`, `ask.answered`, `ask.batched`, `decision.created`,
`decision.applied`, `delivery.outcome@1`, `session.attention`). Nothing new: all of it is merged at the base.

## The fixture

`../outcomes-redraft/`'s Claude Code stand-in (`standin.ts`'s `Claude`, its `fixtures/claude.mjs`: it runs each hook
entry of the user settings as Claude Code does, writes a hook's added context and a held stop's feedback into the
transcript, and with `configure({ wake: false })` is an app that starts no turn when the waiter exits 2). Each test
makes a git repo with one commit; its sessions work there. `world.ts`: the waiting question, `setupHome`, and
`beginAsk` (SessionStart, a typed prompt, `deep_ask` with PreToolUse/PostToolUse and its transcript entries).

## Criteria to tests

| ID | Test | Fails when | Wrong program, and where it fails |
|---|---|---|---|
| AC2 `#27.6e863673` | `repeat.test.ts` (the repeat asked as A asked it) | B's deep_ask doesn't come back with green within 10 s; not one `decision.applied` by the core citing your saved decision; a batch names B's ask; its inbox row isn't closed `decided_for_you` naming the decision; `deep inbox` lists it as open, or not under "decided for you" naming the decision | `repeat-reaches-you`: "B's deep_ask must come back with green" (it waited 40 s and said `waiting`) |
| AC2 `#27.6e863673` | `repeat.test.ts` (the repeat asked with blue recommended) | the same as the row above: B's deep_ask must still come back with your green, at once, decided for you | the base itself: B's deep_ask replies `provisional`, "Go on with Blue header …", at "must be answered from your saved decision" (BASE-RESULTS.txt); `repeat-reaches-you` |
| AC4 `#27.e6116d56` | `waits.test.ts` (ask) | no `ask.defaulted` by the deadline + 5 s, its default not blue, an `ask.answered`, or its row not `defaulted` | `skip-default-at-deadline`: "must reach its default by its deadline" |
| AC4 `#27.e6116d56` | `waits.test.ts` (hold, nobody answers) | the stop isn't let through by 60 s + 5 s; no non-hook event on the session naming the hold and the ask by then; the session reads `finished` | mutant `hold-end-unrecorded` (`mutants.sh`: the hold that ran out records no reading, `stop-judging.js`): "the record must say how it ended" |
| AC4 `#27.e6116d56` | `waits.test.ts` (hold, you answer) | the held stop isn't continued with your answer by the hold's end; the continued turn's stop is sent back with it again; the outcomes aren't exactly `delivered via stop_hold`; a waiter wakes with it | `answer-skips-held-stop`: "must continue the held stop" |
| AC4 `#27.e6116d56` | `waits.test.ts` (check run) | no `run.finished` by `run.started` + 1 min + 10 s; its outcome isn't `overran`; a process of the run is left | mutant `run-without-deadline` (`mutants.sh`: deep_run starts the run with `deadline_ms: null`, `mcp-operations.js`): "must reach a recorded outcome by its deadline … no run.finished" |
| AC4 `#27.e6116d56` | `waits.test.ts` (agent command) | within 5 minutes of the call's start, no non-hook event naming its `tool_use_id` that says it overran; the session reads `finished` | mutant `overrun-dropped` (`mutants.sh`: the core worker drops the `overrun` op, `core-worker.js`): "the record must hold its overrun, naming the call", 300 s on |

## Readings and assumptions

1. **"Goes idle with a question"** is a question that waits on you: a choice with no recommendation. A provisional
   ask goes on with its recommendation and isn't waiting on you (The dispute).
2. **AC2**: the repeat is the same kind, words, options and `subject.point`, in a new session of its own Claude Code
   in the same repo, after A ended. "Answered by the resolver": B's deep_ask carries the answer within 10 s (its own
   wait for you is 40 s), the core's `decision.applied` cites the decision, no `ask.batched` names it. "Under decided
   for you": `../helpers.ts`'s `decidedLine` (its line says so, or the nearest heading above it does).
3. **A repeat asked with a recommendation** is still the same question (kind, words, options, subject; the
   recommendation is the agent's). The design's sequence under "An ask, and your answer getting back" has the core
   try saved decisions and rules first and deliver that answer, "logged as decided for you", before anything goes on
   provisionally. So B gets green, never "go on with blue". The base replies `provisional` with blue: this test fails
   on the base, and the implementation must change `askFor` (`mcp-operations.ts`) to answer from the decision first.
4. **AC4 ask**: every kind's deadline 1 minute in your settings; defaulted by the deadline + 5 s (the hub's tick); the
   default is the first option, as the base gives a question with no recommendation.
5. **AC4 check run and agent command**: as `../README.md`'s Readings 4 (a `deadline: 1m` key in `done.yaml`; 5
   minutes as the bound for a command that last took 1.5 s), plus the repo trusted in Claude Code and a Node program
   for the check (above).
6. **AC4 hold**: the hold's deadline is its 60 s. Unanswered, it ends by then with its end recorded; answered within
   it, the held stop carries the answer and that's its outcome, `delivered via stop_hold`, read within 30 s of the
   continued turn's Stop and again 3 s on ("once").
7. Bounds are the tests', as the design names none.

## Files

- `repeat.test.ts` (AC2), `waits.test.ts` (AC4: ask, two holds, check run, agent command).
- `world.ts`: the waiting question, `setupHome`, `beginAsk`.
- `mutants.sh`: the three one-line mutants of the hub's built dist (README: Criteria to tests), each laid over an
  APFS clone of a built checkout and `waits.test.ts` run there: `bash mutants.sh <built checkout> <scratch> <mutant>`.
- `BASE-RESULTS.txt`: the runs at the base and on each wrong program, with the load.
- `tsconfig.json`: the root options with `noEmit`, as the sibling redrafts'.
