# Blind redraft of #1632 criterion 2 (`#1632.681ec30e`)

## Inputs

- Issue #1632 as read on November 8, 2026 (`gh issue view 1632`): the opening, Scope, the acceptance criteria and Proof. No comments.
- Criterion 2 as the owner reworded it and approved for this redraft (the issue body isn't updated yet). It is the criterion here:
  > A `deep_ask` that A raised before the clear, and that you answer after it, is never returned to B as B's own through `deep mcp`. B's `deep_wait` on that ask, and every other session-bound call B makes after the clear, never carries that answer as B's. Delivery of the answer along the thread joined across `/clear` stays as the design's 'Threads, not IDs' bullet says. That is the hook replies at B's next prompt, recorded as a `delivery.outcome`. It is not part of this criterion.
- `docs/technical-design.md`: Socket roles and contract versions ("One role per credential"), the "Threads, not IDs" bullet, Dogfooding. `AGENTS.md` (Proof).
- The base commit `ede4b367`: its hub source, read to learn tool shapes only (`deep_ask` with a recommendation returns `status: "provisional"` at once; `deep_wait` refuses `not_found` for an ask another session raised; `bind()` refuses `unbound` once the hello's session has ended).
- The suite's own `../README.md`, `../helpers.ts`, `../fixtures/agent.mjs` and `../rotation.test.ts` (for the shape of a call after the clear).

Not read: `../answers.test.ts` (the earlier draft), any branch, PR, diff or commit after `ede4b367`, and any `packages/hub/src` change.

The criterion ID stays `#1632.681ec30e`, the ID of criterion 2's original text, as the owner asked.

## The test (`ac2.test.ts`)

Through the real deep-hook, hub and `deep mcp` (the suite's surface, `../README.md`):

1. `world()`: one Claude Code process, session A, its `deep mcp` bound to A at its hello.
2. A raises a taste call with `deep_ask`: two options with random IDs and labels, recommending the first. It goes on provisionally, so no call is held across the clear. Its `ask.created` must be under A (BLOCKED otherwise).
3. `/clear` (`clear()`): SessionEnd `clear` for A, SessionStart `clear` for B from the same process, B joined to A's thread.
4. You answer with `deep inbox answer <ask> <the other option>`, the one A didn't go on with. Only your answer can carry that option's ID and label. `ask.answered` must follow (BLOCKED otherwise).
5. B's next prompt (`UserPromptSubmit`). Its reply is the thread's delivery and isn't judged.
6. B's calls through the same `deep mcp`. Each is stamped by B's PreToolUse first, except one:
   - `deep_wait` on A's ask, stamped
   - `deep_wait` on A's ask, not stamped
   - `deep_status`
   - B's own `deep_ask` (a new taste call with a recommendation)
   - `deep_claim`
   - `deep_open_item`
   - `deep_wait` on A's ask again, stamped

   Each call's outcome is printed.
7. The test fails if any of these replies carries your answer as B's:
   - the chosen option's label appears anywhere in the reply;
   - the value's `answer` is the chosen option;
   - a `deep_wait` on A's ask succeeds with that ask `answered` or `decided`, or a successful `deep_wait` holds the chosen option's ID;
   - any call other than `deep_wait` names A's ask at all.

   A refusal of B's `deep_wait` that names the ask (`not_found`, `unbound`) carries nothing.

## Readings

- **"Returned to B as B's own through deep mcp"** means any `deep mcp` reply to a call made after the clear by the process now running B. That covers both a call the hub binds to B by its stamp and a call it still binds to A, because both reach B's conversation. The test doesn't care which session the hub thinks the call is for: an answer in the reply counts either way.
- **"Every other session-bound call"** is the session-bound tools in suite 26's table that settle quickly: `deep_status`, `deep_ask`, `deep_claim` and `deep_open_item`. `deep_evidence` and `deep_run` are left out because they need a run or a file, and suite 26 doesn't pin their reply shape here. The unstamped `deep_wait` is included because the issue leaves open what an unstamped session-bound call does after the clear: it may be refused or bound, but either way it must not carry the answer.
- **The chosen option's ID** is checked only in a `deep_wait`'s success or as an `answer` field. The record turns your answer into a decision, and a reply may legitimately list decisions (the suite's README saw the option ID in B's prompt reply as a rule). The random label is checked anywhere.
- **Delivery along the thread** (B's `UserPromptSubmit` reply, `delivery.outcome`) is neither required nor forbidden, as the reworded criterion says. The test doesn't read hook replies or `delivery.outcome`.
- **B's own `deep_ask`** asks a different question, so a decision saved from your answer to A's question can't legitimately answer it.

## Wrong programs, and how the test catches them

Each twin is the built base `ede4b367` copied to a scratch dir, with `packages/hub/dist/core.js` patched. The patches and full outputs are in `TWIN-RUNS.txt`.

| Twin | Wrong program | Result |
|---|---|---|
| twin1 | A hub that binds B's call to A: an ended session's connection keeps acting for it (`bind()` returns the hello's session instead of refusing) | **FAIL**: all three `deep_wait` calls on A's ask return `{status: "answered", answer: <your option>}` |
| twin2 | A hub that rebinds each call to B by its stamp, but whose B `deep_wait` on A's ask returns A's answer (the ask-owner check is dropped) | **FAIL**: both stamped `deep_wait` calls return the answer. The unstamped one is refused `unbound`. |
| twin0 | Control: rebinds by stamp and nothing else (the base's `unbound` refusal is removed, so an ended connection falls through to the stamp match) | PASS: B's stamped `deep_wait` is refused `not_found`, the unstamped one `unbound`, and B's other calls succeed for B without A's answer |

twin0 shows that the test passes on a hub that does serve B's calls after the clear, so on the base it doesn't pass only because everything is refused. twin0 isn't the fix: it doesn't check for rotation, which criterion 3 covers.

## On the base `ede4b367`

**PASS** (`BASE-RUN.txt`). Every session-bound call B makes is refused `unbound`, naming A ("Session A has ended; this deep mcp acts for no session now."), and `deep_status` reports `session: null`. Nothing carries the answer. On the base this test is regression protection: it guards against a fix that makes B's calls work by binding them to A, or by letting B wait on A's asks.

## Run

From a built checkout (`../README.md`, Run), with this folder, `../helpers.ts` and `../fixtures/` present:

```sh
npx vitest run tests/acceptance/1632/redraft-ac2 --silent=false   # --silent=false prints each call's outcome
npx tsc -p tests/acceptance/1632/redraft-ac2                      # type-check
```

## Files

- `ac2.test.ts`: the test.
- `tsconfig.json`: type-checks it with `../helpers.ts` under the root's strict options.
- `BASE-RUN.txt`: the base run, home paths redacted to `~`.
- `TWIN-RUNS.txt`: the three planted twins' patches and runs, paths redacted.
