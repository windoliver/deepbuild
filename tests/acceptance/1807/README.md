# Acceptance tests for #1807: the receipt keeps its place, ⌘Z undoes it, and Decided is a page

Written first and blind, at base commit `0beb4a141` (Merge pull request #3754), from issue #1807 (its problem, Scope, six
acceptance criteria and Proof; it has no comments), the design and the base, before any implementation. The implementing
agent does not edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).
`TASTE.json` is the one file here a person's call changes.

## What was read

- Issue #1807; #1461, #1462 and #1101 (its dependencies, closed and on the base), and #109, #1345, #23 and #328 only for the
  words #1807 cites (a rule's firing, a default, a resolver's answer, Needs you).
- `docs/technical-design.md`: An ask, and your answer getting back; First-party extensions that ship on by default (the view
  row, resolver-decisions). `docs/canvas-primitives.md`: Question card (the answered card's one-line receipt with Undo).
  `GLOSSARY.md` (decision, standing rule).
- At the base: `crates/deep-app/src/{actions.rs,actions.json,card.rs,question.rs,kinds.rs,said.rs,list.rs,rows.rs}`;
  `crates/deep-replica/src/drive/{mod,see,frames,hubcopy}.rs` (`launch` with `fixture` and `theme`, `wait_for` with
  `step_ms`, `open`, `see` with `hub` and `menus`, `act` click/press/type with `source: "hid"` and `menu`, `feed`,
  `screenshot`); `packages/hub/src/{holds,server}.ts` (`test.clock`); `packages/asks/src/index.ts` and
  `packages/record/src/projections.ts` (`ask.defaulted`, `decision.created`, `decision.applied`, `approval.held`);
  `packages/contracts/schemas` for those kinds; the suites `1101`, `1461`, `1462` and `1462-redraft-ac2`, whose world,
  replica driver and builds `helpers.ts` copies with changes (it imports only `../16/helpers.ts`, as they do).

## How to run

With Node 24.22 first on `PATH`, cargo (1.99.1) on `PATH`, the workspaces built, on macOS:

```sh
npm ci --ignore-scripts && npm run build --workspaces
npx vitest run --root tests/acceptance/1807 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1807/tsconfig.json
DA1807_SCREENS=<dir> npx vitest run --root tests/acceptance/1807 shown --testTimeout=600000
```

- **Builds** are #1101's, each only when a test needs it, each in a `scripts/throttle.mjs build --wait 240` grant with
  `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0`: `deep-hook` into the checkout's target, where the hub looks for it;
  `deep-drive` with `--features deep-app/test-confirm`, and with `env-plants` too followed by the plain build again, each
  copied to `$TMPDIR/da1807-bin-<uid>-<checkout>/`. A binary newer than every Rust source is used as it is.
  `CARGO_TARGET_DIR` is honored.
- **Folders and processes.** Homes are under `/tmp` (#16's `tempDir`). Nothing touches the real `~/.deepbuild`,
  `~/.claude` or `~/Library/LaunchAgents`. Only what a test started is stopped, by PID. No network, no model, no window.
- **Lanes.** `lane.json`: alone, since the files build with cargo and start hubs whose hold runs on real time.
- Vitest writes `tests/acceptance/1807/node_modules/.vite/` under `--root`; delete it before committing.

## The surfaces (my choice where the issue names none)

### The world, the clock and the answer

**The hub** is #1101's: a real `deep hub run` in a temp HOME with the shipped guards, holding an agent's `git push origin
main` (the push, ask A) and, where a second ask is open, its `git push origin v2.0.0` (ask B), each with an authority ask.
A push can't be undone, so a yes to it is held 10 s by the hub (#1101). **The virtual clock** is the hub's test clock
(DEEP_HUB_TEST_CLOCK a minute after the replica's NOW, `test.clock` to step it), which also runs with real time, so a run
whose hub passed 9 s into a hold before ⌘Z reached it is INCONCLUSIVE, never PASS.

**The app** is the real `deep-drive` (#124) launched on a copy of that hub's record (`launch.from: "fixture"`), its clock
moved to the hub's now. **You answer in the app**: A's page is opened, and once its card reads `armed` one hardware press
(`act click`, `source: "hid"`) on `card-option:<allow option>` makes the app send `ask.answer`. That call (read from `see`'s
`hub` list) reaches the real hub signed, as the app sends it (#1101's paired device); the hold starts at the `ts` of the
`ask.answered` the hub records. Every event the hub records after the copy is then fed to the running replica (`feed`),
except that `ask.answered`, which the replica's own copy of the hub has already recorded. Seconds "into the hold" are on
the replica's clock from that `ts`.

### Pinned here: the implementation must provide these

1. **The answered row** (AC1). The list (`id: "list"`) keeps A's row, `ask:<ULID>`, while its Undo is live. The row's
   strings (the row node, its slots `ask:<ULID>:<slot>` and what it holds) read `Starts in`, and it shows Undo: a node
   named `Undo`, a node whose id ends `:undo`, or a string holding `Undo`.
2. **The card stays** (AC1, AC3). 4 s into A's hold the window's address is still `ask/<ULID>` of A and its
   `question-card` reads `Starts in` beside an Undo control (a node named `Undo`, or `card-undo`), though B is open (AC1)
   or nothing else is (AC3, read at 0.2, 2.2, 4.2, 6.2, 8.2 and 9.4 s).
3. **⌘Z from any page** (AC2). At 6 s B's page is opened (`open ask/<B>`), then `cmd-z` is pressed (`act press`,
   `source: "hid"`). The app sends `ask.undo {"ask": "<A>"}`, the call #1101's receipt Undo sends; it is forwarded to the
   real hub signed. Then the hub's inbox lists A open and unanswered; after the hub's events are fed, 7 s in, A's row is
   at the index among the list's rows it had before the answer and no longer reads `Starts in`; at 12 s the agent's same
   push is refused and `origin` holds no `main`.
4. **Decided** (AC4, AC5). The View menu (`see`'s `menus`) holds an item titled exactly `Decided`; picking it (`act
   menu ["View", "Decided"]`) opens a page whose `page-title` node's name holds `Decided`. ⌘K (`cmd-k`), typing `Decided`
   and Return does the same, `command-list` holding a `list_box_option` named exactly `Decided`. No node in the list (its
   id, name or string value) holds the word `decided`, in any case.
5. **Needs you's count** (AC4) is `heading:needs-you`'s value (#1461), the first number in it.

### The Decided record (AC4, AC5)

`fixtures/record.events.jsonl`, in the replica's fixture form, events as the core writes them: three sessions (`Cart
totals` in shop; `Release notes` and `Search index` in docs) and six asks, newest last:

| Ask | How it settled | Question |
|---|---|---|
| `…AK…06` | you answered `squash`, saved as a standing rule for everywhere (`decision.created`, scope `all`) | How should fix pull requests merge? |
| `…AK…02` | **a default**: its deadline passed, `ask.defaulted` | Which header colour for the cart page? |
| `…AK…03` | you answered `vitest`, saved for the repo (`decision.created`, scope `repo:docs`) | Which test runner for the search index? |
| `…AK…04` | **a decision applied for you**: the repo decision, `decision.applied` | Which test runner for the search worker? |
| `…AK…05` | **a rule's firing**: the standing rule for everywhere, `decision.applied` | How should the search fix pull request merge? |
| `…AK…01` | open | Which store keeps the release notes? |

AC4 reads the three in bold on the Decided page by their questions, and that none of the five settled asks has a row in
the list and Needs you counts 1.

## Plants

Each is an app plant, selected by `DEEP_HUB_PLANT=<name>` and read through `deep_app::plain::planted` in `deep-drive`'s
`env-plants` build (the hub is given the name too only if `packages/hub/src/plant.ts` lists it). Each plant's test first
holds the clean run to the same judge, so a program that already fails can't make its plant look caught.

| Plant | Criterion | The wrong program | Must fail naming |
|---|---|---|---|
| `answered-row-leaves-at-2s` | AC1 | the list drops an answered row 2 s after its answer, whatever its hold | A, and its row |
| `undo-clears-receipt-only` | AC2 | ⌘Z clears the receipt in the app and sends no call | `ask.undo` for A |
| `last-receipt-jumps-away` | AC3 | within the Undo window the page jumps elsewhere after the only open ask is answered | A, and the page it jumped to |
| `settled-row-under-needs-you` | AC4 | a settled ask is listed under Needs you and counted | the count |
| `decided-row-in-list` | AC5 | the list holds a row for Decided | the Decided row |

## Criterion to tests

| Criterion | ID | Test | On the base |
|---|---|---|---|
| AC1 the push allowed at 0 s shows "Starts in" and Undo on its row and its card at 4 s, a second ask open; a list that drops the row at 2 s fails naming the ask | `#1807.7b07b348` | `hold.test.ts` (1), (2) | FAIL |
| AC2 ⌘Z at 6 s leaves the push not run and the ask open again in place; an app that clears its receipt and sends nothing fails naming the missing call | `#1807.9f2f358f` | `hold.test.ts` (3), (4) | FAIL |
| AC3 answering the only open ask leaves its receipt and Undo on the page; an app that jumps away within the Undo window fails | `#1807.77fab939` | `last.test.ts` | clean PASS (the base has it), plant FAIL |
| AC4 a default, a rule's firing and a decision applied for you show on Decided, never under Needs you; a settled row under Needs you fails naming the count | `#1807.55e5c424` | `decided.test.ts` (1), (2) | FAIL |
| AC5 Decided is in View and ⌘K, no list row opens it; a Decided row in the list fails naming it | `#1807.ed9995d7` | `decided.test.ts` (3), (4) | FAIL |
| AC6 the pictures, light and dark; one taste call; INCONCLUSIVE without it | `#1807.9a39e256` | `shown.test.ts`, `TASTE.json` | FAIL before any picture |

IDs are `#1807.<first 8 hex of SHA-256 of the criterion's text, whitespace collapsed>`. No test passes when its surface is
missing: a missing build, hub, ask or page stops it `BLOCKED: …` or fails naming what's missing. One criterion-tagged
test passes at the base on purpose: AC3's clean test, since #1101's receipt already keeps the only answered ask's receipt
and Undo on its page; its planted wrong program is what it fails on. AC4's Needs-you half holds at the base too; it fails
on the missing Decided page. See `BASE-FAILURE.txt`.

## Readings where the issue leaves a choice (a redraft may revisit them)

1. **"Undo on its row"** is any Undo the row holds or says (Pinned 1); the Scope names only the row's state word and time.
2. **"Its card at 4 s"** is the card the window still shows on A's page, not a page opened for it (Pinned 2).
3. **"From any page"** is B's page, the next ask's, which the window would have moved to.
4. **"Open again in place"** is the row's index among the list's rows, as before the answer, and the hub's inbox.
5. **A rule's firing** has no event of its own on the base (#109 is open): it is a standing rule's `decision.applied`, the
   rule saved for everywhere; the decision applied for you is a repo decision's. Both are decided for you.
6. **AC6's pictures** are taken from the app's own views drawn by `deep-drive` at its default window, light and dark
   (`launch.theme`), over copies of a real hub's record, not from the real `deep-app` process: a deviation from "from the
   real app", kept to spare the run a real window, its permissions and its timing. "Attached to the PR and shown to you in
   the session" no test can see. The taste call is TASTE.json's `verdict` on exactly the files the run wrote, by SHA-256.

## Scope the criteria don't cover

No criterion names these, so nothing here tests them: focus on the list after the last ask; the receipt's other words
("Answered", "Allowed · ran"); the card staying until the step starts; Edit's menu item's name; Decided's order, its
cards' closed state and their Undo or Overrule; notifications.

## Files

`helpers.ts` (IDs, plants, builds, the world, the agent, the app's signed calls, the replica driver, the judges),
`hold.test.ts` (AC1, AC2), `last.test.ts` (AC3), `decided.test.ts` (AC4, AC5), `shown.test.ts` (AC6), `TASTE.json`,
`fixtures/record.events.jsonl`, `lane.json`, `tsconfig.json`, `BASE-FAILURE.txt`.
