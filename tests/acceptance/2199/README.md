# Acceptance tests for #2199: deep inbox shows the option IDs that deep inbox answer takes

Written first and blind, at base commit `72fe11a1`, from issue #2199, the design and the base, before any
implementation. The drafting job saw nothing of the work: no other checkout, branch, pull request diff or commit past
the base. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this
job (design: Dogfooding). There is no taste criterion, so no `TASTE.json`.

## What was read

- **Issue #2199**, its live body read with `gh issue view` on 2026-11-14: the revision with `updatedAt`
  2026-11-14T23:10:40Z, no comments. The criterion IDs in `criteria.json` are computed from that body
  (`scripts/proof-change.mjs`, `criterionId`).
- `docs/technical-design.md`: An ask, and your answer getting back; How we know version 0 works (Tests written first,
  Wrong programs).
- At the base: `packages/hub/src/inbox.ts` (the line `deep inbox` prints, and its plant `inbox-no-default`),
  `packages/hub/src/plant.ts` (`activePlant`, the list of plants), and the suites `1463` (helpers, inbox, judges,
  README), `2197` and `2203` (the README's and `criteria.json`'s shape), `16` and `26` (what `1463`'s helpers import).

## How to run

Node 24.22 or newer and `git` on the `PATH`, `node_modules` installed (`npm ci --ignore-scripts`), the workspaces
built (`npm run build --workspaces`) and `deep-hook` built (`cargo build --locked -p deep-hook`): the tests run the
built CLI (`packages/cli/dist/main.js`) and are BLOCKED, by a thrown error, without either. From the checkout's root:

```sh
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/2199 --no-file-parallelism
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/2199 judges     # the judges alone, anywhere
node node_modules/typescript/bin/tsc -p tests/acceptance/2199/tsconfig.json --noEmit
```

- **What it starts and stops.** `inbox.test.ts` makes two worlds (#1463's `makeWorld`): each a temp home and repos
  under short `/tmp` folders (a socket path must fit), a real hub (`deep hub run`) and one `sleep` stand-in per
  session. Every process runs with `HOME` there, so nothing touches the real `~/.deepbuild` or `~/.claude`. It stops
  only the processes it started, by PID (#16's and #26's `cleanup`), and removes its folders. No network, no model.
- **Linux and macOS.** Nothing here is Mac-only; the base run was on Linux arm64. `deep inbox answer` needs the OS to
  confirm you: the hub of each world runs with `DEEP_HUB_TEST_CONFIRM` naming a file that says `confirmed`, #24's
  stand-in, as #1463's world sets it.
- **Time.** About 25 s for both files on a loaded machine.
- **Cache.** Run with `--root tests/acceptance/2199`, vitest leaves `tests/acceptance/2199/node_modules/.vite/`;
  delete it before committing.

## The surface

The tests reach the code only through surfaces the issue names: **`deep inbox`** and
**`deep inbox answer <handle> <id>`**, run as the built CLI from the test process, and **the hub's record**, read
through `events.read` on a `cli` connection, for "the ask is answered with that option". `deep inbox --json` is read
only to check each test's Given (the ask is open and its row's actions hold the IDs), which the issue says it already
holds. No hub or CLI module is imported. Imported from other suites: `../1463/helpers.ts` (`makeWorld`, `deep`,
`allEventsOf`, `jsonRows`, `inboxFailures`, `shown`, `cleanup`, `DAY` and its types), which itself builds on #16's,
#26's and #1551's helpers.

**The fixture** (`helpers.ts`, `FIXTURE`): two sessions in two repos, each with one open ask raised through the real
asks core before the hub starts.

| Ask | Kind | Options (ID, label) | Default |
| --- | --- | --- | --- |
| "Which border for the card, thin or thick?" (the issue's own) | taste | `thin` "Thin", `thick` "Thick" | `thin` |
| "Where does the cart keep its data?" | choice | `sqlite` "SQLite", `files` "Plain files" | `files` |

## Criteria to tests

| # | ID | Test (in `inbox.test.ts`) | On the base |
| --- | --- | --- | --- |
| 1 | `#2199.bff55edb` | with an open taste ask whose options are thin and thick, deep inbox holds both IDs with the ask | FAIL: the ask's line lacks the IDs thin and thick |
| 2 | `#2199.3ebf26b3` | deep inbox answer with the ask's handle and an ID deep inbox printed answers the ask with that option | FAIL: deep inbox printed no ID to answer with, so the Given isn't there |
| 3 | `#2199.e1f74e0f` | with an option whose label is "Plain files" and whose ID is files, deep inbox shows files | FAIL: the line holds "Plain files" and no ID files |
| 3 | `#2199.e1f74e0f` | a planted line that prints only labels fails, naming the ask | FAIL: the base has no such plant (below) |
| 4 | `#2199.4b672bc1` | deep inbox prints each question before its handle, the default sentence between them, and the handle last on its line | PASS, as the issue expects: it guards the order through the change |

`judges.test.ts` holds the judges to right and wrong sample texts with no hub; it carries no criterion tag and passes
at the base. `BASE-FAILURE.txt` is the base run, whole.

## The plant

Criterion 3's wrong program is **`inbox-labels-only`**, selected with `DEEP_HUB_PLANT=inbox-labels-only` in the
`deep inbox` process (as `inbox-no-default` is) and declared in `packages/hub/src/plant.ts`. The implementing change
adds it. Its contract:

- With the plant active, `deep inbox` prints everything it prints without it, except that **where each option's ID
  goes it prints that option's label**: "SQLite" and "Plain files" for the second fixture ask, "Thin" and "Thick" for
  the first. No option ID is printed for any ask.
- Nothing else changes: exit 0, the question, the default sentence, the handle and the count sentence as without it.

The test runs `deep inbox` under the plant and passes only if the judge's failure names the ask's handle and says its
option `files` is shown "by its label "Plain files" and not by its ID". The judge says that only when the label is
printed with the ask outside its question and its default sentence. So the base, which has no such plant and prints
"Plain files" in the default sentence alone, fails this test too. **This half could not be run to a pass here**: no
plant exists at the base. What was run is its judge on sample texts of such a line (`judges.test.ts`, "labels where
the IDs belong fail").

## Pinned here, where the issue is silent

1. **"With the ask"** is the ask's block: the line holding its question and every line under it, up to the next line
   that holds another listed ask's question, a `decided for you` line or the count sentence. IDs may be on the ask's
   line or on lines under it; indentation, brackets, separators and any words around them are free.
2. **"Holds the ID"** is the ID as a word of its own, case kept: no letter, digit, `_` or `-` on either side. Before
   looking, the judge takes out of the block the ask's question (the issue's own says "thin or thick") and every
   label that differs from its ID, as written ("Plain files" holds "files"; "Thin" is not "thin"). A fix may print
   labels beside the IDs.
3. **"An ID it printed"** (criterion 2) is `thick`, read out of the output by the same judge; it isn't the ask's
   default, so a default can't pass for the answer. The test fails before answering when the output holds no such ID.
   "Answered with that option" is one `ask.answered` event on the ask's handle whose `answer` is `thick`, and the ask
   gone from `deep inbox`.
4. **Criterion 3 asks only that `files` is shown**; `sqlite` is not judged there. The plant's test looks at `files`.
5. **The default sentence** (Scope: it stays between the question and the handle) is held in criterion 4's test as
   `If you don't answer: <the default's label>, ` between each ask's question and its handle. Its time is #1463's
   criterion and isn't judged here. "The question before the handle, the handle last on its line" is #1463's own
   judge, `inboxFailures`, imported.
6. **`deep inbox --json` doesn't change** (Scope) has no criterion and no test here beyond the Given's read.

## Not done here

- The plant's half of criterion 3 run to a pass (above).
- The issue's Proof also asks for the inbox cases of the seven suites that read these lines (#24, #27, #111, #355,
  #667, #1463, #1510) run once on the change. That is the change's own run. From this job only #1463's "deep inbox
  answer <handle> still works" was run at the base, once, to show the answering path works on this machine; it passed.
