# Blind redraft of #83's status tests for #319's batches

AC2 `#83.5bcede40`: "A status question returns the state, time in state, next step and the Needs-you count with no model
call". A fresh run of the blind acceptance-test job (AGENTS.md, Proof; design, Dogfooding) for this criterion, at base
`b1a1ff862` (main). It never saw an implementation, a branch, a diff or a pull request. It edits no test outside this
folder; the earlier #83 suite (`../`) is an input it imports from (`../helpers.ts`, unchanged) and doesn't change.

## The dispute

`../status.test.ts` (AC2) runs `deep setup`, has a second session raise an ask through `deep_ask`, and at once expects
the status answer's `needs you` count to equal the number of asks `inbox.read` returns. #319 says asks come in batches:
setup drafts batches 8 hours apart with a daily cap (`asks.batch: { every, cap }` in `~/.deepbuild/config.json`; with no
`asks.batch`, every ask shows when it's raised), and an ask waiting for its batch isn't shown in Needs you until the
batch. So an ask raised just after setup waits, Needs you shows no row for it, and the first draft's count can't hold.

Settled by the owner, and taken as given here: the status answer's Needs-you count is the number of asks Needs you
shows, the same rows `deep inbox` and the app list. An ask still waiting for its batch isn't counted.

## What changed

Only AC2's count, proven from both sides:

- **An ask that has shown is counted** (the first draft's AC2 test, its id and title kept). The home's settings have no
  `asks.batch`: `deep setup` drafts them against a first hub, the test takes `asks.batch` out of `config.json` as you
  would, and a second `deep hub run` starts on them. The ask raised through `deep_ask` then reads `shown` and
  `unanswered` in the hub's inbox (`inbox.read`), `deep inbox --json` lists its row, and each of the four questions'
  answers carries `needs you` beside the number of rows `deep inbox --json` lists. Every other expected value (a state
  word, a time, `next`, no model line, a work prompt reaching the model) is the first draft's.
- **An ask still waiting for its batch isn't counted** (new, same criterion). Under the settings `deep setup` drafts
  (`asks.batch.every` is `8h`, `cap` a number), an ask raised between batches reads `queued` and `unanswered` in
  `inbox.read`; `deep inbox --json` has no row for it and `deep inbox` doesn't print its question; nothing else was
  raised, so Needs you shows 0 asks, and each question's answer carries `needs you` beside 0. The ask still reads
  `queued` after the answers.

A hub that counts every open ask fails the second test; one that counts none fails the first.

## What didn't

- AC4's two tests (its wrong-program test included) and AC6's test are `../status.test.ts`'s, byte for byte apart from
  the import path.
- `../helpers.ts`, the stand-in, the fixtures and every other #83 file. `diff ../status.test.ts status.test.ts` shows
  the whole change.
- #83's suite has no "(wrong program)" test for AC2 in this file; its AC2 twin (`../twins/status-reaches-model`) is
  about the model call, which this redraft doesn't touch.

## Decided where the issues leave it open

- **Which surface is "the asks Needs you shows".** `deep inbox --json`'s `rows`: the owner's words name `deep inbox`'s
  rows. `inbox.read`'s `asks` (the first draft's count) is the inbox projection, which holds every ask with its status,
  a waiting one included (#319: "Inbox projection with status, owner and age"), so it is read here only for the ask's
  `status` and `outcome`.
- **The words `queued`, `shown` and `unanswered`** are #319's suite's (`tests/acceptance/319/README.md`, The surface).
- **Whether `deep_ask` holds its session** (#319: "an ask shows at once when a session is held waiting on it"). Taken
  from the dispute as given: an ask raised through `deep_ask` just after setup waits for its batch. The ask is the first
  draft's, a `choice`, whose drafted deadline (2 days) is past the next batch, so the deadline rule doesn't show it.
- **A batch falling inside the test.** Batches fall at the whole multiples of `every` since the Unix epoch (#319's
  suite: 00:00, 08:00 and 16:00 UTC for `8h`). Started within 4 minutes of one, the waiting test sleeps until 5 s past
  it before it raises the ask; the test takes a few seconds from there.
- **How a hub comes to settings with no `asks.batch`.** Setup drafts the key whenever it's absent, and the issues don't
  say a running hub rereads the file, so the first test edits the file after setup and starts a new hub on it.
- **The daily cap's value** isn't in the issues, so only its presence is checked.

## What it read

- AGENTS.md; issues #83 (AC2, AC4, AC6), #319 (Scope, criteria) and #22.
- `docs/technical-design.md`: Every ask ends ("Asks come in batches…"); the view row (Needs you: the asks as rows); the
  Asks and batches timing relation; The verdict in the chat (a status question); Dogfooding.
- The earlier #83 folder: README, `status.test.ts`, `helpers.ts`, `twins.json`; `redraft-669/` and `redraft-1460/` for
  the layout; `tests/acceptance/319/README.md` for #319's settings and inbox words.
- Base source, only to learn which surfaces exist at the base: `packages/asks/src/index.ts` (what setup drafts) and
  `showing.ts`, `packages/hub/src/inbox.ts` (`deep inbox`, `--json`), `server.ts` (`inbox.read`), and the status answer
  in `core.ts` and `verdict-chat.ts`. A throwaway probe on the base (removed) printed `inbox.read`'s and
  `deep inbox --json`'s shapes. No expected value comes from them.

## How to run

Node 24 first on `PATH`, the workspaces built (`npm ci --ignore-scripts && npm run build --workspaces`) and `deep-hook`
built (`cargo build -p deep-hook --bin deep-hook`), as #83's suite needs:

```sh
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/83/redraft-319 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/83/redraft-319/tsconfig.json
```

Five tests, no model and no network, about 15 s (up to 4 minutes more when started just before a batch time). Each
starts a real `deep hub run` under a fresh temporary home with #83's Claude Code stand-in (nothing touches
`~/.deepbuild` or `~/.claude`), and stops only the processes it started, by PID.

On the base (`BASE-FAILURE.txt`): the waiting test fails on its named expect, "Needs you shows no row for …, which
still waits for its batch": the base's inbox reads the ask `queued` but `deep inbox` lists it. The other four pass.

## Files

- `status.test.ts`: the redraft of `../status.test.ts`.
- `tsconfig.json`, `BASE-FAILURE.txt`.
