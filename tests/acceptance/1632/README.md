# Acceptance tests for #1632: after /clear, deep mcp stays bound to the session that ended

Written first, blind, from issue #1632 (its text as of November 8, 2026: the opening, Scope, the 5 acceptance criteria, Proof and References; no comments), `docs/technical-design.md` (Socket roles and contract versions, its "One role per credential" bullet; One event log, with tables built from it; the "Threads, not IDs" bullet; Dogfooding) and the base commit `ede4b367` (`origin/main`), its code and its suites (`tests/acceptance/26/` as the model, `tests/acceptance/1501/` for running the real deep-hook). This job saw no branch, PR or diff for the fix. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft by this job.

## Run

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the tests run packages/cli/dist/main.js: deep hub run, deep mcp, deep inbox
cargo build --locked -q -p deep-hook     # the tests run target/debug/deep-hook
npx vitest run tests/acceptance/1632     # from the checkout's root
npx tsc -p tests/acceptance/1632         # type-check the tests
```

Node 24.22 or newer and `git` on the `PATH`. No network, no model, no `claude` binary. Each test makes its folders under `/tmp/dh1632-*` and runs every process with `HOME` there, so the hub's root is `<home>/.deepbuild`; it never touches your real `~/.deepbuild` or `~/.claude`. It stops only processes it started, by PID (`helpers.ts`, `cleanup`). Every file starts real hubs; the budgets file times them, so the implementer adds `tests/acceptance/1632/` to the unit lane's one-at-a-time list in `scripts/lanes.mjs`, as suite 26 is (not done here: this job writes tests only). The tests import only public entries (`@deepbuild/record`, `@deepbuild/asks`, `@deepbuild/contracts`, by their `src/index.ts`), to seed one past ask before a hub starts and to validate error@2.

## The surface

The proof the issue asks for: fixture Claude Code sessions through the real deep-hook, hub and `deep mcp`.

- **`fixtures/agent.mjs`** is one Claude Code process. Its hooks are **the real deep-hook**, `target/debug/deep-hook claude-code <Event>` with Claude Code's hook JSON on stdin, run as its direct children (so deep-hook reports this process as the agent). Its one **`deep mcp`** (`node packages/cli/dist/main.js mcp`) is its child too, started at its first MCP request and kept for the process's life, as Claude Code keeps its MCP servers across `/clear`. The tests speak MCP to it as a client does (newline-delimited JSON-RPC: `initialize`, `notifications/initialized`, `tools/call`).
- **`deep hub run`** and its socket as `tests/acceptance/16/README.md` defines it: `events.read` on a `cli` connection holding the control token.
- **`deep inbox answer`** (#24), with #24's confirmation stub `DEEP_HUB_TEST_CONFIRM`, as suite 26 uses it.
- The tools and fields suite 26 defined (its README's Tools table): `deep_status`'s `session`; `deep_claim` filing `claim.made` under the bound session; `deep_ask` filing `ask.created`; `deep_wait` with `ask`; `deep_open_item` filing `open_item.opened` with its `text`; `deep_search`'s `hits[].source`, a past decision cited `decision:<id of its decision.created>`; every tool error a tool result with `isError` whose value is error@2, `code` `unbound` for an unbound call.

**`/clear`** (`helpers.ts`, `clear`) is what Claude Code's hooks send: SessionEnd for A with `reason: "clear"`, then SessionStart for a new ID B with `source: "clear"` from the same process (same PID and start time, since it is the same `agent.mjs`), B's transcript a new file in the same project folder, then B's prompt and a first tool call. Claude Code's payload carries no parent field; "a start naming the ended session as its parent" is read as the hub's own join of B to A's thread (Threads, not IDs), which the base already makes: `clear` throws BLOCKED unless B's `session.start` carries A's thread. A `deep_*` call is **stamped** by the PreToolUse Claude Code fires for it: `tool_name: "mcp__deep__<tool>"`, `tool_input` the call's arguments.

### Names invented here

| Name | What it is |
|---|---|
| `DEEP_1632_BASE_TREE` | Read by `budgets.test.ts` only: the path of a checkout of `git merge-base HEAD origin/main`, built (`npm run build --workspaces`, `cargo build -p deep-hook`) with a `node_modules` of its own (a symlink to this tree's would load this tree's `@deepbuild/*` packages). Unset, the budget is skipped INCONCLUSIVE. |
| "delivered to B" | Criterion 2, read as anything B's process hears for B: the replies deep-hook gives B's hooks, what B's `deep_wait` on the ask returns, and a `delivery.outcome` event with `outcome: "delivered"` for that ask (the record's own word for it). |
| A "bound call" | Criterion 5: `deep_open_item` from a `deep mcp` bound to its session at its hello, with no clear. |

No plant (`DEEP_HUB_PLANT`) is needed or added: each wrong program the criteria name is caught by the scenario itself (below).

## Criteria, tests and wrong programs

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed and the leading `- [ ] ` dropped (the command in `tests/acceptance/48/README.md`). Each test name starts with its ID.

| # | ID | Test | Fails on | On the base `ede4b367` |
|---|---|---|---|---|
| 1 | `#1632.62d3152b` | `rotation`: A's deep mcp is bound to A (`deep_status` names A; a claim lands under A); after `/clear`, two `deep_claim`s, each after B's PreToolUse stamped it, are each recorded once, under B | the merge base (refuses `unbound` naming A); a hub that keeps binding to A; one that files a rotated call twice or under no one | **FAIL, for the expected reason**: `unbound`, "Session <A> has ended; this deep mcp acts for no session now." |
| 2 | `#1632.681ec30e` | `answers`: A's `deep_ask` (taste, returns provisional before any answer, so no call is open at the clear); `/clear`; you answer with a non-recommended option via `deep inbox answer`; B's prompts, a stamped `deep_wait` on the ask, and a tool call. None of B's hook replies or results carries the ask's handle or the chosen option's label, `deep_wait` doesn't return the answer, and no `delivery.outcome` says `delivered` for it | a hub that delivers A's answer to B | **FAIL**: the base delivers it in B's UserPromptSubmit reply, "DeepBuild delivers your answers: Your answer to ask:… Teal … header …". See the conflict below. |
| 3 | `#1632.a3eebb10` | `exited`, two tests. P1 (session X) and P2 (session Y) in one worktree; X ends with no successor in P1, its deep mcp still connected; for each of `deep_claim`, `deep_ask` and `deep_open_item`, P2 stamps Y's PreToolUse for exactly P1's next call, then P1 sends it: refused `unbound`, the error naming X, and nothing filed under anyone. First test: X exits (`reason: "prompt_input_exit"`). Second: X ends with `reason: "clear"` but the next `source: "clear"` start in the worktree comes from P2, not P1 | a hub that binds P1's call to any live session in the worktree, or by any matching unspent stamp regardless of process, files it under Y; one that reads "SessionEnd clear, then any clear start" as rotation | PASS (both): the base already refuses; regression protection |
| 4 | `#1632.be55c5e4` | `rotation`: a past decision is seeded and answered before the clear; `deep_search` for its question finds `decision:<id>` before the clear, and after it both unstamped and stamped by B | a hub that refuses or empties read-only calls after the clear | PASS: holds on the base; regression protection |
| 5 | `#1632.c4de6dbc` | `budgets`: on a reference Mac with `DEEP_1632_BASE_TREE` set, five rounds alternating this tree and the merge base's, each round 20 untimed then 40 timed bound `deep_open_item` calls; each round's p95 is paired with the base's and judged by the design's timing rule (PASS when every ratio is within 1 + margin, FAIL when every ratio is over it, else INCONCLUSIVE; margin the larger of 5% and the base runs' spread). Off a reference Mac (Mac15,7 or Mac15,12), on battery, Low Power Mode on or unknown, thermal warning, or with no base tree, skipped INCONCLUSIVE with the reason, never passed | a bound call made slower by the fix | SKIPPED INCONCLUSIVE here (Linux, not a reference Mac); not run on a reference Mac |

`BASE-FAILURE.txt` holds the full base run (2 failed, 3 passed, 1 skipped). The passing side of criteria 1 and 2 is unverified until a fix exists. The wrong programs of criteria 3 and 4 weren't run as planted hubs: the tests catch them by construction (a claim filed under Y, or an error from `deep_search`, fails the assertion), and the base passing them shows only that the base isn't one.

## Readings where the issue leaves a choice

- **Criterion 2 against the design and the base.** The issue says the answer "is never delivered to B, as answers to a replaced session aren't today". The design's "Threads, not IDs" bullet says the opposite for `/clear`: "An answer for a session that has ended reaches only the same thread at SessionStart, a resume or the thread joined across `/clear` and `/compact`", and the base does exactly that: B, joined to A's thread, gets the answer at its next prompt. `tests/acceptance/27` AC4 relies on that join for an answer the waiter took *before* the clear (reaches the cleared thread's new session at its start). This suite follows the issue's criterion as written, for an answer given *after* the clear. If the issue meant only the `deep mcp` side (the rebound connection must not hand B the answer through `deep_wait` or a still-open `deep_ask`), the hook-reply and `delivery.outcome` checks are the part in dispute; the `deep_wait` check stands either way. This goes to the user, not to the implementer.
- **The decision that follows your answer** appears in B's prompt reply as one of "your rules … from your decisions" (the chosen option's ID). Decisions apply to every session, so criterion 2 doesn't count that line as delivering the answer; it looks for the ask's handle and the option's label only.
- **An unstamped call after the clear** (criterion 1) is left open: the issue's Scope binds "each later call by that call's own unspent PreToolUse stamp", but the criterion only names the stamped call, so whether an unstamped session-bound call is refused or bound to B isn't tested.
- **"Exited" (criterion 3)** is SessionEnd with `reason: "prompt_input_exit"` and the process still running, its deep mcp connected (the issue's "with its deep mcp still connected"). The "attempt replaced" case in Scope isn't tested.
- **"A bound call's p95" (criterion 5)** is a call bound at the hello, the common case both sides can serve; a rotated call has no base number, since the base refuses it.

## Files

- `helpers.ts`: temp homes and cleanup by PID, worktrees with their spec, the past ask seeded through the record and asks core, the hub and `events.read`, the agent stand-in (`Agent`: hooks through the real deep-hook, its own `deep mcp`), `world` (a process bound to A) and `clear` (the `/clear` hooks), tool outcomes (`valueOf`, `errorOf` with error@2), the reference-Mac check and the base comparison.
- `fixtures/agent.mjs`: the Claude Code process stand-in.
- `rotation.test.ts` (1, 4), `answers.test.ts` (2), `exited.test.ts` (3), `budgets.test.ts` (5).
- `tsconfig.json`: type-checks the suite under the root's strict options with `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the base run.
