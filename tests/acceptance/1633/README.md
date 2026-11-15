# Acceptance tests for #1633: a review thread reopened after a reviewer resolved it opens its item again

Issue #1633, "A review thread reopened after a reviewer resolved it stays closed, so the PR can say Closes over a live
review note". Written first, blind, by a job that never saw an implementation. Sources:

- **The issue**: its Scope, the three acceptance criteria and Proof ("#323's suite fixtures with recorded GitHub
  answers, through the real hub. The first criterion is shown failing on the merge base"), and what #323 and #87 state.
- **The design**, `docs/technical-design.md`: How runs become one of five verdicts ("Open items as records": an item
  closes only on qualifying evidence, your answer or a rule, the same item raised twice is one record, and it reaches
  you only through an ask; "Known failures are waivers": closing an item without evidence is a waiver); What done
  means, fixed at the start ("Done means switched on": review notes on the PR keep it from Closes until each is fixed
  or you accept it).
- **`AGENTS.md`**, and the base commit's code, read for its surfaces only: `packages/hub` (`open-items.ts`: items as
  `open_item.opened` / `open_item.closed` under `item`, a thread's accept ask and a "Not verified" item's waive ask;
  `core.ts`: the Closes rule over `openNotes`; `plant.ts`: `DEEP_HUB_PLANT`; `server.ts`: the `DEEP_HUB_TEST_*`
  settings), and the suites of #322, #323, #87 (gate) and #1537.
- **The base commit**: `ede4b367` (main).

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## How to run

With Node 24.22 first on `PATH` and the Rust toolchain:

```sh
npm ci                                   # once
npm run build --workspaces               # the hub and the deep CLI the tests start
cargo build --locked -q -p deep-hook     # target/debug/deep-hook, which every hook runs
npx vitest run tests/acceptance/1633 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1633/tsconfig.json
```

Every scenario starts a hub of its own, so the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list (`alone`),
beside #87/gate's and #1537's; the implementer adds it. No network, no real model, no `gh` login. The tests import,
and never edit, #322's world and helpers (`tests/acceptance/322/helpers.ts`, `work.ts`: the temp world with `HOME` set
to it, the test work source's issue 7, the hub as a process, Claude Code sessions through the real deep-hook,
`events.read`, `deep inbox answer`, processes stopped by PID only), #323's open-item readers
(`tests/acceptance/323/helpers.ts`: `itemsOf`, `itemId`, `closingsOf`, `isOpen`, `strings`, `testCheck`) and #323's
recorded GitHub answers (`tests/acceptance/323/github.ts`: `prAnswers`, `Thread`, `REVIEWER`), rewritten between
claims with `recordAnswers`, as #87's gate suite (`review-notes.test.ts`) does.

## The scenario

The session starts from issue 7 of the test work source ("Fix <link> and open a pull request": the prompt names the
pull request, so #84's `pr-needs-ask` default lets `gh pr create` through), makes R1's drafted check and the spec's
unit check pass, and opens PR 21 with the body "Part of #7, R1 to prove" (R1 listed under the Part of line, so #82's
rule doesn't hold the PR while R1's runs are still to come). GitHub's recorded answers give PR 21 one review thread T,
`PRRT_kwDOAcme1633a`, whose first comment is maya's (the reviewer, `REVIEWER`). Three claims (stops) follow, with a
small edit before each:

1. **Claim 1**: T unresolved. Its item opens, and its accept ask is raised.
2. **Claim 2**: the answers say T is resolved by maya. Its item closes.
3. **Claim 3**: the answers say T is unresolved again. Then the agent tries `gh pr edit 21 --body "Closes #7"`.

## Criteria to tests

Each test name and failure message starts with its criterion's number and ID, `#1633.<first 8 hex of SHA-256 of the
criterion's text>`, trimmed and white space collapsed (`scripts/proof-change.mjs`). All tests are in
`reopened.test.ts`.

| ID | Criterion (short) | What the test reads |
|---|---|---|
| AC1 `#1633.4b7df9d5` | claim 3 sees T unresolved again: the item is open, the PR can't say Closes; the base leaves it closed, naming T | T's item (the `open_item.opened` naming T at claim 1) is open after claim 3 (`isOpen`: an opening with the same `item` after its last closing), opened again once under the same ID; that new `open_item.opened` cites the closing it replaces (the closing's event ID, its log position, or its `by` text); `gh pr edit 21 --body "Closes #7"` is refused and the refusal names T; and exactly one accept ask naming T is open after claim 3 (claim 1's still standing, or one raised again), none of them answered. On the base the first of these fails, naming T and the closing that stays |
| AC2 `#1633.216b72d6` | you accepted T's note before claim 3: it stays closed, no new ask | after claim 1 you accept T's note through its ask (`deep inbox answer … accept`), which closes it; after claim 3 T's item is closed and no `ask.created` naming T comes after your answer |
| AC3 `#1633.54f387d7` | a final-message item your waiver closed, raised again, stays closed by the waiver; a hub that reopens every item fails | every stop's final message also says "Not verified: - The refresh flow with an expired token in Safari"; after claim 1 you waive that item through its ask; after claim 3 it is closed, with no opening and no other closing of it after your waiver's, and no new ask names it. The same judgement run on `DEEP_HUB_PLANT=reopens-every-item` must fail, naming the item |

AC1 and AC3 read one scenario (the sequence with the "Not verified" item), played once; AC2 and the planted run have
their own world and hub.

## Readings where the issue leaves a choice

- **"Accepted T's note before claim 3"** is read as an answer that closed it: you accept after claim 1, while the item
  is open, so your answer is its last closing (Scope: "An item your answer closed (waived or accepted) stays closed").
  Claim 2's resolution then finds it closed already.
- **"The PR can't say Closes"** is #87's surface: `gh pr edit 21 --body "Closes #7"` is refused at PreToolUse, and the
  refusal names the note. R1 is proven by claim 3, so only the note can hold it.
- **"Its accept ask is raised again only when none is open for that item and you never answered one"**: in AC1's
  sequence nobody answers T's ask, so after claim 3 one ask for T must be open, and only one (never the same question
  twice). Which ask that is (claim 1's, or one raised again) is the implementer's. An ask is open when no
  `ask.answered`, `ask.cancelled`, `ask.moot`, `ask.superseded` or `ask.defaulted` names it as its subject.
- **"Cites the closing it replaces"** is any field of the new `open_item.opened` holding the closing's event ID, its
  log position, or its `by` text (here "review thread PRRT_kwDOAcme1633a resolved by maya"); the field's name is the
  implementer's.
- **A final-message item** is one of the "Not verified" section, the kind of item that reaches you through an ask
  that waives it (#323 AC11).

## Wrong programs

| Criterion | Wrong program | How |
|---|---|---|
| AC1 | the base: `atClaim` skips an item the record holds, open or closed | `BASE-FAILURE.txt` |
| AC2 | a hub that reopens an item your answer accepted, or raises its ask again | not planted; `reopens-every-item` would fail it too |
| AC3 | a hub that reopens any item raised again, whatever closed it | `DEEP_HUB_PLANT=reopens-every-item`, which the implementer adds to `packages/hub/src/plant.ts`; on the base the plant doesn't exist, so the hub doesn't start and that test is BLOCKED |

## Files

- `reopened.test.ts`: the criteria's IDs, the scenario and the three judgements, and the planted run.
- `tsconfig.json`: the root's strict options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit.
