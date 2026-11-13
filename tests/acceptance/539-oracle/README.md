# Acceptance tests for #539, Oracle lane: the pinned upstream focus-group tests, run against our grid focus

Written first, blind, from four sources:

- issue #539;
- its Oracle page, `doneright/oracles/issues/539.md` on branch `doneright` of `DeepBuildAI/deepbuild`;
- the four upstream files that page pins, read from the vendor copies on that branch;
- the #539 suite's surface (`tests/acceptance/539/README.md`, written by the same job) and the base commit `53c0e72a3`.

The job never saw an implementation of #539; none existed, and no other worktree, branch or pull request was read.
#136's rule applies: a linked test counts only when run against our output, so each case here builds our documents and
asserts on the focus `deep-show`'s scope reports. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding).

The page links upstream tests to criterion 5 of 6. Criteria 1 to 4 and 6 have none (the page's "No upstream test" table)
and stay with `tests/acceptance/539/`. The page's own scope for criterion 5: one Tab stop that Tab enters at its first
item and the next Tab leaves for the next control, arrows over a grid that skip a cell that can't take focus, and Home and
End; the hex tie, focus moving off a row that stops drawing, the announced label and the pick on Enter are ours, tested
by the #539 suite.

## Sources

All four are an upstream web test suite's tentative focus-group tests, pinned at commit `2f57f45d21482f94b36123dfcec77ae7ab859bc1`
(the page gives each file's path and its upstream link). Use: port.

| Upstream file | What it checks | Ported here (`focus-group.test.ts`) |
|---|---|---|
| `sequential-navigation/basic-tab-behavior.html` | a focusable before, a group of three items, a focusable after: Tab enters the group at its first item and the next Tab exits to the next focusable; arrows keep working inside | test 1: `before`, the group's three-cell strip, `next`; Tab × 3 focus `before`, (0, 0), `next`; Tab × 2 and Right × 2 focus (0, 0), (1, 0), (2, 0) |
| `grid-navigation/simple-case.html` | a 3 × 2 grid: Right from r1c1 to r1c2, Down from r1c1 to r2c1, Left from r1c2 to r1c1, Up from r2c1 to r1c1 | test 2, each move from its cell |
| `grid-navigation/simple-case-with-non-focusable-cell-in-the-center.html` | a 3 × 3 grid whose centre can't take focus: each of the four arrows across it skips it | test 3, the centre a row whose alive is false |
| `home-end-keys.optional.html` | Home and End go to the first and last items, stay at the ends, in a toolbar and a block-only menu, ignore the group's start item, and skip an opted-out item | test 4, ten cases |

**The tests, re-expressed.** No upstream code is copied or run. Upstream's group is ours: rows of a pick control with
`focus`, here a strip or a small grid (`strip`, cells of 16 u laid out by grid.size from a logic item, at (8, 8)); an
item or cell `rNcM` is our cell (M − 1, N − 1). Upstream focuses an element, then sends a key; ours makes that cell the
group's `focus.start`, presses Tab (which enters the group there), then the key, and reads the scope's `state.focus` after
each key. "A cell that can't take focus" and "an opted-out item" are rows whose `alive` is false, which never take focus
(Control: picks on rows and grid focus). Upstream's start-item attribute is our `focus.start`. A block-only menu is a
column of three cells.

**Not ported.** Shift+Tab (two cases of the sequential test): the design gives Tab's order and nothing for Shift+Tab. The
Home and End test's wrapping tab list (the same Home and End as the toolbar's; our rows never wrap), its nested groups
(rows hold no group) and its key-conflict cases (a text field, a select and a text area inside the group; rows hold no
field). The vendor copies carry the upstream suite's own license; nothing is copied, so no notice is carried.

## Run

```sh
npm ci && npm run build --workspaces   # once, in a fresh worktree
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 \
  scripts/lease npx vitest run --root tests/acceptance/539-oracle --testTimeout=600000 --no-file-parallelism
npx tsc --noEmit -p tests/acceptance/539-oracle
```

`helpers.ts` re-exports the #539 suite's helpers, programs and fixtures (`../539/`), so both lanes build and ask the same
binary the same way: `cargo build --locked --bin deep-show` once, and #544's assembler. **`scripts/lanes.mjs` needs
`'tests/acceptance/539-oracle/'` in its `alone` list**; the #539 README gives the line, and the implementer makes that
edit.

## The surface under test

The #539 suite's (its README: The surface under test), with nothing added: a pick control with `rows` and `focus`
(`focus.start` among them), `input`'s keys `Tab`, `ArrowRight`, `ArrowLeft`, `ArrowUp`, `ArrowDown`, `Home` and `End`,
and `state.focus` (a row as `strip#<cx>,<cy>`, a control as its ID). Each upstream file's cases run in one scenario, each
case's document in a panel of its own, its keys sent to that panel.

## Criterion to tests

| ID | Test | Upstream | Ours |
|---|---|---|---|
| `#539.ece9dcef` | `focus-group.test.ts` (4) | the four files above | the table above |

Each test fails on the base, whose Tab focuses a control's own stop and whose arrows, Home and End move no focus
(`BASE-FAILURE.txt`). A wrong program that gives each cell its own Tab stop, wraps, moves onto a row that doesn't draw, or
takes Home and End to the start item fails a named case.

## Readings where the port leaves a choice

- **Home and End on a grid** aren't ported: upstream's Home and End tests use lines of items, and ours use rows and
  columns of cells only, where the first and last drawn rows are unambiguous.
- **"Enters at its first item"** is the stop's `focus.start` default, the first drawn row; a case that sets
  `focus.start` enters there, as upstream's focus call puts the focus on its element first.

## What the implementer adds outside this folder

The `alone` line in `scripts/lanes.mjs`. Nothing else.
