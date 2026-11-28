# Acceptance tests for #321, criterion 1: a "proceed" never covers a push

Written first, blind, from issue #321 (its first acceptance criterion; Scope and the other criteria read only to keep their scope out), issue #1101 for the hold a yes starts (read for context only: a 10 s hold, a try during it refused, the step run once it ends), `technical-design.md` (Hook protocol; An ask, and your answer getting back; Before each command; Questions at the stop, with `question.proceeded`; Extension API, for what a sorter is), the repo's lint rules for new blind suites, and the base commit `debda22a`, whose hub, deep-hook, asks core, `deep inbox` and the suites of #18, #24, #25, #34, #304, #318, #319 and #320 set the surfaces and shape used here. Nothing else was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft by this job.

| ID | Criterion |
|---|---|
| `#321.70212996` | A planted sorter answers "want me to push to main?" with "proceed": the proceed is recorded with its rule, and in the turn it starts the agent's `git push origin main` is held at PreToolUse with an authority ask naming the push, which waits for your answer; your yes starts the push's hold (#1101), a try during the hold is refused, and the push runs once the hold ends; after the same sorter's "proceed" for "want me to run the tests?", `npm test` runs with no ask. A core that lets a "proceed" cover the calls of the turn it starts lets the push through and fails this test, naming the call |

The ID is the first 8 hex digits of SHA-256 of the criterion's text, trimmed, whitespace collapsed, the leading `- [ ] ` dropped (the command in `tests/acceptance/48/README.md`).

## Run

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the tests run the built CLI, packages/cli/dist/main.js, and the hub it starts
cargo build -p deep-hook                 # the tests run target/debug/deep-hook as Claude Code's hook entries run it
npx vitest run tests/acceptance/321      # from the checkout's root
npx tsc -p tests/acceptance/321          # type-check the tests
```

The suite sits at `tests/acceptance/321/` (its `tsconfig.json` extends the root's from there). It finds the checkout by walking up to the folder holding `crates/deep-hook/Cargo.toml`. It builds nothing: a missing CLI or deep-hook, or a deep-hook older than its sources, stops the run with `BLOCKED`, never a pass. `lane.json` runs it alone: it runs the deep-hook binary and starts a hub per test. Node 24, `git` and `npm` on `PATH`; no network.

Each test makes its folders under `/tmp/d321-*` (a socket path must fit in 104 bytes on macOS) and runs every child with `HOME` there, so the hub's root is `<home>/.deepbuild` and nothing touches your real home, `~/.claude` or `~/.deepbuild`. A child never inherits this process's `DEEP_*`, `GIT_*`, `npm_*`, `XDG_*`, `CLAUDE*`, `ANTHROPIC_*`, `CODEX*`, `CURSOR*`, `GROK*` or `NODE_OPTIONS` variables or billing keys (`childEnv`). Every process the tests start is stopped by its PID (`cleanup`): the hub by SIGTERM, then SIGKILL; the agent stand-in by closing its stdin, which ends its own children by their PIDs, then SIGKILL of it and each child it reported.

## How waiting works

No test waits for time to pass. Each wait is for an event, and one helper, `within` (`helpers.ts`), bounds it with a deadline so a hang fails naming what never came; that timer is the suite's one timer, marked `// deadline:`. The events waited on:

- the hub's ready line on its stdout;
- the record's events as the hub streams them (`stream.subscribe` on a `cli` connection, frames `{"v":1,"id":…,"event":…}`): `question.proceeded`, and the `ask.created` naming the push;
- each deep-hook process's exit, reported by the agent stand-in, and with it deep-hook's reply;
- each command's exit (`deep inbox`, `deep inbox answer`, `git push`, `npm test`).

The 10 s hold your yes starts is the product's timing, not the test's: the test never measures it. It reads the hold from order alone: a try sent right after your yes is answered (refused) while the first try is still held, and the first try's hook is then awaited until the hub lets it through. Nothing is asserted on a clock.

## The surfaces

The tests import no hub, CLI or asks module. They reach the code only through:

- **`deep hub run`** (`packages/cli/dist/main.js`), started with `HOME` set, its ready line on stdout, as #16's and #304's suites start it;
- **deep-hook** (`target/debug/deep-hook claude-code <event>`), the payload on stdin, run by an agent stand-in (`fixtures/agent.mjs`) so the hub sees a hook's parent as the agent process, as #24's stand-in does; the same stand-in runs the agent's shell commands (`git commit`, `git push origin main`, `npm test`) through `/bin/sh` in the session's worktree;
- **the hub's socket** as the `cli` role with the control token: `stream.subscribe` and `events.read`;
- **`deep inbox`** and **`deep inbox answer <ask> <option>`** (#24), run from the test process, outside the agent's process tree, with the OS confirmation stubbed by `DEEP_HUB_TEST_CONFIRM` (#24's seam) saying `confirmed`;
- **`<home>/.deepbuild/rules.json`**, a verbatim copy of `crates/deep-hook/default-rules.json` as the checkout holds it, so whatever entries the guard engine ships (#304) are the session's rules;
- **a real git repository**: a bare `origin` and a worktree on `main` with one commit pushed; the agent's commit is the one the push carries. "The push runs" means origin's `main` becomes the agent's commit.

### What the base lacks, and the surfaces these tests define for it

The base has no question sort (#84) and no "proceed": a Stop gets no reply unless an answer is on its way. So these tests name the smallest surfaces they need, from the design:

- **`DEEP_HUB_TEST_SORTER=<absolute path of a JSON file>`**, on `deep hub run`, like the base's other `DEEP_HUB_TEST_*` settings: the planted sorter. While it's set, the hub's sort of a question a stop ends on is replaced by the file's answer, read at each stop: `{"answer": "proceed", "rule": "planted-sorter-proceeds-on-every-question"}` answers every question "proceed" under that rule. The design says a "proceed" is the stop's reply that sends the agent on ("the agent keeps working"), so the Stop's reply is Claude Code's `{"decision": "block", "reason": …}` (or exit 2) whose text says `proceed`. Each proceed is recorded as the design names it: an event of kind **`question.proceeded`** whose data holds the question and the rule (the tests read both as text in the event's data; field names are the implementer's).
- **`DEEP_HUB_PLANT=proceed-covers-turn`**: the wrong program the criterion names, added to the hub's plant list as #304's and #24's were. It is the real core with one part wrong: in the turn a "proceed" starts, it lets every call through without the authority hold.
- **The push's ask** is an `ask.created` of kind `authority`, whose data names the push: it holds `git push origin main`, or both the words `push` and `main`. Its yes is its option with `decision: "allow"` (#318's options), answered with `deep inbox answer`.

Nothing else is needed: no other option, flag or export.

## Readings where the criterion leaves a choice

- **"Held at PreToolUse … which waits for your answer"** reads as the hook protocol's hold: the hub acknowledges the push's PreToolUse with a `hold_until_ms` and gives no reply while the ask is open, so deep-hook's process for that call is still running when the ask shows in `deep inbox`, and the same call goes on with the hub's allow once the hold ends ("the push runs once the hold ends"). A core that ends the call with a denial before your answer fails, naming the call. The whole wait (the ask raised, your answer, the 10 s hold) fits in Claude Code's default 60 s PreToolUse timeout (`hookTimeouts.defaultMs` in the facts), with no settings written.
- **"A try during the hold"** is a second PreToolUse of the same `git push origin main` in the same session, sent as soon as `deep inbox answer` has exited 0. It must be denied (exit 2, `deny` or `block`), and the first try must still be held when that denial comes; a first try let through at your yes fails as "started at your yes, before its hold ended".
- **The push let through by the hub, not by deep-hook's hub-away path**: a first try deep-hook let through because the hub didn't acknowledge it in time, or whose acknowledged hold ran out with no reply, is spooled under `<home>/.deepbuild/spool`. Before the answer that makes the run `BLOCKED` (it says nothing about the core); after the hold it fails, since the hub never let the push through.
- **"The turn it starts"**: Claude Code continues the same turn after a Stop hook's block, so the push's PreToolUse follows the first Stop with no prompt between, and the second Stop (ending on "want me to run the tests?") carries `stop_hook_active: true`.
- **"`npm test` runs with no ask"**: its PreToolUse is let through, no `ask.created` is appended after the second `question.proceeded`, it runs (the fixture's `test` script writes `tests-ran.txt`), and `deep inbox` lists no open ask afterwards.
- **The session** is a Claude Code session on the newest version `adapters/claude-code.facts.json` lists (its transcript entries name it), so its holds aren't watch-only. Before the question, the agent edits the README and commits it, so the stop did work.

## Criteria, tests and wrong programs

| ID | Tests | Wrong program it fails on | On the base (expected, not run) |
|---|---|---|---|
| `#321.70212996` | `held-push.test.ts`: the scenario; `wrong-core.test.ts`: the plant | `proceed-covers-turn`: the scenario fails naming `git push origin main`, and origin's `main` holds the pushed commit | `held-push` fails at the first Stop: no "proceed" reaches the agent (the base replies to no Stop with nothing on its way). `wrong-core` fails: the base's hub refuses `DEEP_HUB_PLANT=proceed-covers-turn` and doesn't start (`BLOCKED`) |

The wrong-program test runs the same scenario (`scenario.ts`) on the planted hub and expects it to fail, not as `BLOCKED`, with a message that names the call, after the agent's push reached origin.

These tests have not been run: the machine was under a build hold when they were written.

## Files

- `helpers.ts`: constants (the ID, the call, the questions, the sorter's rule, the plant's name), `within`, temp folders and cleanup, the child environment, the hub, the `cli` connection with its stream, `deep` commands, the git repository, the agent stand-in and its session (hook payloads and transcript entries shaped as Claude Code's), and the readings of deep-hook's replies.
- `scenario.ts`: the world (home, rules, planted sorter, confirmation stub, repository, hub, stream, agent) and the scenario, each step failing with a message that names what went wrong.
- `held-push.test.ts`: the scenario on the real hub.
- `wrong-core.test.ts`: the scenario on `DEEP_HUB_PLANT=proceed-covers-turn`.
- `fixtures/agent.mjs`: the agent stand-in: runs deep-hook and shell commands as its children, one JSON line in and out per command.
- `tsconfig.json`, `lane.json`.
