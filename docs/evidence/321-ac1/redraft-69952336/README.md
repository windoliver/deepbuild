# Acceptance test for #321, criterion 1: no proceed covers a push (blind redraft)

Written blind, from issue #321's text (Scope, its 5 acceptance criteria, Proof and Depends on) and the base commit
`debda22a6ef976bd7ce20a92e005272406accf23`, by a job that never saw an implementation of #321. It covers the first
criterion only.

## The criterion

`#321.69952336` (first 8 hex of SHA-256 of its text):

> A planted sorter answers "want me to push to main?" with "proceed": the proceed is recorded with its rule, and in
> the turn it starts the agent's `git push origin main` is held at PreToolUse with an authority ask naming the push,
> which waits for your answer; after the same sorter's "proceed" for "want me to run the tests?", `npm test` runs
> with no ask. A core that lets a "proceed" cover the calls of the turn it starts lets the push through and fails
> this test, naming the call

## What was read

- The issue text (only that file; no other issue, PR or remote).
- `docs/technical-design.md`: An ask, and your answer getting back (all of it); Questions at the stop and A question
  holds the send-back (under An agent says it's done); Before each command (guard@1, effect classes, the MCP
  classes); Hook protocol (deep-hook and the hub); the done loop's "Every stop is judged" row; Decided (Requests that
  name an action, Ask deadlines and defaults, Answers typed in a session, MCP calls and the guards).
- `AGENTS.md` (Proof).
- Base code: `packages/hub/src/plant.ts` (the plant list), `server.ts` (`hook`, `holdFor`, `coreReply`, `reply`,
  the method table, `test.send_back`), `core.ts` (`hookReply`, `stopHold`, `inbox`), `hookmap.ts` (`versionOf`,
  watch-only, the `agent.stop` mapping), `adapters/claude-code.facts.json` (versions, the Stop payload's
  `last_assistant_message`), `crates/deep-hook/default-rules.json`, `packages/asks/src/index.ts` (the `Asks`
  interface, drafted deadlines), `packages/extension-host/runtime/deep.mjs` (the API list).
- Sibling suites for conventions: `tests/acceptance/304` (helpers, the hub and deep-hook as processes,
  `failureOf`), `18/mapping` (made-up Claude Code sessions and transcripts), `24` (`DEEP_HUB_TEST_CONFIRM`,
  `inbox.read`), `318` and `320` (how a blind suite states the surface it needs).

## Run

From the repo root, with the repo's Node (24.22) and Rust toolchain:

```sh
npm ci
npm run build --workspaces
CARGO_BUILD_JOBS=1 RUSTC_WRAPPER= cargo build --locked -q -p deep-hook
npx vitest run --root tests/acceptance/321-redraft-ac1 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/321-redraft-ac1/tsconfig.json   # type-check
```

`deepHook()` runs `cargo build --locked -q -p deep-hook` once more in `beforeAll`, so keep the Rust settings in
the environment of the vitest run too (`CARGO_BUILD_JOBS=1 RUSTC_WRAPPER= npx vitest …`). With `--root`, vitest
leaves a `node_modules/.vite` cache in this folder; it isn't part of the suite.

No network, no model. Every test makes its folders under `/tmp/dh321-*`, gives every process it starts `HOME` there
(so the hub's root is `<home>/.deepbuild` and nothing touches your real `~/.deepbuild` or `~/.claude`), and stops
only the processes it started, by PID. No call is ever executed: `git push origin main` and `npm test` are
PreToolUse payloads deep-hook asks the hub about; the repo's `origin` is a local bare repository nobody pushes to.

## The surface

The tests reach the code only through: `deep hub run` (`packages/cli/dist/main.js`); `target/debug/deep-hook` run as
Claude Code's hook entry (`deep-hook claude-code <event>`, the hook JSON on stdin); Claude Code transcripts under
`<home>/.claude/projects`, claiming version 2.1.304, the newest the base's facts cover (so no session is
watch-only); the shipped `default-rules.json` copied in as the first `rules.json`, as #304's suite does; and the
hub's socket as the `cli` role: `events.read` and `inbox.read`.

Two seams the base does not have, which the implementer adds:

### The planted sorter

The base has no sorter for questions at the stop (#84 keeps the sorting, per the issue) and no slot an extension
fills with one, so there's nothing a test can plant one through. This suite names the smallest seam, in the style of
the hub's other test-only settings (`DEEP_HUB_TEST_CONFIRM`, `DEEP_HUB_TEST_SEND_BACK`):

```
DEEP_HUB_TEST_SORTER=<rule>      in the environment of `deep hub run`
```

When it is set, the hub sorts every question a Claude Code stop ends on (the Stop payload's
`last_assistant_message`) with a planted sorter that answers it "proceed", whatever it asks, and names `<rule>` as
the rule that sorted it. Only tests set it. It is the "planted sorter" of the criterion: one that wrongly sends a
push question on, so the test sees that the core, not the sorter, holds the push ("whichever sorter answered").
If #84 lands a sorter slot that a test can fill, a redraft can plant through that instead.

### The wrong program

```
DEEP_HUB_PLANT=proceed-covers-turn      on `deep hub run`, beside DEEP_HUB_TEST_SORTER
```

A core that lets a "proceed" cover every call of the turn it starts: the push in that turn gets no authority ask
and its PreToolUse lets it through. The base's `plantOf` refuses names not on its list, so the implementer adds this
name to `packages/hub/src/plant.ts`.

## What the test checks, and the values chosen

`proceed.test.ts` has three tests, each titled with `#321.69952336`. The first two share one hub, so one planted
sorter answers both questions.

1. **The push.** A session you started (SessionStart, a prompt you typed), whose agent edits `src/login.js`, ends its
   turn on "want me to push to main?". Then:
   - the Stop reply sends the agent on (`{"decision":"block",…}` or exit 2), the "proceed";
   - an event, of a kind that isn't `ask.*`, holds both the question and the planted rule in its data ("recorded with
     its rule"); the event kind and field names are left to the implementer;
   - the session has no ask yet (the proceed is not an ask, and the authority ask comes at PreToolUse);
   - in that same turn (no new prompt), the agent's `Bash` call `git push origin main` reaches PreToolUse: within
     30 s an ask of kind `authority` for that session, whose question mentions `push`, is in `inbox.read`; the
     PreToolUse either still waits or ended without allowing the call (exit 2, or a `deny`/`ask`/`block` decision);
     3 s later it still hasn't let the call through, and the ask is still open and `unanswered`.
2. **The tests.** A second session on the same hub ends its turn on "want me to run the tests?": same proceed checks;
   its `Bash` call `npm test` is allowed (exit 0, no deny, ask or block decision), and 3 s later the session has no
   ask.
3. **The wrong program.** The push judgement of test 1, run against `DEEP_HUB_PLANT=proceed-covers-turn`, must fail,
   and its message must say that `` `git push origin main` ran in the turn `` the proceed started.

Chosen where neither the issue nor the design gives a number:

- **30 s** for the proceed's record and the authority ask to show, and **3 s** of watching a held push or an allowed
  `npm test` afterwards. Both are loose on purpose: the design's numbers (a 20 ms acknowledgement, the 1-day
  authority deadline) don't bound how soon an ask shows in the inbox.
- **What "held" looks like.** The design says the call "stays held until you answer" and the authority deadline is
  a day, longer than any hook's timeout, so the test doesn't fix whether the hub denies the call with a reason or
  keeps its PreToolUse waiting: either passes, and only letting it run fails. A `permissionDecision: "ask"` counts as
  held too, though only the authority ask in the inbox satisfies "with an authority ask".
- **"Naming the push"** is checked loosely, as a question that mentions `push`; the exact wording is the
  implementer's.
- **A second session** for "want me to run the tests?", on the same hub and sorter, so the open push ask of the
  first session can't affect the second stop's hold. The criterion doesn't say whether both questions come from one
  session.
- **The Stop's 120 s timeout** and PreToolUse's 60 s (90 s for the push) are just ceilings for the hook processes.

## At the base

Expected to fail: the base has no sorter, no proceed, no authority hold of a push, and neither seam above. See
`BASE-FAILURE.txt`.
