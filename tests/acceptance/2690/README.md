# Acceptance tests for #2690: an open ask's row, one word in `deep`, the hub's row and the app's drawn row

Written first and blind, at base commit `b4c099e2e`, from issue #2690's body (its "What's wrong", "Why each fix needs a
guarded change" and "Done when"), the design and the base, before any implementation. The implementing agent does not edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). There is no taste
criterion, so no `TASTE.json`.

## The criteria

The issue has no checklist, so the criteria are its "Done when", split where it names two things. IDs are
`criterionId` in `scripts/proof-change.mjs` over the text; `criteria.json` lists them.

- **C1** `#2690.50174a03`: `deep`, the hub's list row and the app's drawn row agree on an open ask's word
- **C2** `#2690.9af6aab5`: An open ask's row in the app still draws its kind in its state-word slot (#1461 AC27)

## What was read

- Issue #2690's body (not its comments).
- `AGENTS.md`; `docs/technical-design.md`: Dogfooding, States people see, One list and one page, Replica.
- At the base: `packages/hub/src/rows.ts` (`buildRows`, an ask's row), `packages/contracts/schemas/row.set@1.json`,
  `crates/deep-app/src/list.rs` (`build`, the ask row's word and the `ask-words-alike` plant), `crates/deep-app/src/views.rs`
  (the drawn row's name and slots, the rows the hub built), `crates/deep-app/src/kinds.rs` and `crates/deep-app/copy/en.json`
  (each kind's word), `crates/deep-replica/src/drive/mod.rs` (`see`), `scripts/proof-change.mjs` (criterion IDs), and the
  suites `tests/acceptance/1463` (`helpers.ts`, `list.test.ts`, README), `tests/acceptance/1461` (`helpers.ts`,
  `redraft/rows.test.ts` AC27, READMEs), `tests/acceptance/1172` (listed) and `tests/acceptance/16` (`deep`, `Ev`).
- `tests/acceptance/1810/redraft-replica` isn't at the base (it's on #1810's branch, which this job doesn't read); its
  rule is #1463's `drawnFailures`, which the issue names, so C1 uses that judge as it is.

## The surface

All three readers are the real ones, over one record a real hub built (#1461's `makeWorld`: sessions, titles, states and
asks seeded through the record and asks core with the hub stopped, then a real `deep hub run` that writes each row):

- **The hub's list row:** the latest `row.set` per ask id in the hub's record, read through `events.read` (#1463's
  `allEventsOf`), while listed.
- **`deep`:** `deep status --json` (the row's `word`) and bare `deep` (the ask's line holds its question and that word,
  #1463's `textRowFailures`), from the built CLI against that hub.
- **The app's drawn row:** the real `deep-drive` launched with `launch.from: "record_copy"` in the world's HOME (#1461's
  `replicaOf`), half a second on its clock, then `see`'s snapshot. C1 judges it with #1463's `drawnFailures`: the node
  carrying the row's id holds the word in its own or its children's names or string values. C2 reads the
  `<handle>:word` slot the way #1461's redraft does: the strings drawn inside its bounds, else its accessible name.

### The fixture

`row-word.test.ts`, `SPECS`: `Release 1.4` in `shop` with an open approval (a push, with its plan), `Login page` in `shop`
with an open taste call *Which header colour on the login page?*, `Cart store` in `docs` with an open choice *Keep the cart
on SQLite or plain files?*, and `Search index` in `search`, working. The three kinds' words, from `kinds.plain_*`:
`Approval`, `How it looks`, `Pick one`.

## Criterion to tests

| Criterion | Test (`row-word.test.ts`) | Asserts | Fails on |
|---|---|---|---|
| C1 `#2690.50174a03` | `each open ask's word in the hub's row.set is the word deep status --json, deep and the app's drawn row give it` | each fixture ask has a listed `row.set` with a word that isn't its title; `deep status --json` gives that row the same word; `deep` exits 0 with a line holding the question and that word; the app's node for that row holds that word | the base: the hub and `deep` say `needs you`, the app's node lacks it (`row ask:… 's node reads "…", which lacks its word "needs you"`) |
| C2 `#2690.9af6aab5` | `each open ask's state-word slot draws its kind: Approval, How it looks, Pick one` | each ask's `<handle>:word` slot draws its kind's word, any case | option 3 (the kind dropped from the slot); the plant below |
| C2 `#2690.9af6aab5` | `wrong program: ask-words-alike …` | with `DEEP_HUB_PLANT=ask-words-alike` in the replica built with `env-plants`, the judge fails naming every ask row | a judge that can't see the slot |

C1 holds whichever of the issue's options lands: the word compared is the hub's row's own, so option 1 (the hub's word
becomes the kind) passes when `deep` and the drawn row say that kind, and option 2 (the row's node names `needs you`) passes
when the node holds it. A hub word that is the ask's question would pass trivially, so it fails here.

C2 is a regression guard and passes at the base on purpose: the issue's "Done when" keeps #1461 AC27, and the obvious
wrong fix, option 3, breaks it. Its failing wrong program at the base is the `ask-words-alike` plant.

## Scope the criteria don't cover here

"Done when" also names suites that must then pass on the Mac: #1810's `redraft-replica/list.test.ts`, #1461 AC27
(`tests/acceptance/1461/redraft/rows.test.ts`), #1459 AC6 (`#1459.cd8e77fe`, cargo's `replica_equals_live_tree`) and
#1172 AC3 (`tests/acceptance/1172/rows.test.ts`). They are run as they are, not redrafted here (AGENTS.md: no duplicate
test). "With its guarded change approved" is a review and signing step, not a test.

## How to run

With Node 24 first on `PATH`, the workspaces built (`npm ci; npm run build --workspaces`), `deep-hook` built (`cargo build
--locked -p deep-hook`), cargo on `PATH`; on macOS for the app's parts:

```sh
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/2690 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/2690/tsconfig.json
```

The replica (`deep-drive`, plain and with `env-plants`) is built by #1461's helpers into `$TMPDIR/dd1461-bin-<uid>` on first
use. Off macOS every test reaching the app throws `BLOCKED: the replica and the app draw on macOS only`,
never a pass. Vitest writes `tests/acceptance/2690/node_modules/.vite/`; delete it before committing.

## Disputes and assumptions a redraft may revisit

1. **Which word is "the" word.** The hub's `row.set` word is the reference; the issue allows either the state word or the
   kind to become the shared one.
2. **"The app's drawn row"** is the accessibility node carrying the row's id, with its children (#1463's `drawnFailures`, the
   rule #1810's redraft applies), not the strings drawn on screen.
3. **"Its kind"** is the app's word for the ask's kind (`Kind::of(ask).plain()`), compared without case.

## Run at the base

See `BASE-FAILURE.txt`.
