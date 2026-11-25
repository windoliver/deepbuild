# Acceptance tests for #3390: a plug-in action a saved decision covers runs or is declined, and a send is never covered

Written first, blind, by a job that never saw an implementation of #3390: no other branch, commit, worktree, pull request,
transcript or note. It read:

- issue #3390 as of November 24, 2026: its body, Scope and 8 checkbox criteria
- `AGENTS.md`
- `docs/technical-design.md`, the sections the issue links (`node scripts/design-section.mjs --issue 3390`): Building
  blocks (the Action and Send rows), Blocks for plug-ins that do real work (Send), An ask, and your answer getting back;
  and Dogfooding
- the base, commit `550fa914263d6dc018ae9a223e725dbf7f609fce` (main): `packages/hub/src` (`mcp-operations.ts`,
  `holds.ts`, `human-answers.ts`, `hub-control.ts`, `trusted-actions.ts`, `session-state.ts`, `mcp.ts`, `inbox.ts`,
  `paths.ts`, `server.ts`, `hookmap.ts`), `packages/asks/src`, `packages/resolver-decisions/src`,
  `packages/extension-host/src/host.ts` (`callAction`), `packages/record/src/projections.ts`,
  `packages/contracts`' manifest schema, `scripts/proof-change.mjs` (criterion IDs), `scripts/wait-ratchet.mjs`
- `tests/acceptance/363`, `tests/acceptance/2072` and `tests/acceptance/26/outage.test.ts`, for their conventions

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## Requirement to test

The IDs are `scripts/proof-change.mjs`'s `criterionId` (the first 8 hex of the SHA-256 of the criterion's text after
`- [ ] `, white space collapsed), computed from the live issue body. Each `describe` starts with the number and the tag;
each `it` starts with the number.

| ID | Criterion (short) | Test | The wrong program it names, and what fails on it |
|---|---|---|---|
| AC1 `#3390.69999517` | after a yes, a second call of the change runs on its first try, its one ask decided for you | `saved.test.ts` | reads only an answer of your own: the second call isn't `done`, named with its request and input |
| AC2 `#3390.a14577e2` | after a no, a second call is `declined` with its ask, decided for you, nothing entered | `saved.test.ts` | reads only an answer of your own: the second call isn't `declined`, named |
| AC3 `#3390.0ff85ad5` | another change action of the plug-in is held by an ask that stays open, runs on your yes to it | `saved.test.ts` (the desk plug-in) | keys a change by its plug-in alone: `ext.desk.retire_symbol`'s ask is decided for you, named |
| AC4 `#3390.78c40059` | a second send, same input and another, is held by its own open ask, runs once on your yes; no decision is saved from a send; its card; `saveDecision` refused | `sends.test.ts` (2) | lets a saved decision answer a send: the second send's ask is decided for you, named; a decision names the send's ask |
| AC5 `#3390.d4dd7cfe` | two sends held at once keep two open asks, none superseded; each runs on its own yes | `sends.test.ts` (2: other inputs and the older first, the same input and the newer first) | keys a send by its plug-in alone: the first send's ask isn't open, its call named |
| AC6 `#3390.51839cb2` | the older of two changes waits on the newer ask, raising none; after the yes it runs, its ask decided for you | `superseded.test.ts` | reads the superseded ask: the older call is held by it, and isn't `done` after the yes, named |
| AC7 `#3390.c9e68b9b` | your yes, a restart, the same request: a change runs once, a send runs once with no second ask; after a second restart its result, nothing again, no open ask | `restart.test.ts` (2) | forgets the send's ask at the restart: a second `ask.created`, the send named |
| AC8 `#3390.b1f77607` | a call held in one session is decided by your yes in another; overruled before its retry, it enters nothing and asks again | `overruled.test.ts` (2) | reads the decision without the overrule: an `action.entered` for the call, named |

12 tests. The wrong program of AC1 to AC6 is the base itself. AC7's and AC8's go further than the base: AC7's send
test counts the session's `ask.created`, so a program that saves nothing from a send and still forgets its ask fails at
the count, the send named; AC8's overruled test asserts first that nothing entered, so a program that reads the decision
its ask closed on and never the overrule fails there, the call named.

To check the suite against more than the base, this job ran it, through the throttle, on a throwaway program of its own: the
base's packages in a scratch folder, changed just enough (a change keyed by its action, a send by its request and saved as
no decision, `call_action` reading the decision or the newer ask that closed its ask, a send's ask found again by its
request). It isn't kept and is no reference. All 12 tests passed on it, so they can pass, and with one part undone each
named wrong program failed its own test at the assertion above while the file's other tests passed:

| Undone | Failed | At |
|---|---|---|
| a change keyed by its plug-in alone | AC3 | "the call of ext.desk.retire_symbol … is held by an ask": it was `done` |
| the send's ask forgotten at a restart | AC7, the send | "the call of ext.stocks.send_digest …, the only call of the session that asks, asks once": a second `ask.created` |
| the decision read without the overrule | AC8, overruled | "the call of ext.stocks.set_alert … enters nothing once decision:… is overruled": its input entered |

## The surfaces under test

- A real hub, `deep hub run` (`packages/cli/dist/main.js`), in a temp home, with `DEEP_HUB_TEST_CONFIRM` standing for the
  OS confirming you, as #363's `hub.ts` starts it; plug-ins installed with `deep install`; a git repo of its own the
  sessions work in, so an answer is saved as `repo:<project>`.
- An agent stand-in (#363's `fixtures/agent.mjs`) with its own hooks and its own `deep-actions` server (`deep mcp
  actions`), both its children: `call_action` with an action, a request ID and the input's JSON text, and its reply's
  `status` (`done`, `held`, `declined`), `ask` and `report`. AC8 has two stand-ins in one repo.
- The person: `deep inbox answer <ask> approve|decline`, and `decision.overrule` and `ask.card` on the hub's socket as the
  cli role holding the control token.
- The record, read with `events.read`: `ask.created`, `ask.superseded`, `ask.answered`, `decision.created`,
  `decision.applied`, `decision.overruled` and `action.entered`; the inbox (`inbox.read`): a row's `closed_at`, `outcome`
  and `decision`; and what ran, the plug-in's own `runs` read.
- AC4's refusal: the asks core's public entry (`openAsks`, `AskRefused`, `saveDecision`) on the stopped hub's own record.

`world.ts` holds these. From #363 it reuses the stand-in, its session, the plug-in copier, temp folders and IDs; it adds a
hub that is stopped and started again on the same home, a second session, the socket's other methods and the desk
plug-in. No hub or CLI module is imported.

Fixtures: #363's stocks plug-in (`set_alert`, a change; `send_digest`, a send; `runs`, a read) for every criterion but AC3,
which needs two change actions of one plug-in: `fixtures/desk` (`pin_symbol` and `retire_symbol`, alike but for the name).

## Readings this job picked

- **Nothing ran.** Read from the record first: no `action.entered` for the request. Where a hub process held the plug-in
  throughout, its `runs` counts agree.
- **"Its one ask" (AC1, AC2).** The asks the session raised after your answer: exactly one. `decision.applied` events on
  the record are exactly that ask with the decision saved from your answer.
- **"Stays open" (AC3 to AC5, AC8).** The inbox has the ask open and no `decision.applied` names it, at once and again
  after the hub served another call of the session; in AC3 to AC5 it then still takes your yes. No fixed wait is used.
- **A session in a git repo.** The repo has no remote; the session's project is the repo's folder, and the decision saved
  from your answer is checked to be at `repo:` before anything is asked of it (a setup check, `BLOCKED` when it isn't).
- **AC3.** The other action gets the very same input, so only the action's name tells the two calls apart.
- **AC4's card and `saveDecision`.** Two sends are open at once when their cards are read, so `also` counts another open
  send if a program counts one. One is answered no and one yes; `saveDecision` is tried at each scope (`session`, `repo`,
  `all`) and must reject with the asks core's `AskRefused`; its words are the implementation's. A control in the same
  record: a change's answered ask is still saved.
- **AC5.** Both input cases of AC4 are used, and both orders of the two yeses.
- **AC6, "its ask".** The ask the saved decision decided for the older call may be the one it raised first or one raised
  after the yes, in its session. There is exactly one `decision.applied`, naming the decision saved from that yes. The
  newer call then runs on your own yes (a control).
- **AC7, "returns a result".** Read as the call's own outcome, `done`: a reply that is held, declined, failed or refused is
  no result. Whether it carries the first call's output isn't asserted. A change may raise another ask that a decision
  closes at once; a send may raise none. After the first restart the send is called again twice, with no second effect.
- **"Never asks twice" (Scope).** Read as never asking you twice. AC6's older call, whose own ask closed as superseded,
  has to raise another for a decision to decide; that one closes at once and waits for no one. AC8's call asks again only
  once the decision that had decided it is overruled.
- **AC7, the restart.** SIGTERM to the hub, by the handle it was started with, then `deep hub run` on the same home. The
  agent and its MCP servers run on; the agent's next hook makes its session known to the new hub, as a real agent's does
  before its next tool call, and the plug-ins are offered again before the retry.
- **AC8.** The held call is A's, the older ask; your yes is to B's, whose input differs. Two authority asks of two threads
  are two asks, so neither supersedes the other. The overrule is `decision.overrule`, which takes the decision out of
  force and saves none in its place, so the retry's new ask stays open. (Overruling through a card's own overrule saves
  your other option, which would then answer the new ask; that isn't what the criterion says.)
- **The PreToolUse before a call.** Sent as an agent's hook sends one, with the tool named as the hub stamps its own tools
  (`mcp__deep__call_action`), so a call binds to its session by process and, if a loaded machine didn't name the process
  in time, by that stamp. It records a `tool.before` and nothing else.
- **A connection the hub didn't answer.** `deep mcp` gives a connection 1 s. A call it says never reached the hub is made
  again; no other error is.

Not covered: the Scope's "revoke" (the hub's surfaces have an overrule only; a revoke is the asks core's, and reads the
same), the app's question card beyond `ask.card`'s document, and a decision at another scope than the repo's.

## How to run

On macOS, with the repo's Node (24):

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the tests run the built CLI, packages/cli/dist/main.js
cargo build --locked -p deep-hook        # the hub won't start without target/debug/deep-hook or target/release/deep-hook
node scripts/throttle.mjs test --wait 600 -- node node_modules/vitest/vitest.mjs run --root tests/acceptance/3390 --no-file-parallelism --testTimeout=600000 --reporter=verbose
node node_modules/typescript/bin/tsc -p tests/acceptance/3390/tsconfig.json
```

Each test starts a hub and installs its plug-ins; `lane.json` runs the folder alone, as #363's is, since the supervisor
reads the system's one log stream. Temp folders are under `/tmp/dh363-*` (#363's `tempDir`), real paths, removed after
their file; HOME is the test's own for every process; git runs with no variable of the caller's; a hub is stopped through
the handle it was started with, and the stand-ins by their PIDs (#363's `hub.ts`), never by name or port. No network.

`BASE-FAILURE.txt` is the one reading on the base. Its built packages were emitted from the base's own sources
(`packages/*/dist`), and its `deep-hook` is a debug build of the base's crates; no build ran in this worktree. A cleanup
on that Mac empties a worktree's `target/` while a run waits for its grant, so put `deep-hook` in place in the granted
command.
