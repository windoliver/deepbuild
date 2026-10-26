# Acceptance tests for #24: CLI inbox, list and answer

Written first, blind, from issue #24 (its text as of October 24, 2026: Scope, the 5 acceptance criteria, Proof and Depends on), its dependencies #318 and #319 (merged in the base), `docs/technical-design.md` (An ask, and your answer getting back; Extension API; Decided; Socket roles and contract versions, with "One role per credential" and "The trusted path is a device you paired"; the Decision and rule primitive; the exit-code table; Numbers version 0 has to hold; the threat rows "Injected answers" and "Answers from the terminal") and the base commit `8b98570` (`origin/main`: the hub of #16, the asks core of #318 and #319, no `deep inbox`). The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft by this job.

## Run

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the tests run the built CLI, packages/cli/dist/main.js, and the hub it starts
npx vitest run tests/acceptance/24       # from the checkout's root
npx tsc -p tests/acceptance/24           # type-check the tests
```

Node 24.22 or newer (`.node-version`) and `tmux` on the `PATH` for criterion 4 (without it the test uses a double fork, below). No network, no git except the perf lane's `git merge-base`. Each test makes its own folders under `/tmp/dh24-*` (a socket path must fit in 104 bytes on macOS), runs every process with `HOME` there, so the hub's root is `<home>/.deepbuild`, and never touches your real `~/.deepbuild`. It stops only processes it started, by PID (`helpers.ts`, `cleanup`), the tmux server it started included, never by name or port. The suite takes about a minute and a half on the base; on a reference Mac the 30-day budget spends about 50 s of that seeding the record. `npx tsc -p tests/acceptance/24` reports no errors on the base: the tests import no code #24 adds, only the record and the asks core as they are.

## The surface

The issue names `deep inbox`, `deep inbox answer <id>`, the control token at `~/.deepbuild/control.token`, the hub's socket, the peer check and the OS confirmation (LocalAuthentication). The tests reach the code only through these, and import no hub or CLI module:

- **`deep` commands** (`packages/cli`, built to `packages/cli/dist/main.js`), run as child processes with `HOME` set;
- **the hub** started as `deep hub run` (#16), and its socket's line protocol as `tests/acceptance/16/README.md` defines it: `{"v":1,"hello":"cli","token":…}`, `{"v":1,"hello":"mcp","parent":{pid,start}}`, method calls and `error@2` refusals;
- **the record**, seeded before the hub starts through `@deepbuild/record` and `@deepbuild/asks` (`openRecord` on `<home>/.deepbuild/ledger.db`, `openAsks`, `raise` over a `core` connection, `answer` over an `app` one), and read back through the socket's `events.read`;
- **`deep mcp`** (#26), started by the agent stand-in.

### Commands

```
deep inbox                          the open asks, one line each
deep inbox answer <ask> <option>    answer one ask with one of its options
```

- **`deep inbox`** prints one line per open ask, and no line for a closed one. A line starts with the ask's handle, `ask:<ULID>`, and its first four whitespace-separated fields are the handle, the kind (`authority`, `taste`, `choice`, `unblock`, `exception`, `definition`), the session ID and the age. Any other line (a header, say) doesn't start with `ask:`; fields after the age (the question, say) are free. The age is how long since the ask was raised, floored to the largest whole unit of `d`, `h`, `m` or `s` that is at least 1: `2d` for 2 days 3 hours, `3h` for 3 hours 5 minutes, `5m` for 5 minutes 30 seconds. It exits 0.
- **`deep inbox answer <ask> <option>`** takes the handle as `deep inbox` prints it and an option's ID. It reads the control token from `$HOME/.deepbuild/control.token`, never from an argument or the environment, connects as `cli`, and sends `ask.answer`. When the answer counts it prints a line naming the ask and the scope the decision was saved at (`repo:<project>`) and exits 0. When it doesn't count because the OS didn't confirm you, or because it ran inside an agent's process tree, it exits 3 ("not decided" in the exit-code table) and says which ask stays open.

### The socket method

`ask.answer`, `params: {ask: "ask:<ULID>", option: "<option ID>"}`, allowed for `app` and `cli` connections (the #16 role table) and refused for `hook` and `mcp` with code `role`. On a `cli` connection the hub counts the answer only once the OS confirms you: then it replies with a `result`, appends `ask.answered@2` (`via: "inbox"`, `verified: true`) and `decision.created@1`. Without that confirmation it replies with an `error@2` whose code is `unconfirmed`, appends neither, and the ask stays open. A `deep` command whose process has a session's agent process above it (the peer check, by the agent's PID and start time as its hooks established them) acts as that session, never as you, and its answer counts in no case.

The decision is `decision.created@1` from the core with `data: {key, scope, answer, ask}`: `ask` the handle, `answer` the option, and `scope` this repo's, `repo:<project>`, where the project is the one the ask's session belongs to (the `project` on its events). The tests seed every session under the project `shop`.

### The seam: the OS confirmation, stubbed at its boundary

**The hub asks for the confirmation**, not the CLI. The hub decides whether an answer counts, and an answer written straight to its socket with the token must save nothing without it, so a confirmation made in the CLI and reported to the hub would be a claim the hub can't check. The hub runs as your login service, in your session, so it can show LocalAuthentication's prompt (Touch ID or your password) on macOS, or polkit's on Linux, for each answer that needs it.

```
DEEP_HUB_TEST_CONFIRM=<absolute path of a file>    in the environment of `deep hub run`
```

When it is set, the hub doesn't call LocalAuthentication or polkit. Each time it would ask the OS to confirm you, it reads that file instead: `confirmed` (trimmed) means the OS confirmed you, and anything else, `cancelled`, an empty or a missing file, means you cancelled the prompt. Read at each confirmation, so a test turns it from `cancelled` to `confirmed` without restarting the hub. When it is unset, the hub asks the OS. Like the hub's other `DEEP_HUB_TEST_*` settings it is set only by tests. It holds a path, never the token, so the control token stays off every command line and out of every environment, and only the hub reads it: neither `deep` nor any socket client can choose what the confirmation answers.

### Wrong programs

Selected with `DEEP_HUB_PLANT=<name>` on `deep hub run`, as #16's are; the implementer adds both names to the hub's list.

| Name | What the plant does | Criterion |
|---|---|---|
| `answer-on-peer-check` | counts a `cli` answer without asking the OS when the peer check finds no agent process above the connecting process | 4 |
| `answer-on-token` | counts every answer from a connection holding the control token without asking the OS | 4, 5 |

### The perf lane

"Compared with the merge base" is the perf lane's (`scripts/benchmark.mjs`, `benchmarks/budgets.json`), as #16 and #319 left it. The implementer adds a task `deep-inbox-30d`: a command, run from the checkout's root, that runs `deep inbox` against a hub holding 30 days of asks and exits 0, valid by `validateBudgets` against the merge base's file, with an `initialReason` naming #24 (the merge base has no `deep inbox`). Its margin and limits are the implementer's; the 300 ms is judged in `budgets.test.ts`.

## The contract per criterion

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed and the leading `- [ ] ` dropped (the command in `tests/acceptance/48/README.md`). Each test name starts with its ID.

1. **`#24.4963284a` An answer given in the CLI is saved as a decision with its scope** (`answer.test.ts`). A session of the project `shop` with an authority ask and a choice ask, the hub's confirmation stubbed `confirmed`. `deep inbox answer <ask> decline` and `deep inbox answer <ask> files`, run by you, each exit 0 and print the handle and `repo:shop`. Each ask has exactly one `ask.answered` (`answer` the option, `via: inbox`, `verified: true`) and exactly one `decision.created` from the core with `data.ask` the handle, `data.answer` the option and `data.scope` `repo:shop`. `deep inbox` then lists neither.
2. **`#24.4373d3bf` Agents have no command or tool that can answer** (`agents.test.ts`), with the confirmation stubbed `confirmed` throughout. (a) The agent stand-in runs `deep inbox answer <authority ask> decline` through its shell: exit 3, nothing counted; the same command run by you then counts once, so the refusal came from the peer check. (b) The agent's own `deep mcp`: `tools/list` names no tool matching `answer|approve|respond|reply`, and calling every listed tool with `{ask, option, answer}` leaves the ask open. (c) An `mcp` connection presenting the agent as its parent: `ask.answer` is refused with code `role`, `mcp.call` naming `ask.answer` is refused, and the ask stays open.
3. **`#24.bbe12971` Budgets** (`budgets.test.ts`). (a) Anywhere: `deep inbox` lists a taste ask raised 2 days 3 hours ago as `taste S1 2d`, an authority ask 3 h 5 min old as `authority S2 3h`, and a definition ask 5 min 30 s old as `definition S3 5m`, each once, and not a choice ask answered on the card. (b) Anywhere: the perf lane's task, above, is there, valid against the merge base, names #24 and runs. (c) On a reference Mac only: with 30 days of asks in the record, `deep inbox` lists every open one in under 300 ms, from spawning the command to its exit, five runs after a warm-up, judged by the design's rule for timing results (all five within: PASS; all five over by more than the margin, the larger of 5% and the runs' spread: FAIL; otherwise INCONCLUSIVE). Off a reference Mac (Mac15,7 or Mac15,12), on battery, with Low Power Mode on or unknown, or with a thermal warning, it is skipped as INCONCLUSIVE, never passed.
4. **`#24.71112e3b` Authority answers count only once the OS confirms you** (`confirm.test.ts`, `scenarios.ts`). An agent stand-in with its session established through its hooks, two authority asks in that session, the confirmation stubbed `cancelled`. The agent types `deep inbox answer <ask> decline` into your shell with `tmux send-keys`: exit 3, the output names the ask, and the ask stays open with no decision. The other ask's answer written straight to the socket with the control token is refused `unconfirmed` and stays open. With the stub turned to `confirmed`, the same typed command exits 0 and the same socket line gets a result, and each ask is answered exactly once with one decision. **Plants:** `answer-on-peer-check` and `answer-on-token` each fail it, naming the ask (below).
5. **`#24.b58ac6a6` Exception, definition and taste answers on the token alone** (`confirm.test.ts`, `scenarios.ts`). One ask of each kind; with the stub `cancelled`, `ask.answer` for each (`waive`, `drop`, `green`) on a `cli` connection is refused `unconfirmed`, nothing closes any of them, no decision is saved, and `deep inbox` still lists all three. With the stub `confirmed`, each counts once. **Plant:** `answer-on-token` fails it, naming the ask.

"Nothing counted" (`helpers.ts`, `expectOpen`) reads the whole log through `events.read` 300 ms after the answer and finds, for that ask, no `ask.answered`, `ask.defaulted`, `ask.escalated`, `ask.cancelled`, `ask.superseded` or `ask.moot`, and no `decision.created` or `decision.applied` naming it. Its failure message is `ask ask:<ULID> (<how it was answered>) counted with the OS confirmation cancelled or refused…`, so a planted hub fails naming the ask; `plants.test.ts` expects exactly that message.

### Criterion 4's escape, as run here

Your shell is `/bin/sh` in a tmux server the test starts (`tmux -S <temp>/tmux.sock new-session -d`), which detaches, so the shell's parents are the tmux server and launchd and no agent is above it. The agent stand-in, a process whose hooks established its session, runs `tmux -S … send-keys -t you -l '<command>'` and `send-keys Enter` through its own shell, as an agent's Bash tool would. Where `tmux` isn't installed, the agent's shell double-forks the command instead (`( sleep 1; sh -c … ) &`), so its parent exits and it is left under launchd; the test's message says which was used. This machine has tmux 3.5a.

## Readings where the issue leaves a choice

- **Which answers need the OS.** The scope says an authority answer and every answer that saves a decision or changes what a check demands. Criterion 1 says an answer given in the CLI is saved as a decision, so every answer from `deep inbox answer` needs the confirmation, a taste answer included, as criterion 5 holds.
- **Authority answers say no.** The tests answer authority asks with their deny option, `decline`. Approving binds to the plan's hash and a click token (#318); how `deep inbox answer` shows a plan and binds a token isn't in the issue, so no test approves. A hub that requires confirmation only for approvals fails criterion 4.
- **The option** is the command's second argument; the issue names only `<id>`, and a prompt for the option would need a terminal the tests don't have.
- **The scope** is this repo's, `repo:<project>` (Decision and rule: "An answer is saved for this repo, and it widens to all your repos only when you confirm"). The project comes from the ask's session; the hub at the base sets no project on hook events, so the tests seed sessions with one through the record.
- **An agent's `deep` command never answers**, even when the OS confirms (design: "one run inside an agent's process tree never answers as you"). Criterion 2 is tested with the stub confirming, so a hub that leans on the confirmation alone fails it.
- **The `app` hello** is out of this issue: the design has the app's answers count by the paired device's signature, which #24 doesn't build, so the socket cases write as `cli`, the role `deep inbox answer` takes. A follow-up: until that pairing exists, a client holding the token can say `hello: app`; the design's rule ("the same whether the answer comes by the CLI or the app API") isn't tested for it here.
- **A remote hub** ("whether the hub runs here or on your server") can't show a prompt on your Mac; that case belongs to the paired-device signature too, and isn't tested.
- **The 30-day volume.** The design states no number of asks a day. The tests take #16's heavy month, 20 sessions a day for 30 days, each raising five asks, the most a session holds before its asks fold (the fold drafted at setup, 5): 3,000 asks, raised through the asks core on a clock moving through the month. The first 29 days' asks take their defaults at their one-day deadlines; the last day's 100 are open, and `deep inbox` must list each of them in every timed run.
- **Exit codes** follow the design's one table: 0 counted; 3 not decided (the confirmation cancelled, or an agent's command refused); 2 a usage error.

## Criteria, tests and wrong programs

| # | ID | Tests | Wrong programs it fails on | On the base |
|---|---|---|---|---|
| 1 | `#24.4963284a` | `answer`: one | a CLI that doesn't save a decision, or saves it at another scope | FAIL: `deep inbox` unsupported (exit 2) |
| 2 | `#24.4373d3bf` | `agents`: three | a hub without the peer check (a); a `deep mcp` with an answering tool (b); a role table that lets `mcp` answer (c) | (a) FAIL: unsupported command; (b), (c) PASS: the base has no answering tool, and #16's role table already refuses `mcp` |
| 3 | `#24.bbe12971` | `budgets`: three | a listing without kind, session or age, or with closed asks (a); no perf-lane task (b); a slow listing (c) | (a), (c) FAIL: unsupported command; (b) FAIL: no task `deep-inbox-30d` |
| 4 | `#24.71112e3b` | `confirm`: one; `plants`: two | plants `answer-on-peer-check`, `answer-on-token` (each fails naming the ask) | FAIL: unsupported command (exit 2); plants FAIL: the hub refuses the unknown plant names |
| 5 | `#24.b58ac6a6` | `confirm`: one; `plants`: one | plant `answer-on-token` (fails naming the ask) | FAIL: the hub answers `not_found`, not `unconfirmed`; plant FAIL as above |

No sample implementation was run: the passing side of each test, and each plant's failure, are unverified until the implementation exists. `BASE-FAILURE.txt` holds the base run.

## Files

- `helpers.ts`: temp homes and process cleanup by PID, the record seeded through the record and asks core, the hub with its confirmation stub, the socket, `expectOpen` and `expectCountedOnce`, the agent stand-in, your shell in tmux, the `deep inbox` line parser, and the budget rule (reference Mac, judge).
- `fixtures/agent.mjs`: the agent stand-in and its hook client.
- `scenarios.ts`: criteria 4 and 5, shared with `plants.test.ts`.
- `answer.test.ts` (1), `agents.test.ts` (2), `budgets.test.ts` (3), `confirm.test.ts` (4, 5), `plants.test.ts` (4, 5).
- `tsconfig.json`: type-checks the suite under the root's strict options with `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the base run.
