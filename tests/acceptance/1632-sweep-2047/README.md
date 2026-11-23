# Blind acceptance test for #1632 criterion 2 (`#1632.b9d4ec97`)

Written first, blind, by a job that saw only the issue, the design and the base commit. The implementer doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft by this job. This job adds no `twins.json` or `twins/`: the implementer does that.

## Inputs

- Issue #1632's body, as handed to this job (opening, Scope, the five acceptance criteria, Proof, References). Only the second criterion is this folder's target.
- `AGENTS.md`; `docs/technical-design.md`: Socket roles and contract versions (its "One role per credential" bullet: "a rotated session ID is bound again, a successor never inherits a binding"), the "Threads, not IDs" bullet, Dogfooding.
- The base commit `61aa8eb06` (`origin/main`): `packages/hub/dist/mcp-operations.js` and `packages/hub/src/mcp-operations.ts` (`bind`, `rebound`, `waitFor`) and `packages/hub/src/tools.ts`, read to learn tool shapes only. The first drafts in `tests/acceptance/1632/` (README, `helpers.ts`, `fixtures/agent.mjs`, `rotation.test.ts`, `answers.test.ts`, `redraft-ac2/`), reused by import and path, not edited.

Not read: PR #2092, its diff or commits; `git log`, `git show` or `git blame` of the hub sources; any GitHub PR or issue comment. `gh` wasn't run.

## The ID

The first 8 hex digits of SHA-256 of the criterion's text with the leading `- [ ] ` dropped, trimmed and whitespace collapsed (`tests/acceptance/48/README.md`'s rule), computed here from the issue body: `b9d4ec97`. The other four criteria give `62d3152b`, `a3eebb10`, `be55c5e4`, `c4de6dbc`, matching `../1632/README.md`, so the rule was applied as that suite applies it. The test's name starts with `#1632.b9d4ec97 `. `../1632/redraft-ac2/` tests an earlier wording under `#1632.681ec30e`.

## The test (`ac2.test.ts`)

The surface of `../1632/README.md`: `../1632/fixtures/agent.mjs` is one Claude Code process whose hooks are the real `target/debug/deep-hook` and whose one `deep mcp` (`packages/cli/dist/main.js mcp`) is its child, kept across `/clear`; `deep hub run` in a temporary home; `deep inbox answer` with #24's confirmation stub; `events.read` on the socket. No `claude` binary, network or model.

Setup. Each step throws `BLOCKED` (an error, not an assertion) when it is missing, so a setup failure reads apart from the verdict:

1. `world()`: session A, its `deep mcp` bound to A at its hello (`deep_status` names A).
2. A's `deep_ask`: a taste call with random option IDs and labels, recommending the first. It goes on provisionally, so no call is held across the clear. Its `ask.created` must be under A.
3. `/clear` (`clear()`): SessionEnd `clear` for A, then SessionStart `clear` for B from the same process, with B joined to A's thread.

Judged. Every call except one is stamped first by B's PreToolUse:

4. B's `deep_wait` on A's ask, sent **before** you answer and still open while you answer. You answer with `deep inbox answer <ask> <the option A didn't go on with>`, and `ask.answered` must follow (BLOCKED otherwise).
5. B's next prompt (`UserPromptSubmit`). Its reply is the thread's delivery and isn't judged.
6. B's calls: `deep_wait` on A's ask; `deep_wait` on A's ask with no PreToolUse; `deep_status`; B's own `deep_ask` (another question); `deep_claim`; `deep_open_item`. Then you answer B's own ask with its non-recommended option, and B's `deep_wait` on its own ask follows. Last, `deep_wait` on A's ask again.

The assertions come in two parts, in this order:

- **The criterion** (first `expect`). No reply B gets carries your answer to A's ask. A reply carries it when it holds the chosen option's label anywhere, or its value's `answer` is the chosen option. For a `deep_wait`, it also carries it when the wait succeeds with A's ask `answered` or `decided`, or holds the chosen option's ID. For any other call, it carries it when it names A's ask at all. A refusal of `deep_wait` on A's ask (`not_found`, `unbound`) carries nothing.
- **Not by refusing everything** (second `expect`). B's stamped session-bound calls act for B:
  - B's own `deep_ask` is filed under B;
  - B's `deep_claim` is recorded once, under B;
  - B's `deep_open_item` is recorded once, under B;
  - B's `deep_wait` on its own ask returns `answered` with your answer to it.

Every call's outcome is printed (`--silent=false`).

## Readings where the issue leaves a choice

- **"Returned to B as B's own through deep mcp"** covers any `deep mcp` reply to a call that the process now running B makes after the clear. It counts whether the hub binds the call to B by its stamp or still to A, because both reach B's conversation.
- **"B's deep_wait on that ask"** includes a wait sent before your answer and held while you answer, not only waits after it. Claude Code may call `deep_wait` at any time after the clear, and the criterion fixes only when you answer.
- **"Every other session-bound call"** is the session-bound tools that settle quickly: `deep_status`, `deep_ask`, `deep_claim`, `deep_open_item` and `deep_wait` on B's own ask. `deep_evidence` and `deep_run` are left out because they need a run or a file. The unstamped `deep_wait` is included because the issue doesn't settle what an unstamped session-bound call does after the clear. It may be refused or bound, but it must not carry the answer.
- **The positive part is this job's reading, and it may be disputed.** The criterion speaks of "B's `deep_wait`" and "every other session-bound call B makes", which presumes those calls are B's. Scope ("so the call acts for the new ID") and criterion 1 say they are. So a hub that refuses every call after the clear doesn't pass. Without the second `expect` it would pass the first one vacuously, as `../1632/redraft-ac2/` passed on its base. The positive part overlaps criterion 1 (`deep_claim` under B) and adds the other calls Scope binds by stamp. If the owner reads criterion 2 as the negative part only, the second `expect` is the part in dispute. The first stands either way.
- **The chosen option's ID** is checked only in a `deep_wait`'s success or an `answer` field. Your answer becomes a decision, and a reply may list decisions. The random label is checked anywhere.
- **Delivery along the thread** isn't part of this criterion, as it says: B's prompt reply and `delivery.outcome` are neither required nor forbidden.

## Wrong programs, and how the test catches them

These were run on scratch APFS clones of the built base, with `packages/hub/dist/mcp-operations.js` patched. They were deleted after the runs, and no twin files were added.

| Wrong program | Patch | Result |
|---|---|---|
| (a) A's connection keeps acting for A after its SessionEnd `clear`, so B's calls, `deep_wait` included, are served as A's | `rebound()` returns the context unchanged; `bind()` returns the hello's session even when it has ended | **FAIL at the first `expect`**: all four `deep_wait`s on A's ask return `{status: "answered", answer: <your option>}`. `deep_status` and the claim name A. |
| (b) B's calls are rebound by stamp, but B's `deep_wait` may read an ask A raised | `waitFor()`'s owner check `row.session_id !== session` dropped | **FAIL at the first `expect`**: the held wait and both later stamped waits return your answer; the unstamped one is refused `unbound` |
| (c) Every session-bound call after the clear is refused (the vacuous pass) | `rebound()` returns the context unchanged | **FAIL at the second `expect`**: B's `deep_ask`, `deep_claim` and `deep_open_item` are refused `unbound` naming A, and no ask of B's is waited on |

## On the base `61aa8eb06`

**PASS** (`BASE-RUN.txt`, "Tests 1 passed (1)", exit 0). The base already rebinds a rotated connection by stamp (`rebound()`, #1632). B's waits on A's ask:

- stamped: refused `not_found` ("Wait on an ask this session raised…");
- unstamped: refused `unbound`.

B's other calls act for B, and B's wait on its own ask returns your answer to it. On the base this test is regression protection. Note that the issue said the base refuses with `unbound`, but this base no longer does.

## Run

From a built checkout (`../1632/README.md`, Run), with `../1632/helpers.ts` and `../1632/fixtures/` present:

```sh
npx vitest run tests/acceptance/1632-sweep-2047 --silent=false   # --silent=false prints each call's outcome
npx tsc -p tests/acceptance/1632-sweep-2047                      # type-check
```

The test starts real hubs, so it belongs on the unit lane's one-at-a-time list with `tests/acceptance/1632/`. That change is the implementer's.

## Files

- `ac2.test.ts`: the test.
- `tsconfig.json`: type-checks it with `../1632/helpers.ts` under the root's strict options.
- `BASE-RUN.txt`: the base run, home paths redacted to `~`.
