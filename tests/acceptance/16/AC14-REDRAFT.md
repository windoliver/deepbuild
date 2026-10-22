# AC14 blind redraft: nothing on the hub's main thread during 1,000 hooks

Criterion `#16.82e2f65c` (ID recomputed from the issue text: trimmed, whitespace collapsed): "During 1,000 hooks, a
preload that records `child_process` calls, directory reads and process listing on the hub's main thread finds none.
A planted hub that runs `git rev-parse` in its hook handler fails, naming the call".

Test: `hotpath-ac14-redraft.test.ts`, one `describe` ("AC14 #16.82e2f65c the hub's main thread runs no child process,
reads no folder and lists no process during 1,000 hooks (redraft)") with two tests:

- "AC14 during 1,000 hooks from 10 sessions the main-thread preload records no child_process call, directory read or
  process listing"
- "AC14 (wrong program) a hub that runs git rev-parse in its hook handler fails the same check, naming the call"

`helpers.ts`, `tsconfig.json` and `fixtures/` are copied unchanged from the suite's read-only inputs (`diff -r` empty).

## What I read

- Issue #16 with its comments (`gh issue view 16 --repo windoliver/deepbuild --comments`): Scope ("Parsing off the
  event loop"), the acceptance criteria, Proof, "Added Oct 9" ("The event loop never runs git, scans folders or
  inspects processes; a test enforces it") and "Done when" ("the hot-path test passes").
- `docs/technical-design.md` at `4f6dec5` (`git show 4f6dec5:docs/technical-design.md`): "One hub per user, a tiny
  hook client, and extensions in-process" (and the paragraph of "One event log" that says the event loop "only reads
  lines, acknowledges, routes and writes replies"), "Hook protocol (deep-hook and the hub)", and in "How we know
  version 0 works": Criteria to tests, Wrong programs and Dogfooding.
- The suite's read-only inputs: `README.md` (the surface: `deep hub run`, `--import` preloads, `DEEP_HUB_PLANT`,
  `git-in-hook-handler`, `events.read`, `hub.health`, the hook exchange), `helpers.ts`, and `fixtures/preload.mjs`
  and `fixtures/client.mjs`.
- `tests/acceptance/14/AC6-REDRAFT.md` and the head of `ac6-redraft.test.ts`, for the form.

Nothing under `packages/hub` (absent here anyway), no other branch, worktree, PR or file of the scratchpad's parent
folders.

The checkout is at `c9891b3`, a descendant of `4f6dec5` with no hub and no `deep hub` command; the design sections
were read at `4f6dec5` itself.

## The scenario

1. A fresh temp home; `deep hub run` started with `node --import fixtures/preload.mjs` and
   `DEEP_TEST_PRELOAD_LOG=<temp file>` (and `DEEP_HUB_PLANT=git-in-hook-handler` for the wrong program).
2. Preconditions, each a `BLOCKED` error, never a pass: the preload log's first line is `{"loaded":true,"pid":P}` with
   `P` the ready line's `pid`, and `hub.health` over a `cli` connection answers with that same `pid`. Without these an
   empty log could mean the preload never saw the process that serves the socket.
3. Ten Claude Code sessions, each in its own `git init` repository with an `origin` remote (so a hub that asks git
   about a session's project would do it here), each sending 100 hooks in order, the ten side by side: SessionStart,
   UserPromptSubmit, 48 PreToolUse/PostToolUse pairs, UserPromptSubmit, SessionEnd. 1,000 hooks. Each comes from this
   test process (`fromHere`: real `pid` and `ppid`), and each must get its ack (naming its ID) and its reply, or the
   scenario is `BLOCKED`.
4. The window opens at the preload log's size just before the first hook and closes once every one of the 1,000 hook
   IDs reads back through `events.read`, so whatever the hub does for a hook, even after its reply, falls inside it.
   What the hub did at startup (before the first hook) is outside.

## Assertions, the sentence each comes from, and the wrong program each catches

| # | Assertion | Source sentence | Wrong program it catches |
|---|---|---|---|
| 1 | The preload recorded nothing in the window: `expect(found.length, <message>).toBe(0)` | AC14: "During 1,000 hooks, a preload that records `child_process` calls, directory reads and process listing on the hub's main thread finds none"; Added Oct 9: "The event loop never runs git, scans folders or inspects processes"; design: the event loop "only reads lines, acknowledges, routes and writes replies" | A hub that runs git, `ps`/`pgrep` or any other child process, or reads a directory (which is also how a process listing reads `/proc` on Linux), on its main thread while serving hooks, whether in the handler or after the reply |
| 2 | The message of 1 lists every distinct recorded call as `<call>(<args>) x<count>, first <stack>` | AC14: "fails, naming the call" | A failure that names nothing useful (see below on Vitest's messages) |
| 3 | (wrong program) The same scenario with `DEEP_HUB_PLANT=git-in-hook-handler` runs (preconditions 2 and 3 hold), and assertion 1 throws with a message matching `/\bgit\b[^\n]*\brev-parse\b/` | AC14: "A planted hub that runs `git rev-parse` in its hook handler fails, naming the call"; design, Wrong programs | A check that can't fail, a preload that doesn't see the hub's main thread, and a message that doesn't carry the call's name |

The scenario preconditions (preload in the serving process, 1,000 acks and replies, 1,000 events in the log) come from
AC14's "During 1,000 hooks" and the README's surface; they fail as `BLOCKED`, so a hub that doesn't start, or a plant
that doesn't start, fails its test rather than passing it.

## How the failure names the call (Vitest 5.0.5)

Vitest shortens the compared values in an assertion's message. A throwaway check in my scratchpad
(`vcheck/msg.test.ts`, 60 distinct directory reads followed by 1,000 identical `git rev-parse` records) printed:

```
toEqual([]) message: "expected [ …(1060) ] to deeply equal []" len 39 has rev-parse: false
strings toEqual([]) message: "expected [ …(1060) ] to deeply equal []" len 39 has rev-parse: false
joined toBe message: "expected 'fs.readdirSync /tmp/some/long/folder/…' to be '' // Object.is equality" len 80 has rev-parse: false
candidate message length 5344 tail: "…child_process.execFileSync(git, rev-parse --show-toplevel, object) x1000 [at handle (file:///hub/x.js:1:1)]\n: expected 1060 to be +0 // Object.is equality"
one call: "main-thread calls during 1,000 hooks:\n  child_process.execFileSync(git, rev-parse --show-toplevel, object) x1 [at handle (file:///hub/x.js:1:1)]\n: expected 1 to be +0 // Object.is equality"
```

So an array of records never shows its contents, and a joined string keeps only its first 40 characters. The
assertion's own message (`expect(value, message)`) is kept whole, so the test builds it from the records: every
distinct call and its arguments as the preload shows them, with a count, however many calls and in whatever order.
The wrong-program test checks the thrown message with `toThrow(regex)`, which reads `error.message`.

I also ran the test, unchanged, in a throwaway copy of the repo in my scratchpad whose `packages/cli/dist/main.js` was
a 60-line stand-in hub (ready line, hello, ack and reply, `cli` hello, `hub.health`, `events.read`, a `readdirSync` at
startup), only to check the scenario's mechanics. Results: both tests pass on the clean stand-in (its startup read is
outside the window); with a stand-in plant that runs `git rev-parse` per hook, test 1 fails with

```
AssertionError: child_process calls, directory reads or process listings on the hub's main thread during 1,000 hooks:
  child_process.execFileSync(git, rev-parse --show-toplevel, object) x1000 at at Socket.<anonymous> (file:///…/packages/cli/dist/main.js…
: expected 1000 to be +0 // Object.is equality
```

(the doubled "at" is fixed since: the line now reads `x1000, first at Socket.<anonymous> …`); and with a plant that
reads a directory on every hook and runs `git rev-parse HEAD` on about one in a hundred, the wrong-program assertion
still finds `git … rev-parse` in the message. The stand-in is no evidence about the real hub.

## Readings

- **"During 1,000 hooks"** is the window from just before the first hook to the moment every hook's event is in the
  log. Startup is outside it: the README's retention pass and spool replay at start, extension loading and the like
  are not this criterion's. Anything inside it counts, whatever caused it (a timer, the `events.read` polling that
  closes the window), since the issue says the event loop never does these things.
- **"Process listing"** is caught as the preload catches it: `ps`/`pgrep` and the like as `child_process` calls, and
  `/proc` as a directory read on Linux. A listing through a native addon or `sysctl` from native code isn't visible
  to a JavaScript preload; neither the issue nor the README gives a way to see it.
- **"Main thread"**: the preload wraps the modules on the main thread only, so worker threads may run git or read
  folders; that is what the issue's "a worker thread parses …" allows.
- **The hooks** come from the test process directly rather than from the agent stand-in's children: 1,000 child
  processes would cost about a minute and add nothing this criterion needs; their `pid`/`ppid` are real, live
  processes, so a hub that inspects the process tree for each hook does so here. No Stop hooks, since a Stop may be
  held by the gate and a hold is not this criterion.
- **Sessions in git repositories**: the design identifies a project by "its repo root and remote URL", the natural
  place for a hub to call git; each session's folder is a fresh `git init` with an `origin` remote so that call has
  something to find.
- **Naming the call** means the message carries the program and its subcommand on one line (`git … rev-parse`), as the
  preload records it, whether the plant uses `execFileSync`, `spawn`, `exec` or a shell.

## Type check

```
$ node node_modules/typescript/bin/tsc -p tests/acceptance/16/tsconfig.json
(no output)
tsc-exit=0
```

## Run on the base

Node v24.22.0 (`~/.local/share/fnm/node-versions/v24.22.0/installation/bin/node`), `npm ci`, `npm run build
--workspaces` (the first build stopped at `@deepbuild/asks`, which builds before `@deepbuild/record` and can't find
it; a second run built every package, `packages/cli/dist/main.js` included), then:

```
$ node node_modules/vitest/vitest.mjs run --root tests/acceptance/16 hotpath-ac14-redraft

 RUN  v5.0.5 ~/dev/claude-worktrees/github-issue-16-acaf52/agent-a9d1d05738c110479/tests/acceptance/16

 ❯ hotpath-ac14-redraft.test.ts (2 tests | 2 failed) 181ms
   ❯ AC14 #16.82e2f65c the hub's main thread runs no child process, reads no folder and lists no process during 1,000 hooks (redraft) (2)
     × AC14 during 1,000 hooks from 10 sessions the main-thread preload records no child_process call, directory read or process listing 117ms
     × AC14 (wrong program) a hub that runs git rev-parse in its hook handler fails the same check, naming the call 63ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  hotpath-ac14-redraft.test.ts > AC14 #16.82e2f65c … (redraft) > AC14 during 1,000 hooks from 10 sessions the main-thread preload records no child_process call, directory read or process listing
Error: BLOCKED: the hub didn't start (deep hub run): exit {"code":2,"signal":null}; stderr: Unsupported command. Run deep --help for available commands.

 ❯ startHub helpers.ts:249:11
 ❯ mainThreadCallsDuringHooks hotpath-ac14-redraft.test.ts:56:15
 ❯ hotpath-ac14-redraft.test.ts:119:28

 FAIL  hotpath-ac14-redraft.test.ts > AC14 #16.82e2f65c … (redraft) > AC14 (wrong program) a hub that runs git rev-parse in its hook handler fails the same check, naming the call
Error: BLOCKED: the hub didn't start (deep hub run): exit {"code":2,"signal":null}; stderr: Unsupported command. Run deep --help for available commands.

 ❯ startHub helpers.ts:249:11
 ❯ mainThreadCallsDuringHooks hotpath-ac14-redraft.test.ts:56:15
 ❯ hotpath-ac14-redraft.test.ts:123:19

 Test Files  1 failed (1)
      Tests  2 failed (2)
   Start at  14:14:24
   Duration  349ms (tests 79%, transform 10%, import 8%, worker 3%)

exit=1
```

Both tests fail for the expected reason: the base's CLI has no `deep hub run`, so there is no hub. The run left no
`/tmp/dh16-*` folder; the Vitest cache under `tests/acceptance/16/node_modules/` was deleted.
