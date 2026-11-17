# Blind redraft of #39's AC5

AC5, `#39.de9f23ce`: "Two Codex threads on one daemon each call `deep_ask`, and each ask is filed under its own session". `ac5.test.ts` is a blind redraft of its test, written from the issue, the design and base commit 031292bf1.

## What I read

- Issue #39, AGENTS.md, and in docs/technical-design.md: Socket roles and contract versions, the hook protocol, the Codex row, Who is calling, the hook edge-case list, the Ask and Decision primitives and the `deep_ask` timing relation.
- In tests/acceptance/39: helpers.ts, fixtures/ (daemon.mjs and Codex's hook output schemas), README.md, criteria.json, and the opening lines of BASE-FAILURE.txt, which name the first draft's AC5 case and say it passed on its base.
- Public surfaces: the schemas of `session.start`, `tool.before`, `ask.created` and `hook.request` in packages/contracts; the record's `Event` type; adapters/corpus/README.md; the `daemon` entry in adapters/codex.facts.json; the usage of `deep inbox` and how the CLI starts `deep mcp`; the vitest config, its test globs and tests/vitest-setup.ts.

I never saw the first draft's tests (tests/acceptance/39/*.test.ts), the twins (twins/, twins.json), the hub's binding code (packages/hub/src/mcp-operations.ts, mcp.ts) or its history, reports/, PR #2236, or issues #1687 and #2345. The type-check printed error paths under twins/ after the test was written; none was opened.

## The brief's single disclosure

> Every case must give the same result on every run of the same program. Where the criterion involves two threads whose hooks and calls could reach the hub in more than one order, don't send them at once and leave the order to chance. Fix each order the case relies on explicitly: await each hook and each call, or the event it records, before sending the next. Cover both orders in which the two threads' `deep_ask` calls can reach the hub relative to the two threads' PreToolUse events. The criterion says "each", so a program that binds correctly in only one order must fail.

## The cases

One daemon stand-in is the parent of both threads' hooks and of one `deep mcp`, which starts first. Each thread then starts a turn and asks its own question with its own option IDs, so its call's arguments match only its own PreToolUse. In both cases A's PreToolUse for `mcp__deep__deep_ask` goes first, then B's, and each must be in the record before the next step. Then the two `tools/call`s go, and each call's ask must be in the record, or the call must have replied, before the next call.

| Case | Calls | A hub that binds this way fails it |
|---|---|---|
| In the PreToolUse order | A's, then B's | to the newest unspent PreToolUse |
| Against it | B's, then A's | to the oldest unspent PreToolUse |

A hub that binds the daemon's one `deep mcp` to one session fails both. A case passes only when A's ask is filed once, under A's session, and B's once, under B's.

## Surfaces assumed

- An event's `session` in the hub's event read is the payload's `session_id`. This holds for the thread's hooks and for the ask its call files (adapters/corpus/README.md).
- A PreToolUse is recorded as `tool.before` in its session. Neither thread makes another tool call.
- `deep_ask` takes the `choice` helper's shape, and an ask is `ask.created` with `data.question`.
- A PreToolUse reply of `decision: block` or `permissionDecision: deny` keeps Codex from calling, so it fails the case. A reply of `permissionDecision: allow` with `updatedInput` makes Codex send that input, so the stand-in sends it, as a binding by one-time nonce needs. Otherwise the call carries the thread's own arguments.
- `deep mcp` takes the second call while the first waits. If it serves one call at a time, the second ask arrives once the first call says "still waiting". That is 55 s in at Codex's default tool timeout, within the case's 90 s wait.
- No ask is answered. After the check, the waiting calls are left, and the daemon and every process are stopped.

## Run

After `npm run build --workspaces` and a `deep-hook` build (`cargo build --locked -p deep-hook`):

```
npx vitest run tests/acceptance/39/redraft-ac5 --testTimeout=600000
```

Type-check: `npx tsc --noEmit -p tests/acceptance/39/tsconfig.json`.
