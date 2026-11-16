# Acceptance tests for #539, Oracle lane, criterion 5: the pinned upstream focus-group tests run against our grid focus

A blind redraft of the Oracle lane for criterion 5 (`#539.ece9dcef`), the one criterion the issue's Oracle page links an
upstream test to. Written first, from the issue, its Oracle page, the design and the base, by a job that never saw an
implementation of #539; none was read, and no other worktree, branch or pull request was. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). #136's rule
applies: a linked test counts only when run against our output, so every upstream case here is a `deep-show run` of our
fixture, judged by the focus our scope reports.

## What was read

- The issue (`gh issue view 539`): its Scope, Fields, six criteria, Proof and Oracle lines. Its parent #187, only for
  what the sibling parts own (#540 the point control, #541 actions and pads, #542 text and scroll, #543 the camera).
- The design: `docs/technical-design.md` Control and input track, Dogfooding; `docs/canvas-primitives.md` Scope and input
  classes, Input router, focus and gesture serial, Mark set: logic columns, Mark set: hex grid, Selection (session
  state), Control, Control: picks on rows and grid focus.
- The Oracle page, `doneright/oracles/issues/539.md` on branch `doneright` of `DeepBuildAI/deepbuild`, and the four files
  it pins, fetched from its upstream links at commit `2f57f45d21482f94b36123dfcec77ae7ab859bc1`:
  `sequential-navigation/basic-tab-behavior.html`, `grid-navigation/simple-case.html`,
  `grid-navigation/simple-case-with-non-focusable-cell-in-the-center.html` and `home-end-keys.optional.html` (paths under
  the upstream suite's tentative focus-group folder, as the page gives them).
- The base, commit `c8e33f1a6` ("Acceptance tests for #539, written blind"), which adds only `tests/acceptance/539/` and
  an earlier draft of this lane to main at `53c0e72a3`. This job's worktree started at a later main (`e5a767b4a`), which
  lacks both folders, and was moved to `c8e33f1a6` before anything was written. The earlier draft,
  `tests/acceptance/539-oracle/`, was not read. Read for surfaces and conventions only: `tests/acceptance/539/` (its
  README, `helpers.ts`, `fixtures.ts`, `programs.ts`, `ac5-grid-focus.test.ts`, `BASE-FAILURE.txt`), whose helpers,
  fixtures and programs this lane imports read only; `crates/deep-canvas/src/scope.rs` (Tab and the keys the base takes)
  and `crates/deep-show/src/input.rs` (how an `input` event is read); `scripts/lanes.mjs` (`alone`),
  `scripts/proof-change.mjs` (`criterionId`), `scripts/public-text.mjs`; `tests/acceptance/505-oracle/README.md` for an
  Oracle lane's form.

Every expected focus is the upstream test's own, re-expressed on our cells, wherever the design agrees with it. No
upstream code or text is copied: each case is written in our words and named by its file and the line its test starts
on.

## How an upstream case becomes ours

| Upstream | Ours |
|---|---|
| A group of focusable items (one Tab stop with arrow keys inside) | A pick control on rows with `focus` (`../539/fixtures.ts` `pickControl`, `focus: {}` or `{start}`) over `strip`, a square grid laid out by `grid.size`, cell [16, 16] at (8, 8) (`stripDoc`), its `alive` from `world` (`../539/programs.ts` `worldProgram`) |
| Table cell r<N>c<M> | Cell (M − 1, N − 1), the row `strip#<M−1>,<N−1>` |
| An item that can't take focus, or one opted out of the group | A row whose `alive` is false (the design: a row that doesn't draw is never focused) |
| The group's start attribute | `focus.start` |
| Focusing an item directly before sending a key | Tab into the stop, which enters at `focus.start` (its default the first drawn row) |
| The items before and after the group | Sliders `before` and `after`, in document order around `place` |

Each case is its own run, as each upstream test focuses its start item anew. The panel's rect fits the page, so every
row is in view and none is hidden by the camera.

## Cases ported (18)

| File, line | Upstream check | Our case and expected focus |
|---|---|---|
| basic-tab-behavior, 26 | Tab from the item before enters the group at its first item; the next Tab leaves for the item after | 3 × 1: Tab `before`, Tab `strip#0,0`, Tab `after` |
| basic-tab-behavior, 46 | Arrow keys keep moving inside the group | 3 × 1: Tab `before`, Tab (0, 0), Right (1, 0), Right (2, 0) |
| simple-case, 29 | Right moves to the next column | 3 × 2: (0, 0) → (1, 0) |
| simple-case, 34 | Down moves to the next row | 3 × 2: (0, 0) → (0, 1) |
| simple-case, 39 | Left moves to the previous column | 3 × 2, start (1, 0): → (0, 0) |
| simple-case, 44 | Up moves to the previous row | 3 × 2, start (0, 1): → (0, 0) |
| non-focusable centre, 34 | Right skips the centre that can't take focus | 3 × 3, (1, 1) dead, start (0, 1): → (2, 1) |
| non-focusable centre, 44 | Left skips it | 3 × 3, (1, 1) dead, start (2, 1): → (0, 1) |
| home-end, 85 / 90 | In a toolbar of three, Home and End from the middle go to the first and the last | 3 × 1, start (1, 0): Home → (0, 0); End → (2, 0) |
| home-end, 95 / 100 | Home on the first and End on the last stay | 3 × 1: Home on (0, 0) → (0, 0); start (2, 0): End → (2, 0) |
| home-end, 119 / 124 | In a block-axis menu, Home and End go to the first and the last | 1 × 3: start (0, 2), Home → (0, 0); End from (0, 0) → (0, 2) |
| home-end, 143 / 148 | Home and End ignore the start item | 3 × 1, start (1, 0): Right (2, 0), Home → (0, 0); Left (0, 0), End → (2, 0) |
| home-end, 155 / 160 | Home and End skip an opted-out item and reach the ends | 5 × 1, (2, 0) dead: start (4, 0), Home → (0, 0); End from (0, 0) → (4, 0) |

Plus one test of the criterion's own wrong program: the ported Right across the hidden centre (non-focusable centre,
line 34), run under `planted: "focus_stops_on_hidden_rows"` (`../539/README.md`: Planted twins), must fail, its failure
naming `strip#1,1` as a row that doesn't draw. So the lane is shown to catch the planted focus the criterion names. 19
tests in `focus-oracle.test.ts`.

## Cases not ported, and why

- **basic-tab-behavior, line 36: Shift+Tab enters the group at its first item and leaves backwards.** Neither the issue
  nor the design names a reverse Tab anywhere, and the base takes Tab only forwards, for every stop (`scope.rs`: a key
  event's `Tab` steps to the next stop; shift isn't read on keys). Porting it would add a key path no requirement names
  (AGENTS.md: nothing the task doesn't need). If the owner wants reverse Tab, it is a design change first.
- **non-focusable centre, line 39 (Down from r1c2 to r3c2) and line 49 (Up from r3c2 to r1c2).** Here the design
  disagrees with the upstream answer. Control: picks on rows and grid focus: Up and Down go "to the nearest row that way
  holding a drawn cell, at the drawn cell whose center's x is nearest the focused one's, ties to the smaller cx". Row 1
  holds the drawn cells (0, 1) and (2, 1), each 16 u along x from (1, 0) and from (1, 2), so both Down from (1, 0) and
  Up from (1, 2) focus (0, 1), where the upstream tests jump the gap to (1, 2) and (1, 0). A test with our answer would
  no longer be the upstream check, and the issue's own vertical tie (the hex Up from (1, 1)) is the main suite's, so
  neither is ported.
- **home-end, lines 107 and 112: a wrapping tablist.** Our rows have no wrap setting (the design: with no row that way,
  focus stays), and Home and End there give the toolbar's answers on the same three rows: a duplicate of lines 85 and 90.
- **home-end, lines 131 and 136: nested groups.** Rows hold no group inside them.
- **home-end, lines 167 to 209: Home and End inside a text input, a list box or a text area stay there.** A grid's rows
  hold no text field; the text control is #542's.
- **The rest of criterion 5**: the 12 × 12 grid's Tab, Right × 3 and Down × 2 to (3, 2) with each move announced and no
  entry, Enter's pick, Right over a dead (1, 0) on that grid, the hex tie, focus moving off a row that stops drawing, and
  the planted announcement of (1, 0). The Oracle page calls these ours; they are `tests/acceptance/539/ac5-grid-focus.test.ts`.

## Readings where the design leaves a choice

- **"Home and End go to the first and last drawn rows"**: first and last in the order `grid.size` lays rows (row i at
  cx = i mod cols, cy = ⌊i ÷ cols⌋), so (0, 0) and (cols − 1, rows − 1) when they draw: on a line its two ends, on a
  column its top and bottom. No ported case puts a dead row at an end, so the order across rows decides only the 1 × 3
  column, where reading order and index order agree.
- **The block-axis menu** is a 1 × 3 column: its items stack along the block axis, as cells (0, 0), (0, 1), (0, 2) do.

## The surface under test

Everything is `../539/README.md`'s surface, nothing new: `deep-show run` (one JSON scenario on stdin, one answer, one
reply per call) on the scope's virtual clock; the document `stripDoc` builds, with `controls` `{place}` or `{before,
place, after}`; `input` events `{type: "key", key}` with `Tab`, `ArrowRight`, `ArrowLeft`, `ArrowUp`, `ArrowDown`,
`Home`, `End`; each key's reply's `state.focus` (a row as `strip#<cx>,<cy>`, a control's own stop as its ID); and the
planted name `focus_stops_on_hidden_rows`. The helpers, fixtures and programs come from `../539/` by import, read only.

## Run them

```sh
npm ci && npm run build --workspaces   # once, in a fresh worktree
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 \
  scripts/lease npx vitest run tests/acceptance/539-oracle-redraft --testTimeout=600000
npx tsc --noEmit -p tests/acceptance/539-oracle-redraft
```

The file builds `deep-show` once in `beforeAll` (`cargo build --locked --bin deep-show`, honoring `CARGO_TARGET_DIR`,
rustup's bin on PATH where it exists) and #544's assembler into `target/acceptance-539-wat/`, as `../539/`'s files do.
Each test passes its own 30-minute timeout. Evidence stores and the binary's copy are temporary and deleted. No process
is started but `cargo`, the assembler and `deep-show`, each waited for, none stopped by name or port. Gates: no cargo is
`BLOCKED:`, never a pass. No test reads a timing or the machine's load.

**The lanes line.** The implementer adds this folder to `scripts/lanes.mjs`'s `alone` (this README is the instruction),
on the line `../539/README.md` gives:

```js
// #539's files each build deep-show and #544's assembler, run logic programs, export on the GPU and draw the app's window.
alone.push('tests/acceptance/539/', 'tests/acceptance/539-oracle/', 'tests/acceptance/539-oracle-redraft/');
```

If this redraft replaces the earlier draft, `tests/acceptance/539-oracle/` leaves that line.

`BASE-FAILURE.txt` is the run at the base.
